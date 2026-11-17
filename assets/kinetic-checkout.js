/* ============================================================================
   KINETIC® — Checkout, Order & Cart persistence layer
   ----------------------------------------------------------------------------
   Talks to the existing storefront through a tiny shared contract:
     * localStorage 'kinetic-cart-v1'  = the cart (single source of truth)
     * localStorage 'kinetic-orders-v1'= placed orders
     * window event 'kinetic:cart-changed' keeps the bag drawer and this page
       in sync in both directions.
   If kinetic-app.js is present it is used for products / money / toasts /
   confetti; if it is not, this file still works on its own.
   ========================================================================= */
(function () {
  'use strict';

  var CART_KEY = 'kinetic-cart-v1';
  var ORDER_KEY = 'kinetic-orders-v1';
  var CHECKOUT_KEY = 'kinetic-checkout-draft-v1';
  var MAX_QTY = 9;
  var COUNTRIES = ('Saudi Arabia,United Arab Emirates,Qatar,Kuwait,Bahrain,Oman,Jordan,Lebanon,Egypt,Turkey,' +
    'Pakistan,India,Bangladesh,Sri Lanka,Nepal,Malaysia,Singapore,Indonesia,Philippines,Thailand,Vietnam,' +
    'China,Hong Kong,Japan,South Korea,Taiwan,Australia,New Zealand,' +
    'United Kingdom,Ireland,France,Germany,Spain,Portugal,Italy,Netherlands,Belgium,Luxembourg,Switzerland,Austria,' +
    'Denmark,Sweden,Norway,Finland,Iceland,Poland,Czechia,Slovakia,Hungary,Romania,Bulgaria,Greece,Croatia,Slovenia,' +
    'Serbia,Estonia,Latvia,Lithuania,Ukraine,Russia,' +
    'United States,Canada,Mexico,Brazil,Argentina,Chile,Colombia,Peru,Uruguay,' +
    'South Africa,Nigeria,Kenya,Ghana,Morocco,Tunisia,Algeria,Egypt,' +
    'Israel,Azerbaijan,Kazakhstan,Uzbekistan').split(',');

  /* ------------------------------------------------------------------ utils */
  var MEM = {};
  function read(key) {
    try { var v = localStorage.getItem(key); if (v !== null) return v; } catch (e) { if (key in MEM) return MEM[key]; }
    return (key in MEM) ? MEM[key] : null;
  }
  function write(key, value) {
    MEM[key] = value;
    try { localStorage.setItem(key, value); } catch (e) { /* blocked preview — memory keeps it alive */ }
  }
  function readJSON(key, fallback) {
    var raw = read(key);
    if (raw === null || raw === undefined) return fallback;
    try { var parsed = JSON.parse(raw); return (parsed === null || parsed === undefined) ? fallback : parsed; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) { write(key, JSON.stringify(value)); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function money(cents) { return '$' + (Math.max(0, Number(cents) || 0) / 100).toFixed(2); }
  function clampQty(n) { n = parseInt(n, 10); if (!isFinite(n) || n < 1) return 1; return Math.min(MAX_QTY, n); }
  function app() { return window.KINETIC_APP || null; }
  function prefersReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function uid(len) {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';
    var rnd = null;
    try { if (window.crypto && window.crypto.getRandomValues) { rnd = new Uint8Array(len); window.crypto.getRandomValues(rnd); } } catch (e) { rnd = null; }
    for (var i = 0; i < len; i++) out += alphabet[rnd ? rnd[i] % alphabet.length : Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  /* --------------------------------------------------------------- products */
  function productList() {
    var a = app();
    if (a && typeof a.products === 'function') { var list = a.products(); if (list && list.length) return list; }
    var content = window.__KINETIC_CONTENT__ || {};
    if (content.products && content.products.length) return content.products;
    var defaults = window.__KINETIC_DEFAULTS__ || {};
    if (defaults.products && defaults.products.length) return defaults.products;
    return [];
  }
  function findProduct(id) {
    var a = app();
    if (a && typeof a.getProductById === 'function') { var p = a.getProductById(id); if (p) return p; }
    var list = productList();
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function colorNameFor(product, hex) {
    if (!product) return 'Standard';
    var ways = product.colorways || [];
    for (var i = 0; i < ways.length; i++) if (String(ways[i].swatch).toLowerCase() === String(hex).toLowerCase()) return ways[i].name;
    return 'Standard';
  }
  function colorHexFor(item, product) {
    var hex = String(item.color || '');
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
    var ways = (product && product.colorways) || [];
    return ways.length && /^#[0-9a-fA-F]{6}$/.test(String(ways[0].swatch)) ? String(ways[0].swatch).toUpperCase() : '#D4AF37';
  }
  function priceCents(product) {
    var n = Number(product && product.price);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  /* ------------------------------------------------------------------- cart */
  /* The cart is the one piece of state a customer can break by hand (old
     storage, a product deleted in the store manager, edited values). Everything
     is repaired here: unknown products dropped, missing sizes dropped, colours
     fixed to a real colourway, quantities clamped, duplicate lines merged. */
  function loadCart() {
    var raw = readJSON(CART_KEY, null);
    var rawItems = raw && Array.isArray(raw.items) ? raw.items : (Array.isArray(raw) ? raw : []);
    var cleaned = [];
    (rawItems || []).forEach(function (item) {
      if (!item) return;
      var product = findProduct(item.id);
      if (!product) return;
      var size = String(item.size === null || item.size === undefined ? '' : item.size).trim();
      if (!size || size === '—') return;
      var hex = String(item.color || '');
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        var firstWays = product.colorways || [];
        hex = firstWays.length && /^#[0-9a-fA-F]{6}$/.test(String(firstWays[0].swatch)) ? String(firstWays[0].swatch) : '#D4AF37';
      }
      hex = hex.toUpperCase();
      var line = {
        id: product.id,
        size: size,
        color: hex,
        colorName: colorNameFor(product, hex),
        qty: clampQty(item.qty)
      };
      var twin = null;
      for (var i = 0; i < cleaned.length; i++) {
        if (String(cleaned[i].id) === String(line.id) && cleaned[i].size === line.size && cleaned[i].color === line.color) { twin = cleaned[i]; break; }
      }
      if (twin) twin.qty = Math.min(MAX_QTY, twin.qty + line.qty);
      else cleaned.push(line);
    });
    return { items: cleaned, promo: raw && typeof raw.promo === 'string' ? raw.promo : '' };
  }
  function saveCart(state, silent) {
    writeJSON(CART_KEY, { v: 1, items: state.items, promo: state.promo || '', savedAt: Date.now() });
    if (!silent) dispatchCartChanged();
  }
  function dispatchCartChanged() {
    try {
      window.dispatchEvent(new CustomEvent('kinetic:cart-changed', { detail: { items: cartState().items.slice() } }));
    } catch (e) {
      try {
        var ev = document.createEvent('Event'); ev.initEvent('kinetic:cart-changed', true, true); window.dispatchEvent(ev);
      } catch (e2) { /* nothing else we can do */ }
    }
  }
  var _state = null;
  function cartState() { if (!_state) _state = loadCart(); return _state; }
  function refreshFromStore() { _state = loadCart(); return _state; }
  function mutate(fn) {
    var state = refreshFromStore();
    fn(state);
    saveCart(state);
    return state;
  }

  /* ---------------------------------------------------------- commerce math */
  function commerce() {
    var a = app();
    if (a && typeof a.commerce === 'function') return a.commerce();
    var src = (window.__KINETIC_CONTENT__ && window.__KINETIC_CONTENT__.commerce) || (window.__KINETIC_DEFAULTS__ && window.__KINETIC_DEFAULTS__.commerce) || {};
    return {
      freeShippingThresholdCents: isFinite(Number(src.freeShippingThresholdCents)) ? Number(src.freeShippingThresholdCents) : 18000,
      shippingCents: isFinite(Number(src.shippingCents)) ? Number(src.shippingCents) : 1200,
      promoCode: String(src.promoCode || 'KINETIC20').toUpperCase(),
      promoPercent: isFinite(Number(src.promoPercent)) ? Number(src.promoPercent) : 20,
      ordersEndpoint: String(src.ordersEndpoint || '')
    };
  }
  /* ---- coupons: managed in the admin dashboard, validated here for real ---- */
  function couponsFromContent() {
    var src = (window.__KINETIC_CONTENT__ && window.__KINETIC_CONTENT__.coupons) || [];
    if (!Array.isArray(src)) return [];
    return src.map(function (c) {
      var code = String((c && c.code) || '').trim().toUpperCase();
      if (!code) return null;
      return {
        code: code,
        type: String((c && c.type) || 'percent').toLowerCase() === 'fixed' ? 'fixed' : 'percent',
        value: Number(c && c.value) || 0,
        minCents: parseInt((c && c.minSubtotalCents), 10) || 0,
        expiresAt: String((c && c.expiresAt) || ''),
        usageLimit: parseInt((c && c.usageLimit), 10) || 0,
        status: String((c && c.status) || 'active').toLowerCase() === 'disabled' ? 'disabled' : 'active'
      };
    }).filter(Boolean);
  }
  function couponUses(code) {
    var used = 0;
    existingOrders().forEach(function (o) {
      if (!o || String(o.promo || '').toUpperCase() !== code) return;
      if (o.status === 'Cancelled') return;
      used += 1;
    });
    return used;
  }
  function resolvePromo(code, subtotalCents) {
    code = String(code || '').trim().toUpperCase();
    var c = commerce();
    if (!code) return { ok: false, reason: 'empty', message: 'Enter a code, or leave it blank to pay full price.' };
    var list = couponsFromContent();
    for (var i = 0; i < list.length; i++) {
      var cp = list[i];
      if (cp.code !== code) continue;
      if (cp.status !== 'active') return { ok: false, reason: 'disabled', message: 'That code is switched off.' };
      if (cp.expiresAt) {
        var end = new Date(cp.expiresAt + 'T23:59:59');
        if (!isNaN(end.getTime()) && end.getTime() < Date.now()) return { ok: false, reason: 'expired', message: 'That code expired on ' + cp.expiresAt + '.' };
      }
      if (cp.usageLimit > 0 && couponUses(code) >= cp.usageLimit) return { ok: false, reason: 'limit', message: 'That code has already reached its usage limit.' };
      if (cp.minCents > 0 && subtotalCents < cp.minCents) return { ok: false, reason: 'min', message: 'Spend at least ' + money(cp.minCents) + ' to use this code.' };
      var discount = cp.type === 'fixed'
        ? Math.max(0, Math.min(subtotalCents, Math.round(cp.value * 100)))
        : Math.round(subtotalCents * Math.max(0, Math.min(100, cp.value)) / 100);
      var label = cp.type === 'fixed' ? (code + ' − ' + money(Math.round(cp.value * 100))) : (code + ' − ' + cp.value + '%');
      return { ok: true, code: code, label: label, discountCents: discount, coupon: cp };
    }
    /* the single promo code from the shop settings still works */
    if (code === c.promoCode) {
      return { ok: true, code: code, label: code + ' − ' + c.promoPercent + '%', discountCents: Math.round(subtotalCents * c.promoPercent / 100), legacy: true };
    }
    return { ok: false, reason: 'unknown', message: 'That code is not valid. Check the offer and try again.' };
  }
  /* The database is the authority on coupons: the code is checked against the
     live offer before payment so nobody is surprised at the last step. */
  function confirmPromoOnServer(code) {
    var api = window.KINETIC_API;
    if (!api || typeof api.validateCoupon !== 'function' || !api.available()) return;
    var snap = refreshFromStore();
    var t = totals(snap);
    api.validateCoupon(code, t.subtotalCents).then(function (data) {
      if (!data || data.valid === false) throw new Error('That code is no longer valid.');
      var live = promoAnnounce();
      var label = (data.coupon && data.coupon.code) || code;
      if (live) live.textContent = label + ' confirmed with the store.';
      if (data.coupon && data.coupon.freeShipping) toast('Free shipping unlocked', label + ' includes free standard delivery.', 'dark');
    }).catch(function (err) {
      mutate(function (s2) { s2.promo = ''; });
      persistCartToApp(); renderSummary(); paintStep();
      showPromoMessage('✕ ' + ((err && err.message) || 'That code is not valid.'), 'bad');
      var field = $('#koPromo');
      if (field) field.value = '';
      toast('Promo removed', (err && err.message) || 'That code is not valid.', 'dark');
    });
  }
  function ordersEndpoint() {
    var settings = (window.__KINETIC_CONTENT__ && window.__KINETIC_CONTENT__.settings) || {};
    var fromSettings = String(settings.ordersEndpoint || '').trim();
    if (fromSettings) return fromSettings;
    return String(commerce().ordersEndpoint || '').trim();
  }
  function shippingMethods() {
    var c = commerce();
    var standard = { id: 'standard', label: 'Standard', eta: '4–6 business days', cents: c.shippingCents, freeAbove: c.freeShippingThresholdCents, tag: 'Best value' };
    var express = { id: 'express', label: 'Express', eta: '2–3 business days', cents: Math.max(2900, Math.round(c.shippingCents * 2.2)), freeAbove: null, tag: '' };
    var priority = { id: 'priority', label: 'Priority', eta: 'Next business day', cents: Math.max(4900, Math.round(c.shippingCents * 3.6)), freeAbove: null, tag: 'Fastest' };
    return [standard, express, priority];
  }
  function methodById(id) {
    var all = shippingMethods();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return all[0];
  }
  function methodCostCents(method, subtotalCents) {
    if (!method) return 0;
    if (method.freeAbove !== null && subtotalCents >= method.freeAbove) return 0;
    return Math.max(0, Number(method.cents) || 0);
  }
  function totals(state) {
    state = state || cartState();
    var c = commerce();
    var itemCount = 0, subtotal = 0;
    state.items.forEach(function (item) {
      var p = findProduct(item.id); if (!p) return;
      itemCount += item.qty;
      subtotal += priceCents(p) * item.qty;
    });
    var promo = String(state.promo || '').toUpperCase();
    var applied = (promo && itemCount > 0) ? resolvePromo(promo, subtotal) : { ok: false };
    var promoOn = !!(applied && applied.ok);
    var discount = promoOn ? applied.discountCents : 0;
    var method = methodById(draft.shipping || 'standard');
    var shipping = itemCount ? methodCostCents(method, subtotal - discount) : 0;
    return {
      itemCount: itemCount,
      subtotalCents: subtotal,
      discountCents: discount,
      promoActive: promoOn,
      promoLabel: promoOn ? applied.label : '',
      shippingCents: shipping,
      method: method,
      totalCents: Math.max(0, subtotal - discount + shipping),
      freeShippingRemainingCents: Math.max(0, c.freeShippingThresholdCents - subtotal)
    };
  }

  /* ------------------------------------------------------------------ draft */
  var draft = {
    step: 1,
    customer: { name: '', email: '', phone: '', address: '', city: '', country: '' },
    shipping: 'standard',
    payment: 'card'
  };
  function loadDraft() {
    var saved = readJSON(CHECKOUT_KEY, null);
    if (saved && typeof saved === 'object') {
      if (saved.customer) { for (var k in draft.customer) if (typeof saved.customer[k] === 'string') draft.customer[k] = saved.customer[k]; }
      if (saved.shipping) draft.shipping = String(saved.shipping);
      if (saved.payment) draft.payment = String(saved.payment);
    }
  }
  function saveDraft() { writeJSON(CHECKOUT_KEY, draft); }

  /* ------------------------------------------------------- account sign-in
     When a customer is signed in, their profile + default address fill any
     field the draft does not already have. A bag carried over from a previous
     session is never overwritten, and guests are untouched. */
  function account() {
    try { return window.KINETIC_AUTH || null; } catch (e) { return null; }
  }
  function prefillFromAccount() {
    var auth = account();
    if (!auth || typeof auth.user !== 'function' || !auth.user()) return false;
    var user = auth.user();
    var addr = (typeof auth.defaultAddress === 'function' && auth.defaultAddress()) || null;
    var filled = false;
    function put(key, value) {
      if (!value) return;
      if (draft.customer[key]) return;          /* never overwrite what the customer typed */
      draft.customer[key] = String(value);
      filled = true;
    }
    put('name', user.name);
    put('email', user.email);
    put('phone', (addr && addr.phone) || user.phone);
    if (addr) {
      put('address', [addr.line1, addr.line2].filter(Boolean).join(', '));
      put('city', addr.city);
      put('country', addr.country);
    }
    if (filled) saveDraft();
    return filled;
  }
  function accountBadgeHTML() {
    var auth = account();
    if (!auth || typeof auth.user !== 'function' || !auth.user()) return '';
    var user = auth.user();
    return '<div class="ko-account" id="koAccount">' +
      '<span class="ko-account-k">Signed in as</span>' +
      '<b>' + esc(user.name) + '</b>' +
      '<span class="ko-account-e">' + esc(user.email) + '</span>' +
      '<button type="button" class="ko-account-b" data-ko-account="switch">Not you? Sign out</button>' +
      '</div>';
  }

  function bindAccountSwitch(scope) {
    var btn = scope && scope.querySelector ? scope.querySelector('[data-ko-account="switch"]') : null;
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var auth = account();
      if (!auth) return;
      auth.logout({ reason: 'logout' }).then(function () {
        draft.customer = { name: '', email: '', phone: '', address: '', city: '', country: '' };
        saveDraft();
        paintStep();
        toast('Signed out', 'Your bag and delivery details are still here.', 'dark');
      });
    });
  }

  /* ----------------------------------------------------------------- toasts */
  function toastHost() {
    var host = $('#koToasts');
    if (!host) { host = document.createElement('div'); host.id = 'koToasts'; host.setAttribute('aria-live', 'polite'); host.setAttribute('aria-atomic', 'false'); document.body.appendChild(host); }
    return host;
  }
  function toast(title, message, kind) {
    var host = toastHost();
    var el = document.createElement('div');
    el.className = 'ko-toast' + (kind === 'dark' ? ' dark' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = '<b>' + esc(title || 'KINETIC') + '</b>' + (message ? esc(message) : '');
    host.appendChild(el);
    window.setTimeout(function () {
      el.classList.add('out');
      window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 3400);
  }

  /* -------------------------------------------------------------- validation */
  function fieldError(field) {
    var box = $('[data-err="' + field + '"]');
    var input = $('[data-field="' + field + '"]');
    var message = validate[field] ? validate[field](String(draft.customer[field] || '')) : '';
    if (box) { box.textContent = message; box.classList.toggle('on', !!message); }
    if (input) {
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message) input.setAttribute('aria-describedby', 'koErr_' + field); else input.removeAttribute('aria-describedby');
    }
    return !message;
  }
  function validateFieldNow(field) { return fieldError(field); }
  var validate = {
    name: function (v) {
      v = v.trim();
      if (!v) return 'Enter the full name for this order.';
      if (v.length < 3) return 'That name looks too short.';
      if (!/^[\p{L}][\p{L}\s'.-]*$/u.test(v)) return 'Use letters only (hyphens and apostrophes are fine).';
      return '';
    },
    email: function (v) {
      v = v.trim();
      if (!v) return 'Enter an email — it is saved as your order contact only; no receipt email is sent.';
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return 'That email address is not valid.';
      return '';
    },
    phone: function (v) {
      v = v.trim();
      if (!v) return 'Enter a phone number for delivery updates.';
      var digits = v.replace(/[^\d]/g, '');
      if (digits.length < 7 || digits.length > 15) return 'Enter a valid phone number (7–15 digits).';
      if (!/^[+\d][\d\s()\-.]*$/.test(v)) return 'Phone numbers can only contain digits, spaces, + ( ) and dashes.';
      return '';
    },
    address: function (v) {
      v = v.trim();
      if (!v) return 'Enter the street address for delivery.';
      if (v.length < 6) return 'Please add a little more detail (street and number).';
      return '';
    },
    city: function (v) {
      v = v.trim();
      if (!v) return 'Enter your city.';
      if (v.length < 2) return 'That city name looks too short.';
      return '';
    },
    country: function (v) {
      if (!String(v || '').trim()) return 'Select your country.';
      return '';
    }
  };
  function validateAll() {
    var firstBad = null;
    ['name', 'email', 'phone', 'address', 'city', 'country'].forEach(function (field) {
      var ok = fieldError(field);
      if (!ok && !firstBad) firstBad = field;
    });
    return firstBad;
  }

  /* ==================================================================== views */
  var checkoutEl = null, orderEl = null;
  var stepTitles = { 1: 'Your details', 2: 'Delivery speed', 3: 'Payment' };

  function ensureRoots() {
    checkoutEl = $('#checkoutView');
    orderEl = $('#orderView');
    if (!checkoutEl) return false;
    return true;
  }

  /* ------------------------------------------------------------- rendering UI */
  function stepMarkup() {
    var labels = ['Bag', 'Details', 'Shipping', 'Payment', 'Done'];
    var activeIndex = draft.step; // 1..3 map to 1..3, step 4 = payment, done = 5
    var current = draft.step + 1;
    if (draft.step === 4) current = 4;
    var html = '<div class="ko-steps" role="list" aria-label="Checkout progress">';
    labels.forEach(function (label, i) {
      var n = i + 1;
      var cls = 'ko-step';
      if (n < current) cls += ' is-done';
      if (n === current) cls += ' is-active';
      html += '<div class="' + cls + '" role="listitem" aria-current="' + (n === current ? 'step' : 'false') + '">' +
        '<span class="ko-dot" aria-hidden="true">' + (n < current ? '✓' : n) + '</span><span>' + esc(label) + '</span></div>';
      if (i < labels.length - 1) html += '<span class="ko-step-line" aria-hidden="true"></span>';
    });
    return html + '</div>';
  }

  function renderSummaryHTML() {
    var state = refreshFromStore();
    var t = totals(state);
    var lines = state.items.map(function (item, index) {
      var p = findProduct(item.id);
      if (!p) return '';
      var hex = colorHexFor(item, p);
      return '<div class="ko-line" data-line="' + index + '">' +
        '<span class="ko-line-img"><img src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async" data-ko-img="1" width="1100" height="733" />' +
        '<span class="ko-qty-badge" aria-hidden="true">' + item.qty + '</span></span>' +
        '<div class="ko-line-b">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">' +
            '<div class="ko-line-t">' + esc(p.name) + '</div>' +
            '<button type="button" class="ko-line-x" data-ko-remove="' + index + '" aria-label="Remove ' + esc(p.name) + ' from your order">✕</button>' +
          '</div>' +
          '<div class="ko-line-m">US ' + esc(item.size) + ' <span style="color:' + esc(hex) + '">●</span> ' + esc(item.colorName) +
            (item.qty > 1 ? ' · ' + item.qty + ' × ' + money(priceCents(p)) : '') + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<span class="ko-qty">' +
              '<button type="button" data-ko-minus="' + index + '" aria-label="Decrease quantity of ' + esc(p.name) + '"' + (item.qty <= 1 ? ' disabled' : '') + '>−</button>' +
              '<span aria-label="Quantity">' + item.qty + '</span>' +
              '<button type="button" data-ko-plus="' + index + '" aria-label="Increase quantity of ' + esc(p.name) + '"' + (item.qty >= MAX_QTY ? ' disabled' : '') + '>+</button>' +
            '</span>' +
            '<span class="ko-line-p">' + money(priceCents(p) * item.qty) + '</span>' +
          '</div>' +
        '</div></div>';
    }).join('');

    var empty = !state.items.length;
    var c = commerce();
    var body = empty
      ? '<div class="ko-empty" style="padding:34px 6px">' +
          '<div class="ko-empty-mark">Empty</div>' +
          '<p>Nothing in the bag yet.</p>' +
          '<button type="button" class="ko-btn ko-btn-sm" data-ko-shop="1" style="margin-top:18px">Continue shopping <span aria-hidden="true">→</span></button>' +
        '</div>'
      : '<div class="ko-items">' + lines + '</div>' +
        '<div class="ko-promo">' +
          '<label class="ko-sr" for="koPromo">Promo code</label>' +
          '<input id="koPromo" class="ko-in" type="text" inputmode="text" autocomplete="off" placeholder="Promo code" value="' + esc(state.promo || '') + '" />' +
          '<button type="button" data-ko-promo="1">Apply</button>' +
        '</div>' +
        '<div class="ko-msg" id="koPromoMsg" role="status" aria-live="polite"></div>' +
        '<div class="ko-totals">' +
          '<div class="ko-trow"><span>Subtotal</span><b data-ko="subtotal">' + money(t.subtotalCents) + '</b></div>' +
          '<div class="ko-trow ko-disc"><span>Discount' + (t.promoActive ? ' (' + esc(t.promoLabel) + ')' : '') + '</span><b data-ko="discount">' + (t.discountCents ? '−' + money(t.discountCents) : money(0)) + '</b></div>' +
          '<div class="ko-trow"><span>Shipping — ' + esc(t.method.label) + '</span><b data-ko="shipping">' + (t.shippingCents === 0 ? 'FREE' : money(t.shippingCents)) + '</b></div>' +
        '</div>' +
        '<div class="ko-grand"><span>Order total</span><b data-ko="total">' + money(t.totalCents) + '</b></div>' +
        (t.freeShippingRemainingCents > 0 && t.itemCount
          ? '<div class="ko-shipnote">Add <b>' + money(t.freeShippingRemainingCents) + '</b> more to unlock <b>free standard shipping</b>.</div>'
          : (t.itemCount ? '<div class="ko-shipnote"><b>Free standard shipping unlocked.</b> Nice.</div>' : '')) +
        '<div class="ko-trust"><span>✓ 30-day returns</span><span>✓ 2-year warranty</span><span>✓ Secure checkout</span></div>';

    return { body: body, empty: empty, totals: t };
  }

  function renderSummary() {
    var host = $('#koSummary');
    if (!host) return;
    var out = renderSummaryHTML();
    host.innerHTML = out.body;
    var head = $('#koSumHeadPrice');
    if (head) head.textContent = money(out.totals.totalCents);
    var items = $('#koSumHeadItems');
    if (items) items.textContent = out.totals.itemCount + (out.totals.itemCount === 1 ? ' item' : ' items');
    if (!out.empty) bindSummary();
    var shopBtn = $('[data-ko-shop]', host);
    if (shopBtn) shopBtn.addEventListener('click', function () { close(true); });
  }

  function bindSummary() {
    var host = $('#koSummary');
    if (!host) return;
    $$('[data-ko-remove]', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-ko-remove'), 10);
        var state = cartState();
        var removed = state.items[i] ? findProduct(state.items[i].id) : null;
        mutate(function (s) { s.items.splice(i, 1); });
        toast('Removed', removed ? removed.name + ' removed from your order.' : 'Item removed.', 'dark');
        renderSummary(); paintStep();
      });
    });
    $$('[data-ko-minus]', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-ko-minus'), 10);
        mutate(function (s) { if (s.items[i]) s.items[i].qty = Math.max(1, s.items[i].qty - 1); });
        renderSummary(); paintStep();
      });
    });
    $$('[data-ko-plus]', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-ko-plus'), 10);
        var capped = false;
        mutate(function (s) {
          if (!s.items[i]) return;
          if (s.items[i].qty >= MAX_QTY) { capped = true; return; }
          s.items[i].qty = Math.min(MAX_QTY, s.items[i].qty + 1);
        });
        if (capped) toast('Maximum 9 per style', 'Need more? Contact the store for bulk orders.', 'dark');
        renderSummary(); paintStep();
      });
    });
    var promoBtn = $('[data-ko-promo]', host);
    var promoInput = $('#koPromo', host);
    function showPromoMessage(text, kind) {
      var msg = $('#koPromoMsg');
      if (!msg) return;
      msg.className = 'ko-msg on ' + kind;
      msg.textContent = text;
    }
    function applyPromo() {
      var value = (promoInput && promoInput.value || '').trim().toUpperCase();
      var c = commerce();
      var text = '', kind = 'bad';
      if (!value) {
        mutate(function (s) { s.promo = ''; });
        text = 'Enter a code, or leave it blank to pay full price.';
      } else {
        var snap = refreshFromStore();
        var result = resolvePromo(value, totals(snap).subtotalCents);
        if (result.ok) {
          mutate(function (s2) { s2.promo = value; });
          text = '✓ ' + result.label + ' applied.';
          kind = 'ok';
          toast('Promo applied', result.label, 'dark');
          var live = promoAnnounce();
          if (live) live.textContent = result.label + ' applied';
          confirmPromoOnServer(value);
        } else {
          mutate(function (s3) { s3.promo = ''; });
          text = '✕ ' + (result.message || 'That code is not valid.');
        }
      }
      persistCartToApp();
      renderSummary();
      paintStep();
      showPromoMessage(text, kind);   /* after the re-render, so it stays visible */
      var field = $('#koPromo');
      if (field) field.value = (cartState().promo || '');
    }
    if (promoBtn) promoBtn.addEventListener('click', applyPromo);
    if (promoInput) promoInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } });
  }

  function persistCartToApp() {
    var a = app();
    if (a && typeof a.syncCart === 'function') { try { a.syncCart(); } catch (e) {} }
  }

  /* ------------------------------------------------------------- step 1 view */
  function customerMarkup() {
    var c = draft.customer;
    function field(key, label, type, attrs, hint) {
      return '<div class="ko-field" data-fieldwrap="' + key + '">' +
        '<label class="ko-lbl" for="ko_' + key + '">' + esc(label) + '<span class="ko-req" aria-hidden="true">*</span></label>' +
        '<input class="ko-in" id="ko_' + key + '" name="' + key + '" type="' + type + '" data-field="' + key + '" value="' + esc(c[key]) + '" ' + (attrs || '') +
        ' aria-describedby="koErr_' + key + '" aria-invalid="false" autocomplete="' + (AUTOCOMPLETE[key] || 'on') + '" />' +
        '<div class="ko-err" id="koErr_' + key + '" data-err="' + key + '" role="alert"></div>' +
        (hint ? '<div class="ko-hint">' + esc(hint) + '</div>' : '') +
      '</div>';
    }
    var countryOptions = '<option value="">Select your country…</option>' + COUNTRIES.map(function (name) {
      return '<option value="' + esc(name) + '"' + (c.country === name ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('') + '<option value="Other"' + (c.country === 'Other' ? ' selected' : '') + '>Other / not listed</option>';

    return accountBadgeHTML() +
      '<form id="koInfoForm" novalidate>' +
      '<fieldset class="ko-fieldset">' +
        '<legend class="ko-legend">Contact</legend>' +
        field('name', 'Full name', 'text', 'maxlength="80" placeholder="Ayan Malik"') +
        '<div class="ko-2">' +
          field('email', 'Email', 'email', 'maxlength="120" placeholder="you@example.com"', 'Saved as your order contact only — no receipt or tracking email is sent.') +
          field('phone', 'Phone', 'tel', 'maxlength="24" placeholder="+966 50 000 0000"') +
        '</div>' +
      '</fieldset>' +
      '<fieldset class="ko-fieldset">' +
        '<legend class="ko-legend">Delivery address</legend>' +
        field('address', 'Address', 'text', 'maxlength="140" placeholder="Street, building, apartment"') +
        '<div class="ko-2">' +
          field('city', 'City', 'text', 'maxlength="60" placeholder="Jubail"') +
          '<div class="ko-field" data-fieldwrap="country">' +
            '<label class="ko-lbl" for="ko_country">Country<span class="ko-req" aria-hidden="true">*</span></label>' +
            '<select class="ko-in" id="ko_country" name="country" data-field="country" aria-describedby="koErr_country" aria-invalid="false" autocomplete="country-name">' + countryOptions + '</select>' +
            '<div class="ko-err" id="koErr_country" data-err="country" role="alert"></div>' +
          '</div>' +
        '</div>' +
      '</fieldset>' +
    '</form>';
  }
  var AUTOCOMPLETE = { name: 'name', email: 'email', phone: 'tel', address: 'street-address', city: 'address-level2', country: 'country-name' };

  /* ------------------------------------------------------------- step 2 view */
  function shippingMarkup() {
    var t = totals();
    var subtotalAfterDiscount = t.subtotalCents - t.discountCents;
    return '<div role="radiogroup" aria-label="Shipping method">' + shippingMethods().map(function (m) {
      var cost = methodCostCents(m, subtotalAfterDiscount);
      var selected = draft.shipping === m.id;
      var note = m.freeAbove && subtotalAfterDiscount < m.freeAbove
        ? 'FREE over ' + money(m.freeAbove) + ' — ' + money(m.freeAbove - subtotalAfterDiscount) + ' to go'
        : m.eta;
      return '<button type="button" class="ko-opt" role="radio" aria-checked="' + selected + '" data-ship="' + m.id + '">' +
        '<span class="ko-radio" aria-hidden="true"></span>' +
        '<span class="ko-opt-main">' +
          '<span class="ko-opt-t">' + esc(m.label) + (m.tag ? '<span class="ko-tagpill">' + esc(m.tag) + '</span>' : '') + '</span>' +
          '<span class="ko-opt-s">' + esc(note) + '</span>' +
        '</span>' +
        '<span class="ko-opt-p' + (cost === 0 ? ' free' : '') + '">' + (cost === 0 ? 'FREE' : money(cost)) + '</span>' +
      '</button>';
    }).join('') + '</div>' +
    '<div class="ko-note" style="margin-top:6px">' + ICON_SHIELD +
      '<span>Ships from the KINETIC® warehouse in discreet packaging. Duties and taxes for international orders are calculated at the border.</span></div>';
  }

  /* ------------------------------------------------------------- step 3 view */
  var PAYMENTS = [
    { id: 'card', label: 'Card', sub: 'Visa · Mastercard · Amex · Mada', tag: 'Recommended' },
    { id: 'applepay', label: 'Apple Pay', sub: 'One-tap with Face ID or Touch ID', tag: '' },
    { id: 'googlepay', label: 'Google Pay', sub: 'Pay with your saved cards', tag: '' },
    { id: 'cod', label: 'Cash on delivery', sub: 'Pay the courier — available in selected cities', tag: '' },
    { id: 'bank', label: 'Bank transfer', sub: 'No transfer details are emailed — this is a demo checkout', tag: '' }
  ];
  function paymentMarkup() {
    return '<div role="radiogroup" aria-label="Payment method">' + PAYMENTS.map(function (p) {
      var selected = draft.payment === p.id;
      return '<button type="button" class="ko-opt" role="radio" aria-checked="' + selected + '" data-pay="' + p.id + '">' +
        '<span class="ko-radio" aria-hidden="true"></span>' +
        '<span class="ko-opt-main">' +
          '<span class="ko-opt-t">' + esc(p.label) + (p.tag ? '<span class="ko-tagpill">' + esc(p.tag) + '</span>' : '') + '</span>' +
          '<span class="ko-opt-s">' + esc(p.sub) + '</span>' +
        '</span>' +
        (p.id === 'card' ? '<span class="ko-opt-p" aria-hidden="true">••••</span>' : '') +
      '</button>';
    }).join('') + '</div>' +
    '<div class="ko-cardui" aria-hidden="true">' +
      '<span class="ko-chip"></span>' +
      '<div class="ko-cardui-num">KINETIC ••••  ••••  ••••</div>' +
      '<div class="ko-cardui-row">' +
        '<div><div class="ko-cardui-lbl">Card holder</div><div class="ko-cardui-v">' + esc(draft.customer.name || 'YOUR NAME') + '</div></div>' +
        '<div><div class="ko-cardui-lbl">Expires</div><div class="ko-cardui-v">••/••</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="ko-note" style="margin-top:16px">' + ICON_LOCK +
      '<span><b>Card details are never entered on this site.</b> No payment link is sent — this is a demo checkout and no payment is collected. ' +
      'This storefront runs without a connected payment provider yet, so no money is taken at this step.</span></div>';
  }

  var ICON_LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.8" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  var ICON_SHIELD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="1.8" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/></svg>';

  /* --------------------------------------------------------------- step paint */
  function paintStep() {
    if (prefillFromAccount()) { /* account details arrived */ }
    window.setTimeout(function () { bindAccountSwitch(checkoutEl); }, 0);
    if (!checkoutEl) return;
    var t = totals();
    var host = $('#koStep');
    if (!host) return;

    if (!t.itemCount && draft.step !== 4) {
      host.innerHTML = '<div class="ko-card ko-fade">' +
        '<div class="ko-empty">' +
          '<div class="ko-empty-mark">Empty bag</div>' +
          '<p>Your bag is empty — nothing to check out.<br />Pick a pair and come back.</p>' +
          '<button type="button" class="ko-btn" data-ko-shop="1" style="margin-top:26px">Continue shopping <span aria-hidden="true">→</span></button>' +
        '</div></div>';
      var shop = $('[data-ko-shop]', host);
      if (shop) shop.addEventListener('click', function () { close(true); });
      var stepsHost = $('#koSteps');
      if (stepsHost) stepsHost.innerHTML = '';
      return;
    }

    var stepsHost = $('#koSteps');
    if (stepsHost) stepsHost.innerHTML = stepMarkup();

    if (draft.step === 1) {
      host.innerHTML = '<div class="ko-card ko-fade">' +
        '<div class="ko-eyebrow">Step 01 / 03</div>' +
        '<h2 class="ko-h" id="koStepTitle" tabindex="-1">Your details</h2>' +
        '<p class="ko-sub">Your order details. Everything is used for delivery and your receipt (saved in this browser) only.</p>' +
        customerMarkup() +
        '<div class="ko-actions">' +
          '<button type="button" class="ko-back" data-ko-shop="1">Back to shop</button>' +
          '<span class="ko-spacer"></span>' +
          /* tied to the form so pressing Enter in any field moves on */
          '<button type="submit" form="koInfoForm" class="ko-btn" id="koToShipping">Continue to shipping <span aria-hidden="true">→</span></button>' +
        '</div>' +
      '</div>';
      bindCustomerForm();
    } else if (draft.step === 2) {
      host.innerHTML = '<div class="ko-card ko-fade">' +
        '<div class="ko-eyebrow">Step 02 / 03</div>' +
        '<h2 class="ko-h" id="koStepTitle" tabindex="-1">Delivery speed</h2>' +
        '<p class="ko-sub">Standard is free over ' + money(commerce().freeShippingThresholdCents) + '. Need it sooner? Express and Priority ship the same day when ordered before 4pm.</p>' +
        '<div class="ko-field"><span class="ko-lbl">Shipping to</span>' +
          '<div class="ko-hint" style="font-size:12.5px;color:rgba(245,240,234,.72)">' + esc(draft.customer.name) + ' · ' + esc(draft.customer.address) + ', ' + esc(draft.customer.city) + ', ' + esc(draft.customer.country) + '</div>' +
          '<button type="button" class="ko-back" style="padding-left:0" data-ko-goto="1">Edit details</button>' +
        '</div>' +
        shippingMarkup() +
        '<div class="ko-actions">' +
          '<button type="button" class="ko-back" data-ko-goto="1">Back</button>' +
          '<span class="ko-spacer"></span>' +
          '<button type="button" class="ko-btn" id="koToPayment">Continue to payment <span aria-hidden="true">→</span></button>' +
        '</div>' +
      '</div>';
      bindShipping();
    } else if (draft.step === 3) {
      host.innerHTML = '<div class="ko-card ko-fade">' +
        '<div class="ko-eyebrow">Step 03 / 03</div>' +
        '<h2 class="ko-h" id="koStepTitle" tabindex="-1">Payment</h2>' +
        '<p class="ko-sub">Choose how you would pay in a live store. Nothing is charged here — this is a demo checkout.</p>' +
        paymentMarkup() +
        '<div class="ko-note" style="margin-top:16px">' + ICON_SHIELD +
          '<span>By placing this order you agree to the KINETIC® <b>terms of sale</b> and <b>privacy policy</b>. You can cancel within 24 hours free of charge.</span></div>' +
        '<div class="ko-actions">' +
          '<button type="button" class="ko-back" data-ko-goto="2">Back</button>' +
          '<span class="ko-spacer"></span>' +
          '<button type="button" class="ko-btn" id="koPlace">Place order · <span data-ko="placeTotal">' + money(t.totalCents) + '</span>' +
            '<span class="ko-spin" aria-hidden="true"></span>' +
          '</button>' +
        '</div>' +
      '</div>';
      bindPayment();
    }
    renderSummary();
    var title = $('#koStepTitle', host);
    if (title && !prefersReduced()) { try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); } }
    var announce = $('#koAnnounce');
    if (announce) announce.textContent = 'Step ' + draft.step + ' of 3 — ' + stepTitles[draft.step];
  }

  function bindCustomerForm() {
    var form = $('#koInfoForm');
    if (!form) return;
    ['name', 'email', 'phone', 'address', 'city', 'country'].forEach(function (key) {
      var input = $('[data-field="' + key + '"]', form);
      if (!input) return;
      input.addEventListener('input', function () {
        draft.customer[key] = input.value;
        if (input.getAttribute('aria-invalid') === 'true') fieldError(key);
        saveDraft();
      });
      input.addEventListener('blur', function () {
        draft.customer[key] = input.value;
        if (input.value.trim()) fieldError(key);
        saveDraft();
      });
      input.addEventListener('change', function () { draft.customer[key] = input.value; fieldError(key); saveDraft(); });
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); goToShipping(); });
    /* Guarded: bindCustomerForm re-runs on every step render, so without this
       each "Continue shopping" button would collect a new listener and fire
       close(true) — and its toast — once per render. */
    $$('[data-ko-shop]').forEach(function (b) { if (b.dataset.koShopBound) return; b.dataset.koShopBound = '1'; b.addEventListener('click', function () { close(true); }); });
  }

  function goToShipping() {
    var firstBad = validateAll();
    if (firstBad) {
      var wrap = $('[data-fieldwrap="' + firstBad + '"]');
      if (wrap) { wrap.classList.remove('shake'); void wrap.offsetWidth; wrap.classList.add('shake'); }
      var input = $('[data-field="' + firstBad + '"]');
      if (input) { try { input.focus({ preventScroll: false }); } catch (e) { input.focus(); } }
      toast('Check your details', 'Some fields need your attention.', 'dark');
      announce('Please fix the highlighted fields.');
      return;
    }
    draft.step = 2; saveDraft(); renderStepTransition();
  }

  function promoAnnounce() { return $('#koAnnounce'); }
  function announce(text) {
    var el = $('#koAnnounce');
    if (el) el.textContent = text;
  }

  function renderStepTransition() {
    var host = $('#koStep');
    if (!host) return;
    if (prefersReduced()) { paintStep(); return; }
    host.innerHTML = '<div class="ko-card"><div class="ko-loading">' +
      '<p>Preparing step ' + draft.step + ' of 3</p>' +
      '<div class="ko-loadbar"><i></i></div>' +
      '<div style="margin-top:26px"><div class="ko-skel" style="height:16px;width:38%;margin:0 auto 12px"></div>' +
      '<div class="ko-skel" style="height:52px;margin:0 auto 12px;max-width:520px"></div>' +
      '<div class="ko-skel" style="height:52px;margin:0 auto;max-width:520px"></div></div>' +
    '</div></div>';
    window.setTimeout(paintStep, 260);
  }

  function bindShipping() {
    $$('[data-ship]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        draft.shipping = btn.getAttribute('data-ship');
        saveDraft();
        $$('[data-ship]').forEach(function (b) { b.setAttribute('aria-checked', String(b === btn)); });
        renderSummary();
        var placeTotal = $('[data-ko="placeTotal"]');
        if (placeTotal) placeTotal.textContent = money(totals().totalCents);
      });
    });
    var next = $('#koToPayment');
    if (next) next.addEventListener('click', function () { draft.step = 3; saveDraft(); renderStepTransition(); });
    $$('[data-ko-goto="1"]').forEach(function (b) {
      b.addEventListener('click', function () { draft.step = 1; saveDraft(); renderStepTransition(); });
    });
  }
  function bindPayment() {
    $$('[data-pay]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        draft.payment = btn.getAttribute('data-pay');
        saveDraft();
        $$('[data-pay]').forEach(function (b) { b.setAttribute('aria-checked', String(b === btn)); });
      });
    });
    var back = $('[data-ko-goto="2"]');
    if (back) back.addEventListener('click', function () { draft.step = 2; saveDraft(); renderStepTransition(); });
    var place = $('#koPlace');
    if (place) place.addEventListener('click', placeOrder);
  }

  /* ------------------------------------------------------------- order number */
  function existingOrders() {
    var list = readJSON(ORDER_KEY, []);
    return Array.isArray(list) ? list : [];
  }
  function makeOrderNumber() {
    var taken = {};
    existingOrders().forEach(function (o) { if (o && o.number) taken[o.number] = 1; });
    var now = new Date();
    var stamp = String(now.getFullYear()).slice(2) + ('0' + (now.getMonth() + 1)).slice(-2);
    for (var attempt = 0; attempt < 40; attempt++) {
      var candidate = 'KNT-' + stamp + '-' + uid(6);
      if (!taken[candidate]) return candidate;
    }
    return 'KNT-' + stamp + '-' + Date.now().toString(36).toUpperCase().slice(-6);
  }

  /* ------------------------------------------------------------- place order */
  var placing = false;

  /* the legacy local order object — used verbatim when the API is offline, and
     as the fallback shape if the server ever answers without an order body */
  function localOrderObject(state, t, accountId) {
    return {
      number: makeOrderNumber(),
      placedAt: new Date().toISOString(),
      status: 'Awaiting payment',
      paymentStatus: 'unpaid',
      timeline: [{ at: new Date().toISOString(), label: 'Order placed in the shop' }],
      paymentMethod: draft.payment,
      paymentLabel: (PAYMENTS.filter(function (p) { return p.id === draft.payment; })[0] || {}).label || 'Card',
      shipping: { id: t.method.id, label: t.method.label, eta: t.method.eta, cents: t.shippingCents },
      accountId: accountId,
      customer: {
        name: draft.customer.name.trim(),
        email: draft.customer.email.trim(),
        phone: draft.customer.phone.trim(),
        address: draft.customer.address.trim(),
        city: draft.customer.city.trim(),
        country: draft.customer.country.trim()
      },
      items: state.items.map(function (item) {
        var p = findProduct(item.id) || { name: 'KINETIC item', price: 0, cat: '', img: '', id: item.id };
        return {
          id: item.id, name: p.name, cat: p.cat || '', img: p.img || '',
          size: item.size, color: item.color, colorName: item.colorName,
          qty: item.qty, unitCents: priceCents(p), lineCents: priceCents(p) * item.qty
        };
      }),
      promo: t.promoActive ? String(state.promo || '').toUpperCase() : '',
      subtotalCents: t.subtotalCents,
      discountCents: t.discountCents,
      shippingCents: t.shippingCents,
      totalCents: t.totalCents
    };
  }

  function placeOrder() {
    if (placing) return;
    var state = refreshFromStore();
    var t = totals(state);
    if (!t.itemCount) { toast('Empty bag', 'Add a pair before checking out.', 'dark'); paintStep(); return; }

    var firstBad = validateAll();
    if (firstBad) {
      draft.step = 1; saveDraft(); renderStepTransition();
      window.setTimeout(function () {
        var input = $('[data-field="' + firstBad + '"]');
        if (input) input.focus();
        toast('Check your details', 'Some fields need your attention.', 'dark');
      }, 320);
      return;
    }

    var btn = $('#koPlace');
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
    announce('Placing your order…');

    var accountId = (function () {
      var auth = account();
      try { return auth && auth.user && auth.user() ? auth.user().id : null; } catch (e) { return null; }
    })();

    /* the shop is backed by a real order service: stock is reserved, the price
       is calculated server-side and the order lands in the owner's dashboard */
    var api = window.KINETIC_API;
    var online = !!(api && typeof api.createOrder === 'function' && api.available());

    function payloadFor() {
      var method = t.method;
      return {
        items: state.items.map(function (item) {
          return { id: item.id, size: item.size, colorName: item.colorName || null, qty: item.qty };
        }),
        customer: {
          name: draft.customer.name.trim(),
          email: draft.customer.email.trim(),
          phone: draft.customer.phone.trim(),
          address: draft.customer.address.trim(),
          city: draft.customer.city.trim(),
          country: draft.customer.country.trim(),
          region: String(draft.customer.region || '').trim(),
          postal: String(draft.customer.postal || '').trim()
        },
        shippingId: method.id,
        shippingLabel: method.label,
        shippingEta: method.eta,
        paymentMethod: draft.payment,
        paymentLabel: (PAYMENTS.filter(function (p) { return p.id === draft.payment; })[0] || {}).label || 'Card',
        promo: t.promoActive ? String(state.promo || '').toUpperCase() : '',
        notes: String(draft.notes || '').trim()
      };
    }

    function complete(order) {
      var orders = existingOrders();
      orders.unshift(order);
      if (orders.length > 300) orders = orders.slice(0, 300);
      writeJSON(ORDER_KEY, orders);

      if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
      placing = false;

      /* empty the bag — the order is now the record */
      mutate(function (s) { s.items = []; s.promo = ''; });
      persistCartToApp();

      renderOrder(order);
      showOrderRoute(order.number);
      announce('Order ' + order.number + ' confirmed.');
      toast('Order placed', order.number + ' — receipt ready.', 'dark');
      var a = app();
      if (a && typeof a.confetti === 'function') { try { a.confetti(); } catch (e) {} }

      /* the server just moved stock — pull the catalogue back in step */
      if (api && typeof api.products === 'function' && a && typeof a.applyDbProducts === 'function') {
        api.products({ limit: 100 }).then(function (data) {
          if (data && data.products) a.applyDbProducts(data.products);
        }).catch(function () {});
      }
    }

    function fail(error) {
      if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
      placing = false;
      var message = (error && error.message) || 'We could not place that order. Try again.';
      toast('Order not placed', message, 'dark');
      announce(message);
      if (error && error.code === 'unauthorized') {
        var auth = account();
        if (auth && auth.noteSessionExpired) { try { auth.noteSessionExpired(error.message); } catch (e) {} }
      }
    }

    function syncLegacyEndpoint(order) {
      var syncUrl = ordersEndpoint();
      if (!syncUrl) return;
      try {
        fetch(syncUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'KINETIC checkout', order: order }) })
          .catch(function () { /* the order is already saved */ });
      } catch (e) { /* never block a customer's order */ }
    }

    window.setTimeout(function () {
      if (online) {
        api.createOrder(payloadFor()).then(function (data) {
          if (!data || !data.order) throw new Error('The order service did not return a receipt.');
          var order = data.order;
          if (!order.accountId) order.accountId = accountId;
          if (!order.paymentMethod) order.paymentMethod = draft.payment;
          complete(order);
          var auth = account();
          if (auth && typeof auth.refreshOrders === 'function') { try { auth.refreshOrders(); } catch (e) {} }
        }).catch(function (error) {
          fail(error);
        });
        return;
      }
      var order = localOrderObject(state, t, accountId);
      complete(order);
      syncLegacyEndpoint(order);
    }, 900);
    placing = true;
  }

  /* ------------------------------------------------------------ confirmation */
  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' +
        d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function etaFor(order) {
    var days = order.shipping.id === 'priority' ? 1 : (order.shipping.id === 'express' ? 2 : 5);
    var d = new Date(order.placedAt);
    var from = new Date(d.getTime() + days * 86400000);
    var to = new Date(d.getTime() + (days + 2) * 86400000);
    function f(x) { return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
    return f(from) + ' – ' + f(to);
  }

  function renderOrder(order) {
    if (!orderEl) return;
    var rows = order.items.map(function (it) {
      return '<div class="ko-line">' +
        '<span class="ko-line-img"><img src="' + esc(it.img) + '" alt="' + esc(it.name) + '" loading="lazy" decoding="async" data-ko-img="1" width="1100" height="733" />' +
        '<span class="ko-qty-badge" aria-hidden="true">' + it.qty + '</span></span>' +
        '<div class="ko-line-b">' +
          '<div class="ko-line-t">' + esc(it.name) + '</div>' +
          '<div class="ko-line-m">US ' + esc(it.size) + ' · ' + esc(it.colorName) + ' · Qty ' + it.qty + '</div>' +
          '<div class="ko-line-p">' + money(it.lineCents) + '</div>' +
        '</div></div>';
    }).join('');

    orderEl.innerHTML = '<div class="ko-bar"><div class="ko-bar-in">' +
        '<span class="ko-logo">KINETIC<span>®</span></span>' +
        '<div class="ko-bar-meta"><span class="ko-secure">Order confirmed</span>' +
        '<button type="button" class="ko-back" data-ko-print="1" style="padding:6px 0">Print</button>' +
        '<button type="button" class="ko-back" data-ko-close="1" style="padding:6px 0">Back to shop</button></div>' +
      '</div></div>' +

      '<div class="ko-hero">' +
        '<div class="ko-tick" aria-hidden="true"><svg viewBox="0 0 34 34" fill="none"><path d="M7 18.5l7 7L27 10" stroke="#D4AF37" stroke-width="2.6" stroke-linecap="square"/></svg></div>' +
        '<div class="ko-eyebrow">Thank you, ' + esc(order.customer.name.split(' ')[0]) + '</div>' +
        '<h1 class="ko-h" style="font-size:clamp(2rem,7vw,3.4rem)" tabindex="-1" id="koOrderTitle">Your order is in</h1>' +
        '<p class="ko-sub" style="max-width:520px;margin-left:auto;margin-right:auto">We have your order. Your receipt is saved in this browser. This is a demo checkout — no email is sent and no payment is taken.</p>' +
        '<div class="ko-order-no">Order number <b>' + esc(order.number) + '</b>' +
          '<button type="button" class="ko-copy" data-ko-copy="' + esc(order.number) + '">Copy</button></div>' +
        '<div style="margin-top:18px"><span class="ko-stamp">' + esc(order.status) + '</span></div>' +
      '</div>' +

      '<div class="ko-recap">' +
        '<dl class="ko-meta-grid">' +
          '<div class="ko-meta"><dt>Placed</dt><dd>' + esc(fmtDate(order.placedAt)) + '</dd></div>' +
          '<div class="ko-meta"><dt>Delivery</dt><dd>' + esc(order.shipping.label) + '<small>' + esc(order.shipping.eta) + ' · arrives ' + esc(etaFor(order)) + '</small></dd></div>' +
          '<div class="ko-meta"><dt>Payment</dt><dd>' + esc(order.paymentLabel) + '<small>Demo checkout — no payment link is sent</small></dd></div>' +
          '<div class="ko-meta"><dt>Shipping to</dt><dd>' + esc(order.customer.name) + '<small>' + esc(order.customer.address) + ', ' + esc(order.customer.city) + ', ' + esc(order.customer.country) + '<br>' + esc(order.customer.phone) + '</small></dd></div>' +
        '</dl>' +

        '<div class="ko-card ko-receipt" style="margin-top:26px">' +
          '<div class="ko-eyebrow">Order summary</div>' +
          '<h2 class="ko-h" style="font-size:clamp(1.4rem,4vw,1.9rem)">' + order.items.length + (order.items.length === 1 ? ' item' : ' items') + '</h2>' +
          '<div style="margin-top:14px">' + rows + '</div>' +
          '<div class="ko-receipt-rows" style="margin-top:18px">' +
            '<div class="ko-rrow"><span>Subtotal</span><b>' + money(order.subtotalCents) + '</b></div>' +
            (order.discountCents ? '<div class="ko-rrow"><span>Discount (' + esc(order.promo) + ')</span><b>−' + money(order.discountCents) + '</b></div>' : '') +
            '<div class="ko-rrow"><span>' + esc(order.shipping.label) + ' shipping</span><b>' + (order.shippingCents === 0 ? 'FREE' : money(order.shippingCents)) + '</b></div>' +
            '<div class="ko-rrow total"><span>Demo total (no payment taken)</span><b>' + money(order.totalCents) + '</b></div>' +
          '</div>' +
        '</div>' +

        '<div class="ko-card" style="margin-top:20px">' +
          '<div class="ko-eyebrow">What happens next</div>' +
          '<div class="ko-timeline" style="margin-top:16px">' +
            '<div class="ko-tl done"><div class="ko-tl-i"></div><div class="ko-tl-body"><b>Order received</b><span>' + esc(fmtDate(order.placedAt)) + ' · ' + esc(order.number) + '</span></div></div>' +
            '<div class="ko-tl now"><div class="ko-tl-i"></div><div class="ko-tl-body"><b>Payment confirmation</b><span>Demo only, no payment is taken</span></div></div>' +
            '<div class="ko-tl"><div class="ko-tl-i"></div><div class="ko-tl-body"><b>Picked and packed</b><span>Usually within one business day of payment</span></div></div>' +
            '<div class="ko-tl"><div class="ko-tl-i"></div><div class="ko-tl-body"><b>Out for delivery</b><span>' + esc(order.shipping.label) + ' · arrives ' + esc(etaFor(order)) + '</span></div></div>' +
          '</div>' +
        '</div>' +

        '<div class="ko-actions" style="justify-content:center;margin-top:30px">' +
          '<button type="button" class="ko-btn" data-ko-close="1">Continue shopping <span aria-hidden="true">→</span></button>' +
          '<button type="button" class="ko-btn ko-btn-ghost" data-ko-receipt="' + esc(order.number) + '">Download receipt</button>' +
          '<button type="button" class="ko-btn ko-btn-ghost" data-ko-copy="' + esc(order.number) + '">Copy order number</button>' +
        '</div>' +
        '<p class="ko-sub" style="text-align:center;font-size:12px;margin-top:22px">Need to change something? Contact the store with order <b style="color:#D4AF37">' + esc(order.number) + '</b> within 24 hours.</p>' +
      '</div>';

    $$('[data-ko-close]', orderEl).forEach(function (b) { b.addEventListener('click', function () { closeOrderView(true); }); });
    $$('[data-ko-copy]', orderEl).forEach(function (b) {
      b.addEventListener('click', function () {
        var value = b.getAttribute('data-ko-copy');
        copyText(value).then(function (ok) { toast(ok ? 'Copied' : 'Copy failed', ok ? value + ' is on your clipboard.' : 'Select the number and copy it manually.', 'dark'); });
      });
    });
    $$('[data-ko-print]', orderEl).forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
    $$('[data-ko-receipt]', orderEl).forEach(function (b) {
      b.addEventListener('click', function () { downloadReceipt(b.getAttribute('data-ko-receipt')); });
    });
    var title = $('#koOrderTitle', orderEl);
    if (title) { try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); } }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  function receiptText(order) {
    var line = '------------------------------------------------------------\n';
    var out = 'KINETIC® — ORDER RECEIPT\n' + line;
    out += 'Order number : ' + order.number + '\n';
    out += 'Placed       : ' + fmtDate(order.placedAt) + '\n';
    out += 'Status       : ' + order.status + '\n' + line;
    out += 'ITEMS\n';
    order.items.forEach(function (it) {
      out += '  ' + it.qty + ' × ' + it.name + ' (US ' + it.size + ', ' + it.colorName + ')\n';
      out += '      ' + money(it.unitCents) + ' each .......... ' + money(it.lineCents) + '\n';
    });
    out += line;
    out += 'Subtotal     : ' + money(order.subtotalCents) + '\n';
    if (order.discountCents) out += 'Discount (' + order.promo + ') : -' + money(order.discountCents) + '\n';
    out += 'Shipping     : ' + (order.shippingCents === 0 ? 'FREE' : money(order.shippingCents)) + '  (' + order.shipping.label + ', ' + order.shipping.eta + ')\n';
    out += 'TOTAL        : ' + money(order.totalCents) + '\n' + line;
    out += 'DELIVER TO\n  ' + order.customer.name + '\n  ' + order.customer.address + '\n  ' + order.customer.city + ', ' + order.customer.country + '\n  ' + order.customer.phone + '\n  ' + order.customer.email + '\n' + line;
    out += 'PAYMENT      : Demo checkout — no payment taken, no email sent\n';
    out += 'ESTIMATED    : ' + etaFor(order) + '\n' + line;
    out += 'KINETIC® — Zero Friction. All Attitude.\n';
    return out;
  }
  function download(name, text, type) {
    try {
      var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) { return false; }
  }
  function downloadReceipt(number) {
    var order = existingOrders().filter(function (o) { return o && o.number === number; })[0];
    if (!order) { toast('Receipt unavailable', 'Order ' + number + ' is not stored on this device.', 'dark'); return; }
    var ok = download('KINETIC-order-' + number + '.txt', receiptText(order));
    toast(ok ? 'Receipt downloaded' : 'Download blocked', ok ? 'KINETIC-order-' + number + '.txt' : 'Your browser blocked the download.', 'dark');
  }

  /* --------------------------------------------------------------- routing */
  function waitForProducts(cb) {
    if (productList().length) { cb(); return; }
    var tries = 0;
    (function check() {
      if (productList().length || tries > 80) { cb(); return; }
      tries++;
      window.setTimeout(check, 100);
    })();
  }
  function paintLoading() {
    var stepsHost = $('#koSteps');
    if (stepsHost) stepsHost.innerHTML = '';
    var state = refreshFromStore();
    var host = $('#koStep');
    if (!host) return;
    host.innerHTML = '<div class="ko-card"><div class="ko-loading">' +
      '<p>Opening your bag</p>' +
      '<div class="ko-loadbar"><i></i></div>' +
      '<div style="margin-top:30px">' +
        '<div class="ko-skel" style="height:14px;width:30%;margin:0 auto 14px"></div>' +
        '<div class="ko-skel" style="height:64px;margin:0 auto 12px;max-width:560px"></div>' +
        '<div class="ko-skel" style="height:64px;margin:0 auto;max-width:560px"></div>' +
      '</div>' +
      '<p style="margin-top:24px;opacity:.6">' + (state.items.length ? state.items.length + ' item(s) in your bag' : 'No items yet') + '</p>' +
    '</div></div>';
  }

  function open(step, opts) {
    opts = opts || {};
    if (!ensureRoots()) return false;
    refreshFromStore();
    loadDraft();
    if (step) draft.step = Math.min(3, Math.max(1, parseInt(step, 10) || 1));
    checkoutEl.classList.add('open');
    checkoutEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ko-locked');
    var gate = $('#cartDrawer');
    if (gate && gate.classList.contains('open')) {
      var a = app();
      if (a && typeof a.closeCart === 'function') { try { a.closeCart(false); } catch (e) {} }
    }
    if (productList().length) paintStep();
    else {
      paintLoading();
      waitForProducts(function () {
        if (!checkoutEl || !checkoutEl.classList.contains('open')) return;
        if ($('#koStep .ko-loading')) paintStep();
      });
    }
    if (!opts.keepScroll) checkoutEl.scrollTop = 0;
    window.setTimeout(function () {
      var target = $('#koStepTitle') || $('#koStep input');
      if (target && !opts.noFocus) { try { target.focus({ preventScroll: true }); } catch (e) {} }
    }, 120);
    return true;
  }
  function close(backToShop) {
    if (!checkoutEl) return;
    checkoutEl.classList.remove('open');
    checkoutEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ko-locked');
    if (location.hash && location.hash.indexOf('#checkout') === 0) history.replaceState(null, '', location.pathname + location.search);
    if (backToShop) {
      var a = app();
      if (a && typeof a.openCart === 'function') { /* leave the bag closed; just land on the collection */ }
      var collection = document.getElementById('collection');
      if (collection) {
        try { collection.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' }); }
        catch (e) { collection.scrollIntoView(); }
      }
      toast('Continue shopping', 'Your bag is still saved.', 'dark');
    }
  }
  function showOrderRoute(number) {
    if (checkoutEl) {
      checkoutEl.classList.remove('open');
      checkoutEl.setAttribute('aria-hidden', 'true');
    }
    try {
      var next = '#order/' + encodeURIComponent(number);
      if (location.hash !== next) { history.pushState(null, '', next); }
    } catch (e) { /* file:// or restricted — the view is open anyway */ }
    openOrderView();
  }
  function openOrderView() {
    if (!orderEl) return;
    orderEl.classList.add('open');
    orderEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ko-locked');
    orderEl.scrollTop = 0;
  }
  function closeOrderView(backToShop) {
    if (!orderEl) return;
    orderEl.classList.remove('open');
    orderEl.setAttribute('aria-hidden', 'true');
    if (!checkoutEl || !checkoutEl.classList.contains('open')) document.body.classList.remove('ko-locked');
    if (location.hash.indexOf('#order') === 0) history.replaceState(null, '', location.pathname + location.search);
    if (backToShop) { close(false); }
    if (backToShop) {
      var collection = document.getElementById('collection');
      if (collection) { try { collection.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' }); } catch (e) {} }
    }
  }

  function routeFromHash() {
    var hash = String(location.hash || '');
    if (hash.indexOf('#order/') === 0) {
      var number = decodeURIComponent(hash.slice(7));
      var order = existingOrders().filter(function (o) { return o && o.number === number; })[0];
      if (order) {
        if (checkoutEl) { checkoutEl.classList.remove('open'); checkoutEl.setAttribute('aria-hidden', 'true'); }
        renderOrder(order);
        openOrderView();
        return true;
      }
      if (orderEl) {
        orderEl.innerHTML = '<div class="ko-wrap" style="padding-top:80px"><div class="ko-card"><div class="ko-empty">' +
          '<div class="ko-empty-mark">Not found</div>' +
          '<p>We could not find order <b style="color:#D4AF37">' + esc(number) + '</b> on this device.<br>Orders are stored in the browser they were placed from.</p>' +
          '<button type="button" class="ko-btn" data-ko-close="1" style="margin-top:26px">Back to shop</button>' +
        '</div></div></div>';
        $$('[data-ko-close]', orderEl).forEach(function (b) { b.addEventListener('click', function () { closeOrderView(true); }); });
        openOrderView();
        return true;
      }
      return false;
    }
    if (hash.indexOf('#checkout') === 0) {
      var step = parseInt((hash.split('step-')[1] || ''), 10);
      if (orderEl) { orderEl.classList.remove('open'); orderEl.setAttribute('aria-hidden', 'true'); }
      open(step || 1);
      return true;
    }
    return false;
  }

  /* Keyboard users must stay inside the layer that is open, exactly like the
     bag drawer and the product modal do. */
  function activeLayer() {
    if (orderEl && orderEl.classList.contains('open')) return orderEl;
    if (checkoutEl && checkoutEl.classList.contains('open')) return checkoutEl;
    return null;
  }
  function trapFocus(event) {
    var layer = activeLayer();
    if (!layer) return;
    var focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', layer)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    var active = document.activeElement;
    var inside = layer.contains(active);
    if (event.shiftKey && (!inside || active === first)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !inside)) { event.preventDefault(); first.focus(); }
  }

  /* -------------------------------------------------------------------- boot */
  function injectStylesFallback() {
    if ($('#kineticCheckoutCss')) return;
    if ($$('link[href*="kinetic-checkout.css"]').length) { var ex = $('link[href*="kinetic-checkout.css"]'); ex.id = 'kineticCheckoutCss'; return; }
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'assets/kinetic-checkout.css'; link.id = 'kineticCheckoutCss';
    document.head.appendChild(link);
  }

  function boot() {
    injectStylesFallback();
    if (!ensureRoots()) return;
    loadDraft();
    prefillFromAccount();
    refreshFromStore();
    routeFromHash();

    window.addEventListener('hashchange', function () {
      if (!routeFromHash()) {
        if (orderEl) orderEl.classList.remove('open');
        if (checkoutEl) checkoutEl.classList.remove('open');
        document.body.classList.remove('ko-locked');
      }
    });

    /* keep this page in step with the bag drawer */
    window.addEventListener('kinetic:cart-changed', function () {
      refreshFromStore();
      if (checkoutEl && checkoutEl.classList.contains('open')) { paintStep(); }
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && orderEl && orderEl.classList.contains('open')) { closeOrderView(true); return; }
      if (e.key === 'Tab') trapFocus(e);
    });

    /* the mobile "order summary" accordion */
    var toggle = $('#koSumToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var card = $('#koSumCard');
        if (!card) return;
        var open = card.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    /* every "back to shop" control, including the ones in the top bar */
    $$('[data-ko-shop]').forEach(function (btn) {
      if (btn.dataset.koShopBound) return; btn.dataset.koShopBound = '1';
      btn.addEventListener('click', function () { close(true); });
    });

    /* image fallbacks so a broken product photo never shows a broken icon */
    document.addEventListener('error', function (e) {
      var img = e.target;
      if (img && img.tagName === 'IMG' && (img.getAttribute('data-ko-img') === '1') && !img.dataset.koFb) {
        img.dataset.koFb = '1';
        img.style.opacity = '.25';
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* ------------------------------------------------------------- public API */
  window.KINETIC_CHECKOUT = {
    version: '1.0',
    open: open,
    close: close,
    reload: function () { refreshFromStore(); if (checkoutEl && checkoutEl.classList.contains('open')) paintStep(); },
    cart: {
      load: function () { return refreshFromStore().items.slice(); },
      count: function () { return totals().itemCount; },
      totals: function () { return totals(); },
      clear: function () { mutate(function (s) { s.items = []; s.promo = ''; }); persistCartToApp(); }
    },
    orders: function () { return existingOrders(); },
    shipping: function () { return shippingMethods(); },
    prefill: function (fields) {
      var changed = false;
      Object.keys(fields || {}).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(draft.customer, key)) return;
        if (draft.customer[key]) return;
        var value = String(fields[key] || '').trim();
        if (!value) return;
        draft.customer[key] = value;
        changed = true;
      });
      if (changed) saveDraft();
      return changed;
    },
    receipt: function (number) {
      var order = existingOrders().filter(function (o) { return o && o.number === number; })[0];
      return order ? receiptText(order) : '';
    },
    /* used by kinetic-app.js to persist the drawer cart */
    store: {
      KEY: CART_KEY,
      read: function () { return { v: 1, items: cartState().items, promo: cartState().promo || '' }; },
      write: function (items, promo) {
        writeJSON(CART_KEY, { v: 1, items: items || [], promo: promo || '', savedAt: Date.now() });
      },
      changed: dispatchCartChanged
    }
  };

  /* expose a ready promise so other scripts can wait for products */
  window.KINETIC_CHECKOUT.ready = new Promise(function (resolve) {
    var tries = 0;
    (function check() {
      if (productList().length || tries > 80) { resolve(Date.now()); return; }
      tries++; window.setTimeout(check, 100);
    })();
  });
})();
