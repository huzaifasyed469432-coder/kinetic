/* ============================================================================
   KINETIC® — data layer
   ----------------------------------------------------------------------------
   One small client that talks to the commerce API. Everything the storefront
   previously kept only in the browser now has a server-side source of truth,
   and every call degrades gracefully: if the API is unreachable the shop keeps
   working from content.json and localStorage exactly as it did before, so the
   UI is never taken down by the backend.

   Public surface:  window.KINETIC_API
     available()          → has the API answered this session?
     ready()              → promise for the first health probe
     products(params)     → { products, pagination, facets }
     product(idOrSlug)    → { product, reviews }
     categories()
     validateCoupon(code, subtotalCents)
     createOrder(payload) → real order, priced by the server
     myOrders()           → the signed-in customer's order history
     order(number)
     wishlist() / wishlistAdd(id) / wishlistRemove(id) / wishlistSync(ids)
     reviews(idOrSlug) / writeReview(idOrSlug, {rating, review})
     config()
   ========================================================================== */
(function () {
  'use strict';

  var VERSION = '1.0';

  /* Where the API lives is a deployment decision, declared in the HTML:
       <meta name="kinetic-api" content="/api">
     or <meta name="kinetic-api" content="https://api.example.com/api">,
     or window.KINETIC_API_BASE before this file loads.
     When nothing declares an API the client stays dormant — the storefront runs
     exactly as it does today and no request is made to a route that is not
     there (which would only fill the console with 404s on a static host). */
  function resolveBase() {
    if (window.KINETIC_API_BASE) return { base: String(window.KINETIC_API_BASE).replace(/\/$/, ''), declared: true };
    var cfg = window.KINETIC_CONFIG || {};
    if (cfg.apiBase) {
      var configured = String(cfg.apiBase).trim();
      if (configured && configured !== 'off' && configured !== 'none') {
        return { base: configured.replace(/\/$/, ''), declared: true };
      }
    }
    var meta = document.querySelector('meta[name="kinetic-api"]');
    if (meta && meta.getAttribute('content')) {
      var value = String(meta.getAttribute('content')).trim();
      if (!value || value === 'off' || value === 'none') return { base: '/api', declared: false };
      return { base: value.replace(/\/$/, ''), declared: true };
    }
    return { base: '/api', declared: false };
  }

  var resolved = resolveBase();
  var base = resolved.base;
  var declared = resolved.declared;
  var state = { checked: false, online: false, checkedAt: 0, lastError: null, config: null };
  var probe = null;

  function cookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function request(method, path, body, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    /* double-submit CSRF token for cookie-authenticated writes */
    var csrf = cookie('kin_csrf');
    if (csrf && method !== 'GET') headers['x-kinetic-csrf'] = csrf;

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, opts.timeout || 9000) : null;

    return fetch(base + path, {
      method: method,
      headers: headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) window.clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error((data && (data.error || data.message)) || ('Request failed (' + res.status + ')'));
          err.code = (data && data.code) || ('http_' + res.status);
          err.field = data && data.field;
          err.status = res.status;
          err.retryAfter = data && data.retryAfter;
          /* one place decides what a dead session means for the whole page */
          if (res.status === 401 && typeof window.__KINETIC_UNAUTHORIZED__ === 'function') {
            try { window.__KINETIC_UNAUTHORIZED__(err); } catch (e) {}
          }
          throw err;
        }
        state.online = true;
        state.checked = true;
        state.lastError = null;
        return data || {};
      });
    }).catch(function (err) {
      if (err && (err.name === 'AbortError' || /Failed to fetch|NetworkError|Load failed/i.test(err.message || ''))) {
        state.online = false;
        state.checked = true;
        state.lastError = 'unreachable';
      }
      throw err;
    });
  }

  function ready() {
    if (!declared) { state.checked = true; state.online = false; state.lastError = 'not-configured'; return Promise.resolve(false); }
    if (probe) return probe;
    probe = request('GET', '/health', undefined, { timeout: 4000 }).then(function (data) {
      state.online = !!(data && data.ok && data.database && data.database.connected);
      state.checkedAt = Date.now();
      return state.online;
    }).catch(function () {
      state.online = false;
      state.checkedAt = Date.now();
      return false;
    });
    return probe;
  }

  function qs(params) {
    var out = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === '' || value === false) return;
      out.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    });
    return out.length ? '?' + out.join('&') : '';
  }

  window.KINETIC_API = {
    version: VERSION,
    base: base,
    configured: declared,
    available: function () { return !!(state.checked && state.online); },
    status: function () { return { base: base, checked: state.checked, online: state.online, checkedAt: state.checkedAt, lastError: state.lastError }; },
    ready: ready,
    health: function () { return request('GET', '/health'); },
    config: function () {
      if (state.config) return Promise.resolve(state.config);
      return request('GET', '/config').then(function (data) { state.config = data; return data; });
    },

    products: function (params) { return request('GET', '/products' + qs(params)); },
    product: function (idOrSlug) { return request('GET', '/products/' + encodeURIComponent(idOrSlug)); },
    categories: function () { return request('GET', '/categories'); },

    validateCoupon: function (code, subtotalCents) {
      return request('POST', '/coupons/validate', { code: code, subtotalCents: subtotalCents });
    },

    createOrder: function (payload) { return request('POST', '/orders', payload); },
    claimOrders: function () { return request('POST', '/orders/claim', {}); },
    myOrders: function (params) { return request('GET', '/orders' + qs(params)); },
    order: function (number) { return request('GET', '/orders/' + encodeURIComponent(number)); },

    wishlist: function () { return request('GET', '/wishlist'); },
    wishlistAdd: function (productId) { return request('POST', '/wishlist', { productId: productId }); },
    wishlistRemove: function (productId) { return request('DELETE', '/wishlist/' + encodeURIComponent(productId)); },
    wishlistSync: function (ids) { return request('POST', '/wishlist/sync', { ids: ids }); },

    reviews: function (idOrSlug, params) { return request('GET', '/products/' + encodeURIComponent(idOrSlug) + '/reviews' + qs(params)); },
    myReviews: function () { return request('GET', '/reviews/mine'); },
    writeReview: function (idOrSlug, payload) {
      return request('POST', '/products/' + encodeURIComponent(idOrSlug) + '/reviews', payload);
    },
    deleteReview: function (id) { return request('DELETE', '/reviews/' + encodeURIComponent(id)); },

    /* used by the account area: one call instead of one-per-order */
    ordersForAccount: function (params) { return request('GET', '/orders' + qs(params)); },
    _request: request
  };

  /* Probe once, quietly, at boot. Nothing blocks on it. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { ready(); });
  else ready();
})();
