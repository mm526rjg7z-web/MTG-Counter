import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BURST_MS,
  COMMANDER_LETHAL,
  HISTORY_MAX,
  LIFE_MIN,
  POISON_LETHAL,
  adjust,
  canUndo,
  createGame,
  eliminationReasons,
  getBurst,
  isEliminated,
  resetGame,
  restoreGame,
  setColor,
  setMarker,
  setName,
  toggleMarker,
  undo,
} from '../js/game.js';

const T0 = 1_700_000_000_000;
const life = (pid) => ({ pid, kind: 'life' });
const cmd = (pid, src) => ({ pid, kind: 'cmd', src });

function game(count = 4, startLife = 40) {
  return createGame({ playerCount: count, startLife });
}

test('createGame builds players with unique colours and zeroed counters', () => {
  for (let n = 2; n <= 6; n++) {
    const g = game(n, 30);
    assert.equal(g.players.length, n);
    assert.equal(new Set(g.players.map((p) => p.color)).size, n);
    for (const p of g.players) {
      assert.equal(p.life, 30);
      assert.deepEqual([p.poison, p.energy, p.experience], [0, 0, 0]);
      assert.deepEqual(p.cmd, new Array(n).fill(0));
    }
    assert.equal(g.monarch, null);
    assert.equal(g.initiative, null);
    assert.deepEqual(g.history, []);
  }
});

test('createGame clamps player count and start life', () => {
  assert.equal(createGame({ playerCount: 9, startLife: 40 }).players.length, 6);
  assert.equal(createGame({ playerCount: 1, startLife: 40 }).players.length, 2);
  assert.equal(createGame({ playerCount: 2, startLife: 0 }).players[0].life, 1);
  assert.equal(createGame({ playerCount: 2, startLife: 5000 }).players[0].life, 999);
  assert.equal(createGame({ playerCount: 2, startLife: 'abc' }).players[0].life, 1);
});

test('life changes by the given delta and may become negative', () => {
  let g = game();
  g = adjust(g, life(0), -1, T0);
  assert.equal(g.players[0].life, 39);
  g = adjust(g, life(0), -45, T0 + 10_000);
  assert.equal(g.players[0].life, -6);
  g = adjust(g, life(0), -10_000, T0 + 20_000);
  assert.equal(g.players[0].life, LIFE_MIN);
});

test('counters never drop below zero', () => {
  let g = game();
  const same = adjust(g, { pid: 1, kind: 'poison' }, -1, T0);
  assert.equal(same, g, 'no-op must return the identical object');
  g = adjust(g, { pid: 1, kind: 'poison' }, 3, T0);
  g = adjust(g, { pid: 1, kind: 'poison' }, -5, T0 + 5000);
  assert.equal(g.players[1].poison, 0);
});

test('invalid targets and deltas are ignored', () => {
  const g = game();
  assert.equal(adjust(g, life(9), 1, T0), g);
  assert.equal(adjust(g, { pid: 0, kind: 'nonsense' }, 1, T0), g);
  assert.equal(adjust(g, cmd(0, 0), 1, T0), g, 'own commander damage is not tracked');
  assert.equal(adjust(g, cmd(0, 7), 1, T0), g);
  assert.equal(adjust(g, life(0), 0, T0), g);
  assert.equal(adjust(g, life(0), NaN, T0), g);
});

test('rapid changes merge into one history entry (burst)', () => {
  let g = game();
  g = adjust(g, life(0), -1, T0);
  g = adjust(g, life(0), -1, T0 + 200);
  g = adjust(g, life(0), -5, T0 + 900);
  assert.equal(g.history.length, 1);
  assert.deepEqual(
    { from: g.history[0].from, to: g.history[0].to, t: g.history[0].t },
    { from: 40, to: 33, t: T0 + 900 },
  );
  // a pause longer than the burst window starts a new entry
  g = adjust(g, life(0), -1, T0 + 900 + BURST_MS + 1);
  assert.equal(g.history.length, 2);
  assert.deepEqual([g.history[1].from, g.history[1].to], [33, 32]);
});

test('the burst window is measured from the last change, not from the first', () => {
  let g = game();
  let t = T0;
  for (let i = 0; i < 10; i++) {
    g = adjust(g, life(0), -1, t);
    t += BURST_MS - 100; // always inside the window of the previous change
  }
  assert.equal(g.history.length, 1);
  assert.equal(g.history[0].to, 30);
});

