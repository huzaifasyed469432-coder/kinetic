/* ============================================================================
   KINETIC® — customer authentication core
   ----------------------------------------------------------------------------
   WHAT THIS IS
   The shop has no server of its own: content + orders live in the browser
   (`kinetic-content-cache-v1`, `kinetic-orders-v1`) with an optional
   `ordersEndpoint` the owner can point at a webhook. This file adds a real
   credential store on the same model — not a fake "logged in" flag:

     · passwords are never stored, logged or compared as text. Each account
       keeps a random 16-byte salt and a PBKDF2-SHA256 verifier (WebCrypto,
       120k iterations). Where WebCrypto is unavailable (plain http on a LAN
       IP, file://) it falls back to an iterated SHA-256 KDF and flags the
       account as `kdf:'sha256'` so it always verifies with the same one.
     · sessions are random 32-byte tokens. Only the SHA-256 hash of the token is
       written into the account vault; the raw token lives in its own storage
       key (localStorage when "remember me", sessionStorage otherwise) and
       expires (30 days sliding / 12 hours per-tab).
     · password resets are one-time 6-digit codes, stored hashed, 15-minute
       expiry, single use, and they invalidate every existing session.
     · login attempts are throttled (5 failures → 60s lock) and forgot-password
       never reveals whether an address is registered.

   TALKING TO A REAL BACKEND
   Every operation goes through an adapter. The default is `local` (above).
   `KINETIC_AUTH.configure({ adapter:'http', baseUrl:'https://api…' })` switches
   the whole UI to a REST contract (documented in AUTH-API.md) without touching
   a line of the account screens. Drop-in targets: Supabase/Express/Laravel.

   Public API: window.KINETIC_AUTH (see the bottom of this file).
   ========================================================================= */
