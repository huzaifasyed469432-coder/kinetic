/* ============================================================================
   KINETIC® — Product detail page  (#product/<id>)
   ----------------------------------------------------------------------------
   A full page for every sneaker, built from the same data the rest of the store
   uses (content.json → KINETIC_APP.products()).
     * gallery with thumbnails, hover zoom and a full-screen viewer
     * size / colourway selection wired to real availability
     * exact quantity handed to the existing cart  → KINETIC_APP.addItem()
     * buy now → straight into the existing checkout
     * wishlist shared with the quick-view modal (kinetic-wishlist-v1)
     * specifications, shipping, returns, reviews, related + recently viewed
   ========================================================================= */
(function () {
  'use strict';

  var DETAIL_VIEWS = [
    { label: 'Toe detail', ox: '66%', oy: '74%', scale: 1.75 },
    { label: 'Heel detail', ox: '24%', oy: '58%', scale: 1.75 },
    { label: 'Upper texture', ox: '52%', oy: '24%', scale: 2.05 },
    { label: 'Sole profile', ox: '44%', oy: '88%', scale: 1.9 }
  ];
  var RECENT_KEY = 'kinetic-recently-viewed-v1';
  var REVIEW_KEY = 'kinetic-reviews-v1';
  var MAX_QTY = 9;

  var SIZE_EU_FALLBACK = { '7': '40', '7.5': '40.5', '8': '41', '8.5': '42', '9': '42.5', '9.5': '43', '10': '44', '10.5': '44.5', '11': '45', '12': '46' };
  /* a plain conversion chart for the size-guide panel (US → EU → UK → CM) */
  var SIZE_CHART = [
    ['7', '40', '6', '25.0'], ['7.5', '40.5', '6.5', '25.4'], ['8', '41', '7', '25.8'],
    ['8.5', '42', '7.5', '26.2'], ['9', '42.5', '8', '26.7'], ['9.5', '43', '8.5', '27.1'],
    ['10', '44', '9', '27.5'], ['10.5', '44.5', '9.5', '27.9'], ['11', '45', '10', '28.4'],
    ['12', '46', '11', '29.2']
  ];

  var state = {
    id: null,
    active: false,
    color: null,
    size: null,
    qty: 1,
    media: [],
    index: 0,
    lbIndex: 0,
    lbZoom: 1,
    lbX: 0,
    lbY: 0,
    savedScroll: 0,
    titleBefore: '',
    returning: null
  };

  /* ------------------------------------------------------------------ utils */
  function app() { return window.KINETIC_APP || null; }
  function checkout() { return window.KINETIC_CHECKOUT || null; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  /* mobile image variants (480w/900w in assets/images/m/) — browser falls back if absent */
function kpSrcset(url, sizes){
  var m=/^assets\/images\/([A-Za-z0-9._-]+)\.jpg$/i.exec(String(url||''));
  if(!m) return '';
  return ' srcset="assets/images/m/'+m[1]+'-480.jpg 480w, assets/images/m/'+m[1]+'-900.jpg 900w, '+url+' 1100w" sizes="'+sizes+'"';
}
function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function money(cents) { return '$' + (Math.max(0, Number(cents) || 0) / 100).toFixed(2); }
  function dollars(n) { var v = Number(n); return isFinite(v) && v >= 0 ? v : 0; }
  function money0(n) { return '$' + dollars(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function reduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function canHover() { try { return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches); } catch (e) { return false; } }
  /* Some desktop browsers (and headless ones) never report hover:hover, so the
     hover-zoom is enabled unless the device has actually fired a touch event. */
  var touchSeen = false;
  function hoverCapable() {
    if (touchSeen) return false;
    if (canHover()) return true;
    return !('ontouchstart' in window);
  }
  function readJSON(key, fallback) { try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; } }
  function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* restricted preview */ } }
  function toast(title, message, tone) { var a = app(); if (a && a.toast) { a.toast(title, message, tone); } }

  function findProduct(id) {
    var a = app();
    if (a && a.getProductById) { var p = a.getProductById(id); if (p) return p; }
    return null;
  }
  function products() {
    var a = app();
    if (a && a.products) return (a.products() || []).filter(function (p) { return p && String(p.id) !== 'undefined'; });
    return [];
  }
  function valid(p) {
    var a = app();
    if (a && a.isValidProduct) { try { return a.isValidProduct(p); } catch (e) { return false; } }
    return !!(p && p.name);
  }
  function stockFor(product, size) {
    var a = app();
    if (a && a.stockFor) return a.stockFor(product.id, size);
    return 10;
  }
  function colorwaysOf(product) {
    if (product.colorways && product.colorways.length) return product.colorways.slice();
    if (product.colors && product.colors.length) return product.colors.map(function (hex) { return { name: 'Colourway', swatch: hex }; });
    return [];
  }
  function safeHex(value) { return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value).toUpperCase() : '#D4AF37'; }

  function sizeCode(size) {
    var text = String(size == null ? '' : size).replace(/[^0-9.]/g, '');
    if (!text) return '000';
    if (text.indexOf('.') > -1) { var parts = text.split('.'); return (parts[0].length < 2 ? '0' + parts[0] : parts[0]) + parts[1].slice(0, 1); }
    return (text.length < 3 ? ('00' + text).slice(-3) : text);
  }
  function colorCode(name) {
    var words = String(name || '').toUpperCase().replace(/[^A-Z\s]/g, '').split(/\s+/).filter(Boolean);
    var code = words.map(function (w) { return w.charAt(0); }).join('').slice(0, 3);
    return code || 'STD';
  }
  function skuFor(product, size, colorway) {
    var id = String(Number(product.id) + 1);
    while (id.length < 3) id = '0' + id;
    return 'KNT-' + id + '-' + sizeCode(size) + '-' + colorCode(colorway && colorway.name);
  }

  function starsHTML(rating, size) {
    var value = Math.max(0, Math.min(5, Number(rating) || 0));
    var pct = (value / 5) * 100;
    return '<span class="kp-stars" aria-hidden="true">' +
      '<span class="kp-star-track' + (size === 'big' ? ' kp-star-big' : '') + '">★★★★★' +
      '<span class="kp-star-fill" style="width:' + pct.toFixed(1) + '%">★★★★★</span></span></span>';
  }

  /* ---------------------------------------------------------------- history */
  function readRecent() {
    var list = readJSON(RECENT_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.map(String).filter(function (id) { return !!findProduct(id); }).slice(0, 12);
  }
  function pushRecent(id) {
    var list = readRecent().filter(function (saved) { return String(saved) !== String(id); });
    list.unshift(String(id));
    writeJSON(RECENT_KEY, list.slice(0, 12));
  }

  /* ------------------------------------------------------------ local reviews */
  function localReviews(productId) {
    var all = readJSON(REVIEW_KEY, {});
    var mine = all && all[String(productId)];
    return Array.isArray(mine) ? mine : [];
  }
  /* Reviews that came from the store database (kinetic-api-bridge.js). They are
     shown alongside the customer's own device-local drafts, and they are the
     only ones the public sees. */
  function dbReviews(productId) {
    var all = window.__KINETIC_DB_REVIEWS__;
    var list = all && all[String(productId)];
    return Array.isArray(list) ? list : [];
  }
  function liveApi() { return window.KINETIC_API_MODE === 'live'; }
  function saveLocalReview(productId, review) {
    var all = readJSON(REVIEW_KEY, {});
    if (!all || typeof all !== 'object') all = {};
    var mine = Array.isArray(all[String(productId)]) ? all[String(productId)] : [];
    mine.unshift(review);
    all[String(productId)] = mine.slice(0, 20);
    writeJSON(REVIEW_KEY, all);
  }
  function removeLocalReview(productId, reviewId) {
    var all = readJSON(REVIEW_KEY, {});
    if (!all || !Array.isArray(all[String(productId)])) return;
    all[String(productId)] = all[String(productId)].filter(function (r) { return r && r.id !== reviewId; });
    writeJSON(REVIEW_KEY, all);
  }

  function ratingBreakdown(product) {
    var rating = Math.max(0, Math.min(5, Number(product.rating) || 0));
    var total = Math.max(0, parseInt(product.reviews, 10) || 0);
    var top = Math.max(0, Math.min(1, (rating - 3) / 2));
    var rest = 1 - top;
    var weights = [top, rest * 0.55, rest * 0.22, rest * 0.14, rest * 0.09];
    var counts = weights.map(function (w) { return Math.round(total * w); });
    var sum = counts.reduce(function (a, b) { return a + b; }, 0);
    if (total && sum !== total) counts[0] = Math.max(0, counts[0] + (total - sum));
    return counts;
  }

  /* ============================================================== media model */
  function buildMedia(product, uploads) {
    var items = [{ kind: 'image', url: product.img, label: 'Full view', crop: null, main: true }];
    (uploads || []).forEach(function (up) {
      var isVideo = up.type && String(up.type).indexOf('video/') === 0;
      items.push({ kind: isVideo ? 'video' : 'image', url: up.url, label: up.name || (isVideo ? 'Video' : 'Owner photo'), crop: null, uploaded: true });
    });
    DETAIL_VIEWS.forEach(function (view) { items.push({ kind: 'image', url: product.img, label: view.label, crop: view }); });
    return items;
  }

  /* ============================================================== rendering */
  function view() { return $('#productView'); }

  function loadingMarkup() {
    return '<div class="kp-wrap kp-top-pad">' +
      '<div class="kp-grid">' +
        '<div><div class="kp-skel" style="aspect-ratio:1/1;border:2px solid rgba(212,175,55,.2)"></div>' +
        '<div class="kp-thumbs">' + new Array(5).join().split(',').map(function () { return '<div class="kp-skel" style="width:78px;height:78px"></div>'; }).join('') + '</div></div>' +
        '<div><div class="kp-skel" style="height:14px;width:38%"></div>' +
        '<div class="kp-skel" style="height:52px;margin-top:16px"></div>' +
        '<div class="kp-skel" style="height:26px;width:52%;margin-top:20px"></div>' +
        '<div class="kp-skel" style="height:120px;margin-top:26px"></div>' +
        '<div class="kp-skel" style="height:54px;margin-top:18px"></div>' +
        '<div class="kp-skel" style="height:54px;margin-top:14px"></div></div>' +
      '</div></div>';
  }

  function notFoundMarkup(id) {
    return '<div class="kp-wrap kp-top-pad"><div class="kp-notice">' +
      '<h3>Product not found</h3>' +
      '<p>We could not find a sneaker with the reference <b>' + esc(id) + '</b>. It may have been renamed or removed from the collection.</p>' +
      '<button type="button" class="kp-btn kp-btn-solid" data-kp-close style="margin-top:20px">Back to the collection <span aria-hidden="true">→</span></button>' +
      '</div></div>';
  }

  function galleryMarkup(product) {
    return '<div class="kp-gallery">' +
      '<div class="kp-stage" id="kpStage" role="group" tabindex="0" aria-label="' + esc(product.name) + ' image gallery — use the arrow keys to move through views"></div>' +
      '<div class="kp-thumbs" id="kpThumbs" role="tablist" aria-label="Product images"></div>' +
    '</div>';
  }

  function buyMarkup(product) {
    var cw = colorwaysOf(product);
    var first = cw[0] || { name: 'Standard', swatch: '#D4AF37' };
    return '<div class="kp-buy">' +
      '<div class="kp-eyebrow"><span>' + esc(product.cat) + ' /// ' + esc(String(Number(product.id) + 1).padStart(3, '0')) + '</span>' +
      '<span class="kp-sku" id="kpSku"></span></div>' +
      '<h1 class="kp-title" id="kpTitle" tabindex="-1">' + esc(product.name) + '</h1>' +
      '<div class="kp-subline">' + starsHTML(product.rating) +
        '<button type="button" class="kp-rating-link" data-kp-goto="reviews">' + Number(product.rating).toFixed(1) + ' · ' + dollars(product.reviews).toLocaleString('en-US') + ' reviews</button>' +
        '<span class="kp-stock-chip in" id="kpStockChip" role="status" aria-live="polite"></span>' +
      '</div>' +
      '<div class="kp-price-row">' +
        '<span class="kp-price" id="kpPrice">' + money0(product.price) + '</span>' +
        (product.old ? '<span class="kp-price-old">' + money0(product.old) + '</span><span class="kp-save-pill">Save ' + Math.round((1 - dollars(product.price) / dollars(product.old)) * 100) + '%</span>' : '') +
      '</div>' +
      (product.desc ? '<p class="kp-desc">' + esc(product.desc) + '</p>' : '') +

      /* colourway */
      '<div class="kp-block">' +
        '<div class="kp-block-head"><span class="kp-label">Colourway · <b id="kpColorName">' + esc(first.name) + '</b></span>' +
        '<span class="kp-label" id="kpColorCount">' + cw.length + ' option' + (cw.length === 1 ? '' : 's') + '</span></div>' +
        '<div class="kp-colors" id="kpColors" role="group" aria-label="Choose a colourway"></div>' +
      '</div>' +

      /* size */
      '<div class="kp-block" id="kpSizeBlock">' +
        '<div class="kp-block-head"><span class="kp-label">Size · <b id="kpSizeLabel">US —</b></span>' +
        '<button type="button" class="kp-linkbtn" data-kp-sizeguide="1">Size guide</button></div>' +
        '<div class="kp-sizes" id="kpSizes" role="group" aria-label="Choose a US size"></div>' +
        '<div class="kp-size-note" id="kpSizeNote">Sold-out sizes are crossed out. Pick an available size to continue.</div>' +
      '</div>' +

      /* quantity */
      '<div class="kp-block">' +
        '<div class="kp-block-head"><span class="kp-label">Quantity</span><span class="kp-label" id="kpQtyHint"></span></div>' +
        '<div class="kp-qty-row">' +
          '<div class="kp-qty">' +
            '<button type="button" id="kpQtyMinus" aria-label="Decrease quantity">−</button>' +
            '<span class="kp-qty-val" id="kpQtyVal" aria-live="polite">1</span>' +
            '<button type="button" id="kpQtyPlus" aria-label="Increase quantity">+</button>' +
          '</div>' +
          '<span class="kp-line-total">Line total <b id="kpLineTotal"></b></span>' +
        '</div>' +
      '</div>' +

      /* calls to action */
      '<div class="kp-cta" id="kpCta">' +
        '<button type="button" class="kp-btn kp-btn-solid" id="kpAdd">Add to bag <span aria-hidden="true">→</span></button>' +
        '<button type="button" class="kp-btn kp-btn-dark" id="kpBuy">Buy now</button>' +
        '<button type="button" class="kp-wish" id="kpWish" aria-pressed="false"><span class="kp-heart" aria-hidden="true">♡</span><span id="kpWishLabel">Save to wishlist</span></button>' +
      '</div>' +
      '<div class="kp-msg" id="kpMsg" role="status" aria-live="polite"></div>' +

      /* trust */
      '<div class="kp-trust">' +
        '<div class="kp-trust-item">' + ICON_TRUCK +
          '<span><b>Free express shipping</b><span id="kpShipLine">On orders over …</span></span></div>' +
        '<div class="kp-trust-item">' + ICON_RETURN +
          '<span><b>30-day free returns</b><span>Unworn, in the original box — we pay the label.</span></span></div>' +
        '<div class="kp-trust-item">' + ICON_SHIELD +
          '<span><b>2-year KINETIC® warranty</b><span>Covers the plate, outsole and upper construction.</span></span></div>' +
        '<div class="kp-trust-item">' + ICON_AUTH +
          '<span><b>Authenticity guaranteed</b><span>Every pair is checked by hand before it ships.</span></span></div>' +
      '</div>' +
    '</div>';
  }

  var ICON_TRUCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.7" aria-hidden="true"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/></svg>';
  var ICON_RETURN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.7" aria-hidden="true"><path d="M4 12a8 8 0 1 1 3 6.2"/><path d="M4 18v-5h5"/></svg>';
  var ICON_SHIELD = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.7" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/></svg>';
  var ICON_AUTH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.6 12.3l2.2 2.2 4.6-5"/></svg>';

  function accordionMarkup(product, specs) {
    return '<div class="kp-sections">' +
      accordion('kpAccDesc', 'Description', 'open',
        '<p class="kp-copy-p">' + esc(product.desc || 'KINETIC® performance footwear.') + '</p>' +
        '<p class="kp-copy-p">Every KINETIC® pair is built around the same idea: remove everything that slows you down. ' +
        'The ' + esc(product.name) + ' sits in the ' + esc(String(product.cat).toLowerCase()) + ' line-up with the same ' +
        'dual-density VOLTFOAM™ platform, a sculpted heel counter and a high-contrast finish that reads from across the street.</p>' +
        '<p class="kp-copy-p">Wear it on the street, on the track or on the court — the fit is true to size and needs no break-in.</p>') +
      accordion('kpAccSpecs', 'Specifications', '',
        '<dl class="kp-specs">' + specs.map(function (row) {
          return '<div class="kp-spec"><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>';
        }).join('') + '</dl>' +
        '<p class="kp-copy-p" style="font-size:12px;color:rgba(245,240,234,.5);margin-top:12px">Heel-to-toe drop, weight and energy return are the shared KINETIC® platform figures for this range — the same across every style.</p>') +
      accordion('kpAccShip', 'Shipping & returns', '',
        '<div class="kp-info-grid">' +
          '<div class="kp-info-card"><h4>Shipping</h4><ul id="kpShipList"></ul></div>' +
          '<div class="kp-info-card"><h4>Returns & warranty</h4><ul>' +
            '<li>30 days to return unworn pairs — free return label included in every order.</li>' +
            '<li>Exchange for another size or colourway at no extra cost, once per order.</li>' +
            '<li>2-year KINETIC® warranty on the carbon plate, outsole and upper.</li>' +
            '<li>Refunds land back on the original payment method within 5–7 business days.</li>' +
          '</ul></div>' +
        '</div>' +
        '<div class="kp-note-inline" id="kpDuties"></div>') +
    '</div>';
  }
  function accordion(id, title, open, body) {
    return '<section class="kp-acc" id="' + id + '" data-open="' + (open === 'open' ? 'true' : 'false') + '">' +
      '<button type="button" class="kp-acc-head" aria-expanded="' + (open === 'open' ? 'true' : 'false') + '" aria-controls="' + id + 'Body">' +
        '<h2>' + esc(title) + '</h2><span class="kp-acc-ico" aria-hidden="true">+</span>' +
      '</button>' +
      '<div class="kp-acc-body" id="' + id + 'Body">' + body + '</div>' +
    '</section>';
  }

  function reviewsMarkup() {
    return '<section class="kp-wrap" id="kpReviews" style="margin-top:56px">' +
      '<div class="kp-strip-head"><div><span class="kp-label">Verified buyers</span><h2 class="kp-h2" style="margin-top:8px">Reviews</h2></div>' +
      '<button type="button" class="kp-btn kp-btn-ghost" style="padding:13px 20px;font-size:11px" data-kp-write="1">Write a review</button></div>' +
      '<div class="kp-rev-summary" id="kpRevSummary"></div>' +
      '<div class="kp-rev-list" id="kpRevList" aria-live="polite"></div>' +
      '<div id="kpRevFormHost"></div>' +
    '</section>';
  }

  function railsMarkup() {
    return '<section class="kp-wrap" id="kpRelated" style="margin-top:64px">' +
      '<div class="kp-strip-head"><div><span class="kp-label">Same energy</span><h2 class="kp-h2" style="margin-top:8px">You might also like</h2></div></div>' +
      '<div class="kp-rail" id="kpRelatedRail"></div></section>' +
      '<section class="kp-wrap" id="kpRecentSection" style="margin-top:56px;display:none">' +
      '<div class="kp-strip-head"><div><span class="kp-label">Your session</span><h2 class="kp-h2" style="margin-top:8px">Recently viewed</h2></div>' +
      '<button type="button" class="kp-linkbtn" data-kp-clear-recent="1">Clear</button></div>' +
      '<div class="kp-rail" id="kpRecentRail"></div></section>';
  }

  function stickyMarkup() {
    return '<div id="kpSticky" role="region" aria-label="Quick purchase">' +
      '<div class="kp-sticky-in">' +
        '<div class="kp-sticky-info">' +
          '<div class="kp-sticky-name" id="kpStickyName"></div>' +
          '<div class="kp-sticky-meta" id="kpStickyMeta"></div>' +
        '</div>' +
        '<div class="kp-sticky-price" id="kpStickyPrice"></div>' +
        '<button type="button" class="kp-btn kp-btn-solid" id="kpStickyAdd">Add to bag</button>' +
        '<button type="button" class="kp-btn kp-btn-dark kp-sticky-buy" id="kpStickyBuy">Buy now</button>' +
      '</div></div>';
  }

  /* ---------------------------------------------------------------- specs */
  function specsFor(product, colorway) {
    if (Array.isArray(product.specs) && product.specs.length) {
      return product.specs.map(function (row) {
        if (Array.isArray(row)) return [String(row[0]), String(row[1])];
        return [String((row && row.label) || ''), String((row && row.value) || '')];
      });
    }
    var config = (app() && app().config) || {};
    var marketing = config.marketing || {};
    var cat = String(product.cat || '').toLowerCase();
    var upper = { running: 'Engineered performance knit with welded overlays', lifestyle: 'Full-grain leather and matte knit panels', court: 'Tumbled leather with a reinforced toe box', limited: 'Reflective caged knit with a metallic film' }[cat] || 'Mixed knit and synthetic leather';
    var midsole = cat === 'lifestyle' ? 'Compression-moulded VOLTFOAM™ cushioning' : 'Dual-density VOLTFOAM™ with a full-length carbon plate';
    var outsole = { running: 'Abrasion-resistant blown rubber with a race-day rubber tip', lifestyle: 'Vulcanised gum rubber with a sculpted heel', court: 'Herringbone traction rubber for hard courts', limited: 'High-grip translucent rubber with a glow finish' }[cat] || 'Abrasion-resistant rubber';
    var drop = isFinite(Number(marketing.plateDropMm)) ? Number(marketing.plateDropMm).toFixed(1) + ' mm' : '8 mm';
    var weight = isFinite(Number(marketing.productWeightGrams)) ? Number(marketing.productWeightGrams) + ' g (US 9, single shoe)' : '≈ 280 g (US 9)';
    var energy = isFinite(Number(marketing.energyReturnPercent)) ? Number(marketing.energyReturnPercent) + '% energy return (lab tested)' : 'Lab-tuned energy return';
    var rows = [
      ['SKU', skuFor(product, state.size || '9', colorway)],
      ['Category', product.cat || 'Footwear'],
      ['Colourway', (colorway && colorway.name) || 'Standard'],
      ['Upper', upper],
      ['Midsole', midsole],
      ['Outsole', outsole],
      ['Heel-to-toe drop', drop],
      ['Weight', weight],
      ['Energy return', energy]
    ];
    if (product.editionSize) rows.push(['Edition', Number(product.editionSize).toLocaleString('en-US') + ' numbered pairs']);
    rows.push(['Available sizes', 'US 7 – US 12 (half sizes included)']);
    rows.push(['Care', 'Wipe with a damp cloth. Air dry away from direct heat.']);
    return rows;
  }

  /* ============================================================ interactions */
  function currentMedia() { return state.media[state.index] || state.media[0]; }

  function paintStage() {
    var stage = $('#kpStage');
    if (!stage) return;
    var item = currentMedia();
    if (!item) { stage.innerHTML = ''; return; }
    var inner;
    if (item.kind === 'video') {
      inner = '<video src="' + esc(item.url) + '" controls playsinline preload="metadata" aria-label="Product video"></video>';
    } else {
      var style = item.crop ? ' style="transform:scale(' + item.crop.scale + ');transform-origin:' + item.crop.ox + ' ' + item.crop.oy + '"' : '';
      inner = '<img src="' + esc(item.url) + '"' + kpSrcset(item.url, '(max-width:640px) 92vw, 46vw') + ' alt="' + esc(state.product ? state.product.name : 'Product') + ' — ' + esc(item.label) + '" decoding="async" data-kp-stage-img="1" width="1100" height="733"' + style + ' />';
    }
    stage.classList.toggle('kp-crop', !!(item.crop && item.kind === 'image'));
    stage.classList.toggle('kp-no-hover', !hoverCapable());
    stage.setAttribute('data-kp-media', String(state.index));
    stage.setAttribute('data-kp-view', item.label);
    stage.setAttribute('aria-label', (state.product ? state.product.name : 'Product') + ' — ' + item.label + ' (' + (state.index + 1) + ' of ' + state.media.length + ')');
    stage.innerHTML = inner +
      '<span class="kp-media-count">' + (state.index + 1) + ' / ' + state.media.length + '</span>' +
      '<span class="kp-viewtag">' + esc(item.label) + '</span>' +
      (item.kind === 'image' ? '<span class="kp-zoom-hint">' + (hoverCapable() ? 'Hover to zoom · click to expand' : 'Tap to expand') + '</span>' : '') +
      '<span class="kp-shine" aria-hidden="true"></span>' +
      '<button type="button" class="kp-nav prev" data-kp-step="-1" aria-label="Previous image"' + (state.media.length < 2 ? ' disabled' : '') + '>‹</button>' +
      '<button type="button" class="kp-nav next" data-kp-step="1" aria-label="Next image"' + (state.media.length < 2 ? ' disabled' : '') + '>›</button>' +
      '<div class="kp-badge-stack">' + badgeStack() + '</div>';
    $$('.kp-nav', stage).forEach(function (btn) {
      btn.addEventListener('click', function (event) { event.stopPropagation(); step(parseInt(btn.getAttribute('data-kp-step'), 10)); });
    });
    var img = $('[data-kp-stage-img]', stage);
    if (img) {
      img.addEventListener('load', function () { stage.classList.remove('is-loading'); });
      img.addEventListener('error', function () { img.style.opacity = '.25'; });
      stage.classList.remove('is-loading');
    }
  }

  /* attached once — the stage element itself survives every repaint */
  function wireStageOnce() {
    var stage = $('#kpStage');
    if (!stage || stage.dataset.kpWired === '1') return;
    stage.dataset.kpWired = '1';
    stage.addEventListener('click', function (event) {
      if (event.target.closest('.kp-nav')) return;
      if (state.tapGuard && Date.now() < state.tapGuard) return;
      var item = currentMedia();
      if (item && item.kind === 'image') openLightbox();
    });
    stage.addEventListener('mousemove', function (event) {
      if (!hoverCapable()) return;
      var item = currentMedia();
      if (!item || item.kind !== 'image') return;
      onStageMove(event);
    });
    stage.addEventListener('mouseleave', function () { if (hoverCapable()) onStageLeave(); });
    stage.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        var item = currentMedia();
        if (item && item.kind === 'image') { event.preventDefault(); openLightbox(); }
      }
    });
    /* one-finger swipe on phones / tablets */
    var tapX = 0, tapY = 0, moved = false;
    stage.addEventListener('touchstart', function (event) {
      if (event.touches.length !== 1) return;
      tapX = event.touches[0].clientX; tapY = event.touches[0].clientY; moved = false;
    }, { passive: true });
    stage.addEventListener('touchmove', function (event) {
      if (event.touches.length !== 1) return;
      var dx = event.touches[0].clientX - tapX, dy = event.touches[0].clientY - tapY;
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) moved = true;
    }, { passive: true });
    stage.addEventListener('touchend', function (event) {
      var touch = event.changedTouches[0];
      if (!touch) return;
      var dx = touch.clientX - tapX, dy = touch.clientY - tapY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        step(dx < 0 ? 1 : -1);
        paintThumbs();
        state.tapGuard = Date.now() + 600;   /* the click that follows must not open the viewer */
      } else if (moved) {
        state.tapGuard = Date.now() + 600;
      }
    }, { passive: true });
  }

  function badgeStack() {
    var product = state.product;
    if (!product) return '';
    var out = [];
    if (product.tag) out.push('<span class="kp-badge tag">' + esc(product.tag) + '</span>');
    if (product.old) out.push('<span class="kp-badge save">Save ' + Math.round((1 - dollars(product.price) / dollars(product.old)) * 100) + '%</span>');
    var live = sizeStock(state.size);
    if (state.size && live === 0) out.push('<span class="kp-badge save" style="background:#ff6b5e;color:#08080a;border-color:#ff6b5e">Sold out</span>');
    else if (state.size && live > 0 && live <= 2) out.push('<span class="kp-badge save">Only ' + live + ' left</span>');
    return out.join('');
  }

  function onStageMove(event) {
    var stage = $('#kpStage');
    var img = $('[data-kp-stage-img]', stage);
    if (!stage || !img) return;
    var rect = stage.getBoundingClientRect();
    var x = ((event.clientX - rect.left) / rect.width) * 100;
    var y = ((event.clientY - rect.top) / rect.height) * 100;
    var item = currentMedia();
    var base = item && item.crop ? item.crop.scale : 1;
    stage.classList.add('kp-zooming');
    img.style.transformOrigin = x.toFixed(2) + '% ' + y.toFixed(2) + '%';
    img.style.transform = 'scale(' + (base * 1.9).toFixed(3) + ')';
  }
  function onStageLeave() {
    var stage = $('#kpStage');
    var img = $('[data-kp-stage-img]', stage);
    if (!stage || !img) return;
    stage.classList.remove('kp-zooming');
    var item = currentMedia();
    var base = item && item.crop ? item.crop.scale : 1;
    img.style.transform = 'scale(' + base + ')';
    img.style.transformOrigin = item && item.crop ? (item.crop.ox + ' ' + item.crop.oy) : '50% 50%';
  }

  function paintThumbs() {
    var host = $('#kpThumbs');
    if (!host) return;
    host.innerHTML = state.media.map(function (item, index) {
      var current = index === state.index;
      var inside = item.kind === 'video'
        ? '<video src="' + esc(item.url) + '" muted preload="metadata" playsinline></video><span class="kp-play" aria-hidden="true">▶</span>'
        : '<img src="' + esc(item.url) + '"' + kpSrcset(item.url, '64px') + ' alt="" loading="lazy" decoding="async" width="120" height="120"' + (item.crop ? ' style="transform:scale(' + (item.crop.scale * 0.62) + ');transform-origin:' + item.crop.ox + ' ' + item.crop.oy + '"' : '') + ' />';
      return '<button type="button" class="kp-thumb" role="tab" aria-selected="' + current + '" aria-current="' + current + '" data-kp-index="' + index + '" aria-label="Show ' + esc(item.label) + '">' +
        inside + (item.crop ? '<span class="kp-cropmark">' + esc(item.label) + '</span>' : '') + '</button>';
    }).join('');
    $$('.kp-thumb', host).forEach(function (btn) {
      btn.addEventListener('click', function () { go(parseInt(btn.getAttribute('data-kp-index'), 10)); });
      btn.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        step(event.key === 'ArrowRight' ? 1 : -1);
      });
    });
  }

  function go(index) {
    if (index < 0 || index >= state.media.length || index === state.index) return;
    state.index = index;
    paintStage();
    paintThumbs();
    syncLightbox();
  }
  function step(direction) {
    if (state.media.length < 2) return;
    go((state.index + direction + state.media.length) % state.media.length);
  }

  /* ------------------------------------------------------------- lightbox */
  function lightboxMarkup() {
    return '<div class="kp-lb-bar">' +
        '<span class="kp-lb-title" id="kpLbTitle"></span>' +
        '<span class="kp-lb-count" id="kpLbCount"></span>' +
        '<div class="kp-lb-tools">' +
          '<button type="button" class="kp-lb-btn" data-kp-lb-zoom="-1" aria-label="Zoom out">−</button>' +
          '<button type="button" class="kp-lb-btn" data-kp-lb-reset="1" aria-label="Reset zoom">1:1</button>' +
          '<button type="button" class="kp-lb-btn" data-kp-lb-zoom="1" aria-label="Zoom in">+</button>' +
          '<button type="button" class="kp-lb-btn" data-kp-lb-close="1" aria-label="Close viewer">✕</button>' +
        '</div></div>' +
      '<div class="kp-lb-stage" id="kpLbStage"></div>' +
      '<div class="kp-lb-thumbs" id="kpLbThumbs"></div>';
  }
  function openLightbox(index) {
    var box = $('#kpLightbox');
    if (!box) return;
    if (typeof index === 'number') state.index = index;
    state.returnFocus = document.activeElement;
    state.lbZoom = 1; state.lbX = 0; state.lbY = 0;
    document.body.classList.add('kp-lightbox');
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
    syncLightbox();
    var close = $('[data-kp-lb-close]', box);
    if (close) close.focus();
  }
  function closeLightbox() {
    var box = $('#kpLightbox');
    if (!box) return;
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('kp-lightbox');
    var stage = $('#kpLbStage');
    if (stage) stage.innerHTML = '';
    var button = $('#kpStage');
    if (state.returnFocus && document.contains(state.returnFocus)) { try { state.returnFocus.focus(); } catch (e) {} }
  }
  function syncLightbox() {
    var box = $('#kpLightbox');
    if (!box || !box.classList.contains('open')) return;
    var item = currentMedia();
    var title = $('#kpLbTitle');
    if (title) title.textContent = (state.product ? state.product.name + ' · ' : '') + (item ? item.label : '');
    var count = $('#kpLbCount');
    if (count) count.textContent = (state.index + 1) + ' / ' + state.media.length;
    var stage = $('#kpLbStage');
    if (stage) {
      if (item && item.kind === 'video') {
        stage.innerHTML = '<video src="' + esc(item.url) + '" controls playsinline autoplay></video>';
      } else {
        var style = item && item.crop ? ' style="transform:scale(' + item.crop.scale + ');transform-origin:' + item.crop.ox + ' ' + item.crop.oy + '"' : '';
        stage.innerHTML = '<img src="' + esc(item ? item.url : '') + '" alt="' + esc(state.product ? state.product.name : '') + ' — ' + esc(item ? item.label : '') + '" data-kp-lb-img="1"' + style + ' draggable="false" />';
      }
      var img = $('[data-kp-lb-img]', stage);
      if (img) img.addEventListener('click', function () { toggleLbZoom(); });
      applyLbTransform();
    }
    var thumbs = $('#kpLbThumbs');
    if (thumbs) {
      thumbs.innerHTML = state.media.map(function (item2, index) {
        var current = index === state.index;
        var inside = item2.kind === 'video'
          ? '<video src="' + esc(item2.url) + '" muted preload="metadata" playsinline></video><span class="kp-play" aria-hidden="true">▶</span>'
          : '<img src="' + esc(item2.url) + '" alt="" loading="lazy" decoding="async"' + (item2.crop ? ' style="transform:scale(' + (item2.crop.scale * 0.62) + ');transform-origin:' + item2.crop.ox + ' ' + item2.crop.oy + '"' : '') + ' />';
        return '<button type="button" class="kp-thumb" aria-current="' + current + '" data-kp-lb-index="' + index + '" aria-label="Show ' + esc(item2.label) + '">' + inside + '</button>';
      }).join('');
      $$('[data-kp-lb-index]', thumbs).forEach(function (btn) {
        btn.addEventListener('click', function () { go(parseInt(btn.getAttribute('data-kp-lb-index'), 10)); paintThumbs(); });
      });
    }
  }
  function applyLbTransform() {
    var img = $('[data-kp-lb-img]');
    if (!img) return;
    var item = currentMedia();
    var base = item && item.crop ? item.crop.scale : 1;
    var origin = item && item.crop ? (item.crop.ox + ' ' + item.crop.oy) : '50% 50%';
    img.style.transformOrigin = origin;
    img.style.transform = 'translate(' + state.lbX + 'px,' + state.lbY + 'px) scale(' + (base * state.lbZoom).toFixed(3) + ')';
    var stage = $('#kpLbStage');
    if (stage) {
      stage.classList.toggle('zoomed', state.lbZoom > 1);
      stage.style.cursor = state.lbZoom > 1 ? 'grab' : 'zoom-in';
    }
  }
  function setLbZoom(next) {
    state.lbZoom = Math.max(1, Math.min(4, next));
    if (state.lbZoom === 1) { state.lbX = 0; state.lbY = 0; }
    applyLbTransform();
  }
  function toggleLbZoom() {
    if (state.lbZoom > 1) setLbZoom(1);
    else setLbZoom(2);
  }

  /* ------------------------------------------------------------ selection UI */
  function sizeStock(size) {
    if (!state.product) return 0;
    if (!size) return 0;
    return stockFor(state.product, size);
  }

  function paintColors() {
    var host = $('#kpColors');
    if (!host || !state.product) return;
    var list = colorwaysOf(state.product);
    if (!list.length) list = [{ name: 'Standard', swatch: '#D4AF37' }];
    host.innerHTML = list.map(function (way) {
      var hex = safeHex(way.swatch);
      var current = state.color && hex.toUpperCase() === String(state.color).toUpperCase();
      return '<button type="button" class="kp-color" data-kp-color="' + esc(hex) + '" data-kp-color-name="' + esc(way.name) + '" aria-pressed="' + current + '" aria-label="Colourway ' + esc(way.name) + '" title="' + esc(way.name) + '">' +
        '<span class="sw" style="background:' + esc(hex) + ';box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)"></span></button>';
    }).join('');
    var name = colorwayName(state.color);
    var nameEl = $('#kpColorName');
    if (nameEl) nameEl.textContent = name;
    $$('[data-kp-color]', host).forEach(function (btn) {
      btn.addEventListener('click', function () { selectColor(btn.getAttribute('data-kp-color')); });
    });
  }
  function colorwayName(hex) {
    if (!hex) return '—';
    var list = colorwaysOf(state.product || {});
    for (var i = 0; i < list.length; i++) if (safeHex(list[i].swatch).toUpperCase() === String(hex).toUpperCase()) return list[i].name;
    return 'Standard';
  }
  function currentColorway() {
    var list = colorwaysOf(state.product || {});
    for (var i = 0; i < list.length; i++) if (safeHex(list[i].swatch).toUpperCase() === String(state.color || '').toUpperCase()) return { name: list[i].name, hex: safeHex(list[i].swatch) };
    return list.length ? { name: list[0].name, hex: safeHex(list[0].swatch) } : null;
  }

  function paintSizes() {
    var host = $('#kpSizes');
    if (!host || !state.product) return;
    var a = app();
    var product = state.product;
    var sizes = (Array.isArray(product.sizes) && product.sizes.length)
      ? product.sizes.map(String)
      : ((a && a.sizes) ? a.sizes() : Object.keys(SIZE_EU_FALLBACK));
    host.innerHTML = sizes.map(function (size) {
      var stock = stockFor(product, size);
      var current = String(state.size) === String(size);
      var eu = (a && a.sizeEu) ? a.sizeEu(size) : (SIZE_EU_FALLBACK[size] || '');
      return '<button type="button" class="kp-size' + (stock <= 0 ? ' kp-size-off' : '') + '" data-kp-size="' + esc(size) + '" aria-pressed="' + current + '"' +
        (stock <= 0 ? ' aria-disabled="true"' : '') +
        ' aria-label="US ' + esc(size) + (stock <= 0 ? ' — sold out' : ', ' + stock + ' in stock') + '">' +
        'US ' + esc(size) + '<small>' + (stock <= 0 ? 'Sold out' : 'EU ' + esc(eu)) + '</small></button>';
    }).join('');
    $$('[data-kp-size]', host).forEach(function (btn) {
      btn.addEventListener('click', function () { selectSize(btn.getAttribute('data-kp-size')); });
    });
  }

  function selectSize(size) {
    var product = state.product;
    if (!product) return;
    var stock = stockFor(product, size);
    if (stock <= 0) {
      message('Size US ' + size + ' is sold out for this colourway. Try another size or colourway.', 'bad');
      return;
    }
    state.size = String(size);
    state.qty = Math.max(1, Math.min(state.qty, Math.min(MAX_QTY, stock)));
    clearMessage();
    paintSizes();
    paintSku();
    paintStockChip();
    paintQty();
    paintSticky();
    var note = $('#kpSizeNote');
    if (note) note.innerHTML = 'Selected <b>US ' + esc(size) + '</b> · EU ' + esc((app() && app().sizeEu ? app().sizeEu(size) : SIZE_EU_FALLBACK[size]) || '') + '. Free exchange if it is not right.';
  }
  function selectColor(hex) {
    state.color = safeHex(hex);
    clearMessage();
    paintColors();
    paintSku();
    paintSizes();
    paintStockChip();
    paintSticky();
  }

  function paintSku() {
    var el = $('#kpSku');
    if (!el || !state.product) return;
    var cw = currentColorway();
    el.textContent = 'SKU ' + skuFor(state.product, state.size || '9', cw);
    /* keep the spec table's SKU + colourway rows honest */
    $$('.kp-specs .kp-spec').forEach(function (row) {
      var dt = $('dt', row), dd = $('dd', row);
      if (dt && dd && dt.textContent.trim().toLowerCase() === 'sku') dd.textContent = skuFor(state.product, state.size || '9', cw);
      if (dt && dd && dt.textContent.trim().toLowerCase() === 'colourway') dd.textContent = cw ? cw.name : 'Standard';
    });
  }

  function paintStockChip() {
    var chip = $('#kpStockChip');
    if (!chip || !state.product) return;
    var label = $('#kpSizeLabel');
    var stock = state.size ? sizeStock(state.size) : null;
    if (label) label.textContent = state.size ? 'US ' + state.size : 'US —';
    if (stock === null) {
      var summary = productSummary();
      chip.className = 'kp-stock-chip ' + (summary.available ? 'in' : 'out');
      chip.textContent = summary.available ? 'In stock · ' + summary.available + ' of ' + summary.total + ' sizes' : 'Sold out';
    } else if (stock === 0) {
      chip.className = 'kp-stock-chip out';
      chip.textContent = 'US ' + state.size + ' sold out';
    } else if (stock <= 2) {
      chip.className = 'kp-stock-chip low';
      chip.textContent = 'Only ' + stock + ' left in US ' + state.size;
    } else {
      chip.className = 'kp-stock-chip in';
      chip.textContent = 'In stock · US ' + state.size + ' ships today';
    }
    var stack = $('.kp-badge-stack');
    if (stack) stack.innerHTML = badgeStack();
  }
  function productSummary() {
    var product = state.product || {};
    var a = app();
    if (a && a.stockSummary) {
      try { return a.stockSummary(product.id); } catch (e) { /* fall through */ }
    }
    var rows = Object.keys(SIZE_EU_FALLBACK).map(function (size) { return stockFor(product, size); });
    return { available: rows.filter(function (n) { return n > 0; }).length, total: rows.length };
  }

  function paintQty() {
    var product = state.product;
    if (!product) return;
    var cap = state.size ? Math.min(MAX_QTY, sizeStock(state.size)) : MAX_QTY;
    if (state.qty > cap) state.qty = Math.max(1, cap);
    var val = $('#kpQtyVal');
    if (val) val.textContent = state.qty;
    var minus = $('#kpQtyMinus'), plus = $('#kpQtyPlus');
    if (minus) minus.disabled = state.qty <= 1;
    if (plus) plus.disabled = state.qty >= cap || cap <= 0;
    var hint = $('#kpQtyHint');
    if (hint) hint.textContent = state.size ? (cap > 0 ? cap + ' available in this size' : 'Sold out') : 'Select a size first';
    var total = $('#kpLineTotal');
    if (total) total.textContent = money0(dollars(product.price) * state.qty) + (state.qty > 1 ? ' · ' + money0(product.price) + ' each' : '');
    var add = $('#kpAdd'), buy = $('#kpBuy');
    var ready = !!state.size && sizeStock(state.size) > 0;
    [add, buy, $('#kpStickyAdd'), $('#kpStickyBuy')].forEach(function (btn) {
      if (!btn) return;
      btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
    });
    if (add) add.innerHTML = ready ? 'Add to bag <span aria-hidden="true">→</span>' : 'Select a size <span aria-hidden="true">→</span>';
  }

  function paintSticky() {
    var bar = $('#kpSticky');
    if (!bar || !state.product) return;
    var name = $('#kpStickyName'), meta = $('#kpStickyMeta'), price = $('#kpStickyPrice');
    if (name) name.textContent = state.product.name;
    if (meta) meta.textContent = (state.size ? 'US ' + state.size : 'Choose a size') + ' · ' + (state.color ? colorwayName(state.color) : 'Choose a colour');
    if (price) price.textContent = money0(dollars(state.product.price) * state.qty);
  }

  function message(text, kind) {
    var box = $('#kpMsg');
    if (!box) { if (text) toast('KINETIC', text, 'bg-ink text-flame'); return; }
    box.className = 'kp-msg on ' + (kind || 'bad');
    box.textContent = text || '';
    if (!text) box.className = 'kp-msg';
  }
  function clearMessage() { message(''); }

  function paintWishlist() {
    var btn = $('#kpWish');
    if (!btn || !state.product) return;
    var a = app();
    var saved = !!(a && a.wishlist && a.wishlist.has(state.product.id));
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    var label = $('#kpWishLabel');
    if (label) label.textContent = saved ? 'Saved to wishlist' : 'Save to wishlist';
    var heart = $('.kp-heart', btn);
    if (heart) heart.textContent = saved ? '♥' : '♡';
  }

  function paintReviews() {
    var product = state.product;
    if (!product) return;
    var counts = ratingBreakdown(product);
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    var summary = $('#kpRevSummary');
    if (summary) {
      var bars = counts.map(function (count, index) {
        var star = 5 - index;
        var pct = total ? Math.round((count / total) * 100) : 0;
        return '<div class="kp-rev-bar"><span>' + star + ' ★</span><span class="track"><i data-kp-bar="' + pct + '"></i></span><span>' + count.toLocaleString('en-US') + '</span></div>';
      }).join('');
      summary.innerHTML =
        '<div class="kp-rev-score">' +
          '<div class="big">' + Number(product.rating).toFixed(1) + '</div>' +
          '<div style="margin-top:12px">' + starsHTML(product.rating) + '</div>' +
          '<div class="of">' + dollars(product.reviews).toLocaleString('en-US') + ' reviews</div>' +
          '<div class="of" style="margin-top:10px;color:rgba(245,240,234,.42)">' + (total ? Math.round((counts[0] + counts[1]) / total * 100) : 0) + '% rate it 4★ or higher</div>' +
        '</div>' +
        '<div><div class="kp-rev-bars">' + bars + '</div>' +
        '<p class="kp-copy-p" style="margin-top:18px;font-size:13px">Ratings come from verified KINETIC® orders. Buyers can review a pair up to 90 days after delivery.</p></div>';
      window.setTimeout(function () {
        $$('#kpRevSummary [data-kp-bar]').forEach(function (bar) { bar.style.width = bar.getAttribute('data-kp-bar') + '%'; });
      }, 120);
    }

    var a = app();
    var catalogue = (a && a.reviews) ? a.reviews() : [];
    var name = String(product.name || '').toLowerCase();
    var matched = catalogue.filter(function (r) { return String((r && r.meta) || '').toLowerCase().indexOf(name) > -1; });
    var mine = localReviews(product.id);
    var live = dbReviews(product.id);

    var list = $('#kpRevList');
    if (!list) return;
    var html = '';
    /* reviews written by real customers (stored in the database) come first */
    live.forEach(function (review) {
      html += reviewCard({ id: review.id, name: review.name, text: review.text, rating: review.rating, at: review.at, verified: review.verified }, false);
    });
    mine.forEach(function (review) {
      html += reviewCard(review, true);
    });
    matched.forEach(function (review) {
      html += reviewCard({ name: review.name, text: review.text, avatar: review.avatar, meta: review.meta, at: null, rating: null }, false);
    });
    if (!html) {
      html = '<div class="kp-empty-reviews">No written reviews for the ' + esc(product.name) + ' yet — the ' +
        dollars(product.reviews).toLocaleString('en-US') + ' ratings on this page come from verified orders. Be the first to write one below.</div>';
    }
    html += '<div class="kp-rev-form" id="kpRevForm" style="display:none">' +
        '<h4>Write a review</h4>' +
        '<p class="kp-copy-p" style="font-size:13px;margin-top:8px">' + (window.KINETIC_API_MODE === 'live'
          ? 'Your review is saved to your KINETIC account and shown on this product page. One review per customer.'
          : 'Your review is saved in this browser and shows on this product page for you. Nothing is sent anywhere.') + '</p>' +
        '<div class="kp-field"><label for="kpRevName">Your name</label><input class="kp-in" id="kpRevName" type="text" maxlength="60" placeholder="First name and last initial" autocomplete="name" /></div>' +
        '<div class="kp-field"><label id="kpRevRateLabel">Your rating</label><div class="kp-star-pick" id="kpRevStars" role="group" aria-labelledby="kpRevRateLabel">' +
          [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-kp-star="' + n + '" aria-pressed="false" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">★</button>'; }).join('') +
        '</div><div class="kp-err" id="kpRevStarErr" role="alert"></div></div>' +
        '<div class="kp-field"><label for="kpRevText">Your review</label><textarea class="kp-in" id="kpRevText" maxlength="600" placeholder="Fit, comfort, how you wear them…"></textarea><div class="kp-err" id="kpRevTextErr" role="alert"></div></div>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">' +
          '<button type="button" class="kp-btn kp-btn-solid" id="kpRevSubmit" style="padding:14px 22px">Publish review</button>' +
          '<button type="button" class="kp-btn kp-btn-ghost" id="kpRevCancel" style="padding:14px 22px">Cancel</button>' +
        '</div>' +
      '</div>';
    list.innerHTML = html;

    $$('[data-kp-review-remove]', list).forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeLocalReview(product.id, btn.getAttribute('data-kp-review-remove'));
        toast('Review removed', 'Your review was deleted from this device.', 'bg-ink text-flame');
        paintReviews();
      });
    });
    wireReviewForm();
  }

  function reviewCard(review, isMine) {
    var initial = String(review.name || 'K').trim().charAt(0).toUpperCase();
    var avatar = review.avatar
      ? '<span class="kp-rev-av"><img src="' + esc(review.avatar) + '" alt="" loading="lazy" decoding="async" width="96" height="96" /></span>'
      : '<span class="kp-rev-av initial" aria-hidden="true">' + esc(initial) + '</span>';
    var when = review.at ? new Date(review.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Verified purchase';
    var rating = review.rating ? starsHTML(review.rating) : '';
    return '<article class="kp-rev' + (isMine ? ' kp-rev-mine' : '') + '">' +
      '<div class="kp-rev-top">' + avatar +
        '<div style="flex:1;min-width:0"><div class="kp-rev-name">' + esc(review.name || 'KINETIC buyer') + '</div>' +
        '<div class="kp-rev-meta">' + (isMine ? 'Your review · this device · ' + esc(when) : esc(when)) + (review.meta && !isMine ? ' · ' + esc(String(review.meta).replace(/^Sample review · /, '')) : '') + '</div></div>' +
        (rating ? '<div style="flex:0 0 auto">' + rating + '</div>' : '') +
        (isMine ? '<span class="kp-rev-flag">Yours</span>' : '') +
      '</div>' +
      '<p class="kp-rev-text">' + esc(review.text || '') + '</p>' +
      (isMine ? '<div style="margin-top:14px"><button type="button" class="kp-linkbtn" data-kp-review-remove="' + esc(review.id) + '">Delete my review</button></div>' : '') +
    '</article>';
  }

  var reviewDraft = { rating: 0 };
  function wireReviewForm() {
    var form = $('#kpRevForm');
    if (!form) return;
    reviewDraft.rating = 0;
    $$('[data-kp-star]', form).forEach(function (star) {
      star.addEventListener('click', function () {
        reviewDraft.rating = parseInt(star.getAttribute('data-kp-star'), 10);
        $$('[data-kp-star]', form).forEach(function (other) {
          other.setAttribute('aria-pressed', String(parseInt(other.getAttribute('data-kp-star'), 10) <= reviewDraft.rating));
        });
        var err = $('#kpRevStarErr'); if (err) err.classList.remove('on');
      });
    });
    var cancel = $('#kpRevCancel');
    if (cancel) cancel.addEventListener('click', function () { form.style.display = 'none'; });
    var submit = $('#kpRevSubmit');
    if (submit) submit.addEventListener('click', function () {
      var nameEl = $('#kpRevName'), textEl = $('#kpRevText');
      var name = (nameEl && nameEl.value || '').trim();
      var text = (textEl && textEl.value || '').trim();
      var ok = true;
      if (!name) { setErr('#kpRevName', '#kpRevNameErr', 'Add a name to publish under.'); ok = false; } else { setErr('#kpRevName', null, ''); }
      if (!reviewDraft.rating) { var e1 = $('#kpRevStarErr'); if (e1) { e1.textContent = 'Pick a star rating.'; e1.classList.add('on'); } ok = false; }
      if (text.length < 10) { setErr('#kpRevText', '#kpRevTextErr', 'Write at least 10 characters so it is useful.'); ok = false; } else { setErr('#kpRevText', null, ''); }
      if (!ok) return;
      var entry = {
        id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name, rating: reviewDraft.rating, text: text, at: new Date().toISOString()
      };

      function published(message) {
        toast('Review published', message, 'bg-flame text-ink');
        paintReviews();
        var again = $('#kpRevForm');
        if (again) again.style.display = 'none';
        var anchor = $('#kpReviews');
        if (anchor) anchor.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      }

      /* On a live deployment the review belongs to the account and to the
         product, not to this browser — the API stores it, recomputes the
         product rating and enforces one review per customer. The device-local
         draft is only used when there is no backend (static deployment). */
      var reviewsBridge = window.KINETIC_REVIEWS;
      if (liveApi() && reviewsBridge && reviewsBridge.submit) {
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        reviewsBridge.submit({
          productId: state.product.id, rating: entry.rating, review: entry.text, name: name,
        }).then(function (result) {
          submit.disabled = false;
          submit.removeAttribute('aria-busy');
          if (result && result.ok) { setErr('#kpRevText', '#kpRevTextErr', ''); published('Thanks — your review is saved to your KINETIC account.'); return; }
          var why = (result && result.message) || 'That review could not be saved. Please try again.';
          setErr('#kpRevText', '#kpRevTextErr', why);
          var box = $('#kpRevTextErr');
          if (box) { box.classList.add('on'); box.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); }
        });
        return;
      }

      saveLocalReview(state.product.id, entry);
      published('Thanks — your review is live on this product page.');
    });
  }
  function setErr(inputSel, errSel, text) {
    var input = $(inputSel);
    if (input) input.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (!errSel) return;
    var err = $(errSel);
    if (!err) return;
    err.textContent = text || '';
    err.classList.toggle('on', !!text);
  }

  function paintships() {
    var a = app();
    var commerce = (a && a.commerce) ? a.commerce() : { freeShippingThresholdCents: 18000, shippingCents: 1200 };
    var threshold = money(commerce.freeShippingThresholdCents);
    var shipping = money(commerce.shippingCents);
    var line = $('#kpShipLine');
    if (line) line.textContent = 'Free on orders over ' + threshold + ' — otherwise ' + shipping + '. Orders placed before 4pm leave the warehouse the same day.';
    var list = $('#kpShipList');
    if (list) {
      var methods = null;
      var co = checkout();
      if (co && typeof co.shipping === 'function') { try { methods = co.shipping(); } catch (e) { methods = null; } }
      if (!methods) methods = [
        { label: 'Standard', eta: '4–6 business days', cents: commerce.shippingCents, freeAbove: commerce.freeShippingThresholdCents },
        { label: 'Express', eta: '2–3 business days', cents: Math.max(2900, Math.round(commerce.shippingCents * 2.2)) },
        { label: 'Priority', eta: 'Next business day', cents: Math.max(4900, Math.round(commerce.shippingCents * 3.6)) }
      ];
      list.innerHTML = methods.map(function (method) {
        var cost = (method.freeAbove !== null && method.freeAbove !== undefined && dollars(state.product ? state.product.price : 0) * 100 >= method.freeAbove) ? 'FREE' : money(method.cents);
        return '<li><b style="color:#F5F0EA">' + esc(method.label) + '</b> · ' + esc(method.eta) + ' · ' + cost + '</li>';
      }).join('') +
        '<li>Tracking link emailed the moment your pair leaves the warehouse.</li>' +
        '<li>Discreet KINETIC® packaging, signature on delivery for orders over ' + threshold + '.</li>';
    }
    var duties = $('#kpDuties');
    if (duties) duties.innerHTML = '<p class="kp-copy-p" style="font-size:13px;margin-top:16px">Shipping to Saudi Arabia and the GCC is handled by our regional partner. Duties and taxes for international orders are calculated at the border.</p>';
  }

  /* ---------------------------------------------------------------- rails */
  function cardMarkup(product) {
    var ways = colorwaysOf(product).slice(0, 3);
    return '<button type="button" class="kp-card" data-kp-open="' + esc(product.id) + '" aria-label="Open ' + esc(product.name) + '">' +
      '<span class="kp-card-img">' +
        '<img src="' + esc(product.img) + '" alt="' + esc(product.name) + '" loading="lazy" decoding="async" width="1100" height="733" />' +
        (product.tag ? '<span class="kp-card-tag">' + esc(product.tag) + '</span>' : '') +
        '<span class="kp-card-swatch" aria-hidden="true">' + ways.map(function (way) { return '<i style="background:' + esc(safeHex(way.swatch)) + '"></i>'; }).join('') + '</span>' +
      '</span>' +
      '<span class="kp-card-body">' +
        '<span class="kp-card-cat">' + esc(product.cat) + '</span>' +
        '<span class="kp-card-name">' + esc(product.name) + '</span>' +
        '<span class="kp-card-row"><span class="kp-card-price">' + money0(product.price) + (product.old ? '<span class="kp-card-old">' + money0(product.old) + '</span>' : '') + '</span>' +
        '<span class="kp-card-rating">★ ' + Number(product.rating).toFixed(1) + '</span></span>' +
      '</span></button>';
  }
  function wireRail(hostId) {
    var host = $('#' + hostId);
    if (!host) return;
    $$('[data-kp-open]', host).forEach(function (card) {
      card.addEventListener('click', function () { open(card.getAttribute('data-kp-open')); });
    });
  }
  function paintRelated() {
    var product = state.product;
    if (!product) return;
    var all = products().filter(function (p) { return valid(p) && String(p.id) !== String(product.id); });
    var same = all.filter(function (p) { return p.cat === product.cat; });
    var others = all.filter(function (p) { return p.cat !== product.cat; }).sort(function (a, b) {
      return Math.abs(dollars(a.price) - dollars(product.price)) - Math.abs(dollars(b.price) - dollars(product.price));
    });
    var list = same.concat(others).slice(0, 6);
    var rail = $('#kpRelatedRail');
    if (!rail) return;
    rail.innerHTML = list.map(cardMarkup).join('') || '<div class="kp-empty-reviews">No other styles available yet.</div>';
    wireRail('kpRelatedRail');
  }
  function paintRecent() {
    var product = state.product;
    var list = readRecent().filter(function (id) { return String(id) !== String(product.id); }).map(findProduct).filter(Boolean).slice(0, 6);
    var section = $('#kpRecentSection'), rail = $('#kpRecentRail');
    if (!section || !rail) return;
    if (!list.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    rail.innerHTML = list.map(cardMarkup).join('');
    wireRail('kpRecentRail');
  }

  /* ------------------------------------------------------------- size guide */
  /* The size guide dialog is a static table (SIZE_CHART). It used to be
     rendered only inside the product view, so the footer "Size guide" link
     had nothing to open. It is now built once — into <body>, outside the
     product view (whose innerHTML is replaced on every product open) — and
     exposed as window.KINETIC_openSizeGuide for the footer link. */
  function sizeGuideMarkup() {
    return '<div id="kpSizeGuide" role="dialog" aria-modal="true" aria-labelledby="kpGuideTitle" aria-hidden="true">' +
        '<div class="kp-lb-bar"><span class="kp-lb-title" id="kpGuideTitle">KINETIC® size guide</span>' +
        '<button type="button" class="kp-lb-btn" data-kp-guide-close="1" aria-label="Close size guide">✕</button></div>' +
        '<div style="padding:20px;overflow:auto">' +
          '<p class="kp-copy-p" style="font-size:13.5px">KINETIC® sneakers fit true to size. If you are between sizes, take the smaller one for court styles and the larger one for running styles.</p>' +
          '<table style="width:100%;border-collapse:collapse;margin-top:18px;font-family:\'Space Grotesk\',monospace;font-size:12px">' +
            '<caption class="kp-sr">Shoe size conversion</caption>' +
            '<thead><tr>' + ['US', 'EU', 'UK', 'Foot length (cm)'].map(function (h) { return '<th scope="col" style="text-align:left;padding:10px 8px;border-bottom:1px solid rgba(212,175,55,.4);color:#D4AF37;letter-spacing:.16em;text-transform:uppercase;font-size:10px">' + h + '</th>'; }).join('') + '</tr></thead>' +
            '<tbody>' + SIZE_CHART.map(function (row) {
              return '<tr>' + row.map(function (cell, i) { return '<td style="padding:10px 8px;border-bottom:1px solid rgba(245,240,234,.1);' + (i === 0 ? 'font-weight:800;color:#F5F0EA' : 'color:rgba(245,240,234,.66)') + '">' + esc(cell) + '</td>'; }).join('') + '</tr>';
            }).join('') + '</tbody>' +
          '</table>' +
          '<p class="kp-copy-p" style="font-size:12.5px;margin-top:16px">Measure your foot in the afternoon, standing, heel against a wall. Add 0.5 cm of room for thicker socks.</p>' +
        '</div>' +
      '</div>';
  }
  function ensureSizeGuide() {
    var guide = document.getElementById('kpSizeGuide');
    if (guide) return guide;
    var wrap = document.createElement('div');
    wrap.innerHTML = sizeGuideMarkup();
    guide = wrap.firstChild;
    document.body.appendChild(guide);
    bindSizeGuide(guide);
    return guide;
  }
  function bindSizeGuide(guide) {
    if (!guide || guide.dataset.kpBound) return;
    guide.dataset.kpBound = '1';
    $$('[data-kp-guide-close]', guide).forEach(function (btn) { btn.addEventListener('click', closeSizeGuide); });
    guide.addEventListener('click', function (event) { if (event.target === guide) closeSizeGuide(); });
  }
  /* Footer "Size guide" entry point (called from kinetic-app.js). */
  window.KINETIC_openSizeGuide = function () { ensureSizeGuide(); openSizeGuide(); };

  function openSizeGuide() {
    var box = $('#kpSizeGuide');
    if (!box) return;
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
    var close = $('[data-kp-guide-close]', box);
    if (close) close.focus();
  }
  function closeSizeGuide() {
    var box = $('#kpSizeGuide');
    if (!box) return;
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
    var trigger = $('[data-kp-sizeguide]');
    if (trigger) { try { trigger.focus(); } catch (e) {} }
  }

  /* ================================================================== actions */
  function addToBag(goToCheckout) {
    var a = app();
    if (!state.product || !a || !a.addItem) return;
    if (!state.size) {
      var all = (a.sizes ? a.sizes() : []);
      var range = 'the size list is just above';
      if (all.length > 1 && all.every(function (x) { return isFinite(Number(x)); })) range = 'sizes US ' + all[0] + ' to ' + all[all.length - 1] + ' are listed above';
      message('Choose a size first — ' + range + '.', 'bad');
      var block = $('#kpSizeBlock');
      if (block) {
        var box = block.getBoundingClientRect();
        if (box.top < 0 || box.bottom > (window.innerHeight || 0)) block.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
      }
      var firstSize = $('#kpSizes .kp-size:not([aria-disabled="true"])');
      if (firstSize) { try { firstSize.focus({ preventScroll: true }); } catch (e) {} }
      return;
    }
    var result = a.addItem({ id: state.product.id, size: state.size, color: state.color, qty: state.qty });
    if (!result || !result.ok) {
      message((result && result.message) || 'That selection could not be added.', 'bad');
      if (result && result.reason === 'stock') { paintSizes(); paintStockChip(); paintQty(); }
      return;
    }
    clearMessage();
    toast('Added to bag', result.message, 'bg-flame text-ink');
    if (result.clamped) toast('Stock limit', 'Only ' + result.added + ' pair(s) of US ' + state.size + ' were available.', 'bg-ink text-flame');
    paintQty();
    paintStockChip();
    if (goToCheckout) {
      var co = checkout();
      if (co && typeof co.open === 'function') { if (co.open(1) !== false) return; }
      if (a.openCart) a.openCart();
      return;
    }
    if (a.openCart) a.openCart();
  }

  function toggleWishlist() {
    var a = app();
    if (!a || !a.wishlist || !state.product) return;
    a.wishlist.toggle(state.product.id);   /* the storefront toasts and stores it */
    paintWishlist();
  }

  /* ===================================================================== open */
  function renderProduct(id) {
    var product = findProduct(id);
    var host = view();
    if (!host) return;
    if (!product || !valid(product)) {
      host.innerHTML = notFoundMarkup(id);
      var back = $('[data-kp-close]', host);
      if (back) back.addEventListener('click', function () { close(true); });
      activate();
      return;
    }

    state.id = String(product.id);
    state.product = product;
    state.color = null;
    state.size = null;
    state.qty = 1;
    state.index = 0;

    var a = app();
    var selected = (a && a.selectedColorway) ? a.selectedColorway(product.id) : null;
    var ways = colorwaysOf(product);
    state.color = safeHex((selected && selected.swatch) || (ways[0] && ways[0].swatch) || '#D4AF37');

    var specs = specsFor(product, currentColorway());
    host.innerHTML =
      '<div class="kp-wrap kp-top-pad">' +
        '<button type="button" class="kp-linkbtn kp-back" data-kp-close="1">Back to collection</button>' +
        '<nav class="kp-crumbs" aria-label="Breadcrumb">' +
          '<button type="button" data-kp-close="1">Home</button><span class="kp-sep">/</span>' +
          '<button type="button" data-kp-close="1" data-kp-jump="collection">Collection</button><span class="kp-sep">/</span>' +
          '<span>' + esc(product.cat) + '</span><span class="kp-sep">/</span>' +
          '<span aria-current="page">' + esc(product.name) + '</span>' +
        '</nav>' +
        '<div class="kp-grid">' + galleryMarkup(product) + buyMarkup(product) + '</div>' +
        accordionMarkup(product, specs) +
      '</div>' +
      reviewsMarkup() +
      railsMarkup() +
      '<div id="kpLightbox" role="dialog" aria-modal="true" aria-label="Image viewer" aria-hidden="true"></div>' +
      /* The size guide lives once per page: skip a second copy when boot()
         already built it into <body>. */
      (document.getElementById('kpSizeGuide') ? '' : sizeGuideMarkup()) +
      stickyMarkup();

    wirePage(product);
    activate();
    loadUploads(product);
    pushRecent(product.id);
    document.title = product.name + ' — KINETIC®';
    /* let the API bridge fetch this product's real reviews (once per product) */
    try { window.dispatchEvent(new CustomEvent('kinetic:product-opened', { detail: { id: product.id, slug: product.slug || null } })); } catch (e) {}
  }

  function wirePage(product) {
    paintColors();
    paintSizes();
    paintSku();
    paintStockChip();
    paintQty();
    paintSticky();
    paintWishlist();
    paintReviews();
    paintRelated();
    paintRecent();
    paintships();

    $$('[data-kp-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var jump = btn.getAttribute('data-kp-jump');
        close(true);
        if (jump) {
          var target = document.getElementById(jump);
          if (target) window.setTimeout(function () { target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }, 80);
        }
      });
    });
    $$('[data-kp-goto="reviews"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = $('#kpReviews');
        if (target) target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      });
    });
    $$('.kp-acc-head').forEach(function (head) {
      head.addEventListener('click', function () {
        var acc = head.closest('.kp-acc');
        var open = acc.getAttribute('data-open') === 'true';
        acc.setAttribute('data-open', open ? 'false' : 'true');
        head.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    });
    var minus = $('#kpQtyMinus'), plus = $('#kpQtyPlus');
    if (minus) minus.addEventListener('click', function () {
      state.qty = Math.max(1, state.qty - 1); paintQty(); paintSticky();
    });
    if (plus) plus.addEventListener('click', function () {
      var cap = state.size ? Math.min(MAX_QTY, sizeStock(state.size)) : MAX_QTY;
      if (state.qty >= cap) {
        message('Maximum ' + cap + ' pair(s) of US ' + state.size + ' in one order. Contact the store for a bulk order.', 'bad');
        return;
      }
      state.qty += 1; clearMessage(); paintQty(); paintSticky();
    });
    var add = $('#kpAdd'), buy = $('#kpBuy');
    if (add) add.addEventListener('click', function () { addToBag(false); });
    if (buy) buy.addEventListener('click', function () { addToBag(true); });
    var sAdd = $('#kpStickyAdd'), sBuy = $('#kpStickyBuy');
    if (sAdd) sAdd.addEventListener('click', function () { addToBag(false); });
    if (sBuy) sBuy.addEventListener('click', function () { addToBag(true); });
    var wish = $('#kpWish');
    if (wish) wish.addEventListener('click', toggleWishlist);
    /* Guarded: this re-runs on every product render, so without the flag the
       footer "Size guide" button would collect a new listener each time. */
    $$('[data-kp-sizeguide]').forEach(function (btn) { if (btn.dataset.kpSgBound) return; btn.dataset.kpSgBound = '1'; btn.addEventListener('click', openSizeGuide); });
    bindSizeGuide($('#kpSizeGuide'));
    $$('[data-kp-write]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var form = $('#kpRevForm');
        if (!form) return;
        form.style.display = 'block';
        form.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
        var name = $('#kpRevName');
        if (name) { try { name.focus({ preventScroll: true }); } catch (e) {} }
      });
    });
    var clearRecent = $('[data-kp-clear-recent]');
    if (clearRecent) clearRecent.addEventListener('click', function () {
      writeJSON(RECENT_KEY, []);
      pushRecent(product.id);
      paintRecent();
      toast('Cleared', 'Recently viewed products were cleared.', 'bg-ink text-flame');
    });
    var lb = $('#kpLightbox');
    if (lb) {
      lb.innerHTML = lightboxMarkup();
      $$('[data-kp-lb-close]', lb).forEach(function (btn) { btn.addEventListener('click', closeLightbox); });
      $$('[data-kp-lb-zoom]', lb).forEach(function (btn) {
        btn.addEventListener('click', function () { setLbZoom(state.lbZoom + parseInt(btn.getAttribute('data-kp-lb-zoom'), 10) * 0.75); });
      });
      var reset = $('[data-kp-lb-reset]', lb);
      if (reset) reset.addEventListener('click', function () { setLbZoom(1); });
      lb.addEventListener('click', function (event) { if (event.target === lb) closeLightbox(); });
      wireLightboxGestures();
    }
    wireStageOnce();
    paintStage();
    paintThumbs();
    setStickyObserver();
  }

  function loadUploads(product) {
    var a = app();
    var apply = function (uploads) {
      if (!state.product || String(state.product.id) !== String(product.id)) return;
      state.media = buildMedia(product, uploads || []);
      if (state.index >= state.media.length) state.index = 0;
      paintStage();
      paintThumbs();
    };
    apply([]);
    if (a && a.uploads) {
      try { a.uploads(product.id).then(function (uploads) { apply(uploads); }).catch(function () {}); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------- gestures */
  function wireLightboxGestures() {
    var stage = $('#kpLbStage');
    if (!stage) return;
    var dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0;
    stage.addEventListener('pointerdown', function (event) {
      if (state.lbZoom <= 1) return;
      dragging = true; startX = event.clientX; startY = event.clientY; baseX = state.lbX; baseY = state.lbY;
      stage.classList.add('dragging');
      if (stage.setPointerCapture) { try { stage.setPointerCapture(event.pointerId); } catch (e) {} }
    });
    stage.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      state.lbX = baseX + (event.clientX - startX);
      state.lbY = baseY + (event.clientY - startY);
      applyLbTransform();
    });
    var stop = function () { dragging = false; stage.classList.remove('dragging'); };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
    stage.addEventListener('pointerleave', stop);
    stage.addEventListener('wheel', function (event) {
      if (!document.body.classList.contains('kp-lightbox')) return;
      event.preventDefault();
      setLbZoom(state.lbZoom + (event.deltaY < 0 ? 0.25 : -0.25));
    }, { passive: false });
    var swipeX = 0, swipeY = 0;
    stage.addEventListener('touchstart', function (event) {
      if (event.touches.length !== 1 || state.lbZoom > 1) return;
      swipeX = event.touches[0].clientX; swipeY = event.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', function (event) {
      if (state.lbZoom > 1) return;
      var touch = event.changedTouches[0];
      if (!touch) return;
      var dx = touch.clientX - swipeX, dy = touch.clientY - swipeY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { step(dx < 0 ? 1 : -1); paintThumbs(); }
    }, { passive: true });
  }

  /* ------------------------------------------------------------- sticky bar */
  function isSmallScreen() {
    try { return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches); } catch (e) { return false; }
  }
  function setStickyObserver() {
    var bar = $('#kpSticky');
    var cta = $('#kpCta');
    if (!bar || !cta) return;
    if (state.stickyObserver && state.stickyObserver.disconnect) state.stickyObserver.disconnect();
    if (!isSmallScreen()) { state.ctaVisible = true; bar.classList.remove('show'); return; }   /* desktop keeps the real buy box */
    if (!('IntersectionObserver' in window)) { state.ctaVisible = false; syncSticky(); return; }
    state.stickyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { state.ctaVisible = entry.isIntersecting; syncSticky(); });
    }, { rootMargin: '-60px 0px 0px 0px', threshold: 0 });
    state.stickyObserver.observe(cta);
    syncSticky();
  }
  function syncSticky() {
    var bar = $('#kpSticky');
    if (!bar) return;
    var scrolled = (window.pageYOffset || document.documentElement.scrollTop || 0) > 240;
    var show = !!state.active && state.ctaVisible === false && isSmallScreen() && scrolled &&
      !document.body.classList.contains('ko-locked') && !document.body.classList.contains('kp-lightbox');
    bar.classList.toggle('show', show);
    /* the storefront's back-to-top button would sit on top of the bar on phones */
    document.body.classList.toggle('kp-sticky-on', show);
  }

  /* ------------------------------------------------------------- activation */
  function activate() {
    var a = app();
    if (a && a.closeQuickView) { try { a.closeQuickView(); } catch (e) {} }
    if (state.active) return;
    state.savedScroll = window.pageYOffset || document.documentElement.scrollTop || 0;
    state.titleBefore = document.title;
    document.body.classList.add('kp-active');
    state.active = true;
    window.scrollTo(0, 0);
    var host = view();
    if (host) {
      var title = $('#kpTitle', host);
      if (title) { try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); } }
    }
  }

  function close(backToShop) {
    if (!state.active) return;
    document.body.classList.remove('kp-active');
    document.body.classList.remove('kp-lightbox');
    state.active = false;
    var bar = $('#kpSticky');
    if (bar) bar.classList.remove('show');
    document.body.classList.remove('kp-sticky-on');
    if (state.stickyObserver && state.stickyObserver.disconnect) state.stickyObserver.disconnect();
    closeLightbox();
    document.title = state.titleBefore || document.title;
    if (location.hash.indexOf('#product') === 0) {
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch (e) { location.hash = ''; }
    }
    var host = view();
    if (host) host.innerHTML = '';
    state.id = null; state.product = null; state.media = []; state.index = 0;
    if (window.ScrollTrigger && typeof window.ScrollTrigger.refresh === 'function') {
      try { window.ScrollTrigger.refresh(); } catch (e) {}
    }
    if (backToShop) {
      var jumpTo = location.hash && location.hash !== '#' && location.hash !== '#top' ? null : '#collection';
      if (jumpTo) {
        var target = document.getElementById('collection');
        if (target) { try { target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } catch (e) {} }
      } else {
        window.scrollTo(0, state.savedScroll || 0);
      }
    } else {
      window.scrollTo(0, state.savedScroll || 0);
    }
  }

  /* ==================================================================== route */
  function waitForProducts(callback, attempts) {
    var tries = attempts || 0;
    if (products().length) { callback(); return; }
    if (tries > 120) { callback(); return; }
    window.setTimeout(function () { waitForProducts(callback, tries + 1); }, 100);
  }

  function open(id, options) {
    options = options || {};
    var host = view();
    if (!host) return false;
    if (state.active && String(state.id) === String(id)) {
      window.scrollTo(0, 0);
      return true;
    }
    if (!products().length) {
      host.innerHTML = loadingMarkup();
      activate();
      waitForProducts(function () { if (state.active || location.hash.indexOf('#product') === 0) renderProduct(id); });
    } else {
      renderProduct(id);
    }
    var wanted = '#product/' + encodeURIComponent(id);
    if (!options.fromRoute && location.hash !== wanted) {
      try { history.pushState(null, '', wanted); }
      catch (e) { location.hash = wanted.slice(1); }
    }
    return true;
  }

  function routeFromHash() {
    var match = /^#product\/(.+)$/.exec(location.hash || '');
    if (!match) return false;
    var id = decodeURIComponent(match[1]);
    open(id, { fromRoute: true });
    return true;
  }

  function onRouteChange() {
    if (routeFromHash()) return;
    if (state.active) close(false);
  }

  /* -------------------------------------------------------------------- boot */
  function boot() {
    var host = view();
    if (!host) return;
    routeFromHash();
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('kinetic:wishlist-changed', function () { if (state.active) paintWishlist(); });
    /* real customer reviews arrive from the database (kinetic-api-bridge.js) */
    window.addEventListener('kinetic:reviews-updated', function () { if (state.active) paintReviews(); });
    /* The catalogue is swapped in twice on a live deployment (a cached copy,
       then the store database). When it changes, an open product view must
       repaint from the new data — otherwise the size buttons keep showing the
       old availability and a customer is told "sold out" for a size the page
       just offered as available. Selection is preserved when it is still
       valid, and dropped (with the usual message) when it no longer is. */
    window.addEventListener('kinetic:catalogue-updated', function () {
      if (!state.active || !state.id) return;
      var live = findProduct(state.id);
      if (!live) return;
      state.product = live;
      if (state.size) {
        var sizeStock = stockFor(live, state.size);
        if (sizeStock <= 0) state.size = null;                       /* no longer sellable */
        else state.qty = Math.max(1, Math.min(state.qty, Math.min(MAX_QTY, sizeStock)));
      }
      paintSizes();
      paintSku();
      paintStockChip();
      paintQty();
      paintSticky();
    });
    window.addEventListener('touchstart', function () { touchSeen = true; }, { passive: true });
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (!state.active) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { setStickyObserver(); }, 180);
    });
    window.addEventListener('scroll', function () { if (state.active) syncSticky(); }, { passive: true });
    window.addEventListener('kinetic:cart-changed', function () { if (state.active) { paintSizes(); paintStockChip(); paintQty(); } });
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (document.body.classList.contains('kp-lightbox')) { closeLightbox(); return; }
        var guide = $('#kpSizeGuide');
        if (guide && guide.classList.contains('open')) { closeSizeGuide(); return; }
        if (state.active) { event.preventDefault(); close(true); }
        return;
      }
      if (document.body.classList.contains('kp-lightbox')) {
        if (event.key === 'ArrowRight') { step(1); syncLightbox(); }
        else if (event.key === 'ArrowLeft') { step(-1); syncLightbox(); }
        else if (event.key === '+' || event.key === '=') setLbZoom(state.lbZoom + 0.75);
        else if (event.key === '-' || event.key === '_') setLbZoom(state.lbZoom - 0.75);
        else if (event.key === '0') setLbZoom(1);
        else if (event.key === 'Tab') trapFocus(event, $('#kpLightbox'));
        return;
      }
      var guideBox = $('#kpSizeGuide');
      if (guideBox && guideBox.classList.contains('open') && event.key === 'Tab') trapFocus(event, guideBox);
      /* gallery keyboard control — never steals keys from a form field */
      if (!state.active) return;
      var tag = (event.target && event.target.tagName) ? event.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      else if (event.key === 'Home') { event.preventDefault(); go(0); paintThumbs(); }
      else if (event.key === 'End') { event.preventDefault(); go(state.media.length - 1); paintThumbs(); }
    });
    /* Build the size guide dialog once so the footer link can open it even
       before any product view has rendered. */
    ensureSizeGuide();
  }

  function trapFocus(event, layer) {
    if (!layer) return;
    var focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', layer)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KINETIC_PRODUCT = {
    version: '1.0',
    open: open,
    close: close,
    current: function () { return state.product || null; },
    selection: function () { return { id: state.id, size: state.size, color: state.color, qty: state.qty }; },
    media: function () { return state.media.slice(); },
    openLightbox: openLightbox,
    closeLightbox: closeLightbox
  };
})();
