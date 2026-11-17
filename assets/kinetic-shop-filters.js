/* ==========================================================================
   KINETIC® — real-time collection search, filtering and sorting
   --------------------------------------------------------------------------
   A self-contained layer that drives the EXISTING collection section:
     · the product grid            (#productGrid, rendered by kinetic-app.js)
     · the category quick buttons  (#filterRow)
     · the sort select             (#sortSelect)
     · the header search overlay   (#searchOverlay / #searchInput / #searchResults)

   It never rebuilds the page. kinetic-app.js asks this module two questions
   ("does this product match?" / "in what order?") and this module answers.
   If the script is missing, the shop behaves exactly as it always did.

   Filters, search and sort are mirrored into the URL query string
   (?category=running&color=black&size=42&…), so any view is shareable and a
   refresh restores it.
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.1';
  var LS_RECENT = 'kinetic-search-recent-v1';
  var LS_OPEN = 'kinetic-filter-panels-v1';
  var LS_RAIL = 'kinetic-filter-rail-v1';
  var LOW_STOCK = 3;            /* the shop's own low-stock rule (admin default) */
  var MAX_RECENT = 6;
  var BOOT_TIMEOUT = 9000;

  /* ------------------------------------------------------------------ utils */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* lowercase, accents stripped, punctuation collapsed to single spaces */
  function slug(v) {
    return String(v == null ? '' : v).toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  function int(v, d) { var n = parseInt(v, 10); return isFinite(n) ? n : (d || 0); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d || 0); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function uniq(arr) { var out = [], seen = {}; arr.forEach(function (v) { var k = String(v); if (!k || seen[k]) return; seen[k] = 1; out.push(v); }); return out; }
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US'); }
  function pad3(n) { return String(n).length >= 3 ? String(n) : ('000' + n).slice(-3); }
  function debounce(fn, ms) { var t = null; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
  function reduced() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function store(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function storeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

  /* ------------------------------------------------------------------ state */
  var state = {
    q: '', cats: [], colors: [], sizes: [],
    min: null, max: null,
    avail: [], rating: 0, sale: false, featured: false,
    sort: 'feat'
  };
  var bounds = { min: 0, max: 500 };
  var openPanels = store(LS_OPEN, { cat: true, price: true, size: true, color: true, avail: true, rating: true, offers: true });
  if (typeof openPanels !== 'object' || !openPanels) openPanels = {};
  var dragging = false;
  var booted = false;
  var chromeDirty = false;
  var lastCounts = { shown: 0, total: 0 };

  var AVAIL_LABEL = { in: 'In stock', low: 'Low stock', out: 'Sold out' };
  var AVAIL_HINT = { in: 'Any size left', low: '3 pairs or fewer', out: 'Nothing left' };
  var SORT_LABEL = {
    feat: 'Featured', new: 'Newest first', pop: 'Most popular',
    low: 'Price: low → high', high: 'Price: high → low', rate: 'Best rated'
  };
  var RATING_STEPS = [4.5, 4, 3.5];

  /* ------------------------------------------------------- shop accessors */
  function app() { return window.KINETIC_APP || null; }

  function allProducts() {
    var a = app(); if (!a) return [];
    var list = [];
    try { list = a.products() || []; } catch (e) { list = []; }
    return list.filter(function (p) {
      try { return a.isValidProduct ? a.isValidProduct(p) : !!p; } catch (e) { return !!p; }
    });
  }

  function skuOf(p) {
    var s = p && p.sku ? String(p.sku).trim() : '';
    if (s) return s.toUpperCase();
    var n = Number(p && p.id);
    return isFinite(n) ? ('KNT-' + pad3(n + 1)) : '';
  }

  /* the collection data has used both "swatch" and "hex" for a colourway value */
  function swatchOf(cw) {
    if (!cw) return '';
    var v = cw.swatch || cw.hex || cw.color || cw.value || '';
    return String(v || '').toUpperCase();
  }

  function colorwaysOf(p) {
    var a = app();
    if (a && a.colorways) { try { var c = a.colorways(p.id); if (c && c.length) return c; } catch (e) {} }
    if (p && Array.isArray(p.colorways) && p.colorways.length) return p.colorways;
    if (p && Array.isArray(p.colors) && p.colors.length) {
      return p.colors.map(function (hex, i) { return { name: 'Colourway ' + (i + 1), swatch: hex, hex: hex }; });
    }
    return [];
  }

  function sizeRowsOf(p) {
    var a = app();
    if (a && a.stockSummary) { try { var s = a.stockSummary(p.id); if (s && s.rows) return s.rows; } catch (e) {} }
    return [];
  }

  var summaryCache = new Map();
  function summaryOf(p) {
    /* kinetic-app.js renders the grid once from inside its own IIFE, before it has
       published window.KINETIC_APP — a stock answer from that moment would be empty,
       so only answers taken with the app present are allowed into the cache. */
    var cacheable = !!(app() && app().stockSummary);
    var hit = (cacheable && summaryCache.get(p)) || null;
    if (hit) return hit;
    var rows = sizeRowsOf(p);
    var inStock = rows.filter(function (r) { return r.stock > 0; });
    var low = inStock.filter(function (r) { return r.stock <= LOW_STOCK; });
    var out = {
      rows: rows,
      available: inStock.length,
      low: low.length,
      out: rows.length - inStock.length,
      units: rows.reduce(function (s, r) { return s + r.stock; }, 0),
      soldOut: rows.length > 0 && inStock.length === 0
    };
    if (cacheable) summaryCache.set(p, out);
    return out;
  }

  function isSale(p) { var o = Number(p && p.old); return isFinite(o) && o > 0 && o > Number(p && p.price); }
  function isFeatured(p) { return !!(p && p.featured); }
  function ratingOf(p) { return num(p && p.rating, 0); }
  function reviewsOf(p) { return num(p && p.reviews, 0); }
  function newestKey(p) {
    var d = p && p.createdAt ? Date.parse(p.createdAt) : NaN;
    if (isFinite(d)) return d;
    return num(p && p.id, 0);
  }
  function tagWeight(p) {
    var t = String((p && p.tag) || '').toLowerCase();
    if (t === 'limited') return 5;
    if (t === 'hot') return 4;
    if (t === 'new') return 3;
    if (t === 'icon' || t === 'archive') return 2;
    return 1;
  }

  /* units sold, read from the real orders this device holds */
  var soldCache = null;
  function soldMap() {
    if (soldCache) return soldCache;
    var map = {};
    try {
      var orders = (window.KINETIC_CHECKOUT && typeof window.KINETIC_CHECKOUT.orders === 'function') ? window.KINETIC_CHECKOUT.orders() : [];
      (orders || []).forEach(function (o) {
        if (!o || o.status === 'Cancelled' || o.status === 'Refunded') return;
        (o.items || []).forEach(function (it) {
          var k = String(it && it.id);
          map[k] = (map[k] || 0) + int(it.qty, 0);
        });
      });
    } catch (e) {}
    soldCache = map;
    return map;
  }
  function soldOf(p) { return soldMap()[String(p && p.id)] || 0; }

  /* ------------------------------------------------------------- text index */
  var textCache = new Map();
  function textOf(p) {
    var hit = textCache.get(p);
    if (hit) return hit;
    var parts = [p && p.name, p && p.cat, p && p.tag, p && p.desc, skuOf(p), String(p && p.id)];
    colorwaysOf(p).forEach(function (c) { if (c && c.name) parts.push(c.name); });
    var hay = slug(parts.filter(Boolean).join(' '));
    var out = { hay: hay, compact: hay.replace(/ /g, '') };
    textCache.set(p, out);
    return out;
  }
  function tokensOf(q) { return slug(q).split(' ').filter(Boolean); }
  function matchesText(p, q) {
    var tk = tokensOf(q);
    if (!tk.length) return true;
    var t = textOf(p), all = true, i;
    for (i = 0; i < tk.length; i++) { if (t.hay.indexOf(tk[i]) === -1) { all = false; break; } }
    if (all) return true;
    return t.compact.indexOf(slug(q).replace(/ /g, '')) > -1;   /* "knt001" style typing */
  }
  function scoreText(p, q) {
    var tk = tokensOf(q);
    if (!tk.length) return 0;
    var name = slug(p && p.name), cat = slug(p && p.cat), sku = slug(skuOf(p)), hay = textOf(p).hay;
    var score = 0;
    tk.forEach(function (t) {
      if (sku === t) score += 60;
      else if (sku.indexOf(t) > -1) score += 34;
      if (name.indexOf(t) === 0) score += 26;
      else if (name.indexOf(t) > -1) score += 18;
      if (cat.indexOf(t) === 0) score += 12;
      if (hay.indexOf(t) > -1) score += 4;
    });
    if (slug(p && p.name).indexOf(slug(q)) > -1) score += 12;
    return score;
  }
  function highlight(name, q) {
    var out = esc(name);
    tokensOf(q).forEach(function (t) {
      if (t.length < 2) return;
      try { out = out.replace(new RegExp('(' + t + ')', 'gi'), '<mark>$1</mark>'); } catch (e) {}
    });
    return out;
  }

  /* --------------------------------------------------------------- matching */
  function boundsOf(list) {
    if (!list.length) return { min: 0, max: 500 };
    var lo = Infinity, hi = -Infinity;
    list.forEach(function (p) { var v = num(p.price, 0); if (v < lo) lo = v; if (v > hi) hi = v; });
    if (!isFinite(lo) || !isFinite(hi)) return { min: 0, max: 500 };
    lo = Math.floor(lo / 10) * 10;
    hi = Math.ceil(hi / 10) * 10;
    if (hi <= lo) hi = lo + 10;
    return { min: lo, max: hi };
  }
  function priceLo() { return state.min == null ? bounds.min : state.min; }
  function priceHi() { return state.max == null ? bounds.max : state.max; }
  function priceActive() { return priceLo() > bounds.min || priceHi() < bounds.max; }

  /* the shop's own "Limited" quick button = Limited tag, Hot tag or the Limited category */
  function isLimited(p) {
    var t = String((p && p.tag) || '').toLowerCase();
    return t === 'limited' || slug(p && p.cat) === 'limited';
  }
  function catMatches(p, cat) {
    if (slug(cat) === 'limited') return isLimited(p);
    return slug(p && p.cat) === slug(cat);
  }
  function colorsMatch(p, token) {
    var cws = colorwaysOf(p);
    var t = slug(token), tc = t.replace(/ /g, '');
    if (!tc) return false;
    if (String(token).charAt(0) === '#') {
      return cws.some(function (c) { return swatchOf(c) === String(token).toUpperCase(); });
    }
    return cws.some(function (c) {
      var n = slug(c && c.name), nc = n.replace(/ /g, '');
      if (!nc) return false;
      if (nc === tc || n === t) return true;
      if (nc.indexOf(tc) > -1) return true;
      return t.split(' ').every(function (w) { return nc.indexOf(w) > -1; });
    });
  }
  function sizeMatches(p, size) {
    var rows = summaryOf(p).rows;
    var s = String(size);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].size) === s) return rows[i].stock > 0;   /* sold-out sizes are not offered */
    }
    return false;
  }
  function availMatches(p, kind) {
    var s = summaryOf(p);
    if (kind === 'out') return !s.rows.length || s.available === 0;
    if (kind === 'low') return s.low > 0;
    if (kind === 'in') return s.available > 0;
    return true;
  }

  /* the one predicate kinetic-app.js calls for every product */
  function match(p, except) {
    except = except || '';
    if (except !== 'q' && state.q && !matchesText(p, state.q)) return false;
    if (except !== 'cat' && state.cats.length && !state.cats.some(function (c) { return catMatches(p, c); })) return false;
    if (except !== 'color' && state.colors.length && !state.colors.some(function (c) { return colorsMatch(p, c); })) return false;
    if (except !== 'size' && state.sizes.length && !state.sizes.some(function (s) { return sizeMatches(p, s); })) return false;
    if (except !== 'price' && priceActive()) {
      var v = num(p && p.price, 0);
      if (v < priceLo() - 0.001 || v > priceHi() + 0.001) return false;
    }
    if (except !== 'avail' && state.avail.length && !state.avail.some(function (a) { return availMatches(p, a); })) return false;
    if (except !== 'rating' && state.rating && ratingOf(p) < state.rating) return false;
    if (except !== 'sale' && state.sale && !isSale(p)) return false;
    if (except !== 'featured' && state.featured && !isFeatured(p)) return false;
    return true;
  }

  function sortList(list) {
    var out = list.slice(), s = state.sort || 'feat';
    if (s === 'low') return out.sort(function (a, b) { return num(a.price) - num(b.price) || num(a.id) - num(b.id); });
    if (s === 'high') return out.sort(function (a, b) { return num(b.price) - num(a.price) || num(a.id) - num(b.id); });
    if (s === 'rate') return out.sort(function (a, b) { return ratingOf(b) - ratingOf(a) || reviewsOf(b) - reviewsOf(a) || num(a.id) - num(b.id); });
    if (s === 'new') return out.sort(function (a, b) { return newestKey(b) - newestKey(a); });
    if (s === 'pop') return out.sort(function (a, b) {
      return soldOf(b) - soldOf(a) || reviewsOf(b) - reviewsOf(a) || ratingOf(b) - ratingOf(a) || num(a.id) - num(b.id);
    });
    return out.sort(function (a, b) {
      return (isFeatured(b) ? 1 : 0) - (isFeatured(a) ? 1 : 0) ||
        tagWeight(b) - tagWeight(a) ||
        soldOf(b) - soldOf(a) ||
        num(a.id) - num(b.id);
    });
  }

  function resultsNow() {
    return sortList(allProducts().filter(function (p) { return match(p); }));
  }

  /* ----------------------------------------------------------------- facets */
  function colourCatalog(list) {
    var map = {};
    list.forEach(function (p) {
      colorwaysOf(p).forEach(function (cw) {
        var id = slug(cw && cw.name); if (!id) return;
        if (!map[id]) map[id] = { id: id, name: String(cw.name || '').trim(), swatch: swatchOf(cw), order: Object.keys(map).length };
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function colourEntry(id) {
    var found = null;
    colourCatalog(allProducts()).some(function (c) { if (c.id === slug(id)) { found = c; return true; } return false; });
    if (found) return found;
    return { id: slug(id), name: String(id || '').replace(/-/g, ' '), swatch: '#3A3A40' };
  }
  function sizeCatalog(list) {
    var map = {};
    list.forEach(function (p) {
      summaryOf(p).rows.forEach(function (r) {
        var key = String(r.size);
        if (!map[key]) map[key] = { size: key, eu: r.eu || '', order: num(r.size, 0) };
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.order - b.order; });
  }

  function facetCounts() {
    var list = allProducts();
    function count(group, test) {
      var n = 0;
      list.forEach(function (p) { if (match(p, group) && test(p)) n++; });
      return n;
    }
    var catsList = uniq(list.map(function (p) { return p.cat; }).filter(Boolean));
    /* "Limited" is both a real category and the limited-edition tag — list it once */
    if (list.some(isLimited) && !catsList.some(function (c) { return slug(c) === 'limited'; })) catsList.push('Limited');
    var cats = catsList.map(function (c) { return { value: c, n: count('cat', function (p) { return catMatches(p, c); }) }; })
      .sort(function (a, b) { return b.n - a.n || String(a.value).localeCompare(String(b.value)); });

    var colors = colourCatalog(list).map(function (c) {
      return { value: c.id, name: c.name, swatch: c.swatch, n: count('color', function (p) { return colorsMatch(p, c.id); }) };
    }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });

    var sizes = sizeCatalog(list).map(function (s) {
      return { value: s.size, eu: s.eu, n: count('size', function (p) { return sizeMatches(p, s.size); }) };
    });

    var avail = ['in', 'low', 'out'].map(function (k) { return { value: k, n: count('avail', function (p) { return availMatches(p, k); }) }; });

    var ratings = RATING_STEPS.map(function (r) { return { value: r, n: count('rating', function (p) { return ratingOf(p) >= r; }) }; });

    var offers = {
      sale: count('sale', isSale),
      featured: count('featured', isFeatured)
    };

    var priceLoN = bounds.min, priceHiN = bounds.max, priceN = 0;
    if (priceActive()) {
      list.forEach(function (p) { if (match(p, 'price') && num(p.price) >= priceLo() && num(p.price) <= priceHi()) priceN++; });
    } else priceN = count('price', function () { return true; });

    return { cats: cats, colors: colors, sizes: sizes, avail: avail, ratings: ratings, offers: offers, priceN: priceN, priceBounds: { min: priceLoN, max: priceHiN } };
  }

  /* ------------------------------------------------------------------- URL */
  function parseURL() {
    var qs = String(location.search || '').replace(/^\?/, '');
    if (!qs) return;
    var p = new URLSearchParams(qs);
    function many(name) {
      var out = [];
      p.getAll(name).forEach(function (chunk) { String(chunk).split(',').forEach(function (v) { v = v.trim(); if (v) out.push(v); }); });
      return uniq(out);
    }
    if (p.has('q')) state.q = String(p.get('q') || '').slice(0, 80);
    if (p.has('search') && !state.q) state.q = String(p.get('search') || '').slice(0, 80);
    state.cats = many('category').concat(many('cat'));
    state.cats = uniq(state.cats);
    state.colors = many('color').concat(many('colour'));
    state.colors = uniq(state.colors);
    /* sizes may be written as US (9) or EU (42) — both are understood */
    state.sizes = many('size').map(euToUs).filter(Boolean);
    state.sizes = uniq(state.sizes);
    var lo = p.get('min'), hi = p.get('max');
    state.min = lo == null || lo === '' ? null : num(lo, null);
    state.max = hi == null || hi === '' ? null : num(hi, null);
    if (state.min != null && state.max != null && state.min > state.max) { var t = state.min; state.min = state.max; state.max = t; }
    state.avail = many('availability').map(function (v) {
      var k = slug(v);
      if (k === 'instock' || k === 'in') return 'in';
      if (k === 'lowstock' || k === 'low') return 'low';
      if (k === 'outofstock' || k === 'soldout' || k === 'out') return 'out';
      return '';
    }).filter(Boolean);
    state.avail = uniq(state.avail);
    var r = num(p.get('rating'), 0);
    state.rating = RATING_STEPS.indexOf(r) > -1 ? r : 0;
    state.sale = /^(1|true|yes|on|sale)$/i.test(String(p.get('sale') || '')) || slug(p.get('offers')) === 'sale';
    state.featured = /^(1|true|yes|on)$/i.test(String(p.get('featured') || ''));
    var s = slug(p.get('sort'));
    if (s === 'newest') s = 'new';
    if (s === 'popular') s = 'pop';
    if (s === 'new' || s === 'pop' || s === 'low' || s === 'high' || s === 'rate' || s === 'feat') state.sort = s;
  }

  /* the shop's own US→EU table, with a built-in copy for the moment before
     kinetic-app.js has finished loading */
  var EU_FALLBACK = { '7': '40', '7.5': '40.5', '8': '41', '8.5': '42', '9': '42.5', '9.5': '43', '10': '44', '10.5': '44.5', '11': '45', '12': '46' };
  function usToEu(size) {
    var a = app();
    if (a && a.sizeEu) { try { var eu = a.sizeEu(size); if (eu) return eu; } catch (e) {} }
    return EU_FALLBACK[String(size)] || '';
  }
  /* accepts "9" (US), "42" (EU) or "42.5"; always returns a US size string */
  function euToUs(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return '';
    if (usToEu(v)) return v;                       /* already a US size we sell */
    var a = app();
    var sizes = (a && a.sizes ? a.sizes() : Object.keys(EU_FALLBACK)) || [];
    var hit = '';
    sizes.forEach(function (us) { if (!hit && String(usToEu(us)) === v) hit = String(us); });
    if (!hit) {
      Object.keys(EU_FALLBACK).forEach(function (us) { if (!hit && EU_FALLBACK[us] === v) hit = us; });
    }
    return hit;
  }

  function queryString() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cats.length) p.set('category', state.cats.join(','));
    if (state.colors.length) p.set('color', state.colors.map(function (c) { return String(c).replace(/\s+/g, '-'); }).join(','));
    if (state.sizes.length) p.set('size', state.sizes.join(','));
    if (state.min != null) p.set('min', String(state.min));
    if (state.max != null) p.set('max', String(state.max));
    if (state.avail.length) p.set('availability', state.avail.join(','));
    if (state.rating) p.set('rating', String(state.rating));
    if (state.sale) p.set('sale', '1');
    if (state.featured) p.set('featured', '1');
    if (state.sort && state.sort !== 'feat') p.set('sort', state.sort);
    return p.toString();
  }
  var urlTimer = null;
  function writeURL(push) {
    if (!booted && !push) return;
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      var qs = queryString();
      var url = location.pathname + (qs ? '?' + qs : '') + (location.hash || '');
      try {
        var current = location.pathname + location.search + location.hash;
        if (current === url) return;
        if (push) history.pushState({ kflt: 1 }, '', url);
        else history.replaceState({ kflt: 1 }, '', url);
      } catch (e) {}
    }, push ? 260 : 120);
  }

  /* --------------------------------------------------------------- loading */
  var progressEl = null, renderTimer = null;
  function showLoading() {
    var grid = $('#productGrid');
    if (grid) grid.classList.add('kflt-busy');
    if (progressEl) progressEl.classList.add('on');
  }
  function hideLoading() {
    var grid = $('#productGrid');
    if (grid) grid.classList.remove('kflt-busy');
    if (progressEl) progressEl.classList.remove('on');
  }
  function animateGrid() {
    var grid = $('#productGrid');
    if (!grid || reduced()) return;
    grid.classList.remove('kflt-grid-anim');
    void grid.offsetWidth;
    grid.classList.add('kflt-grid-anim');
    setTimeout(function () { grid.classList.remove('kflt-grid-anim'); }, 600);
  }
  function renderGrid(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      var a = app();
      if (!a || !a.renderProducts) { hideLoading(); return; }
      try { a.renderProducts(); } catch (e) { if (window.console && console.warn) console.warn('[KINETIC filters] render failed:', e); }
      hideLoading();
      animateGrid();
    }, delay == null ? 120 : delay);
  }

  /* ------------------------------------------------------------- the chrome */
  function toolbarHTML() {
    return '' +
      '<div class="kflt-searchwrap" id="kfltSearchOuter">' +
      '<label class="kflt-search" id="kfltSearchWrap" for="kfltSearch">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<input id="kfltSearch" type="search" autocomplete="off" value="' + esc(state.q) + '" ' +
          'placeholder="Search name, SKU, category…" aria-label="Search the collection" ' +
          'role="combobox" aria-expanded="false" aria-controls="kfltSugBox" aria-autocomplete="list" aria-haspopup="listbox" />' +
        '<button type="button" class="kflt-clear" data-kflt="clear" data-facet="q" aria-label="Clear search">✕</button>' +
      '</label>' +
      '<div class="kflt-sugbox" id="kfltSugBox" role="listbox" aria-label="Search suggestions" hidden></div>' +
      '<span class="kflt-sr" role="status" aria-live="polite" id="kfltSugLive"></span>' +
      '</div>' +
      '<button type="button" class="kflt-btn kflt-filtersbtn" id="kfltFiltersBtn" data-kflt="filters" aria-expanded="true" aria-controls="kfltRail kfltDrawer">' +
        '<span class="kflt-mobile-only">Filters</span>' +
        '<span class="kflt-desktop-only kflt-rail-label">Hide filters</span>' +
        '<span class="kflt-count" id="kfltActiveCount" hidden>0</span>' +
      '</button>' +
      '<button type="button" class="kflt-btn ghost" data-kflt="copylink" title="Copy a link to this exact view">Copy link</button>' +
      '<button type="button" class="kflt-btn ghost" data-kflt="clearall" id="kfltClearAllBtn" hidden>Clear all</button>' +
      '<div class="kflt-progress" id="kfltProgress" aria-hidden="true"><i></i></div>' +
      '<span class="kflt-sr" role="status" aria-live="polite" id="kfltLive"></span>';
  }

  function statusHTML(shown, total, activeCount) {
    var msg;
    if (!total) msg = 'No products in the collection yet';
    else if (shown === total && !activeCount) msg = 'Showing all <b>' + total + '</b> product' + (total === 1 ? '' : 's');
    else msg = 'Showing <b>' + shown + '</b> of ' + total + ' product' + (total === 1 ? '' : 's');
    var right = activeCount
      ? '<span class="kflt-statusmsg"><span class="kflt-dot"></span>' + activeCount + ' filter' + (activeCount === 1 ? '' : 's') + ' on</span>'
      : '<span class="kflt-statusmsg">Sorted by <b>' + esc(SORT_LABEL[state.sort] || 'Featured') + '</b></span>';
    return '<div class="kflt-status" id="kfltStatus">' + msg + '<span aria-hidden="true">·</span>' + right + '</div>';
  }

  function chipsHTML() {
    var chips = activeChips();
    if (!chips.length) return '';
    return '<span class="kflt-chiplabel">Active</span>' + chips.map(function (c) {
      var dot = c.swatch ? '<span class="kflt-chipdot" style="background:' + esc(c.swatch) + '"></span>' : '';
      return '<button type="button" class="kflt-chip' + (c.swatch ? ' swatch' : '') + '" data-kflt="remove" data-facet="' + esc(c.facet) + '" data-value="' + esc(c.value == null ? '' : c.value) + '" ' +
        'aria-label="Remove filter: ' + esc(c.label) + '">' + dot + esc(c.label) + '<span class="kflt-chipx" aria-hidden="true">✕</span></button>';
    }).join('') + '<button type="button" class="kflt-clearall" data-kflt="clearall">Clear all</button>';
  }

  function activeChips() {
    var out = [];
    if (state.q) out.push({ facet: 'q', value: state.q, label: '“' + state.q + '”' });
    state.cats.forEach(function (c) { out.push({ facet: 'cat', value: c, label: c }); });
    state.colors.forEach(function (c) { var e = colourEntry(c); out.push({ facet: 'color', value: e.id, label: e.name, swatch: e.swatch }); });
    state.sizes.forEach(function (s) { var eu = usToEu(s); out.push({ facet: 'size', value: s, label: 'US ' + s + (eu ? ' · EU ' + eu : '') }); });
    if (priceActive()) out.push({ facet: 'price', label: money(priceLo()) + ' – ' + money(priceHi()) });
    state.avail.forEach(function (a) { out.push({ facet: 'avail', value: a, label: AVAIL_LABEL[a] || a }); });
    if (state.rating) out.push({ facet: 'rating', value: String(state.rating), label: state.rating + '+ rating' });
    if (state.sale) out.push({ facet: 'sale', label: 'On sale' });
    if (state.featured) out.push({ facet: 'featured', label: 'Featured' });
    return out;
  }

  function panelHTML(id, title, hint, body, openKey) {
    var open = openPanels[openKey || id] !== false;
    return '<section class="kflt-panel' + (open ? '' : ' closed') + '" data-panel="' + esc(id) + '">' +
      '<button type="button" class="kflt-panelhead" data-kflt="panel" data-panel="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span class="kflt-t">' + esc(title) + '</span>' +
        '<span class="kflt-n">' + (hint || '') + ' <span class="kflt-caret" aria-hidden="true">▾</span></span>' +
      '</button>' +
      '<div class="kflt-panelbody">' + body + '</div></section>';
  }

  function optHTML(facet, value, label, n, extra) {
    var on = isSelected(facet, value);
    var empty = n === 0 && !on;
    return '<button type="button" class="kflt-opt' + (empty ? ' is-empty' : '') + '" data-kflt="toggle" data-facet="' + esc(facet) + '" ' +
      'data-value="' + esc(String(value)) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (extra || '') + '>' +
      '<span class="kflt-box" aria-hidden="true">' + (on ? '✓' : '') + '</span>' +
      '<span class="kflt-lb">' + esc(label) + '</span>' +
      '<span class="kflt-num">' + n + '</span></button>';
  }
  function isSelected(facet, value) {
    var v = String(value);
    if (facet === 'cat') return state.cats.some(function (c) { return slug(c) === slug(v); });
    if (facet === 'color') return state.colors.some(function (c) { return slug(c) === slug(v); });
    if (facet === 'size') return state.sizes.some(function (c) { return String(c) === v; });
    if (facet === 'avail') return state.avail.indexOf(v) > -1;
    if (facet === 'rating') return String(state.rating) === v;
    if (facet === 'sale') return state.sale;
    if (facet === 'featured') return state.featured;
    return false;
  }

  function facetsHTML() {
    var f = facetCounts();
    var lo = priceLo(), hi = priceHi();
    var pMin = bounds.min, pMax = bounds.max;
    var loPct = pMax > pMin ? ((lo - pMin) / (pMax - pMin)) * 100 : 0;
    var hiPct = pMax > pMin ? ((hi - pMin) / (pMax - pMin)) * 100 : 100;

    var html = '';

    /* category */
    html += panelHTML('cat', 'Category', f.cats.length + ' types',
      f.cats.map(function (c) { return optHTML('cat', c.value, c.value, c.n); }).join('') || '<div class="kflt-swlabels">No categories yet</div>',
      'cat');

    /* price */
    html += panelHTML('price', 'Price', priceActive() ? 'filtered' : (money(pMin) + ' – ' + money(pMax)),
      '<div class="kflt-rangeval"><span id="kfltPriceLo">' + money(lo) + '</span><span class="kflt-sep">—</span><span id="kfltPriceHi">' + money(hi) + '</span></div>' +
      '<div class="kflt-dual">' +
        '<span class="kflt-track"></span>' +
        '<span class="kflt-fill" id="kfltPriceFill" style="left:' + loPct.toFixed(2) + '%;right:' + (100 - hiPct).toFixed(2) + '%"></span>' +
        '<input type="range" data-kflt="range" data-which="min" min="' + pMin + '" max="' + pMax + '" step="5" value="' + lo + '" aria-label="Minimum price" />' +
        '<input type="range" data-kflt="range" data-which="max" min="' + pMin + '" max="' + pMax + '" step="5" value="' + hi + '" aria-label="Maximum price" />' +
      '</div>' +
      '<div class="kflt-pricetags"><span>' + money(pMin) + '</span><span>' + money(pMax) + '</span></div>',
      'price');

    /* size */
    html += panelHTML('size', 'Size', 'US / EU',
      '<div class="kflt-sizes">' + (f.sizes.map(function (s) {
        var on = isSelected('size', s.value);
        return '<button type="button" class="kflt-size' + (s.n === 0 && !on ? ' is-empty' : '') + '" data-kflt="toggle" data-facet="size" ' +
          'data-value="' + esc(s.value) + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="US ' + esc(s.value) + (s.eu ? ', EU ' + esc(s.eu) : '') + '">' +
          'US ' + esc(s.value) + '<span>' + (s.eu ? 'EU ' + esc(s.eu) : '') + '</span></button>';
      }).join('') || '<div class="kflt-swlabels">No sizes yet</div>') + '</div>' +
      '<div class="kflt-swlabels">Only sizes that are in stock are shown.</div>',
      'size');

    /* colour */
    html += panelHTML('color', 'Colour', state.colors.length ? state.colors.length + ' picked' : f.colors.length + ' options',
      '<div class="kflt-swatches">' + (f.colors.map(function (c) {
        var on = isSelected('color', c.value);
        return '<button type="button" class="kflt-sw' + (c.n === 0 && !on ? ' is-empty' : '') + '" data-kflt="toggle" data-facet="color" ' +
          'data-value="' + esc(c.value) + '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + esc(c.name) + ' (' + c.n + ')">' +
          '<i style="background:' + esc(c.swatch) + '"></i><span class="kflt-swbox" aria-hidden="true">✓</span></button>';
      }).join('') || '<div class="kflt-swlabels">No colourways yet</div>') + '</div>' +
      '<div class="kflt-swlabels">' + (state.colors.length ? state.colors.map(function (c) { return esc(colourEntry(c).name); }).join(' · ') : 'Pick one or more') + '</div>',
      'color');

    /* availability */
    html += panelHTML('avail', 'Availability', state.avail.length ? state.avail.length + ' picked' : 'any',
      f.avail.map(function (a) { return optHTML('avail', a.value, AVAIL_LABEL[a.value] + ' — ' + AVAIL_HINT[a.value], a.n); }).join(''),
      'avail');

    /* rating */
    html += panelHTML('rating', 'Rating', state.rating ? state.rating + '+ only' : 'any',
      f.ratings.map(function (r) { return optHTML('rating', r.value, r.value.toFixed(1) + ' & up', r.n); }).join(''),
      'rating');

    /* offers */
    html += panelHTML('offers', 'Offers', (state.sale || state.featured) ? 'on' : 'any',
      optHTML('sale', '1', 'On sale', f.offers.sale) +
      optHTML('featured', '1', 'Featured', f.offers.featured),
      'offers');

    return html;
  }

  function emptyHTML() {
    var chips = activeChips();
    var sug = [];
    uniq(allProducts().map(function (p) { return p.cat; }).filter(Boolean)).slice(0, 3).forEach(function (c) { sug.push({ kflt: 'toggle', facet: 'cat', value: c, label: c }); });
    if (!state.sale) sug.push({ kflt: 'toggle', facet: 'sale', value: '1', label: 'On sale' });
    if (!state.featured) sug.push({ kflt: 'toggle', facet: 'featured', value: '1', label: 'Featured' });
    return '<div class="kflt-empty" role="status">' +
      '<div class="kflt-eh">No sneakers match…</div>' +
      '<p>Nothing in the collection fits ' + (chips.length > 1 ? 'all ' + chips.length + ' of these filters' : 'this filter') +
      (state.q ? ' together with “' + esc(state.q) + '”' : '') + '.</p>' +
      '<div class="kflt-eacts">' +
        '<button type="button" class="kflt-btn" data-kflt="clearall">Clear all filters</button>' +
        (state.sale || state.featured || state.avail.length ? '' : '<button type="button" class="kflt-btn ghost" data-kflt="clear" data-facet="size" hidden></button>') +
      '</div>' +
      '<div class="kflt-sugg"><span class="kflt-chiplabel">Try instead</span>' +
      sug.map(function (s) {
        return '<button type="button" class="kflt-tag" data-kflt="' + s.kflt + '" data-facet="' + esc(s.facet) + '" data-value="' + esc(s.value) + '">' + esc(s.label) + '</button>';
      }).join('') +
      '<button type="button" class="kflt-tag" data-kflt="clearall">Everything</button>' +
      '</div></div>';
  }

  function renderChrome(shown, total) {
    lastCounts = { shown: shown == null ? lastCounts.shown : shown, total: total == null ? lastCounts.total : total };
    var active = activeChips();
    var bar = $('#kfltBar');
    if (bar) {
      var wrap = $('#kfltSearchWrap', bar);
      var input = $('#kfltSearch', bar);
      if (wrap) wrap.classList.toggle('has-value', !!state.q);
      if (input && document.activeElement !== input && input.value !== state.q) input.value = state.q;
    }
    var chips = $('#kfltChips');
    if (chips) chips.innerHTML = chipsHTML();
    var status = $('#kfltStatusHost');
    if (status) status.innerHTML = statusHTML(lastCounts.shown, lastCounts.total, active.length);
    var badge = $('#kfltActiveCount');
    if (badge) { badge.hidden = !active.length; badge.textContent = String(active.length); }
    var clearAllBtn = $('#kfltClearAllBtn');
    if (clearAllBtn) clearAllBtn.hidden = !active.length;
    var fb = $('#kfltFiltersBtn');
    if (fb) fb.classList.toggle('is-on', !!active.length);
    var frow = $('#filterRow');
    if (frow) {
      var want = state.cats.length === 1 ? state.cats[0] : 'All';
      $$('.filter-btn', frow).forEach(function (b) {
        var on = String(b.getAttribute('data-filter')) === want;
        if (b.classList.contains('active') !== on) {
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
      });
    }
    var sortSel = $('#sortSelect');
    if (sortSel && sortSel.value !== state.sort) sortSel.value = state.sort;
    var sl = $('#sortLabel');
    if (sl) sl.textContent = 'Sorted by ' + (SORT_LABEL[state.sort] || 'Featured').toLowerCase();

    if (!dragging) {
      var rail = $('#kfltRail');
      if (rail) rail.innerHTML = facetsHTML();
      var dbody = $('#kfltDrawerBody');
      if (dbody) dbody.innerHTML = facetsHTML();
      var dcount = $('#kfltDrawerCount');
      if (dcount) dcount.innerHTML = lastCounts.shown + ' product' + (lastCounts.shown === 1 ? '' : 's') + ' match';
      var dapply = $('#kfltDrawerApply');
      if (dapply) dapply.textContent = 'Show ' + lastCounts.shown + ' result' + (lastCounts.shown === 1 ? '' : 's');
    }
    chromeDirty = false;
  }

  /* the count comes from the grid the app just painted */
  function afterRender(count, total) {
    var grid = $('#productGrid');
    if (grid && count === 0 && total > 0) {
      grid.innerHTML = emptyHTML();                 /* our own no-results state, in the site's language */
    }
    var rc = $('#resultCount');
    if (rc) rc.textContent = (count === total || !total) ? (count + (count === 1 ? ' Product' : ' Products'))
      : (count + ' / ' + total + ' Products');
    var live = $('#kfltLive');
    if (live) {
      var nf = activeChips().length;
      live.textContent = count
        ? (count + (count === 1 ? ' product' : ' products') + ' match' + (nf ? ' ' + nf + (nf === 1 ? ' filter' : ' filters') : ''))
        : 'No products match — adjust or clear the filters.';
    }
    renderChrome(count, total);
    var a = app();
    if (a && a.syncFilterButtons) {
      var quick = state.cats.length === 1 ? state.cats[0] : 'All';
      try { a.syncFilterButtons(quick); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------ grid refresh */
  function refresh(opts) {
    opts = opts || {};
    if (!app()) return;
    showLoading();
    renderChrome();
    writeURL(opts.push !== false);
    renderGrid(opts.delay);
  }

  function syncInputs() {
    /* keep both copies of the price handles in step when not dragging */
    if (dragging) return;
    $$('[data-kflt="range"]').forEach(function (r) {
      var which = r.getAttribute('data-which');
      r.value = which === 'min' ? priceLo() : priceHi();
    });
    var fill = $('#kfltPriceFill');
    if (fill) {
      var pMin = bounds.min, pMax = bounds.max;
      var loPct = pMax > pMin ? ((priceLo() - pMin) / (pMax - pMin)) * 100 : 0;
      var hiPct = pMax > pMin ? ((priceHi() - pMin) / (pMax - pMin)) * 100 : 100;
      fill.style.left = loPct.toFixed(2) + '%';
      fill.style.right = (100 - hiPct).toFixed(2) + '%';
    }
    var loLbl = $('#kfltPriceLo'), hiLbl = $('#kfltPriceHi');
    if (loLbl) loLbl.textContent = money(priceLo());
    if (hiLbl) hiLbl.textContent = money(priceHi());
  }

  /* --------------------------------------------------------------- mutators */
  function setFacet(facet, value, mode) {
    var v = String(value);
    if (facet === 'q') {
      state.q = mode === 'off' ? '' : v;
      var input = $('#kfltSearch');
      if (input && input.value !== state.q) input.value = state.q;
    } else if (facet === 'cat') {
      if (slug(v) === 'all') state.cats = [];
      else toggleIn(state.cats, v, mode, slug);
    } else if (facet === 'color') {
      toggleIn(state.colors, v, mode, slug);
    } else if (facet === 'size') {
      toggleIn(state.sizes, v, mode, String);
    } else if (facet === 'avail') {
      toggleIn(state.avail, v, mode, String);
    } else if (facet === 'rating') {
      var r = num(v, 0);
      state.rating = (mode === 'off' || state.rating === r) ? 0 : r;
    } else if (facet === 'sale') {
      state.sale = mode === 'off' ? false : !state.sale;
    } else if (facet === 'featured') {
      state.featured = mode === 'off' ? false : !state.featured;
    } else if (facet === 'price') {
      state.min = null; state.max = null; syncInputs();
    }
  }
  function toggleIn(arr, value, mode, keyOf) {
    var k = keyOf(value);
    var idx = -1;
    arr.forEach(function (v, i) { if (keyOf(v) === k) idx = i; });
    if (mode === 'off') { if (idx > -1) arr.splice(idx, 1); return; }
    if (mode === 'on') { if (idx === -1) arr.push(value); return; }
    if (idx > -1) arr.splice(idx, 1); else arr.push(value);
  }
  function clearAll() {
    sugClose();
    state.q = ''; state.cats = []; state.colors = []; state.sizes = [];
    state.min = null; state.max = null; state.avail = []; state.rating = 0;
    state.sale = false; state.featured = false;
    var input = $('#kfltSearch'); if (input) input.value = '';
    syncInputs();
  }
  function setSort(value) {
    var s = slug(value);
    if (s === 'newest') s = 'new';
    if (s === 'popular') s = 'pop';
    if (['feat', 'new', 'pop', 'low', 'high', 'rate'].indexOf(s) === -1) return false;
    state.sort = s;
    return true;
  }

  /* ------------------------------------------------------------ drawer + UI */
  function buildShell() {
    var bar = $('#kfltBar');
    if (bar) bar.innerHTML = toolbarHTML() + '<div id="kfltStatusHost"></div><div class="kflt-chips" id="kfltChips" aria-label="Active filters"></div>';

    if (!$('#kfltDrawer')) {
      var wrap = document.createElement('div');
      wrap.innerHTML =
        '<div class="kflt-scrim" id="kfltScrim" hidden></div>' +
        '<aside class="kflt-drawer" id="kfltDrawer" role="dialog" aria-modal="true" aria-label="Filter products" aria-hidden="true" inert>' +
          '<div class="kflt-dhead"><div><div class="kflt-k">KINETIC / collection</div><h2>Filters</h2></div>' +
            '<button type="button" class="kflt-dclose" data-kflt="drawer-close" aria-label="Close filters">✕</button></div>' +
          '<div class="kflt-dbody" id="kfltDrawerBody"></div>' +
          '<div class="kflt-dfoot"><button type="button" class="kflt-btn ghost" data-kflt="clearall">Clear all</button>' +
            '<button type="button" class="kflt-btn kflt-apply" id="kfltDrawerApply" data-kflt="drawer-close">Show results</button></div>' +
          '<span class="kflt-dcount" id="kfltDrawerCount">0 products match</span>' +
        '</aside>' +
        '<div class="kflt-toast" id="kfltToast" role="status"></div>';
      while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
      /* the scrim only exists from here on, so this is where it gets its listener */
      var scrim = $('#kfltScrim');
      if (scrim && !scrim.dataset.kfltBound) { scrim.dataset.kfltBound = '1'; scrim.addEventListener('click', drawerClose); }
      var dclose = $('#kfltDrawer .kflt-dclose');
      if (dclose && !dclose.dataset.kfltBound) { dclose.dataset.kfltBound = '1'; dclose.addEventListener('click', drawerClose); }
    }
    progressEl = $('#kfltProgress');
  }

  function drawerOpen() {
    var d = $('#kfltDrawer'), s = $('#kfltScrim');
    if (!d) return;
    d.classList.add('on');
    d.setAttribute('aria-hidden', 'false');
    if ('inert' in d) d.inert = false;
    if (s) { s.hidden = false; requestAnimationFrame(function () { s.classList.add('on'); }); }
    document.documentElement.style.overflow = 'hidden';
    drawerReturn = document.activeElement;
    var btn = $('#kfltFiltersBtn'); if (btn) btn.setAttribute('aria-expanded', 'true');
    setTimeout(function () { var f = d.querySelector('button,input'); if (f) try { f.focus(); } catch (e) {} }, 120);
  }
  var drawerReturn = null;
  function drawerClose() {
    var d = $('#kfltDrawer'), s = $('#kfltScrim');
    if (!d || !d.classList.contains('on')) return;
    d.classList.remove('on');
    d.setAttribute('aria-hidden', 'true');
    if ('inert' in d) d.inert = true;
    if (s) { s.classList.remove('on'); setTimeout(function () { if (!s.classList.contains('on')) s.hidden = true; }, 320); }
    document.documentElement.style.overflow = '';
    var btn = $('#kfltFiltersBtn'); if (btn) btn.setAttribute('aria-expanded', 'false');
    if (drawerReturn && document.contains(drawerReturn)) { try { drawerReturn.focus(); } catch (e) {} }
    drawerReturn = null;
  }
  function drawerVisible() { var d = $('#kfltDrawer'); return !!(d && d.classList.contains('on')); }

  function toast(msg) {
    var el = $('#kfltToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('on'); }, 2400);
  }

  function copyLink() {
    var url = location.href;
    function done() { toast('Link to this view copied'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      try {
        var t = document.createElement('textarea');
        t.value = url; t.setAttribute('readonly', 'readonly');
        t.style.position = 'fixed'; t.style.left = '-9999px';
        document.body.appendChild(t); t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
        done();
      } catch (e) { toast('Copy this page address to share the view'); }
    }
  }

  /* --------------------------------------------------------- recent searches */
  function recents() { var r = store(LS_RECENT, []); return Array.isArray(r) ? r.filter(function (v) { return typeof v === 'string' && v.trim(); }).slice(0, MAX_RECENT) : []; }
  function pushRecent(q) {
    q = String(q || '').trim();
    if (q.length < 2) return;
    var list = recents().filter(function (v) { return slug(v) !== slug(q); });
    list.unshift(q);
    storeSet(LS_RECENT, list.slice(0, MAX_RECENT));
  }
  function dropRecent(q) {
    storeSet(LS_RECENT, recents().filter(function (v) { return slug(v) !== slug(q); }));
  }

  /* ------------------------------------------------- the header search overlay */
  function renderSearchOverlay(rawQuery) {
    var box = $('#searchResults');
    if (!box) return;
    var q = String(rawQuery == null ? '' : rawQuery);
    var box2 = box;

    if (!q.trim()) {
      var rec = recents();
      var cats = uniq(allProducts().map(function (p) { return p.cat; }).filter(Boolean)).slice(0, 4);
      var html = '';
      if (rec.length) {
        html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Recent searches</span>' +
          '<button type="button" class="kflt-mini" data-kflt="recents-clear">Clear</button></div>' +
          '<div class="kflt-recents">' + rec.map(function (r) {
            return '<button type="button" class="kflt-recent" data-kflt="recent" data-value="' + esc(r) + '">' + esc(r) +
              '<span class="kflt-rx" data-kflt="recent-drop" data-value="' + esc(r) + '" role="button" tabindex="0" aria-label="Remove ' + esc(r) + ' from recent searches">✕</span></button>';
          }).join('') + '</div></div>';
      }
      var feat = sortList(allProducts().filter(function (p) { return isFeatured(p); })).slice(0, 3);
      html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Browse the collection</span>' +
        '<button type="button" class="kflt-mini" data-kflt="overlay-all">See everything</button></div>' +
        '<div class="kflt-tagrow">' +
        cats.map(function (c) { return '<button type="button" class="kflt-tag" data-kflt="overlay-cat" data-value="' + esc(c) + '"><span class="kflt-tagdot"></span>' + esc(c) + '</button>'; }).join('') +
        '<button type="button" class="kflt-tag" data-kflt="overlay-facet" data-facet="sale" data-value="1"><span class="kflt-tagdot"></span>On sale</button>' +
        '<button type="button" class="kflt-tag" data-kflt="overlay-facet" data-facet="featured" data-value="1"><span class="kflt-tagdot"></span>Featured</button>' +
        '</div></div>';
      if (feat.length) {
        html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Featured right now</span></div><div class="kflt-suglist">' +
          feat.map(function (p) { return sugHTML(p, ''); }).join('') + '</div></div>';
      }
      html += '<div class="kflt-note">Search by name, SKU (KNT-001), category or any keyword — or press Enter to filter the collection.</div>';
      box2.innerHTML = html;
      return;
    }

    var matches = allProducts().filter(function (p) { return matchesText(p, q); })
      .sort(function (a, b) { return scoreText(b, q) - scoreText(a, q) || tagWeight(b) - tagWeight(a); });
    var top = matches.slice(0, 5);
    var cats2 = uniq(allProducts().filter(function (p) { return matchesText(p, q); }).map(function (p) { return p.cat; }).filter(Boolean));
    var kw = [];
    if (/sale|deal|discount|offer/i.test(q)) kw.push({ facet: 'sale', value: '1', label: 'On sale' });
    if (/new|latest/i.test(q)) kw.push({ facet: 'sort', value: 'new', label: 'Newest first' });
    if (/popular|best|top/i.test(q)) kw.push({ facet: 'sort', value: 'pop', label: 'Most popular' });
    if (/under|below|cheap|budget/i.test(q)) kw.push({ facet: 'price-under', value: '200', label: 'Under $200' });

    var out = '';
    if (top.length) {
      out += '<div class="kflt-sec"><div class="kflt-sechead"><span>' + matches.length + ' match' + (matches.length === 1 ? '' : 'es') + '</span>' +
        '<button type="button" class="kflt-mini" data-kflt="overlay-apply" data-value="' + esc(q) + '">View in collection →</button></div>' +
        '<div class="kflt-suglist">' + top.map(function (p) { return sugHTML(p, q); }).join('') + '</div></div>';
      if (matches.length > top.length) {
        out += '<div class="kflt-note">' + (matches.length - top.length) + ' more match — press Enter to see them all in the collection.</div>';
      }
    } else {
      var guess = nearestMatch(q);
      out += '<div class="kflt-nores"><div class="kflt-nrh">No matches</div>' +
        '<p>Nothing in the archive matches <span class="kflt-nrq">“' + esc(q) + '”</span>.' +
        (guess ? '<br>Did you mean <span class="kflt-nrq">' + esc(guess.name) + '</span>?' : '') + '</p></div>';
      var sug2 = [];
      if (guess) sug2.push({ kflt: 'overlay-apply', value: guess.name, label: guess.name });
      cats2.slice(0, 3).forEach(function (c) { sug2.push({ kflt: 'overlay-cat', value: c, label: c }); });
      sug2.push({ kflt: 'overlay-facet', facet: 'sale', value: '1', label: 'On sale' });
      sug2.push({ kflt: 'overlay-facet', facet: 'featured', value: '1', label: 'Featured' });
      out += '<div class="kflt-sec"><div class="kflt-sechead"><span>Try instead</span></div><div class="kflt-tagrow">' +
        sug2.map(function (s) {
          return '<button type="button" class="kflt-tag" data-kflt="' + s.kflt + '"' +
            (s.facet ? ' data-facet="' + esc(s.facet) + '"' : '') + ' data-value="' + esc(s.value) + '">' + esc(s.label) + '</button>';
        }).join('') + '</div></div>';
    }
    if (cats2.length > 1) {
      out += '<div class="kflt-sec"><div class="kflt-sechead"><span>Filter by category</span></div><div class="kflt-tagrow">' +
        cats2.map(function (c) { return '<button type="button" class="kflt-tag" data-kflt="overlay-cat" data-value="' + esc(c) + '"><span class="kflt-tagdot"></span>' + esc(c) + '</button>'; }).join('') +
        '</div></div>';
    }
    if (kw.length) {
      out += '<div class="kflt-sec"><div class="kflt-sechead"><span>Shortcuts</span></div><div class="kflt-tagrow">' +
        kw.map(function (s) { return '<button type="button" class="kflt-tag" data-kflt="' + (s.facet === 'sort' ? 'overlay-sort' : (s.facet === 'price-under' ? 'overlay-price' : 'overlay-facet')) + '" data-facet="' + esc(s.facet) + '" data-value="' + esc(s.value) + '">' + esc(s.label) + '</button>'; }).join('') +
        '</div></div>';
    }
    out += '<div class="kflt-note">Press <b>Enter</b> to filter the collection with this search · Esc to close</div>';
    box2.innerHTML = out;
  }

  function sugHTML(p, q) {
    var price = '<span class="kflt-sugprice">' + (isSale(p) ? '<s>' + money(p.old) + '</s>' : '') + money(p.price) + '</span>';
    var rate = ratingOf(p) ? ' · <b>★ ' + ratingOf(p).toFixed(1) + '</b>' : '';
    return '<button type="button" class="kflt-sug" data-kflt="overlay-open" data-id="' + esc(p.id) + '">' +
      '<span class="kflt-sugimg"><img src="' + esc(p.img) + '" alt="" loading="lazy" decoding="async" width="1100" height="733" /></span>' +
      '<span class="kflt-sugmeta"><span class="kflt-sugname">' + highlight(p.name, q) + '</span>' +
      '<span class="kflt-sugsub">' + esc(skuOf(p)) + ' · ' + esc(p.cat) + (isFeatured(p) ? ' · featured' : '') + (isSale(p) ? ' · on sale' : '') + rate + '</span></span>' +
      price + '<span class="kflt-suggo" aria-hidden="true">→</span></button>';
  }

  function nearestMatch(q) {
    var tk = tokensOf(q);
    if (!tk.length) return null;
    var best = null, bestScore = 0;
    allProducts().forEach(function (p) {
      var hay = textOf(p).hay, score = 0;
      tk.forEach(function (t) {
        if (hay.indexOf(t) > -1) { score += 2; return; }
        if (t.length > 3) {
          for (var i = 0; i < t.length - 2; i++) { if (hay.indexOf(t.substr(i, 3)) > -1) { score += 1; break; } }
        }
      });
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return bestScore >= 2 ? best : null;
  }

  function applySearchToCollection(q) {
    q = String(q || '').trim();
    pushRecent(q);
    state.q = q;
    var input = $('#kfltSearch');
    if (input) input.value = q;
    closeOverlay();
    var collection = $('#collection');
    if (collection) {
      try { collection.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } catch (e) { collection.scrollIntoView(); }
    }
    refresh();
  }
  function closeOverlay() {
    var btn = $('#searchClose');
    if (btn) { btn.click(); return; }
    var ov = $('#searchOverlay');
    if (ov) ov.classList.remove('show');
  }

  /* ------------------------------------- collection search suggestion engine */
  var SUG_LIMIT = 5;              /* product rows shown before "see all"  */
  var sugTimer = null, sugCloseTimer = null, sugSeq = 0, sugActive = -1, sugVisible = false;

  function sugBox() { return $('#kfltSugBox'); }
  function sugRows() { return $$('#kfltSugBox [data-sug]'); }
  function sugInput() { return $('#kfltSearch'); }

  function sugOpen() {
    var box = sugBox(), input = sugInput();
    if (!box || !input) return;
    if (!box.innerHTML.replace(/\s/g, '')) return;
    /* a queued "focus left the field" close must not fire over a fresh open */
    clearTimeout(sugCloseTimer);
    sugCloseTimer = null;
    /* never let the list run off the bottom of the screen */
    var r = input.getBoundingClientRect ? input.getBoundingClientRect() : null;
    if (r && r.bottom) {
      var room = window.innerHeight - r.bottom - 18;
      box.style.maxHeight = Math.max(220, Math.min(room, window.innerHeight * 0.62, 540)) + 'px';
    }
    if (!sugVisible) {
      box.hidden = false;
      /* let the browser register the unhidden box before the transition runs */
      void box.offsetWidth;
      box.classList.add('on');
      sugVisible = true;
    }
    input.setAttribute('aria-expanded', 'true');
  }

  function sugClose() {
    var box = sugBox(), input = sugInput();
    if (box && sugVisible) {
      box.classList.remove('on');
      sugVisible = false;
      box.style.maxHeight = '';
      clearTimeout(box._h);
      box._h = setTimeout(function () { if (!box.classList.contains('on')) box.hidden = true; }, 240);
    }
    sugActive = -1;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }

  function sugMove(step) {
    var rows = sugRows();
    if (!rows.length) return;
    sugActive += step;
    if (sugActive < 0) sugActive = rows.length - 1;
    if (sugActive >= rows.length) sugActive = 0;
    rows.forEach(function (el, i) {
      var on = i === sugActive;
      el.classList.toggle('active', on);
      if (el.hasAttribute('role')) el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var el = rows[sugActive], input = sugInput();
    if (input && el.id) input.setAttribute('aria-activedescendant', el.id);
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }

  /* a product row that filters the collection (and offers a quick view) */
  function csSugHTML(p, q) {
    var price = '<span class="kflt-sugprice">' + (isSale(p) ? '<s>' + money(p.old) + '</s>' : '') + money(p.price) + '</span>';
    var rate = ratingOf(p) ? ' · <b>★ ' + ratingOf(p).toFixed(1) + '</b>' : '';
    return '<div class="kflt-sug cs-sug" data-kflt="cs-apply" data-sug data-value="' + esc(p.name) + '" ' +
      'role="option" aria-selected="false" tabindex="-1" title="Filter the collection by ' + esc(p.name) + '">' +
      '<span class="kflt-sugimg"><img src="' + esc(p.img) + '" alt="" loading="lazy" decoding="async" width="1100" height="733" /></span>' +
      '<span class="kflt-sugmeta"><span class="kflt-sugname">' + highlight(p.name, q) + '</span>' +
      '<span class="kflt-sugsub">' + esc(skuOf(p)) + ' · ' + esc(p.cat) + (isSale(p) ? ' · on sale' : '') + rate + '</span></span>' +
      price +
      '<span class="kflt-sugview" data-kflt="cs-open" data-id="' + esc(p.id) + '" role="button" tabindex="-1" ' +
        'aria-label="Quick view ' + esc(p.name) + '">↗</span></div>';
  }

  function csTag(action, value, label, facet) {
    return '<button type="button" class="kflt-tag" data-kflt="' + action + '" data-sug data-value="' + esc(value) + '"' +
      (facet ? ' data-facet="' + esc(facet) + '"' : '') + ' role="option" aria-selected="false">' +
      '<span class="kflt-tagdot"></span>' + esc(label) + '</button>';
  }

  /* shortcuts that only make sense for the words the shopper used */
  function keywordShortcuts(q) {
    var t = slug(q), out = [];
    if (/sale|deal|discount|offer|cheap/.test(t) && !state.sale) out.push(['cs-facet', '1', 'On sale', 'sale']);
    if (/new|latest|drop|fresh/.test(t)) out.push(['cs-sort', 'new', 'Newest first', '']);
    if (/popular|best|top|trend|bestseller/.test(t)) out.push(['cs-sort', 'pop', 'Most popular', '']);
    if (/rating|rated|review|star/.test(t)) out.push(['cs-sort', 'rate', 'Best rated', '']);
    if (/under|below|budget/.test(t)) out.push(['cs-price', '200', 'Under $200', '']);
    if (/featured|pick|editor/.test(t) && !state.featured) out.push(['cs-facet', '1', 'Featured', 'featured']);
    return out.slice(0, 4);
  }

  function renderSuggestions(rawQuery, keepIndex) {
    var box = sugBox(), input = sugInput();
    if (!box || !input) return;
    var q = String(rawQuery == null ? input.value : rawQuery);
    var seq = ++sugSeq;
    var list = allProducts();
    var html = '';

    if (!q.trim()) {
      /* ---------------------------------------------------------- idle state */
      var rec = recents();
      if (rec.length) {
        html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Recent searches</span>' +
          '<button type="button" class="kflt-mini" data-kflt="cs-recents-clear">Clear</button></div>' +
          '<div class="kflt-recents">' + rec.map(function (r) {
            return '<button type="button" class="kflt-recent" data-kflt="cs-recent" data-sug data-value="' + esc(r) + '" role="option" aria-selected="false">' + esc(r) +
              '<span class="kflt-rx" data-kflt="cs-recent-drop" data-value="' + esc(r) + '" role="button" tabindex="-1" aria-label="Remove ' + esc(r) + ' from recent searches">✕</span></button>';
          }).join('') + '</div></div>';
      }
      var cats = uniq(list.map(function (p) { return p.cat; }).filter(Boolean));
      html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Browse by category</span>' +
        '<button type="button" class="kflt-mini" data-kflt="cs-all">See everything</button></div><div class="kflt-tagrow">' +
        cats.map(function (c) { return csTag('cs-cat', c, c); }).join('') +
        (!state.sale ? csTag('cs-facet', '1', 'On sale', 'sale') : '') +
        (!state.featured ? csTag('cs-facet', '1', 'Featured', 'featured') : '') +
        '</div></div>';
      html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Popular searches</span></div><div class="kflt-tagrow">' +
        csTag('cs-apply', 'KNT-001', 'KNT-001') +
        csTag('cs-apply', 'carbon', 'carbon') +
        csTag('cs-apply', 'court', 'court') +
        csTag('cs-price', '200', 'Under $200') +
        csTag('cs-sort', 'rate', 'Best rated') +
        '</div></div>';
      var pop = sortList(list.filter(isFeatured)).slice(0, 3);
      if (!pop.length) pop = sortList(list).slice(0, 3);
      if (pop.length) {
        html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Popular right now</span>' +
          '<span class="kflt-mini kflt-plain">' + list.length + ' styles live</span></div>' +
          '<div class="kflt-suglist">' + pop.map(function (p) { return csSugHTML(p, ''); }).join('') + '</div></div>';
      }
      html += '<div class="kflt-note">Type a name, a SKU like <b>KNT-001</b>, a category or any keyword.</div>';
    } else {
      /* -------------------------------------------------------- typing state */
      var matches = list.filter(function (p) { return matchesText(p, q); })
        .sort(function (a, b) {
          return scoreText(b, q) - scoreText(a, q) || tagWeight(b) - tagWeight(a) || num(a.id) - num(b.id);
        });
      if (matches.length) {
        html += '<div class="kflt-sec"><div class="kflt-sechead"><span>' + matches.length + ' match' + (matches.length === 1 ? '' : 'es') + '</span>' +
          '<button type="button" class="kflt-mini" data-kflt="cs-apply" data-sug data-value="' + esc(q) + '" role="option" aria-selected="false">' +
          'Filter the collection →</button></div>' +
          '<div class="kflt-suglist">' + matches.slice(0, SUG_LIMIT).map(function (p) { return csSugHTML(p, q); }).join('') + '</div></div>';
        if (matches.length > SUG_LIMIT) {
          html += '<div class="kflt-note">' + (matches.length - SUG_LIMIT) + ' more match — press <b>Enter</b> to see every result.</div>';
        }
        var cats2 = uniq(matches.map(function (p) { return p.cat; }).filter(Boolean));
        if (cats2.length > 1) {
          html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Narrow by category</span></div><div class="kflt-tagrow">' +
            cats2.map(function (c) { return csTag('cs-cat', c, c); }).join('') + '</div></div>';
        }
        var kw = keywordShortcuts(q);
        if (kw.length) {
          html += '<div class="kflt-sec"><div class="kflt-sechead"><span>Shortcuts</span></div><div class="kflt-tagrow">' +
            kw.map(function (k) { return csTag(k[0], k[1], k[2], k[3]); }).join('') + '</div></div>';
        }
      } else {
        var guess = nearestMatch(q);
        html += '<div class="kflt-nores"><div class="kflt-nrh">No matches</div>' +
          '<p>Nothing in the collection matches <span class="kflt-nrq">“' + esc(q) + '”</span>.' +
          (guess ? '<br>Did you mean <span class="kflt-nrq">' + esc(guess.name) + '</span>?' : '') + '</p></div>' +
          '<div class="kflt-sec"><div class="kflt-sechead"><span>Try instead</span>' +
          '<button type="button" class="kflt-mini" data-kflt="cs-all">Clear the search</button></div><div class="kflt-tagrow">' +
          (guess ? csTag('cs-apply', guess.name, guess.name) : '') +
          cats2Fallback().map(function (c) { return csTag('cs-cat', c, c); }).join('') +
          '</div></div>';
      }
      html += '<div class="kflt-note"><b>↑ ↓</b> move · <b>Enter</b> filter the collection · <b>Esc</b> close</div>';
    }

    if (seq !== sugSeq) return;                 /* a newer keystroke already won */
    box.innerHTML = html;
    $$('#kfltSugBox [data-sug]').forEach(function (el, i) { if (!el.id) el.id = 'kfltSugRow' + i; });
    if (!keepIndex) sugActive = -1;
    sugOpen();
    var live = $('#kfltSugLive');
    if (live) {
      if (!q.trim()) live.textContent = 'Search suggestions — recents and categories.';
      else {
        var n = list.filter(function (p) { return matchesText(p, q); }).length;
        live.textContent = n ? n + ' suggestion' + (n === 1 ? '' : 's') + ' available.' : 'No matches for ' + q + '.';
      }
    }
  }

  function cats2Fallback() {
    return uniq(allProducts().map(function (p) { return p.cat; }).filter(Boolean)).slice(0, 3);
  }

  /* apply a search string to the collection (toolbar search box) */
  function csApply(q) {
    q = String(q == null ? '' : q).trim();
    if (!q) { sugClose(); return; }
    pushRecent(q);
    state.q = q;
    var input = sugInput();
    if (input) input.value = q;
    var wrap = $('#kfltSearchWrap');
    if (wrap) wrap.classList.add('has-value');
    sugClose();
    refresh();
  }

  /* rebuild the suggestion list for whatever is in the box right now */
  function sugSync() { renderSuggestions(sugInput() ? sugInput().value : ''); }

  /* --------------------------------------------------------------- handlers */
  function onFacetClick(target) {
    var action = target.getAttribute('data-kflt');
    var facet = target.getAttribute('data-facet');
    var value = target.getAttribute('data-value');
    var push = true;

    if (action === 'toggle') {
      if (facet === 'rating' && String(state.rating) === String(value)) state.rating = 0;
      else if (facet === 'sale' || facet === 'featured') setFacet(facet, value);
      else setFacet(facet, value);
    } else if (action === 'remove') {
      if (facet === 'price') setFacet('price', '', 'off');
      else setFacet(facet, value, 'off');
    } else if (action === 'clear') {
      setFacet(facet, '', 'off');
    } else if (action === 'clearall') {
      clearAll();
    } else if (action === 'panel') {
      var id = target.getAttribute('data-panel');
      var on = openPanels[id] !== false;
      openPanels[id] = !on;
      storeSet(LS_OPEN, openPanels);
      var panel = target.parentNode;
      if (panel) {
        panel.classList.toggle('closed', on);
        target.setAttribute('aria-expanded', on ? 'false' : 'true');
      }
      return;
    } else if (action === 'filters') {
      if (window.matchMedia && window.matchMedia('(min-width:1024px)').matches) {
        var layout = $('#kfltLayout');
        if (layout) {
          var off = layout.classList.toggle('kflt-rail-off');
          storeSet(LS_RAIL, off ? 'off' : 'on');
          target.setAttribute('aria-expanded', off ? 'false' : 'true');
          var lbl = target.querySelector('.kflt-rail-label');
          if (lbl) lbl.textContent = off ? 'Show filters' : 'Hide filters';
        }
      } else {
        drawerOpen();
      }
      return;
    } else if (action === 'drawer-open') {
      drawerOpen(); return;
    } else if (action === 'drawer-close') {
      drawerClose(); return;
    } else if (action === 'rail-toggle') {
      var layout = $('#kfltLayout');
      if (layout) {
        var off = layout.classList.toggle('kflt-rail-off');
        storeSet(LS_RAIL, off ? 'off' : 'on');
        target.classList.toggle('is-on', !off);
        target.setAttribute('aria-expanded', off ? 'false' : 'true');
        var lbl = target.querySelector('.kflt-rail-label');
        if (lbl) lbl.textContent = off ? 'Show filters' : 'Hide filters';
      }
      return;
    } else if (action === 'copylink') {
      copyLink(); return;
    } else if (action === 'overlay-open') {
      pushRecent($('#searchInput') ? $('#searchInput').value : '');
      closeOverlay();
      var a = app();
      if (a && a.openQuickView) { try { a.openQuickView(target.getAttribute('data-id')); } catch (e) {} }
      return;
    } else if (action === 'overlay-apply') {
      applySearchToCollection(value || ($('#searchInput') ? $('#searchInput').value : ''));
      return;
    } else if (action === 'cs-apply') {
      csApply(value && String(value).trim() ? value : (sugInput() ? sugInput().value : ''));
      return;
    } else if (action === 'cs-open') {
      var csq = sugInput() ? sugInput().value : '';
      if (csq.trim()) pushRecent(csq);
      sugClose();
      var csapp = app();
      if (csapp && csapp.openQuickView) { try { csapp.openQuickView(target.getAttribute('data-id')); } catch (e) {} }
      return;
    } else if (action === 'cs-recent') {
      csApply(value);
      return;
    } else if (action === 'cs-recent-drop') {
      dropRecent(value);
      sugSync();
      return;
    } else if (action === 'cs-recents-clear') {
      storeSet(LS_RECENT, []);
      sugSync();
      return;
    } else if (action === 'cs-cat') {
      state.q = '';
      var csi = sugInput(); if (csi) csi.value = '';
      var csw = $('#kfltSearchWrap'); if (csw) csw.classList.remove('has-value');
      setFacet('cat', value, 'on');
      pushRecent(value);
      sugClose();
      refresh();
      return;
    } else if (action === 'cs-facet') {
      setFacet(facet, value, 'on');
      sugClose();
      refresh();
      return;
    } else if (action === 'cs-sort') {
      setSort(value);
      sugClose();
      refresh();
      return;
    } else if (action === 'cs-price') {
      clearAll();
      state.max = num(value, 200);
      sugClose();
      refresh();
      return;
    } else if (action === 'cs-all') {
      clearAll();
      sugClose();
      refresh();
      return;
    } else if (action === 'overlay-all') {
      clearAll();
      applySearchToCollection('');
      return;
    } else if (action === 'overlay-cat') {
      clearAll();
      setFacet('cat', value, 'on');
      pushRecent(value);
      applySearchToCollection('');
      return;
    } else if (action === 'overlay-facet') {
      setFacet(facet, value, 'on');
      pushRecent(facet === 'sale' ? 'On sale' : 'Featured');
      applySearchToCollection('');
      return;
    } else if (action === 'overlay-sort') {
      setSort(value);
      applySearchToCollection('');
      return;
    } else if (action === 'overlay-price') {
      clearAll();
      state.max = num(value, 200);
      applySearchToCollection('');
      return;
    } else if (action === 'recent') {
      var q = value;
      var inp = $('#searchInput');
      if (inp) inp.value = q;
      applySearchToCollection(q);
      return;
    } else if (action === 'recent-drop') {
      dropRecent(value);
      renderSearchOverlay($('#searchInput') ? $('#searchInput').value : '');
      return;
    } else if (action === 'recents-clear') {
      storeSet(LS_RECENT, []);
      renderSearchOverlay($('#searchInput') ? $('#searchInput').value : '');
      return;
    } else {
      return;
    }
    refresh({ push: push });
  }

  function bind() {
    /* any click outside the search box puts the suggestion list away */
    document.addEventListener('click', function (e) {
      if (!sugVisible) return;
      var outer = $('#kfltSearchOuter');
      if (outer && e.target && outer.contains(e.target)) return;
      sugClose();
    }, true);

    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-kflt]') : null;
      if (!t) return;
      e.preventDefault();
      onFacetClick(t);
    }, false);

    /* price handles — live while dragging, committed on release */
    document.addEventListener('input', function (e) {
      var r = e.target;
      if (!r || !r.getAttribute || r.getAttribute('data-kflt') !== 'range') return;
      dragging = true;
      var which = r.getAttribute('data-which');
      var v = num(r.value, which === 'min' ? bounds.min : bounds.max);
      if (which === 'min') {
        state.min = v <= bounds.min ? null : Math.min(v, priceHi() - 5);
        if (state.min != null && v > priceHi() - 5) r.value = priceHi() - 5;
      } else {
        state.max = v >= bounds.max ? null : Math.max(v, priceLo() + 5);
        if (state.max != null && v < priceLo() + 5) r.value = priceLo() + 5;
      }
      syncInputs();
      renderChrome();
      writeURL(true);
      renderGrid(90);
    }, false);

    document.addEventListener('change', function (e) {
      var r = e.target;
      if (!r || !r.getAttribute || r.getAttribute('data-kflt') !== 'range') return;
      dragging = false;
      renderChrome();
      refresh();
    }, false);

    /* collection search box */
    var bar = $('#kfltBar');
    if (bar) {
      bar.addEventListener('input', function (e) {
        var input = e.target;
        if (!input || input.id !== 'kfltSearch') return;
        state.q = String(input.value || '').slice(0, 80);
        var wrap = $('#kfltSearchWrap');
        if (wrap) wrap.classList.toggle('has-value', !!state.q);
        clearTimeout(input._t);
        input._t = setTimeout(function () {
          writeURL(true);
          showLoading();
          renderChrome();
          renderGrid(40);
        }, 150);
        /* the suggestion list keeps up with the typing, a touch faster */
        clearTimeout(sugTimer);
        sugTimer = setTimeout(function () { renderSuggestions(input.value); }, 110);
      });
      /* clicking the box brings the list back even if the field is already focused */
      bar.addEventListener('click', function (e) {
        if (!e.target || e.target.id !== 'kfltSearch') return;
        if (sugVisible) return;
        clearTimeout(sugTimer);
        sugTimer = setTimeout(function () { renderSuggestions(e.target.value, true); }, 40);
      });
      /* the list is there the moment the shopper lands in the box */
      bar.addEventListener('focusin', function (e) {
        if (!e.target || e.target.id !== 'kfltSearch') return;
        clearTimeout(sugTimer); clearTimeout(sugCloseTimer);
        sugTimer = setTimeout(function () { renderSuggestions(e.target.value, true); }, 60);
      });
      bar.addEventListener('focusout', function (e) {
        if (!e.target || e.target.id !== 'kfltSearch') return;
        clearTimeout(sugCloseTimer);
        /* a click on the list never reaches here (mousedown is prevented), so blur means "left the field" */
        sugCloseTimer = setTimeout(sugClose, 200);
      });
      bar.addEventListener('keydown', function (e) {
        var input = e.target;
        if (!input || input.id !== 'kfltSearch') return;
        var open = sugVisible;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (!open) renderSuggestions(input.value); else sugMove(1);
          return;
        }
        if (e.key === 'ArrowUp') {
          if (!open) return;
          e.preventDefault();
          sugMove(-1);
          return;
        }
        if (e.key === 'Escape') {
          if (open) { e.preventDefault(); sugClose(); return; }   /* first Esc closes the list */
          if (state.q) {
            e.preventDefault();
            setFacet('q', '', 'off');
            var w = $('#kfltSearchWrap'); if (w) w.classList.remove('has-value');
            refresh();
          }
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (open && sugActive > -1) {
            var rows = sugRows();
            if (rows[sugActive]) { rows[sugActive].click(); return; }
          }
          sugClose();
          inputBlur(input);
          refresh();
        }
      });
    }
    function inputBlur(el) { try { el.blur(); } catch (e) {} }
    var sbox = $('#kfltSugBox');
    if (sbox && !sbox.dataset.kfltBound) {
      sbox.dataset.kfltBound = '1';
      /* mousedown on the list must not steal focus from the input */
      sbox.addEventListener('mousedown', function (ev) { ev.preventDefault(); }, false);
    }

    /* the shop's sort select */
    var sortSel = $('#sortSelect');
    if (sortSel) {
      sortSel.addEventListener('change', function () {
        if (!setSort(sortSel.value)) return;
        if (state.sort === slug(sortSel.value)) { /* the app may have handled it first */ }
        refresh();
      });
    }

    /* header search overlay */
    var searchInput = $('#searchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applySearchToCollection(searchInput.value);
        } else if (e.key === 'Escape') {
          closeOverlay();
        }
      });
    }
    var results = $('#searchResults');
    if (results) {
      results.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target && e.target.getAttribute && e.target.getAttribute('data-kflt') === 'recent-drop') {
          e.preventDefault();
          e.target.click();
        }
      });
    }

    /* browser back / forward */
    window.addEventListener('popstate', function () {
      resetState();
      parseURL();
      syncInputs();
      var input = $('#kfltSearch');
      if (input) input.value = state.q;
      refresh({ push: false });
    });

    /* Escape closes the drawer */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drawerVisible()) { e.preventDefault(); drawerClose(); }
    });

    /* keep the grid in step when the shop re-reads its content */
    document.addEventListener('kinetic:content-changed', function () { soldCache = null; summaryCache = new Map(); textCache = new Map(); });
    window.addEventListener('storage', function (e) { if (e.key === 'kinetic-orders-v1') soldCache = null; });
  }

  /* turn loose URL values ("running", "black") into the catalogue's own names */
  function canonicalise() {
    var list = allProducts();
    state.cats = uniq(state.cats.map(function (c) {
      var hit = '';
      list.forEach(function (p) { if (!hit && slug(p.cat) === slug(c)) hit = p.cat; });
      if (!hit && slug(c) === 'limited') hit = 'Limited';
      return hit || c;
    }));
    var palette = colourCatalog(list);
    state.colors = uniq(state.colors.map(function (c) {
      if (String(c).charAt(0) === '#') return c;
      var hit = '';
      palette.forEach(function (cc) {
        if (hit) return;
        var t = slug(c), tc = t.replace(/ /g, ''), nc = cc.id.replace(/ /g, '');
        if (nc === tc || nc.indexOf(tc) > -1 || (t && t.split(' ').every(function (w) { return nc.indexOf(w) > -1; }))) hit = cc.id;
      });
      return hit || slug(c);
    }));
    state.sizes = uniq(state.sizes.map(function (v) { return euToUs(v) || String(v); }));
  }

  function resetState() {
    state.q = ''; state.cats = []; state.colors = []; state.sizes = [];
    state.min = null; state.max = null; state.avail = []; state.rating = 0;
    state.sale = false; state.featured = false; state.sort = 'feat';
  }

  /* ------------------------------------------------------------------- boot */
  function bootUI() {
    if (booted) return;
    booted = true;
    summaryCache = new Map();
    soldCache = null;
    textCache = new Map();
    bounds = boundsOf(allProducts());
    buildShell();
    canonicalise();
    var layout = $('#kfltLayout');
    var railHidden = store(LS_RAIL, 'on') === 'off';
    if (layout && railHidden) layout.classList.add('kflt-rail-off');
    var fb = $('#kfltFiltersBtn');
    if (fb) {
      fb.setAttribute('aria-expanded', railHidden ? 'false' : 'true');
      var flbl = fb.querySelector('.kflt-rail-label');
      if (flbl) flbl.textContent = railHidden ? 'Show filters' : 'Hide filters';
    }
    var input = $('#kfltSearch');
    if (input && state.q) input.value = state.q;
    syncInputs();
    /* the first paint of the grid happens through the app — nudge it once the UI is in place */
    var a = app();
    if (a && a.renderProducts) {
      try { a.renderProducts(); } catch (e) {}
    }
    var sortSel = $('#sortSelect');
    if (sortSel) sortSel.value = state.sort;
    onAfterBoot();
  }

  function onAfterBoot() {
    var host = $('#kfltStatusHost');
    if (host && !lastCounts.total) {
      var total = allProducts().length;
      renderChrome(Math.min(total, total), total);
    }
  }

  var bootTimer = null, bootStart = Date.now();
  function waitForApp() {
    var ready = false;
    try { ready = !!(app() && app().products && app().products().length); } catch (e) { ready = false; }
    if (ready) { bootUI(); return; }
    if (Date.now() - bootStart > BOOT_TIMEOUT) { bootUI(); return; }
    bootTimer = setTimeout(waitForApp, 120);
  }

  /* --------------------------------------------------------------- expose */
  window.KINETIC_FILTERS = {
    version: VERSION,
    /* hooks used by kinetic-app.js */
    match: function (p) { return match(p); },
    sort: function (list) { return sortList(list); },
    afterRender: function (count, total) { afterRender(count, total); },
    setCategory: function (name) {
      /* the quick buttons replace the category set rather than blending into it */
      var n = String(name == null ? '' : name).trim();
      state.cats = (!n || slug(n) === 'all') ? [] : [n];
      refresh();
      return true;
    },
    setSort: function (v) { var ok = setSort(v); if (ok) refresh(); return ok; },
    renderSearchOverlay: renderSearchOverlay,
    /* collection search box: suggestion list */
    suggestions: function (q) { renderSuggestions(q == null ? (sugInput() ? sugInput().value : '') : q); },
    closeSuggestions: sugClose,
    suggestionsVisible: function () { return sugVisible; },

    /* handy for the admin console / debugging */
    state: state,
    results: resultsNow,
    url: function () { var qs = queryString(); return location.pathname + (qs ? '?' + qs : '') + (location.hash || ''); },
    clearAll: function () { clearAll(); refresh(); },
    refresh: function () { refresh(); },
    _internal: {
      match: match, sortList: sortList, facets: facetCounts, boundsOf: boundsOf,
      skuOf: skuOf, colorwaysOf: colorwaysOf, summaryOf: summaryOf, isSale: isSale,
      isLimited: isLimited, soldMap: soldMap, euToUs: euToUs, usToEu: usToEu,
      parseURL: parseURL, queryString: queryString, recents: recents, drawerOpen: drawerOpen,
      drawerClose: drawerClose, bootstrap: bootUI
    }
  };

  /* URL state is read immediately so the very first grid paint is already filtered */
  parseURL();
  state.sort = state.sort || 'feat';

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bind(); waitForApp(); });
  else { bind(); waitForApp(); }
})();
