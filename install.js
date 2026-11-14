/*
 * Install hint (the same file in all of Anderson's apps, except the songbook).
 * ---------------------------------------------------------------
 * Shows one slim line at the top of the page, only on a phone and only while
 * the app is opened in the browser: "Add this app to your Home Screen  How  X".
 * Tapping How opens three short steps for the person's phone (iPhone Safari
 * or Android Chrome). On Android phones that allow it there is also a
 * one-tap Install button.
 *
 * It never shows once the app is opened from the Home Screen, disappears for
 * good after the app is installed or the cross is tapped, and is not fixed
 * over the content (it sits in the page flow, so tab bars and buttons are
 * never covered).
 *
 * Use:  <script src="install.js" data-app="App name"></script>
 *       data-shrink="#app" (optional) for apps with a fixed screen height: the
 *                          element to shorten by the strip's height
 *       data-host="#app"   (optional) put the strip at the top of this element
 *                          instead of the top of <body>
 * Add install.js to the list of files cached in sw.js and bump VERSION.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var NAME = (me && me.getAttribute('data-app')) || 'this app';
  var HOST = (me && me.getAttribute('data-host')) || '';
  var SHRINK = (me && me.getAttribute('data-shrink')) || '';
  var KEY = 'install-hint-off:' + NAME;

  function store(get, v) {
    try { return get ? localStorage.getItem(KEY) : localStorage.setItem(KEY, v); } catch (e) { return null; }
  }
  try { if (window.self !== window.top) return; } catch (e) { return; }          // previews inside other pages
  if (!/^https?:$/.test(location.protocol)) return;

  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var android = /Android/.test(ua);
  if (!ios && !android) return;                                                  // phones and tablets only

  function installed() {
    try {
      return navigator.standalone === true ||
        (window.matchMedia && (matchMedia('(display-mode: standalone)').matches ||
          matchMedia('(display-mode: fullscreen)').matches ||
          matchMedia('(display-mode: minimal-ui)').matches));
    } catch (e) { return false; }
  }
  if (installed() || store(true)) return;

  var inApp = ios && /FBAN|FBAV|Instagram|WhatsApp|Line\/|Twitter|Snapchat|MicroMessenger/.test(ua);
  var deferred = null, strip = null, scrim = null, lastFocus = null;

  var ICON = {
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'
  };
  function ic(n) { return '<span class="ih-ic">' + ICON[n] + '</span>'; }

  function addStyles() {
    if (document.getElementById('ih-style')) return;
    var s = document.createElement('style');
    s.id = 'ih-style';
    s.textContent =
      ':root{--ih-bg:#fff3d1;--ih-ink:#4f3c00;--ih-panel:#fff;--ih-text:#1d2a24;--ih-mute:#566159;--ih-line:#d7ddd8;--ih-acc:#2b6650;--ih-on:#fff;--ih-soft:#dfede5}' +
      '@media (prefers-color-scheme:dark){:root{--ih-bg:#3a2f10;--ih-ink:#f5dfa0;--ih-panel:#1b2420;--ih-text:#e8efea;--ih-mute:#a4b0a8;--ih-line:#2d3a33;--ih-acc:#7fcba8;--ih-on:#0f1a14;--ih-soft:#243a2e}}' +
      '.ih-strip{box-sizing:border-box;display:block;padding:max(8px,env(safe-area-inset-top,0px)) 12px 8px;flex:none;position:relative;z-index:5;width:100%}' +
      '.ih-in{box-sizing:border-box;display:flex;align-items:center;gap:4px;min-height:48px;padding:0 2px 0 14px;border-radius:14px;background:var(--ih-bg);color:var(--ih-ink);' +
      'font:600 13.5px/1.25 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}' +
      '.ih-strip *{box-sizing:border-box}' +
      '.ih-t{flex:1;min-width:0}' +
      '.ih-b{min-height:44px;padding:0 10px;border:0;background:none;color:inherit;font:800 13.5px/1 inherit;font-family:inherit;text-decoration:underline;text-underline-offset:3px;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.ih-go{min-height:36px;padding:0 14px;border:0;border-radius:999px;background:var(--ih-acc);color:var(--ih-on);font:800 13px/1 inherit;font-family:inherit;cursor:pointer;text-decoration:none}' +
      '.ih-x{width:44px;height:44px;border:0;background:none;color:inherit;font-size:20px;line-height:1;cursor:pointer;border-radius:50%;flex:none;-webkit-tap-highlight-color:transparent}' +
      '.ih-in button:focus-visible,.ih-sheet button:focus-visible{outline:3px solid #b95f43;outline-offset:2px}' +
      '.ih-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}' +
      '.ih-sheet{box-sizing:border-box;width:100%;max-width:480px;background:var(--ih-panel);color:var(--ih-text);border-radius:26px 26px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));' +
      'display:flex;flex-direction:column;gap:12px;font:400 15px/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;animation:ih-up .25s ease-out}' +
      '.ih-tag{align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ih-acc);background:var(--ih-soft);border-radius:999px;padding:3px 9px}' +
      '.ih-sheet h3{margin:0;font-size:19px;line-height:1.2;letter-spacing:-.01em;font-weight:800}' +
      '.ih-sheet ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;counter-reset:s}' +
      '.ih-sheet li{display:flex;gap:12px;align-items:center;counter-increment:s}' +
      '.ih-sheet li:before{content:counter(s);flex:none;width:28px;height:28px;border-radius:50%;background:var(--ih-soft);color:var(--ih-acc);display:grid;place-items:center;font-weight:800;font-size:14px}' +
      '.ih-ic{display:inline-flex;vertical-align:-5px;width:22px;height:22px;color:var(--ih-acc)}' +
      '.ih-ic svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
      '.ih-note{margin:0;font-size:12.5px;color:var(--ih-mute)}' +
      '.ih-row{display:flex;gap:8px;margin-top:2px}' +
      '.ih-row button{flex:1;min-height:48px;border-radius:14px;border:1.5px solid var(--ih-line);background:none;color:var(--ih-text);font:700 14px/1 inherit;font-family:inherit;cursor:pointer}' +
      '.ih-row .ih-p{background:var(--ih-acc);color:var(--ih-on);border-color:var(--ih-acc)}' +
      '@keyframes ih-up{from{transform:translateY(30px);opacity:0}}' +
      '@media (prefers-reduced-motion:reduce){.ih-sheet{animation:none}}';
    document.head.appendChild(s);
  }

  function remove() {
    if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
    strip = null; closeSheet(true); shrink();
  }
  function never() { store(false, '1'); remove(); }

  function build() {
    if (strip || installed()) return;
    addStyles();
    strip = document.createElement('div');
    strip.className = 'ih-strip';
    strip.setAttribute('role', 'note');
    paint();
    var host = (HOST && document.querySelector(HOST)) || document.body;
    host.insertBefore(strip, host.firstChild);
    shrink();
  }

  // Apps with a fixed screen height: make room for the strip so nothing slides off the bottom.
  function shrink() {
    var st = document.getElementById('ih-shrink');
    if (!SHRINK || !strip) { if (st && st.parentNode) st.parentNode.removeChild(st); return; }
    var h = strip.offsetHeight, el = document.querySelector(SHRINK);
    if (!el) return;
    var pos = getComputedStyle(el).position, fixed = pos === 'fixed' || pos === 'absolute';
    if (!st) { st = document.createElement('style'); st.id = 'ih-shrink'; document.head.appendChild(st); }
    st.textContent = SHRINK + '{' + (fixed ? 'top:' + h + 'px!important;' : '') + 'height:calc(100dvh - ' + h + 'px)!important;max-height:calc(100dvh - ' + h + 'px)!important}';
  }

  function paint() {
    if (!strip) return;
    var lead = ios ? 'Add this app to your Home Screen' : 'Install this app on your phone';
    var main = (android && deferred)
      ? '<button class="ih-go" type="button" data-ih="install">Install</button><button class="ih-b" type="button" data-ih="how" aria-label="Show steps">Steps</button>'
      : '<button class="ih-b" type="button" data-ih="how">How</button>';
    strip.innerHTML = '<div class="ih-in"><span class="ih-t">' + lead + '</span>' + main +
      '<button class="ih-x" type="button" data-ih="never" aria-label="Hide this for good">✕</button>';
  }

  function steps() {
    if (ios) {
      return {
        tag: 'iPhone · Safari',
        li: ['Tap ' + ic('share') + ' <b>Share</b> at the bottom of Safari',
             'Scroll down and tap ' + ic('plus') + ' <b>Add to Home Screen</b>',
             'Tap <b>Add</b>. The app icon appears on your Home Screen.'],
        note: inApp ? 'Open this page in Safari first, then follow these steps.' : 'Not seeing Share? Open this page in Safari first.'
      };
    }
    return {
      tag: 'Android · Chrome',
      li: ['Tap the ' + ic('dots') + ' <b>menu</b> at the top right of Chrome',
           'Tap <b>Install app</b> (or <b>Add to Home screen</b>)',
           'Tap <b>Install</b>. The app icon appears on your Home Screen.'],
      note: 'Your phone may also show an Install button on this page.'
    };
  }

  function openSheet() {
    if (scrim) return;
    lastFocus = document.activeElement;
    var d = steps();
    scrim = document.createElement('div');
    scrim.className = 'ih-scrim';
    scrim.innerHTML = '<div class="ih-sheet" role="dialog" aria-modal="true" aria-labelledby="ih-h"><span class="ih-tag">' + d.tag + '</span>' +
      '<h3 id="ih-h">Add ' + NAME.replace(/</g, '&lt;') + ' in 3 taps</h3><ol>' +
      d.li.map(function (x) { return '<li><span>' + x + '</span></li>'; }).join('') +
      '</ol><p class="ih-note">' + d.note + '</p><div class="ih-row"><button type="button" data-ih="later">Maybe later</button><button type="button" class="ih-p" data-ih="never">Got it, hide this</button></div></div>';
    document.body.appendChild(scrim);
    var f = scrim.querySelector('.ih-p'); if (f) f.focus();
  }
  function closeSheet(quiet) {
    if (!scrim) return;
    if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
    scrim = null;
    if (!quiet && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }

  function install() {
    if (!deferred) { openSheet(); return; }
    var e = deferred; deferred = null;
    try {
      e.prompt();
      if (e.userChoice) e.userChoice.then(function (c) { if (c && c.outcome === 'accepted') remove(); else paint(); });
    } catch (x) { paint(); openSheet(); }
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (scrim && t === scrim) { closeSheet(); return; }
    var b = t && t.closest ? t.closest('[data-ih]') : null;
    if (!b) return;
    var a = b.getAttribute('data-ih');
    if (a === 'how') openSheet();
    else if (a === 'install') install();
    else if (a === 'later') closeSheet();
    else if (a === 'never') never();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && scrim) closeSheet(); });

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; paint(); });
  window.addEventListener('appinstalled', function () { store(false, '1'); remove(); });
  try {
    var mq = matchMedia('(display-mode: standalone)');
    var on = function (m) { if (m.matches) remove(); };
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
  } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
