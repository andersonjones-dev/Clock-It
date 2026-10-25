/*
 * CLOCKIT — timer engine
 * ---------------------------------------------------------------
 * The single source of truth for the game. It knows nothing about
 * the screen: the UI asks it questions ("how much time does player
 * 1 have right now?") and tells it what happened ("player 0 pressed
 * their clock"). Keeping it separate makes it easy to test.
 *
 * How time is measured
 *   The engine never counts down by subtracting "1 second" on each
 *   timer tick. Instead it remembers WHEN the current turn segment
 *   started (using a monotonic clock, performance.now()) and works
 *   out the remaining time from the real elapsed time. If the phone
 *   is slow or a frame is skipped, the clock is still correct.
 *
 * Players are numbered 0 (Player 1) and 1 (Player 2).
 */
(function (root) {
  'use strict';

  var PHASE = Object.freeze({
    READY: 'ready',       // set up, waiting for "Start Battle"
    LIVE: 'live',         // a clock is running
    PAUSED: 'paused',     // both clocks frozen
    FINISHED: 'finished'  // someone ran out of time
  });

  var MAX_MS = (99 * 60 + 59) * 1000; // 99:59 — the display limit
  var MIN_INITIAL_MS = 5 * 1000;      // shortest allowed game
  var DEBOUNCE_MS = 200;              // ignore a second tap this soon after a switch

  function defaultNow() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function other(p) { return p === 0 ? 1 : 0; }

  function sanitizeConfig(c) {
    c = c || {};
    var initial = Math.round(Number(c.initialMs));
    if (!isFinite(initial)) initial = 5 * 60 * 1000;
    var inc = Math.round(Number(c.incrementMs));
    if (!isFinite(inc)) inc = 0;
    return {
      initialMs: clamp(initial, MIN_INITIAL_MS, MAX_MS),
      incrementMs: clamp(inc, 0, 60 * 1000),
      firstPlayer: c.firstPlayer === 1 ? 1 : 0
    };
  }

  function ClockEngine(options) {
    options = options || {};
    this.now = typeof options.now === 'function' ? options.now : defaultNow;
    this.debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs : DEBOUNCE_MS;
    this.configure(options.config);
  }

  ClockEngine.PHASE = PHASE;
  ClockEngine.MAX_MS = MAX_MS;
  ClockEngine.MIN_INITIAL_MS = MIN_INITIAL_MS;

  ClockEngine.prototype.configure = function (config) {
    this.config = sanitizeConfig(config);
    this.reset();
  };

  /* Back to the start: same settings, full clocks, first player to move. */
  ClockEngine.prototype.reset = function () {
    var c = this.config;
    this.phase = PHASE.READY;
    this.active = c.firstPlayer;
    this.remaining = [c.initialMs, c.initialMs]; // committed time (excludes the running segment)
    this.segmentStart = 0;   // monotonic time the running segment began
    this.turnSpentMs = 0;    // time used in the current turn before the latest pause
    this.lastSwitchAt = -Infinity;
    this.moves = [0, 0];
    this.thinkMs = [0, 0];
    this.longestMs = [0, 0];
    this.winner = null;
    this.loser = null;
    return this.snapshot();
  };

  /* ---------- reading the clocks ---------- */

  /* Time used in the running segment (0 unless LIVE). */
  ClockEngine.prototype._segmentElapsed = function (t) {
    if (this.phase !== PHASE.LIVE) return 0;
    return Math.max(0, t - this.segmentStart);
  };

  /* Remaining time for a player right now, never below zero. */
  ClockEngine.prototype.remainingOf = function (player, t) {
    if (t === undefined) t = this.now();
    var r = this.remaining[player];
    if (player === this.active) r -= this._segmentElapsed(t);
    return Math.max(0, r);
  };

  /* How long the active player has spent on this turn so far. */
  ClockEngine.prototype.currentTurnMs = function (t) {
    if (t === undefined) t = this.now();
    return this.turnSpentMs + this._segmentElapsed(t);
  };

  /* Milliseconds until the active flag falls (Infinity if not running). */
  ClockEngine.prototype.msUntilFlag = function (t) {
    if (this.phase !== PHASE.LIVE) return Infinity;
    return this.remainingOf(this.active, t);
  };

  /* Fold the running segment into the committed numbers. */
  ClockEngine.prototype._commit = function (t) {
    if (this.phase !== PHASE.LIVE) return;
    var e = this._segmentElapsed(t);
    this.remaining[this.active] = Math.max(0, this.remaining[this.active] - e);
    this.turnSpentMs += e;
    this.thinkMs[this.active] += e;
    this.segmentStart = t;
  };

  ClockEngine.prototype._finishByTimeout = function (t) {
    this._commit(t);
    this.remaining[this.active] = 0;
    this.longestMs[this.active] = Math.max(this.longestMs[this.active], this.turnSpentMs);
    this.phase = PHASE.FINISHED;
    this.loser = this.active;
    this.winner = other(this.active);
    return { result: 'timeout', winner: this.winner, loser: this.loser };
  };

  /* Call regularly while LIVE. Ends the game when a clock hits zero. */
  ClockEngine.prototype.tick = function (t) {
    if (t === undefined) t = this.now();
    if (this.phase === PHASE.LIVE && this.remainingOf(this.active, t) <= 0) {
      return this._finishByTimeout(t);
    }
    return null;
  };

  /* ---------- actions ---------- */

  ClockEngine.prototype.start = function (t) {
    if (t === undefined) t = this.now();
    if (this.phase === PHASE.READY || this.phase === PHASE.PAUSED) {
      this.phase = PHASE.LIVE;
      this.segmentStart = t;
      return true;
    }
    return false;
  };

  ClockEngine.prototype.pause = function (t) {
    if (t === undefined) t = this.now();
    if (this.phase !== PHASE.LIVE) return false;
    if (this.remainingOf(this.active, t) <= 0) { this._finishByTimeout(t); return false; }
    this._commit(t);
    this.phase = PHASE.PAUSED;
    return true;
  };

  /* Start / pause / resume in one. Returns the new phase. */
  ClockEngine.prototype.toggle = function (t) {
    if (t === undefined) t = this.now();
    if (this.phase === PHASE.LIVE) this.pause(t);
    else this.start(t);
    return this.phase;
  };

  /*
   * A player pressed their side of the screen.
   * Only the ACTIVE player's press does anything: it ends their turn,
   * adds the increment to them, and starts the opponent's clock.
   */
  ClockEngine.prototype.press = function (player, t) {
    if (t === undefined) t = this.now();
    if (player !== 0 && player !== 1) return { result: 'invalid' };
    if (this.phase !== PHASE.LIVE) return { result: 'not-live', phase: this.phase };
    if (player !== this.active) return { result: 'not-your-turn', active: this.active };
    if (t - this.lastSwitchAt < this.debounceMs) return { result: 'debounced' };

    // Did the flag fall before the press landed? Then the press is too late.
    if (this.remainingOf(player, t) <= 0) return this._finishByTimeout(t);

    this._commit(t);
    var moveMs = this.turnSpentMs;
    var inc = this.config.incrementMs;
    this.remaining[player] = Math.min(MAX_MS, this.remaining[player] + inc);
    this.moves[player] += 1;
    this.longestMs[player] = Math.max(this.longestMs[player], moveMs);

    this.active = other(player);
    this.turnSpentMs = 0;
    this.segmentStart = t;
    this.lastSwitchAt = t;
    return { result: 'switched', from: player, to: this.active, moveMs: moveMs, incrementMs: inc, move: this.moves[player] };
  };

  /* Give the active player extra time (the "+5s" button). */
  ClockEngine.prototype.addTime = function (ms, t) {
    if (t === undefined) t = this.now();
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.PAUSED) return 0;
    if (this.phase === PHASE.LIVE && this.remainingOf(this.active, t) <= 0) { this._finishByTimeout(t); return 0; }
    ms = Math.max(0, Math.round(Number(ms) || 0));
    var before = this.remainingOf(this.active, t);
    var target = Math.min(MAX_MS, before + ms);
    var added = target - before;
    this.remaining[this.active] += added;
    return added;
  };

  /*
   * The browser suspended us without the monotonic clock advancing
   * (this can happen on iOS). The UI measured the gap with the wall
   * clock and reports it here so the active player is charged for it.
   */
  ClockEngine.prototype.chargeMissedTime = function (ms, t) {
    if (t === undefined) t = this.now();
    if (this.phase !== PHASE.LIVE || !(ms > 0)) return null;
    this.segmentStart -= ms;
    return this.tick(t);
  };

  /* ---------- saving & restoring ---------- */

  ClockEngine.prototype.snapshot = function (t) {
    if (t === undefined) t = this.now();
    return {
      v: 1,
      config: Object.assign({}, this.config),
      phase: this.phase,
      active: this.active,
      remaining: [this.remainingOf(0, t), this.remainingOf(1, t)],
      turnMs: this.currentTurnMs(t),
      moves: this.moves.slice(),
      thinkMs: [this.thinkMs[0] + (this.active === 0 ? this._segmentElapsed(t) : 0),
                this.thinkMs[1] + (this.active === 1 ? this._segmentElapsed(t) : 0)],
      longestMs: this.longestMs.slice(),
      winner: this.winner,
      loser: this.loser
    };
  };

  /*
   * Restore a saved game. A game that was running when it was saved
   * comes back PAUSED — we cannot honestly know how long the page was
   * closed, so the players decide when to continue.
   * Returns true if a game was restored.
   */
  ClockEngine.prototype.restore = function (s) {
    if (!s || s.v !== 1 || !s.config || !Array.isArray(s.remaining)) return false;
    this.configure(s.config);
    var phase = s.phase === PHASE.LIVE ? PHASE.PAUSED : s.phase;
    if ([PHASE.READY, PHASE.PAUSED, PHASE.FINISHED].indexOf(phase) < 0) return false;
    this.phase = phase;
    this.active = s.active === 1 ? 1 : 0;
    this.remaining = [clamp(Number(s.remaining[0]) || 0, 0, MAX_MS), clamp(Number(s.remaining[1]) || 0, 0, MAX_MS)];
    this.turnSpentMs = Math.max(0, Number(s.turnMs) || 0);
    this.moves = Array.isArray(s.moves) ? [s.moves[0] | 0, s.moves[1] | 0] : [0, 0];
    this.thinkMs = Array.isArray(s.thinkMs) ? [Number(s.thinkMs[0]) || 0, Number(s.thinkMs[1]) || 0] : [0, 0];
    this.longestMs = Array.isArray(s.longestMs) ? [Number(s.longestMs[0]) || 0, Number(s.longestMs[1]) || 0] : [0, 0];
    this.winner = s.winner === 0 || s.winner === 1 ? s.winner : null;
    this.loser = s.loser === 0 || s.loser === 1 ? s.loser : null;
    if (phase === PHASE.FINISHED && this.winner === null) { this.reset(); return false; }
    return true;
  };

  /* ---------- formatting ---------- */

  /*
   * Display format: MM:SS. Under 10 seconds a tenths digit is added
   * so the final moments are readable, like a tournament clock.
   * Seconds are rounded down, so "00:00" only shows at true zero
   * (or in the last tenth, where the tenths digit tells the story).
   */
  function formatTime(ms) {
    ms = Math.max(0, Math.min(MAX_MS, ms));
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    var mm = (m < 10 ? '0' : '') + m;
    var ss = (s < 10 ? '0' : '') + s;
    var tenths = ms < 10000 ? String(Math.floor((ms % 1000) / 100)) : '';
    return { mm: mm, ss: ss, tenths: tenths, text: mm + ':' + ss + (tenths ? '.' + tenths : '') };
  }

  /* "4 minutes 32 seconds" for screen readers. */
  function speakTime(ms) {
    var totalSec = Math.ceil(Math.max(0, ms) / 1000);
    var m = Math.floor(totalSec / 60), s = totalSec % 60;
    var parts = [];
    if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
    if (s || !m) parts.push(s + (s === 1 ? ' second' : ' seconds'));
    return parts.join(' ');
  }

  var api = { ClockEngine: ClockEngine, PHASE: PHASE, formatTime: formatTime, speakTime: speakTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DuelEngine = api;
})(typeof self !== 'undefined' ? self : this);
