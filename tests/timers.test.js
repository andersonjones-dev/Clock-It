/*
 * Tests for the Stopwatch, Showtime and Group engines.
 * Run with:  node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Stopwatch, Countdown, GroupClock, fmt } = require('../js/timers.js');

function fakeClock() { let t = 1e12; return { now: () => t, go: (ms) => { t += ms; return t; } }; }

/* ---------- Stopwatch ---------- */

test('stopwatch counts only while running and resumes from where it stopped', () => {
  const c = fakeClock(); const s = new Stopwatch({ now: c.now });
  c.go(5000); assert.equal(s.elapsed(), 0);
  s.start(); c.go(1500); assert.equal(s.elapsed(), 1500);
  s.stop(); c.go(9000); assert.equal(s.elapsed(), 1500);
  s.start(); c.go(500); assert.equal(s.elapsed(), 2000);
});

test('laps record lap length and split; fastest and slowest are found', () => {
  const c = fakeClock(); const s = new Stopwatch({ now: c.now });
  s.start();
  c.go(10000); s.lap();
  c.go(8000); s.lap();
  c.go(12000); s.lap();
  assert.deepEqual(s.laps.map(l => l.ms), [10000, 8000, 12000]);
  assert.deepEqual(s.laps.map(l => l.total), [10000, 18000, 30000]);
  const st = s.stats();
  assert.equal(st.fastest, 1); assert.equal(st.slowest, 2); assert.equal(st.best, 8000);
  c.go(3000); assert.equal(s.currentLap(), 3000);
});

test('lap is ignored when stopped or double-tapped', () => {
  const c = fakeClock(); const s = new Stopwatch({ now: c.now });
  assert.equal(s.lap(), null);
  s.start(); c.go(1000); assert.ok(s.lap()); c.go(20); assert.equal(s.lap(), null);
  assert.equal(s.laps.length, 1);
});

test('a running stopwatch survives save and reopen later', () => {
  const c = fakeClock(); const s = new Stopwatch({ now: c.now });
  s.start(); c.go(4000); s.lap();
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  c.go(60000); // app closed for a minute
  const s2 = new Stopwatch({ now: c.now }); s2.restore(snap);
  assert.equal(s2.elapsed(), 64000);
  assert.equal(s2.laps.length, 1);
});

/* ---------- Countdown ---------- */

test('countdown runs, pauses exactly and finishes at zero', () => {
  const c = fakeClock(); const d = new Countdown({ now: c.now, durationMs: 10000 });
  assert.equal(d.state, 'idle');
  d.start(); c.go(4000); assert.equal(d.remaining(), 6000);
  d.pause(); c.go(30000); assert.equal(d.remaining(), 6000);
  d.start(); c.go(5999); assert.equal(d.tick(), false);
  c.go(5); assert.equal(d.tick(), true);
  assert.equal(d.state, 'done'); assert.equal(d.remaining(), 0);
  assert.equal(d.tick(), false, 'only reports zero once');
});

test('adding time extends the ring total; after time is up it restarts a mini countdown', () => {
  const c = fakeClock(); const d = new Countdown({ now: c.now, durationMs: 10000 });
  assert.equal(d.add(5000), 0, 'nothing to add before starting');
  d.start(); c.go(8000);
  d.add(10000);
  assert.equal(d.remaining(), 12000); assert.equal(d.total, 20000);
  c.go(12000); d.tick(); assert.equal(d.state, 'done');
  d.add(10000); assert.equal(d.state, 'running'); assert.equal(d.remaining(), 10000);
});

test('countdown that expired while the app was closed reports when it ended', () => {
  const c = fakeClock(); const d = new Countdown({ now: c.now, durationMs: 30000 });
  d.start(); const started = c.now();
  const snap = JSON.parse(JSON.stringify(d.snapshot()));
  c.go(300000);
  const d2 = new Countdown({ now: c.now }); d2.restore(snap);
  assert.equal(d2.tick(), true);
  assert.equal(d2.doneAt, started + 30000);
});

/* ---------- GroupClock ---------- */

