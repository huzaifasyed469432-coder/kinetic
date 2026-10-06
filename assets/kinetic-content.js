/* KINETIC live-content loader (GitHub Pages edition).
 * Reads editable content from content.json stored in the GitHub repo,
 * merges it over built-in defaults, applies text overrides, then boots the app.
 * Fallback chain: GitHub API (fresh) -> raw.githubusercontent -> localStorage cache -> defaults. */
(function () {
  'use strict';

  var FETCH_TIMEOUT_MS = 4500;
  var HARD_DEADLINE_MS = 5200;
  var CACHE_KEY = 'kinetic-content-cache-v1';

  function deepCopy(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return {}; } }
  function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function gh() {
    var g = window.__GH__ || {};
    if (!g.owner || !g.repo || g.owner === 'OWNER_PLACEHOLDER') return null;
    return {
      owner: g.owner,
      repo: g.repo,
      branch: g.branch || 'main'
    };
  }
  function apiRawUrl(g) {
    return 'https://api.github.com/repos/' + g.owner + '/' + g.repo + '/contents/content.json?ref=' + encodeURIComponent(g.branch);
  }
  function rawUrl(g) {
    return 'https://raw.githubusercontent.com/' + g.owner + '/' + g.repo + '/' + encodeURIComponent(g.branch) + '/content.json';
  }

  function mergeContent(base, saved) {
    var out = deepCopy(base || {});
    if (!isPlainObject(saved)) return out;

    if (isPlainObject(saved.marketing)) {
      out.marketing = out.marketing || {};
      Object.keys(saved.marketing).forEach(function (k) {
        if (k === 'productReviewCounts' && isPlainObject(saved.marketing[k])) {
          out.marketing.productReviewCounts = out.marketing.productReviewCounts || {};
          Object.keys(saved.marketing[k]).forEach(function (rk) {
            var n = Number(saved.marketing[k][rk]);
            if (isFinite(n) && n >= 0) out.marketing.productReviewCounts[rk] = n;
          });
        } else {
          var num = Number(saved.marketing[k]);
          if (isFinite(num)) out.marketing[k] = num;
        }
      });
    }
    if (isPlainObject(saved.commerce)) {
      out.commerce = out.commerce || {};
      Object.keys(saved.commerce).forEach(function (k) {
        var v = saved.commerce[k];
        if (typeof v === 'string') { if (v.trim() !== '') out.commerce[k] = v; }
        else { var n = Number(v); if (isFinite(n)) out.commerce[k] = n; }
      });
    }
    if (Array.isArray(saved.products) && saved.products.length) {
      var baseById = {};
      (out.products || []).forEach(function (p) { baseById[String(p.id)] = p; });
      function blankProduct(id) {
        return {
          id: id, name: 'New Product', cat: 'Running', tag: 'New',
          price: 150, old: null, rating: 4.5, reviews: 0,
          img: 'assets/images/40a470397f3ef7b7.jpg', desc: '',
          colorways: [{ name: 'Midnight Black', swatch: '#08080A' }], colors: ['#08080A']
        };
      }
      out.products = saved.products.map(function (s) {
        var id = Number(s && s.id);
        if (!isFinite(id)) return null;
        var m = baseById[String(id)] ? deepCopy(baseById[String(id)]) : blankProduct(id);
        ['name', 'cat', 'tag', 'desc', 'img'].forEach(function (f) {
          if (s && typeof s[f] === 'string' && s[f].trim() !== '') m[f] = s[f].trim();
        });
        ['price', 'old', 'rating', 'reviews', 'editionSize'].forEach(function (f) {
          if (!s || !(f in s)) return;
          if (s[f] === null || s[f] === '') { if (f === 'old' || f === 'editionSize') m[f] = null; return; }
          var n = Number(s[f]);
          if (isFinite(n) && n >= 0) m[f] = n;
        });
        if (s && Array.isArray(s.colorways) && s.colorways.length) {
          var cw = s.colorways
            .filter(function (c) { return c && typeof c.swatch === 'string' && /^#[0-9a-f]{6}$/i.test(c.swatch); })
            .map(function (c) { return { name: String(c.name || '').trim(), swatch: c.swatch.toUpperCase() }; });
          if (cw.length) { m.colorways = cw; m.colors = cw.map(function (c) { return c.swatch; }); }
        }
        return m;
      }).filter(Boolean);
    }
    ['reviews', 'looks', 'techImgs'].forEach(function (key) {
      if (!Array.isArray(saved[key])) return;
      out[key] = saved[key].map(function (item, i) {
        var baseItem = (out[key] && out[key][i]) ? deepCopy(out[key][i]) : {};
        if (!isPlainObject(item)) return baseItem;
        Object.keys(item).forEach(function (f) {
          if (typeof item[f] === 'string' && item[f].trim() !== '') baseItem[f] = item[f];
        });
        return baseItem;
      });
    });
    if (isPlainObject(saved.texts)) {
      out.texts = out.texts || {};
      Object.keys(saved.texts).forEach(function (k) {
        if (typeof saved.texts[k] === 'string' && saved.texts[k].trim() !== '') out.texts[k] = saved.texts[k];
      });
    }
    return out;
  }

  var DECIMAL_KEYS = ['averageRating', 'plateDropMm', 'impactAbsorptionMultiplier'];
  function formatMarketingValue(marketing, key) {
    var value = marketing ? marketing[key] : undefined;
    if (value === undefined || value === null || !isFinite(Number(value))) return '';
    if (DECIMAL_KEYS.indexOf(key) !== -1) return Number(value).toFixed(1);
    return Number(value).toLocaleString('en-US');
  }
  function resolveTokens(str, marketing) {
    return String(str).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (match, key) {
      var v = formatMarketingValue(marketing, key);
      return v === '' ? match : v;
    });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function applyTextOverrides(content) {
    var texts = content.texts || {};
    var marketing = content.marketing || {};
    document.querySelectorAll('[data-edit]').forEach(function (el) {
      var key = el.getAttribute('data-edit');
      if (!key || !(key in texts)) return;
      var resolved = resolveTokens(texts[key], marketing);
      el.innerHTML = escapeHtml(resolved);
    });
    if (texts['site.title']) document.title = texts['site.title'];
  }

  /* ---- storage cache ---- */
  function cacheRead() {
    try { var c = localStorage.getItem(CACHE_KEY); return c ? JSON.parse(c) : null; } catch (e) { return null; }
  }
  function cacheWrite(obj) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  /* ---- fetch helpers ---- */
  function fetchJson(url, headers) {
    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { try { controller.abort(); } catch (e) {} }, FETCH_TIMEOUT_MS) : null;
    return fetch(url, { headers: headers || {}, signal: controller ? controller.signal : undefined, cache: 'no-store' })
      .then(function (res) {
        if (timer) window.clearTimeout(timer);
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .catch(function (e) { if (timer) window.clearTimeout(timer); throw e; });
  }

  function loadSaved() {
    var g = gh();
    if (!g) return Promise.resolve(null);
    // 1) GitHub API (fresh), 2) raw.githubusercontent (cached CDN), 3) localStorage
    return fetchJson(apiRawUrl(g), { 'Accept': 'application/vnd.github.raw+json' })
      .catch(function () { return fetchJson(rawUrl(g), { 'Accept': 'application/json' }); })
      .catch(function () { var c = cacheRead(); if (c) return c; throw new Error('no-source'); })
      .then(function (json) {
        if (isPlainObject(json)) { cacheWrite(json); return json; }
        return null;
      })
      .catch(function () { return cacheRead(); });
  }

  var domReady = false;
  var contentReady = false;
  var content = null;
  var booted = false;

  function boot() {
    if (booted) return;
    if (!domReady || !contentReady) return;
    booted = true;
    window.__KINETIC_CONTENT__ = content;
    try { applyTextOverrides(content); } catch (e) {}
    window.__kineticContentLoaded = true;
    injectScripts();
  }

  function injectScripts() {
    var app = document.createElement('script');
    app.src = 'assets/kinetic-app.js';
    app.onload = function () {
      var a11y = document.createElement('script');
      a11y.src = 'assets/kinetic-accessibility.js';
      document.body.appendChild(a11y);
    };
    app.onerror = function () {
      var a11y = document.createElement('script');
      a11y.src = 'assets/kinetic-accessibility.js';
      document.body.appendChild(a11y);
    };
    document.body.appendChild(app);
  }

  function finish(saved) {
    if (contentReady) return;
    contentReady = true;
    content = mergeContent(window.__KINETIC_DEFAULTS__ || {}, saved || {});
    boot();
  }

  var done = false;
  function settle(saved) { if (!done) { done = true; finish(saved); } }

  loadSaved().then(function (saved) { settle(saved || {}); }).catch(function () { settle({}); });
  // hard deadline: never hold the page
  window.setTimeout(function () { settle(cacheRead() || {}); }, HARD_DEADLINE_MS);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { domReady = true; boot(); }, { once: true });
  } else {
    domReady = true;
  }
})();
