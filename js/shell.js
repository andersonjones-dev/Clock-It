/*
 * CLOCKIT — app shell
 * ---------------------------------------------------------------
 * Holds the modes together:
 *   - the mode picker (tap the logo / mode name in the header)
 *   - the status chip (READY / LIVE / PAUSED / FINISHED)
 *   - keeping the screen awake while any clock runs
 *   - routing keyboard shortcuts to the visible mode
 *
 * Each mode registers itself with Shell.register(id, {...}) and can
 * provide: enter(), leave(), onKey(e), onVisibility(hidden),
 * wantsWake(), badge().
 */
(function () {
  'use strict';

  var ORDER = ['duel', 'group', 'showtime', 'stopwatch', 'tally'];
  var META = {
    duel:      { name: 'Duel',      icon: '#i-duel',      desc: 'Chess-style clock for two players', tone: 'duel' },
    group:     { name: 'Group',     icon: '#i-group',     desc: 'Turn timer for 2–8 players',        tone: 'group' },
    showtime:  { name: 'Showtime',  icon: '#i-ring',      desc: 'Big countdown for quizzes and game shows', tone: 'show' },
    stopwatch: { name: 'Stopwatch', icon: '#i-stopwatch', desc: 'Laps, splits and pace',             tone: 'sw' },
    tally:     { name: 'Tally',     icon: '#i-tally',     desc: 'Scores for any card or board game', tone: 'tally' }
  };
  var STATE_TEXT = { ready: 'READY', idle: 'READY', live: 'LIVE', paused: 'PAUSED', finished: 'FINISHED' };
  var KEY_MODE = 'duelclock.mode';

  var modes = {};
  var statuses = {};
  var current = null;
  var wakeLock = null;
  var lastFocus = null;

  function $(id) { return document.getElementById(id); }

  var store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  function paintStatus() {
    var s = statuses[current] || { state: 'ready' };
    var chip = $('status');
    chip.dataset.state = s.state === 'idle' ? 'ready' : s.state;
    $('statusText').textContent = s.label || STATE_TEXT[s.state] || 'READY';
  }

  /* ---------- mode picker ---------- */

  function buildGrid() {
    var grid = $('modeGrid');
    grid.innerHTML = '';
    ORDER.forEach(function (id) {
      var m = META[id];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mode-tile tone-' + m.tone;
      b.dataset.mode = id;
      b.innerHTML =
        '<span class="mode-icon" aria-hidden="true"><svg><use href="' + m.icon + '"/></svg></span>' +
        '<span class="mode-text"><b>' + m.name + '</b><small>' + m.desc + '</small></span>' +
        '<span class="mode-live" hidden></span>';
      b.addEventListener('click', function () { Shell.switchTo(id); closePicker(); });
      grid.appendChild(b);
    });
  }

  function refreshGrid() {
    Array.prototype.forEach.call(document.querySelectorAll('.mode-tile'), function (tile) {
      var id = tile.dataset.mode;
      var mode = modes[id];
      var badge = mode && mode.badge ? mode.badge() : '';
      var live = tile.querySelector('.mode-live');
      live.textContent = badge || '';
      live.hidden = !badge;
      tile.classList.toggle('is-current', id === current);
      tile.setAttribute('aria-current', id === current ? 'true' : 'false');
      tile.setAttribute('aria-label', META[id].name + '. ' + META[id].desc + (badge ? '. ' + badge : '') + (id === current ? '. Current mode' : ''));
    });
  }

  var gridTimer = 0;
  function openPicker() {
    lastFocus = document.activeElement;
    refreshGrid();
    $('scrim').hidden = false;
    $('modeSheet').hidden = false;
    $('modeBtn').setAttribute('aria-expanded', 'true');
    var cur = document.querySelector('.mode-tile.is-current') || document.querySelector('.mode-tile');
    if (cur) cur.focus({ preventScroll: true });
    clearInterval(gridTimer);
    gridTimer = setInterval(refreshGrid, 500); // keep running badges ticking
  }
  function closePicker() {
    if ($('modeSheet').hidden) return;
    clearInterval(gridTimer);
    $('modeSheet').hidden = true;
    if ($('sheet').hidden) $('scrim').hidden = true;
    $('modeBtn').setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus) && lastFocus.offsetParent) lastFocus.focus({ preventScroll: true });
  }

  /* ---------- screen wake lock (shared by all modes) ---------- */

  function refreshWake() {
    var want = !document.hidden && Object.keys(modes).some(function (k) { return modes[k].wantsWake && modes[k].wantsWake(); });
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = 'pending';
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
        refreshWake();
      }).catch(function () { wakeLock = null; });
    } else if (!want && wakeLock && wakeLock !== 'pending') {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  /* ---------- small UI helpers the modes share ---------- */

  function flash(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(el['_t_' + cls]);
    el['_t_' + cls] = setTimeout(function () { el.classList.remove(cls); }, ms || 600);
  }

  /*
   * Two-tap confirmation for destructive buttons (Reset, Finish).
   * First tap turns the button red and changes its label.
   */
  function confirmTap(btn, confirmLabel, action) {
    if (btn._armed) {
      clearTimeout(btn._armed); btn._armed = 0;
      btn.classList.remove('confirm');
      var l0 = btn.querySelector('.ctl-label'); if (l0 && btn._label) l0.textContent = btn._label;
      action();
      return;
    }
    var l = btn.querySelector('.ctl-label');
    btn._label = l ? l.textContent : '';
    if (l) l.textContent = confirmLabel;
    btn.classList.add('confirm');
    btn._armed = setTimeout(function () {
      btn._armed = 0; btn.classList.remove('confirm'); if (l) l.textContent = btn._label;
    }, 2800);
    if (window.DuelHaptics) DuelHaptics.tap();
  }

  function announce(text) {
    var a = $('announcer');
    a.textContent = '';
    setTimeout(function () { a.textContent = text; }, 30);
  }

  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  /*
   * iPhone Home Screen fixes (house rules for all of Anderson's apps).
   *
   * iOS sometimes reports a Home Screen app's window one status bar
   * (20-60px) shorter than the screen. It comes in two flavours, and iOS can
   * flip between them (for example when a sheet closes):
   *
   *   A. The window starts at the top of the screen but stops a status bar
   *      short of the bottom. The status-bar inset (env(safe-area-inset-top))
   *      is still reported. The page is drawn to the real bottom, so we size
   *      the WHOLE app to the real screen height (--app-h).
   *   B. The window is moved down below the status bar. The status-bar inset
   *      is reported as 0 and the window already reaches the real bottom, so
   *      the app must NOT be stretched (that pushed the bottom bar under the
   *      home indicator).
   *
   * We tell them apart with the status-bar inset, and re-check after the
   * keyboard closes, on return to the app, after launch, and twice a second
   * while the app is open (iOS doesn't always send a resize event when it
   * flips). Nothing is written to the page unless the answer changes.
   * The old trick of hiding and re-showing the page is gone: it was what
   * kicked iOS into flavour B.
   */
  var probe = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function typing() {
    var a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  }
  function insetTop() {
    if (!probe) {
      probe = document.createElement('div');
      probe.id = 'safeTopProbe';
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;left:0;top:0;width:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(probe);
    }
    return probe.offsetHeight;
  }

  function fitScreen() {
    var root = document.documentElement;
    var want = '';
    if (isStandalone() && window.screen && !typing()) {
      var landscape = window.innerWidth > window.innerHeight;
      var fullH = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
      var gap = fullH - window.innerHeight;
      // Flavour A only: a status-bar-sized gap AND the window still starts at
      // the top of the screen (status-bar inset reported). Bigger gaps are
      // real (keyboard, split view) and are left alone.
      if (gap >= 10 && gap <= 80 && insetTop() >= gap - 6) want = fullH + 'px';
    }
    var was = root.classList.contains('fit-screen') ? root.style.getPropertyValue('--app-h') : '';
    if (was === want) return;
    root.classList.toggle('fit-screen', !!want);
    if (want) root.style.setProperty('--app-h', want);
    else root.style.removeProperty('--app-h');
  }

  function watchScreen() {
    fitScreen();
    [150, 600, 1500].forEach(function (ms) { setTimeout(fitScreen, ms); });
    window.addEventListener('resize', fitScreen);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitScreen);
    window.addEventListener('orientationchange', function () { setTimeout(fitScreen, 300); });
    document.addEventListener('focusout', function () { setTimeout(fitScreen, 160); setTimeout(fitScreen, 600); });
    window.addEventListener('pageshow', function () { setTimeout(fitScreen, 50); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { setTimeout(fitScreen, 50); setTimeout(fitScreen, 600); }
    });
    setInterval(function () { if (!document.hidden) fitScreen(); }, 500);
  }

  /* ---------- public API ---------- */

  var Shell = window.Shell = {
    META: META,
    store: store,
    register: function (id, mode) { modes[id] = mode; },
    current: function () { return current; },
    isCurrent: function (id) { return current === id; },
    reportStatus: function (id, state, label) {
      statuses[id] = { state: state, label: label };
      if (id === current) paintStatus();
    },
    switchTo: function (id) {
      if (!META[id] || id === current) return;
      var old = modes[current];
      if (old && old.leave) old.leave();
      document.getElementById('app').classList.remove('stage-on');
      current = id;
      store.set(KEY_MODE, id);
      document.getElementById('app').dataset.mode = id;
      ORDER.forEach(function (m) { var v = $('view-' + m); if (v) v.hidden = m !== id; });
      $('modeName').textContent = META[id].name;
      $('modeBtn').setAttribute('aria-label', META[id].name + ' mode. Change mode');
      if (modes[id] && modes[id].enter) modes[id].enter();
      paintStatus();
      refreshWake();
      announce(META[id].name + ' mode');
    },
    openPicker: openPicker,
    closePicker: closePicker,
    refreshWake: refreshWake,
    toast: function (text, opts) { if (window.DuelClock && DuelClock.toast) DuelClock.toast(text, opts); },
    openSettings: function (focusId) { if (window.DuelClock && DuelClock.openSettings) DuelClock.openSettings(focusId); },
    prefs: function () { return window.DuelClock ? DuelClock.settings() : {}; },
    announce: announce,
    flash: flash,
    confirmTap: confirmTap,
    reducedMotion: reducedMotion
  };

  /* ---------- wiring ---------- */

  function onKey(e) {
    if (!$('modeSheet').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
      return;
    }
    if (!$('sheet').hidden) return;              // settings handles its own keys
    if (current === 'duel') return;              // Duel handles its own keys (app.js)
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var m = modes[current];
    if (m && m.onKey) m.onKey(e);
  }

  function start() {
    watchScreen();
    buildGrid();
    $('modeBtn').addEventListener('click', function () { if (window.DuelSound) DuelSound.unlock(); openPicker(); });
    $('modeClose').addEventListener('click', closePicker);
    $('scrim').addEventListener('click', closePicker);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', function () {
      Object.keys(modes).forEach(function (k) { if (k !== 'duel' && modes[k].onVisibility) modes[k].onVisibility(document.hidden); });
      refreshWake();
    });

    var saved = store.get(KEY_MODE);
    var first = META[saved] ? saved : 'duel';
    // Show every view as hidden first, then switch to the saved mode.
    current = null;
    Shell.switchTo(first);
    // First ever visit: show the mode picker so people discover the modes.
    if (!saved) setTimeout(openPicker, 350);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);
})();