test('turn mode: each turn gets a fresh limit and passes round the table', () => {
  const c = fakeClock();
  const g = new GroupClock({ now: c.now, config: { names: ['A', 'B', 'C'], mode: 'turn', limitMs: 30000 } });
  g.start(); c.go(12000);
  assert.equal(g.remaining(0), 18000);
  g.pass(); assert.equal(g.active, 1); assert.equal(g.remaining(1), 30000);
  c.go(1000); g.pass(); c.go(1000); g.pass();
  assert.equal(g.active, 0, 'wraps back to the first player');
  assert.equal(g.round(), 2);
  assert.equal(g.usedOf(0), 12000);
});

test('bank mode: time comes out of each player’s own bank and can go into overtime', () => {
  const c = fakeClock();
  const g = new GroupClock({ now: c.now, config: { names: ['A', 'B'], mode: 'bank', limitMs: 60000 } });
  g.start(); c.go(20000); g.pass();
  c.go(5000); g.pass();
  assert.equal(g.remaining(0), 40000); assert.equal(g.remaining(1), 55000);
  c.go(45000);
  assert.equal(g.remaining(0), -5000, 'overtime is negative, the game continues');
});

test('pass is ignored when paused and on an instant double tap; jump works', () => {
  const c = fakeClock();
  const g = new GroupClock({ now: c.now, config: { names: ['A', 'B', 'C', 'D'], limitMs: 30000 } });
  assert.equal(g.pass().result, 'not-running');
  g.start(); c.go(1000);
  assert.equal(g.pass().result, 'passed'); c.go(50);
  assert.equal(g.pass().result, 'debounced'); assert.equal(g.active, 1);
  c.go(500); assert.equal(g.pass(undefined, 3).result, 'passed'); assert.equal(g.active, 3);
  g.pause(); assert.equal(g.pass().result, 'not-running');
});

test('undo gives the turn back and returns the wrongly charged time', () => {
  const c = fakeClock();
  const g = new GroupClock({ now: c.now, config: { names: ['A', 'B', 'C'], mode: 'bank', limitMs: 60000 } });
  g.start(); c.go(10000); g.pass();      // A passes by mistake
  c.go(3000);                             // B's clock ran 3 s
  g.undo();
  assert.equal(g.active, 0);
  assert.equal(g.remaining(1), 60000, 'B gets their 3 s back');
  assert.equal(g.remaining(0), 47000, 'A is charged for the whole time they were thinking');
  assert.equal(g.turns[0], 0);
});

test('summary ranks players by time used', () => {
  const c = fakeClock();
  const g = new GroupClock({ now: c.now, config: { names: ['A', 'B', 'C'], limitMs: 60000 } });
  g.start(); c.go(5000); g.pass(); c.go(20000); g.pass(); c.go(9000); g.pass();
  assert.deepEqual(g.summary().map(r => r.name), ['B', 'C', 'A']);
});

test('a running group game is restored paused', () => {
  const c = fakeClock();
  const g = new GroupClock({ now: c.now, config: { names: ['A', 'B', 'C'], mode: 'bank', limitMs: 60000 } });
  g.start(); c.go(7000); g.pass(); c.go(2000);
  const g2 = new GroupClock({ now: c.now }); assert.ok(g2.restore(JSON.parse(JSON.stringify(g.snapshot()))));
  assert.equal(g2.state, 'paused'); assert.equal(g2.active, 1); assert.equal(g2.remaining(1), 58000);
  assert.equal(g2.remaining(0), 53000);
});

/* ---------- formatting ---------- */

test('formatting: countdowns round up, stopwatches round down', () => {
  assert.equal(fmt.countdown(30000), '0:30');
  assert.equal(fmt.countdown(29001), '0:30');
  assert.equal(fmt.countdown(500), '0:01');
  assert.equal(fmt.countdown(0), '0:00');
  assert.equal(fmt.countdown(3723000), '1:02:03');
  assert.equal(fmt.overtime(7900), '+0:07');
  assert.equal(fmt.stopwatch(83456).text, '01:23.45');
  assert.equal(fmt.lap(12340), '12.34');
  assert.equal(fmt.lap(62340), '1:02.34');
  assert.equal(fmt.label(90000), '1:30');
});