test('a burst with net change zero leaves no history entry', () => {
  let g = game();
  g = adjust(g, life(0), 1, T0);
  g = adjust(g, life(0), -1, T0 + 100);
  assert.equal(g.history.length, 0);
  assert.equal(g.players[0].life, 40);
  assert.equal(getBurst(g, 0, T0 + 100), null);
});

test('getBurst reports the running sum and when it expires', () => {
  let g = game();
  assert.equal(getBurst(g, 0, T0), null);
  g = adjust(g, life(0), -3, T0);
  g = adjust(g, life(0), -4, T0 + 300);
  assert.deepEqual(getBurst(g, 0, T0 + 400), { delta: -7, expiresAt: T0 + 300 + BURST_MS });
  assert.equal(getBurst(g, 1, T0 + 400), null, 'other players are unaffected');
  assert.equal(getBurst(g, 0, T0 + 300 + BURST_MS + 1), null, 'indicator disappears after the pause');
});

test('different values and players do not merge', () => {
  let g = game();
  g = adjust(g, life(0), -1, T0);
  g = adjust(g, life(1), -1, T0 + 10);
  g = adjust(g, { pid: 0, kind: 'poison' }, 1, T0 + 20);
  g = adjust(g, cmd(0, 1), 2, T0 + 30);
  g = adjust(g, cmd(0, 2), 2, T0 + 40);
  assert.equal(g.history.length, 5);
});

test('concurrent players: a merged entry moves to the end so undo stays consistent', () => {
  let g = game();
  g = adjust(g, life(0), -1, T0); // A
  g = adjust(g, life(1), -1, T0 + 100); // B
  g = adjust(g, life(0), -1, T0 + 200); // A again -> merges into A's entry
  assert.equal(g.history.length, 2);
  assert.deepEqual(g.history.map((e) => e.pid), [1, 0]);
  g = undo(g); // reverts A completely
  assert.deepEqual([g.players[0].life, g.players[1].life], [40, 39]);
  g = undo(g); // then B
  assert.deepEqual([g.players[0].life, g.players[1].life], [40, 40]);
  assert.equal(canUndo(g), false);
});

test('undo restores the previous state step by step', () => {
  const start = game();
  let g = start;
  let t = T0;
  const steps = [
    [life(0), -7],
    [{ pid: 1, kind: 'poison' }, 2],
    [cmd(2, 0), 5],
    [life(3), 4],
    [{ pid: 0, kind: 'energy' }, 3],
  ];
  const snapshots = [g];
  for (const [target, delta] of steps) {
    t += 5000;
    g = adjust(g, target, delta, t);
    snapshots.push(g);
  }
  for (let i = steps.length - 1; i >= 0; i--) {
    g = undo(g);
    assert.deepEqual(g.players, snapshots[i].players);
    assert.deepEqual(g.history, snapshots[i].history);
  }
  assert.deepEqual(g.players, start.players);
  assert.equal(undo(g), g, 'undo on an empty history changes nothing');
});

test('commander damage of 21 from a single source eliminates, 20 does not', () => {
  let g = game();
  g = adjust(g, cmd(1, 0), COMMANDER_LETHAL - 1, T0);
  assert.equal(isEliminated(g.players[1]), false);
  g = adjust(g, cmd(1, 0), 1, T0 + 10_000);
  assert.deepEqual(eliminationReasons(g.players[1]), ['commander']);
  g = undo(g);
  assert.equal(isEliminated(g.players[1]), false);
});

test('commander damage from different sources is not added up', () => {
  let g = game();
  g = adjust(g, cmd(1, 0), 15, T0);
  g = adjust(g, cmd(1, 2), 15, T0 + 10_000);
  assert.equal(isEliminated(g.players[1]), false);
});

test('poison 10 and life 0 eliminate, and every reason is reported', () => {
  let g = game(2, 20);
  g = adjust(g, { pid: 0, kind: 'poison' }, POISON_LETHAL - 1, T0);
  assert.equal(isEliminated(g.players[0]), false);
  g = adjust(g, { pid: 0, kind: 'poison' }, 1, T0 + 10_000);
  assert.deepEqual(eliminationReasons(g.players[0]), ['poison']);
  g = adjust(g, life(0), -19, T0 + 20_000); // life 1: still alive by life, but poisoned
  assert.equal(g.players[0].life, 1);
  assert.deepEqual(eliminationReasons(g.players[0]), ['poison']);
  g = adjust(g, life(0), -1, T0 + 30_000);
  assert.deepEqual(eliminationReasons(g.players[0]), ['life', 'poison']);
  assert.equal(g.players[0].life, 0);
});

