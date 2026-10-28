/*
 * Engine tests. Run with:  node --test tests/
 * Uses a fake clock so every test is exact and instant.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ClockEngine, PHASE, formatTime } = require('../js/engine.js');

function setup(config) {
  let t = 1000;
  const clock = { now: () => t, advance: (ms) => { t += ms; return t; } };
  const e = new ClockEngine({ now: clock.now, config: Object.assign({ initialMs: 60000, incrementMs: 0 }, config) });
  return { e, clock };
}

test('starts in READY with equal time and nothing counting', () => {
  const { e, clock } = setup();
  assert.equal(e.phase, PHASE.READY);
  clock.advance(5000);
  assert.equal(e.remainingOf(0), 60000);
  assert.equal(e.remainingOf(1), 60000);
});

test('1. after start only Player 1 counts down', () => {
  const { e, clock } = setup();
  e.start();
  clock.advance(2500);
  assert.equal(e.remainingOf(0), 57500);
  assert.equal(e.remainingOf(1), 60000);
});

test('2–3. tapping Player 1 hands the turn to Player 2, whose clock then runs', () => {
  const { e, clock } = setup();
  e.start(); clock.advance(3000);
  const r = e.press(0);
  assert.equal(r.result, 'switched');
  assert.equal(e.active, 1);
  clock.advance(4000);
  assert.equal(e.remainingOf(0), 57000);
  assert.equal(e.remainingOf(1), 56000);
});

test('tapping the waiting player never steals the turn', () => {
  const { e, clock } = setup();
  e.start(); clock.advance(1000);
  assert.equal(e.press(1).result, 'not-your-turn');
  assert.equal(e.active, 0);
  clock.advance(1000);
  assert.equal(e.remainingOf(0), 58000);
  assert.equal(e.remainingOf(1), 60000);
});

test('4. increment goes to the player who just finished their turn', () => {
  const { e, clock } = setup({ incrementMs: 3000 });
  e.start(); clock.advance(10000);
  e.press(0);                       // P1 used 10s, gets +3s
  assert.equal(e.remainingOf(0), 53000);
  assert.equal(e.remainingOf(1), 60000);
  clock.advance(5000);
  e.press(1);                       // P2 used 5s, gets +3s
  assert.equal(e.remainingOf(1), 58000);
  assert.equal(e.remainingOf(0), 53000);
});

test('5. pause freezes both clocks; resume continues exactly', () => {
  const { e, clock } = setup();
  e.start(); clock.advance(7000);
  assert.ok(e.pause());
  clock.advance(60000);             // a long pause
  assert.equal(e.remainingOf(0), 53000);
  assert.equal(e.remainingOf(1), 60000);
  e.start(); clock.advance(1000);
  assert.equal(e.remainingOf(0), 52000);
});

test('presses while paused or ready do nothing', () => {
  const { e, clock } = setup();
  assert.equal(e.press(0).result, 'not-live');
  e.start(); clock.advance(500); e.pause();
  assert.equal(e.press(0).result, 'not-live');
  assert.equal(e.active, 0);
});

test('6. reset restores full time and the first player', () => {
  const { e, clock } = setup({ firstPlayer: 1 });
  e.start(); clock.advance(3000); e.press(1); clock.advance(3000);
  e.reset();
  assert.equal(e.phase, PHASE.READY);
  assert.equal(e.active, 1);
  assert.deepEqual([e.remainingOf(0), e.remainingOf(1)], [60000, 60000]);
  assert.deepEqual(e.moves, [0, 0]);
});

test('7. a clock reaching zero ends the game; opponent wins; no negatives', () => {
  const { e, clock } = setup({ initialMs: 10000 });
  e.start(); clock.advance(10500);
  assert.equal(e.remainingOf(0), 0);
  const r = e.tick();
  assert.equal(r.result, 'timeout');
  assert.equal(e.phase, PHASE.FINISHED);
  assert.equal(e.winner, 1);
  assert.equal(e.loser, 0);
  clock.advance(5000);
  assert.equal(e.remainingOf(0), 0);
  assert.equal(e.remainingOf(1), 10000);
  assert.equal(e.press(0).result, 'not-live');
});

test('a press that lands after the flag fell loses (no late increment rescue)', () => {
  const { e, clock } = setup({ initialMs: 10000, incrementMs: 5000 });
  e.start(); clock.advance(10001);
  const r = e.press(0);
  assert.equal(r.result, 'timeout');
  assert.equal(e.winner, 1);
});

test('rapid double taps are debounced so the turn is not passed back', () => {
  const { e, clock } = setup();
  e.start(); clock.advance(2000);
  assert.equal(e.press(0).result, 'switched');
  clock.advance(50);
  assert.equal(e.press(1).result, 'debounced');
  assert.equal(e.active, 1);
  clock.advance(300);
  assert.equal(e.press(1).result, 'switched');
});

test('repeated start/pause calls stay consistent', () => {
  const { e, clock } = setup();
  assert.ok(e.start()); assert.ok(!e.start());
  clock.advance(1000);
  assert.ok(e.pause()); assert.ok(!e.pause());
  clock.advance(1000);
  e.start(); e.start();
  clock.advance(1000);
  assert.equal(e.remainingOf(0), 58000);
});

test('+5 seconds goes to the active player only, live or paused', () => {
  const { e, clock } = setup();
  assert.equal(e.addTime(5000), 0);           // not in READY
  e.start(); clock.advance(10000);
  assert.equal(e.addTime(5000), 5000);
  assert.equal(e.remainingOf(0), 55000);
  e.press(0); e.pause();
  e.addTime(5000);
  assert.equal(e.remainingOf(1), 65000);
  assert.equal(e.remainingOf(0), 55000);
});

test('missed background time is charged to the active player', () => {
  const { e, clock } = setup({ initialMs: 30000 });
  e.start(); clock.advance(1000);
  e.chargeMissedTime(12000);
  assert.equal(e.remainingOf(0), 17000);
  const r = e.chargeMissedTime(20000);
  assert.equal(r.result, 'timeout');
});

test('config is sanitised (no negative, zero or absurd durations)', () => {
  const { e } = setup({ initialMs: -50, incrementMs: -2 });
  assert.equal(e.config.initialMs, ClockEngine.MIN_INITIAL_MS);
  assert.equal(e.config.incrementMs, 0);
  e.configure({ initialMs: 1e12 });
  assert.equal(e.config.initialMs, ClockEngine.MAX_MS);
});

test('snapshot/restore brings a running game back paused with the same times', () => {
  const { e, clock } = setup();
  e.start(); clock.advance(4000); e.press(0); clock.advance(2000);
  const snap = JSON.parse(JSON.stringify(e.snapshot()));
  const { e: e2 } = setup();
  assert.ok(e2.restore(snap));
  assert.equal(e2.phase, PHASE.PAUSED);
  assert.equal(e2.active, 1);
  assert.equal(e2.remainingOf(0), 56000);
  assert.equal(e2.remainingOf(1), 58000);
});

test('formatTime shows MM:SS and tenths under ten seconds', () => {
  assert.equal(formatTime(300000).text, '05:00');
  assert.equal(formatTime(299999).text, '04:59');
  assert.equal(formatTime(61000).text, '01:01');
  assert.equal(formatTime(9450).text, '00:09.4');
  assert.equal(formatTime(0).text, '00:00.0');
  assert.equal(formatTime(-5).text, '00:00.0');
});

/* ---------- wrong answer / take-back ---------- */