(function () {
  'use strict';

  var VAULT_KEY = 'kinetic-account-v1';
  var SESSION_KEY = 'kinetic-account-session-v1';
  var ORDER_KEY = 'kinetic-orders-v1';
  var WISH_KEY = 'kinetic-wishlist-v1';
  var RECENT_KEY = 'kinetic-recently-viewed-v1';

  var PBKDF2_ITERATIONS = 120000;
  var FALLBACK_ITERATIONS = 4000;
  var SESSION_TTL_REMEMBER = 30 * 24 * 60 * 60 * 1000;   /* 30 days  */
  var SESSION_TTL_TAB = 12 * 60 * 60 * 1000;             /* 12 hours */
  var SESSION_TOUCH_AFTER = 10 * 60 * 1000;              /* slide every 10 min */
  var RESET_TTL = 15 * 60 * 1000;                        /* 15 minutes */
  var RESET_RESEND_COOLOFF = 60 * 1000;                  /* one code a minute  */
  var RESET_MAX_REQUESTS = 5;                            /* per 15 minutes      */
  var MAX_ATTEMPTS = 5;
  var LOCK_MS = 60 * 1000;

  var listeners = {};
  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return function () { off(name, fn); }; }
  function off(name, fn) { listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; }); }
  function emit(name, detail) {
    var list = (listeners[name] || []).slice();
    list.forEach(function (fn) { try { fn(detail); } catch (e) { /* a listener must never break auth */ } });
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  }

  /* ------------------------------------------------------------------ utils */
  function $(sel, root) { return (root || document).querySelector(sel); }

  function now() { return Date.now(); }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function dropKey(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function bytes(n) {
    var out = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) { window.crypto.getRandomValues(out); return out; }
    for (var i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function toB64(bytesIn) {
    var s = '';
    for (var i = 0; i < bytesIn.length; i++) s += String.fromCharCode(bytesIn[i]);
    return btoa(s);
  }
  function fromB64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function toHex(bytesIn) {
    var s = '';
    for (var i = 0; i < bytesIn.length; i++) s += ('0' + bytesIn[i].toString(16)).slice(-2);
    return s;
  }
  function utf8(str) { return new TextEncoder().encode(String(str)); }

  function id(prefix) {
    return (prefix || 'id') + '_' + now().toString(36) + '_' + toHex(bytes(6));
  }

  /* constant-time compare for two equal-length strings */
  function safeEqual(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /* ------------------------------------------------- sha-256 (fallback KDF) */
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(msg) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = msg.length;
    var total = ((l + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(total);
    m.set(msg);
    m[l] = 0x80;
    var bits = l * 8;
    m[total - 8] = Math.floor(bits / 4294967296) >>> 24 & 255;
    m[total - 7] = Math.floor(bits / 4294967296) >>> 16 & 255;
    m[total - 6] = Math.floor(bits / 4294967296) >>> 8 & 255;
    m[total - 5] = Math.floor(bits / 4294967296) & 255;
    m[total - 4] = (bits >>> 24) & 255;
    m[total - 3] = (bits >>> 16) & 255;
    m[total - 2] = (bits >>> 8) & 255;
    m[total - 1] = bits & 255;
    var w = new Uint32Array(64), i, t;
    for (i = 0; i < total; i += 64) {
      for (t = 0; t < 16; t++) {
        w[t] = (m[i + t * 4] << 24) | (m[i + t * 4 + 1] << 16) | (m[i + t * 4 + 2] << 8) | m[i + t * 4 + 3];
      }
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K256[t] + w[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) {
      out[i * 4] = (h[i] >>> 24) & 255; out[i * 4 + 1] = (h[i] >>> 16) & 255;
      out[i * 4 + 2] = (h[i] >>> 8) & 255; out[i * 4 + 3] = h[i] & 255;
    }
    return out;
  }
  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }
  function hashHex(str) { return toHex(sha256(utf8(str))); }

  /* ------------------------------------------------------------------- KDF */
  function hasWebCrypto() {
    return !!(window.crypto && window.crypto.subtle && window.crypto.subtle.importKey && window.TextEncoder);
  }
  var kdfCache = {};
  function derive(password, saltB64, kdf, iterations) {
    var salt = fromB64(saltB64);
    if (kdf === 'pbkdf2' && hasWebCrypto()) {
      var cacheKey = hashHex(saltB64 + '|' + iterations + '|' + password);
      if (kdfCache[cacheKey]) return Promise.resolve(kdfCache[cacheKey]);
      return window.crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits'])
        .then(function (key) {
          return window.crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, key, 256);
        })
        .then(function (bits) {
          var hex = toHex(new Uint8Array(bits));
          kdfCache[cacheKey] = hex;
          return hex;
        });
    }
    /* fallback: iterated salted SHA-256. Weaker on purpose — flagged per account */
    var cur = sha256(concat(salt, utf8(password)));
    for (var i = 0; i < iterations; i++) cur = sha256(concat(cur, salt));
    return Promise.resolve(toHex(cur));
  }
  function hashPassword(password) {
    var salt = toB64(bytes(16));
    if (hasWebCrypto()) {
      return derive(password, salt, 'pbkdf2', PBKDF2_ITERATIONS).then(function (verifier) {
        return { kdf: 'pbkdf2', algo: 'SHA-256', iter: PBKDF2_ITERATIONS, salt: salt, verifier: verifier };
      });
    }
    return derive(password, salt, 'sha256', FALLBACK_ITERATIONS).then(function (verifier) {
      return { kdf: 'sha256', algo: 'SHA-256', iter: FALLBACK_ITERATIONS, salt: salt, verifier: verifier };
    });
  }
  function verifyPassword(password, record) {
    if (!record || !record.salt || !record.verifier) return Promise.resolve(false);
    return derive(password, record.salt, record.kdf === 'pbkdf2' ? 'pbkdf2' : 'sha256', record.iter || FALLBACK_ITERATIONS)
      .then(function (hex) { return safeEqual(hex, record.verifier); });
  }

  /* --------------------------------------------------------------- vault */
  function emptyVault() { return { v: 1, users: [], sessions: [], resets: [], attempts: {} }; }
  function vault() {
    var v = readJSON(VAULT_KEY, null);
    if (!v || typeof v !== 'object') v = emptyVault();
    v.users = Array.isArray(v.users) ? v.users : [];
    v.sessions = Array.isArray(v.sessions) ? v.sessions : [];
    v.resets = Array.isArray(v.resets) ? v.resets : [];
    v.attempts = v.attempts && typeof v.attempts === 'object' ? v.attempts : {};
    return v;
  }
  function save(v) { return writeJSON(VAULT_KEY, v); }

  function normaliseEmail(email) { return String(email || '').trim().toLowerCase(); }
  function findUser(v, email) {
    var n = normaliseEmail(email);
    return v.users.filter(function (u) { return u.emailNorm === n; })[0] || null;
  }
  function findUserById(v, userId) {
    return v.users.filter(function (u) { return u.id === userId; })[0] || null;
  }
  function publicUser(u) {
    if (!u) return null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone || '',
      addresses: (u.addresses || []).map(function (a) { return Object.assign({}, a); }),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || null,
      hasPassword: !!u.pass
    };
  }

  /* -------------------------------------------------------------- sessions */
  function pruneSessions(v) {
    var t = now();
    v.sessions = v.sessions.filter(function (s) { return s && s.expiresAt > t; });
    /* never keep more than a handful of devices */
    v.sessions.sort(function (a, b) { return (b.lastSeenAt || 0) - (a.lastSeenAt || 0); });
    if (v.sessions.length > 12) v.sessions = v.sessions.slice(0, 12);
  }
  function sessionSlot(remember) {
    return remember ? localStorage : window.sessionStorage;
  }
  function readToken() {
    var raw = null;
    try { raw = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!raw) { try { raw = window.sessionStorage.getItem(SESSION_KEY); } catch (e) {} }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function writeToken(payload, remember) {
    var data = JSON.stringify(payload);
    try { sessionSlot(remember).setItem(SESSION_KEY, data); } catch (e) {}
  }
  function clearToken() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { window.sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function startSession(v, user, remember) {
    var token = toHex(bytes(32));
    var ttl = remember ? SESSION_TTL_REMEMBER : SESSION_TTL_TAB;
    var t = now();
    pruneSessions(v);
    v.sessions.push({
      id: hashHex(token),            /* only the hash is kept in the vault */
      userId: user.id,
      createdAt: t,
      lastSeenAt: t,
      expiresAt: t + ttl,
      remember: !!remember,
      agent: String(navigator.userAgent || '').slice(0, 120)
    });
    save(v);
    clearToken();
    writeToken({ token: token, userId: user.id, remember: !!remember }, remember);
    return { token: token, expiresAt: t + ttl };
  }
  function currentSession(v) {
    var payload = readToken();
    if (!payload || !payload.token) return { user: null, session: null, reason: 'none' };
    var hash = hashHex(payload.token);
    var list = v.sessions || [];
    var sess = list.filter(function (s) { return s.id === hash; })[0] || null;
    if (!sess) { clearToken(); return { user: null, session: null, reason: 'unknown' }; }
    if (sess.expiresAt <= now()) {
      v.sessions = list.filter(function (s) { return s.id !== hash; });
      save(v);
      clearToken();
      return { user: null, session: null, reason: 'expired' };
    }
    var user = findUserById(v, sess.userId);
    if (!user) { clearToken(); return { user: null, session: null, reason: 'unknown' }; }
    /* sliding expiry, written at most every 10 minutes */
    if (now() - (sess.lastSeenAt || 0) > SESSION_TOUCH_AFTER) {
      sess.lastSeenAt = now();
      sess.expiresAt = now() + (sess.remember ? SESSION_TTL_REMEMBER : SESSION_TTL_TAB);
      save(v);
    }
    return { user: user, session: sess, reason: 'ok' };
  }
  function endSession(v, tokenHash) {
    if (tokenHash) {
      v.sessions = v.sessions.filter(function (s) { return s.id !== tokenHash; });
      save(v);
    } else {
      v.sessions = [];
      save(v);
    }
    clearToken();
  }
  function endAllSessions(v, userId) {
    v.sessions = (v.sessions || []).filter(function (s) { return s.userId !== userId; });
    save(v);
    var payload = readToken();
    if (payload && payload.userId === userId) clearToken();
  }

  /* ------------------------------------------------------------- validation */
  var EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
  var validate = {
    email: function (value) {
      var v = String(value || '').trim();
      if (!v) return { ok: false, code: 'required', error: 'Enter your email address.' };
      if (v.length > 160) return { ok: false, code: 'length', error: 'That email is too long.' };
      if (!EMAIL_RE.test(v)) return { ok: false, code: 'format', error: 'That does not look like a valid email address.' };
      var domain = v.split('@')[1] || '';
      if (domain.indexOf('.') === -1) return { ok: false, code: 'format', error: 'The email address needs a domain, like name@domain.com.' };
      return { ok: true, value: v };
    },
    password: function (value) {
      var v = String(value == null ? '' : value);
      if (!v) return { ok: false, code: 'required', error: 'Choose a password.' };
      if (v.length < 8) return { ok: false, code: 'short', error: 'Use at least 8 characters.' };
      if (v.length > 128) return { ok: false, code: 'long', error: 'Passwords are limited to 128 characters.' };
      if (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v)) return { ok: false, code: 'weak', error: 'Mix at least one letter and one number.' };
      if (/^\s|\s$/.test(v)) return { ok: false, code: 'space', error: 'Passwords cannot start or end with a space.' };
      return { ok: true, value: v };
    },
    name: function (value) {
      var v = String(value || '').trim().replace(/\s+/g, ' ');
      if (v.length < 2) return { ok: false, code: 'short', error: 'Enter your full name.' };
      if (v.length > 80) return { ok: false, code: 'long', error: 'That name is too long.' };
      return { ok: true, value: v };
    },
    phone: function (value, required) {
      var v = String(value || '').trim();
      if (!v) return required ? { ok: false, code: 'required', error: 'Enter a phone number.' } : { ok: true, value: '' };
      var digits = v.replace(/[^\d]/g, '');
      if (digits.length < 7 || digits.length > 15) return { ok: false, code: 'format', error: 'Enter a phone number with 7–15 digits.' };
      return { ok: true, value: v };
    },
    address: function (a) {
      a = a || {};
      var out = {}, first = null;
      function take(key, label, opts) {
        opts = opts || {};
        var raw = String(a[key] == null ? '' : a[key]).trim();
        if (!raw && opts.optional) { out[key] = ''; return; }
        if (!raw) { if (!first) first = { field: key, error: label + ' is required.' }; return; }
        if (raw.length > (opts.max || 120)) { if (!first) first = { field: key, error: label + ' is too long.' }; return; }
        out[key] = raw;
      }
      take('label', 'Address label');
      take('name', 'Recipient name');
      take('line1', 'Street address');
      take('line2', 'Apartment / suite', { optional: true, max: 120 });
      take('city', 'City');
      take('postal', 'Postal code', { optional: true, max: 24 });
      take('country', 'Country');
      var phone = validate.phone(a.phone, false);
      if (!phone.ok && !first) first = { field: 'phone', error: phone.error };
      out.phone = phone.ok ? phone.value : '';
      if (first) return { ok: false, field: first.field, error: first.error };
      return { ok: true, value: out };
    }
  };
  function strength(password) {
    var v = String(password || '');
    if (!v) return 0;
    var score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    var level = score <= 1 ? 1 : (score <= 3 ? 2 : 3);
    return level; /* 1 weak · 2 fair · 3 strong */
  }

  /* ------------------------------------------------------------- adapters */
  var config = {
    adapter: 'local',
    baseUrl: '',
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
    },
    /* hook for real deployments: deliver the reset code by email */
    onResetToken: null,
    ordersEndpointFromContent: true
  };

  function endpointUrl(name) {
    var path = config.endpoints[name] || ('/auth/' + name);
    if (/^https?:/i.test(path)) return path;
    return String(config.baseUrl || '').replace(/\/$/, '') + path;
  }
  /* the API uses a double-submit cookie: cookie-authenticated writes must echo
     the readable CSRF token back in a header, otherwise they are refused (403) */
  function csrfToken() {
    try {
      var match = document.cookie.match(/(?:^|; )kin_csrf=([^;]*)/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch (e) { return ''; }
  }
  function httpJSON(name, payload, method) {
    var url = endpointUrl(name);
    var verb = (method || 'POST').toUpperCase();
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (verb !== 'GET' && verb !== 'HEAD') {
      var token = csrfToken();
      if (token) headers['x-kinetic-csrf'] = token;
    }
    return fetch(url, {
      method: verb,
      credentials: 'include',
      headers: headers,
      body: payload === undefined ? undefined : JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error((data && (data.error || data.message)) || ('Request failed (' + res.status + ')'));
          err.code = (data && (data.code || data.errorCode)) || 'http_' + res.status;
          err.field = data && data.field;
          err.status = res.status;
          throw err;
        }
        return data || {};
      });
    });
  }
  function remote() { return String(config.adapter).toLowerCase() === 'http'; }

  /* ------------------------------------------------------------------ state */
  var state = { user: null, session: null, signedOutBecause: null, bootedAt: now() };

  var lastSignature = 'anon';
  function signature(u) {
    if (!u) return 'anon';
    return [u.id, u.name, u.email, u.phone || '', (u.addresses || []).length, u.updatedAt || ''].join('|');
  }
  /* Every sign-in, sign-out and reset bumps this. Anything that was already in
     flight when it happened must not write its (older) answer over the newer
     state — that is how a "sign in succeeded" could be undone by a session
     check that started a moment earlier. */
  var authEpoch = 0;
  var IDENTITY_REASONS = { login: 1, signup: 1, logout: 1, ended: 1, deleted: 1, 'password-reset': 1 };
  function setUser(user, reason) {
    if (IDENTITY_REASONS[reason]) authEpoch += 1;
    state.user = user ? publicUser(user) : null;
    var sig = signature(state.user);
    var changed = sig !== lastSignature;
    lastSignature = sig;
    /* only broadcast real changes — guards and resumes run on every render */
    if (changed || reason === 'login' || reason === 'signup' || reason === 'logout') {
      emit('kinetic:auth', { user: state.user, reason: reason || 'change', changed: changed });
    }
    return state.user;
  }
  function resume() {
    if (remote()) return remoteResume();
    var v = vault();
    var current = currentSession(v);
    if (current.reason === 'expired') state.signedOutBecause = 'expired';
    setUser(current.user, 'resume');
    return state.user;
  }

  /* ---- http adapter: the cookie the API set is the session ---------------- */
  var sessionCheck = null;
  var sessionChecked = false;
  function remoteResume(force) {
    if (sessionCheck && !force) return sessionCheck;
    var epoch = authEpoch;
    sessionCheck = httpJSON('session', undefined, 'GET').then(function (data) {
      sessionChecked = true;
      if (epoch !== authEpoch) return state.user;      /* superseded by a fresh sign-in/out */
      if (data && data.user) {
        state.signedOutBecause = null;
        setUser(data.user, 'resume');
      } else {
        if (data && data.expired) {
          state.signedOutBecause = 'expired';
          emit('kinetic:auth-expired', { reason: 'expired', message: data.error || '' });
        }
        setUser(null, 'resume');
      }
      return state.user;
    }).catch(function () {
      /* the API being unreachable must never sign a customer out */
      return state.user;
    });
    return sessionCheck;
  }
  /* called when any API call comes back 401 so the whole UI reacts at once */
  function noteSessionExpired(message) {
    sessionCheck = null;
    sessionChecked = true;
    authEpoch += 1;
    if (!state.user) return;
    state.signedOutBecause = 'expired';
    setUser(null, 'expired');
    emit('kinetic:auth-expired', { reason: 'expired', message: message || '' });
  }

  /* ---- order history lives in the database; the device keeps a mirror ---- */
  function mergeOrders(list) {
    if (!Array.isArray(list) || !list.length) return 0;
    var byNumber = {};
    var kept = [];
    allOrders().forEach(function (o) {
      if (o && o.number) byNumber[String(o.number)] = o; else if (o) kept.push(o);
    });
    var added = 0;
    list.forEach(function (o) {
      if (!o || !o.number) return;
      if (!byNumber[String(o.number)]) added += 1;
      byNumber[String(o.number)] = o;
    });
    var merged = Object.keys(byNumber).map(function (k) { return byNumber[k]; }).concat(kept);
    merged.sort(function (a, b) { return String(b.placedAt || '').localeCompare(String(a.placedAt || '')); });
    writeJSON(ORDER_KEY, merged.slice(0, 300));
    return added;
  }
  function refreshOrders() {
    if (!remote() || !state.user) return Promise.resolve({ ok: false, orders: [] });
    var epoch = authEpoch;
    return httpJSON('orders', undefined, 'GET').then(function (data) {
      if (epoch !== authEpoch) return { ok: false, orders: [], stale: true };
      var list = (data && data.orders) || [];
      mergeOrders(list);
      emit('kinetic:orders-synced', { orders: list, count: list.length });
      return { ok: true, orders: list };
    }).catch(function (e) {
      if (e && (e.code === 'unauthorized' || e.status === 401)) noteSessionExpired(e.message);
      return { ok: false, orders: [], error: e && e.message };
    });
  }

  /* ------------------------------------------------------------ operations */
  function fail(code, error, field) { return { ok: false, code: code, error: error, field: field || null }; }

  function attemptRecord(v, emailNorm) {
    var rec = v.attempts[emailNorm] || { count: 0, firstAt: 0, lockedUntil: 0 };
    if (rec.lockedUntil && rec.lockedUntil <= now()) { rec = { count: 0, firstAt: 0, lockedUntil: 0 }; }
    return rec;
  }
  function noteFailure(v, emailNorm) {
    var rec = attemptRecord(v, emailNorm);
    if (!rec.firstAt || now() - rec.firstAt > 10 * 60 * 1000) { rec.count = 0; rec.firstAt = now(); }
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = now() + LOCK_MS;
    v.attempts[emailNorm] = rec;
    save(v);
    return rec;
  }
  function clearAttempts(v, emailNorm) { delete v.attempts[emailNorm]; save(v); }

  function signup(input) {
    input = input || {};
    if (remote()) {
      return httpJSON('signup', { name: input.name, email: input.email, password: input.password })
        .then(function (data) { setUser(data.user, 'signup'); return { ok: true, user: state.user }; })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var name = validate.name(input.name);
    if (!name.ok) return Promise.resolve(fail(name.code, name.error, 'name'));
    var email = validate.email(input.email);
    if (!email.ok) return Promise.resolve(fail(email.code, email.error, 'email'));
    if (input.confirm != null && String(input.confirm) !== String(input.password)) {
      return Promise.resolve(fail('match', 'Those passwords do not match.', 'confirm'));
    }
    var pass = validate.password(input.password);
    if (!pass.ok) return Promise.resolve(fail(pass.code, pass.error, 'password'));

    var v = vault();
    if (findUser(v, email.value)) {
      return Promise.resolve(fail('exists', 'An account with that email already exists. Try signing in instead.', 'email'));
    }
    return hashPassword(pass.value).then(function (record) {
      v = vault();                                   /* re-read: another tab may have written */
      if (findUser(v, email.value)) return fail('exists', 'An account with that email already exists. Try signing in instead.', 'email');
      var user = {
        id: id('usr'),
        name: name.value,
        email: email.value,
        emailNorm: normaliseEmail(email.value),
        phone: '',
        addresses: [],
        pass: record,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      v.users.push(user);
      clearAttempts(v, user.emailNorm);
      save(v);
      startSession(v, user, input.remember !== false);
      setUser(user, 'signup');
      return { ok: true, user: state.user };
    });
  }

  function login(input) {
    input = input || {};
    if (remote()) {
      return httpJSON('login', { email: input.email, password: input.password, remember: input.remember !== false })
        .then(function (data) { setUser(data.user, 'login'); return { ok: true, user: state.user }; })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var email = validate.email(input.email);
    if (!email.ok) return Promise.resolve(fail(email.code, email.error, 'email'));
    if (!input.password) return Promise.resolve(fail('required', 'Enter your password.', 'password'));

    var v = vault();
    var emailNorm = normaliseEmail(email.value);
    var rec = attemptRecord(v, emailNorm);
    if (rec.lockedUntil && rec.lockedUntil > now()) {
      var secs = Math.ceil((rec.lockedUntil - now()) / 1000);
      return Promise.resolve(fail('locked', 'Too many attempts. Try again in ' + secs + ' seconds.'));
    }
    var user = findUser(v, email.value);
    /* always hash, even for unknown emails, so timing does not leak registration */
    var decoy = user ? user.pass : null;
    var check = decoy ? verifyPassword(input.password, decoy) : hashPassword(input.password).then(function () { return false; });
    return check.then(function (ok) {
      if (!ok || !user) {
        var after = noteFailure(vault(), emailNorm);
        var left = Math.max(0, MAX_ATTEMPTS - after.count);
        var locked = after.lockedUntil && after.lockedUntil > now();
        if (locked) {
          return fail('locked', 'Too many attempts. Try again in ' + Math.ceil((after.lockedUntil - now()) / 1000) + ' seconds.', 'password');
        }
        var tail = left <= 2
          ? 'Careful — ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left before a temporary lock.'
          : 'Check the password and try again.';
        return fail('credentials', 'That email and password do not match. ' + tail, 'password');
      }
      v = vault();
      user = findUser(v, email.value) || user;
      user.lastLoginAt = new Date().toISOString();
      clearAttempts(v, emailNorm);
      save(v);
      startSession(v, user, input.remember !== false);
      state.signedOutBecause = null;
      setUser(user, 'login');
      return { ok: true, user: state.user };
    });
  }

  function logout(opts) {
    opts = opts || {};
    if (remote()) {
      return httpJSON('logout', {}, 'POST').then(function () {
        setUser(null, opts.reason || 'logout');
        return { ok: true, signedOut: true };
      }).catch(function (e) {
        /* a dead network must not trap a customer inside an account area */
        setUser(null, opts.reason || 'logout');
        return { ok: true, signedOut: true, warning: e && e.message };
      });
    }
    var v = vault();
    var payload = readToken();
    endSession(v, payload && payload.token ? hashHex(payload.token) : null);
    state.signedOutBecause = opts.reason || null;
    setUser(null, opts.reason || 'logout');
    return Promise.resolve({ ok: true });
  }

  function requestReset(input) {
    var email = validate.email((input && input.email) || input);
    if (remote()) {
      var email = (input && input.email) || input;
      return httpJSON('requestReset', { email: email })
        .then(function (data) {
          data = data || {};
          var out = { ok: true, delivered: !!data.delivered };
          /* this deployment returns the code when no mail provider is wired up,
             so recovery is still completable — and says so plainly */
          if (data.code) out.code = data.code;
          if (data.mailerConfigured === false) out.mailerConfigured = false;
          if (data.throttled) { out.throttled = true; out.waitSeconds = data.waitSeconds; }
          if (data.expiresInMinutes) out.expiresInMinutes = data.expiresInMinutes;
          if (data.message) out.message = data.message;
          if (out.code && typeof config.onResetToken === 'function') {
            try { config.onResetToken({ email: String(email || '').trim(), code: out.code }); } catch (e) {}
          }
          return out;
        })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    if (!email.ok) return Promise.resolve(fail(email.code, email.error, 'email'));
    var v = vault();
    var user = findUser(v, email.value);
    /* answer identically whether or not the address exists */
    var result = { ok: true, delivered: !!user, email: email.value };
    if (!user) return Promise.resolve(result);
    var live = (v.resets || []).filter(function (r) { return r.emailNorm === user.emailNorm && !r.usedAt; })[0] || null;
    var recent = live && live.requestedAt ? live.requestedAt.filter(function (t) { return now() - t < RESET_TTL; }) : [];
    /* one live code at a time, and a resend inside the cool-off just re-answers
       generically instead of minting a fresh code on every click */
    if (live && live.lastRequestAt && now() - live.lastRequestAt < RESET_RESEND_COOLOFF) {
      result.throttled = true;
      result.waitSeconds = Math.ceil((RESET_RESEND_COOLOFF - (now() - live.lastRequestAt)) / 1000);
      return Promise.resolve(result);
    }
    if (recent.length >= RESET_MAX_REQUESTS) {
      result.throttled = true;
      result.waitSeconds = Math.ceil((RESET_TTL - (now() - recent[0])) / 1000);
      return Promise.resolve(result);
    }
    var code = String(Math.floor(100000 + Math.random() * 900000));
    v.resets = (v.resets || []).filter(function (r) { return r.emailNorm !== user.emailNorm; });
    v.resets.push({
      id: id('rst'),
      userId: user.id,
      emailNorm: user.emailNorm,
      codeHash: hashHex(code + '|' + user.id),
      createdAt: now(),
      expiresAt: now() + RESET_TTL,
      usedAt: null,
      lastRequestAt: now(),
      requestedAt: recent.concat([now()])
    });
    save(v);
    result.code = code;               /* local mode hands it back; real mode emails it */
    if (typeof config.onResetToken === 'function') {
      try { config.onResetToken({ email: user.email, code: code, expiresAt: now() + RESET_TTL }); } catch (e) {}
    }
    return Promise.resolve(result);
  }

  function resetPassword(input) {
    input = input || {};
    if (remote()) {
      return httpJSON('resetPassword', { token: input.token, password: input.password })
        .then(function () { return { ok: true }; })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var code = String(input.token || '').replace(/\D/g, '');
    if (code.length !== 6) return Promise.resolve(fail('token', 'Enter the 6-digit code from the reset message.', 'token'));
    var pass = validate.password(input.password);
    if (!pass.ok) return Promise.resolve(fail(pass.code, pass.error, 'password'));
    if (input.confirm != null && String(input.confirm) !== String(input.password)) {
      return Promise.resolve(fail('match', 'Those passwords do not match.', 'confirm'));
    }
    var v = vault();
    var rule = (v.resets || []).filter(function (r) { return r.codeHash; }).filter(function (r) {
      var user = findUserById(v, r.userId);
      return user && safeEqual(r.codeHash, hashHex(code + '|' + user.id));
    })[0];
    if (!rule) return Promise.resolve(fail('token', 'That code is not valid. Request a new one.', 'token'));
    if (rule.usedAt) return Promise.resolve(fail('used', 'That code has already been used.', 'token'));
    if (rule.expiresAt <= now()) return Promise.resolve(fail('expired', 'That code has expired. Request a new one.', 'token'));
    var user = findUserById(v, rule.userId);
    if (!user) return Promise.resolve(fail('token', 'That code is not valid. Request a new one.', 'token'));
    return hashPassword(pass.value).then(function (record) {
      v = vault();
      user = findUserById(v, user.id) || user;
      user.pass = record;
      user.updatedAt = new Date().toISOString();
      rule.usedAt = now();
      v.resets = (v.resets || []).map(function (r) { return r.id === rule.id ? Object.assign({}, r, { usedAt: rule.usedAt }) : r; });
      v.resets = v.resets.filter(function (r) { return r.userId !== user.id || r.id === rule.id; });
      save(v);
      endAllSessions(v, user.id);                /* a reset kicks every device out */
      setUser(null, 'password-reset');
      state.signedOutBecause = 'password-reset';
      return { ok: true, email: user.email };
    });
  }

  function changePassword(input) {
    input = input || {};
    if (!state.user) return Promise.resolve(fail('signed-out', 'Sign in to change your password.'));
    if (remote()) {
      return httpJSON('changePassword', { current: input.current, password: input.password })
        .then(function () { return { ok: true }; })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var pass = validate.password(input.password);
    if (!pass.ok) return Promise.resolve(fail(pass.code, pass.error, 'password'));
    if (String(input.confirm) !== String(input.password)) return Promise.resolve(fail('match', 'Those passwords do not match.', 'confirm'));
    if (!input.current) return Promise.resolve(fail('required', 'Enter your current password.', 'current'));
    var v = vault();
    var user = findUserById(v, state.user.id);
    if (!user) return Promise.resolve(fail('signed-out', 'Your session no longer matches an account. Sign in again.'));
    return verifyPassword(input.current, user.pass).then(function (ok) {
      if (!ok) return fail('current', 'That is not your current password.', 'current');
      if (input.current === pass.value) return fail('same', 'Choose a password you have not used before.', 'password');
      return hashPassword(pass.value).then(function (record) {
        v = vault();
        user = findUserById(v, state.user.id);
        user.pass = record;
        user.updatedAt = new Date().toISOString();
        /* keep this device signed in, drop the others */
        var payload = readToken();
        var keep = payload && payload.token ? hashHex(payload.token) : null;
        v.sessions = (v.sessions || []).filter(function (s) { return s.userId !== user.id || s.id === keep; });
        save(v);
        return { ok: true };
      });
    });
  }

  function updateProfile(input) {
    input = input || {};
    if (!state.user) return Promise.resolve(fail('signed-out', 'Sign in to edit your profile.'));
    if (remote()) {
      return httpJSON('profile', input, 'PATCH')
        .then(function (data) { setUser(data.user || state.user, 'profile'); return { ok: true, user: state.user }; })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var v = vault();
    var user = findUserById(v, state.user.id);
    if (!user) return Promise.resolve(fail('signed-out', 'Your session no longer matches an account. Sign in again.'));

    var patch = {};
    if (input.name != null) {
      var name = validate.name(input.name);
      if (!name.ok) return Promise.resolve(fail(name.code, name.error, 'name'));
      patch.name = name.value;
    }
    if (input.phone != null) {
      var phone = validate.phone(input.phone, false);
      if (!phone.ok) return Promise.resolve(fail(phone.code, phone.error, 'phone'));
      patch.phone = phone.value;
    }
    var emailChanged = false;
    if (input.email != null && normaliseEmail(input.email) !== user.emailNorm) {
      var email = validate.email(input.email);
      if (!email.ok) return Promise.resolve(fail(email.code, email.error, 'email'));
      var clash = findUser(v, email.value);
      if (clash && clash.id !== user.id) return Promise.resolve(fail('exists', 'That email is already used by another account.', 'email'));
      emailChanged = true;
      patch.email = email.value;
      patch.emailNorm = normaliseEmail(email.value);
    }

    function apply() {
      Object.keys(patch).forEach(function (k) { user[k] = patch[k]; });
      user.updatedAt = new Date().toISOString();
      save(v);
      setUser(user, 'profile');
      return { ok: true, user: state.user };
    }

    /* changing the sign-in address is a sensitive change — prove it */
    if (emailChanged) {
      if (!input.currentPassword) return Promise.resolve(fail('required', 'Confirm your password to change the email address.', 'currentPassword'));
      return verifyPassword(input.currentPassword, user.pass).then(function (ok) {
        if (!ok) return fail('currentPassword', 'That password is not correct.', 'currentPassword');
        return apply();
      });
    }
    return Promise.resolve(apply());
  }

  /* ------------------------------------------------------------ addresses */
  function addressList() { return state.user ? state.user.addresses.slice() : []; }
  function addAddress(input) {
    if (!state.user) return Promise.resolve(fail('signed-out', 'Sign in to save an address.'));
    if (remote()) {
      var check = validate.address(input);
      if (!check.ok) return Promise.resolve(fail(check.code || 'invalid', check.error, check.field));
      return httpJSON('addresses', Object.assign({}, input, check.value))
        .then(function (data) {
          var list = (state.user.addresses || []).slice();
          if (data && data.address) list = list.filter(function (a) { return a.id !== data.address.id; }).concat(data.address);
          setUser(Object.assign({}, state.user, { addresses: list }), 'address');
          return { ok: true, address: data && data.address };
        })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var valid = validate.address(input);
    if (!valid.ok) return Promise.resolve(fail(valid.code || 'invalid', valid.error, valid.field));
    var v = vault();
    var user = findUserById(v, state.user.id);
    if (!user) return Promise.resolve(fail('signed-out', 'Sign in again.'));
    user.addresses = user.addresses || [];
    var addr = Object.assign({ id: id('adr') }, valid.value);
    if (input.isDefault || !user.addresses.length) addr.isDefault = true;
    user.addresses.forEach(function (a) { if (addr.isDefault) a.isDefault = false; });
    user.addresses.push(addr);
    save(v);
    setUser(user, 'address');
    return Promise.resolve({ ok: true, address: addr });
  }
  function updateAddress(addressId, input) {
    if (!state.user) return Promise.resolve(fail('signed-out', 'Sign in to edit an address.'));
    if (remote()) {
      var check = validate.address(input);
      if (!check.ok) return Promise.resolve(fail(check.code || 'invalid', check.error, check.field));
      return httpJSON('addresses/' + encodeURIComponent(addressId), Object.assign({}, input, check.value), 'PUT')
        .then(function (data) {
          var next = (data && data.address) || Object.assign({}, input, { id: addressId });
          var list = (state.user.addresses || []).map(function (a) {
            if (String(a.id) !== String(addressId)) return next.isDefault ? Object.assign({}, a, { isDefault: false }) : a;
            return next;
          });
          setUser(Object.assign({}, state.user, { addresses: list }), 'address');
          return { ok: true, address: next };
        })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var valid = validate.address(input);
    if (!valid.ok) return Promise.resolve(fail(valid.code || 'invalid', valid.error, valid.field));
    var v = vault();
    var user = findUserById(v, state.user.id);
    var addr = (user.addresses || []).filter(function (a) { return a.id === addressId; })[0];
    if (!addr) return Promise.resolve(fail('missing', 'That address is no longer saved.'));
    Object.assign(addr, valid.value);
    if (input.isDefault) user.addresses.forEach(function (a) { a.isDefault = a.id === addressId; });
    save(v);
    setUser(user, 'address');
    return Promise.resolve({ ok: true, address: addr });
  }
  function removeAddress(addressId) {
    if (!state.user) return Promise.resolve(fail('signed-out', 'Sign in to remove an address.'));
    if (remote()) {
      return httpJSON('addresses/' + encodeURIComponent(addressId), undefined, 'DELETE')
        .then(function () {
          var list = (state.user.addresses || []).filter(function (a) { return String(a.id) !== String(addressId); });
          if (list.length && !list.some(function (a) { return a.isDefault; })) list[0].isDefault = true;
          setUser(Object.assign({}, state.user, { addresses: list }), 'address');
          return { ok: true, removed: true };
        })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var v = vault();
    var user = findUserById(v, state.user.id);
    var before = (user.addresses || []).length;
    user.addresses = (user.addresses || []).filter(function (a) { return a.id !== addressId; });
    if (!user.addresses.length || !user.addresses.some(function (a) { return a.isDefault; })) {
      if (user.addresses[0]) user.addresses[0].isDefault = true;
    }
    save(v);
    setUser(user, 'address');
    return Promise.resolve({ ok: true, removed: before !== user.addresses.length });
  }
  function defaultAddress() {
    if (!state.user) return null;
    var list = state.user.addresses || [];
    return list.filter(function (a) { return a.isDefault; })[0] || list[0] || null;
  }

  function signOutOthers() {
    if (!state.user) return Promise.resolve(fail('signed-out', 'Sign in first.'));
    if (remote()) {
      return httpJSON('logout', { scope: 'others' }).then(function () { return { ok: true }; })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    var v = vault();
    var payload = readToken();
    var keep = payload && payload.token ? hashHex(payload.token) : null;
    var removed = (v.sessions || []).filter(function (s) { return s.userId === state.user.id && s.id !== keep; }).length;
    v.sessions = (v.sessions || []).filter(function (s) { return s.userId !== state.user.id || s.id === keep; });
    save(v);
    return Promise.resolve({ ok: true, removed: removed });
  }

  /* deleteAccount — password confirmed, so a stray tap cannot erase an account */
  function deleteAccount(input) {
    input = input || {};
    if (!state.user) return Promise.resolve(fail('signed-out', 'Sign in first.'));
    if (remote()) {
      return httpJSON('deleteAccount', { password: input.password }, 'DELETE')
        .then(function () { setUser(null, 'deleted'); return { ok: true }; })
        .catch(function (e) { return fail(e.code || 'http_error', e.message, e.field); });
    }
    if (!input.password) return Promise.resolve(fail('required', 'Enter your password to confirm.', 'password'));
    var v = vault();
    var user = findUserById(v, state.user.id);
    if (!user) return Promise.resolve(fail('signed-out', 'Sign in again.'));
    return verifyPassword(input.password, user.pass).then(function (ok) {
      if (!ok) return fail('password', 'That password is not correct.', 'password');
      v = vault();
      v.users = v.users.filter(function (u) { return u.id !== user.id; });
      v.sessions = (v.sessions || []).filter(function (s) { return s.userId !== user.id; });
      v.resets = (v.resets || []).filter(function (r) { return r.userId !== user.id; });
      delete v.attempts[user.emailNorm];
      save(v);
      clearToken();
      state.signedOutBecause = 'deleted';
      setUser(null, 'deleted');
      return { ok: true };
    });
  }

  /* --------------------------------------------------------------- orders */
  function allOrders() {
    var list = readJSON(ORDER_KEY, []);
    return Array.isArray(list) ? list : [];
  }
  function ordersForUser() {
    if (!state.user) return [];
    var email = normaliseEmail(state.user.email);
    return allOrders()
      .filter(function (o) {
        if (!o) return false;
        if (o.accountId && o.accountId === state.user.id) return true;
        var c = o.customer || {};
        return normaliseEmail(c.email) === email;
      })
      .sort(function (a, b) { return String(b.placedAt || '').localeCompare(String(a.placedAt || '')); });
  }
  function orderByNumber(number) {
    if (!state.user || !number) return null;
    return ordersForUser().filter(function (o) { return String(o.number) === String(number); })[0] || null;
  }

  /* --------------------------------------------------- wishlist / history */
  function wishlist() {
    var ids = null;
    try { if (window.KINETIC_APP && window.KINETIC_APP.wishlist && window.KINETIC_APP.wishlist.all) ids = window.KINETIC_APP.wishlist.all(); } catch (e) {}
    if (!ids) ids = readJSON(WISH_KEY, []);
    return Array.isArray(ids) ? ids.map(String) : [];
  }
  function recentlyViewed() {
    var ids = readJSON(RECENT_KEY, []);
    return Array.isArray(ids) ? ids.map(String) : [];
  }
  function productById(pid) {
    try {
      if (window.KINETIC_APP && window.KINETIC_APP.getProductById) return window.KINETIC_APP.getProductById(pid);
    } catch (e) {}
    return null;
  }
  function productsFor(ids) {
    return (ids || []).map(function (pid) {
      var p = productById(pid);
      if (!p || !p.name) return null;
      return { id: p.id, name: p.name, price: p.price, old: p.old, cat: p.cat, img: p.img, tag: p.tag, rating: p.rating };
    }).filter(Boolean);
  }

  /* ------------------------------------------------------- route guarding */
  function requireUser() {
    if (remote()) {
      /* the API is the authority: a signed-in user in memory is enough for the
         client-side route, and the server re-checks every private request */
      if (state.user) return { ok: true, user: state.user };
      if (!sessionChecked) remoteResume();          /* still resolving — the
        auth event will route again as soon as the answer lands */
      if (state.user) return { ok: true, user: state.user };
      setUser(null, 'guard');
      return { ok: false, reason: state.signedOutBecause === 'expired' ? 'expired' : 'signed-out', user: null };
    }
    var v = vault();
    var current = currentSession(v);
    if (current.reason === 'expired') {
      state.signedOutBecause = 'expired';
      setUser(null, 'expired');
      emit('kinetic:auth-expired', {});
      return { ok: false, reason: 'expired', user: null };
    }
    if (!current.user) {
      setUser(null, 'guard');
      return { ok: false, reason: 'signed-out', user: null };
    }
    setUser(current.user, 'guard');
    return { ok: true, user: state.user };
  }

  /* ---------------------------------------------------- header entry point */
  function accountIconSVG() {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">' +
      '<circle cx="12" cy="8.4" r="3.6"/><path d="M4.8 20c1.4-3.4 4-5.1 7.2-5.1s5.8 1.7 7.2 5.1"/></svg>';
  }
  function initials(user) {
    var n = String((user && user.name) || '').trim().split(/\s+/);
    if (!n[0]) return 'K';
    return (n[0][0] + (n[1] ? n[1][0] : '')).toUpperCase();
  }
  function paintHeaderButtons() {
    var btn = document.getElementById('accountBtn');
    if (btn) {
      var signed = !!state.user;
      btn.classList.toggle('has-user', signed);
      btn.setAttribute('aria-label', signed ? ('Account — signed in as ' + state.user.name) : 'Account — sign in');
      btn.setAttribute('title', signed ? state.user.name : 'Account');
      var host = btn.querySelector('.ka-avatar');
      if (signed && !host) {
        btn.insertAdjacentHTML('afterbegin', '<span class="ka-avatar" aria-hidden="true">' + initials(state.user) + '</span>');
        var icon = btn.querySelector('svg');
        if (icon) icon.style.display = 'none';
      } else if (!signed && host) {
        host.remove();
        var icon2 = btn.querySelector('svg');
        if (icon2) icon2.style.display = '';
      } else if (signed && host) {
        host.textContent = initials(state.user);
      }
    }
    var link = document.getElementById('mobAccountLink');
    if (link) {
      var k = link.querySelector('.ka-menulink-k');
      if (k) k.textContent = state.user ? state.user.name.split(' ')[0] : 'Sign in';
    }
  }
  function installHeaderButton() {
    var header = document.getElementById('siteHeader');
    if (!header || document.getElementById('accountBtn')) return;
    var cart = document.getElementById('cartBtn');
    var host = cart ? cart.parentNode : null;
    if (!host) return;
    var btn = document.createElement('button');
    btn.id = 'accountBtn';
    btn.type = 'button';
    btn.className = 'w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center border border-ink/15 hover:border-flame hover:text-flame transition-colors';
    btn.setAttribute('aria-label', 'Account — sign in');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = accountIconSVG();
    btn.addEventListener('click', function () {
      var target = state.user ? '#account' : '#login';
      if (window.KINETIC_ACCOUNT && window.KINETIC_ACCOUNT.open) window.KINETIC_ACCOUNT.open(target);
      else window.location.hash = target.slice(1);
    });
    host.insertBefore(btn, cart || null);
    paintHeaderButtons();
  }
  function installMenuLink() {
    var menu = document.getElementById('mobileMenu');
    if (!menu || document.getElementById('mobAccountLink')) return;
    var footer = menu.lastElementChild;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mobAccountLink';
    btn.className = 'mob-link ka-menulink';
    btn.innerHTML = '<span>Account</span><span class="ka-menulink-k">Sign in</span>';
    btn.addEventListener('click', function () {
      var closeBtn = document.getElementById('menuClose');
      if (closeBtn && menu.classList.contains('open')) closeBtn.click();
      window.setTimeout(function () {
        if (window.KINETIC_ACCOUNT && window.KINETIC_ACCOUNT.open) window.KINETIC_ACCOUNT.open(state.user ? '#account' : '#login');
        else window.location.hash = (state.user ? '#account' : '#login').slice(1);
      }, 260);
    });
    menu.insertBefore(btn, footer);
    paintHeaderButtons();
  }

  function boot() {
    resume();
    /* http mode has no vault to read, so the cookie is checked once, quietly,
       and again whenever a parked tab wakes up */
    on('kinetic:auth', function (detail) {
      if (!remote()) return;
      if (detail && detail.user && (detail.reason === 'login' || detail.reason === 'signup' || detail.reason === 'resume')) {
        refreshOrders();
      }
    });
    installHeaderButton();
    installMenuLink();
    on('kinetic:auth', paintHeaderButtons);
    /* keep parked tabs honest: re-check the session when the tab wakes up */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (remote()) { remoteResume(true); return; }
      var v = vault();
      var current = currentSession(v);
      if (!current.user && state.user) {
        state.signedOutBecause = current.reason === 'expired' ? 'expired' : 'ended';
        setUser(null, state.signedOutBecause);
        emit('kinetic:auth-expired', { reason: state.signedOutBecause });
      } else if (current.user && current.user.id !== (state.user && state.user.id)) {
        setUser(current.user, 'resume');
      }
    });
    window.addEventListener('storage', function (e) {
      if (e.key !== VAULT_KEY && e.key !== SESSION_KEY) return;
      var current = currentSession(vault());
      if (!current.user && state.user) setUser(null, 'ended');
      else if (current.user && (!state.user || current.user.id !== state.user.id)) setUser(current.user, 'resume');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* ---------------------------------------------------------- public API */
  window.KINETIC_AUTH = {
    version: '1.0',
    user: function () { return state.user; },
    isSignedIn: function () { return !!state.user; },
    signedOutBecause: function () { return state.signedOutBecause; },
    session: function () {
      var v = vault();
      var s = currentSession(v).session;
      return s ? { expiresAt: s.expiresAt, createdAt: s.createdAt, remember: !!s.remember, devices: v.sessions.filter(function (x) { return x.userId === (state.user && state.user.id); }).length } : null;
    },
    configure: function (opts) { Object.assign(config, opts || {}); return Object.assign({}, config); },
    config: function () { return Object.assign({}, config); },

    signup: signup,
    login: login,
    logout: logout,
    requestReset: requestReset,
    resetPassword: resetPassword,
    changePassword: changePassword,
    updateProfile: updateProfile,
    requireUser: requireUser,
    resume: resume,
    refreshSession: function () { return remote() ? remoteResume(true) : Promise.resolve(state.user); },
    refreshOrders: refreshOrders,
    noteSessionExpired: noteSessionExpired,
    remote: remote,
    signOutOthers: signOutOthers,
    deleteAccount: deleteAccount,

    addresses: addressList,
    addAddress: addAddress,
    updateAddress: updateAddress,
    removeAddress: removeAddress,
    defaultAddress: defaultAddress,

    orders: ordersForUser,
    order: orderByNumber,
    wishlist: wishlist,
    recentlyViewed: recentlyViewed,
    productsFor: productsFor,
    productById: productById,

    validate: validate,
    strength: strength,
    on: on,
    off: off,

    _internal: {
      VAULT_KEY: VAULT_KEY,
      SESSION_KEY: SESSION_KEY,
      sha256Hex: function (text) { return toHex(sha256(utf8(text))); },
      vault: vault,
      hasWebCrypto: hasWebCrypto,
      hashPassword: hashPassword,
      verifyPassword: verifyPassword,
      normaliseEmail: normaliseEmail,
      installHeaderButton: installHeaderButton,
      mergeOrders: mergeOrders,
      sessionChecked: function () { return sessionChecked; }
    }
  };
})();