test('a player who is out stays editable', () => {
  let g = game(2, 1);
  g = adjust(g, life(0), -1, T0);
  assert.equal(isEliminated(g.players[0]), true);
  g = adjust(g, life(0), 3, T0 + 10_000);
  assert.equal(g.players[0].life, 3);
  assert.equal(isEliminated(g.players[0]), false);
});

test('monarch and initiative belong to one player at a time', () => {
  let g = game();
  g = setMarker(g, 'monarch', 1, T0);
  assert.equal(g.monarch, 1);
  g = setMarker(g, 'monarch', 2, T0 + 10_000);
  assert.equal(g.monarch, 2);
  g = setMarker(g, 'initiative', 2, T0 + 20_000);
  assert.deepEqual([g.monarch, g.initiative], [2, 2], 'markers are independent of each other');
  g = toggleMarker(g, 'monarch', 2, T0 + 30_000);
  assert.equal(g.monarch, null);
  assert.equal(setMarker(g, 'monarch', null, T0 + 40_000), g);
  assert.equal(setMarker(g, 'monarch', 9, T0 + 40_000), g);
  assert.equal(setMarker(g, 'nonsense', 1, T0 + 40_000), g);
});

test('marker changes are part of the history and can be undone', () => {
  let g = game();
  g = setMarker(g, 'monarch', 1, T0);
  g = setMarker(g, 'monarch', 3, T0 + 10_000);
  assert.deepEqual(g.history.map((e) => [e.kind, e.from, e.to]), [['monarch', null, 1], ['monarch', 1, 3]]);
  g = undo(g);
  assert.equal(g.monarch, 1);
  g = undo(g);
  assert.equal(g.monarch, null);
});

test('handing the monarchy around quickly collapses into one entry', () => {
  let g = game();
  g = setMarker(g, 'monarch', 1, T0);
  g = setMarker(g, 'monarch', 2, T0 + 300);
  g = setMarker(g, 'monarch', 3, T0 + 600);
  assert.equal(g.history.length, 1);
  assert.deepEqual([g.history[0].from, g.history[0].to], [null, 3]);
  g = undo(g);
  assert.equal(g.monarch, null);
});

