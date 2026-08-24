/* ==========================================================================
   CareerTech house style - shared behaviour
   --------------------------------------------------------------------------
   Load it in <head>, without defer:

     <script src="/brand/ct.js"></script>

   It has to run before the page is painted, so that someone who chose dark
   mode last time does not get a flash of white first.

   Any button carrying data-ct-theme-toggle becomes a light/dark switch. Put
   the sun and moon icons inside it; ct.css decides which one shows.
   ========================================================================== */

(function () {
  'use strict';

  var KEY = 'ct-theme';
  var root = document.documentElement;

  // Pages default to light. Only a saved choice turns dark on - the device
  // setting is deliberately ignored, so a tool looks the same for everyone
  // unless they ask for something else.
  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) {
      return null;                       // private browsing, storage blocked
    }
  }

  function current() {
    return root.getAttribute('data-ct-theme') === 'dark' ? 'dark' : 'light';
  }

  function apply(theme) {
    root.setAttribute('data-ct-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    label();
  }

  // The icon swap is pure CSS; only the description needs updating here.
  function label() {
    var next = current() === 'dark' ? 'light' : 'dark';
    var buttons = document.querySelectorAll('[data-ct-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-label', 'Switch to ' + next + ' mode');
      buttons[i].setAttribute('title', 'Switch to ' + next + ' mode');
    }
  }

  // --- runs immediately, before first paint ---
  var choice = saved();
  if (choice) root.setAttribute('data-ct-theme', choice);

  // --- the rest waits for the page ---
  function wire() {
    var buttons = document.querySelectorAll('[data-ct-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        apply(current() === 'dark' ? 'light' : 'dark');
      });
    }
    label();
  }

  /* ------------------------------------------------------------------------
     Toast, and copy-to-clipboard.

     Any button with data-ct-copy="#some-id" copies that element's contents
     and says so. Saves every builder writing the same thing again.
     ------------------------------------------------------------------------ */

  var toastTimer;

  function toast(message) {
    var el = document.querySelector('.ct-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ct-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = message;
    // Restart the animation rather than letting a second click cut it short.
    clearTimeout(toastTimer);
    el.classList.add('is-visible');
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 2600);
  }

  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); },
                                              function () { done(fallback(text)); });
    } else {
      done(fallback(text));           // http:// and file:// have no clipboard API
    }
  }

  function fallback(text) {
    var box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(box);
    box.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(box);
    return ok;
  }

  function wireCopy() {
    var buttons = document.querySelectorAll('[data-ct-copy]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var target = document.querySelector(this.getAttribute('data-ct-copy'));
        if (!target) return;
        var text = 'value' in target ? target.value : target.textContent;
        var label = this.getAttribute('data-ct-copy-label') || 'Code copied';
        copyText(text, function (ok) {
          toast(ok ? label : 'Could not copy - select the code and copy it by hand');
        });
      });
    }
  }

  /* ------------------------------------------------------------------------
     Modals. data-ct-modal-open="#id" opens one, data-ct-modal-close shuts it.
     Clicking the backdrop or pressing Escape also closes it, and focus goes
     back to whatever opened it.
     ------------------------------------------------------------------------ */

  var lastFocused = null;

  function openModal(box) {
    lastFocused = document.activeElement;
    box.classList.add('is-open');
    var focusable = box.querySelector('[data-ct-modal-close], button, a[href], input, select, textarea');
    if (focusable) focusable.focus();
  }

  function closeModal(box) {
    box.classList.remove('is-open');
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function wireModals() {
    var openers = document.querySelectorAll('[data-ct-modal-open]');
    for (var i = 0; i < openers.length; i++) {
      openers[i].addEventListener('click', function () {
        var box = document.querySelector(this.getAttribute('data-ct-modal-open'));
        if (box) openModal(box);
      });
    }

    var modals = document.querySelectorAll('.ct-modal');
    for (var j = 0; j < modals.length; j++) {
      (function (modal) {
        modal.addEventListener('click', function (e) {
          // Only the backdrop itself, not a click that landed inside the box.
          if (e.target === modal) closeModal(modal);
        });
        var closers = modal.querySelectorAll('[data-ct-modal-close]');
        for (var k = 0; k < closers.length; k++) {
          closers[k].addEventListener('click', function () { closeModal(modal); });
        }
      })(modals[j]);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = document.querySelector('.ct-modal.is-open');
      if (open) closeModal(open);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(); wireCopy(); wireModals(); });
  } else {
    wire();
    wireCopy();
    wireModals();
  }

  // Let a tool raise its own message without duplicating the toast code.
  window.ctToast = toast;
})();
