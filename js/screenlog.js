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
    d.style.cssText = 'position:absolute;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-' + side + ',0px)';
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
    if (lines.length > 16) lines.shift();
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
      panel.style.cssText = 'position:absolute;left:6px;right:6px;top:calc(env(safe-area-inset-top,0px) + 70px);z-index:99;margin:0;padding:8px 10px;' +
        'background:rgba(0,0,0,.82);color:#c6ff3d;font:11px/1.45 ui-monospace,Menlo,monospace;border-radius:10px;pointer-events:none;white-space:pre;overflow:hidden';
      document.body.appendChild(panel);
      t0 = Date.now(); lines = []; last = '';
      push('panel on · ClockIt ' + (document.getElementById('version') || {}).textContent);
      check();
      timer = setInterval(check, 100);
      makeBar();
    } else if (!on && panel) {
      clearInterval(timer);
      if (bar) { bar.remove(); bar = null; }
      panel.remove(); panel = null;
    }
  }

  window.ScreenLog = {
    testing: false,
    note: function (what) { if (panel) { check(); push('— ' + what); setTimeout(check, 50); } }
  };

  /*
   * Test buttons: each repeats ONE thing that closing the mode picker does,
   * with the automatic fix paused for 1.5s, so the log shows which one makes
   * iOS shrink the window. Afterwards the fix runs once to reset.
   */
  var bar = null;
  function overlay(blur) {
    var d = document.createElement('div');
    d.style.cssText = 'position:absolute;inset:0;z-index:60;pointer-events:none;background:rgba(2,4,12,.6);' + (blur ? '-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);' : '');
    document.getElementById('app').appendChild(d);
    return d;
  }
  var TESTS = {
    sheet: { label: 'Sheet', run: function () {
      var s = document.getElementById('modeSheet'), c = document.getElementById('scrim');
      s.hidden = false; c.hidden = false;
      setTimeout(function () { s.hidden = true; c.hidden = true; window.ScreenLog.note('sheet hidden'); }, 700);
    } },
    focus: { label: 'Focus', run: function () {
      var a = document.getElementById('settingsBtn'), b = document.getElementById('modeBtn');
      a.focus({ preventScroll: true });
      setTimeout(function () { b.focus({ preventScroll: true }); window.ScreenLog.note('focus moved'); }, 700);
    } },
    blur: { label: 'Blur bg', run: function () {
      var d = overlay(true);
      setTimeout(function () { d.remove(); window.ScreenLog.note('blur layer removed'); }, 700);
    } },
    plain: { label: 'Plain bg', run: function () {
      var d = overlay(false);
      setTimeout(function () { d.remove(); window.ScreenLog.note('plain layer removed'); }, 700);
    } }
  };
  function runTest(key) {
    if (window.ScreenLog.testing) return;
    window.ScreenLog.testing = true;
    window.ScreenLog.note('TEST ' + TESTS[key].label);
    TESTS[key].run();
    setTimeout(function () {
      window.ScreenLog.testing = false;
      window.ScreenLog.note('test done');
      if (window.Shell && Shell.remeasure) Shell.remeasure();
    }, 2200);
  }
  function makeBar() {
    bar = document.createElement('div');
    bar.id = 'screenTests';
    bar.style.cssText = 'position:absolute;left:6px;right:6px;bottom:calc(env(safe-area-inset-bottom,0px) + 86px);z-index:99;display:flex;gap:6px;';
    Object.keys(TESTS).forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = TESTS[k].label;
      b.style.cssText = 'flex:1;height:44px;border-radius:10px;border:1px solid #c6ff3d;background:rgba(0,0,0,.85);color:#c6ff3d;font:700 13px -apple-system,system-ui,sans-serif;';
      b.addEventListener('click', function (e) { e.stopPropagation(); runTest(k); });
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

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
