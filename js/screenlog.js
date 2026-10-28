/*
 * CLOCKIT — screen measurement panel (for fixing the iPhone height bug)
 * ---------------------------------------------------------------
 * Hidden by default. Tap the status chip (READY / LIVE …) in the header
 * three times quickly to show or hide it. While it's showing, it writes a
 * line every time anything about the screen size changes, plus events
 * such as the mode picker opening and closing. A screen recording of it
 * shows exactly what iOS reports when the layout jumps.
 *
 * Columns: time  window height / screen height  top inset / bottom inset
 *          app bottom  bottom-bar bottom  (stretch gap)  event
 */
(function () {
  'use strict';

  var panel = null, lines = [], last = '', timer = 0, t0 = Date.now();
  var probeTop = null, probeBot = null;

  function probe(side) {
    var d = document.createElement('div');
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-' + side + ',0px)';
    document.body.appendChild(d);
    return d;
  }

  function sample() {
    if (!probeTop) { probeTop = probe('top'); probeBot = probe('bottom'); }
    var app = document.getElementById('app').getBoundingClientRect();
    var view = document.querySelector('.view:not([hidden])');
    var bar = view && (view.querySelector('.controls') || view.querySelector('[class*="controls"]'));
    var barB = bar ? Math.round(bar.getBoundingClientRect().bottom) : '-';
    var gap = getComputedStyle(document.documentElement).getPropertyValue('--screen-gap').trim() || '0';
    var vv = window.visualViewport;
    return [
      'win ' + window.innerHeight + '/' + Math.max(screen.width, screen.height),
      'vv ' + (vv ? Math.round(vv.height) + '@' + Math.round(vv.offsetTop) : '-'),
      'in ' + probeTop.offsetHeight + '/' + probeBot.offsetHeight,
      'app ' + Math.round(app.top) + '-' + Math.round(app.bottom),
      'bar ' + barB,
      'gap ' + gap.replace('px', '')
    ].join('  ');
  }

  function stamp() { return ((Date.now() - t0) / 1000).toFixed(1).padStart(5, ' '); }

  function push(text) {
    lines.push(stamp() + '  ' + text);
    if (lines.length > 14) lines.shift();
    if (panel) panel.textContent = lines.join('\n');
  }

  function check() {
    var s = sample();
    if (s !== last) { last = s; push(s); }
  }

  function show(on) {
    if (on && !panel) {
      panel = document.createElement('pre');
      panel.id = 'screenLog';
      panel.style.cssText = 'position:fixed;left:6px;right:6px;top:calc(env(safe-area-inset-top,0px) + 70px);z-index:99;margin:0;padding:8px 10px;' +
        'background:rgba(0,0,0,.82);color:#c6ff3d;font:11px/1.45 ui-monospace,Menlo,monospace;border-radius:10px;pointer-events:none;white-space:pre;overflow:hidden';
      document.body.appendChild(panel);
      t0 = Date.now(); lines = []; last = '';
      push('panel on · ClockIt ' + (document.getElementById('version') || {}).textContent);
      check();
      timer = setInterval(check, 100);
    } else if (!on && panel) {
      clearInterval(timer);
      panel.remove(); panel = null;
    }
  }

  window.ScreenLog = {
    note: function (what) { if (panel) { check(); push('— ' + what); setTimeout(check, 50); } }
  };

  ['focusout', 'visibilitychange'].forEach(function (ev) {
    document.addEventListener(ev, function () { window.ScreenLog.note(ev); });
  });
  window.addEventListener('resize', function () { window.ScreenLog.note('resize'); });

  // Three quick taps on the status chip toggles the panel.
  var taps = [];
  function bind() {
    var chip = document.getElementById('status');
    if (!chip) return;
    chip.addEventListener('click', function () {
      var now = Date.now();
      taps = taps.filter(function (t) { return now - t < 700; });
      taps.push(now);
      if (taps.length >= 3) { taps = []; show(!panel); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
