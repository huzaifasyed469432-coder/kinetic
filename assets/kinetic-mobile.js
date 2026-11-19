/* ==========================================================================
   KINETIC® — mobile enhancements
   · Header wishlist button (phones/tablets) + wishlist panel
   · Quick actions row inside the mobile menu
   · Responsive images: picks the 480w/900w variant when available
   Everything is additive and defensive: if the shop app is missing, this
   file does nothing at all. Requires assets/kinetic-mobile.css.
   ========================================================================== */
(function () {
  'use strict';

  var MOBILE = '(max-width:1023px)';
  var PHONE = '(max-width:430px)';
  var mqMobile = window.matchMedia ? window.matchMedia(MOBILE) : null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function app() { return window.KINETIC_APP || null; }
  function reduce() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------- wishlist UI */
  var panel = null, scrim = null, returnFocus = null, built = false;

  function wishlistIds() {
    try { var a = app(); if (a && a.wishlist && a.wishlist.all) return a.wishlist.all() || []; } catch (e) {}
    try { var raw = JSON.parse(localStorage.getItem('kinetic-wishlist-v1')); if (Array.isArray(raw)) return raw; } catch (e) {}
    return [];
  }

  function productOf(id) {
    var a = app();
    if (!a) return null;
    try { return a.getProductById ? a.getProductById(id) : null; } catch (e) { return null; }
  }

  function headerButtonHTML() {
    return '' +
      '<button id="wishBtn" type="button" aria-label="Saved items" aria-controls="wishPanel" aria-expanded="false" ' +
        'title="Saved items">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">' +
          '<path d="M12 20s-7-4.5-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.5 12 20 12 20z"/>' +
        '</svg>' +
        '<span class="wish-count" aria-hidden="true">0</span>' +
      '</button>';
  }

  function buildPanel() {
    if (built) return;
    built = true;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="wishScrim" hidden></div>' +
      '<aside id="wishPanel" role="dialog" aria-modal="true" aria-label="Saved items" aria-hidden="true" inert>' +
        '<div class="wp-head"><div><div class="wp-k">KINETIC / saved</div><h2>Wishlist</h2></div>' +
          '<button type="button" class="wp-close" data-wp="close" aria-label="Close saved items">✕</button></div>' +
        '<div class="wp-body" id="wishBody"></div>' +
        '<div class="wp-foot" id="wishFoot">Tap a saved pair to pick a size and add it to your bag.</div>' +
      '</aside>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    panel = $('#wishPanel');
    scrim = $('#wishScrim');
    if (scrim) scrim.addEventListener('click', close);
    if (panel) {
      panel.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-wp]') : null;
        if (!t) return;
        var act = t.getAttribute('data-wp');
        var id = t.getAttribute('data-id');
        if (act === 'close') { close(); return; }
        if (act === 'open') {   /* pick size + colour in the quick view */
          close();
          var a = app();
          if (a && a.openQuickView) { try { a.openQuickView(id); } catch (err) {} }
          return;
        }
        if (act === 'remove') {
          var w = app() && app().wishlist;
          if (w && w.toggle) { try { w.toggle(id); } catch (err) {} }
          renderItems(); syncCount();
        }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel && panel.classList.contains('on')) { e.preventDefault(); close(); }
    });
  }

  function renderItems() {
    var body = $('#wishBody');
    if (!body) return;
    var ids = wishlistIds().map(function (x) { return String(x); });
    var items = ids.map(productOf).filter(Boolean);
    var foot = $('#wishFoot');
    if (!items.length) {
      body.innerHTML = '<div class="wp-empty">Nothing saved yet —<br>tap the ♡ on any pair.</div>';
      if (foot) foot.textContent = 'Your saved pairs stay on this device.';
      return;
    }
    body.innerHTML = items.map(function (p) {
      var price = Number(p.price) || 0;
      var old = Number(p.old) || 0;
      var img = p.img || (p.images && p.images[0]) || '';
      return '<div class="wp-item">' +
        '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async" width="74" height="74" />' +
        '<div style="min-width:0">' +
          '<div class="wp-name">' + esc(p.name) + '</div>' +
          '<div class="wp-meta">' + esc(p.cat || '') + ' · $' + price.toLocaleString('en-US') +
            (old > price ? ' <span style="text-decoration:line-through;opacity:.6">$' + old.toLocaleString('en-US') + '</span>' : '') + '</div>' +
          '<div class="wp-acts">' +
            '<button type="button" class="wp-add" data-wp="open" data-id="' + esc(p.id) + '">Choose size →</button>' +
            '<button type="button" class="wp-remove" data-wp="remove" data-id="' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + ' from saved items">✕</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    if (foot) foot.textContent = items.length + (items.length === 1 ? ' saved pair' : ' saved pairs') + ' · stays on this device';
  }

  function open() {
    buildPanel();
    if (!panel) return;
    returnFocus = document.activeElement;
    renderItems();
    panel.classList.add('on');
    panel.setAttribute('aria-hidden', 'false');
    if ('inert' in panel) panel.inert = false;
    if (scrim) { scrim.hidden = false; requestAnimationFrame(function () { scrim.classList.add('on'); }); }
    document.body.classList.add('wish-open');
    var btn = $('#wishBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    var f = panel.querySelector('button');
    if (f) window.setTimeout(function () { try { f.focus(); } catch (e) {} }, 140);
  }

  function close() {
    if (!panel || !panel.classList.contains('on')) return;
    panel.classList.remove('on');
    panel.setAttribute('aria-hidden', 'true');
    if ('inert' in panel) panel.inert = true;
    if (scrim) { scrim.classList.remove('on'); window.setTimeout(function () { if (!scrim.classList.contains('on')) scrim.hidden = true; }, 340); }
    document.body.classList.remove('wish-open');
    var btn = $('#wishBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (returnFocus && document.contains(returnFocus)) { try { returnFocus.focus(); } catch (e) {} }
    returnFocus = null;
  }

  function syncCount() {
    var btn = $('#wishBtn');
    if (!btn) return;
    var n = wishlistIds().length;
    btn.classList.toggle('has-items', n > 0);
    var badge = btn.querySelector('.wish-count');
    if (badge) badge.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? 'Saved items (' + n + ')' : 'Saved items');
  }

  /* a compact bag icon for phones — the "Bag" wordmark stays on tablets/desktop */
  function installBagIcon() {
    var cart = $('#cartBtn');
    if (!cart || $('#mobBagIcon')) return;
    var icon = document.createElement('span');
    icon.id = 'mobBagIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
      '<path d="M6 7.5h12L17 20H7L6 7.5z"/><path d="M9.2 7.5a2.8 2.8 0 0 1 5.6 0"/></svg>';
    cart.insertBefore(icon, cart.firstChild);
  }

  function installHeaderButton() {
    var header = $('#siteHeader');
    if (!header || $('#wishBtn')) return;
    var cart = $('#cartBtn');
    var host = cart ? cart.parentNode : null;
    if (!host) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = headerButtonHTML();
    var btn = tmp.firstChild;
    host.insertBefore(btn, cart);
    btn.addEventListener('click', open);
  }

  /* quick actions inside the full-screen mobile menu */
  function installMenuActions() {
    var menu = $('#mobileMenu');
    if (!menu || $('#mobActions')) return;
    var row = document.createElement('div');
    row.className = 'mob-actions';
    row.id = 'mobActions';
    row.innerHTML =
      '<button type="button" data-mob="search">Search</button>' +
      '<button type="button" data-mob="wish">Wishlist</button>' +
      '<button type="button" data-mob="cart">Bag</button>';
    var footer = menu.lastElementChild;
    menu.insertBefore(row, footer);
    row.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-mob]') : null;
      if (!b) return;
      var what = b.getAttribute('data-mob');
      if (menu.classList.contains('open')) {
        var closeBtn = $('#menuClose');
        if (closeBtn) closeBtn.click();
      }
      window.setTimeout(function () {
        if (what === 'search') { var s = $('#searchBtn'); if (s) s.click(); }
        else if (what === 'cart') { var c = $('#cartBtn'); if (c) c.click(); }
        else open();
      }, 260);
    });
  }

  /* ------------------------------------------------------- responsive images */
  var imagesReady = false, queue = null;

  function sizesFor(img) {
    if (img.id === 'heroShoe' || (img.closest && img.closest('.hero, #top'))) return '100vw';
    if (img.closest && img.closest('.p-card')) return '(max-width:640px) 92vw, (max-width:1024px) 46vw, 24vw';
    if (img.closest && img.closest('#productView, #productModal, .kp-gallery')) return '(max-width:640px) 92vw, 46vw';
    return '(max-width:640px) 92vw, 50vw';
  }

  function upgradeImage(img) {
    if (!img || !img.getAttribute || img.dataset.mSrc) return;
    var src = img.getAttribute('src') || '';
    var m = /^assets\/images\/([A-Za-z0-9._-]+)\.svg$/i.exec(src);
    if (!m) return;
    var name = m[1];
    img.dataset.mSrc = '1';
    var base = 'assets/images/m/' + name;
    /* if a variant were ever missing the browser simply falls back along srcset */
    img.setAttribute('srcset', base + '-480.svg 480w, ' + base + '-900.svg 900w, assets/images/' + name + '.svg 1100w');
    if (!img.getAttribute('sizes')) img.setAttribute('sizes', sizesFor(img));
    if (!img.getAttribute('decoding')) img.setAttribute('decoding', 'async');
    /* an image that already finished loading keeps its old candidate until we re-select */
    if (img.complete && img.naturalWidth) {
      try { img.src = src; } catch (e) {}
    }
  }

  function upgradeAll(root) {
    if (!imagesReady) return;
    var scope = (root && root.querySelectorAll) ? root : document;
    if (scope.tagName === 'IMG') { upgradeImage(scope); return; }
    $$('img[src]', scope).forEach(upgradeImage);
  }

  function scheduleUpgrade(root) {
    if (!imagesReady) return;
    if (queue) window.cancelAnimationFrame(queue);
    queue = window.requestAnimationFrame(function () { upgradeAll(root); });
  }

  function watchImages() {
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(function (records) {
      var touched = false;
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'attributes' && r.target && r.target.tagName === 'IMG') { scheduleUpgrade(r.target); continue; }
        for (var j = 0; j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IMG') { touched = true; }
          else if (n.querySelector && n.querySelector('img')) { touched = true; }
          if (touched) scheduleUpgrade(n);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  function initImages() {
    imagesReady = true;
    upgradeAll(document);
    watchImages();
    /* the first product row sits above the fold on a phone: load it eagerly */
    var grid = $('#productGrid');
    if (grid) {
      $$('img', grid).slice(0, 4).forEach(function (img) {
        img.loading = 'eager';
        if (!img.getAttribute('fetchpriority')) img.setAttribute('fetchpriority', 'high');
      });
    }
  }

  /* --------------------------------------------------------------- boot + keep */
  function boot() {
    installHeaderButton();
    installBagIcon();
    installMenuActions();
    syncCount();
    initImages();
    /* the shop toggles wishlist from its own buttons — re-sync after any of them */
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var b = t.closest('[aria-label*="wishlist" i], [data-wishlist], #modalWishlist');
      if (b) window.setTimeout(syncCount, 60);
    }, true);
    window.addEventListener('storage', function (e) { if (!e.key || /wish/i.test(e.key)) syncCount(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) syncCount(); });
    window.setInterval(function () { if (!document.hidden) syncCount(); }, 2500);
    document.addEventListener('kinetic:content-changed', function () { syncCount(); if (panel && panel.classList.contains('on')) renderItems(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.setTimeout(boot, 60); });
  else window.setTimeout(boot, 60);

  /* debug surface */
  window.KINETIC_MOBILE = {
    version: '1.0',
    wishlist: { open: open, close: close, refresh: function () { renderItems(); syncCount(); } },
    _internal: { upgradeImage: upgradeImage, syncCount: syncCount, sizesFor: sizesFor }
  };
})();
