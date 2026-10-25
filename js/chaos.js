/*
 * CLOCKIT — Chaos Mode copy
 * ---------------------------------------------------------------
 * Every line here is meant to be playful, never hurtful.
 * {next} = player about to move, {prev} = player who just moved,
 * {p} = player in question, {w} = winner, {l} = player out of time.
 * Edit freely — add or remove lines in any list.
 */
(function (root) {
  'use strict';

  var LINES = {
    dramatic: {
      start: [
        'The clock is live. Let history begin.',
        'Two enter the arena. One leaves victorious.',
        'The crowd falls silent. The duel begins.',
        'Tonight, legends are made. Or at least a decent move.'
      ],
      switch: [
        '{prev} strikes! {next} must answer.',
        'The spotlight swings to {next}.',
        'A bold move from {prev}. The arena holds its breath.',
        '{next} steps forward. Destiny waits.',
        'Somewhere, a commentator just dropped their notes.'
      ],
      low30: ['Thirty seconds for {p}. The tension is unbearable.'],
      low10: ['Ten seconds. Everything on the line for {p}.'],
      pause: ['A dramatic intermission.', 'The arena takes a breath.'],
      resume: ['The battle resumes!', 'Back to the arena.'],
      add: ['A gift of time for {p}! The gods are generous.'],
      finish: ['History is written. {w} takes the crown.', 'And there it is. {w} wins the duel.', 'The arena erupts for {w}!']
    },
    roast: {
      start: ['May the least distracted player win.', 'Phones down. Except this one.'],
      slow: [
        '{prev} took the scenic route.',
        '{prev} was thinking so hard we heard it.',
        'Worth the wait, {prev}? We’ll see.',
        '{prev} has entered deep thought mode.'
      ],
      fast: [
        '{prev} moved like the table was on fire.',
        'Bold speed, {prev}. Bold.',
        '{prev} did not need to think about that. Apparently.'
      ],
      normal: [
        'Your turn, {next}. The clock believes in you. Mostly.',
        'No pressure, {next}. Everyone is just watching.',
        '{next}, the board misses you.'
      ],
      low30: ['{p}, the clock is getting chatty.', 'Tick tock, {p}. Friendly reminder.'],
      low10: ['{p}, now would be a great time.', 'Plot twist incoming for {p}?'],
      add: ['Extra time for {p}. Use it wisely. Or don’t.'],
      finish: [
        '{l} ran out of time, not talent.',
        'Good fight, {l}. The clock was just faster today.',
        '{l}, the rematch button is right there.',
        '{w} wins! {l} was saving their best move for next time.'
      ]
    },
    couch: {
      start: ['ROUND 1 — FIGHT!', 'PLAYER ONE, PRESS START!', 'GAME ON!'],
      switch: ['{next}: READY!', 'TAG IN, {next}!', '{next} — GO GO GO!'],
      fast: ['LIGHTNING MOVE!', 'SPEED BONUS!'],
      combo: ['COMBO ×{streak}!', '{streak} FAST MOVES IN A ROW!'],
      low10: ['DANGER ZONE!'],
      add: ['POWER-UP! +5', 'EXTRA LIFE!'],
      finish: ['K.O.! {w} WINS!', 'FLAWLESS-ISH VICTORY!', 'NEW HIGH SCORE: {w}!']
    },
    panic: {
      low10: ['Panic mode engaged for {p}.'],
      low30: []
    }
  };

  /* Couch Champion: short arcade words shown big on the panel. */
  var POP = {
    switch: ['YOUR TURN!', 'GO!', 'READY!', 'TAG IN!'],
    fast: ['LIGHTNING!', 'SPEEDY!', 'WHOOSH!'],
    start: ['FIGHT!']
  };

  function pick(list) { return list && list.length ? list[Math.floor(Math.random() * list.length)] : null; }

  function fill(text, vars) {
    return text.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }

  /*
   * Choose a line for an event, or null.
   *   event: start | switch | low30 | low10 | pause | resume | add | finish
   *   modes: { dramatic, roast, panic, couch }  (booleans)
   *   info: { moveMs, initialMs, streak, ...names }
   */
  function message(event, modes, info) {
    var candidates = [];
    var fast = info.moveMs != null && info.moveMs < 2000;
    var slow = info.moveMs != null && info.moveMs > Math.max(15000, info.initialMs * 0.12);

    if (modes.roast) {
      var r = LINES.roast;
      if (event === 'switch') {
        if (slow) candidates.push({ text: pick(r.slow), kind: 'roast', weight: 3 });
        else if (fast) candidates.push({ text: pick(r.fast), kind: 'roast', weight: 2 });
        else if (Math.random() < 0.35) candidates.push({ text: pick(r.normal), kind: 'roast', weight: 1 });
      } else if (r[event]) candidates.push({ text: pick(r[event]), kind: 'roast', weight: 2 });
    }
    if (modes.dramatic) {
      var d = LINES.dramatic;
      if (event === 'switch') { if (Math.random() < 0.3) candidates.push({ text: pick(d.switch), kind: 'dramatic', weight: 1 }); }
      else if (d[event]) candidates.push({ text: pick(d[event]), kind: 'dramatic', weight: 2 });
    }
    if (modes.couch) {
      var c = LINES.couch;
      if (event === 'switch') {
        if (fast && info.streak >= 2) candidates.push({ text: pick(c.combo), kind: 'couch', weight: 3 });
        else if (fast) candidates.push({ text: pick(c.fast), kind: 'couch', weight: 2 });
        else if (Math.random() < 0.25) candidates.push({ text: pick(c.switch), kind: 'couch', weight: 1 });
      } else if (c[event]) candidates.push({ text: pick(c[event]), kind: 'couch', weight: 2 });
    }
    if (modes.panic && LINES.panic[event] && LINES.panic[event].length && !candidates.length) {
      candidates.push({ text: pick(LINES.panic[event]), kind: 'panic', weight: 1 });
    }

    candidates = candidates.filter(function (c) { return c.text; });
    if (!candidates.length) return null;
    // Prefer heavier (more relevant) lines, break ties randomly.
    candidates.sort(function (a, b) { return b.weight - a.weight || Math.random() - 0.5; });
    var chosen = candidates[0];
    return { text: fill(chosen.text, info), kind: chosen.kind };
  }

  function pop(kind) { return pick(POP[kind] || POP.switch); }

  root.DuelChaos = { message: message, pop: pop, LINES: LINES };
})(typeof self !== 'undefined' ? self : this);
