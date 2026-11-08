// Pure game logic: no DOM, no storage, no timers.
// Every function is immutable and returns a new game object (or the same one if nothing changed),
// so the logic can be unit-tested in Node and the UI can compare references cheaply.
//
// Game shape:
//   {
//     startLife, monarch: playerId|null, initiative: playerId|null,
//     players: [{ id, name, color, life, poison, energy, experience, cmd: [damage taken from seat i] }],
//     history: [{ id, t, kind, pid?, src?, from, to, life? }],   // doubles as the undo stack
//     nextEntryId
//   }
// Commander damage is keyed by the seat of the commander's OWNER (`src`), not by whoever controls it
// right now: players[recipient].cmd[owner]. The recipient's own seat is a source as well: it counts the damage
// a player took from his own commander while an opponent controlled it. A partner commander would need a
// second array of the same shape and a slot in the history entries (see README, "Commander-Schaden").
// Marker entries (monarch / initiative) carry no `pid`; `from` / `to` are holder ids or null.
// A commander entry made while "Commander-Schaden zieht auch Leben ab" is on carries `life: { from, to }`,
// the recipient's life before and after the same change, so one undo reverts both.

import { DEFAULT_COLOR_ORDER, PALETTE, isColorId, pickFreeColor } from './palette.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const DEFAULT_START_LIFE = 40;
export const START_LIFE_MAX = 999;
export const LIFE_MIN = -999;
export const LIFE_MAX = 9999;
export const COUNTER_MAX = 999;
export const COMMANDER_LETHAL = 21;
export const POISON_LETHAL = 10;
export const BURST_MS = 1500; // changes to the same value within this window become one history entry
export const HISTORY_MAX = 1000;
export const NAME_MAX_LENGTH = 16;

export const COUNTER_KINDS = ['poison', 'energy', 'experience'];
export const MARKER_KINDS = ['monarch', 'initiative'];
const VALUE_KINDS = ['life', ...COUNTER_KINDS, 'cmd'];

export function isMarkerKind(kind) {
  return MARKER_KINDS.includes(kind);
}

