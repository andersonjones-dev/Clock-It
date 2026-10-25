/*
 * CLOCKIT — Showtime mode
 * ---------------------------------------------------------------
 * A big, graphic countdown for quizzes and game shows.
 *   - segmented ring that drains, turning amber then red
 *   - final five-second beeps, buzzer and "TIME'S UP!" at zero
 *   - question counter and a one-tap "Next" for the next question
 *   - Stage view: the ring fills the screen (good for AirPlay to a TV)
 * Keeps running when you switch modes; anchored to the wall clock.
 */
(function () {
  'use strict';

  var S = window.Shell, T = window.DuelTimers, Sound = window.DuelSound, Haptics = window.DuelHaptics;
  var fmt = T.fmt;
  var KEY = 'duelclock.showtime.v1';
  function $(id) { return document.getElementById(id); }

  var prefs = Object.assign({
    durationMs: 30000, customMs: 40000, round: 1, word: 'QUESTION',
    beeps: true, buzzer: true, tick: false, autoNext: false
  }, S.store.get(KEY) || {});
  var cd = new T.Countdown({ durationMs: prefs.durationMs });
  if (prefs.cd) cd.restore(prefs.cd);

  var view = $('view-showtime');
  var segsHost = $('stSegs');
  var numEl = $('stNum');
  var raf = 0, flagTimer = 0;
  var segs = [], builtFor = 0, lastLit = -1;
  var lastSec = -1;

  function save() {
    prefs.durationMs = cd.duration;
    prefs.cd = cd.snapshot();
    S.store.set(KEY, prefs);
  }

  /* ---------- ring ---------- */

  var CX = 110, CY = 110, R = 96;
  function pt(deg, r) {
    var a = (deg - 90) * Math.PI / 180;
    return (CX + r * Math.cos(a)).toFixed(2) + ' ' + (CY + r * Math.sin(a)).toFixed(2);
  }
  function arc(a0, a1) {
    return 'M' + pt(a0, R) + ' A' + R + ' ' + R + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + pt(a1, R);
  }

  /* One segment per second (up to 60), so short quiz timers read like a dial of lights. */
  function buildRing(totalMs) {
    var n = Math.max(1, Math.min(60, Math.ceil(totalMs / 1000)));
    if (n === builtFor) return;
    builtFor = n;
    var step = 360 / n;
    var gap = n <= 12 ? 3.5 : step * 0.24;
    var track = '', lit = '';
    for (var i = 0; i < n; i++) {
      var a0 = i * step + gap / 2, a1 = (i + 1) * step - gap / 2;
      var p = (i + 0.5) / n;
      var tone = p <= 0.2 ? 'hot' : p <= 0.45 ? 'warn' : 'go';
      var d = arc(a0, a1);
      track += '<path class="seg seg-track" d="' + d + '"/>';
      lit += '<path class="seg ' + tone + '" d="' + d + '"/>';
    }
    segsHost.innerHTML = '<g>' + track + '</g><g id="stLit">' + lit + '</g>';
    segs = segsHost.querySelectorAll('#stLit .seg');
    lastLit = -1;
  }

  function paintRing(frac) {
    var n = segs.length;
    var lit = frac * n;
    var key = Math.round(lit * 50);
    if (key === lastLit) return;
    lastLit = key;
    var whole = Math.floor(lit), part = lit - whole;
    for (var i = 0; i < n; i++) {
      var o = i < whole ? 1 : i === whole ? part : 0;
      segs[i].style.opacity = o === 1 ? '' : String(Math.round(o * 100) / 100);
    }
  }

  /* ---------- render ---------- */

  function stateOf() { return cd.state; }

  function render(t) {
    if (t === undefined) t = Date.now();
    var st = stateOf();
    var rem = cd.remaining(t);
    var frac = cd.fraction(t);
    buildRing(cd.total);
    paintRing(st === 'idle' ? 1 : frac);

    view.dataset.state = st;
    var tone = st === 'done' ? 'hot' : (rem <= 5000 || frac <= 0.2) ? 'hot' : frac <= 0.45 ? 'warn' : 'go';
    if (st === 'idle') tone = 'go';
    view.dataset.tone = tone;
    view.classList.toggle('is-final', st === 'running' && rem <= 5000 && rem > 0);

    var secs = Math.ceil(rem / 1000);
    var text = secs < 60 ? String(secs) : fmt.countdown(rem);
    if (numEl.textContent !== text) numEl.textContent = text;
    numEl.classList.toggle('long', text.length >= 4 && text.length < 7);
    numEl.classList.toggle('xlong', text.length >= 7);
    $('stUnit').textContent = secs < 60 ? (secs === 1 ? 'SECOND' : 'SECONDS') : 'MIN : SEC';
    $('stKicker').textContent = { idle: 'READY', running: 'GO', paused: 'PAUSED', done: '' }[st];

    $('stRound').textContent = prefs.round;
    $('stRoundWord').textContent = prefs.word;
    $('stRoundDown').disabled = prefs.round <= 1;

    var labels = { idle: ['Start', '#i-play'], running: ['Pause', '#i-pause'], paused: ['Resume', '#i-play'], done: ['Next ' + wordCase(), '#i-next'] };
    $('stPrimaryLabel').textContent = labels[st][0];
    $('stPrimary').querySelector('use').setAttribute('href', labels[st][1]);
    $('stAdd').disabled = st === 'idle';
    $('stReset').disabled = st === 'idle';
    $('stRing').setAttribute('aria-label', st === 'running' ? 'Countdown running, ' + secs + ' seconds left. Tap to pause'
      : st === 'paused' ? 'Paused at ' + secs + ' seconds. Tap to resume'
      : st === 'done' ? 'Time is up. Tap for the next ' + wordCase().toLowerCase()
      : 'Countdown ready, ' + fmt.label(cd.duration) + '. Tap to start');

    // presets
    var match = false;
    Array.prototype.forEach.call(document.querySelectorAll('#stPresets .preset'), function (b) {
      var on = b.dataset.sec !== 'custom' && Number(b.dataset.sec) * 1000 === cd.duration;
      if (on) match = true;
      b.setAttribute('aria-pressed', String(on));
    });
    var cb = document.querySelector('#stPresets [data-sec="custom"]');
    cb.setAttribute('aria-pressed', String(!match));
    $('stCustomB').textContent = match ? '···' : fmt.label(cd.duration).replace(' min', 'm');

    S.reportStatus('showtime', st === 'idle' ? 'ready' : st === 'running' ? 'live' : st === 'paused' ? 'paused' : 'finished', st === 'done' ? 'TIME’S UP' : null);
  }

  function wordCase() { return prefs.word.charAt(0) + prefs.word.slice(1).toLowerCase(); }

  /* ---------- loop ---------- */

  function frame() {
    raf = 0;
    var t = Date.now();
    if (cd.tick(t)) { onDone(false); return; }
    var rem = cd.remaining(t);
    var sec = Math.ceil(rem / 1000);
    if (sec !== lastSec && cd.state === 'running') {
      if (lastSec !== -1 && sec < lastSec) onSecond(sec);
      lastSec = sec;
    }
    render(t);
    if (cd.state === 'running' && S.isCurrent('showtime')) raf = requestAnimationFrame(frame);
  }

  function onSecond(sec) {
    if (sec <= 5 && sec >= 1) {
      if (prefs.beeps) Sound.beep(false);
      if (!S.reducedMotion()) S.flash(numEl, 'pulse', 900);
    } else if (prefs.tick) {
      Sound.tick();
    }
  }

  /* Keeps one frame loop alive while visible, plus a timer that fires exactly at zero. */
  function sync() {
    if (cd.state === 'running' && S.isCurrent('showtime')) { if (!raf) raf = requestAnimationFrame(frame); }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    clearTimeout(flagTimer);
    if (cd.state === 'running') {
      flagTimer = setTimeout(function () { if (cd.tick()) onDone(false); else sync(); }, Math.max(20, cd.remaining() + 10));
    }
    lastSec = cd.state === 'running' ? Math.ceil(cd.remaining() / 1000) : -1;
    render();
    S.refreshWake();
  }

  function onDone(late) {
    save();
    sync();
    if (!late) {
      if (prefs.buzzer) Sound.buzzer(); else if (prefs.beeps) Sound.beep(true);
      Haptics.tap(true);
      if (!S.reducedMotion()) S.flash(view, 'flashing', 1400);
    }
    S.announce('Time is up.');
    if (!late && !S.isCurrent('showtime')) S.toast('Showtime: time’s up!');
  }

  /* ---------- actions ---------- */

  function primary() {
    Sound.unlock();
    var st = cd.state;
    if (st === 'done') { next(); return; }
    if (st === 'idle') { cd.start(); Sound.start(); Haptics.tap(); S.announce('Countdown started.'); }
    else if (st === 'running') { cd.pause(); Sound.pause(); Haptics.tap(); }
    else { cd.start(); Sound.resume(); Haptics.tap(); }
    save(); sync();
  }

  function next() {
    Sound.unlock();
    prefs.round += 1;
    cd.reset();
    if (prefs.autoNext) { cd.start(); Sound.start(); }
    Haptics.tap();
    save(); sync();
    S.announce(wordCase() + ' ' + prefs.round + (prefs.autoNext ? '. Countdown started.' : '. Ready.'));
  }

  function reset() { cd.reset(); save(); sync(); }

  function add() {
    Sound.unlock();
    if (cd.add(10000) > 0) {
      Sound.addTime(); Haptics.tap();
      S.toast('+10 seconds');
      save(); sync();
    }
  }

  function setDuration(ms) {
    cd.set(ms);
    save(); sync();
  }

  function stage(on) {
    var app = $('app');
    on = on === undefined ? !app.classList.contains('stage-on') : on;
    app.classList.toggle('stage-on', on);
    if (on) {
      var el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
      S.announce('Stage view. Tap the countdown to start or pause.');
    } else if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }

  /* ---------- settings (in the shared settings sheet) ---------- */

  function syncSettings() {
    var s = Math.round(prefs.customMs / 1000);
    $('stMin').value = Math.floor(s / 60);
    $('stSec').value = s % 60;
    $('stOptBeeps').checked = prefs.beeps;
    $('stOptBuzzer').checked = prefs.buzzer;
    $('stOptTick').checked = prefs.tick;
    $('stOptAuto').checked = prefs.autoNext;
    Array.prototype.forEach.call(document.querySelectorAll('#stWordChips .chip'), function (b) {
      var on = b.dataset.word === prefs.word;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  function bind() {
    $('stPrimary').addEventListener('click', primary);
    $('stRing').addEventListener('click', primary);
    $('stNext').addEventListener('click', next);
    $('stAdd').addEventListener('click', add);
    $('stReset').addEventListener('click', reset);
    $('stRoundUp').addEventListener('click', function () { prefs.round = Math.min(999, prefs.round + 1); save(); render(); });
    $('stRoundDown').addEventListener('click', function () { prefs.round = Math.max(1, prefs.round - 1); save(); render(); });
    $('stStageBtn').addEventListener('click', function () { stage(true); });
    $('stStageExit').addEventListener('click', function () { stage(false); });
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && $('app').classList.contains('stage-on') && S.isCurrent('showtime')) { /* keep stage; user can exit with X */ }
    });

    Array.prototype.forEach.call(document.querySelectorAll('#stPresets .preset'), function (b) {
      b.addEventListener('click', function () {
        Sound.unlock();
        if (b.dataset.sec === 'custom') { syncSettings(); S.openSettings('stMin'); return; }
        setDuration(Number(b.dataset.sec) * 1000);
        Haptics.tap();
      });
    });

    $('settingsBtn').addEventListener('click', function () { if (S.isCurrent('showtime')) syncSettings(); });
    $('stApplyCustom').addEventListener('click', function () {
      var m = Math.max(0, Math.min(99, parseInt($('stMin').value, 10) || 0));
      var s = Math.max(0, Math.min(59, parseInt($('stSec').value, 10) || 0));
      var ms = Math.max(1000, (m * 60 + s) * 1000);
      prefs.customMs = ms;
      setDuration(ms);
      document.getElementById('sheetClose').click();
      S.toast('Countdown set to ' + fmt.label(ms));
    });
    document.querySelector('#stWordChips').addEventListener('click', function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      prefs.word = b.dataset.word; save(); syncSettings(); render();
    });
    [['stOptBeeps', 'beeps'], ['stOptBuzzer', 'buzzer'], ['stOptTick', 'tick'], ['stOptAuto', 'autoNext']].forEach(function (p) {
      $(p[0]).addEventListener('change', function (e) { prefs[p[1]] = e.target.checked; save(); });
    });
  }

  S.register('showtime', {
    enter: function () {
      // A countdown that ran out while we were away: show it, no late buzzer.
      if (cd.tick()) onDone(true);
      sync();
    },
    leave: function () {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      stage(false);
    },
    onKey: function (e) {
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Enter' && e.target === document.body) { e.preventDefault(); primary(); }
      else if (e.key === 'n' || e.key === 'N') next();
      else if (e.key === 'r' || e.key === 'R') reset();
      else if (e.key === '+' || e.key === '=') add();
      else if (e.key === 'f' || e.key === 'F') stage();
      else if (e.key === 'Escape') stage(false);
    },
    onVisibility: function (hidden) {
      if (hidden) { save(); return; }
      var wasRunning = cd.state === 'running';
      if (cd.tick()) {
        onDone(true);
        if (wasRunning) S.toast('Time ran out while ClockIt was in the background');
      }
      sync();
    },
    wantsWake: function () { return cd.state === 'running' || (S.isCurrent('showtime') && cd.state === 'paused'); },
    badge: function () {
      if (cd.tick()) onDone(true);
      if (cd.state === 'running') return 'Live · ' + fmt.countdown(cd.remaining()) + ' left';
      if (cd.state === 'paused') return 'Paused · ' + fmt.countdown(cd.remaining());
      if (cd.state === 'done') return 'Time’s up';
      return '';
    }
  });

  bind();
  window.addEventListener('pagehide', save);
  render();
  sync();
})();
