/*
 * CLOCKIT — Tally scoring logic (no screen code, so it can be tested)
 * ---------------------------------------------------------------
 * A game is a list of players and a list of score entries.
 * Every entry is { pid, v, round }: player id, points (can be
 * negative) and the round it belongs to. Totals, ranks and the
 * round table are all worked out from the entries, so Undo and
 * "remove a round" can never leave the totals out of step.
 */
(function (root) {
  'use strict';

  var PRESETS = [
    { id: 'uno',      name: 'Uno',        rule: 'high', target: 500 },
    { id: 'rummy',    name: 'Rummy',      rule: 'low',  target: 101 },
    { id: 'carrom',   name: 'Carrom',     rule: 'high', target: 29 },
    { id: 'scrabble', name: 'Scrabble',   rule: 'high', target: null },
    { id: 'custom',   name: 'Game night', rule: 'high', target: null }
  ];
  var TARGETS = [null, 21, 29, 101, 150, 250, 500];
  var MAX_PLAYERS = 8;

  function newGame(players, base) {
    var p = base || PRESETS[4];
    return {
      v: 1,
      preset: p.preset || p.id,
      name: p.name,
      rule: p.rule,
      target: p.target,
      players: players,
      entries: [],
      round: 1,
      finished: false
    };
  }

  // Clean up whatever was saved, so a damaged save can't break the screen.
  function sanitize(g) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.players) || !Array.isArray(g.entries)) return null;
    var ids = {};
    var players = g.players.filter(function (p) {
      if (!p || typeof p.id !== 'string' || ids[p.id]) return false;
      ids[p.id] = true; return true;
    }).slice(0, MAX_PLAYERS).map(function (p, i) {
      return { id: p.id, name: String(p.name || 'Player ' + (i + 1)).slice(0, 14), slot: (p.slot | 0) >= 0 && (p.slot | 0) < MAX_PLAYERS ? p.slot | 0 : i };
    });
    if (players.length < 1) return null;
    var entries = g.entries.filter(function (e) {
      return e && ids[e.pid] && typeof e.v === 'number' && isFinite(e.v) && (e.round | 0) >= 1;
    }).map(function (e) { return { pid: e.pid, v: Math.round(e.v), round: e.round | 0 }; });
    return {
      v: 1,
      preset: typeof g.preset === 'string' ? g.preset : 'custom',
      name: String(g.name || 'Game night').slice(0, 24),
      rule: g.rule === 'low' ? 'low' : 'high',
      target: typeof g.target === 'number' && g.target > 0 ? Math.round(g.target) : null,
      players: players,
      entries: entries,
      round: Math.max(1, g.round | 0, lastRound(entries) + 1),
      finished: !!g.finished
    };
  }

  function totals(g) {
    var t = {};
    g.players.forEach(function (p) { t[p.id] = 0; });
    g.entries.forEach(function (e) { if (e.pid in t) t[e.pid] += e.v; });
    return t;
  }

  // Points a player got in one round, or null if they have nothing in it.
  function roundScore(g, pid, round) {
    var d = 0, any = false;
    g.entries.forEach(function (e) { if (e.pid === pid && e.round === round) { d += e.v; any = true; } });
    return any ? d : null;
  }

  function lastRound(entries) {
    var m = 0;
    entries.forEach(function (e) { if (e.round > m) m = e.round; });
    return m;
  }

  // Best first. Equal scores share a place (1, 1, 3).
  function ranked(g) {
    var t = totals(g);
    var list = g.players.map(function (p, i) { return { p: p, s: t[p.id], i: i }; });
    list.sort(function (a, b) {
      var d = g.rule === 'low' ? a.s - b.s : b.s - a.s;
      return d || a.i - b.i;
    });
    var place = 0, prev = null;
    list.forEach(function (x, i) { if (x.s !== prev) { place = i + 1; prev = x.s; } x.place = place; });
    return list;
  }

  // Players at or past the target. With "highest wins" they have won;
  // with "lowest wins" they are out.
  function atTarget(g) {
    if (!g.target) return [];
    var t = totals(g);
    return g.players.filter(function (p) { return t[p.id] >= g.target; });
  }

  // One line for the strip above the scores.
  function leadLine(g) {
    if (!g.entries.length) return { kind: 'fresh' };
    var r = ranked(g);
    var a = r[0], b = r[1];
    if (b && a.s === b.s) {
      var tied = r.filter(function (x) { return x.s === a.s; });
      return { kind: 'tie', score: a.s, count: tied.length };
    }
    var out = { kind: 'lead', name: a.p.name, by: b ? Math.abs(a.s - b.s) : 0 };
    if (g.target && g.rule === 'high') out.needs = Math.max(0, g.target - a.s);
    if (g.target && g.rule === 'low') {
      var worst = r[r.length - 1];
      out.danger = { name: worst.p.name, left: Math.max(0, g.target - worst.s) };
    }
    return out;
  }

  function freeSlot(g) {
    var used = g.players.map(function (p) { return p.slot; });
    for (var i = 0; i < MAX_PLAYERS; i++) if (used.indexOf(i) < 0) return i;
    return 0;
  }

  var api = {
    PRESETS: PRESETS, TARGETS: TARGETS, MAX_PLAYERS: MAX_PLAYERS,
    newGame: newGame, sanitize: sanitize, totals: totals, roundScore: roundScore,
    lastRound: function (g) { return lastRound(g.entries); },
    ranked: ranked, atTarget: atTarget, leadLine: leadLine, freeSlot: freeSlot
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TallyCore = api;
})(typeof self !== 'undefined' ? self : this);
