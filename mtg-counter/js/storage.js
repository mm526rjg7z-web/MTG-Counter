// Persistence in localStorage. Everything is defensive: storage can be missing, full, blocked
// (private mode) or contain garbage from an older version. The app must start in every case.

import { DEFAULT_START_LIFE, MAX_PLAYERS, MIN_PLAYERS, START_LIFE_MAX, clampInt, restoreGame } from './game.js';

export const STORAGE_KEY = 'mtg-counter:v1';
const FORMAT_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  playerCount: 4,
  startLife: DEFAULT_START_LIFE,
  vibrate: true,
  keepAwake: true,
});

export function sanitizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    playerCount: clampInt(r.playerCount ?? DEFAULT_SETTINGS.playerCount, MIN_PLAYERS, MAX_PLAYERS),
    startLife: clampInt(r.startLife ?? DEFAULT_SETTINGS.startLife, 1, START_LIFE_MAX),
    vibrate: typeof r.vibrate === 'boolean' ? r.vibrate : DEFAULT_SETTINGS.vibrate,
    keepAwake: typeof r.keepAwake === 'boolean' ? r.keepAwake : DEFAULT_SETTINGS.keepAwake,
  };
}

// Returns a working Storage-like object. Falls back to memory when localStorage is unusable.
export function getStorage() {
  try {
    const storage = globalThis.localStorage;
    const probe = `${STORAGE_KEY}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    const memory = new Map();
    return {
      persistent: false,
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => void memory.set(key, String(value)),
      removeItem: (key) => void memory.delete(key),
    };
  }
}

// -> { settings, game }  (game is null when there is nothing valid to resume)
export function loadSaved(storage) {
  const fresh = { settings: sanitizeSettings(null), game: null };
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return fresh;
    const data = JSON.parse(text);
    if (!data || data.v !== FORMAT_VERSION) return fresh;
    return { settings: sanitizeSettings(data.settings), game: restoreGame(data.game) };
  } catch {
    return fresh;
  }
}

export function save(storage, { settings, game }) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ v: FORMAT_VERSION, settings, game }));
    return true;
  } catch {
    return false; // quota exceeded or blocked: keep playing, just without persistence
  }
}

// Debounced saver: bursts of changes (hold-to-repeat) cost one write; flush() forces it out
// (called when the page is hidden, because the app can be killed right after).
export function createSaver(storage, read, delay = 120) {
  let timer = null;
  const write = () => {
    timer = null;
    save(storage, read());
  };
  return {
    schedule() {
      if (timer === null) timer = setTimeout(write, delay);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        write();
      }
    },
  };
}