test('history is capped but stays consistent', () => {
  let g = game(2, 999);
  let t = T0;
  for (let i = 0; i < HISTORY_MAX + 50; i++) {
    t += BURST_MS + 10;
    g = adjust(g, life(i % 2), i % 4 < 2 ? -1 : 1, t);
  }
  assert.equal(g.history.length, HISTORY_MAX);
  const ids = g.history.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('setName trims, limits the length and falls back to the default', () => {
  let g = game();
  g = setName(g, 0, '  Ur-Drago   der   Große  ');
  assert.equal(g.players[0].name, 'Ur-Drago der Gro');
  g = setName(g, 0, '   ');
  assert.equal(g.players[0].name, 'Spieler 1');
  assert.equal(setName(g, 0, 'Spieler 1'), g);
  assert.equal(setName(g, 99, 'x'), g);
});

test('setName never cuts an emoji in half', () => {
  const g = setName(game(), 0, '\u{1F600}'.repeat(20)); // 20 emoji = 40 UTF-16 units
  const name = g.players[0].name;
  assert.equal(Array.from(name).length, 16);
  assert.equal(name.isWellFormed(), true, 'no lone surrogate at the end');
});

test('setColor swaps colours so they stay unique', () => {
  let g = game();
  const [a, b] = [g.players[0].color, g.players[1].color];
  g = setColor(g, 0, b);
  assert.equal(g.players[0].color, b);
  assert.equal(g.players[1].color, a);
  assert.equal(new Set(g.players.map((p) => p.color)).size, 4);
  assert.equal(setColor(g, 0, b), g);
  assert.equal(setColor(g, 0, 'not-a-colour'), g);
  g = setColor(g, 0, 'pink'); // a colour nobody has yet
  assert.equal(g.players[0].color, 'pink');
  assert.equal(new Set(g.players.map((p) => p.color)).size, 4);
});

test('resetGame keeps settings, names and colours but clears everything else', () => {
  let g = game(3, 30);
  g = setName(g, 1, 'Anna');
  g = setColor(g, 1, 'pink');
  g = adjust(g, life(0), -9, T0);
  g = adjust(g, cmd(2, 1), 4, T0 + 10_000);
  g = setMarker(g, 'monarch', 0, T0 + 20_000);
  const r = resetGame(g);
  assert.equal(r.players.length, 3);
  assert.equal(r.startLife, 30);
  assert.equal(r.players[1].name, 'Anna');
  assert.equal(r.players[1].color, 'pink');
  assert.deepEqual(r.players.map((p) => p.life), [30, 30, 30]);
  assert.deepEqual(r.players[2].cmd, [0, 0, 0]);
  assert.deepEqual([r.monarch, r.initiative, r.history.length], [null, null, 0]);
});

test('createGame with a previous game keeps names but never duplicates colours', () => {
  let g = game(2);
  g = setColor(g, 0, 'purple'); // seat 0 now purple; seat 2 would default to purple/green
  g = setName(g, 0, 'Zed');
  const bigger = createGame({ playerCount: 5, startLife: 40, previous: g });
  assert.equal(bigger.players[0].name, 'Zed');
  assert.equal(bigger.players[0].color, 'purple');
  assert.equal(new Set(bigger.players.map((p) => p.color)).size, 5);
  const smaller = createGame({ playerCount: 2, startLife: 20, previous: bigger });
  assert.equal(smaller.players.length, 2);
  assert.equal(smaller.players[0].name, 'Zed');
});

test('restoreGame round-trips a played game through JSON', () => {
  let g = game(5, 40);
  g = setName(g, 2, 'Mira');
  g = adjust(g, life(0), -7, T0);
  g = adjust(g, cmd(3, 1), 21, T0 + 10_000);
  g = adjust(g, { pid: 4, kind: 'experience' }, 2, T0 + 20_000);
  g = setMarker(g, 'initiative', 4, T0 + 30_000);
  const copy = restoreGame(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(copy, g);
  assert.equal(undo(copy).initiative, null, 'a restored game can still be undone');
});

test('restoreGame rejects garbage and repairs damaged values', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { players: 'no' }, { players: [] }, { players: [{}] }]) {
    assert.equal(restoreGame(bad), null);
  }
  assert.equal(restoreGame({ players: new Array(9).fill({}) }), null);

  const g = restoreGame({
    startLife: 'abc',
    monarch: 77,
    initiative: 1,
    players: [
      { name: 5, color: 'red', life: 'x', poison: -4, energy: 1e9, experience: 2.9, cmd: [0, 3, 'z'] },
      { name: '  ', color: 'red', life: 12, cmd: 'nope' },
      { color: 'nope', life: 1e7 },
    ],
    history: [
      { id: 1, t: 1, kind: 'life', pid: 0, from: 40, to: 39 },
      { id: 2, t: 2, kind: 'life', pid: 9, from: 1, to: 2 },
      { id: 3, t: 3, kind: 'cmd', pid: 0, src: 0, from: 0, to: 1 },
      { id: 4, t: 4, kind: 'monarch', from: null, to: 1 },
      { id: 5, t: 5, kind: 'monarch', from: null, to: 99 },
      'junk',
    ],
  });
  assert.ok(g);
  assert.equal(g.startLife, 40);
  assert.equal(g.monarch, null);
  assert.equal(g.initiative, 1);
  assert.equal(g.players[0].name, 'Spieler 1');
  assert.deepEqual([g.players[0].life, g.players[0].poison, g.players[0].energy, g.players[0].experience], [40, 0, 999, 2]);
  assert.deepEqual(g.players[0].cmd, [0, 3, 0]);
  assert.deepEqual(g.players[1].cmd, [0, 0, 0]);
  assert.equal(g.players[2].life, 9999);
  assert.equal(new Set(g.players.map((p) => p.color)).size, 3, 'duplicate / unknown colours are repaired');
  assert.deepEqual(g.history.map((e) => e.id), [1, 4]);
  assert.equal(g.nextEntryId, 5);
});
