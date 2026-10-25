/*
 * CLOCKIT — engines for Stopwatch, Showtime and Group
 * ---------------------------------------------------------------
 * Same idea as engine.js: pure logic, no screen code, easy to test.
 *
 * Stopwatch and Countdown are anchored to the wall clock
 * (Date.now). Time is always worked out from "when did it start",
 * never by counting ticks, so a running stopwatch or countdown
 * is still correct after the app is closed and reopened.
 *
 * GroupClock (a turn timer) pauses itself when the app is hidden,
 * like Duel, so it simply uses the same approach.
 */
(function (root) {
  'use strict';

  var MAX_MS = (99 * 60 + 59) * 1000;
  function wall() { return Date.now(); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function filled(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }

  /* ================================================================
   * Stopwatch with laps
   * ================================================================ */
  function Stopwatch(o) { o = o || {}; this.now = o.now || wall; this.reset(); }
  Stopwatch.MAX_LAPS = 999;

  Stopwatch.prototype.reset = function () {
    this.running = false;
    this.base = 0;      // time accumulated before the current run
    this.startAt = 0;   // wall time the current run began
    this.laps = [];     // { n, ms (lap length), total (split) }
  };
  Stopwatch.prototype.elapsed = function (t) {
    if (t === undefined) t = this.now();
    return Math.max(0, this.base + (this.running ? t - this.startAt : 0));
  };
  Stopwatch.prototype.start = function (t) {
    if (t === undefined) t = this.now();
    if (this.running) return false;
    this.running = true; this.startAt = t; return true;
  };
  Stopwatch.prototype.stop = function (t) {
    if (t === undefined) t = this.now();
    if (!this.running) return false;
    this.base = this.elapsed(t); this.running = false; return true;
  };
  Stopwatch.prototype.toggle = function (t) { return this.running ? (this.stop(t), false) : (this.start(t), true); };
  Stopwatch.prototype.lastTotal = function () { return this.laps.length ? this.laps[this.laps.length - 1].total : 0; };
  Stopwatch.prototype.currentLap = function (t) { return Math.max(0, this.elapsed(t) - this.lastTotal()); };

  /* Record a lap. Ignores taps less than 50 ms apart (accidental double tap). */
  Stopwatch.prototype.lap = function (t) {
    if (t === undefined) t = this.now();
    if (!this.running || this.laps.length >= Stopwatch.MAX_LAPS) return null;
    var total = this.elapsed(t);
    var ms = total - this.lastTotal();
    if (ms < 50) return null;
    var l = { n: this.laps.length + 1, ms: ms, total: total };
    this.laps.push(l);
    return l;
  };

  /* Fastest/slowest are only marked once there are two or more laps. */
  Stopwatch.prototype.stats = function () {
    var L = this.laps;
    if (!L.length) return { fastest: -1, slowest: -1, avg: 0, best: 0, worst: 0 };
    var f = 0, s = 0, sum = 0;
    for (var i = 0; i < L.length; i++) {
      sum += L[i].ms;
      if (L[i].ms < L[f].ms) f = i;
      if (L[i].ms > L[s].ms) s = i;
    }
    return { fastest: L.length > 1 ? f : -1, slowest: L.length > 1 ? s : -1, avg: sum / L.length, best: L[f].ms, worst: L[s].ms };
  };

  Stopwatch.prototype.snapshot = function () {
    return { v: 1, running: this.running, base: this.base, startAt: this.startAt, laps: this.laps.slice() };
  };
  Stopwatch.prototype.restore = function (s) {
    if (!s || s.v !== 1 || !Array.isArray(s.laps)) return false;
    this.running = !!s.running;
    this.base = Math.max(0, num(s.base, 0));
    this.startAt = num(s.startAt, this.now());
    this.laps = s.laps.filter(function (l) { return l && l.ms > 0 && l.total > 0; }).slice(0, Stopwatch.MAX_LAPS);
    return true;
  };

  /* ================================================================
   * Countdown (Showtime)
   * States: idle → running ⇄ paused → done
   * ================================================================ */
  function Countdown(o) { o = o || {}; this.now = o.now || wall; this.set(o.durationMs || 30000); }

  Countdown.prototype.set = function (ms) {
    this.duration = clamp(Math.round(num(ms, 30000)), 1000, MAX_MS);
    this.reset();
  };
  Countdown.prototype.reset = function () {
    this.state = 'idle';
    this.left = this.duration;   // time left as of startAt
    this.total = this.duration;  // grows when time is added (keeps the ring honest)
    this.startAt = 0;
    this.doneAt = 0;             // wall time the countdown reached zero
  };
  Countdown.prototype.remaining = function (t) {
    if (t === undefined) t = this.now();
    if (this.state === 'running') return Math.max(0, this.left - (t - this.startAt));
    if (this.state === 'done') return 0;
    return this.left;
  };
  Countdown.prototype.fraction = function (t) { return this.total ? this.remaining(t) / this.total : 0; };
  Countdown.prototype.start = function (t) {
    if (t === undefined) t = this.now();
    if (this.state !== 'idle' && this.state !== 'paused') return false;
    this.state = 'running'; this.startAt = t; return true;
  };
  Countdown.prototype.pause = function (t) {
    if (t === undefined) t = this.now();
    if (this.state !== 'running') return false;
    if (this.tick(t)) return false;
    this.left = this.remaining(t); this.state = 'paused'; return true;
  };
  Countdown.prototype.toggle = function (t) {
    if (this.state === 'running') this.pause(t); else this.start(t);
    return this.state;
  };
  /* Returns true at the moment the countdown reaches zero. */
  Countdown.prototype.tick = function (t) {
    if (t === undefined) t = this.now();
    if (this.state === 'running' && this.left - (t - this.startAt) <= 0) {
      this.doneAt = this.startAt + this.left;
      this.left = 0;
      this.state = 'done';
      return true;
    }
    return false;
  };
  /* Add time. After time's up, adding time starts a fresh mini-countdown. */
  Countdown.prototype.add = function (ms, t) {
    if (t === undefined) t = this.now();
    ms = Math.max(0, Math.round(num(ms, 0)));
    if (this.state === 'idle') return 0;
    if (this.state === 'done') {
      this.state = 'running'; this.left = ms; this.total = ms; this.startAt = t; this.doneAt = 0;
      return ms;
    }
    if (this.tick(t)) return this.add(ms, t);
    var room = MAX_MS - this.remaining(t);
    ms = Math.min(ms, room);
    this.left += ms;
    this.total = Math.max(this.total + ms, this.remaining(t));
    return ms;
  };
  Countdown.prototype.snapshot = function () {
    return { v: 1, duration: this.duration, state: this.state, left: this.left, total: this.total, startAt: this.startAt, doneAt: this.doneAt };
  };
  Countdown.prototype.restore = function (s) {
    if (!s || s.v !== 1) return false;
    this.set(s.duration);
    if (['idle', 'running', 'paused', 'done'].indexOf(s.state) < 0) return false;
    this.state = s.state;
    this.left = clamp(num(s.left, this.duration), 0, MAX_MS);
    this.total = Math.max(this.left, clamp(num(s.total, this.duration), 1000, MAX_MS));
    this.startAt = num(s.startAt, 0);
    this.doneAt = num(s.doneAt, 0);
    return true;
  };

  /* ================================================================
   * GroupClock: turn timer for 2–8 players.
   *   mode 'turn': every turn gets the same limit, reset each turn.
   *   mode 'bank': each player has a time bank for the whole game.
   * Running past zero is allowed: the clock goes into overtime
   * (negative remaining) so the game is never interrupted.
   * ================================================================ */
  function GroupClock(o) {
    o = o || {};
    this.now = o.now || wall;
    this.debounceMs = o.debounceMs == null ? 250 : o.debounceMs;
    this.configure(o.config || {});
  }
  GroupClock.MIN_PLAYERS = 2;
  GroupClock.MAX_PLAYERS = 8;

  GroupClock.prototype.configure = function (c) {
    var names = Array.isArray(c.names) ? c.names.slice(0, 8) : ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
    while (names.length < 2) names.push('Player ' + (names.length + 1));
    this.config = {
      names: names.map(function (n, i) { return String(n || ('Player ' + (i + 1))); }),
      mode: c.mode === 'bank' ? 'bank' : 'turn',
      limitMs: clamp(Math.round(num(c.limitMs, 60000)), 5000, MAX_MS),
      first: clamp(num(c.first, 0) | 0, 0, names.length - 1)
    };
    this.reset();
  };
  GroupClock.prototype.reset = function () {
    var n = this.config.names.length;
    this.n = n;
    this.state = 'ready';
    this.active = this.config.first;
    this.bank = filled(n, this.config.limitMs);
    this.used = filled(n, 0);
    this.turns = filled(n, 0);
    this.turnBase = 0;
    this.startAt = 0;
    this.history = [];
    this.lastPassAt = -Infinity;
  };
  GroupClock.prototype.turnElapsed = function (t) {
    if (t === undefined) t = this.now();
    return this.turnBase + (this.state === 'running' ? Math.max(0, t - this.startAt) : 0);
  };
  /* Remaining time (negative = overtime). */
  GroupClock.prototype.remaining = function (i, t) {
    var te = i === this.active && this.state !== 'ready' ? this.turnElapsed(t) : 0;
    if (this.config.mode === 'turn') return this.config.limitMs - (i === this.active ? te : 0);
    return this.bank[i] - te;
  };
  GroupClock.prototype.usedOf = function (i, t) {
    return this.used[i] + (i === this.active && this.state !== 'ready' ? this.turnElapsed(t) : 0);
  };
  GroupClock.prototype.next = function (i) { return ((i === undefined ? this.active : i) + 1) % this.n; };
  GroupClock.prototype.totalTurns = function () { return this.turns.reduce(function (a, b) { return a + b; }, 0); };
  GroupClock.prototype.round = function () { return Math.floor(this.totalTurns() / this.n) + 1; };

  GroupClock.prototype.start = function (t) {
    if (t === undefined) t = this.now();
    if (this.state !== 'ready' && this.state !== 'paused') return false;
    this.state = 'running'; this.startAt = t; return true;
  };
  GroupClock.prototype.pause = function (t) {
    if (t === undefined) t = this.now();
    if (this.state !== 'running') return false;
    this.turnBase = this.turnElapsed(t); this.state = 'paused'; return true;
  };
  GroupClock.prototype.toggle = function (t) {
    if (this.state === 'running') this.pause(t); else this.start(t);
    return this.state;
  };
  /* End the active player's turn. `to` jumps to a specific player. */
  GroupClock.prototype.pass = function (t, to) {
    if (t === undefined) t = this.now();
    if (this.state !== 'running') return { result: 'not-running' };
    if (t - this.lastPassAt < this.debounceMs) return { result: 'debounced' };
    if (to == null) to = this.next();
    if (to < 0 || to >= this.n) return { result: 'invalid' };
    if (to === this.active) return { result: 'same' };
    var a = this.active, te = this.turnElapsed(t);
    this.history.push({ active: a, bank: this.bank.slice(), used: this.used.slice(), turns: this.turns.slice(), turnBase: te });
    if (this.history.length > 50) this.history.shift();
    this.used[a] += te;
    if (this.config.mode === 'bank') this.bank[a] -= te;
    this.turns[a] += 1;
    this.active = to;
    this.turnBase = 0;
    this.startAt = t;
    this.lastPassAt = t;
    return { result: 'passed', from: a, to: to, turnMs: te };
  };
  /*
   * Undo the last pass. The time the wrong player's clock ran is
   * handed back to the player who passed by mistake, because they
   * were really still thinking.
   */
  GroupClock.prototype.undo = function (t) {
    if (t === undefined) t = this.now();
    if (!this.history.length || this.state === 'ready') return null;
    var wrongly = this.turnElapsed(t);
    var h = this.history.pop();
    var from = this.active;
    this.active = h.active;
    this.bank = h.bank; this.used = h.used; this.turns = h.turns;
    this.turnBase = h.turnBase + wrongly;
    if (this.state === 'running') this.startAt = t;
    this.lastPassAt = -Infinity;
    return { from: from, to: this.active };
  };
  /* Ranking for the end-of-game summary, most time used first. */
  GroupClock.prototype.summary = function (t) {
    var out = [];
    for (var i = 0; i < this.n; i++) {
      var used = this.usedOf(i, t);
      var turns = this.turns[i] + (i === this.active && this.turnElapsed(t) > 0 ? 1 : 0);
      out.push({ i: i, name: this.config.names[i], used: used, turns: turns, avg: turns ? used / turns : 0 });
    }
    return out.sort(function (a, b) { return b.used - a.used; });
  };
  GroupClock.prototype.snapshot = function (t) {
    return {
      v: 1, config: JSON.parse(JSON.stringify(this.config)), state: this.state, active: this.active,
      bank: this.bank.slice(), used: this.used.slice(), turns: this.turns.slice(), turnBase: this.turnElapsed(t)
    };
  };
  /* A running game comes back paused, like Duel. */
  GroupClock.prototype.restore = function (s) {
    if (!s || s.v !== 1 || !s.config) return false;
    this.configure(s.config);
    if (['ready', 'running', 'paused'].indexOf(s.state) < 0) return false;
    if (!Array.isArray(s.bank) || s.bank.length !== this.n) return false;
    this.state = s.state === 'running' ? 'paused' : s.state;
    this.active = clamp(num(s.active, 0) | 0, 0, this.n - 1);
    this.bank = s.bank.map(function (v) { return num(v, 0); });
    this.used = (s.used || []).map(function (v) { return Math.max(0, num(v, 0)); });
    this.turns = (s.turns || []).map(function (v) { return Math.max(0, num(v, 0) | 0); });
    if (this.used.length !== this.n) this.used = filled(this.n, 0);
    if (this.turns.length !== this.n) this.turns = filled(this.n, 0);
    this.turnBase = Math.max(0, num(s.turnBase, 0));
    return true;
  };

  /* ================================================================
   * Formatting helpers shared by the modes
   * ================================================================ */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Countdowns round UP: a 30 s timer shows 30 at the start and 1 in its last second. */
  function countdown(ms) {
    var s = Math.ceil(Math.max(0, ms) / 1000);
    if (s >= 3600) return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }
  /* Overtime counts up: "+0:07". */
  function overtime(ms) {
    var s = Math.floor(Math.max(0, ms) / 1000);
    return '+' + Math.floor(s / 60) + ':' + pad(s % 60);
  }
  /* Stopwatch: rounds DOWN, with hundredths. */
  function stopwatch(ms) {
    ms = Math.max(0, ms);
    var cs = Math.floor(ms / 10) % 100;
    var s = Math.floor(ms / 1000);
    var main = s >= 3600
      ? Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60)
      : pad(Math.floor(s / 60)) + ':' + pad(s % 60);
    return { main: main, cs: '.' + pad(cs), text: main + '.' + pad(cs) };
  }
  /* Compact lap time: "12.34" under a minute, "1:02.34" above. */
  function lap(ms) {
    ms = Math.max(0, ms);
    var cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000);
    if (s < 60) return s + '.' + pad(cs);
    if (s < 3600) return Math.floor(s / 60) + ':' + pad(s % 60) + '.' + pad(cs);
    return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }
  /* "20s", "3 min", "1:30" for labels. */
  function label(ms) {
    var s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    if (s % 60 === 0) return (s / 60) + ' min';
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }

  var api = {
    Stopwatch: Stopwatch, Countdown: Countdown, GroupClock: GroupClock, MAX_MS: MAX_MS,
    fmt: { countdown: countdown, overtime: overtime, stopwatch: stopwatch, lap: lap, label: label, pad: pad }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuelTimers = api;
})(typeof self !== 'undefined' ? self : this);
