/*
 * CLOCKIT — Group mode (turn timer for 2–8 players)
 * ---------------------------------------------------------------
 *   Turn limit: every turn gets the same time, reset each turn.
 *   Time bank:  each player has a total for the whole game.
 * The phone sits in the middle of the table. The big card shows whose
 * turn it is; tap it to pass to the next player. Tap any player tile
 * to give them the turn out of order. Undo fixes a mistaken pass.
 * Running out of time goes into red overtime rather than knocking
 * anyone out. "Finish" shows who used the most time.
 */
(function () {
  'use strict';

  var S = window.Shell, T = window.DuelTimers, Sound = window.DuelSound, Haptics = window.DuelHaptics;
  var fmt = T.fmt;
  var KEY = 'duelclock.group.v1';
  function $(id) { return document.getElementById(id); }

  var TURN_TIMES = [15, 30, 45, 60, 90, 120, 180, 300];
  var BANK_TIMES = [180, 300, 600, 900, 1200, 1800, 2700, 3600];
  var DEFAULT_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6', 'Player 7', 'Player 8'];

  var prefs = Object.assign({ count: 4, names: DEFAULT_NAMES.slice(), mode: 'turn', turnSec: 60, bankSec: 600 }, S.store.get(KEY) || {});
  if (!Array.isArray(prefs.names) || prefs.names.length !== 8) prefs.names = DEFAULT_NAMES.slice();
  prefs.count = Math.max(2, Math.min(8, prefs.count | 0 || 4));

  var g = new T.GroupClock({ config: gameConfig() });
  var summaryOpen = false;
  if (prefs.game && g.restore(prefs.game)) { /* game restored (paused) */ }

  var view = $('view-group');
  var raf = 0;
  var warned = { t10: false, zero: false };

  function gameConfig() {
    return {
      names: prefs.names.slice(0, prefs.count).map(function (n, i) { return (n || '').trim() || DEFAULT_NAMES[i]; }),
      mode: prefs.mode,
      limitMs: (prefs.mode === 'bank' ? prefs.bankSec : prefs.turnSec) * 1000
    };
  }
  function save() {
    prefs.game = g.state === 'ready' ? null : g.snapshot();
    S.store.set(KEY, prefs);
  }
  function nameOf(i) { return g.config.names[i]; }
  function color(i) { return 'var(--g' + i + ')'; }
  function state() { return summaryOpen ? 'summary' : g.state; }
  function shortLabel(sec) { return sec < 60 ? sec + 's' : sec % 60 ? Math.floor(sec / 60) + ':' + fmt.pad(sec % 60) : (sec / 60) + 'm'; }
  function timeText(ms) { return ms < 0 ? fmt.overtime(-ms) : fmt.countdown(ms); }

  /* ---------- setup ---------- */

  function renderSetup() {
    $('gpCount').textContent = prefs.count;
    $('gpLess').disabled = prefs.count <= 2;
    $('gpMore').disabled = prefs.count >= 8;

    var list = $('gpNames');
    if (list.childElementCount !== prefs.count) {
      var html = '';
      for (var i = 0; i < prefs.count; i++) {
        var v = prefs.names[i] === DEFAULT_NAMES[i] ? '' : prefs.names[i];
        html += '<li><label class="gp-name" style="--gc:' + color(i) + '"><span class="gdot" aria-hidden="true"></span>' +
          '<span class="sr-only">Player ' + (i + 1) + ' name</span>' +
          '<input type="text" id="gpName' + i + '" data-i="' + i + '" maxlength="14" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="' + DEFAULT_NAMES[i] + '" value="' + escapeAttr(v) + '"></label></li>';
      }
      list.innerHTML = html;
    }

    Array.prototype.forEach.call(document.querySelectorAll('#gpStyle .chip'), function (b) {
      var on = b.dataset.style === prefs.mode;
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
    });
    $('gpTimeLabel').textContent = prefs.mode === 'bank' ? 'Time bank per player' : 'Time per turn';
    var times = prefs.mode === 'bank' ? BANK_TIMES : TURN_TIMES;
    var cur = prefs.mode === 'bank' ? prefs.bankSec : prefs.turnSec;
    var host = $('gpTimes');
    var key = prefs.mode + cur;
    if (host.dataset.key !== key) {
      host.dataset.key = key;
      host.innerHTML = times.map(function (s) {
        return '<button type="button" role="radio" class="chip" data-sec="' + s + '" aria-checked="' + (s === cur) + '" tabindex="' + (s === cur ? 0 : -1) + '">' + shortLabel(s) + '</button>';
      }).join('');
    }
  }

  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------- live ---------- */

  function buildTiles() {
    var host = $('gpTiles');
    var n = g.n;
    host.style.setProperty('--cols', n <= 4 ? n : Math.ceil(n / 2));
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<button type="button" class="gp-tile" data-i="' + i + '" style="--gc:' + color(i) + '">' +
        '<span class="gp-tile-name"><span class="gdot" aria-hidden="true"></span><span>' + escapeHtml(nameOf(i)) + '</span></span>' +
        '<span class="gp-tile-val">0:00</span><span class="gp-tile-meta"></span></button>';
    }
    host.innerHTML = html;
    host.dataset.n = String(n);
  }

  function renderLive(t) {
    var a = g.active, n = g.n;
    var rem = g.remaining(a, t);
    var hero = $('gpHero');
    hero.style.setProperty('--gc', color(a));
    hero.classList.toggle('is-over', rem < 0 && g.state === 'running');
    hero.classList.toggle('is-paused', g.state === 'paused');
    $('gpHeroName').textContent = nameOf(a);
    var badge = g.state === 'paused' ? 'PAUSED' : rem < 0 ? 'OVERTIME' : 'ROUND ' + g.round();
    $('gpHeroBadge').textContent = badge;
    var tt = timeText(rem);
    var timeEl = $('gpHeroTime');
    if (timeEl.textContent !== tt) timeEl.textContent = tt;
    var limit = g.config.mode === 'turn' ? g.config.limitMs : g.config.limitMs;
    $('gpHeroBar').style.transform = 'scaleX(' + Math.max(0, Math.min(1, rem / limit)).toFixed(4) + ')';
    $('gpHeroHint').textContent = g.state === 'paused' ? 'Tap Resume to continue' : 'Tap when done · next: ' + nameOf(g.next());
    hero.setAttribute('aria-label', nameOf(a) + '’s turn, ' + (rem < 0 ? 'overtime ' + fmt.overtime(-rem) : fmt.countdown(rem) + ' left') + '. Tap to pass to ' + nameOf(g.next()));

    var host = $('gpTiles');
    if (host.dataset.n !== String(n)) buildTiles();
    for (var i = 0; i < n; i++) {
      var tile = host.children[i];
      tile.classList.toggle('is-active', i === a);
      tile.classList.toggle('is-next', i === g.next() && i !== a);
      var val = tile.querySelector('.gp-tile-val');
      var meta = tile.querySelector('.gp-tile-meta');
      var v, over = false;
      if (g.config.mode === 'bank') { var r = g.remaining(i, t); v = timeText(r); over = r < 0; }
      else v = fmt.countdown(g.usedOf(i, t));
      if (val.textContent !== v) val.textContent = v;
      val.classList.toggle('over', over);
      var turns = g.turns[i];
      var m = i === a ? 'NOW' : i === g.next() ? 'NEXT' : turns + (turns === 1 ? ' TURN' : ' TURNS');
      if (g.config.mode === 'turn' && i !== a && i !== g.next()) m = turns + (turns === 1 ? ' turn' : ' turns') + ' · used';
      if (meta.textContent !== m) meta.textContent = m;
      tile.setAttribute('aria-label', nameOf(i) + ', ' + (g.config.mode === 'bank' ? v + ' left' : v + ' used') + ', ' + turns + ' turns' + (i === a ? ', playing now' : '. Tap to give them the turn'));
    }

    // Sounds at 10 s left and at zero (once per turn)
    if (g.state === 'running') {
      if (!warned.t10 && rem <= 10000 && rem > 0) { warned.t10 = true; Sound.beep(false); }
      if (!warned.zero && rem <= 0) { warned.zero = true; Sound.timeout(); Haptics.tap(true); S.announce(nameOf(a) + ' is in overtime.'); }
    }
  }

  function renderSummary() {
    var t = Date.now();
    var rows = g.summary(t);
    var max = rows.length ? Math.max(1, rows[0].used) : 1;
    var withTurns = rows.filter(function (r) { return r.turns > 0; });
    var slow = withTurns.length > 1 ? withTurns.reduce(function (a, b) { return b.avg > a.avg ? b : a; }) : null;
    var fast = withTurns.length > 1 ? withTurns.reduce(function (a, b) { return b.avg < a.avg ? b : a; }) : null;
    var total = rows.reduce(function (s, r) { return s + r.used; }, 0);
    $('gpSumMeta').textContent = g.totalTurns() + ' turns · ' + fmt.countdown(total) + ' of play';
    $('gpSumList').innerHTML = rows.map(function (r) {
      var tag = slow && r.i === slow.i ? 'DEEP THINKER' : fast && r.i === fast.i ? 'QUICK DRAW' : '';
      return '<li class="gp-sum-row" style="--gc:' + color(r.i) + '">' +
        '<span class="gp-sum-name"><span class="gdot" aria-hidden="true"></span><span>' + escapeHtml(r.name) + '</span></span>' +
        '<span class="gp-sum-total">' + fmt.countdown(r.used) + '</span>' +
        '<span class="gp-sum-bar" aria-hidden="true"><i style="--w:' + Math.round(r.used / max * 100) + '%"></i></span>' +
        '<span class="gp-sum-detail"><span>' + r.turns + (r.turns === 1 ? ' turn' : ' turns') + (r.turns ? ' · ' + fmt.countdown(r.avg) + ' per turn' : '') + '</span>' +
        (tag ? '<span class="gp-sum-tag">' + tag + '</span>' : '') + '</span></li>';
    }).join('');
  }

  function render(t) {
    if (t === undefined) t = Date.now();
    var st = state();
    view.dataset.state = st;
    $('gpSetup').hidden = st !== 'ready';
    $('gpLive').hidden = st !== 'running' && st !== 'paused';
    $('gpSummary').hidden = st !== 'summary';
    if (st === 'ready') renderSetup();
    else if (st === 'summary') { /* rendered once on open */ }
    else renderLive(t);

    var labels = { ready: ['Start Game', '#i-play'], running: ['Pause', '#i-pause'], paused: ['Resume', '#i-play'], summary: ['', '#i-play'] };
    $('gpPrimaryLabel').textContent = labels[st][0];
    $('gpPrimary').querySelector('use').setAttribute('href', labels[st][1]);
    $('gpUndo').disabled = !g.history.length;
    S.reportStatus('group', st === 'ready' ? 'ready' : st === 'running' ? 'live' : st === 'paused' ? 'paused' : 'finished', null);
  }

  /* ---------- loop ---------- */

  function frame() {
    raf = 0;
    renderLive(Date.now());
    if (g.state === 'running' && S.isCurrent('group')) raf = requestAnimationFrame(frame);
  }
  function sync() {
    if (g.state === 'running' && S.isCurrent('group') && !summaryOpen) { if (!raf) raf = requestAnimationFrame(frame); }
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    render();
    S.refreshWake();
  }
  function resetWarnings() {
    var rem = g.remaining(g.active);
    warned = { t10: rem <= 10000, zero: rem <= 0 };
  }

  /* ---------- actions ---------- */

  function primary() {
    Sound.unlock();
    if (g.state === 'ready') {
      g.configure(gameConfig());
      g.start();
      buildTiles();
      resetWarnings();
      Sound.start();
      S.announce('Game started. ' + nameOf(g.active) + ' goes first.');
    } else if (g.state === 'running') { g.pause(); Sound.pause(); }
    else { g.start(); Sound.resume(); }
    Haptics.tap();
    save(); sync();
  }

  function pass(to) {
    Sound.unlock();
    if (g.state === 'paused') { S.toast('Paused · tap Resume first'); S.flash($('gpPrimary'), 'bump'); return; }
    var r = g.pass(Date.now(), to);
    if (r.result !== 'passed') return;
    resetWarnings();
    Sound.chime(r.to);
    Haptics.tap();
    if (!S.reducedMotion()) S.flash($('gpHero'), 'just-activated', 450);
    S.announce(nameOf(r.to) + '’s turn.');
    save(); render();
  }

  function undo() {
    var r = g.undo(Date.now());
    if (!r) return;
    resetWarnings();
    Haptics.tap();
    S.toast('Turn handed back to ' + nameOf(r.to));
    save(); sync();
  }

  function finish() {
    S.confirmTap($('gpFinish'), 'Sure?', function () {
      if (g.state === 'running') g.pause();
      summaryOpen = true;
      renderSummary();
      Sound.fanfare(0);
      save(); sync();
      $('gpRematch').focus({ preventScroll: true });
    });
  }

  function newGame(edit) {
    summaryOpen = false;
    g.configure(gameConfig());
    save(); sync();
    if (!edit) primaryFocus();
  }
  function primaryFocus() { $('gpPrimary').focus({ preventScroll: true }); }

  /* ---------- wiring ---------- */

  $('gpPrimary').addEventListener('click', primary);
  $('gpHero').addEventListener('click', function () { pass(); });
  $('gpUndo').addEventListener('click', undo);
  $('gpFinish').addEventListener('click', finish);
  $('gpRematch').addEventListener('click', function () { newGame(false); });
  $('gpEdit').addEventListener('click', function () { newGame(true); });
  $('gpTiles').addEventListener('click', function (e) {
    var tile = e.target.closest('.gp-tile'); if (!tile) return;
    var i = Number(tile.dataset.i);
    if (i !== g.active) pass(i);
  });
  $('gpLess').addEventListener('click', function () { prefs.count = Math.max(2, prefs.count - 1); g.configure(gameConfig()); save(); render(); });
  $('gpMore').addEventListener('click', function () { prefs.count = Math.min(8, prefs.count + 1); g.configure(gameConfig()); save(); render(); });
  $('gpNames').addEventListener('input', function (e) {
    var i = Number(e.target.dataset.i);
    var v = e.target.value.replace(/\s+/g, ' ').slice(0, 14);
    prefs.names[i] = v.trim() || DEFAULT_NAMES[i];
    g.configure(gameConfig()); save();
  });
  $('gpStyle').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    prefs.mode = b.dataset.style; g.configure(gameConfig()); save(); render();
  });
  $('gpTimes').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    if (prefs.mode === 'bank') prefs.bankSec = Number(b.dataset.sec); else prefs.turnSec = Number(b.dataset.sec);
    g.configure(gameConfig()); save(); render();
  });
  window.addEventListener('pagehide', save);

  S.register('group', {
    enter: sync,
    // A turn timer should never run unseen: switching modes pauses it.
    leave: function () {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (g.state === 'running') { g.pause(); save(); render(); S.toast('Group game paused'); }
    },
    onKey: function (e) {
      if (e.repeat) return;
      if (e.key === ' ') { e.preventDefault(); if (g.state === 'running') pass(); else if (g.state !== 'ready' || document.activeElement === document.body) primary(); }
      else if (e.key === 'p' || e.key === 'P') primary();
      else if (e.key === 'u' || e.key === 'U' || e.key === 'Backspace') { if (g.state !== 'ready') undo(); }
    },
    onVisibility: function (hidden) {
      if (hidden && g.state === 'running' && S.prefs().autoPause !== false) {
        g.pause(); save(); render();
        S.toast('Group game paused while you were away');
      }
      if (hidden) save(); else sync();
    },
    wantsWake: function () { return g.state === 'running' || g.state === 'paused'; },
    badge: function () {
      if (summaryOpen) return 'Finished';
      if (g.state === 'running') return nameOf(g.active) + '’s turn · ' + timeText(g.remaining(g.active));
      if (g.state === 'paused') return 'Paused · game in progress';
      return '';
    }
  });

  if (g.state !== 'ready') buildTiles();
  render();
})();
