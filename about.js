/*
 * About + copyright (the same file in all of Anderson's apps).
 * ---------------------------------------------------------------
 * Adds AppAbout.open() and a ready-made "© 2026 Anderson Jones · About"
 * link. The panel matches The Odd Disciple's About: what the app is,
 * who designed it, the copyright line and a feedback email.
 *
 * Use:
 *   <script src="about.js" data-app="App name"
 *           data-desc="One sentence about the app."
 *           data-fine="Optional small print."
 *           data-host="#app"></script>          (data-host is optional)
 *
 * Put a link anywhere with:  AppAbout.linkHTML()   (an HTML string)
 *                       or:  AppAbout.link()       (a button element)
 * Any element with data-about-open also opens it.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var A = function (k, d) { return (me && me.getAttribute('data-' + k)) || d; };
  var NAME = A('app', document.title || 'This app');
  var DESC = A('desc', '');
  var FINE = A('fine', '');
  var HOST = A('host', '');
  var OWNER = 'Anderson Jones';
  var EMAIL = 'andy.andersonjones@gmail.com';
  var YEAR = '2026';
  var LINK_TEXT = '© ' + YEAR + ' ' + OWNER + ' · About';

  var box = null, lastFocus = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function addStyles() {
    if (document.getElementById('abt-style')) return;
    var s = document.createElement('style');
    s.id = 'abt-style';
    s.textContent =
      '.abt-link{background:none;border:0;color:inherit;opacity:.62;font:inherit;font-size:12px;line-height:1.4;padding:10px;margin:2px auto 0;display:block;' +
      'text-decoration:underline;text-underline-offset:3px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
      '.abt-link:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:6px}' +
      '.abt-wrap{inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;' +
      'padding:max(16px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) max(16px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));' +
      'background:rgba(6,8,16,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:abt-fade .2s ease-out}' +
      '.abt-card{--abt-bg:#ffffff;--abt-fg:#1b1d26;--abt-mu:#6b6f80;--abt-ln:rgba(20,24,40,.12);--abt-ac:#2f5fd0;' +
      'position:relative;width:100%;max-width:420px;max-height:100%;overflow:auto;-webkit-overflow-scrolling:touch;box-sizing:border-box;' +
      'background:var(--abt-bg);color:var(--abt-fg);border:1px solid var(--abt-ln);border-radius:22px;padding:22px 22px 18px;' +
      'box-shadow:0 24px 60px rgba(0,0,0,.35);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,"Segoe UI",Roboto,sans-serif;text-align:left;animation:abt-rise .25s cubic-bezier(.2,.9,.25,1)}' +
      '.abt-card.dark{--abt-bg:#151a2c;--abt-fg:#eef1ff;--abt-mu:#9aa3c7;--abt-ln:rgba(190,205,255,.16);--abt-ac:#8fb4ff}' +
      '.abt-card *{box-sizing:border-box}' +
      '.abt-x{position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;background:none;color:var(--abt-mu);font-size:24px;line-height:1;cursor:pointer;border-radius:12px}' +
      '.abt-card h2{margin:0 44px 2px 0;font-size:21px;line-height:1.2;font-weight:800;color:var(--abt-fg)}' +
      '.abt-card h3{margin:16px 0 4px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--abt-mu)}' +
      '.abt-card p{margin:0 0 6px;color:var(--abt-fg)}' +
      '.abt-card .abt-desc{color:var(--abt-mu);margin-top:6px}' +
      '.abt-mail{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.abt-mail a{color:var(--abt-ac);font-weight:600;word-break:break-all}' +
      '.abt-copy{min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--abt-ln);background:none;color:var(--abt-fg);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer}' +
      '.abt-fine{margin-top:14px !important;padding-top:12px;border-top:1px solid var(--abt-ln);font-size:12.5px;color:var(--abt-mu) !important}' +
      '.abt-card button:focus-visible,.abt-card a:focus-visible{outline:2px solid var(--abt-ac);outline-offset:2px}' +
      '@keyframes abt-fade{from{opacity:0}}@keyframes abt-rise{from{opacity:0;transform:translateY(10px)}}' +
      '@media (prefers-reduced-motion:reduce){.abt-wrap,.abt-card{animation:none}}';
    document.head.appendChild(s);
  }

  // Light or dark panel, matching whatever the app is showing right now.
  function isDark(from) {
    for (var el = from; el && el.nodeType === 1; el = el.parentElement) {
      var c = getComputedStyle(el).backgroundColor;
      var m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (m && (m[4] === undefined || +m[4] > 0.5)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) < 128;
    }
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  function close() {
    if (!box) return;
    box.remove(); box = null;
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }

  function open() {
    if (box) return;
    addStyles();
    lastFocus = document.activeElement;
    var host = (HOST && document.querySelector(HOST)) || document.body;
    box = document.createElement('div');
    box.className = 'abt-wrap';
    box.style.position = host === document.body ? 'fixed' : 'absolute';
    box.innerHTML =
      '<div class="abt-card' + (isDark(lastFocus && lastFocus.nodeType === 1 ? lastFocus : host) ? ' dark' : '') + '" role="dialog" aria-modal="true" aria-labelledby="abt-title">' +
        '<button type="button" class="abt-x" aria-label="Close">×</button>' +
        '<h2 id="abt-title">' + esc(NAME) + '</h2>' +
        (DESC ? '<p class="abt-desc">' + esc(DESC) + '</p>' : '') +
        '<h3>Designed by</h3><p><b>' + OWNER + '</b></p>' +
        '<p>© ' + YEAR + ' ' + OWNER + '. All rights reserved.</p>' +
        '<h3>Feedback</h3><p>Would love to hear your feedback and suggestions. Thank you!</p>' +
        '<p class="abt-mail"><a href="mailto:' + EMAIL + '?subject=' + encodeURIComponent(NAME + ' feedback') + '">' + EMAIL + '</a>' +
        '<button type="button" class="abt-copy">Copy</button></p>' +
        (FINE ? '<p class="abt-fine">' + esc(FINE) + '</p>' : '') +
      '</div>';
    host.appendChild(box);
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.closest('.abt-x')) { close(); return; }
      var c = e.target.closest('.abt-copy');
      if (c) {
        var done = function () { c.textContent = 'Copied'; setTimeout(function () { if (c) c.textContent = 'Copy'; }, 1600); };
        try { navigator.clipboard.writeText(EMAIL).then(done, function () { c.textContent = EMAIL; }); }
        catch (err) { c.textContent = EMAIL; }
      }
    });
    document.addEventListener('keydown', onKey, true);
    box.querySelector('.abt-x').focus({ preventScroll: true });
  }

  function linkHTML(extraClass) {
    return '<button type="button" class="abt-link' + (extraClass ? ' ' + extraClass : '') + '" data-about-open>' + LINK_TEXT + '</button>';
  }
  function link(extraClass) {
    var t = document.createElement('div'); t.innerHTML = linkHTML(extraClass);
    return t.firstChild;
  }

  addStyles();
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-about-open]');
    if (t) { e.preventDefault(); open(); }
  });

  window.AppAbout = { open: open, close: close, link: link, linkHTML: linkHTML, text: LINK_TEXT };
})();
