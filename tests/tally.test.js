/*
 * Tests for Tally's scoring logic.
 * Run with:  node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tally-core.js');

function game(rule, target, rounds) {
  const players = ['Ann', 'Ben', 'Cat'].map((n, i) => ({ id: 'p' + i, name: n, slot: i }));
  const g = T.newGame(players, { id: 'custom', name: 'Test', rule, target });
  (rounds || []).forEach((row, r) => row.forEach((v, i) => g.entries.push({ pid: 'p' + i, v, round: r + 1 })));
  g.round = (rounds || []).length + 1;
  return g;
}

test('totals add every entry, including negative points', () => {
  const g = game('high', null, [[10, 5, 0], [-3, 7, 2]]);
  assert.deepEqual(T.totals(g), { p0: 7, p1: 12, p2: 2 });
});

test('round score is null when a player has nothing in that round', () => {
  const g = game('high', null, [[10, 5, 0]]);
  g.entries.push({ pid: 'p0', v: 1, round: 2 });
  assert.equal(T.roundScore(g, 'p0', 2), 1);
  assert.equal(T.roundScore(g, 'p1', 2), null);
  assert.equal(T.roundScore(g, 'p2', 1), 0);
});

test('highest wins ranks big scores first; ties share a place', () => {
  const g = game('high', null, [[20, 20, 5]]);
  const r = T.ranked(g);
  assert.deepEqual(r.map(x => x.place), [1, 1, 3]);
  assert.deepEqual(r.map(x => x.p.name), ['Ann', 'Ben', 'Cat']);
});

test('lowest wins ranks small scores first', () => {
  const g = game('low', 101, [[30, 5, 60]]);
  assert.deepEqual(T.ranked(g).map(x => x.p.name), ['Ben', 'Ann', 'Cat']);
});

test('target: highest wins finds the winner, lowest wins finds who is out', () => {
  assert.deepEqual(T.atTarget(game('high', 50, [[30, 50, 10]])).map(p => p.name), ['Ben']);
  assert.deepEqual(T.atTarget(game('low', 101, [[60, 5, 110]])).map(p => p.name), ['Cat']);
  assert.deepEqual(T.atTarget(game('high', null, [[999, 0, 0]])), []);
});

test('lead line explains the state of the game', () => {
  assert.equal(T.leadLine(game('high', 100)).kind, 'fresh');
  const lead = T.leadLine(game('high', 100, [[40, 25, 10]]));
  assert.equal(lead.name, 'Ann'); assert.equal(lead.by, 15); assert.equal(lead.needs, 60);
  const tie = T.leadLine(game('high', null, [[10, 10, 3]]));
  assert.equal(tie.kind, 'tie'); assert.equal(tie.count, 2);
  const low = T.leadLine(game('low', 101, [[20, 5, 90]]));
  assert.equal(low.name, 'Ben'); assert.deepEqual(low.danger, { name: 'Cat', left: 11 });
});

test('sanitize repairs a damaged save and drops entries for missing players', () => {
  const g = T.sanitize({
    players: [{ id: 'a', name: 'Ann', slot: 2 }, { id: 'a', name: 'Dup' }, { id: 'b', name: '', slot: 99 }],
    entries: [{ pid: 'a', v: 5, round: 1 }, { pid: 'zzz', v: 9, round: 1 }, { pid: 'b', v: 'x', round: 1 }, { pid: 'b', v: 3, round: 4 }],
    rule: 'weird', target: -5, round: 0
  });
  assert.equal(g.players.length, 2);
  assert.equal(g.players[1].slot, 1);
  assert.equal(g.entries.length, 2);
  assert.equal(g.rule, 'high');
  assert.equal(g.target, null);
  assert.equal(g.round, 5);
  assert.equal(T.sanitize(null), null);
  assert.equal(T.sanitize({ players: [], entries: [] }), null);
});

test('a new player gets the first colour no one is using', () => {
  const g = game('high', null);
  g.players.splice(1, 1);
  assert.equal(T.freeSlot(g), 1);
});