export function clampInt(value, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function defaultName(index) {
  return `Spieler ${index + 1}`;
}

export function cleanName(name, index) {
  // Array.from counts code points, so a limit never cuts an emoji in half.
  const clean = Array.from((typeof name === 'string' ? name : '').replace(/\s+/g, ' ').trim())
    .slice(0, NAME_MAX_LENGTH)
    .join('')
    .trim();
  return clean || defaultName(index);
}

// ---------------------------------------------------------------------------------------------
// Creation / reset
// ---------------------------------------------------------------------------------------------

// `previous` (optional) lends names and colours to seats that exist in both games.
export function createGame({ playerCount, startLife, previous = null }) {
  const count = clampInt(playerCount, MIN_PLAYERS, MAX_PLAYERS);
  const life = clampInt(startLife, 1, START_LIFE_MAX);
  const old = previous?.players ?? [];
  const used = new Set();
  const colors = [];
  for (let i = 0; i < count; i++) {
    const kept = old[i]?.color;
    if (kept && isColorId(kept) && !used.has(kept)) {
      colors[i] = kept;
      used.add(kept);
    }
  }
  const players = [];
  for (let i = 0; i < count; i++) {
    if (!colors[i]) {
      const preferred = DEFAULT_COLOR_ORDER[i];
      colors[i] = preferred && !used.has(preferred) ? preferred : pickFreeColor(used);
      used.add(colors[i]);
    }
    players.push({
      id: i,
      name: old[i] ? cleanName(old[i].name, i) : defaultName(i),
      color: colors[i],
      life,
      poison: 0,
      energy: 0,
      experience: 0,
      cmd: new Array(count).fill(0),
    });
  }
  return { startLife: life, monarch: null, initiative: null, players, history: [], nextEntryId: 1 };
}

// Same settings, same names and colours, everything else back to the start.
export function resetGame(game) {
  return createGame({ playerCount: game.players.length, startLife: game.startLife, previous: game });
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

export function limitsFor(kind) {
  return kind === 'life' ? [LIFE_MIN, LIFE_MAX] : [0, COUNTER_MAX];
}

function isValidTarget(game, target) {
  const { pid, kind, src } = target ?? {};
  if (!VALUE_KINDS.includes(kind) || !game.players[pid]) return false;
  if (kind !== 'cmd') return true;
  return Number.isInteger(src) && Boolean(game.players[src]);
}

export function getValue(game, target) {
  const player = game.players[target.pid];
  return target.kind === 'cmd' ? player.cmd[target.src] : player[target.kind];
}

function withValue(player, target, value) {
  if (target.kind === 'cmd') {
    return { ...player, cmd: player.cmd.map((v, i) => (i === target.src ? value : v)) };
  }
  return { ...player, [target.kind]: value };
}

// target: { pid, kind: 'life'|'poison'|'energy'|'experience'|'cmd', src? (cmd only) }
// options.linkLife (commander damage only): the recipient's life changes by the opposite of the damage
// that was really added or taken back (+3 damage = -3 life), inside the same history entry.
export function adjust(game, target, delta, now, { linkLife = false } = {}) {
  if (!isValidTarget(game, target) || !Number.isFinite(delta) || delta === 0) return game;
  const current = getValue(game, target);
  const [min, max] = limitsFor(target.kind);
  const next = clampInt(current + delta, min, max);
  if (next === current) return game;
  const linked = linkLife && target.kind === 'cmd';
  const lifeBefore = game.players[target.pid].life;
  const lifeAfter = linked ? clampInt(lifeBefore - (next - current), LIFE_MIN, LIFE_MAX) : lifeBefore;
  const players = game.players.map((p) => {
    if (p.id !== target.pid) return p;
    const changed = withValue(p, target, next);
    return linked ? { ...changed, life: lifeAfter } : changed;
  });
  const meta = target.kind === 'cmd'
    ? { kind: 'cmd', pid: target.pid, src: target.src }
    : { kind: target.kind, pid: target.pid };
  return record({ ...game, players }, meta, current, next, now, linked ? { from: lifeBefore, to: lifeAfter } : null);
}

export function setMarker(game, kind, pid, now) {
  if (!isMarkerKind(kind)) return game;
  if (pid !== null && !game.players[pid]) return game;
  const from = game[kind];
  if (from === pid) return game;
  return record({ ...game, [kind]: pid }, { kind }, from, pid, now);
}

// Marker semantics: only one holder at a time; toggling the holder clears it.
export function toggleMarker(game, kind, pid, now) {
  return setMarker(game, kind, game[kind] === pid ? null : pid, now);
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

// Entries merge only with entries of the same kind of change: a commander entry that also moved the
// life total (`linked`) never merges with one that did not.
function sameKey(entry, meta, linked) {
  if (entry.kind !== meta.kind) return false;
  if (isMarkerKind(meta.kind)) return true;
  return entry.pid === meta.pid && entry.src === meta.src && Boolean(entry.life) === linked;
}

// The values an entry changed. Most entries change exactly one; a linked commander entry changes two.
function touched(entry) {
  if (isMarkerKind(entry.kind)) return [entry.kind];
  const keys = [entry.kind === 'cmd' ? `cmd:${entry.pid}:${entry.src}` : `${entry.kind}:${entry.pid}`];
  if (entry.life) keys.push(`life:${entry.pid}`);
  return keys;
}

function lastIndexWhere(list, predicate) {
  for (let i = list.length - 1; i >= 0; i--) if (predicate(list[i])) return i;
  return -1;
}

// Appends a change to the history. A change to the same value shortly after the previous one is
// merged into that entry (it keeps the original `from`) and moves to the end, so the entry that was
// touched last is always the one that gets undone first. Changes of different values are
// independent of each other, which is why re-ordering them is safe; once a later entry changes one
// of the same values (a life change after linked commander damage), moving would make the stored
// before/after values lie, so then a new entry starts. A merged entry whose net change is zero
// disappears.
function record(game, meta, from, to, now, life = null) {
  const { history } = game;
  const linked = life !== null;
  const index = lastIndexWhere(history, (e) => sameKey(e, meta, linked));
  if (index !== -1 && now - history[index].t <= BURST_MS) {
    const mine = new Set(touched({ ...meta, life }));
    const blocked = history.slice(index + 1).some((e) => touched(e).some((key) => mine.has(key)));
    if (!blocked) {
      const merged = { ...history[index], to, t: now };
      if (linked) merged.life = { from: history[index].life.from, to: life.to };
      const rest = history.filter((_, i) => i !== index);
      const noChange = merged.from === merged.to && (!linked || merged.life.from === merged.life.to);
      return { ...game, history: noChange ? rest : [...rest, merged] };
    }
  }
  const entry = { id: game.nextEntryId, t: now, ...meta, from, to, ...(linked ? { life } : {}) };
  const next = [...history, entry];
  return {
    ...game,
    history: next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next,
    nextEntryId: game.nextEntryId + 1,
  };
}

export function lastEntry(game) {
  return game.history[game.history.length - 1] ?? null;
}

export function canUndo(game) {
  return game.history.length > 0;
}

// Reverts the most recent history entry.
export function undo(game) {
  const last = lastEntry(game);
  if (!last) return game;
  const history = game.history.slice(0, -1);
  if (isMarkerKind(last.kind)) return { ...game, history, [last.kind]: last.from };
  const target = { pid: last.pid, kind: last.kind, src: last.src };
  const players = game.players.map((p) => {
    if (p.id !== last.pid) return p;
    const reverted = withValue(p, target, last.from);
    return last.life ? { ...reverted, life: last.life.from } : reverted;
  });
  return { ...game, players, history };
}

// Running life change of the current burst for the "-7" indicator. null = nothing to show.
// Life lost to commander damage (a linked commander entry) counts as a life change.
export function getBurst(game, pid, now) {
  const index = lastIndexWhere(game.history, (e) => e.pid === pid && (e.kind === 'life' || (e.kind === 'cmd' && e.life)));
  if (index === -1) return null;
  const entry = game.history[index];
  const expiresAt = entry.t + BURST_MS;
  if (now > expiresAt) return null;
  const { from, to } = entry.kind === 'life' ? entry : entry.life;
  return { delta: to - from, expiresAt };
}

// ---------------------------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------------------------

// Why a player is out of the game (empty array = still in). Everything stays editable.
export function eliminationReasons(player) {
  const reasons = [];
  if (player.life <= 0) reasons.push('life');
  if (player.poison >= POISON_LETHAL) reasons.push('poison');
  if (player.cmd.some((v) => v >= COMMANDER_LETHAL)) reasons.push('commander');
  return reasons;
}

export function isEliminated(player) {
  return eliminationReasons(player).length > 0;
}

// ---------------------------------------------------------------------------------------------
// Player appearance
// ---------------------------------------------------------------------------------------------

export function setName(game, pid, name) {
  const player = game.players[pid];
  if (!player) return game;
  const clean = cleanName(name, pid);
  if (clean === player.name) return game;
  return { ...game, players: game.players.map((p) => (p.id === pid ? { ...p, name: clean } : p)) };
}

// Colours stay unique: picking a colour that another player has swaps the two.
export function setColor(game, pid, colorId) {
  const player = game.players[pid];
  if (!player || !PALETTE.some((c) => c.id === colorId) || player.color === colorId) return game;
  const owner = game.players.find((p) => p.color === colorId);
  const players = game.players.map((p) => {
    if (p.id === pid) return { ...p, color: colorId };
    if (owner && p.id === owner.id) return { ...p, color: player.color };
    return p;
  });
  return { ...game, players };
}

// ---------------------------------------------------------------------------------------------
// Restoring from storage: never trust the input, rebuild a clean game or give up.
// ---------------------------------------------------------------------------------------------

function toInt(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clampInt(value, min, max);
}

function toHolder(value, count) {
  return Number.isInteger(value) && value >= 0 && value < count ? value : null;
}

// The optional life part of a commander entry; anything unusable is dropped, the entry itself stays.
function restoreLifePart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const valid = (v) => Number.isInteger(v) && v >= LIFE_MIN && v <= LIFE_MAX;
  return valid(raw.from) && valid(raw.to) ? { from: raw.from, to: raw.to } : null;
}

function restoreEntry(raw, count) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, t, kind, pid, src, from, to } = raw;
  if (!Number.isInteger(id) || typeof t !== 'number' || !Number.isFinite(t)) return null;
  if (isMarkerKind(kind)) {
    const holderFrom = from === null ? null : toHolder(from, count);
    const holderTo = to === null ? null : toHolder(to, count);
    if ((from !== null && holderFrom === null) || (to !== null && holderTo === null)) return null;
    return { id, t, kind, from: holderFrom, to: holderTo };
  }
  if (!VALUE_KINDS.includes(kind) || !Number.isInteger(pid) || pid < 0 || pid >= count) return null;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (kind === 'cmd') {
    if (!Number.isInteger(src) || src < 0 || src >= count) return null;
    const life = restoreLifePart(raw.life);
    return life ? { id, t, kind, pid, src, from, to, life } : { id, t, kind, pid, src, from, to };
  }
  return { id, t, kind, pid, from, to };
}

