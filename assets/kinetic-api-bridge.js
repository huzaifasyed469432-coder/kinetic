/* ============================================================================
   KINETIC® — store ↔ API bridge
   ----------------------------------------------------------------------------
   Loaded after kinetic-api.js. It decides, once per page load, whether the
   shop is running against the live commerce API:

     • the catalogue (price, sale price, colourways, per-size stock) comes from
       the database and is cached so a repeat visit paints instantly;
     • accounts sign in against real server sessions (httpOnly cookie), so the
       customer's wishlist and order history follow them to any device;
     • the browser stays the source of truth for the *cart*, which is exactly
       what keeps the bag alive across a sign-in.

   If the API never answers, every step here is skipped and the storefront runs
   on content.json + localStorage exactly as it did before. Nothing in the UI
   is allowed to break because the backend is down.
   ========================================================================== */
(function () {
  'use strict';

  var CATALOGUE_KEY = 'kinetic-catalogue-cache-v2';
  var CATALOGUE_TTL = 5 * 60 * 1000;
  var WISH_KEY = 'kinetic-wishlist-v1';
  var waiting = [];

  function api() { return window.KINETIC_API || null; }
  function app() { return window.KINETIC_APP || null; }
  function auth() { return window.KINETIC_AUTH || null; }

  function readCache() {
    try {
      var raw = sessionStorage.getItem(CATALOGUE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.products) || !parsed.products.length) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function writeCache(products) {
    try {
      sessionStorage.setItem(CATALOGUE_KEY, JSON.stringify({ at: Date.now(), products: products }));
    } catch (e) { /* private mode: the network fetch still runs */ }
  }

  /* ---- 1. instant paint from the last visit (no flicker of stale prices) --- */
  var cached = readCache();
  if (cached) {
    window.__KINETIC_DB_PRODUCTS__ = cached.products;
    window.__KINETIC_DB_CACHED_AT__ = cached.at;
  }

  function whenApp(fn, tries) {
    if (app()) { fn(app()); return; }
    tries = tries || 0;
    if (tries > 100) return;                       /* give up after ~10s */
    window.setTimeout(function () { whenApp(fn, tries + 1); }, 100);
  }
  if (cached) whenApp(function (a) { a.applyDbProducts(cached.products); });

  /* ---- 2. the live catalogue ---------------------------------------------- */
  var catalogueInFlight = null;
  function syncCatalogue(opts) {
    opts = opts || {};
    var client = api();
    if (!client || !client.available()) return Promise.resolve(null);
    if (catalogueInFlight && !opts.force) return catalogueInFlight;
    catalogueInFlight = client.products({ limit: 100 }).then(function (data) {
      var products = (data && data.products) || [];
      if (!products.length) return null;
      writeCache(products);
      window.__KINETIC_DB_PRODUCTS__ = products;
      whenApp(function (a) {
        a.applyDbProducts(products);
        var live = document.getElementById('kineticLiveRegion');
        if (live && opts.announce) live.textContent = 'Catalogue updated from the store.';
      });
      return products;
    }).catch(function () { return null; }).then(function (out) {
      catalogueInFlight = null;
      return out;
    });
    return catalogueInFlight;
  }

  function syncConfig() {
    var client = api();
    if (!client || !client.available()) return Promise.resolve(null);
    return client.config().then(function (data) {
      whenApp(function (a) { if (a.applyDbConfig) a.applyDbConfig(data); });
      return data;
    }).catch(function () { return null; });
  }

  /* ---- 3. accounts ------------------------------------------------------- */
  function wireAuth() {
    var a = auth(); var client = api();
    if (!a || !client) return;
    a.configure({
      adapter: 'http',
      baseUrl: client.base,
      endpoints: {
        signup: '/auth/signup',
        login: '/auth/login',
        logout: '/auth/logout',
        session: '/auth/session',
        requestReset: '/auth/forgot',
        resetPassword: '/auth/reset',
        changePassword: '/auth/password',
        profile: '/auth/profile',
        deleteAccount: '/auth/account',
        addresses: '/auth/addresses',
        orders: '/orders'
      }
    });
  }

  /* a reset code is generated server-side; when this deployment has no mailer
     the API hands the code back so the flow stays testable end to end */
  function wireResetDelivery() {
    var a = auth();
    if (!a || typeof a.configure !== 'function') return;
    a.configure({
      onResetToken: function (info) {
        /* the reset code is only echoed by the API when no mailer is
           configured; it is handed to the account screen and never logged */

      }
    });
  }

  /* ---- 4. wishlist follows the account ----------------------------------- */
  function localWishlist() {
    try {
      var raw = JSON.parse(localStorage.getItem(WISH_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }

  var wishlistSyncedFor = null;
  function syncWishlist(user, opts) {
    opts = opts || {};
    var client = api();
    if (!client || !user) return Promise.resolve(null);
    if (wishlistSyncedFor === user.id && !opts.force) return Promise.resolve(null);
    wishlistSyncedFor = user.id;
    return client.wishlistSync(localWishlist()).then(function (data) {
      var a = auth();
      if (!a || !a.isSignedIn() || (a.user() || {}).id !== user.id) return null;   /* signed out meanwhile */
      var ids = (data && data.ids) || [];
      whenApp(function (app2) { if (app2.wishlist && app2.wishlist.set) app2.wishlist.set(ids); });
      try { localStorage.setItem(WISH_KEY, JSON.stringify(ids)); } catch (e) {}
      return ids;
    }).catch(function () { wishlistSyncedFor = null; return null; });
  }

  function mirrorWishlistToServer(detail) {
    var client = api();
    var a = auth();
    if (!client || !a || !a.isSignedIn() || !client.available()) return;
    if (detail && detail.bulk) return;             /* the server produced this list */
    if (!detail || detail.id === undefined) return;
    if (detail.saved) client.wishlistAdd(detail.id).catch(function () {});
    else client.wishlistRemove(detail.id).catch(function () {});
  }

  /* ---- 5. expired sessions, handled once -------------------------------- */
  window.__KINETIC_UNAUTHORIZED__ = function (err) {
    var a = auth();
    if (!a || !a.noteSessionExpired) return;
    if (!a.isSignedIn()) return;
    a.noteSessionExpired((err && err.message) || 'Your session has expired. Sign in again to continue.');
  };

  /* ---- 6. boot ----------------------------------------------------------- */
  /* The account screens word themselves from KINETIC_API_MODE, and they may
     already have rendered before this file learned the answer (a deep link to
     #account or #login). Re-route once so the customer never reads a sentence
     that is not true — this happens at load, before anybody can type. */
  function repaintAccountScreens() {
    var a = window.KINETIC_ACCOUNT;
    if (!a) return;
    var hash = String(location.hash || '');
    if (hash.indexOf('#account') !== 0 && hash.indexOf('#login') !== 0 && hash.indexOf('#signup') !== 0 &&
        hash.indexOf('#forgot') !== 0 && hash.indexOf('#reset') !== 0) return;
    try { if (typeof a.route === 'function') a.route(); } catch (e) {}
  }

  function boot() {
    var client = api();
    if (!client) return;
    if (!client.configured) {
      /* a static-only deployment: accounts stay on this device and the account
         screens say exactly that — no pretend backend anywhere */
      window.KINETIC_API_MODE = 'standalone';
      repaintAccountScreens();
      return;
    }
    window.KINETIC_API_MODE = 'live';
    repaintAccountScreens();
    client.ready().then(function (online) {
      if (!online) {
        window.KINETIC_API_MODE = 'unreachable';   /* declared but down */
        return;
      }
      wireAuth();
      wireResetDelivery();
      syncConfig();
      syncCatalogue({ announce: false });
      var a = auth();
      if (!a) return;
      /* the cookie is the session — ask who we are, then hydrate the account */
      (a.refreshSession ? a.refreshSession() : Promise.resolve(null)).then(function () {
        var user = a.user();
        if (!user) return;
        syncWishlist(user);
        a.refreshOrders();
      }).catch(function () {});
    });
  }

  var a = auth();
  if (a && typeof a.on === 'function') {
    a.on('kinetic:auth', function (detail) {
      if (!detail || !detail.user) return;
      if (detail.reason === 'login' || detail.reason === 'signup' || detail.reason === 'resume') {
        syncWishlist(detail.user);
      }
    });
  } else {
    window.setTimeout(function () {
      var auth2 = auth();
      if (auth2 && typeof auth2.on === 'function') {
        auth2.on('kinetic:auth', function (detail) {
          if (!detail || !detail.user) return;
          if (detail.reason === 'login' || detail.reason === 'signup' || detail.reason === 'resume') {
            syncWishlist(detail.user);
          }
        });
      }
    }, 300);
  }

  window.addEventListener('kinetic:wishlist-changed', function (e) { mirrorWishlistToServer(e.detail); });

  /* ---- 4. reviews --------------------------------------------------------
     The product page asks for a product's reviews once, when it opens. They
     come from the database, so they are the same for every visitor and the
     product's rating is recomputed server-side after each one. Writing goes
     through the same endpoint and needs a signed-in account; every failure is
     reported back in plain words (not signed in, already reviewed, offline). */
  var reviewCache = {};
  var reviewRequests = {};

  function loadReviews(idOrSlug) {
    var client = api();
    var key = String(idOrSlug);
    if (!client || !client.available() || !client.reviews) return Promise.resolve(null);
    if (reviewCache[key]) return reviewCache[key];
    if (reviewRequests[key]) return reviewRequests[key];
    reviewRequests[key] = client.reviews(idOrSlug, { limit: 50 }).then(function (data) {
      var list = (data && data.reviews) || [];
      if (!window.__KINETIC_DB_REVIEWS__ || typeof window.__KINETIC_DB_REVIEWS__ !== 'object') window.__KINETIC_DB_REVIEWS__ = {};
      /* index by every reference the product page may use to ask for it */
      window.__KINETIC_DB_REVIEWS__[key] = list;
      list.forEach(function (r) {
        if (r && r.productId !== undefined && r.productId !== null) window.__KINETIC_DB_REVIEWS__[String(r.productId)] = list;
      });
      try { window.dispatchEvent(new CustomEvent('kinetic:reviews-updated', { detail: { id: idOrSlug, count: list.length } })); } catch (e) {}
      return list;
    }).catch(function () { return null; }).then(function (out) {
      delete reviewRequests[key];
      if (out) reviewCache[key] = Promise.resolve(out);
      return out;
    });
    return reviewRequests[key];
  }

  function submitReview(payload) {
    var client = api();
    if (!client || !client.available() || !client.writeReview) {
      return Promise.resolve({ ok: false, message: 'You are offline — your review was kept in this browser.' });
    }
    var a = auth();
    if (!a || !a.user || !a.user()) {
      return Promise.resolve({ ok: false, message: 'Sign in to your KINETIC account to publish a review.', needsAuth: true });
    }
    var ref = payload.productId;
    return client.writeReview(ref, { rating: payload.rating, review: payload.review }).then(function (data) {
      var saved = (data && data.review) || null;
      if (saved) {
        var key = String(ref);
        if (!window.__KINETIC_DB_REVIEWS__ || typeof window.__KINETIC_DB_REVIEWS__ !== 'object') window.__KINETIC_DB_REVIEWS__ = {};
        var list = Array.isArray(window.__KINETIC_DB_REVIEWS__[key]) ? window.__KINETIC_DB_REVIEWS__[key].slice() : [];
        list.unshift(saved);
        window.__KINETIC_DB_REVIEWS__[key] = list;
        try { window.dispatchEvent(new CustomEvent('kinetic:reviews-updated', { detail: { id: ref, count: list.length } })); } catch (e) {}
        if (data && data.aggregate) {
          var app2 = window.KINETIC_APP;
          if (app2 && app2.applyReviewAggregate) app2.applyReviewAggregate(ref, data.aggregate);
        }
      }
      return { ok: true, review: saved };
    }).catch(function (err) {
      var message = (err && (err.message || err.error)) || 'That review could not be saved. Please try again.';
      return { ok: false, message: message, status: (err && err.status) || 0 };
    });
  }

  /* signing in or out changes what this browser may read: drop the cached
     answer. The next console open asks the server again — nothing is probed
     while the visitor is simply browsing the shop. */
  window.addEventListener('kinetic:auth', function () {
    adminProbed = false;
    adminIsOwner = false;
    adminCache = null;
  });
  window.addEventListener('kinetic:auth-expired', function () {
    adminProbed = true;
    adminIsOwner = false;
    adminCache = null;
  });

  window.addEventListener('kinetic:product-opened', function (e) {
    var detail = (e && e.detail) || {};
    var ref = detail.id !== undefined && detail.id !== null ? detail.id : detail.slug;
    if (ref !== undefined && ref !== null) loadReviews(ref);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* ---- 7. the owner console ------------------------------------------------
     The admin dashboard's data layer. Reads /api/admin/{stats,orders,inventory,
     coupons}; writes order status, stock, coupons and products.

     Every one of those routes is guarded by requireAdmin on the server. The
     browser never holds an owner credential: it sends its own httpOnly session
     cookie plus the CSRF header, and the server decides whether that session
     may act. When the API is down, or the visitor is not the owner, every
     accessor here returns null/``offline`` and the console falls back to the
     local working copy exactly as before.
  -------------------------------------------------------------------------- */
  var adminCache = null;
  var adminBusy = null;
  var adminLastError = '';

  function adminClient() { var c = api(); return (c && c.available()) ? c : null; }

  /* The storefront's own copy of the signed-in user intentionally carries no
     role (see publicUser() in kinetic-auth.js), so "is this the owner?" is
     answered by the server exactly once per session and cached here. The probe
     is the cheapest admin route; a refusal costs nothing and leaves no data. */
  function adminWho() {
    var a = auth();
    return (a && typeof a.user === 'function') ? a.user() : null;
  }

  var adminIsOwner = false;
  var adminProbed = false;

  function adminProbe() {
    var c = adminClient();
    if (!c) { adminIsOwner = false; adminProbed = true; return Promise.resolve(false); }
    return c._request('GET', '/admin/stats').then(function () {
      adminIsOwner = true; adminProbed = true;
      adminCollect(true);                       /* paint the console with real data */
      return true;
    }, function () {
      adminIsOwner = false; adminProbed = true;
      adminCache = null;
      try { window.dispatchEvent(new CustomEvent('kinetic:admin-data', { detail: { locked: true } })); } catch (e) {}
      return false;
    });
  }

  function adminCheck() {
    return adminProbed ? Promise.resolve(adminIsOwner) : adminProbe();
  }

  /* Passive: never sends anything by itself. The console calls probe()/load()
     when it actually opens, so a normal page view costs the store no extra
     request — and no refused admin call lands in the visitor's console. */
  function adminMode() {
    if (!adminClient()) return 'offline';
    return (adminProbed && adminIsOwner) ? 'live' : 'locked';
  }

  function adminError(message, code, status) {
    var err = new Error(message);
    err.code = code || 'admin';
    err.status = status || 0;
    return err;
  }

  function adminCall(method, path, body) {
    var c = adminClient();
    if (!c) return Promise.reject(adminError('The store database is not reachable right now.', 'offline'));
    if (adminProbed && !adminIsOwner) {
      return Promise.reject(adminError('Sign in with the owner account to manage the store.', 'not_admin', 403));
    }
    /* even before the probe answers the request goes out: requireAdmin on the
       server is what actually decides, never a flag in the browser */
    return c._request(method, path, body);
  }

  function adminIndex(products) {
    var byLegacy = {}, bySlug = {};
    (products || []).forEach(function (p) {
      if (p.legacyId !== null && p.legacyId !== undefined) byLegacy[String(p.legacyId)] = p;
      if (p.slug) bySlug[String(p.slug)] = p;
    });
    return { byLegacy: byLegacy, bySlug: bySlug, list: products || [] };
  }

  function adminFind(ref) {
    if (!adminCache || ref === null || ref === undefined || ref === '') return null;
    return adminCache.index.byLegacy[String(ref)] || adminCache.index.bySlug[String(ref)] || null;
  }

  function adminVariant(ref, size) {
    var p = adminFind(ref);
    if (!p) return null;
    var v = (p.variants || []).filter(function (x) { return String(x.size) === String(size); })[0];
    return v ? { product: p, variant: v } : null;
  }

  function adminCollect(force) {
    if (!adminClient()) return Promise.resolve(null);
    if (adminProbed && !adminIsOwner) { adminCache = null; adminLastError = ''; return Promise.resolve(null); }
    if (!adminProbed) return adminProbe().then(function () { return adminCollect(force); });
    if (adminBusy && !force) return adminBusy;
    adminBusy = Promise.all([
      adminCall('GET', '/admin/stats'),
      adminCall('GET', '/admin/orders?limit=100'),
      adminCall('GET', '/admin/inventory?limit=200'),
      adminCall('GET', '/admin/coupons?limit=100')
    ]).then(function (out) {
      var owner = adminWho();
      /* /admin/stats answers with its counts at the top level ({sales, inventory,
         customers}); accept either shape so a nested envelope also lands */
      var stats = out[0] || null;
      if (stats && stats.stats) stats = stats.stats;
      adminCache = {
        at: Date.now(),
        stats: stats,
        orders: (out[1] && out[1].orders) || [],
        inventory: (out[2] && out[2].inventory) || [],
        coupons: (out[3] && out[3].coupons) || [],
        owner: owner ? (owner.name || owner.email || 'owner') : 'owner',
        email: owner ? owner.email : ''
      };
      adminCache.index = adminIndex(adminCache.inventory);
      adminLastError = '';
      try {
        window.dispatchEvent(new CustomEvent('kinetic:admin-data', { detail: {
          orders: adminCache.orders.length,
          products: adminCache.inventory.length,
          coupons: adminCache.coupons.length,
          owner: adminCache.owner
        } }));
      } catch (e) {}
      return adminCache;
    }).catch(function (err) {
      adminLastError = (err && (err.message || err.error)) || 'The dashboard could not read the store.';
      if (err && (err.status === 401 || err.status === 403)) { adminIsOwner = false; adminProbed = true; adminCache = null; }
      return null;
    }).then(function (value) { adminBusy = null; return value; });
    return adminBusy;
  }

  /* every write refreshes the cache, so what the console shows next is exactly
     what the database holds — never an optimistic local guess */
  function adminWrite(promise) {
    return promise.then(function (data) {
      return adminCollect(true).then(function () { return { ok: true, data: data }; });
    }, function (err) {
      return {
        ok: false,
        message: (err && (err.message || err.error)) || 'That change could not be saved.',
        code: (err && err.code) || '',
        status: (err && err.status) || 0
      };
    });
  }

  window.KINETIC_ADMIN_API = {
    mode: adminMode,
    available: function () { return !!adminClient(); },
    pending: function () { return !adminProbed; },
    isOwner: function () { return adminProbed && adminIsOwner; },
    check: adminCheck,
    probe: adminProbe,
    owner: adminWho,
    ownerName: function () {
      if (adminCache) return adminCache.owner;
      var u = adminWho();
      return u ? (u.name || u.email || '') : '';
    },
    data: function () { return adminCache; },
    ready: function () { return !!adminCache; },
    lastError: function () { return adminLastError; },
    load: adminCollect,
    refresh: function () { return adminCollect(true); },

    stats: function () { return adminCache ? adminCache.stats : null; },
    orders: function () { return adminCache ? adminCache.orders : null; },
    coupons: function () { return adminCache ? adminCache.coupons : null; },
    inventory: function () { return adminCache ? adminCache.inventory : null; },
    products: function () { return adminCache ? adminCache.index.list : null; },
    product: adminFind,
    variantStock: function (ref, size) {
      var hit = adminVariant(ref, size);
      return hit ? hit.variant.stock : null;
    },

    setOrderStatus: function (number, patch) {
      return adminWrite(adminCall('PATCH', '/admin/orders/' + encodeURIComponent(number), patch || {}));
    },
    setStock: function (ref, size, stock, reason) {
      var hit = adminVariant(ref, size);
      if (!hit) return Promise.resolve({ ok: false, message: 'That size is not in the database.', code: 'no_variant' });
      return adminWrite(adminCall('PATCH', '/admin/variants/' + encodeURIComponent(hit.variant.id),
        { stock: Math.max(0, Math.round(Number(stock) || 0)), reason: reason || 'adjust' }));
    },
    adjustStock: function (ref, size, delta, reason) {
      var hit = adminVariant(ref, size);
      if (!hit) return Promise.resolve({ ok: false, message: 'That size is not in the database.', code: 'no_variant' });
      return adminWrite(adminCall('POST', '/admin/variants/' + encodeURIComponent(hit.variant.id) + '/adjust',
        { delta: Math.round(Number(delta) || 0), reason: reason || (delta >= 0 ? 'restock' : 'adjust') }));
    },
    restock: function (ref, size, qty) {
      var p = adminFind(ref);
      if (!p) return Promise.resolve({ ok: false, message: 'That product is not in the database.', code: 'no_product' });
      return adminWrite(adminCall('POST', '/admin/products/' + encodeURIComponent(p.productId) + '/restock',
        { size: size, qty: Math.max(1, Math.round(Number(qty) || 1)) }));
    },

    createCoupon: function (payload) { return adminWrite(adminCall('POST', '/admin/coupons', payload || {})); },
    updateCoupon: function (id, patch) { return adminWrite(adminCall('PATCH', '/admin/coupons/' + encodeURIComponent(id), patch || {})); },
    deleteCoupon: function (id) { return adminWrite(adminCall('DELETE', '/admin/coupons/' + encodeURIComponent(id))); },

    createProduct: function (payload) { return adminWrite(adminCall('POST', '/products', payload || {})); },
    updateProduct: function (ref, patch) {
      var p = adminFind(ref);
      if (!p) return Promise.resolve({ ok: false, message: 'That product is not in the database.', code: 'no_product' });
      return adminWrite(adminCall('PATCH', '/products/' + encodeURIComponent(p.productId), patch || {}));
    },
    deleteProduct: function (ref, hard) {
      var p = adminFind(ref);
      if (!p) return Promise.resolve({ ok: false, message: 'That product is not in the database.', code: 'no_product' });
      return adminWrite(adminCall('DELETE', '/products/' + encodeURIComponent(p.productId) + (hard ? '?hard=true' : '')));
    }
  };

  window.KINETIC_SYNC = {

    catalogue: function () { return syncCatalogue({ force: true }); },
    config: syncConfig,
    wishlist: function () { var a2 = auth(); return syncWishlist(a2 && a2.user(), { force: true }); },
    orders: function () { var a2 = auth(); return a2 && a2.refreshOrders ? a2.refreshOrders() : Promise.resolve(null); },
    reviews: function (idOrSlug) { reviewCache = {}; return loadReviews(idOrSlug); },
    admin: function () { return window.KINETIC_ADMIN_API ? window.KINETIC_ADMIN_API.refresh() : Promise.resolve(null); },
    online: function () { var c = api(); return !!(c && c.available()); }
  };

  /* the storefront's review seam: read a product's reviews, write one */
  window.KINETIC_REVIEWS = {
    load: loadReviews,
    submit: submitReview,
    mode: function () { var c = api(); return c && c.available() ? 'live' : 'offline'; }
  };
})();
