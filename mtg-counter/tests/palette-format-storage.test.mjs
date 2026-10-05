import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COLOR_ORDER, PALETTE, contrastRatio, pickFreeColor } from '../js/palette.js';
import { MINUS, describeEntry, formatNumber, formatSigned, formatTime, summarizeEntry } from '../js/format.js';
import { adjust, createGame, setMarker } from '../js/game.js';
import { DEFAULT_SETTINGS, STORAGE_KEY, createSaver, getStorage, loadSaved, sanitizeSettings, save } from '../js/storage.js';

// ---- palette ----------------------------------------------------------------------------------

test('every player colour has readable text (WCAG AA, 4.5:1)', () => {
  for (const c of PALETTE) {
    const ratio = contrastRatio(c.bg, c.fg);
    assert.ok(ratio >= 4.5, `${c.id}: contrast ${ratio.toFixed(2)} < 4.5`);
  }
});

test('palette ids are unique and the default order only uses known colours', () => {
  const ids = PALETTE.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of DEFAULT_COLOR_ORDER) assert.ok(ids.includes(id));
  assert.ok(PALETTE.length >= 6);
});

test('contrastRatio matches known reference values', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.02);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
});

test('pickFreeColor skips used colours', () => {
  assert.equal(pickFreeColor(new Set()), 'red');
  assert.equal(pickFreeColor(new Set(['red', 'blue'])), 'green');
  assert.ok(!['red', 'blue', 'green', 'yellow', 'purple', 'orange'].includes(pickFreeColor(new Set(DEFAULT_COLOR_ORDER))));
});

// ---- format -----------------------------------------------------------------------------------

test('numbers use the typographic minus', () => {
  assert.equal(formatNumber(40), '40');
  assert.equal(formatNumber(-7), `${MINUS}7`);
  assert.equal(formatNumber(0), '0');
  assert.equal(formatSigned(3), '+3');
  assert.equal(formatSigned(-7), `${MINUS}7`);
  assert.equal(formatSigned(0), '0');
});

test('formatTime renders local HH:MM:SS', () => {
  const d = new Date(2024, 0, 2, 3, 4, 5);
  assert.equal(formatTime(d.getTime()), '03:04:05');
});

test('describeEntry names players, sources and markers', () => {
  let g = createGame({ playerCount: 3, startLife: 40 });
  g = adjust(g, { pid: 0, kind: 'life' }, -7, 1000);
  g = adjust(g, { pid: 1, kind: 'cmd', src: 2 }, 5, 2000);
  g = setMarker(g, 'monarch', 2, 3000);
  g = setMarker(g, 'monarch', null, 9000);
  const [life, cmd, crown, crownOff] = g.history.map((e) => describeEntry(e, g));
  assert.deepEqual(life, { pid: 0, label: 'Leben', from: '40', to: '33', delta: -7, phrase: null });
  assert.deepEqual(cmd, { pid: 1, label: 'Commander-Schaden von Spieler 3', from: '0', to: '5', delta: 5, phrase: null });
  assert.deepEqual(crown, { pid: 2, label: 'Monarch', from: '–', to: 'Spieler 3', delta: null, phrase: 'Spieler 3 wird Monarch' });
  assert.deepEqual(crownOff, { pid: 2, label: 'Monarch', from: 'Spieler 3', to: '–', delta: null, phrase: 'Spieler 3 ist nicht mehr Monarch' });
  assert.equal(summarizeEntry(g.history[0], g), `Spieler 1: Leben 40 → 33 (${MINUS}7)`);
  assert.equal(summarizeEntry(g.history[2], g), 'Spieler 3 wird Monarch');
});

test('marker phrases cover gaining, losing and handing over', () => {
  let g = createGame({ playerCount: 3, startLife: 40 });
  g = setMarker(g, 'initiative', 1, 1000);
  g = setMarker(g, 'initiative', 2, 9000);
  g = setMarker(g, 'initiative', null, 20000);
  g = setMarker(g, 'monarch', 0, 30000);
  g = setMarker(g, 'monarch', 1, 40000);
  assert.deepEqual(g.history.map((e) => describeEntry(e, g).phrase), [
    'Spieler 2 übernimmt die Initiative',
    'Initiative: Spieler 2 → Spieler 3',
    'Spieler 3 verliert die Initiative',
    'Spieler 1 wird Monarch',
    'Monarch: Spieler 1 → Spieler 2',
  ]);
});

// ---- storage ----------------------------------------------------------------------------------

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
}

test('nothing stored -> defaults and no game', () => {
  const { settings, game } = loadSaved(fakeStorage());
  assert.deepEqual(settings, { ...DEFAULT_SETTINGS });
  assert.equal(game, null);
});

test('save and load round-trip settings and game', () => {
  const storage = fakeStorage();
  let game = createGame({ playerCount: 3, startLife: 30 });
  game = adjust(game, { pid: 1, kind: 'life' }, -4, 5000);
  const settings = { playerCount: 3, startLife: 30, vibrate: false, keepAwake: false };
  assert.equal(save(storage, { settings, game }), true);
  const loaded = loadSaved(storage);
  assert.deepEqual(loaded.settings, settings);
  assert.deepEqual(loaded.game, game);
});

test('corrupt, foreign or outdated data never throws', () => {
  for (const text of ['{not json', 'null', '42', '"x"', '{"v":99}', '{"v":1}', '{"v":1,"game":{"players":[]}}']) {
    const { settings, game } = loadSaved(fakeStorage({ [STORAGE_KEY]: text }));
    assert.deepEqual(settings, { ...DEFAULT_SETTINGS }, text);
    assert.equal(game, null, text);
  }
  const throwing = { getItem() { throw new Error('blocked'); } };
  assert.equal(loadSaved(throwing).game, null);
});

test('save reports failure instead of throwing when storage is full or blocked', () => {
  const full = { setItem() { throw new DOMException('quota', 'QuotaExceededError'); } };
  assert.equal(save(full, { settings: DEFAULT_SETTINGS, game: null }), false);
});

test('settings are sanitized', () => {
  assert.deepEqual(sanitizeSettings({ playerCount: 99, startLife: -5, vibrate: 'yes', keepAwake: 0 }), {
    playerCount: 6,
    startLife: 1,
    vibrate: true,
    keepAwake: true,
  });
  assert.deepEqual(sanitizeSettings(undefined), { ...DEFAULT_SETTINGS });
});

test('getStorage falls back to memory when localStorage is unavailable', () => {
  const storage = getStorage(); // Node has no localStorage -> in-memory fallback
  storage.setItem('a', '1');
  assert.equal(storage.getItem('a'), '1');
  assert.equal(storage.getItem('missing'), null);
  storage.removeItem('a');
  assert.equal(storage.getItem('a'), null);
  assert.equal(storage.persistent, false);
});

test('saver batches writes and flush() writes immediately', async () => {
  const storage = fakeStorage();
  let writes = 0;
  const original = storage.setItem;
  storage.setItem = (k, v) => {
    writes++;
    original(k, v);
  };
  let counter = 0;
  const saver = createSaver(storage, () => ({ settings: DEFAULT_SETTINGS, game: { n: ++counter } }), 20);
  saver.schedule();
  saver.schedule();
  saver.schedule();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(writes, 1, 'three changes inside the delay cost one write');
  saver.schedule();
  saver.flush();
  assert.equal(writes, 2, 'flush writes right away');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(writes, 2, 'and the pending timer is cancelled');
  saver.flush();
  assert.equal(writes, 2, 'flush without pending changes does nothing');
});