test('take-back returns the turn, restores the opponent and charges the presser', () => {
  const { e, clock } = setup({ incrementMs: 3000 });
  assert.equal(e.canTakeBack(), false, 'nothing to take back before a switch');
  e.start(); clock.advance(10000);
  e.press(0);                            // P1 presses after a wrong answer (+3s bonus)
  clock.advance(4000);                   // P2's clock ran 4 s before the referee objects
  const r = e.takeBack();
  assert.equal(r.result, 'taken-back');
  assert.equal(e.active, 0);
  assert.equal(e.remainingOf(1), 60000, 'P2 gets every second back');
  assert.equal(e.remainingOf(0), 46000, 'P1 is charged 10 s + 4 s, bonus removed');
  assert.equal(e.moves[0], 0);
  clock.advance(1000);
  assert.equal(e.remainingOf(0), 45000, 'P1 keeps running');
  assert.equal(e.takeBack().result, 'unavailable', 'only the last switch can be taken back');
});

test('take-back works while paused and applies a penalty', () => {
  const { e, clock } = setup();
  e.start(); clock.advance(5000); e.press(0); clock.advance(2000);
  e.pause(); clock.advance(30000);       // the argument while paused costs nothing
  const r = e.takeBack(undefined, 5000);
  assert.equal(r.penaltyMs, 5000);
  assert.equal(e.phase, PHASE.PAUSED);
  assert.equal(e.remainingOf(0), 60000 - 5000 - 2000 - 5000);
  assert.equal(e.remainingOf(1), 60000);
});

test('take-back that empties the clock ends the game', () => {
  const { e, clock } = setup({ initialMs: 10000 });
  e.start(); clock.advance(8000); e.press(0); clock.advance(3000);
  const r = e.takeBack();
  assert.ok(r.timeout);
  assert.equal(e.phase, PHASE.FINISHED);
  assert.equal(e.winner, 1);
  assert.equal(e.remainingOf(1), 10000);
});

test('a new switch after a take-back can be taken back again', () => {
  const { e, clock } = setup();
  e.start(); clock.advance(3000); e.press(0); clock.advance(1000); e.takeBack();
  clock.advance(2000); e.press(0);
  assert.equal(e.canTakeBack(), true);
  clock.advance(500); e.press(1);
  e.takeBack();
  assert.equal(e.active, 1);
});
