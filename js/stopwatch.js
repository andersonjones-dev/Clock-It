/*
 * CLOCKIT — Stopwatch mode
 * ---------------------------------------------------------------
 * Hundredths, laps and a pace ring:
 *   - outer ring + dot sweep once a minute
 *   - inner ring fills as the current lap approaches your best lap;
 *     it turns to the warm colour once you are slower than your best
 *   - lap list with fastest/slowest, change vs previous lap, and a
 *     bar showing each lap's length
 * Anchored to the wall clock, so it keeps counting even if the app
 * is closed and reopened.
 */
(function () {
  'use strict';

  var S = window.Shell, T = window.DuelTimers, Sound = window.DuelSound, Haptics = window.DuelHaptics;
  var fmt = T.fmt;
  var KEY = 'duelclock.stopwatch.v1';
  function $(id) { return document.getElementById(id); }

  var sw = new T.Stopwatch();
  var saved = S.store.get(KEY);
  if (saved) sw.restore(saved);

  var view = $('view-stopwatch');
  var raf = 0;
  var liveRow = null;
  var lastMain = '', lastCs = '';

  function save() { S.store.set(KEY, sw.snapshot()); }
  function state() { return sw.running ? 'running' : sw.elapsed() > 0 ? 'stopped' : 'idle'; }

  /* Dial ticks: 60 marks, longer every 5 seconds. */
  (function buildTicks() {
    var html = '';
    for (var i = 0; i < 60; i++) {
      var a = i * 6 * Math.PI / 180;
      var major = i % 5 === 0;
      var r1 = major ? 91 : 93.5, r2 = 98;
      var x1 = 100 + r1 * Math.sin(a), y1 = 100 - r1 * Math.cos(a);
      var x2 = 100 + r2 * Math.sin(a), y2 = 100 - r2 * Math.cos(a);
      html += '<line class="tick' + (major ? ' major' : '') + '" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '"/>';
    }
    $('swTicks').innerHTML = html;
  })();

  /* ---------- rendering ---------- */

  function renderFrame(t) {
    var e = sw.elapsed(t);
    var f = fmt.stopwatch(e);
    if (f.main !== lastMain) { $('swMain').textContent = f.main; $('swMain').classList.toggle('long', f.main.length > 5); lastMain = f.main; }
    if (f.cs !== lastCs) { $('swCs').textContent = f.cs; lastCs = f.cs; }

    // Outer sweep: position within the current minute
    var secFrac = (e % 60000) / 60000;
    $('swSweep').style.strokeDasharray = (secFrac * 1000).toFixed(1) + ' 1000';
    $('swHand').setAttribute('transform', 'rotate(' + (secFrac * 360).toFixed(2) + ' 100 100)');

    // Inner pace ring: this lap against the best lap
    var st = sw.stats();
    var cur = sw.currentLap(t);
    var pace = $('swPace');
    var label = $('swPaceLabel');
    if (sw.laps.length) {
      var ratio = Math.min(1, cur / st.best);
      var slow = cur > st.best;
      pace.style.strokeDasharray = (ratio * 1000).toFixed(1) + ' 1000';
      pace.classList.remove('empty');
      pace.classList.toggle('slow', slow);
      label.classList.toggle('slow', slow);
      var lt = slow ? '+' + fmt.lap(cur - st.best) + ' over best' : fmt.lap(st.best - cur) + ' to beat best';
      if (label.textContent !== lt) label.textContent = lt;
    } else {
      pace.style.strokeDasharray = '0 1000';
      pace.classList.add('empty');
      if (label.textContent) label.textContent = '';
    }

    var sub;
    if (sw.laps.length) sub = 'Lap ' + (sw.laps.length + 1) + ' · ' + fmt.lap(cur);
    else sub = sw.running ? 'Running' : e > 0 ? 'Stopped' : 'Tap to start';
    var subEl = $('swSub');
    if (subEl.textContent !== sub) subEl.textContent = sub;

    if (liveRow) {
      var ms = liveRow.querySelector('.lap-ms span');
      var lv = fmt.lap(cur);
      if (ms.textContent !== lv) ms.textContent = lv;
      var tot = liveRow.querySelector('.lap-total');
      var tv = fmt.lap(e);
      if (tot.textContent !== tv) tot.textContent = tv;
    }
  }

  function render() {
    var st = state();
    view.dataset.state = st;
    var labels = { idle: ['Start', '#i-play'], running: ['Stop', '#i-pause'], stopped: ['Resume', '#i-play'] };
    $('swPrimaryLabel').textContent = labels[st][0];
    $('swPrimary').querySelector('use').setAttribute('href', labels[st][1]);
    var isReset = st === 'stopped';
    $('swLapLabel').textContent = isReset ? 'Reset' : 'Lap';
    $('swLap').querySelector('use').setAttribute('href', isReset ? '#i-reset' : '#i-flag');
    $('swLap').setAttribute('aria-label', isReset ? 'Reset stopwatch' : 'Record a lap');
    $('swLap').disabled = st === 'idle';
    $('swDial').setAttribute('aria-label', st === 'running' ? 'Stopwatch running. Tap to stop' : st === 'stopped' ? 'Stopwatch stopped at ' + fmt.stopwatch(sw.elapsed()).text + '. Tap to resume' : 'Start stopwatch');
    S.reportStatus('stopwatch', st === 'running' ? 'live' : st === 'stopped' ? 'paused' : 'ready', st === 'running' ? 'RUNNING' : st === 'stopped' ? 'STOPPED' : null);
    renderLaps();
    renderFrame(Date.now());
  }

  function renderLaps() {
    var list = $('lapList');
    var L = sw.laps;
    var st = sw.stats();
    $('lapsEmpty').hidden = L.length > 0;
    $('swCopy').disabled = L.length === 0;
    $('lapsMeta').textContent = L.length
      ? L.length + (L.length === 1 ? ' lap' : ' laps') + ' · avg ' + fmt.lap(st.avg) + (L.length > 1 ? ' · best ' + fmt.lap(st.best) : '')
      : '';
    var html = '';
    if (L.length && (sw.running || state() === 'stopped')) {
      html += row({ n: L.length + 1, ms: sw.currentLap(), total: sw.elapsed() }, 'live', '', '', 0);
    }
    for (var i = L.length - 1; i >= 0; i--) {
      var l = L[i];
      var cls = i === st.fastest ? 'fastest' : i === st.slowest ? 'slowest' : '';
      var tag = i === st.fastest ? 'FASTEST' : i === st.slowest ? 'SLOWEST' : '';
      var delta = '';
      if (i > 0) {
        var d = l.ms - L[i - 1].ms;
        delta = '<span class="lap-delta ' + (d < 0 ? 'faster' : d > 0 ? 'slower' : '') + '">' + (d < 0 ? '−' : '+') + fmt.lap(Math.abs(d)) + '</span>';
      }
      html += row(l, cls, tag, delta, st.worst ? l.ms / st.worst : 0);
    }
    list.innerHTML = html;
    liveRow = list.querySelector('.lap.live');
  }

  function row(l, cls, tag, delta, w) {
    return '<li class="lap ' + cls + '">' +
      '<span class="lap-n">' + (l.n < 10 ? '0' : '') + l.n + '</span>' +
      '<span class="lap-ms"><span>' + fmt.lap(l.ms) + '</span>' + (tag ? '<span class="lap-tag">' + tag + '</span>' : '') + '</span>' +
      (delta || '<span></span>') +
      '<span class="lap-total">' + fmt.lap(l.total) + '</span>' +
      (w ? '<span class="lap-bar" style="--w:' + Math.round(w * 100) + '%"></span>' : '') +
      '</li>';
  }

  /* ---------- loop ---------- */

  function frame() {
    raf = 0;
    renderFrame(Date.now());
    if (sw.running && S.isCurrent('stopwatch')) raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (sw.running && S.isCurrent('stopwatch')) { if (!raf) raf = requestAnimationFrame(frame); }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    render();
    S.refreshWake();
  }

  /* ---------- actions ---------- */

  function toggle() {
    Sound.unlock();
    var started = sw.toggle();
    if (started) Sound.resume(); else Sound.pause();
    Haptics.tap();
    save(); sync();
    S.announce(started ? 'Stopwatch running.' : 'Stopwatch stopped at ' + fmt.stopwatch(sw.elapsed()).text);
  }

  function lapOrReset() {
    Sound.unlock();
    if (sw.running) {
      var l = sw.lap();
      if (!l) return;
      Sound.lap(); Haptics.tap();
      S.flash($('swDial'), 'just-pressed', 300);
      save(); renderLaps();
      S.announce('Lap ' + l.n + ', ' + fmt.lap(l.ms));
    } else if (sw.elapsed() > 0) {
      var backup = sw.snapshot();
      sw.reset(); save(); sync();
      S.toast('Stopwatch reset', { action: 'Undo', onAction: function () { sw.restore(backup); save(); sync(); } });
    }
  }

  function copyLaps() {
    var lines = sw.laps.map(function (l) { return 'Lap ' + l.n + '\t' + fmt.lap(l.ms) + '\t(' + fmt.lap(l.total) + ')'; });
    lines.push('Total\t' + fmt.stopwatch(sw.elapsed()).text);
    var text = lines.join('\n');
    var done = function () { S.toast('Laps copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      S.toast(ok ? 'Laps copied' : 'Copy is not available here');
    }
  }

  $('swPrimary').addEventListener('click', toggle);
  $('swDial').addEventListener('click', toggle);
  $('swLap').addEventListener('click', lapOrReset);
  $('swCopy').addEventListener('click', copyLaps);
  window.addEventListener('pagehide', save);

  S.register('stopwatch', {
    enter: sync,
    leave: function () { if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    onKey: function (e) {
      if (e.repeat) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'l' || e.key === 'L' || e.key === 'Enter' && e.target === document.body) { e.preventDefault(); if (sw.running) lapOrReset(); }
      else if ((e.key === 'r' || e.key === 'R') && !sw.running) lapOrReset();
    },
    onVisibility: function (hidden) { if (hidden) save(); else sync(); },
    wantsWake: function () { return sw.running && S.isCurrent('stopwatch'); },
    badge: function () {
      if (sw.running) return 'Running · ' + fmt.stopwatch(sw.elapsed()).main;
      if (sw.elapsed() > 0) return 'Stopped · ' + fmt.stopwatch(sw.elapsed()).main;
      return '';
    }
  });

  render();
})();
