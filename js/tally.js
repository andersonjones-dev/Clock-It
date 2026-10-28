/*
 * CLOCKIT — Tally mode (scorekeeper for any card or board game)
 * ---------------------------------------------------------------
 *   - One tile per player: big total, last round, progress to the target.
 *   - Tap a total to add any amount on Tally's own keypad (no iPhone
 *     keyboard, so the keyboard height bug can't happen while scoring).
 *   - −1 / +1 for quick points; hold for −5 / +5.
 *   - "Add round" goes player by player through one keypad.
 *   - Rounds shows the full table; the last round can be removed.
 *   - Finish (tap twice) shows the winner and a podium.
 * Players use the same colours as Group mode, and Group's names can be
 * copied in with one tap. Scoring rules live in tally-core.js.
 */
(function () {
  'use strict';

  var S = window.Shell, C = window.TallyCore, Haptics = window.DuelHaptics;
  var KEY = 'duelclock.tally.v1';
  var GROUP_KEY = 'duelclock.group.v1';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function color(p) { return 'var(--g' + p.slot + ')'; }
  function tap() { if (Haptics && Haptics.tap) Haptics.tap(); }

  /* ---------- state ---------- */

  function groupPlayers() {
    var gp = S.store.get(GROUP_KEY);
    if (!gp || !Array.isArray(gp.names)) return null;
    var n = Math.max(2, Math.min(8, gp.count | 0 || 4));
    return gp.names.slice(0, n).map(function (name, i) {
      return { id: 'p' + i + Date.now().toString(36), name: (String(name || '').trim() || 'Player ' + (i + 1)).slice(0, 14), slot: i };
    });
  }
  function defaultPlayers() {
    return groupPlayers() || [0, 1, 2, 3].map(function (i) { return { id: 'p' + i, name: 'Player ' + (i + 1), slot: i }; });
  }

  var g = C.sanitize(S.store.get(KEY)) || C.newGame(defaultPlayers());
  var undo = [];
  var view = $('view-tally');
  var openPanel = null;     // 'entry' | 'rounds' | 'game'
  var lastFocus = null;

  function save() { S.store.set(KEY, g); }
  function remember() { undo.push(JSON.stringify(g)); if (undo.length > 50) undo.shift(); }
  function player(id) { for (var i = 0; i < g.players.length; i++) if (g.players[i].id === id) return g.players[i]; return null; }

  /* ---------- main screen ---------- */

  function ruleText() {
    var r = g.rule === 'low' ? 'Lowest wins' : 'Highest wins';
    if (g.target) r += g.rule === 'low' ? ' · out at ' + g.target : ' · to ' + g.target;
    return r;
  }

  function leadHtml() {
    var l = C.leadLine(g);
    if (l.kind === 'fresh') return '<b>New game.</b> Tap a score or Add round when the first hand ends.';
    if (l.kind === 'tie') return '<b>' + (l.count === 2 ? 'Two' : l.count) + ' players tied</b> at the top on ' + l.score + '.';
    var s = '<b>' + esc(l.name) + '</b> leads by <b>' + l.by + '</b>';
    if (l.needs != null) s += l.needs ? ' · needs ' + l.needs + ' more' : ' · reached ' + g.target;
    if (l.danger) s += ' · ' + esc(l.danger.name) + (l.danger.left ? ' is ' + l.danger.left + ' from out' : ' is out');
    return s;
  }

  function render(bumpId) {
    view.dataset.state = g.finished ? 'summary' : 'scoring';
    $('tlName').textContent = g.name;
    $('tlRule').textContent = ruleText();
    $('tlLead').innerHTML = leadHtml();

    var r = C.ranked(g), t = C.totals(g), last = C.lastRound(g);
    var place = {}; r.forEach(function (x) { place[x.p.id] = x.place; });
    var soleLeader = g.entries.length && (!r[1] || r[0].s !== r[1].s) ? r[0].p.id : null;
    var out = {}; if (g.rule === 'low') C.atTarget(g).forEach(function (p) { out[p.id] = true; });

    var grid = $('tlGrid');
    grid.dataset.n = String(g.players.length);
    grid.innerHTML = g.players.map(function (p) {
      var d = C.roundScore(g, p.id, last);
      var pct = g.target ? Math.max(0, Math.min(100, t[p.id] / g.target * 100)) : null;
      var lead = p.id === soleLeader;
      var cls = 'tl-tile' + (lead ? ' is-lead' : '') + (out[p.id] ? ' is-out' : '');
      return '<article class="' + cls + '" style="--gc:' + color(p) + '">' +
        '<div class="tl-head"><span class="gdot" aria-hidden="true"></span><span class="tl-pname">' + esc(p.name) + '</span>' +
          '<span class="tl-rank">' + (lead ? '<svg aria-label="Leader"><use href="#i-crown"/></svg>' : out[p.id] ? 'OUT' : g.entries.length ? '#' + place[p.id] : '') + '</span></div>' +
        '<button type="button" class="tl-score" data-score="' + p.id + '" aria-label="' + esc(p.name) + ', ' + t[p.id] + ' points. Add points">' + t[p.id] + '</button>' +
        '<div class="tl-meta"><span class="' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + (d === null ? 'No points yet' : (d > 0 ? '+' : '') + d + ' last round') + '</span>' +
          (pct === null ? '' : '<span>' + Math.round(pct) + '%</span>') + '</div>' +
        (pct === null ? '' : '<div class="tl-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>') +
        '<div class="tl-steps">' +
          '<button type="button" data-step="-1" data-p="' + p.id + '" aria-label="Take 1 point from ' + esc(p.name) + '">&minus;1</button>' +
          '<button type="button" data-step="1" data-p="' + p.id + '" aria-label="Give ' + esc(p.name) + ' 1 point">+1</button>' +
        '</div></article>';
    }).join('');
    if (bumpId) { var b = grid.querySelector('[data-score="' + bumpId + '"]'); if (b) S.flash(b, 'bump', 400); }

    $('tlUndo').disabled = !undo.length;
    $('tlRounds').disabled = !last;
    $('tlFinish').disabled = !g.entries.length;
    if (g.finished) renderSummary();
    report();
    save();
  }

  function report() {
    var state = g.finished ? 'finished' : 'ready';
    S.reportStatus('tally', state, g.finished ? 'FINISHED' : 'ROUND ' + g.round);
  }

  function addPoints(pid, v) {
    remember();
    g.entries.push({ pid: pid, v: v, round: g.round });
    tap();
    render(pid);
  }

  /* hold a step button for ±5 */
  var holdTimer = 0, held = null;
  function bindGrid() {
    var grid = $('tlGrid');
    grid.addEventListener('click', function (e) {
      var step = e.target.closest('[data-step]');
      if (step) {
        if (held === step) { held = null; return; }
        addPoints(step.dataset.p, +step.dataset.step);
        return;
      }
      var sc = e.target.closest('[data-score]');
      if (sc) openEntry(sc.dataset.score);
    });
    grid.addEventListener('pointerdown', function (e) {
      var step = e.target.closest('[data-step]');
      if (!step) return;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () {
        held = step;
        var v = +step.dataset.step * 5;
        addPoints(step.dataset.p, v);
        S.toast((v > 0 ? '+5' : '−5') + ' for ' + (player(step.dataset.p) || {}).name);
      }, 450);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      grid.addEventListener(ev, function () { clearTimeout(holdTimer); }, true);
    });
    // Stop the long press from opening the iOS text menu.
    grid.addEventListener('contextmenu', function (e) { if (e.target.closest('[data-step]')) e.preventDefault(); });
  }

  /* ---------- sheet (keypad, rounds, game setup) ---------- */

  function openSheet(kind, title, html) {
    if (!openPanel) lastFocus = document.activeElement;
    openPanel = kind;
    $('tlSheetTitle').textContent = title;
    $('tlSheetBody').innerHTML = html;
    $('tlSheet').dataset.kind = kind;
    $('tlScrim').hidden = false;
    $('tlSheet').hidden = false;
    $('tlSheetBody').scrollTop = 0;
  }
  function closeSheet() {
    if (!openPanel) return;
    var wasGame = openPanel === 'game';
    openPanel = null;
    entry = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    $('tlSheet').hidden = true;
    $('tlScrim').hidden = true;
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus) && lastFocus.offsetParent) lastFocus.focus({ preventScroll: true });
    if (wasGame) render(); else report();
  }

  /* --- keypad --- */
  var entry = null;   // { ids, vals, cur, single }

  function openEntry(onlyPid) {
    if (g.finished) return;
    var ids = onlyPid ? [onlyPid] : g.players.map(function (p) { return p.id; });
    entry = { ids: ids, vals: {}, cur: 0, single: !!onlyPid };
    ids.forEach(function (id) { entry.vals[id] = ''; });
    var keys = ['1', '2', '3', 'del', '4', '5', '6', 'neg', '7', '8', '9', 'next', '00', '0'];
    openSheet('entry', onlyPid ? 'Add points' : 'Round ' + g.round,
      '<div class="tl-rows" id="tlRows"></div>' +
      '<div class="tl-pad" id="tlPad">' + keys.map(function (k) {
        if (k === 'del') return '<button type="button" data-k="del" aria-label="Delete"><svg aria-hidden="true"><use href="#i-back"/></svg></button>';
        if (k === 'neg') return '<button type="button" data-k="neg" aria-label="Minus points">&plusmn;</button>';
        if (k === 'next') return '<button type="button" class="k-next" data-k="next"' + (onlyPid ? ' disabled' : '') + '>Next</button>';
        return '<button type="button" data-k="' + k + '">' + k + '</button>';
      }).join('') +
      '<button type="button" class="primary k-save" data-k="save">' + (onlyPid ? 'Add' : 'Save round') + '</button></div>' +
      (onlyPid ? '' : '<p class="setup-note">Leave a player on 0 if they scored nothing. Use &plusmn; for minus points.</p>'));
    paintRows();
  }

  function paintRows() {
    if (!entry) return;
    var t = C.totals(g);
    $('tlRows').innerHTML = entry.ids.map(function (id, i) {
      var p = player(id), v = entry.vals[id];
      var shown = v === '' ? '0' : v === '-' ? '−' : v.replace('-', '−');
      return '<button type="button" class="tl-row' + (i === entry.cur ? ' is-on' : '') + '" data-row="' + i + '" style="--gc:' + color(p) + '" aria-pressed="' + (i === entry.cur) + '">' +
        '<span class="gdot" aria-hidden="true"></span><span class="tl-pname">' + esc(p.name) + '</span>' +
        '<span class="tl-now">' + t[id] + ' now</span>' +
        '<span class="tl-val' + (v === '' || v === '-' ? ' is-empty' : '') + '">' + shown + '</span></button>';
    }).join('');
    var on = $('tlRows').querySelector('.is-on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  function key(k) {
    if (!entry) return;
    var id = entry.ids[entry.cur], v = entry.vals[id];
    tap();
    if (/^\d+$/.test(k)) {
      var digits = v.replace('-', '');
      if (digits === '0') { digits = ''; }
      if ((digits + k).length <= 5) entry.vals[id] = (v.charAt(0) === '-' ? '-' : '') + (digits + k).replace(/^0+(?=\d)/, '');
    } else if (k === 'del') entry.vals[id] = v.slice(0, -1);
    else if (k === 'neg') entry.vals[id] = v.charAt(0) === '-' ? v.slice(1) : '-' + v;
    else if (k === 'next') entry.cur = (entry.cur + 1) % entry.ids.length;
    else if (k === 'save') { saveEntry(); return; }
    paintRows();
  }

  function saveEntry() {
    var e = entry;
    var nums = {};
    var any = false;
    e.ids.forEach(function (id) { var n = parseInt(e.vals[id], 10); nums[id] = isNaN(n) ? 0 : n; if (e.vals[id] !== '' && e.vals[id] !== '-') any = true; });
    if (e.single && !any) { closeSheet(); return; }
    remember();
    e.ids.forEach(function (id) { if (!e.single || nums[id]) g.entries.push({ pid: id, v: nums[id], round: g.round }); });
    var finishedRound = g.round;
    if (!e.single) g.round += 1;
    closeSheet();
    render(e.single ? e.ids[0] : null);
    S.toast(e.single ? 'Points added' : 'Round ' + finishedRound + ' saved', { action: 'Undo', onAction: doUndo });
    checkTarget();
  }

  function checkTarget() {
    var hit = C.atTarget(g);
    if (!hit.length) return;
    var names = hit.map(function (p) { return p.name; }).join(' & ');
    if (g.rule === 'high') {
      S.announce(names + ' reached ' + g.target);
      setTimeout(function () { finish(); }, 700);
    } else {
      S.toast(names + (hit.length > 1 ? ' are' : ' is') + ' out at ' + g.target + '. Finish when you’re done.');
    }
  }

  /* --- rounds table --- */
  function openRounds() {
    var last = C.lastRound(g);
    if (!last) return;
    var t = C.totals(g);
    var head = '<tr><th scope="col">Round</th>' + g.players.map(function (p) {
      return '<th scope="col"><span class="gdot" style="--gc:' + color(p) + '" aria-hidden="true"></span>' + esc(p.name) + '</th>';
    }).join('') + '</tr>';
    var body = '';
    for (var r = 1; r <= last; r++) {
      body += '<tr><th scope="row">' + r + '</th>' + g.players.map(function (p) {
        var d = C.roundScore(g, p.id, r);
        return '<td>' + (d === null ? '–' : d) + '</td>';
      }).join('') + '</tr>';
    }
    var foot = '<tr><th scope="row">Total</th>' + g.players.map(function (p) { return '<td>' + t[p.id] + '</td>'; }).join('') + '</tr>';
    openSheet('rounds', 'Rounds',
      '<div class="tl-table"><table><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>' +
      '<div class="tl-sheet-actions">' +
        '<button type="button" class="ghost" id="tlCopy"><svg aria-hidden="true"><use href="#i-copy"/></svg>Copy scores</button>' +
        '<button type="button" class="ghost" id="tlDropRound"><svg aria-hidden="true"><use href="#i-undo"/></svg>Remove round ' + last + '</button>' +
      '</div>');
    $('tlDropRound').onclick = function () {
      remember();
      g.entries = g.entries.filter(function (e) { return e.round !== last; });
      g.round = last;
      g.finished = false;
      save(); render();
      if (C.lastRound(g)) openRounds(); else closeSheet();
      S.toast('Round ' + last + ' removed', { action: 'Undo', onAction: doUndo });
    };
    $('tlCopy').onclick = function () { copyText(scoresText()); };
  }

  function scoresText() {
    var lines = [g.name + ' (' + ruleText() + ')'];
    C.ranked(g).forEach(function (x) { lines.push(x.place + '. ' + x.p.name + ': ' + x.s); });
    lines.push('Rounds played: ' + C.lastRound(g));
    return lines.join('\n');
  }
  function copyText(text) {
    var done = function () { S.toast('Scores copied. Paste them in WhatsApp.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { S.toast('Couldn’t copy here.'); });
    } else S.toast('Couldn’t copy here.');
  }

  /* --- game setup --- */
  function openGame() {
    openSheet('game', 'Game', gameHtml());
  }
  function gameHtml() {
    var gp = groupPlayers();
    return '' +
      '<section class="group" aria-labelledby="tlGameH"><h3 id="tlGameH">Game</h3>' +
        '<div class="chips chips-3" role="radiogroup" aria-labelledby="tlGameH">' + C.PRESETS.map(function (p) {
          var on = g.preset === p.id;
          return '<button type="button" role="radio" class="chip" data-preset="' + p.id + '" aria-checked="' + on + '"><span>' + p.name + '</span><small>' +
            (p.rule === 'low' ? 'Low · out ' + p.target : p.target ? 'To ' + p.target : 'No limit') + '</small></button>';
        }).join('') + '</div>' +
        '<p class="field-label">Who wins</p>' +
        '<div class="chips chips-2" role="radiogroup" aria-label="Who wins">' +
          '<button type="button" role="radio" class="chip" data-rule="high" aria-checked="' + (g.rule === 'high') + '">Highest score</button>' +
          '<button type="button" role="radio" class="chip" data-rule="low" aria-checked="' + (g.rule === 'low') + '">Lowest score</button>' +
        '</div>' +
        '<p class="field-label">' + (g.rule === 'low' ? 'Out at' : 'Play to') + '</p>' +
        '<div class="chips chips-4" role="radiogroup" aria-label="' + (g.rule === 'low' ? 'Out at' : 'Play to') + '">' + C.TARGETS.concat(['other']).map(function (v) {
          var isOther = v === 'other', custom = g.target && C.TARGETS.indexOf(g.target) < 0;
          var on = isOther ? custom : g.target === v;
          return '<button type="button" role="radio" class="chip" data-target="' + (v === null ? '' : v) + '" aria-checked="' + on + '">' +
            (isOther ? (custom ? g.target : 'Other') : v === null ? 'None' : v) + '</button>';
        }).join('') + '</div>' +
        '<div class="tl-other" id="tlOther" hidden><input type="text" inputmode="numeric" pattern="[0-9]*" id="tlOtherIn" maxlength="5" placeholder="e.g. 300" aria-label="Target score"><button type="button" class="mini-btn" id="tlOtherSet">Set</button></div>' +
      '</section>' +
      '<section class="group" aria-labelledby="tlPlayersH"><h3 id="tlPlayersH">Players · ' + g.players.length + ' of 8</h3>' +
        '<div class="names">' + g.players.map(function (p, i) {
          return '<div class="tl-prow"><label class="name-field" style="--gc:' + color(p) + '"><span class="gdot" aria-hidden="true"></span>' +
            '<span class="sr-only">Player ' + (i + 1) + ' name</span>' +
            '<input type="text" id="tlName-' + p.id + '" data-name="' + p.id + '" value="' + esc(p.name) + '" maxlength="14" autocomplete="off" autocapitalize="words" spellcheck="false"></label>' +
            (g.players.length > 1 ? '<button type="button" class="tl-remove" data-remove="' + p.id + '" aria-label="Remove ' + esc(p.name) + '"><svg aria-hidden="true"><use href="#i-close"/></svg></button>' : '') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="tl-sheet-actions">' +
          (g.players.length < C.MAX_PLAYERS ? '<button type="button" class="ghost" id="tlAddP">+ Add player</button>' : '') +
          (gp ? '<button type="button" class="ghost" id="tlFromGroup">Use Group players</button>' : '') +
        '</div>' +
        '<p class="group-note">Removing a player also removes their points.</p>' +
      '</section>' +
      '<div class="tl-sheet-actions">' +
        '<button type="button" class="primary wide" id="tlNew"><svg aria-hidden="true"><use href="#i-reset"/></svg><span>New game, same players</span></button>' +
      '</div>';
  }

  function redrawGame(focusSel) {
    var body = $('tlSheetBody'), y = body.scrollTop;
    body.innerHTML = gameHtml();
    body.scrollTop = y;
    if (focusSel) { var f = body.querySelector(focusSel); if (f) f.focus({ preventScroll: true }); }
  }

  function bindSheet() {
    $('tlSheetBody').addEventListener('click', function (e) {
      if (openPanel === 'entry') {
        var k = e.target.closest('[data-k]'); if (k && !k.disabled) { key(k.dataset.k); return; }
        var row = e.target.closest('[data-row]'); if (row) { entry.cur = +row.dataset.row; paintRows(); }
        return;
      }
      if (openPanel !== 'game') return;
      var x;
      if ((x = e.target.closest('[data-preset]'))) {
        var p = C.PRESETS.filter(function (q) { return q.id === x.dataset.preset; })[0];
        g.preset = p.id; g.name = p.name; g.rule = p.rule; g.target = p.target;
        save(); redrawGame('[data-preset="' + p.id + '"]'); render();
      } else if ((x = e.target.closest('[data-rule]'))) {
        g.rule = x.dataset.rule; g.preset = 'custom';
        save(); redrawGame('[data-rule="' + g.rule + '"]'); render();
      } else if ((x = e.target.closest('[data-target]'))) {
        if (x.dataset.target === 'other') { $('tlOther').hidden = false; $('tlOtherIn').focus(); return; }
        g.target = x.dataset.target ? +x.dataset.target : null; g.preset = 'custom';
        save(); redrawGame('[data-target="' + x.dataset.target + '"]'); render();
      } else if (e.target.closest('#tlOtherSet')) {
        var n = parseInt($('tlOtherIn').value, 10);
        if (n > 0) { g.target = n; g.preset = 'custom'; $('tlOtherIn').blur(); save(); redrawGame(); render(); }
        else S.toast('Type a score above 0');
      } else if ((x = e.target.closest('[data-remove]'))) {
        var who = player(x.dataset.remove);
        remember();
        g.players = g.players.filter(function (q) { return q.id !== who.id; });
        g.entries = g.entries.filter(function (en) { return en.pid !== who.id; });
        save(); redrawGame(); render();
        S.toast(who.name + ' removed', { action: 'Undo', onAction: function () { doUndo(); if (openPanel === 'game') redrawGame(); } });
      } else if (e.target.closest('#tlAddP')) {
        var slot = C.freeSlot(g);
        var np = { id: 'p' + Date.now().toString(36), name: 'Player ' + (g.players.length + 1), slot: slot };
        g.players.push(np);
        save(); redrawGame(); render();
        var input = $('tlName-' + np.id); if (input) { input.focus(); input.select(); }
      } else if (e.target.closest('#tlFromGroup')) {
        var gp = groupPlayers();
        if (!gp) return;
        remember();
        g.players = gp; g.entries = []; g.round = 1; g.finished = false;
        save(); redrawGame(); render();
        S.toast('Players copied from Group. Scores cleared.', { action: 'Undo', onAction: function () { doUndo(); if (openPanel === 'game') redrawGame(); } });
      } else if (e.target.closest('#tlNew')) {
        newGameSamePlayers();
        closeSheet();
      }
    });
    $('tlSheetBody').addEventListener('input', function (e) {
      var id = e.target.dataset && e.target.dataset.name;
      if (!id) return;
      var p = player(id); if (p) { p.name = e.target.value.trim().slice(0, 14) || 'Player'; save(); }
    });
    $('tlSheetBody').addEventListener('keydown', function (e) {
      if (e.target.id === 'tlOtherIn' && e.key === 'Enter') { e.preventDefault(); $('tlOtherSet').click(); }
      else if (e.target.dataset && e.target.dataset.name && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    $('tlSheetClose').addEventListener('click', closeSheet);
    $('tlScrim').addEventListener('click', closeSheet);
  }

  function newGameSamePlayers() {
    remember();
    g.entries = []; g.round = 1; g.finished = false;
    render();
    S.toast('New game. Everyone is back on 0.', { action: 'Undo', onAction: doUndo });
  }

  /* ---------- finish ---------- */

  function finish() {
    if (!g.entries.length) return;
    // No separate undo step: Undo (or the toast's Undo) goes back to before
    // the last score, and "Keep playing" reopens the game as it was.
    g.finished = true;
    render();
    if (window.DuelSound && DuelSound.fanfare) DuelSound.fanfare(0);
  }

  function renderSummary() {
    var r = C.ranked(g);
    var top = r.filter(function (x) { return x.place === 1; });
    $('tlWinTitle').textContent = g.name + ' · ' + (top.length > 1 ? 'Joint winners' : 'Winner');
    $('tlWinName').textContent = top.map(function (x) { return x.p.name; }).join(' & ');
    $('tlWinName').style.setProperty('--gc', color(top[0].p));
    $('tlSummary').style.setProperty('--gc', color(top[0].p));
    $('tlWinMeta').textContent = C.lastRound(g) + (C.lastRound(g) === 1 ? ' round' : ' rounds') + ' · ' + ruleText();
    var podium = [r[1], r[0], r[2]].filter(Boolean);
    $('tlPodium').innerHTML = podium.map(function (x) {
      return '<div class="tl-pod place-' + Math.min(x.place, 3) + '" style="--gc:' + color(x.p) + '"><small>#' + x.place + '</small><b>' + esc(x.p.name) + '</b><span>' + x.s + '</span></div>';
    }).join('');
    $('tlRest').innerHTML = r.slice(3).map(function (x) {
      return '<li style="--gc:' + color(x.p) + '"><span>#' + x.place + '</span><span class="gdot" aria-hidden="true"></span><b>' + esc(x.p.name) + '</b><span class="tl-rest-s">' + x.s + '</span></li>';
    }).join('');
    $('tlRest').hidden = r.length <= 3;
  }

  function doUndo() {
    if (!undo.length) return;
    var back = C.sanitize(JSON.parse(undo.pop()));
    if (back) g = back;
    render();
  }

  /* ---------- wiring ---------- */

  function bind() {
    bindGrid();
    bindSheet();
    $('tlGameBtn').addEventListener('click', openGame);
    $('tlAdd').addEventListener('click', function () { openEntry(null); });
    $('tlRounds').addEventListener('click', openRounds);
    $('tlUndo').addEventListener('click', function () { doUndo(); S.toast('Undone'); });
    $('tlFinish').addEventListener('click', function () {
      var btn = this;
      S.confirmTap(btn, 'Sure?', finish);
    });
    $('tlAgain').addEventListener('click', newGameSamePlayers);
    $('tlBack').addEventListener('click', function () { remember(); g.finished = false; render(); });
    $('tlShare').addEventListener('click', function () { copyText(scoresText()); });
  }

  S.register('tally', {
    enter: function () { render(); },
    leave: function () { closeSheet(); },
    wantsWake: function () { return S.isCurrent('tally') && g.entries.length > 0 && !g.finished; },
    badge: function () {
      if (!g.entries.length) return '';
      if (g.finished) return 'FINISHED';
      var l = C.leadLine(g);
      return 'R' + g.round + (l.kind === 'lead' ? ' · ' + l.name : '');
    },
    onKey: function (e) {
      if (e.key === 'Escape') { if (openPanel) { e.preventDefault(); closeSheet(); } return; }
      if (openPanel === 'entry') {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); key(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); key('del'); }
        else if (e.key === '-') { e.preventDefault(); key('neg'); }
        else if (e.key === 'Tab' || e.key === 'ArrowDown') { e.preventDefault(); key('next'); }
        else if (e.key === 'Enter') { e.preventDefault(); key('save'); }
        return;
      }
      if (openPanel) return;
      if (e.key === ' ' && !g.finished) { e.preventDefault(); openEntry(null); }
      else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); doUndo(); }
    }
  });

  bind();
  render();
})();