export function restoreGame(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.players)) return null;
  const count = raw.players.length;
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) return null;
  const used = new Set();
  const players = [];
  for (let i = 0; i < count; i++) {
    const p = raw.players[i];
    if (!p || typeof p !== 'object') return null;
    const color = isColorId(p.color) && !used.has(p.color) ? p.color : pickFreeColor(used);
    used.add(color);
    players.push({
      id: i,
      name: cleanName(p.name, i),
      color,
      life: toInt(p.life, DEFAULT_START_LIFE, LIFE_MIN, LIFE_MAX),
      poison: toInt(p.poison, 0, 0, COUNTER_MAX),
      energy: toInt(p.energy, 0, 0, COUNTER_MAX),
      experience: toInt(p.experience, 0, 0, COUNTER_MAX),
      cmd: Array.from({ length: count }, (_, s) => toInt(Array.isArray(p.cmd) ? p.cmd[s] : 0, 0, 0, COUNTER_MAX)),
    });
  }
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .map((e) => restoreEntry(e, count))
    .filter(Boolean)
    .slice(-HISTORY_MAX);
  const nextEntryId = history.reduce((max, e) => Math.max(max, e.id), 0) + 1;
  return {
    startLife: toInt(raw.startLife, DEFAULT_START_LIFE, 1, START_LIFE_MAX),
    monarch: toHolder(raw.monarch, count),
    initiative: toHolder(raw.initiative, count),
    players,
    history,
    nextEntryId: Math.max(nextEntryId, toInt(raw.nextEntryId, 1, 1, Number.MAX_SAFE_INTEGER)),
  };
}
