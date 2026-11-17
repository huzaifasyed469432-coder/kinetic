/* ============================================================================
   KINETIC® — account area (auth screens + dashboard)
   ----------------------------------------------------------------------------
   Routes (hash based, matching the shop's existing #checkout / #product/<id>):
     #login            #signup            #forgot       #reset/<code>
     #account          #account/profile   #account/addresses
     #account/orders   #account/order/<number>
     #account/wishlist #account/recent    #account/security
   Everything under #account is guarded: signed-out visitors are sent to #login
   with their destination remembered, and an expired session says so.
   Requires window.KINETIC_AUTH (kinetic-auth.js).
   ========================================================================= */
(function () {
  'use strict';

  var AUTH = window.KINETIC_AUTH;
  if (!AUTH) { return; }

  var NAV = [
    { id: 'overview', label: 'Overview', route: '#account', icon: '<path d="M4 11.5 12 5l8 6.5V20H4z"/>' },
    { id: 'orders', label: 'Orders', route: '#account/orders', icon: '<path d="M5 4h14l1 16H4z"/><path d="M9 8h6"/>' },
    { id: 'profile', label: 'Profile', route: '#account/profile', icon: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c1.5-3.3 4-5 7-5s5.5 1.7 7 5"/>' },
    { id: 'addresses', label: 'Addresses', route: '#account/addresses', icon: '<path d="M12 21s-6-5.4-6-10a6 6 0 0 1 12 0c0 4.6-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>' },
    { id: 'wishlist', label: 'Wishlist', route: '#account/wishlist', icon: '<path d="M12 20s-7-4.5-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.5 12 20 12 20z"/>' },
    { id: 'recent', label: 'Recently viewed', route: '#account/recent', icon: '<path d="M12 4v8l6 3"/><circle cx="12" cy="12" r="8"/>' },
    { id: 'security', label: 'Security', route: '#account/security', icon: '<path d="M12 3l7 3v6c0 4.4-3 8.1-7 9-4-.9-7-4.6-7-9V6z"/>' }
  ];

  var root = null, body = null, navEl = null, live = null, currentSection = 'overview', busy = false;
  var pendingNext = null;

  /* --------------------------------------------------------------- helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, r) { return (r || document).querySelector(sel); }
  function $$(sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); }
  function money(cents) {
    var n = Number(cents || 0) / 100;
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function money0(dollars) { return '$' + Number(dollars || 0).toFixed(0); }
  function dateLong(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function dateShort(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function announce(text) { if (live) live.textContent = text || ''; }

  function pillClass(value) {
    var v = String(value || '').toLowerCase();
    if (/paid|deliver/.test(v)) return 'pill-paid';
    if (/unpaid|await|pending|process|packed|ship/.test(v)) return 'pill-unpaid';
    if (/refund|cancel|fail/.test(v)) return 'pill-refunded';
    return 'pill-neutral';
  }
  function orderStatusLabel(order) {
    var status = String((order && order.status) || 'Placed');
    return status;
  }
  function paymentLabel(order) {
    var ps = String((order && order.paymentStatus) || 'unpaid');
    return ps.charAt(0).toUpperCase() + ps.slice(1);
  }

  function field(opts) {
    var o = opts || {};
    var id = o.id;
    var attrs = [
      'class="ka-in"',
      'id="' + id + '"',
      'name="' + (o.name || id) + '"',
      'type="' + (o.type || 'text') + '"',
      o.autocomplete ? 'autocomplete="' + o.autocomplete + '"' : '',
      o.inputmode ? 'inputmode="' + o.inputmode + '"' : '',
      o.maxlength ? 'maxlength="' + o.maxlength + '"' : '',
      'aria-describedby="' + id + 'Err"',
      'aria-invalid="false"',
      o.value ? 'value="' + esc(o.value) + '"' : '',
      o.placeholder ? 'placeholder="' + esc(o.placeholder) + '"' : '',
      o.required ? 'required' : ''
    ].filter(Boolean).join(' ');
    return '<div class="ka-field">' +
      '<label class="ka-lbl" for="' + id + '">' + esc(o.label) + (o.required ? '<span class="ka-req" aria-hidden="true">*</span>' : '') + '</label>' +
      '<input ' + attrs + '>' +
      '<div class="ka-err" id="' + id + 'Err" data-err="' + esc(o.errorKey || id) + '" role="alert"></div>' +
      (o.hint ? '<div class="ka-hint">' + o.hint + '</div>' : '') +
      '</div>';
  }
  function passwordField(opts) {
    var o = opts || {};
    var id = o.id;
    return '<div class="ka-field">' +
      '<label class="ka-lbl" for="' + id + '">' + esc(o.label) + '<span class="ka-req" aria-hidden="true">*</span></label>' +
      '<div class="ka-passwrap">' +
        '<input class="ka-in" id="' + id + '" name="' + (o.name || id) + '" type="password" autocomplete="' + (o.autocomplete || 'current-password') + '" ' +
          'aria-describedby="' + id + 'Err" aria-invalid="false" ' + (o.maxlength ? 'maxlength="' + o.maxlength + '" ' : '') +
          (o.placeholder ? 'placeholder="' + esc(o.placeholder) + '" ' : '') + '>' +
        '<button type="button" class="ka-reveal" data-reveal="' + id + '" aria-label="Show password">Show</button>' +
      '</div>' +
      '<div class="ka-err" id="' + id + 'Err" data-err="' + esc(o.errorKey || id) + '" role="alert"></div>' +
      (o.hint ? '<div class="ka-hint">' + o.hint + '</div>' : '') +
      '</div>';
  }
  function strengthBlock(id) {
    return '<div class="ka-strength" data-strength="' + id + '" data-level="0">' +
      '<span class="ka-strength-bars" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="ka-strength-txt" aria-live="polite">Password strength</span>' +
      '</div>' +
      '<div class="ka-rules" data-rules="' + id + '">' +
        '<span class="ka-rule" data-rule="len">At least 8 characters</span>' +
        '<span class="ka-rule" data-rule="mix">Letters and numbers</span>' +
        '<span class="ka-rule" data-rule="case">Upper and lower case</span>' +
        '<span class="ka-rule" data-rule="symbol">A symbol (!?&amp;…)</span>' +
      '</div>';
  }

  function bindReveal(scope) {
    $$('[data-reveal]', scope).forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        var input = document.getElementById(btn.getAttribute('data-reveal'));
        if (!input) return;
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
    });
    $$('[data-strength]', scope).forEach(function (wrap) {
      var id = wrap.getAttribute('data-strength');
      var input = document.getElementById(id);
      if (!input || input.dataset.strengthBound) return;
      input.dataset.strengthBound = '1';
      var rules = $('[data-rules="' + id + '"]', scope);
      input.addEventListener('input', function () {
        var v = input.value;
        var level = AUTH.strength(v);
        wrap.setAttribute('data-level', String(level));
        $('.ka-strength-txt', wrap).textContent = level === 0 ? 'Password strength' : (level === 1 ? 'Weak' : (level === 2 ? 'Fair' : 'Strong'));
        if (rules) {
          var checks = {
            len: v.length >= 8,
            mix: /[0-9]/.test(v) && /[A-Za-z]/.test(v),
            case: /[A-Z]/.test(v) && /[a-z]/.test(v),
            symbol: /[^A-Za-z0-9]/.test(v)
          };
          Object.keys(checks).forEach(function (k) {
            var el = $('[data-rule="' + k + '"]', rules);
            if (el) el.classList.toggle('on', checks[k]);
          });
        }
      });
    });
  }

  /* live API vs standalone build: the same screen, honest copy */
  function liveApi() { return window.KINETIC_API_MODE === 'live'; }
  function whereSaved() { return liveApi() ? 'Saved to your KINETIC account' : 'Kept on this device'; }
  function profileSubline() { return liveApi() ? 'Securely stored on your KINETIC account and prefilled at checkout' : 'Kept on this device, and prefilled at checkout'; }
  function sessionsSubline() { return liveApi() ? 'Server-side sessions — sign out here or everywhere at once' : 'Remembered in this browser only'; }

  function paintFieldError(scope, key, message) {
    var box = $('[data-err="' + key + '"]', scope);
    var input = document.getElementById(key) || $('[name="' + key + '"]', scope);
    if (box) box.textContent = message || '';
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  function clearErrors(scope) {
    $$('.ka-err', scope).forEach(function (e) { e.textContent = ''; });
    $$('[aria-invalid="true"]', scope).forEach(function (e) { e.setAttribute('aria-invalid', 'false'); });
  }
  function showBanner(scope, kind, title, text) {
    var box = $('.ka-msg', scope);
    if (!box) return null;
    box.className = 'ka-msg show ' + (kind === 'error' ? 'is-error' : (kind === 'success' ? 'is-success' : ''));
    box.innerHTML = '<b>' + esc(title) + '</b>' + (text ? ' ' + esc(text) : '');
    return box;
  }
  function clearBanner(scope) {
    var box = $('.ka-msg', scope);
    if (box) { box.className = 'ka-msg'; box.innerHTML = ''; }
  }
  function applyResult(scope, result, opts) {
    opts = opts || {};
    clearErrors(scope);
    if (result && result.ok) { clearBanner(scope); return true; }
    var fieldKey = result && result.field;
    if (fieldKey) paintFieldError(scope, fieldKey, result.error);
    else showBanner(scope, 'error', 'Not quite.', result && result.error ? result.error : 'Something went wrong.');
    var input = fieldKey ? document.getElementById(fieldKey) : null;
    if (input) { try { input.focus(); } catch (e) {} }
    announce(result && result.error ? result.error : '');
    return false;
  }
  /* validate every field at once so a customer fixes the form in one pass
     instead of discovering problems one submit at a time */
  function validateAll(scope, checks) {
    var bad = [];
    clearErrors(scope);
    Object.keys(checks).forEach(function (key) {
      var spec = checks[key];
      var value = spec.value == null ? '' : spec.value;
      var result = spec.rule(value);
      if (result && result.ok === false) {
        paintFieldError(scope, key, result.error);
        bad.push(key);
      }
    });
    if (bad.length) {
      announce(bad.length + ' field' + (bad.length === 1 ? '' : 's') + ' need attention.');
      var first = document.getElementById(bad[0]);
      if (first) { try { first.focus(); } catch (e) {} }
      return false;
    }
    return true;
  }

  function setBusy(scope, isBusy) {
    busy = isBusy;
    var btn = $('button[type="submit"]', scope);
    if (btn) {
      btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
      btn.disabled = isBusy;
    }
    $$('input, select', scope).forEach(function (i) { i.disabled = isBusy; });
  }

  /* ----------------------------------------------------------- auth screens */
  function loginScreen(prefill) {
    var ctx = { next: (prefill && prefill.next) || pendingNext || null };
    var html = '' +
      '<div class="ka-auth"><div class="ka-panel">' +
        '<div class="ka-eyebrow">KINETIC / account</div>' +
        '<h1 class="ka-h1">Welcome<br>back</h1>' +
        '<p class="ka-sub">Sign in to see your orders, saved addresses and wishlist — your bag stays exactly where you left it.</p>' +
        '<div class="ka-msg" role="status" aria-live="polite"></div>' +
        (ctx.next ? '<div class="ka-note" data-next-note>Sign in to continue to <b>' + esc(String(ctx.next).replace('#', '')) + '</b>.</div>' : '') +
        '<form class="ka-form" id="kaLogin" novalidate>' +
          field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', required: true, inputmode: 'email', maxlength: 160, placeholder: 'you@example.com' }) +
          passwordField({ id: 'password', label: 'Password', autocomplete: 'current-password', placeholder: 'Your password' }) +
          '<label class="ka-check"><input type="checkbox" id="remember" checked><span>Keep me signed in on this device</span></label>' +
          '<button type="button" class="ka-forgot" data-go="#forgot" style="background:none;border:0;padding:0;cursor:pointer">Forgot your password?</button>' +
          '<button type="submit" class="ka-btn"><span class="ka-spin" aria-hidden="true"></span><span>Sign in</span></button>' +
        '</form>' +
        '<div class="ka-alt">New to KINETIC? <button type="button" class="ka-link" data-go="#signup">Create an account</button></div>' +
        '<div class="ka-trust"><span>◆ 30-day run trial</span><span>◆ Encrypted passwords</span><span>◆ Your bag is never lost</span></div>' +
      '</div></div>';

    return {
      html: html,
      mount: function (scope) {
        bindReveal(scope);
        var form = $('#kaLogin', scope);
        var email = $('#email', scope), pass = $('#password', scope);
        try { var last = localStorage.getItem('kinetic-account-last-email'); if (last) email.value = last; } catch (e) {}
        if (prefill && prefill.email) email.value = prefill.email;
        if (AUTH.signedOutBecause() === 'expired') {
          showBanner(scope, 'error', 'Session expired.', 'For your safety we signed you out. Please sign in again.');
          AUTH.logout({ reason: null });
        } else if (AUTH.signedOutBecause() === 'password-reset') {
          showBanner(scope, 'success', 'Password updated.', 'Sign in with your new password.');
        } else if (prefill && prefill.message) {
          showBanner(scope, prefill.messageKind || 'success', prefill.message, prefill.messageText || '');
        }
        email.focus();
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (busy) return;
          if (!validateAll(scope, {
            email: { value: email.value, rule: AUTH.validate.email },
            password: { value: pass.value, rule: function (v) { return v ? { ok: true } : { ok: false, error: 'Enter your password.' }; } }
          })) return;
          setBusy(scope, true);
          announce('Signing you in…');
          AUTH.login({ email: email.value, password: pass.value, remember: $('#remember', scope).checked })
            .then(function (res) {
              setBusy(scope, false);
              if (!applyResult(scope, res)) { pass.value = ''; return; }
              try { localStorage.setItem('kinetic-account-last-email', String(email.value).trim().toLowerCase()); } catch (err) {}
              pass.value = '';
              announce('Signed in.');
              go(ctx.next || '#account', { replace: true });
            });
        });
      }
    };
  }

  function signupScreen() {
    var html = '' +
      '<div class="ka-auth"><div class="ka-panel ka-panel--wide">' +
        '<div class="ka-eyebrow">KINETIC / new account</div>' +
        '<h1 class="ka-h1">Join the<br>club</h1>' +
        '<p class="ka-sub">One account for orders, saved addresses, your wishlist and early access to drops. It takes about twenty seconds.</p>' +
        '<div class="ka-msg" role="status" aria-live="polite"></div>' +
        '<form class="ka-form" id="kaSignup" novalidate>' +
          field({ id: 'name', label: 'Full name', autocomplete: 'name', required: true, maxlength: 80, placeholder: 'Ayan Malik' }) +
          field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', required: true, inputmode: 'email', maxlength: 160, placeholder: 'you@example.com' }) +
          passwordField({ id: 'password', label: 'Password', autocomplete: 'new-password', maxlength: 128, placeholder: 'At least 8 characters', hint: '' }) +
          strengthBlock('password') +
          passwordField({ id: 'confirm', label: 'Confirm password', autocomplete: 'new-password', maxlength: 128 }) +
          '<label class="ka-check"><input type="checkbox" id="terms"><span>I agree to the KINETIC terms and privacy policy.</span></label>' +
          '<label class="ka-check"><input type="checkbox" id="remember" checked><span>Keep me signed in on this device</span></label>' +
          '<button type="submit" class="ka-btn"><span class="ka-spin" aria-hidden="true"></span><span>Create account</span></button>' +
        '</form>' +
        '<div class="ka-alt">Already have an account? <button type="button" class="ka-link" data-go="#login">Sign in</button></div>' +
        '<div class="ka-trust"><span>◆ Passwords are hashed, never stored</span></div>' +
      '</div></div>';
    return {
      html: html,
      mount: function (scope) {
        bindReveal(scope);
        var form = $('#kaSignup', scope);
        var name = $('#name', scope), email = $('#email', scope), pass = $('#password', scope), confirm = $('#confirm', scope), terms = $('#terms', scope);
        name.focus();
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (busy) return;
          clearBanner(scope);
          if (!terms.checked) { showBanner(scope, 'error', 'One more thing.', 'Please accept the terms to create an account.'); terms.focus(); return; }
          var ok = validateAll(scope, {
            name: { value: name.value, rule: AUTH.validate.name },
            email: { value: email.value, rule: AUTH.validate.email },
            password: { value: pass.value, rule: AUTH.validate.password },
            confirm: { value: confirm.value, rule: function (v) {
              return String(v) === String(pass.value) ? { ok: true } : { ok: false, error: 'Those passwords do not match.' };
            } }
          });
          if (!ok) return;
          setBusy(scope, true);
          announce('Creating your account…');
          AUTH.signup({ name: name.value, email: email.value, password: pass.value, confirm: confirm.value, remember: $('#remember', scope).checked })
            .then(function (res) {
              setBusy(scope, false);
              if (!applyResult(scope, res)) { if (res.field === 'confirm' || res.field === 'password') { pass.value = ''; confirm.value = ''; } return; }
              try { localStorage.setItem('kinetic-account-last-email', String(email.value).trim().toLowerCase()); } catch (err) {}
              pass.value = ''; confirm.value = '';
              announce('Account created.');
              go('#account', { replace: true });
            });
        });
      }
    };
  }

  function forgotScreen() {
    var html = '' +
      '<div class="ka-auth"><div class="ka-panel">' +
        '<div class="ka-eyebrow">KINETIC / recovery</div>' +
        '<h1 class="ka-h1">Reset<br>password</h1>' +
        '<p class="ka-sub">Tell us the email on the account and we will issue a 6-digit reset code that expires in 15 minutes.</p>' +
        '<div class="ka-msg" role="status" aria-live="polite"></div>' +
        '<div data-step="ask">' +
          '<form class="ka-form" id="kaForgot" novalidate>' +
            field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', required: true, inputmode: 'email', maxlength: 160, placeholder: 'you@example.com' }) +
            '<button type="submit" class="ka-btn"><span class="ka-spin" aria-hidden="true"></span><span>Send reset code</span></button>' +
          '</form>' +
        '</div>' +
        '<div data-step="code" hidden>' +
          '<div class="ka-note">For your safety this answer is the same whether or not the address is registered.</div>' +
          '<div class="ka-code" data-codebox hidden><b data-code>— — — — — —</b></div>' +
          '<div class="ka-note" data-localnote hidden><b>No mail provider on this deployment:</b> so the reset code is shown here instead of being emailed. Configure <b>SMTP_URL</b> (or <b>RESEND_API_KEY</b>) on the API and the same flow sends it by email.</div>' +
          '<div class="ka-actions-row"><button type="button" class="ka-btn ka-btn-sm" data-continue>Enter code</button>' +
          '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-resend>Send another</button></div>' +
        '</div>' +
        '<div class="ka-alt">Remembered it? <button type="button" class="ka-link" data-go="#login">Back to sign in</button></div>' +
      '</div></div>';
    return {
      html: html,
      mount: function (scope) {
        var form = $('#kaForgot', scope);
        var email = $('#email', scope);
        var last = null;
        try { last = localStorage.getItem('kinetic-account-last-email'); } catch (e) {}
        if (last) email.value = last;
        email.focus();
        function send() {
          if (busy) return;
          setBusy(scope, true);
          announce('Sending reset code…');
          AUTH.requestReset({ email: email.value }).then(function (res) {
            setBusy(scope, false);
            if (!applyResult(scope, res)) return;
            $('[data-step="ask"]', scope).hidden = true;
            $('[data-step="code"]', scope).hidden = false;
            var box = $('[data-codebox]', scope), codeEl = $('[data-code]', scope), note = $('[data-localnote]', scope);
            if (res.code) {
              codeEl.textContent = res.code;
              box.hidden = false;
              note.hidden = false;
              var btn = $('[data-continue]', scope);
              btn.dataset.code = res.code;
              announce('Reset code issued.');
              showBanner(scope, 'success', 'Code ready.', 'It expires in 15 minutes.');
              btn.focus();
            } else {
              box.hidden = true;
              note.hidden = true;
              if (res.throttled) {
                showBanner(scope, 'error', 'One moment.', 'A code was already sent. You can ask for another in ' + (res.waitSeconds || 60) + ' seconds.');
              } else {
                showBanner(scope, 'success', 'Check your inbox.', 'If that address has an account, a reset code is on its way.');
              }
            }
          });
        }
        form.addEventListener('submit', function (e) { e.preventDefault(); send(); });
        var again = $('[data-resend]', scope);
        if (again) again.addEventListener('click', send);
        var cont = $('[data-continue]', scope);
        if (cont) cont.addEventListener('click', function () { go('#reset/' + (cont.dataset.code || '')); });
      }
    };
  }

  function resetScreen(code) {
    var html = '' +
      '<div class="ka-auth"><div class="ka-panel">' +
        '<div class="ka-eyebrow">KINETIC / recovery</div>' +
        '<h1 class="ka-h1">New<br>password</h1>' +
        '<p class="ka-sub">Enter the 6-digit code and choose the password you want to sign in with. Every device is signed out once it changes.</p>' +
        '<div class="ka-msg" role="status" aria-live="polite"></div>' +
        '<form class="ka-form" id="kaAcctReset" novalidate>' +
          field({ id: 'token', label: '6-digit code', inputmode: 'numeric', maxlength: 6, required: true, value: code || '', placeholder: '000000', hint: 'Digits only — paste it if you copied it.' }) +
          passwordField({ id: 'password', label: 'New password', autocomplete: 'new-password', maxlength: 128 }) +
          strengthBlock('password') +
          passwordField({ id: 'confirm', label: 'Confirm new password', autocomplete: 'new-password', maxlength: 128 }) +
          '<button type="submit" class="ka-btn"><span class="ka-spin" aria-hidden="true"></span><span>Set new password</span></button>' +
        '</form>' +
        '<div class="ka-alt">Need a code? <button type="button" class="ka-link" data-go="#forgot">Request one</button></div>' +
      '</div></div>';
    return {
      html: html,
      mount: function (scope) {
        bindReveal(scope);
        var form = $('#kaAcctReset', scope);
        var token = $('#token', scope), pass = $('#password', scope), confirm = $('#confirm', scope);
        (code ? pass : token).focus();
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (busy) return;
          if (!validateAll(scope, {
            token: { value: token.value, rule: function (v) { return /^\d{6}$/.test(String(v).trim()) ? { ok: true } : { ok: false, error: 'Enter the 6-digit code from the reset message.' }; } },
            password: { value: pass.value, rule: AUTH.validate.password },
            confirm: { value: confirm.value, rule: function (v) { return String(v) === String(pass.value) ? { ok: true } : { ok: false, error: 'Those passwords do not match.' }; } }
          })) return;
          setBusy(scope, true);
          announce('Updating your password…');
          AUTH.resetPassword({ token: token.value, password: pass.value, confirm: confirm.value }).then(function (res) {
            setBusy(scope, false);
            if (!applyResult(scope, res)) { if (res.field !== 'token') { pass.value = ''; confirm.value = ''; } return; }
            pass.value = ''; confirm.value = '';
            go('#login', { replace: true, state: { message: 'Password updated.', messageKind: 'success', messageText: 'Sign in with your new password.' } });
          });
        });
      }
    };
  }

  /* ------------------------------------------------------------- dashboard */
  function navHTML(counts) {
    return NAV.map(function (item) {
      var n = counts && counts[item.id];
      return '<button type="button" data-nav="' + item.route + '"' + (item.id === currentSection ? ' class="is-on" aria-current="page"' : '') + '>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">' + item.icon + '</svg>' +
        '<span>' + esc(item.label) + '</span>' +
        (n != null ? '<span class="ka-nav-n">' + n + '</span>' : '') +
        '</button>';
    }).join('');
  }

  function shellHTML(user, counts) {
    return '' +
      '<div class="ka-wrap">' +
        '<div class="ka-head"><div class="ka-head-row">' +
          '<div>' +
            '<div class="ka-eyebrow">KINETIC / account</div>' +
            '<h1 class="ka-hello">Hello, <em data-first>' + esc(String(user.name || '').split(' ')[0]) + '</em></h1>' +
          '</div>' +
          '<div class="ka-who">Signed in as <b>' + esc(user.email) + '</b><br><span data-session-note></span></div>' +
          '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost ka-head-out" data-act="logout">Sign out</button>' +
        '</div></div>' +
        '<div class="ka-layout">' +
          '<nav class="ka-nav" id="kaNav" aria-label="Account sections">' + navHTML(counts) + '</nav>' +
          '<div class="ka-body" id="kaAcctBody"></div>' +
        '</div>' +
      '</div>';
  }

  function statTile(label, value, gold) {
    return '<div class="ka-stat' + (gold ? ' is-gold' : '') + '"><span class="ka-stat-k">' + esc(label) + '</span><span class="ka-stat-v">' + esc(value) + '</span></div>';
  }
  function productTile(p, engine, opts) {
    opts = opts || {};
    return '<article class="ka-prod">' +
      '<div class="ka-prod-img"><img src="' + esc(p.img || '') + '" alt="Illustrative product photo for ' + esc(p.name) + '" loading="lazy" decoding="async" width="1100" height="733"></div>' +
      '<div class="ka-prod-body">' +
        '<div class="ka-prod-meta">' + esc(p.cat || 'KINETIC') + '</div>' +
        '<div class="ka-prod-name">' + esc(p.name) + '</div>' +
        '<div class="ka-prod-price">' + money0(p.price) + (p.old ? ' <span class="ka-prod-meta" style="text-decoration:line-through">' + money0(p.old) + '</span>' : '') + '</div>' +
        '<button type="button" class="ka-btn ka-btn-sm" data-act="' + esc(opts.act || 'view') + '" data-id="' + esc(p.id) + '">' + esc(opts.label || 'View product') + '</button>' +
        (opts.extra || '') +
      '</div>' +
    '</article>';
  }
  function ordersListHTML(orders) {
    if (!orders.length) {
      return '<div class="ka-empty"><div class="ka-empty-mark">No orders<br>yet</div>' +
        '<p>When you place an order it lands here with its status, payment state and receipt.</p>' +
        '<button type="button" class="ka-btn" data-act="shop">Shop the collection</button></div>';
    }
    return '<div class="ka-orders">' + orders.map(function (o) {
      var items = Array.isArray(o.items) ? o.items : [];
      var qty = items.reduce(function (n, i) { return n + (Number(i.qty) || 0); }, 0);
      var thumbs = items.slice(0, 4).map(function (i) {
        return i.img ? '<span><img src="' + esc(i.img) + '" alt="" loading="lazy" decoding="async" width="1100" height="733"></span>' : '<em>◆</em>';
      }).join('');
      return '<article class="ka-order" data-order="' + esc(o.number) + '">' +
        '<div class="ka-order-top">' +
          '<div><div class="ka-order-no">' + esc(o.number) + '</div><div class="ka-order-date">' + esc(dateLong(o.placedAt)) + '</div></div>' +
          '<div class="pills"><span class="pill ' + pillClass(paymentLabel(o)) + '">' + esc(paymentLabel(o)) + '</span>' +
          '<span class="pill ' + pillClass(orderStatusLabel(o)) + '">' + esc(orderStatusLabel(o)) + '</span></div>' +
        '</div>' +
        '<div class="ka-order-mid">' +
          '<div class="ka-order-thumbs">' + thumbs + (items.length > 4 ? '<em>+' + (items.length - 4) + '</em>' : '') + '</div>' +
          '<div class="ka-order-sum"><b>' + money(o.totalCents) + '</b><i>' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' · ' + qty + ' pair' + (qty === 1 ? '' : 's') + '</i></div>' +
        '</div>' +
        '<div class="ka-order-foot">' +
          '<button type="button" class="ka-btn ka-btn-sm" data-act="order" data-number="' + esc(o.number) + '">Order details</button>' +
          '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="again" data-number="' + esc(o.number) + '">Buy again</button>' +
        '</div>' +
      '</article>';
    }).join('') + '</div>';
  }

  function sectionOverview() {
    var user = AUTH.user();
    var orders = AUTH.orders();
    var wish = AUTH.productsFor(AUTH.wishlist());
    var spent = orders.filter(function (o) { return /paid/i.test(String(o.paymentStatus || '')); })
      .reduce(function (n, o) { return n + (Number(o.totalCents) || 0); }, 0);
    var addr = AUTH.defaultAddress();
    var latest = orders[0];
    var html = '' +
      '<div class="ka-card">' +
        '<div class="ka-stats">' +
          statTile('Orders', String(orders.length), true) +
          statTile('Spent', money(spent).replace('.00', ''), false) +
          statTile('Wishlist', String(wish.length), false) +
          statTile('Member since', dateShort(user.createdAt).split(',')[0] || '—', false) +
        '</div>' +
      '</div>' +
      (latest ? '<div class="ka-card">' +
        '<div class="ka-card-h"><div><div class="ka-card-t">Latest order</div>' +
        '<div class="ka-card-s">' + esc(latest.number) + ' · ' + esc(dateShort(latest.placedAt)) + '</div></div>' +
        '<span class="pill ' + pillClass(orderStatusLabel(latest)) + '">' + esc(orderStatusLabel(latest)) + '</span></div>' +
        ordersListHTML([latest]) +
      '</div>' : '') +
      '<div class="ka-card">' +
        '<div class="ka-card-h"><div><div class="ka-card-t">Your details</div>' +
        '<div class="ka-card-s">' + (profileSubline ? profileSubline() : whereSaved()) + '</div></div>' +
        '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="section" data-section="#account/profile">Edit profile</button></div>' +
        '<div class="ka-rows">' +
          '<div class="ka-row"><span class="ka-row-k">Name</span><span class="ka-row-v">' + esc(user.name) + '</span></div>' +
          '<div class="ka-row"><span class="ka-row-k">Email</span><span class="ka-row-v">' + esc(user.email) + '</span></div>' +
          '<div class="ka-row"><span class="ka-row-k">Phone</span><span class="ka-row-v' + (user.phone ? '' : ' is-empty') + '">' + esc(user.phone || 'Not added yet') + '</span></div>' +
          '<div class="ka-row"><span class="ka-row-k">Default address</span><span class="ka-row-v' + (addr ? '' : ' is-empty') + '">' +
            (addr ? esc(addr.line1 + (addr.city ? ', ' + addr.city : '') + (addr.country ? ', ' + addr.country : '')) : 'No address saved') + '</span></div>' +
        '</div>' +
      '</div>' +
      (wish.length ? '<div class="ka-card">' +
        '<div class="ka-card-h"><div><div class="ka-card-t">Saved for later</div>' +
        '<div class="ka-card-s">' + wish.length + ' pair' + (wish.length === 1 ? '' : 's') + ' in your wishlist</div></div>' +
        '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="section" data-section="#account/wishlist">Open wishlist</button></div>' +
        '<div class="ka-grid2">' + wish.slice(0, 3).map(function (p) { return productTile(p); }).join('') + '</div>' +
      '</div>' : '');
    return html;
  }

  function sectionProfile() {
    var user = AUTH.user();
    return '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Profile</div>' +
      '<div class="ka-card-s">Name, email and phone used on your orders</div></div></div>' +
      '<div class="ka-msg" role="status" aria-live="polite"></div>' +
      '<form class="ka-form" id="kaProfile" novalidate>' +
        field({ id: 'name', label: 'Full name', autocomplete: 'name', required: true, maxlength: 80, value: user.name }) +
        field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', required: true, inputmode: 'email', maxlength: 160, value: user.email }) +
        field({ id: 'phone', label: 'Phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 24, value: user.phone || '', placeholder: '+966 50 000 0000', hint: 'Used for delivery updates only.' }) +
        '<div class="ka-field" data-email-pass hidden>' +
          '<label class="ka-lbl" for="currentPassword">Confirm password to change email<span class="ka-req" aria-hidden="true">*</span></label>' +
          '<input class="ka-in" id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" aria-describedby="currentPasswordErr" aria-invalid="false">' +
          '<div class="ka-err" id="currentPasswordErr" data-err="currentPassword" role="alert"></div>' +
          '<div class="ka-hint">Changing the sign-in address is sensitive, so we ask for your password.</div>' +
        '</div>' +
        '<div class="ka-actions-row"><button type="submit" class="ka-btn ka-btn-sm"><span class="ka-spin" aria-hidden="true"></span><span>Save changes</span></button>' +
        '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="section" data-section="#account/security">Change password</button></div>' +
      '</form>' +
    '</div>';
  }

  function sectionAddresses() {
    var list = AUTH.addresses();
    var cards = list.map(function (a) {
      return '<div class="ka-addr' + (a.isDefault ? ' is-default' : '') + '" data-addr="' + esc(a.id) + '">' +
        '<div class="ka-addr-top"><span class="ka-addr-l">' + esc(a.label || 'Address') + '</span>' +
        (a.isDefault ? '<span class="pill pill-paid">Default</span>' : '') + '</div>' +
        '<div class="ka-addr-n">' + esc(a.name) + '</div>' +
        '<p>' + esc(a.line1) + (a.line2 ? '<br>' + esc(a.line2) : '') + '<br>' + esc([a.city, a.postal, a.country].filter(Boolean).join(', ')) + (a.phone ? '<br>' + esc(a.phone) : '') + '</p>' +
        '<div class="ka-addr-btns">' +
          '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="edit-addr" data-id="' + esc(a.id) + '">Edit</button>' +
          (a.isDefault ? '' : '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="default-addr" data-id="' + esc(a.id) + '">Make default</button>') +
          '<button type="button" class="ka-btn ka-btn-sm ka-btn-dark" data-act="remove-addr" data-id="' + esc(a.id) + '">Remove</button>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Saved addresses</div>' +
      '<div class="ka-card-s">The default one is offered first at checkout</div></div>' +
      '<button type="button" class="ka-btn ka-btn-sm" data-act="new-addr">Add address</button></div>' +
      '<div class="ka-msg" role="status" aria-live="polite"></div>' +
      '<div data-addr-form hidden></div>' +
      (list.length ? '<div class="ka-addrs">' + cards + '</div>'
        : '<div class="ka-empty"><div class="ka-empty-mark">No address<br>saved</div><p>Save an address and checkout fills itself in next time.</p><button type="button" class="ka-btn" data-act="new-addr">Add your first address</button></div>') +
    '</div>';
  }

  function addressFormHTML(addr) {
    var a = addr || {};
    return '<form class="ka-addr-form ka-form" id="kaAddress" novalidate data-id="' + esc(a.id || '') + '">' +
      '<div class="ka-2">' +
        field({ id: 'label', label: 'Label', value: a.label || '', placeholder: 'Home / Office', maxlength: 30 }) +
        field({ id: 'name', label: 'Recipient', value: a.name || '', maxlength: 80, required: true }) +
      '</div>' +
      field({ id: 'line1', label: 'Street address', value: a.line1 || '', maxlength: 120, required: true, autocomplete: 'address-line1' }) +
      field({ id: 'line2', label: 'Apartment, suite (optional)', value: a.line2 || '', maxlength: 120, autocomplete: 'address-line2' }) +
      '<div class="ka-2">' +
        field({ id: 'city', label: 'City', value: a.city || '', maxlength: 60, required: true, autocomplete: 'address-level2' }) +
        field({ id: 'postal', label: 'Postal code', value: a.postal || '', maxlength: 24, autocomplete: 'postal-code' }) +
      '</div>' +
      '<div class="ka-2">' +
        field({ id: 'country', label: 'Country', value: a.country || '', maxlength: 60, required: true, autocomplete: 'country-name' }) +
        field({ id: 'phone', label: 'Phone', type: 'tel', value: a.phone || '', maxlength: 24, inputmode: 'tel', autocomplete: 'tel' }) +
      '</div>' +
      '<label class="ka-check"><input type="checkbox" id="isDefault"' + (a.isDefault ? ' checked' : '') + '><span>Use as my default delivery address</span></label>' +
      '<div class="ka-actions-row"><button type="submit" class="ka-btn ka-btn-sm"><span class="ka-spin" aria-hidden="true"></span><span>' + (addr ? 'Update address' : 'Save address') + '</span></button>' +
      '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="cancel-addr">Cancel</button></div>' +
    '</form>';
  }

  function sectionOrders() {
    var orders = AUTH.orders();
    return '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Order history</div>' +
      '<div class="ka-card-s">' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + ' on this account</div></div></div>' +
      ordersListHTML(orders) +
    '</div>';
  }

  function orderDetailHTML(order) {
    var items = Array.isArray(order.items) ? order.items : [];
    var timeline = Array.isArray(order.timeline) ? order.timeline.slice().reverse() : [];
    var customer = order.customer || {};
    return '<div class="ka-card">' +
      '<div class="ka-card-h"><div>' +
        '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="section" data-section="#account/orders">← All orders</button>' +
        '<div class="ka-card-t" style="margin-top:14px">' + esc(order.number) + '</div>' +
        '<div class="ka-card-s">Placed ' + esc(dateLong(order.placedAt)) + '</div>' +
      '</div>' +
      '<div class="pills"><span class="pill ' + pillClass(paymentLabel(order)) + '">' + esc(paymentLabel(order)) + '</span>' +
      '<span class="pill ' + pillClass(orderStatusLabel(order)) + '">' + esc(orderStatusLabel(order)) + '</span></div></div>' +

      '<div class="ka-lines">' + items.map(function (i) {
        return '<div class="ka-line">' +
          '<span class="ka-line-img">' + (i.img ? '<img src="' + esc(i.img) + '" alt="Illustrative product photo for ' + esc(i.name) + '" loading="lazy" decoding="async" width="1100" height="733">' : '') + '</span>' +
          '<div><div class="ka-line-name">' + esc(i.name) + '</div>' +
          '<div class="ka-line-meta">' + esc([i.cat, i.colorName ? 'Colour ' + i.colorName : '', i.size ? 'US ' + i.size : ''].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="ka-line-meta">' + money(i.unitCents) + ' each</div></div>' +
          '<div><div class="ka-line-price">' + money(i.lineCents) + '</div><div class="ka-line-qty">Qty ' + esc(i.qty) + '</div></div>' +
        '</div>';
      }).join('') + '</div>' +

      '<div class="ka-totals">' +
        '<div class="ka-total-row"><span>Subtotal</span><span>' + money(order.subtotalCents) + '</span></div>' +
        (order.discountCents ? '<div class="ka-total-row"><span>Discount' + (order.promo ? ' (' + esc(order.promo) + ')' : '') + '</span><span>−' + money(order.discountCents) + '</span></div>' : '') +
        '<div class="ka-total-row"><span>Shipping · ' + esc((order.shipping && order.shipping.label) || 'Standard') + '</span><span>' + (order.shippingCents ? money(order.shippingCents) : 'Free') + '</span></div>' +
        '<div class="ka-total-row is-grand"><span>Total</span><span>' + money(order.totalCents) + '</span></div>' +
      '</div>' +
    '</div>' +

    '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Delivery</div>' +
      '<div class="ka-card-s">' + esc((order.shipping && order.shipping.eta) || 'Standard delivery') + ' · ' + esc((order.paymentLabel) || 'Card') + '</div></div>' +
      '<div class="ka-actions-row"><button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="again" data-number="' + esc(order.number) + '">Buy again</button></div></div>' +
      '<div class="ka-rows">' +
        '<div class="ka-row"><span class="ka-row-k">Recipient</span><span class="ka-row-v">' + esc(customer.name || '—') + '</span></div>' +
        '<div class="ka-row"><span class="ka-row-k">Address</span><span class="ka-row-v">' + esc([customer.address, customer.city, customer.country].filter(Boolean).join(', ') || '—') + '</span></div>' +
        '<div class="ka-row"><span class="ka-row-k">Phone</span><span class="ka-row-v">' + esc(customer.phone || '—') + '</span></div>' +
        '<div class="ka-row"><span class="ka-row-k">Email</span><span class="ka-row-v">' + esc(customer.email || '—') + '</span></div>' +
      '</div>' +
    '</div>' +

    (timeline.length ? '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Status history</div>' +
      '<div class="ka-card-s">Every change to this order, newest first</div></div></div>' +
      '<div class="ka-timeline">' + timeline.map(function (t, i) {
        return '<div class="ka-tl' + (i === 0 ? ' is-done' : '') + '"><span class="ka-tl-dot" aria-hidden="true"></span>' +
          '<div><div class="ka-tl-t">' + esc(t.label || 'Update') + '</div><div class="ka-tl-w">' + esc(dateLong(t.at)) + '</div></div></div>';
      }).join('') + '</div>' +
    '</div>' : '') +

    '<div class="ka-card"><div class="ka-actions-row">' +
      '<button type="button" class="ka-btn ka-btn-sm" data-act="print">Print / save receipt</button>' +
      '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="shop">Continue shopping</button>' +
    '</div></div>';
  }

  function sectionWishlist() {
    var items = AUTH.productsFor(AUTH.wishlist());
    return '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Wishlist</div>' +
      '<div class="ka-card-s">' + items.length + ' saved pair' + (items.length === 1 ? '' : 's') + '</div></div></div>' +
      (items.length
        ? '<div class="ka-grid2">' + items.map(function (p) {
            return productTile(p, null, {
              act: 'quickview', label: 'Choose size',
              extra: '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="unwish" data-id="' + esc(p.id) + '">Remove</button>'
            });
          }).join('') + '</div>'
        : '<div class="ka-empty"><div class="ka-empty-mark">Nothing<br>saved</div><p>Tap the heart on any pair and it waits for you here.</p><button type="button" class="ka-btn" data-act="shop">Browse the collection</button></div>') +
    '</div>';
  }

  function sectionRecent() {
    var items = AUTH.productsFor(AUTH.recentlyViewed());
    return '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Recently viewed</div>' +
      '<div class="ka-card-s">The last ' + items.length + ' pair' + (items.length === 1 ? '' : 's') + ' you opened</div></div></div>' +
      (items.length
        ? '<div class="ka-grid2">' + items.map(function (p) { return productTile(p, null, { act: 'quickview', label: 'Open product' }); }).join('') + '</div>'
        : '<div class="ka-empty"><div class="ka-empty-mark">No history</div><p>Open a product and it will show up here for a quick return.</p><button type="button" class="ka-btn" data-act="shop">Browse the collection</button></div>') +
    '</div>';
  }

  function sectionSecurity() {
    var s = AUTH.session();
    return '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Change password</div>' +
      '<div class="ka-card-s">Other devices are signed out when you change it</div></div></div>' +
      '<div class="ka-msg" role="status" aria-live="polite"></div>' +
      '<form class="ka-form" id="kaSecurity" novalidate>' +
        passwordField({ id: 'current', label: 'Current password', autocomplete: 'current-password', errorKey: 'current' }) +
        passwordField({ id: 'password', label: 'New password', autocomplete: 'new-password', maxlength: 128 }) +
        strengthBlock('password') +
        passwordField({ id: 'confirm', label: 'Confirm new password', autocomplete: 'new-password', maxlength: 128 }) +
        '<div class="ka-actions-row"><button type="submit" class="ka-btn ka-btn-sm"><span class="ka-spin" aria-hidden="true"></span><span>Update password</span></button></div>' +
      '</form>' +
    '</div>' +
    '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Session</div>' +
      '<div class="ka-card-s">How this device stays signed in</div></div></div>' +
      '<div class="ka-rows">' +
        '<div class="ka-row"><span class="ka-row-k">Signed in</span><span class="ka-row-v">' + esc(s ? dateLong(s.createdAt) : '—') + '</span></div>' +
        '<div class="ka-row"><span class="ka-row-k">Expires</span><span class="ka-row-v">' + esc(s ? dateLong(s.expiresAt) : '—') + '</span></div>' +
        '<div class="ka-row"><span class="ka-row-k">' + (sessionsSubline ? sessionsSubline() : 'Remembered in this browser') + '</span><span class="ka-row-v">' + (s && s.remember ? 'Yes — 30 days' : 'No — until the tab closes') + '</span></div>' +
        '<div class="ka-row"><span class="ka-row-k">Known devices</span><span class="ka-row-v">' + (s ? s.devices : 0) + '</span></div>' +
      '</div>' +
      '<div class="ka-actions-row">' +
        '<button type="button" class="ka-btn ka-btn-sm ka-btn-ghost" data-act="signout-others">Sign out other devices</button>' +
        '<button type="button" class="ka-btn ka-btn-sm ka-btn-dark" data-act="logout">Sign out on this device</button>' +
      '</div>' +
      '<div class="ka-note">Passwords are stored as a PBKDF2-SHA256 verifier with a per-account salt — the password itself is never written to disk, logged or emailed.</div>' +
    '</div>' +
    '<div class="ka-card">' +
      '<div class="ka-card-h"><div><div class="ka-card-t">Danger zone</div>' +
      '<div class="ka-card-s">Erase this account from this device</div></div></div>' +
      '<div class="ka-note">' + (liveApi()
        ? 'Deleting removes your account, its saved addresses, wishlist and every signed-in session from the KINETIC store. Orders already placed stay in the shop records for accounting.'
        : 'Deleting removes the account, its saved addresses and its session from this browser. Orders already placed stay in the shop records.') + '</div>' +
      '<div class="ka-actions-row"><button type="button" class="ka-btn ka-btn-sm ka-btn-dark" data-act="delete-account">Delete my account</button></div>' +
    '</div>';
  }

  var SECTIONS = {
    overview: { title: 'Overview', render: sectionOverview },
    profile: { title: 'Profile', render: sectionProfile },
    addresses: { title: 'Addresses', render: sectionAddresses },
    orders: { title: 'Orders', render: sectionOrders },
    wishlist: { title: 'Wishlist', render: sectionWishlist },
    recent: { title: 'Recently viewed', render: sectionRecent },
    security: { title: 'Security', render: sectionSecurity }
  };

  function counts() {
    return {
      orders: AUTH.orders().length,
      wishlist: AUTH.wishlist().length,
      addresses: AUTH.addresses().length,
      recent: AUTH.recentlyViewed().length
    };
  }

  function renderSection(name, opts) {
    opts = opts || {};
    name = SECTIONS[name] ? name : 'overview';
    currentSection = name;
    var user = AUTH.user();
    if (!user) return;
    $$('#kaNav [data-nav]').forEach(function (b) {
      var on = b.getAttribute('data-nav') === NAV.filter(function (n) { return n.id === name; })[0].route;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    var bodyEl = $('#kaAcctBody', root);
    if (!bodyEl) return;
    bodyEl.innerHTML = SECTIONS[name].render();
    bodyEl.setAttribute('data-section', name);
    bindSection(bodyEl, name);
    var focusTarget = $('#kaAcctBody .ka-card-t', root);
    if (focusTarget && opts.focus !== false) focusTarget.setAttribute('tabindex', '-1');
    if (opts.scroll !== false) {
      root.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function refreshChrome() {
    var user = AUTH.user();
    if (!user) return;
    var first = $('[data-first]', root);
    if (first) first.textContent = String(user.name || '').split(' ')[0];
    var navEl2 = $('#kaNav', root);
    if (navEl2) {
      var c = counts();
      $$('[data-nav]', navEl2).forEach(function (b) {
        var route = b.getAttribute('data-nav');
        var key = null;
        NAV.forEach(function (n) { if (n.route === route) key = n.id; });
        var badge = $('.ka-nav-n', b);
        var value = c[key];
        if (value == null) return;
        if (!badge) { badge = document.createElement('span'); badge.className = 'ka-nav-n'; b.appendChild(badge); }
        badge.textContent = String(value);
      });
    }
    var note = $('[data-session-note]', root);
    if (note) {
      var s = AUTH.session();
      note.textContent = s ? 'Session valid until ' + dateShort(s.expiresAt) : '';
    }
  }

  function bindSection(scope, name) {
    if (name === 'profile') {
      var form = $('#kaProfile', scope);
      var emailInput = $('#email', scope);
      var startEmail = AUTH.user().email;
      var passWrap = $('[data-email-pass]', scope);
      emailInput.addEventListener('input', function () {
        var changed = String(emailInput.value).trim().toLowerCase() !== String(startEmail).trim().toLowerCase();
        passWrap.hidden = !changed;
      });
      bindReveal(scope);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (busy) return;
        var payload = {
          name: $('#name', scope).value,
          email: emailInput.value,
          phone: $('#phone', scope).value,
          currentPassword: $('#currentPassword', scope) ? $('#currentPassword', scope).value : undefined
        };
        if (!validateAll(scope, {
          name: { value: $('#name', scope).value, rule: AUTH.validate.name },
          email: { value: emailInput.value, rule: AUTH.validate.email },
          phone: { value: $('#phone', scope).value, rule: function (v) { return AUTH.validate.phone(v, false); } }
        })) return;
        setBusy(scope, true);
        AUTH.updateProfile(payload).then(function (res) {
          setBusy(scope, false);
          if (!applyResult(scope, res)) return;
          refreshChrome();
          announce('Profile saved.');
          renderSection('profile', { scroll: false, focus: false });
          showBanner($('#kaAcctBody', root), 'success', 'Saved.', 'Your details are updated and will be prefilled at checkout.');
        });
      });
    }
    if (name === 'security') {
      var sform = $('#kaSecurity', scope);
      bindReveal(scope);
      sform.addEventListener('submit', function (e) {
        e.preventDefault();
        if (busy) return;
        if (!validateAll(scope, {
          current: { value: $('#current', scope).value, rule: function (v) { return v ? { ok: true } : { ok: false, error: 'Enter your current password.' }; } },
          password: { value: $('#password', scope).value, rule: AUTH.validate.password },
          confirm: { value: $('#confirm', scope).value, rule: function (v) { return String(v) === String($('#password', scope).value) ? { ok: true } : { ok: false, error: 'Those passwords do not match.' }; } }
        })) return;
        setBusy(scope, true);
        AUTH.changePassword({
          current: $('#current', scope).value,
          password: $('#password', scope).value,
          confirm: $('#confirm', scope).value
        }).then(function (res) {
          setBusy(scope, false);
          if (!applyResult(scope, res)) return;
          ['current', 'password', 'confirm'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
          var strengthWrap = $('[data-strength="password"]', scope);
          if (strengthWrap) strengthWrap.setAttribute('data-level', '0');
          refreshChrome();
          showBanner(scope, 'success', 'Password changed.', 'Your other devices were signed out.');
          announce('Password changed.');
        });
      });
    }
    if (name === 'addresses') {
      var host = $('[data-addr-form]', scope);
      var openForm = function (addr) {
        host.hidden = false;
        host.innerHTML = addressFormHTML(addr);
        var f = $('#kaAddress', host);
        var first = $('input', f);
        if (first) first.focus();
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          if (busy) return;
          var data = {};
          ['label', 'name', 'line1', 'line2', 'city', 'postal', 'country', 'phone'].forEach(function (k) {
            var el = document.getElementById(k);
            if (el) data[k] = el.value;
          });
          data.isDefault = $('#isDefault', host) ? $('#isDefault', host).checked : false;
          var addrCheck = AUTH.validate.address(data);
          if (!addrCheck.ok) {
            paintFieldError(f, addrCheck.field, addrCheck.error);
            announce(addrCheck.error);
            var bad = document.getElementById(addrCheck.field);
            if (bad) { try { bad.focus(); } catch (e) {} }
            return;
          }
          setBusy(f, true);
          var existing = f.getAttribute('data-id');
          var op = existing ? AUTH.updateAddress(existing, data) : AUTH.addAddress(data);
          op.then(function (res) {
            setBusy(f, false);
            if (!applyResult(host, res)) return;
            host.hidden = true;
            host.innerHTML = '';
            refreshChrome();
            renderSection('addresses', { scroll: false });
            showBanner($('#kaAcctBody', root), 'success', existing ? 'Address updated.' : 'Address saved.', 'Checkout will offer it automatically.');
          });
        });
      };
      scope.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-act]');
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        if (act === 'new-addr') { openForm(null); }
        else if (act === 'edit-addr') {
          var a = AUTH.addresses().filter(function (x) { return x.id === btn.getAttribute('data-id'); })[0];
          if (a) openForm(a);
        } else if (act === 'cancel-addr') { host.hidden = true; host.innerHTML = ''; }
        else if (act === 'remove-addr') {
          if (window.confirm('Remove this address?')) {
            AUTH.removeAddress(btn.getAttribute('data-id')).then(function (res) {
              if (!res.ok) return;
              refreshChrome();
              renderSection('addresses', { scroll: false });
              showBanner($('#kaAcctBody', root), 'success', 'Address removed.', '');
            });
          }
        } else if (act === 'default-addr') {
          var addr = AUTH.addresses().filter(function (x) { return x.id === btn.getAttribute('data-id'); })[0];
          if (!addr) return;
          AUTH.updateAddress(addr.id, Object.assign({}, addr, { isDefault: true })).then(function () {
            renderSection('addresses', { scroll: false });
            showBanner($('#kaAcctBody', root), 'success', 'Default updated.', 'This address now heads the list at checkout.');
          });
        }
      });
    }
    if (name === 'wishlist') {
      scope.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-act="unwish"]');
        if (!btn) return;
        try {
          if (window.KINETIC_APP && window.KINETIC_APP.wishlist && window.KINETIC_APP.wishlist.toggle) {
            window.KINETIC_APP.wishlist.toggle(Number(btn.getAttribute('data-id')));
          }
        } catch (err) {}
        renderSection('wishlist', { scroll: false });
        refreshChrome();
      });
    }
  }

  /* --------------------------------------------------------------- routing */
  function accountHashFor(section, number) {
    if (section === 'order' && number) return '#account/order/' + number;
    if (!section || section === 'overview') return '#account';
    return '#account/' + section;
  }

  function parseHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (!h) return { name: 'none' };
    if (h === 'login') return { name: 'login' };
    if (h === 'signup') return { name: 'signup' };
    if (h === 'forgot') return { name: 'forgot' };
    if (h.indexOf('reset') === 0) return { name: 'reset', code: decodeURIComponent(h.split('/')[1] || '') };
    if (h === 'account' || h.indexOf('account/') === 0) {
      var rest = h.replace(/^account\/?/, '');
      if (!rest) return { name: 'account', section: 'overview' };
      if (rest.indexOf('order/') === 0) return { name: 'account', section: 'order', number: decodeURIComponent(rest.slice(6)) };
      var key = rest.split('/')[0];
      return { name: 'account', section: SECTIONS[key] ? key : 'overview', requested: key };
    }
    return { name: 'none' };
  }

  function openAuthScreen(route) {
    ensureRoot();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ka-locked');
    var screen;
    if (route.name === 'login') screen = loginScreen(history.state && history.state.authPrefill);
    else if (route.name === 'signup') screen = signupScreen();
    else if (route.name === 'forgot') screen = forgotScreen();
    else screen = resetScreen(route.code);
    root.innerHTML = barHTML(route.name === 'signup' ? 'Create account' : (route.name === 'login' ? 'Sign in' : 'Password reset')) +
      '<div id="kaScreen">' + modeNotice() + screen.html + '</div>' +
      '<span class="ka-sr" id="kaLive" role="status" aria-live="polite"></span>';
    var scope = $('#kaScreen', root);
    live = $('#kaLive', root);
    screen.mount(scope);
    bindShellControls();
    focusFirst();
  }

  /* When the page is served without an account API (a plain static host), the
     account screens say so instead of quietly behaving like a backend. */
  function modeNotice() {
    if (window.KINETIC_API_MODE !== 'standalone') return '';
    return '<div class="ka-note" role="note" data-mode-note><b>Standalone build:</b> this copy of the storefront has no account server attached, ' +
      'so sign-in, orders and saved addresses stay in this browser only. Point <b>&lt;meta name="kinetic-api"&gt;</b> at the KINETIC API to switch the whole shop to real accounts.</div>';
  }
  function barHTML(label) {
    return '<div class="ka-bar"><div class="ka-bar-in">' +
      '<div style="display:flex;align-items:center;gap:14px;min-width:0">' +
        '<span class="ka-logo">KINETIC<span>®</span></span>' +
        '<span class="ka-bar-meta">' + esc(label || 'Account') + '</span>' +
      '</div>' +
      '<button type="button" class="ka-x" data-ka-close aria-label="Close and return to the shop">✕ Back to shop</button>' +
    '</div></div>';
  }

  function renderAccount(requestedSection, number) {
    var guard = AUTH.requireUser();
    if (!guard.ok) {
      /* the guard can re-enter (requireUser purges a dead session and emits an
         auth event, which routes again) — never let the second pass overwrite
         the destination the customer actually asked for with '#login' */
      if (!pendingNext || pendingNext.indexOf('#account') !== 0) {
        var asked = parseHash(location.hash);
        pendingNext = asked.name === 'account'
          ? accountHashFor(asked.section, asked.number)
          : accountHashFor(requestedSection, number);
      }
      if (guard.reason === 'expired') {
        history.replaceState({ ka: true, authPrefill: { next: pendingNext, message: 'Session expired.', messageKind: 'error', messageText: 'Sign in again to pick up where you left off.' } }, '', '#login');
        route();
        return;
      }
      history.replaceState({ ka: true, authPrefill: { next: pendingNext } }, '', '#login');
      route();
      return;
    }
    ensureRoot();
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ka-locked');
    var user = AUTH.user();
    if (!root.querySelector('#kaNav')) {
      root.innerHTML = barHTML('Account') + modeNotice() + shellHTML(user, counts()) + '<span class="ka-sr" id="kaLive" role="status" aria-live="polite"></span>';
      live = $('#kaLive', root);
      bindShellControls();
    } else {
      refreshChrome();
    }
    if (requestedSection === 'order') {
      var order = AUTH.order(number);
      var bodyEl = $('#kaAcctBody', root);
      currentSection = 'orders';
      $$('#kaNav [data-nav]').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-nav') === '#account/orders'); });
      if (!order) {
        bodyEl.innerHTML = '<div class="ka-card"><div class="ka-empty"><div class="ka-empty-mark">Order<br>missing</div>' +
          '<p>We could not find <b>' + esc(number) + '</b> on this account.' + (liveApi() ? '' : ' Orders live in the browser they were placed from.') + '</p>' +
          '<button type="button" class="ka-btn" data-act="section" data-section="#account/orders">Back to order history</button></div></div>';
      } else {
        bodyEl.innerHTML = orderDetailHTML(order);
      }
      bodyEl.setAttribute('data-section', 'order');
      root.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    renderSection(requestedSection === 'orders' ? 'orders' : requestedSection);
  }

  function close(opts) {
    opts = opts || {};
    if (!root || !root.classList.contains('open')) return;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ka-locked');
    if (opts.toHash === false) return;
    if (history.state && history.state.ka) {
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function route() {
    var parsed = parseHash(location.hash);
    if (parsed.name === 'none') {
      if (root && root.classList.contains('open')) close({ toHash: false });
      return false;
    }
    if (parsed.name === 'account') renderAccount(parsed.section, parsed.number);
    else openAuthScreen(parsed);
    return true;
  }

  function go(hash, opts) {
    opts = opts || {};
    var next = hash.charAt(0) === '#' ? hash : '#' + hash;
    var state = { ka: true };
    if (opts.state) state.authPrefill = opts.state;
    if (opts.replace || opts.state) history.replaceState(state, '', next);
    else history.pushState(state, '', next);
    route();
  }

  function focusFirst() {
    var target = $('#kaScreen .ka-h1', root);
    if (target) { target.setAttribute('tabindex', '-1'); target.focus(); }
  }

  function handleAction(btn) {
    var act = btn.getAttribute('data-act');
    var user = AUTH.user();
    if (act === 'shop') { go('#collection'); close({ toHash: false }); return; }
    if (act === 'section') { go(btn.getAttribute('data-section') || '#account'); return; }
    if (act === 'order') { go('#account/order/' + encodeURIComponent(btn.getAttribute('data-number'))); return; }
    if (act === 'quickview') {
      var pid = Number(btn.getAttribute('data-id'));
      close({ toHash: false });
      history.replaceState(null, '', location.pathname + location.search);
      window.setTimeout(function () {
        if (window.KINETIC_APP && window.KINETIC_APP.openQuickView) window.KINETIC_APP.openQuickView(pid);
      }, 120);
      return;
    }
    if (act === 'again') {
      var order = AUTH.order(btn.getAttribute('data-number'));
      if (!order) return;
      var added = 0, blocked = [];
      (order.items || []).forEach(function (item) {
        var res = null;
        try {
          /* KINETIC_APP.addItem takes a selection object and answers honestly */
          if (window.KINETIC_APP && window.KINETIC_APP.addItem) {
            res = window.KINETIC_APP.addItem({ id: item.id, size: item.size, color: item.color, qty: Number(item.qty) || 1 });
          }
        } catch (e) { res = { ok: false, message: 'That pair could not be re-added.' }; }
        if (res && res.ok) added++;
        else blocked.push((item.name || 'Item') + (item.size ? ' · US ' + item.size : '') + ' — ' + ((res && res.message) || 'no longer available'));
      });
      if (added) {
        if (window.KINETIC_APP.toast) window.KINETIC_APP.toast('Added again', added + ' line' + (added === 1 ? '' : 's') + ' from ' + order.number + ' ' + (added === 1 ? 'is' : 'are') + ' back in your bag.', 'bg-ink text-flame');
        announce('Items added to your bag.');
        go('#checkout');
      } else {
        announce('Those pairs are not available any more.');
        showBanner($('#kaAcctBody', root), 'error', 'Not available.', blocked.join(' · ') || 'That order can no longer be reordered.');
      }
      return;
    }
    if (act === 'print') { window.print(); return; }
    if (act === 'logout') { doLogout(); return; }
    if (act === 'signout-others') {
      if (!window.confirm('Sign out every other device that is using this account?')) return;
      var res = AUTH.signOutOthers ? AUTH.signOutOthers() : null;
      Promise.resolve(res).then(function () {
        refreshChrome();
        renderSection('security', { scroll: false });
        showBanner($('#kaAcctBody', root), 'success', 'Other devices signed out.', 'This device stays signed in.');
      });
      return;
    }
    if (act === 'delete-account') {
      if (!window.confirm('Delete this account and its saved details from this device? Orders already placed are kept.')) return;
      var typed = window.prompt('Type your password to confirm deletion:');
      if (typed == null) return;
      AUTH.deleteAccount({ password: typed }).then(function (res) {
        if (!res || !res.ok) {
          announce(res && res.error ? res.error : 'Could not delete the account.');
          showBanner($('#kaAcctBody', root), 'error', 'Not deleted.', (res && res.error) || '');
          return;
        }
        go('#signup', { replace: true });
      });
      return;
    }
  }

  function doLogout() {
    var cartBefore = null;
    try { cartBefore = localStorage.getItem('kinetic-cart-v1'); } catch (e) {}
    AUTH.logout({ reason: 'logout' }).then(function () {
      /* the bag is guest data — it is never touched by sign-out */
      try {
        if (cartBefore != null && localStorage.getItem('kinetic-cart-v1') == null) localStorage.setItem('kinetic-cart-v1', cartBefore);
      } catch (e) {}
      close({ toHash: false });
      history.replaceState({ ka: true }, '', '#login');
      route();
      var scope = $('#kaScreen', root);
      if (scope) showBanner(scope, 'success', 'Signed out.', 'Your bag is still exactly where you left it.');
    });
  }

  function bindShellControls() {
    var closeBtn = $('[data-ka-close]', root);
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', function () { close(); });
    }
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', function (e) {
        var g = e.target.closest && e.target.closest('[data-go]');
        if (g) { go(g.getAttribute('data-go')); return; }
        var nav = e.target.closest && e.target.closest('[data-nav]');
        if (nav) { go(nav.getAttribute('data-nav')); return; }
        var act = e.target.closest && e.target.closest('[data-act]');
        if (act) { handleAction(act); return; }
      });
      root.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
          return;
        }
        if (e.key !== 'Tab') return;
        var focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
          .filter(function (el) { return el.offsetParent !== null; });
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }
  }

  function ensureRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'authView';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'KINETIC account');
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
    return root;
  }

  function boot() {
    ensureRoot();
    var lastId = AUTH.user() && AUTH.user().id;
    AUTH.on('kinetic:auth', function (detail) {
      var id = AUTH.user() && AUTH.user().id;
      var flipped = id !== lastId;
      lastId = id;
      if (!flipped) return;                 /* profile/address edits refresh themselves */
      var parsed = parseHash(location.hash);
      if (parsed.name !== 'account') {
        /* a session that resolved after the page loaded (cookie sign-in on a
           refresh, or a second tab) lands back where the customer was going */
        if (AUTH.user() && parsed.name !== 'none' && pendingNext && pendingNext.indexOf('#account') === 0) {
          history.replaceState({ ka: true }, '', pendingNext);
          route();
        }
        return;
      }
      /* signed out while inside the account area (another tab, expiry) */
      if (!AUTH.user()) {
        var wanted = parseHash(location.hash);
        renderAccount(wanted.name === 'account' ? wanted.section : 'overview', wanted.number);
        return;
      }
      if (root.classList.contains('open')) refreshChrome();
      renderSection(currentSection);
    });
    /* order history is served by the API — when the sync lands, paint it */
    AUTH.on('kinetic:orders-synced', function () {
      if (!root || !root.classList.contains('open')) return;
      if (currentSection !== 'orders' && currentSection !== 'order') return;
      refreshChrome();
      renderSection(currentSection, { scroll: false });
    });
    AUTH.on('kinetic:auth-expired', function (detail) {
      var parsed = parseHash(location.hash);
      if (parsed.name !== 'account') return;
      pendingNext = accountHashFor(parsed.section, parsed.number);
      history.replaceState({
        ka: true,
        authPrefill: { next: pendingNext, message: 'Session expired.', messageKind: 'error', messageText: (detail && detail.message) || 'Sign in again to pick up where you left off.' }
      }, '', '#login');
      route();
    });
    window.addEventListener('popstate', function () { route(); });
    window.addEventListener('hashchange', function () { route(); });
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KINETIC_ACCOUNT = {
    version: '1.0',
    open: function (hash) { go(hash || (AUTH.user() ? '#account' : '#login')); },
    close: close,
    route: route,
    refresh: function () { refreshChrome(); renderSection(currentSection, { scroll: false }); },
    section: function () { return currentSection; },
    _internal: { parseHash: parseHash, root: function () { return root; } }
  };
})();
