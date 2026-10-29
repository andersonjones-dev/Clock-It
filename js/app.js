/*
 * CLOCKIT — app controller
 * ---------------------------------------------------------------
 * Connects the timer engine (engine.js) to the screen.
 *   - settings: saved preferences (names, time, theme...)
 *   - engine:   the one authoritative game state
 *   - render(): makes the screen match the engine
 * The countdown display is redrawn every animation frame while a
 * clock runs; everything else is redrawn after each action.
 */
(function () {
  'use strict';

  var APP_VERSION = '2.4.2';
  var E = window.DuelEngine;
  var PHASE = E.PHASE;
  var Sound = window.DuelSound;
  var Haptics = window.DuelHaptics;
  var Chaos = window.DuelChaos;

  var THEME_COLORS = { voltage: '#0a0f24', royal: '#110b25', forest: '#0a1714' };
  var STORE_SETTINGS = 'duelclock.settings.v1';
  var STORE_GAME = 'duelclock.game.v1';

  var DEFAULTS = {
    timeMode: 5,            // minutes (1, 3, 5, 10, 15) or 'custom'
    customMs: 7.5 * 60000,  // used when timeMode is 'custom'
    incSec: 0,              // bonus seconds per move
    first: 0,               // who moves first
    names: ['Player 1', 'Player 2'],
    theme: 'voltage',
    sound: true,
    haptics: true,
    table: true,            // flip Player 1's side to face across the table
    autoPause: true,        // pause when the app is hidden
    chaos: { dramatic: false, roast: false, panic: false, couch: false },
    takeBack: 'wrong',      // 'wrong' | 'undo' | 'off'
    penaltySec: 0           // taken off for a wrong answer
  };

  /* ---------- small helpers ---------- */

  function $(id) { return document.getElementById(id); }
  function now() { return performance.now(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function storeGet(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function storeSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ }
  }
  function storeDel(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    var s = clone(DEFAULTS);
    var saved = storeGet(STORE_SETTINGS);
    if (saved && typeof saved === 'object') {
      Object.keys(DEFAULTS).forEach(function (k) {
        if (saved[k] === undefined) return;
        if (k === 'chaos') Object.assign(s.chaos, saved.chaos);
        else if (k === 'names') { if (Array.isArray(saved.names)) s.names = [String(saved.names[0] || DEFAULTS.names[0]), String(saved.names[1] || DEFAULTS.names[1])]; }
        else s[k] = saved[k];
      });
    }
    if (!THEME_COLORS[s.theme]) s.theme = 'voltage';
    if ([1, 3, 5, 10, 15, 'custom'].indexOf(s.timeMode) < 0) s.timeMode = 5;
    if ([0, 2, 3, 5, 10].indexOf(s.incSec) < 0) s.incSec = 0;
    s.first = s.first === 1 ? 1 : 0;
    if (['wrong', 'undo', 'off'].indexOf(s.takeBack) < 0) s.takeBack = 'wrong';
    if ([0, 5, 10].indexOf(s.penaltySec) < 0) s.penaltySec = 0;
    s.customMs = Math.min(E.ClockEngine.MAX_MS, Math.max(10000, Number(s.customMs) || DEFAULTS.customMs));
    return s;
  }
  function saveSettings() { storeSet(STORE_SETTINGS, settings); }

  function timeMsFor(cfg) { return cfg.timeMode === 'custom' ? cfg.customMs : cfg.timeMode * 60000; }
  function gameConfigFrom(cfg) { return { initialMs: timeMsFor(cfg), incrementMs: cfg.incSec * 1000, firstPlayer: cfg.first }; }

  function nameOf(p) { return settings.names[p] || DEFAULTS.names[p]; }

  function shortTime(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60), r = s % 60;
    return m + 'm' + (r ? ' ' + r + 's' : '');
  }
  function describeConfig(c) {
    var t = c.initialMs % 60000 === 0 ? (c.initialMs / 60000) + ' min' : shortTime(c.initialMs);
    return t + (c.incrementMs ? ' · +' + c.incrementMs / 1000 + 's per move' : '');
  }

  /* ---------- state ---------- */

  var settings = loadSettings();
  var engine = new E.ClockEngine({ config: gameConfigFrom(settings) });
  var draft = null;              // settings being edited in the sheet
  var raf = 0, flagTimer = 0;
  var tickerOverride = null, tickerTimer = 0;
  var lastDigits = ['', ''];
  var lastMeter = [-1, -1];
  var lowState = [{ t30: false, t10: false, sec: -1 }, { t30: false, t10: false, sec: -1 }];
  var fastStreak = 0;
  var pausedByHide = false;
  var hiddenAt = null;
  var wakeLock = null;
  var resetArmed = 0, applyArmed = 0;
  var lastFocus = null;

  /* ---------- elements ---------- */

  var app = $('app');
  var panels = [$('panel0'), $('panel1')];
  var digitEls = [0, 1].map(function (p) {
    var root = $('digits' + p);
    return { d: root.querySelectorAll('.d'), tenths: root.querySelector('.tenths') };
  });
  var meters = [$('meter0'), $('meter1')];
  var primaryBtn = $('primaryBtn');
  var addBtn = $('addBtn');
  var resetBtn = $('resetBtn');
  var soundBtn = $('soundBtn');
  var ticker = $('ticker');
  var tickerText = $('tickerText');

  /* ================================================================
   * Rendering
   * ================================================================ */

  function render() {
    var ph = engine.phase;
    var a = engine.active;
    var inPlay = ph === PHASE.LIVE || ph === PHASE.PAUSED;

    app.dataset.phase = ph;
    app.dataset.active = String(a);
    app.dataset.theme = settings.theme;
    app.dataset.table = settings.table ? 'on' : 'off';
    if (window.Shell) Shell.reportStatus('duel', ph);

    for (var p = 0; p < 2; p++) {
      var el = panels[p];
      var isActive = inPlay && p === a;
      el.classList.toggle('is-active', isActive);
      el.classList.toggle('is-waiting', inPlay && p !== a);
      el.classList.toggle('is-first', ph === PHASE.READY && p === a);
      el.classList.toggle('is-winner', ph === PHASE.FINISHED && engine.winner === p);
      el.classList.toggle('is-flagged', ph === PHASE.FINISHED && engine.loser === p);
      if (!isActive || ph !== PHASE.LIVE) el.classList.remove('is-low');

      var badge;
      if (ph === PHASE.READY) badge = p === a ? 'MOVES FIRST' : 'READY';
      else if (ph === PHASE.LIVE) badge = p === a ? 'YOUR MOVE' : 'WAITING';
      else if (ph === PHASE.PAUSED) badge = p === a ? 'PAUSED' : 'WAITING';
      else badge = engine.winner === p ? 'WINNER' : 'OUT OF TIME';
      $('badge' + p).textContent = badge;

      $('name' + p).textContent = nameOf(p);
      var mv = engine.moves[p];
      $('moves' + p).textContent = mv === 1 ? '1 MOVE' : mv + ' MOVES';
      $('inc' + p).textContent = engine.config.incrementMs ? '+' + engine.config.incrementMs / 1000 + 'S / MOVE' : '';

      var rem = engine.remainingOf(p);
      var state;
      if (ph === PHASE.READY) state = p === a ? 'Moves first.' : 'Waiting.';
      else if (ph === PHASE.LIVE) state = p === a ? 'Your turn. Tap here to end your turn.' : 'Waiting for your opponent.';
      else if (ph === PHASE.PAUSED) state = 'Game paused.';
      else state = engine.winner === p ? 'Winner.' : 'Out of time.';
      el.setAttribute('aria-label', nameOf(p) + ', ' + E.speakTime(rem) + ' left. ' + state);
    }

    // Primary button
    var label, icon, aria;
    if (ph === PHASE.READY) { label = 'Start Battle'; icon = '#i-play'; aria = 'Start the battle'; }
    else if (ph === PHASE.LIVE) { label = 'Pause'; icon = '#i-pause'; aria = 'Pause the game'; }
    else if (ph === PHASE.PAUSED) { label = 'Resume'; icon = '#i-play'; aria = 'Resume the game'; }
    else { label = 'Rematch'; icon = '#i-reset'; aria = 'Start a rematch'; }
    $('primaryLabel').textContent = label;
    primaryBtn.querySelector('use').setAttribute('href', icon);
    primaryBtn.setAttribute('aria-label', aria);

    addBtn.disabled = !inPlay;
    renderTakeBack();
    if (!resetArmed) {
      resetBtn.disabled = ph === PHASE.READY && engine.moves[0] + engine.moves[1] === 0;
    }

    // Presets on the rail
    var presetBtns = document.querySelectorAll('.preset');
    for (var i = 0; i < presetBtns.length; i++) {
      var b = presetBtns[i];
      var m = b.dataset.min === 'custom' ? 'custom' : Number(b.dataset.min);
      b.setAttribute('aria-pressed', String(m === settings.timeMode));
      if (m === 'custom') {
        b.setAttribute('aria-label', settings.timeMode === 'custom' ? 'Custom time, ' + shortTime(settings.customMs) + '. Change in settings' : 'Custom time. Opens settings');
        b.querySelector('b').textContent = settings.timeMode === 'custom' ? compactTime(settings.customMs) : '···';
      } else {
        b.setAttribute('aria-label', m + ' minute' + (m > 1 ? 's' : '') + ' per player, ' + b.querySelector('span').textContent);
      }
    }

    renderSound();
    renderTicker();
    renderClocks(now(), true);
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    // Only touch the status-bar colour when it really changes: every write makes
    // iOS redo the status bar, which can shrink a Home Screen app's window.
    if (themeMeta && themeMeta.getAttribute('content') !== THEME_COLORS[settings.theme]) themeMeta.setAttribute('content', THEME_COLORS[settings.theme]);
  }

  function compactTime(ms) {
    var s = Math.round(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return r ? m + ':' + (r < 10 ? '0' : '') + r : String(m);
  }

  function renderSound() {
    soundBtn.setAttribute('aria-pressed', String(settings.sound));
    soundBtn.setAttribute('aria-label', settings.sound ? 'Sound on. Tap to mute' : 'Sound off. Tap to turn sound on');
    soundBtn.querySelector('use').setAttribute('href', settings.sound ? '#i-sound' : '#i-mute');
    soundBtn.querySelector('.ctl-label').textContent = settings.sound ? 'Sound' : 'Muted';
  }

  /* The countdown numbers and meters. Cheap: only touches what changed. */
  function renderClocks(t, force) {
    var ph = engine.phase;
    for (var p = 0; p < 2; p++) {
      var ms = engine.remainingOf(p, t);
      var f = E.formatTime(ms);
      if (force || f.text !== lastDigits[p]) {
        var de = digitEls[p];
        var chars = f.mm + f.ss;
        for (var i = 0; i < 4; i++) if (de.d[i].textContent !== chars[i]) de.d[i].textContent = chars[i];
        de.tenths.textContent = f.tenths ? '.' + f.tenths : '';
        lastDigits[p] = f.text;
      }
      var ratio = Math.max(0, Math.min(1, ms / engine.config.initialMs));
      var q = Math.round(ratio * 400) / 400;
      if (force || q !== lastMeter[p]) { meters[p].style.transform = 'scaleX(' + q + ')'; lastMeter[p] = q; }

      var low = ph === PHASE.LIVE && p === engine.active && ms <= 10000;
      panels[p].classList.toggle('is-low', low);
    }
  }

  /* ---------- ticker (the message line in the middle) ---------- */

  function baseTicker() {
    var ph = engine.phase, a = engine.active;
    var arrowA = arrowFor(a);
    if (ph === PHASE.READY) return { text: nameOf(a) + ' moves first · ' + describeConfig(engine.config), cls: '' };
    if (ph === PHASE.LIVE) return { text: arrowA.pre + nameOf(a) + ' to move' + arrowA.post, cls: 'turn-' + a };
    if (ph === PHASE.PAUSED) return { text: 'Paused · ' + nameOf(a) + ' is next', cls: '' };
    return { text: nameOf(engine.winner) + ' wins on time', cls: 'turn-' + engine.winner };
  }
  function arrowFor(p) {
    var landscape = window.matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
    if (landscape) return p === 0 ? { pre: '◀ ', post: '' } : { pre: '', post: ' ▶' };
    return p === 0 ? { pre: '▲ ', post: '' } : { pre: '', post: ' ▼' };
  }

  function renderTicker() {
    var msg = tickerOverride || baseTicker();
    var cls = 'ticker ' + (tickerOverride ? 'k-' + tickerOverride.kind : msg.cls);
    if (ticker.className.replace(' flash', '') !== cls) ticker.className = cls;
    if (tickerText.textContent !== msg.text) {
      tickerText.textContent = msg.text;
      ticker.classList.remove('flash');
      void ticker.offsetWidth;
      ticker.classList.add('flash');
    }
  }

  function showMessage(text, kind, ms) {
    if (!text) return;
    clearTimeout(tickerTimer);
    tickerOverride = { text: text, kind: kind || 'info' };
    renderTicker();
    tickerTimer = setTimeout(function () { tickerOverride = null; renderTicker(); }, ms || 2600);
  }

  function announce(text) {
    var a = $('announcer');
    a.textContent = '';
    setTimeout(function () { a.textContent = text; }, 30);
  }

  var toastTimer = 0;
  function showToast(text, opts) {
    opts = opts || {};
    var t = $('toast');
    t.textContent = text;
    if (opts.action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = opts.action;
      b.addEventListener('click', function () { t.hidden = true; opts.onAction(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    if (!opts.sticky) toastTimer = setTimeout(function () { t.hidden = true; }, opts.ms || 2600);
  }

  /* ================================================================
   * The running clock
   * ================================================================ */

  function frame() {
    raf = 0;
    var t = now();
    var r = engine.tick(t);
    renderClocks(t);
    if (r) { onTimeout(); return; }
    checkThresholds(t);
    if (engine.phase === PHASE.LIVE) raf = requestAnimationFrame(frame);
  }

  /* Keeps exactly one frame loop and one flag timer alive while LIVE. */
  function syncLoop() {
    if (engine.phase === PHASE.LIVE) {
      if (!raf) raf = requestAnimationFrame(frame);
    } else if (raf) { cancelAnimationFrame(raf); raf = 0; }

    clearTimeout(flagTimer);
    flagTimer = 0;
    if (engine.phase === PHASE.LIVE) {
      // Backup in case animation frames are throttled: fires when the flag should fall.
      var ms = engine.msUntilFlag();
      flagTimer = setTimeout(function onFlagTimer() {
        var r = engine.tick();
        if (r) onTimeout(); else syncLoop();
      }, Math.max(20, Math.min(ms + 15, 2147483000)));
    }
    if (engine.phase !== PHASE.LIVE) setPanic(false);
  }

  /* Low-time moments: 30 s and 10 s warnings, Panic Mode heartbeat. */
  function checkThresholds(t) {
    var p = engine.active;
    var ms = engine.remainingOf(p, t);
    var st = lowState[p];
    if (ms > 31000) st.t30 = false;
    if (ms > 11000) st.t10 = false;

    if (!st.t30 && ms <= 30000 && ms > 10000 && engine.config.initialMs > 45000) {
      st.t30 = true;
      chaosSay('low30', { p: nameOf(p) });
    }
    if (!st.t10 && ms <= 10000) {
      st.t10 = true;
      if (!chaosSay('low10', { p: nameOf(p) })) {
        // Standard mode: a quiet, factual heads-up
        showMessage('10 seconds left · ' + nameOf(p), 'warn', 2200);
      }
    }

    var panic = settings.chaos.panic && ms <= 10000;
    setPanic(panic, ms);
    if (panic) {
      var sec = Math.ceil(ms / 1000);
      if (sec !== st.sec) {
        st.sec = sec;
        if (sec > 0 && settings.sound) Sound.heartbeat(1 - ms / 10000);
      }
    } else st.sec = -1;
  }

  function setPanic(on, ms) {
    app.classList.toggle('panic-on', !!on);
    if (on) app.style.setProperty('--panic', String(0.25 + 0.6 * (1 - ms / 10000)));
  }

  /* ================================================================
   * Actions
   * ================================================================ */

  function afterAction() {
    render();
    syncLoop();
    saveGame();
    syncWakeLock();
  }

  function onPrimary() {
    Sound.unlock();
    disarmReset();
    var ph = engine.phase;
    var t = now();
    if (ph === PHASE.READY) {
      engine.start(t);
      fastStreak = 0;
      Sound.start();
      Haptics.tap();
      flash(panels[engine.active], 'just-activated');
      if (!chaosSay('start', {})) showMessage(nameOf(engine.active) + ' starts · tap your clock when your move is done', 'info', 3200);
      if (settings.chaos.couch) popOn(engine.active, Chaos.pop('start'));
      if (settings.chaos.dramatic && settings.sound) Sound.sting();
      announce('Battle started. ' + nameOf(engine.active) + ' to move.');
    } else if (ph === PHASE.LIVE) {
      engine.pause(t);
      Sound.pause();
      Haptics.tap();
      chaosSay('pause', {});
      announce('Game paused.');
    } else if (ph === PHASE.PAUSED) {
      engine.start(t);
      pausedByHide = false;
      Sound.resume();
      Haptics.tap();
      chaosSay('resume', {});
      flash(panels[engine.active], 'just-activated');
      announce('Game resumed. ' + nameOf(engine.active) + ' to move.');
    } else {
      rematch(false);
      return;
    }
    afterAction();
  }

  function onPanel(p, x, y) {
    Sound.unlock();
    var ph = engine.phase;
    if (ph === PHASE.READY) {
      showMessage('Tap Start Battle to begin', 'info', 1800);
      bump(primaryBtn);
      return;
    }
    if (ph === PHASE.PAUSED) {
      showMessage('Game paused · tap Resume to continue', 'info', 1800);
      bump(primaryBtn);
      return;
    }
    if (ph !== PHASE.LIVE) return;

    var r = engine.press(p);
    if (r.result === 'switched') {
      onSwitched(r, x, y);
    } else if (r.result === 'not-your-turn') {
      flash(panels[p], 'nudge');
      Sound.nudge();
      showMessage('It’s ' + nameOf(engine.active) + '’s turn', 'warn', 1600);
    } else if (r.result === 'timeout') {
      onTimeout();
    }
    // 'debounced' — accidental double tap, ignore silently
  }

  function onSwitched(r, x, y) {
    var from = r.from, to = r.to;
    disarmReset();
    ripple(from, x, y);
    flash(panels[from], 'just-pressed');
    flash(panels[to], 'just-activated');
    Sound.switchTurn(to);
    Haptics.tap();
    if (r.incrementMs) floatOn(from, '+' + r.incrementMs / 1000);

    var fast = r.moveMs < 2000;
    fastStreak = fast ? fastStreak + 1 : 0;

    if (settings.chaos.couch) {
      popOn(to, fast ? Chaos.pop('fast') : Chaos.pop('switch'));
      sparks(from);
      if (settings.sound) Sound.arcade(fastStreak);
    }
    chaosSay('switch', {
      prev: nameOf(from), next: nameOf(to),
      moveMs: r.moveMs, initialMs: engine.config.initialMs,
      streak: fastStreak
    });
    announce(nameOf(to) + '’s turn.');
    afterAction();
  }

  /* ---------- wrong answer / take-back ---------- */

  function renderTakeBack() {
    var btn = $('takeBackBtn');
    var show = settings.takeBack !== 'off' && engine.canTakeBack();
    btn.hidden = !show;
    if (!show) return;
    var back = nameOf(engine.lastSwitch.from);
    var wrong = settings.takeBack === 'wrong';
    $('takeBackLabel').textContent = wrong ? 'Wrong' : 'Undo';
    btn.setAttribute('aria-label', (wrong ? 'Wrong answer: ' : 'Undo: ') + 'give the turn back to ' + back);
  }

  function onTakeBack() {
    Sound.unlock();
    disarmReset();
    var wrong = settings.takeBack === 'wrong';
    var r = engine.takeBack(now(), wrong ? settings.penaltySec * 1000 : 0);
    if (r.result !== 'taken-back') return;
    fastStreak = 0;
    var back = nameOf(r.to);
    flash(panels[r.from], 'nudge');
    flash(panels[r.to], 'just-activated');
    if (wrong) Sound.wrong(); else Sound.nudge();
    Haptics.tap(true);
    if (r.penaltyMs) floatOn(r.to, '\u2212' + r.penaltyMs / 1000);
    var msg = (wrong ? 'Wrong answer \u00b7 back to ' : 'Undone \u00b7 back to ') + back +
      (r.penaltyMs ? ' \u00b7 \u2212' + r.penaltyMs / 1000 + 's penalty' : '');
    if (!(wrong && chaosSay('wrong', { p: back }))) showMessage(msg, 'warn', 3000);
    announce(msg + '.');
    if (r.timeout) { onTimeout(); return; }
    afterAction();
  }

  function onAddTime() {
    Sound.unlock();
    var p = engine.active;
    var added = engine.addTime(5000);
    if (added > 0) {
      floatOn(p, '+5');
      bump(addBtn);
      Sound.addTime();
      Haptics.tap();
      if (!chaosSay('add', { p: nameOf(p) })) showMessage('+5 seconds for ' + nameOf(p), 'info', 1600);
      if (settings.chaos.couch) popOn(p, 'POWER-UP!');
      announce('Added 5 seconds to ' + nameOf(p) + '.');
    } else if (engine.phase === PHASE.LIVE || engine.phase === PHASE.PAUSED) {
      showToast('That clock is already at the 99:59 maximum');
    }
    afterAction();
  }

  /* Reset needs a second tap during a game, so a stray tap can't wipe it. */
  function onReset() {
    Sound.unlock();
    var inPlay = engine.phase === PHASE.LIVE || engine.phase === PHASE.PAUSED;
    if (inPlay && !resetArmed) {
      resetBtn.classList.add('confirm');
      resetBtn.querySelector('.ctl-label').textContent = 'Sure?';
      resetBtn.setAttribute('aria-label', 'Tap again to reset the game');
      resetArmed = setTimeout(disarmReset, 2800);
      Haptics.tap();
      return;
    }
    disarmReset();
    engine.reset();
    resetLowState();
    hideVictory();
    showMessage('Clocks reset · ' + describeConfig(engine.config), 'info', 2000);
    announce('Game reset.');
    afterAction();
  }

  function disarmReset() {
    if (!resetArmed) return;
    clearTimeout(resetArmed);
    resetArmed = 0;
    resetBtn.classList.remove('confirm');
    resetBtn.querySelector('.ctl-label').textContent = 'Reset';
    resetBtn.setAttribute('aria-label', 'Reset game');
    render();
  }

  function onSoundToggle() {
    settings.sound = !settings.sound;
    Sound.setEnabled(settings.sound);
    saveSettings();
    renderSound();
    if (settings.sound) Sound.addTime();
    syncSheetToggles();
  }

  function onPreset(btn) {
    Sound.unlock();
    var m = btn.dataset.min;
    if (m === 'custom') { openSheet({ custom: true }); return; }
    settings.timeMode = Number(m);
    saveSettings();
    engine.configure(gameConfigFrom(settings));
    resetLowState();
    Haptics.tap();
    showMessage(btn.querySelector('span').textContent + ' · ' + describeConfig(engine.config), 'info', 1800);
    afterAction();
  }

  function rematch(swap) {
    if (swap) { settings.first = settings.first === 1 ? 0 : 1; saveSettings(); }
    engine.configure(gameConfigFrom(settings));
    resetLowState();
    hideVictory();
    showMessage(nameOf(engine.active) + ' moves first · tap Start Battle', 'info', 2600);
    afterAction();
    primaryBtn.focus({ preventScroll: true });
  }

  function resetLowState() {
    lowState = [{ t30: false, t10: false, sec: -1 }, { t30: false, t10: false, sec: -1 }];
    fastStreak = 0;
    setPanic(false);
  }

  /* ---------- game over ---------- */

  function onTimeout() {
    syncLoop();
    setPanic(false);
    render();
    saveGame();
    syncWakeLock();
    var w = engine.winner, l = engine.loser;
    Sound.timeout();
    if (settings.chaos.dramatic || settings.chaos.couch) Sound.fanfare();
    Haptics.tap(true);
    announce(nameOf(l) + ' ran out of time. ' + nameOf(w) + ' wins.');
    // Let the players see the 00:00 for a moment before the victory screen.
    setTimeout(function () { if (engine.phase === PHASE.FINISHED) showVictory(); }, reducedMotion() ? 200 : 900);
  }

  function showVictory() {
    var w = engine.winner, l = engine.loser;
    var snap = engine.snapshot();
    for (var p = 0; p < 2; p++) {
      var half = $('vHalf' + p);
      var win = p === w;
      half.classList.toggle('is-winner', win);
      half.classList.toggle('is-loser', !win);
      half.querySelector('use').setAttribute('href', win ? '#i-crown' : '#i-flag');
      $('vKicker' + p).textContent = win ? 'VICTORY' : 'TIME’S UP';
      $('vName' + p).textContent = nameOf(p);
      var mv = snap.moves[p] + (snap.moves[p] === 1 ? ' move' : ' moves');
      $('vDetail' + p).textContent = win
        ? E.formatTime(snap.remaining[p]).text + ' left · ' + mv
        : mv + (snap.longestMs[p] > 0 ? ' · longest think ' + shortTime(snap.longestMs[p]) : '');
    }
    var line = Chaos.message('finish', settings.chaos, { w: nameOf(w), l: nameOf(l), initialMs: engine.config.initialMs });
    $('vLine').textContent = line ? line.text : nameOf(w) + ' wins on time.';
    $('victory').hidden = false;
    $('rematchBtn').focus({ preventScroll: true });
    confetti(w);
  }

  function hideVictory() { $('victory').hidden = true; stopConfetti(); }

  /* ---------- Chaos Mode ---------- */

  /* Shows a Chaos line if any Chaos mode applies. Returns true if it spoke. */
  function chaosSay(event, info) {
    var c = settings.chaos;
    if (!c.dramatic && !c.roast && !c.panic && !c.couch) return false;
    info.initialMs = info.initialMs || engine.config.initialMs;
    var m = Chaos.message(event, c, info);
    if (!m) return false;
    showMessage(m.text, m.kind, m.kind === 'roast' || m.kind === 'dramatic' ? 3400 : 2200);
    return true;
  }

  /* ================================================================
   * Visual effects (all skipped when Reduce Motion is on)
   * ================================================================ */

  function flash(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(el['_t_' + cls]);
    el['_t_' + cls] = setTimeout(function () { el.classList.remove(cls); }, 600);
  }
  function bump(el) { flash(el, 'bump'); }

  function ripple(p, x, y) {
    if (reducedMotion()) return;
    var panel = panels[p];
    var host = panel.querySelector('.ripples');
    var rect = panel.getBoundingClientRect();
    var r = document.createElement('span');
    r.className = 'ripple';
    r.style.left = (x == null ? rect.width / 2 : x - rect.left) + 'px';
    r.style.top = (y == null ? rect.height / 2 : y - rect.top) + 'px';
    host.appendChild(r);
    setTimeout(function () { r.remove(); }, 600);
  }

  function floatOn(p, text) {
    var f = $('float' + p);
    f.textContent = text;
    f.classList.remove('show');
    void f.offsetWidth;
    f.classList.add('show');
  }

  function popOn(p, text) {
    if (!text || reducedMotion()) return;
    var el = $('pop' + p);
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  function sparks(p) {
    if (reducedMotion()) return;
    var host = panels[p].querySelector('.ripples');
    var rect = panels[p].getBoundingClientRect();
    var color = getComputedStyle(panels[p]).getPropertyValue('--pc') || '#fff';
    for (var i = 0; i < 14; i++) {
      var s = document.createElement('span');
      s.className = 'spark';
      var ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 110;
      s.style.left = rect.width / 2 + 'px';
      s.style.top = rect.height / 2 + 'px';
      s.style.background = i % 3 ? color : '#ffffff';
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      host.appendChild(s);
      setTimeout(s.remove.bind(s), 750);
    }
  }

  var confettiRaf = 0;
  function confetti(winner) {
    stopConfetti();
    if (reducedMotion()) return;
    var canvas = $('confetti');
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    var styles = getComputedStyle(app);
    var cols = [styles.getPropertyValue(winner === 0 ? '--p0' : '--p1').trim(), styles.getPropertyValue('--text').trim(), '#ffffff'];
    var originY = winner === 0 ? H * 0.25 : H * 0.75;
    var parts = [];
    var count = settings.chaos.couch || settings.chaos.dramatic ? 160 : 90;
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
      parts.push({ x: W / 2, y: originY, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 3, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, c: cols[i % cols.length], life: 1 });
    }
    var start = performance.now();
    (function step(t) {
      var age = (t - start) / 1000;
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (q) {
        q.vy += 0.18; q.vx *= 0.985; q.vy *= 0.985;
        q.x += q.vx; q.y += q.vy; q.r += q.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / 2.6);
        ctx.translate(q.x, q.y); ctx.rotate(q.r);
        ctx.fillStyle = q.c;
        ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
        ctx.restore();
      });
      if (age < 2.6) confettiRaf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, H);
    })(start);
  }
  function stopConfetti() { if (confettiRaf) cancelAnimationFrame(confettiRaf); confettiRaf = 0; }

  /* ================================================================
   * Settings sheet
   * ================================================================ */

  function openSheet(opts) {
    opts = opts || {};
    var mode = window.Shell ? Shell.current() : 'duel';
    $('sheet').dataset.mode = mode;
    $('sheetTitle').textContent = mode === 'duel' ? 'Settings' : Shell.META[mode].name + ' settings';
    if (mode === 'duel' && engine.phase === PHASE.LIVE) {
      engine.pause();
      Sound.pause();
      afterAction();
      showToast('Game paused while settings are open');
    }
    draft = { timeMode: settings.timeMode, customMs: settings.customMs, incSec: settings.incSec, first: settings.first };
    if (opts.custom) draft.timeMode = 'custom';
    disarmApply();
    lastFocus = document.activeElement;
    $('scrim').hidden = false;
    $('sheet').hidden = false;
    $('settingsBtn').setAttribute('aria-expanded', 'true');
    $('nameInput0').value = settings.names[0] === DEFAULTS.names[0] ? '' : settings.names[0];
    $('nameInput1').value = settings.names[1] === DEFAULTS.names[1] ? '' : settings.names[1];
    renderSheet();
    syncSheetToggles();
    $('sheet').querySelector('.sheet-body').scrollTop = 0;
    if (opts.custom) setTimeout(function () { $('customMin').focus(); }, 350);
    else if (opts.focus) setTimeout(function () { var f = $(opts.focus); if (f) { f.scrollIntoView({ block: 'center' }); f.focus({ preventScroll: true }); } }, 350);
    else $('sheetClose').focus({ preventScroll: true });
  }

  function closeSheet() {
    if ($('sheet').hidden) return;
    commitCustomInputs();
    $('scrim').hidden = true;
    $('sheet').hidden = true;
    $('settingsBtn').setAttribute('aria-expanded', 'false');
    disarmApply();
    draft = null;
    render();
    if (window.Shell) document.dispatchEvent(new CustomEvent('duelclock:settings-closed'));
    if (lastFocus && lastFocus.focus && lastFocus.offsetParent) lastFocus.focus({ preventScroll: true });
  }

  function renderSheet() {
    if (!draft) return;
    setRadio('#timeChips .chip', function (b) { return (b.dataset.min === 'custom' ? 'custom' : Number(b.dataset.min)) === draft.timeMode; });
    setRadio('#incChips .chip', function (b) { return Number(b.dataset.inc) === draft.incSec; });
    setRadio('#firstChips .chip', function (b) { return Number(b.dataset.first) === draft.first; });
    setRadio('#themeChips .theme-card', function (b) { return b.dataset.themeChoice === settings.theme; });
    $('customRow').hidden = draft.timeMode !== 'custom';
    var totalSec = Math.round(draft.customMs / 1000);
    if (document.activeElement !== $('customMin')) $('customMin').value = Math.floor(totalSec / 60);
    if (document.activeElement !== $('customSec')) $('customSec').value = totalSec % 60;
    $('customSummary').textContent = draft.timeMode === 'custom' ? shortTime(draft.customMs) : 'Set below';
    $('firstName0').textContent = nameOf(0);
    $('firstName1').textContent = nameOf(1);

    var inPlay = engine.phase === PHASE.LIVE || engine.phase === PHASE.PAUSED;
    $('applyNote').textContent = applyArmed ? 'This ends the current game. Tap again to confirm.'
      : inPlay ? 'A game is in progress. Applying starts a new one.' : '';
  }

  function setRadio(selector, test) {
    var list = document.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) {
      var on = !!test(list[i]);
      list[i].setAttribute('aria-checked', String(on));
      list[i].tabIndex = on ? 0 : -1;
    }
  }

  function syncSheetToggles() {
    $('optSound').checked = settings.sound;
    $('optHaptics').checked = settings.haptics;
    $('optTable').checked = settings.table;
    $('optAutoPause').checked = settings.autoPause;
    $('chaosDramatic').checked = settings.chaos.dramatic;
    $('chaosRoast').checked = settings.chaos.roast;
    $('chaosPanic').checked = settings.chaos.panic;
    $('chaosCouch').checked = settings.chaos.couch;
    setRadio('#takeChips .chip', function (b) { return b.dataset.take === settings.takeBack; });
    setRadio('#penChips .chip', function (b) { return Number(b.dataset.pen) === settings.penaltySec; });
    $('penRow').hidden = settings.takeBack !== 'wrong';
  }

  function readCustomInputs() {
    var m = Math.max(0, Math.min(99, parseInt($('customMin').value, 10) || 0));
    var s = Math.max(0, Math.min(59, parseInt($('customSec').value, 10) || 0));
    return (m * 60 + s) * 1000;
  }
  function commitCustomInputs() {
    if (!draft) return;
    draft.customMs = Math.max(10000, Math.min(E.ClockEngine.MAX_MS, readCustomInputs()));
  }

  function onApply() {
    commitCustomInputs();
    var inPlay = engine.phase === PHASE.LIVE || engine.phase === PHASE.PAUSED;
    if (inPlay && !applyArmed) {
      applyArmed = setTimeout(disarmApply, 3500);
      $('applyBtn').classList.add('confirm');
      $('applyBtn').textContent = 'Tap again to end this game';
      renderSheet();
      return;
    }
    settings.timeMode = draft.timeMode;
    settings.customMs = draft.customMs;
    settings.incSec = draft.incSec;
    settings.first = draft.first;
    saveSettings();
    engine.configure(gameConfigFrom(settings));
    resetLowState();
    hideVictory();
    closeSheet();
    showToast('New game · ' + describeConfig(engine.config));
    afterAction();
  }

  function disarmApply() {
    clearTimeout(applyArmed);
    applyArmed = 0;
    var b = $('applyBtn');
    b.classList.remove('confirm');
    b.textContent = 'Apply & New Game';
    if (draft) renderSheet();
  }

  function onDefaults() {
    var keepGame = engine.phase === PHASE.LIVE || engine.phase === PHASE.PAUSED;
    settings = clone(DEFAULTS);
    saveSettings();
    Sound.setEnabled(settings.sound);
    Haptics.setEnabled(settings.haptics);
    draft = { timeMode: settings.timeMode, customMs: settings.customMs, incSec: settings.incSec, first: settings.first };
    $('nameInput0').value = '';
    $('nameInput1').value = '';
    if (!keepGame) {
      engine.configure(gameConfigFrom(settings));
      resetLowState();
      showToast('Defaults restored · 5 min, no bonus');
    } else {
      showToast('Defaults restored. Tap Apply & New Game to use the default time.');
    }
    syncSheetToggles();
    renderSheet();
    render();
  }

  /* ================================================================
   * Saving the game, background handling, screen wake lock
   * ================================================================ */

  function saveGame() {
    if (engine.phase === PHASE.READY && engine.moves[0] + engine.moves[1] === 0) { storeDel(STORE_GAME); return; }
    if (engine.phase === PHASE.FINISHED) { storeDel(STORE_GAME); return; }
    storeSet(STORE_GAME, engine.snapshot());
  }

  function restoreGame() {
    var snap = storeGet(STORE_GAME);
    if (!snap) return false;
    var ok = engine.restore(snap);
    if (!ok || engine.phase !== PHASE.PAUSED) { engine.configure(gameConfigFrom(settings)); storeDel(STORE_GAME); return false; }
    return true;
  }

  function onVisibility() {
    if (document.hidden) {
      if (engine.phase === PHASE.LIVE) {
        if (settings.autoPause) {
          engine.pause();
          pausedByHide = true;
          render();
          syncLoop();
        } else {
          hiddenAt = { wall: Date.now(), mono: now() };
        }
      }
      saveGame();
      return;
    }
    // Visible again
    if (pausedByHide && engine.phase === PHASE.PAUSED) {
      showMessage('Paused while the app was in the background', 'info', 4500);
      showToast('Game paused while you were away. Tap Resume when ready.', { ms: 4000 });
    } else if (hiddenAt && engine.phase === PHASE.LIVE) {
      // If the phone froze our clock while hidden, charge the gap measured by the wall clock.
      var wallGap = Date.now() - hiddenAt.wall;
      var monoGap = now() - hiddenAt.mono;
      var missed = wallGap - monoGap;
      if (missed > 750 && missed < 12 * 3600 * 1000) {
        var r = engine.chargeMissedTime(missed);
        if (r) { hiddenAt = null; onTimeout(); return; }
      }
      if (wallGap > 1500) showToast('The clock kept running while the app was hidden', { ms: 3500 });
    }
    pausedByHide = false;
    hiddenAt = null;
    render();
    syncLoop();
    syncWakeLock();
  }

  /* Keep the screen awake during a game (handled by the shell for all modes). */
  function syncWakeLock() {
    if (window.Shell) Shell.refreshWake();
  }

  /* ================================================================
   * Offline support (service worker)
   * ================================================================ */

  function setupServiceWorker() {
    var label = $('offlineState');
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
      label.textContent = 'Offline mode needs the app to be served from a website (for example GitHub Pages).';
      return;
    }
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
        });
      });
      return navigator.serviceWorker.ready;
    }).then(function () {
      label.textContent = 'Offline ready: works without an internet connection.';
    }).catch(function () {
      label.textContent = 'Offline mode is unavailable here. It works once installed from your own site.';
    });
  }

  function offerUpdate(reg) {
    if (engine.phase === PHASE.LIVE) return; // never interrupt a running game
    showToast('A new version of ClockIt is ready.', {
      action: 'Update', sticky: true,
      onAction: function () {
        var reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (reloading) return; reloading = true; saveGame(); location.reload();
        });
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }

  /* ================================================================
   * Event wiring
   * ================================================================ */

  function bind() {
    panels.forEach(function (panel, p) {
      panel.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault(); // instant response; no focus ring flash, no text selection
        onPanel(p, e.clientX, e.clientY);
      });
      panel.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });

    primaryBtn.addEventListener('click', onPrimary);
    addBtn.addEventListener('click', onAddTime);
    resetBtn.addEventListener('click', onReset);
    soundBtn.addEventListener('click', onSoundToggle);
    $('settingsBtn').addEventListener('click', function () { Sound.unlock(); openSheet(); });
    $('sheetClose').addEventListener('click', closeSheet);
    $('scrim').addEventListener('click', closeSheet);
    $('rematchBtn').addEventListener('click', function () { rematch(false); });
    $('swapRematchBtn').addEventListener('click', function () { rematch(true); });
    $('victorySettingsBtn').addEventListener('click', function () { hideVictory(); openSheet(); });
    $('applyBtn').addEventListener('click', onApply);
    $('defaultsBtn').addEventListener('click', onDefaults);

    Array.prototype.forEach.call(document.querySelectorAll('.preset'), function (b) {
      b.addEventListener('click', function () { onPreset(b); });
    });

    // Sheet radio groups
    delegate('#timeChips', '.chip', function (b) {
      commitCustomInputs();
      draft.timeMode = b.dataset.min === 'custom' ? 'custom' : Number(b.dataset.min);
      renderSheet();
    });
    delegate('#incChips', '.chip', function (b) { draft.incSec = Number(b.dataset.inc); renderSheet(); });
    delegate('#firstChips', '.chip', function (b) { draft.first = Number(b.dataset.first); renderSheet(); });
    delegate('#themeChips', '.theme-card', function (b) {
      settings.theme = b.dataset.themeChoice;
      saveSettings(); render(); renderSheet();
    });
    ['#timeChips', '#incChips', '#firstChips', '#themeChips'].forEach(arrowKeys);

    // Custom duration
    Array.prototype.forEach.call(document.querySelectorAll('.step[data-target]'), function (b) {
      b.addEventListener('click', function () {
        var input = $(b.dataset.target);
        var max = Number(input.max), delta = Number(b.dataset.delta);
        var v = (parseInt(input.value, 10) || 0) + delta;
        if (input.id === 'customSec' || input.dataset.wrap === '60') {
          if (v > 59) v = 0; else if (v < 0) v = 55;
        }
        input.value = Math.max(0, Math.min(max, v));
        commitCustomInputs();
        renderSheet();
      });
    });
    ['customMin', 'customSec'].forEach(function (id) {
      $(id).addEventListener('change', function () { commitCustomInputs(); renderSheet(); });
      $(id).addEventListener('input', function () {
        draft.customMs = Math.max(10000, readCustomInputs());
        $('customSummary').textContent = shortTime(draft.customMs);
      });
    });

    // Names update live
    [0, 1].forEach(function (p) {
      $('nameInput' + p).addEventListener('input', function (e) {
        var v = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 14);
        settings.names[p] = v || DEFAULTS.names[p];
        saveSettings(); render(); renderSheet();
      });
    });

    // Toggles apply immediately
    toggle('optSound', function (v) { settings.sound = v; Sound.setEnabled(v); renderSound(); });
    toggle('optHaptics', function (v) { settings.haptics = v; Haptics.setEnabled(v); if (v) Haptics.tap(); });
    toggle('optTable', function (v) { settings.table = v; });
    toggle('optAutoPause', function (v) { settings.autoPause = v; });
    toggle('chaosDramatic', function (v) { settings.chaos.dramatic = v; });
    toggle('chaosRoast', function (v) { settings.chaos.roast = v; });
    toggle('chaosPanic', function (v) { settings.chaos.panic = v; if (!v) setPanic(false); });
    toggle('chaosCouch', function (v) { settings.chaos.couch = v; });
    $('takeBackBtn').addEventListener('click', onTakeBack);
    delegate('#takeChips', '.chip', function (b) { settings.takeBack = b.dataset.take; saveSettings(); syncSheetToggles(); render(); });
    delegate('#penChips', '.chip', function (b) { settings.penaltySec = Number(b.dataset.pen); saveSettings(); syncSheetToggles(); });
    ['#takeChips', '#penChips'].forEach(arrowKeys);

    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', saveGame);
    window.addEventListener('resize', function () { renderTicker(); });
    // First touch anywhere unlocks audio on iOS
    document.addEventListener('pointerdown', function () { Sound.unlock(); }, { once: true, capture: true });
  }

  function toggle(id, fn) {
    $(id).addEventListener('change', function (e) { fn(e.target.checked); saveSettings(); render(); });
  }

  function delegate(groupSel, itemSel, fn) {
    document.querySelector(groupSel).addEventListener('click', function (e) {
      var b = e.target.closest(itemSel);
      if (b) fn(b);
    });
  }

  /* Arrow keys move between options in a radio group. */
  function arrowKeys(groupSel) {
    var group = document.querySelector(groupSel);
    group.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
      var items = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
      var i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var next = items[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length];
      next.click();
      next.focus();
    });
  }

  function onKey(e) {
    var sheetOpen = !$('sheet').hidden;
    if (e.key === 'Escape') { if (sheetOpen) closeSheet(); return; }
    if (sheetOpen) { trapFocus(e); return; }
    if (window.Shell && Shell.current() !== 'duel') return;
    if (!$('modeSheet').hidden) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (!$('victory').hidden) return;

    var panelIdx = panels.indexOf(e.target);
    if ((e.key === ' ' || e.key === 'Enter') && panelIdx >= 0) {
      e.preventDefault();
      if (!e.repeat) onPanel(panelIdx);
      return;
    }
    // Space always ends the current turn during a game (like hitting a chess clock),
    // even if a control button has keyboard focus. Enter still activates buttons.
    if (e.key === ' ' && (engine.phase === PHASE.LIVE || e.target === document.body || e.target === app)) {
      e.preventDefault();
      if (!e.repeat && engine.phase === PHASE.LIVE) onPanel(engine.active);
      return;
    }
    if ((e.key === 'w' || e.key === 'W' || e.key === 'Backspace') && !e.repeat && !e.metaKey && !e.ctrlKey) {
      if (settings.takeBack !== 'off' && engine.canTakeBack()) { e.preventDefault(); onTakeBack(); }
      return;
    }
    if ((e.key === 'p' || e.key === 'P') && !e.repeat && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      onPrimary();
    }
  }

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call($('sheet').querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input'), function (x) { return x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ================================================================
   * Start up
   * ================================================================ */

  function boot() {
    $('version').textContent = APP_VERSION;
    Sound.setEnabled(settings.sound);
    Haptics.init();
    Haptics.setEnabled(settings.haptics);
    bind();
    var restored = restoreGame();
    render();
    syncLoop();
    if (restored) {
      showMessage('Game restored · tap Resume to continue', 'info', 5000);
    }
    setupServiceWorker();
    // Exposed for debugging in the browser console: DuelClock.engine.snapshot()
    window.DuelClock = {
      engine: engine,
      settings: function () { return settings; },
      version: APP_VERSION,
      toast: showToast,
      openSettings: function (focusId) { openSheet({ focus: focusId }); }
    };
    if (window.Shell) {
      Shell.register('duel', {
        enter: function () { render(); syncLoop(); },
        // Leaving Duel mid-game pauses it: a turn clock should never run unseen.
        leave: function () {
          if (engine.phase === PHASE.LIVE) {
            engine.pause();
            afterAction();
            Shell.toast('Duel paused while you use another mode');
          }
          if (!$('victory').hidden) hideVictory();
        },
        wantsWake: function () { return engine.phase === PHASE.LIVE || engine.phase === PHASE.PAUSED; },
        badge: function () {
          if (engine.phase === PHASE.LIVE) return 'Live \u00b7 ' + nameOf(engine.active) + ' to move';
          if (engine.phase === PHASE.PAUSED) return 'Paused \u00b7 game in progress';
          return '';
        }
      });
    }
  }

  boot();
})();
