// App entry: wires game state, board, dialogs, tools and device APIs together.
// Game rules live in js/game.js (pure, tested in Node); this file only connects them to the UI.

import { createBoard } from './js/board.js';
import { initDialogs } from './js/dialogs.js';
import { summarizeEntry } from './js/format.js';
import { adjust, createGame, isEliminated, lastEntry, resetGame, setColor, setName, toggleMarker, undo } from './js/game.js';
import { haptic, hapticsSupported, setHapticsEnabled } from './js/haptics.js';
import { getLayout } from './js/layout.js';
import { initSetup } from './js/setup.js';
import { createSaver, getStorage, loadSaved } from './js/storage.js';
import { initTools } from './js/tools.js';
import { createWakeLock } from './js/wakelock.js';

const $ = (id) => document.getElementById(id);

function browserIsSupported() {
  return typeof CSS !== 'undefined'
    && CSS.supports('container-type', 'size')
    && CSS.supports('color', 'color-mix(in srgb, red, blue)')
    && typeof HTMLDialogElement === 'function';
}

if (browserIsSupported()) {
  main();
} else {
  $('unsupported').hidden = false;
}

function main() {
  const storage = getStorage();
  const saved = loadSaved(storage);
  const model = { settings: saved.settings, game: saved.game, board: null };
  const saver = createSaver(storage, () => ({ settings: model.settings, game: model.game }));
  const wakeLock = createWakeLock();
  const undoBtn = $('btn-undo');

  setHapticsEnabled(model.settings.vibrate);

  // ---- game state changes ---------------------------------------------------------------------
  function commit(next) {
    if (next === model.game) return;
    model.game = next;
    model.board?.update(next);
    syncDock();
    dialogs.refresh();
    saver.schedule();
  }

  // phase: 'tap' | 'repeat' | 'fast' | 'step5' | 'key' (decides the haptic pulse)
  function change(target, delta, phase) {
    const before = model.game;
    const after = adjust(before, target, delta, Date.now());
    if (after === before) return; // clamped at a limit: nothing happened
    commit(after);
    if (!isEliminated(before.players[target.pid]) && isEliminated(after.players[target.pid])) haptic.out();
    else if (phase === 'fast' || phase === 'step5') haptic.big();
    else if (phase === 'repeat') haptic.repeat();
    else haptic.tap();
  }

  function toggleMarkerFor(kind, pid) {
    commit(toggleMarker(model.game, kind, pid, Date.now()));
    haptic.tap();
  }

  function undoLast() {
    const next = undo(model.game);
    if (next === model.game) return;
    commit(next);
    haptic.tap();
  }

  function syncDock() {
    const entry = model.game ? lastEntry(model.game) : null;
    const label = entry ? `Rückgängig: ${summarizeEntry(entry, model.game)}` : 'Rückgängig (nichts zu tun)';
    undoBtn.disabled = !entry;
    undoBtn.setAttribute('aria-label', label);
    undoBtn.title = label;
  }

  // ---- screens --------------------------------------------------------------------------------
  function showGame() {
    setup.close();
    $('game').hidden = false;
    model.board?.destroy();
    const layout = getLayout(model.game.players.length);
    $('game').dataset.dock = layout.dock;
    model.board = createBoard($('board'), { layout, api });
    model.board.update(model.game);
    syncDock();
    saver.schedule();
    if (model.settings.keepAwake) wakeLock.enable();
  }

  async function startFromSetup(values) {
    if (model.game) {
      const ok = await dialogs.confirm({
        title: 'Neues Spiel starten?',
        text: 'Das laufende Spiel wird verworfen.',
        okLabel: 'Neues Spiel',
      });
      if (!ok) return;
    }
    model.settings = { ...model.settings, ...values };
    model.game = createGame({ ...values, previous: model.game });
    showGame();
  }

  async function newGame() {
    const ok = await dialogs.confirm({
      title: 'Neues Spiel starten?',
      text: 'Leben, Zähler und Historie werden zurückgesetzt. Spielerzahl, Startleben, Namen und Farben bleiben erhalten.',
      okLabel: 'Neues Spiel',
    });
    if (!ok) return;
    model.game = resetGame(model.game);
    showGame();
  }

  function changeOption(patch) {
    model.settings = { ...model.settings, ...patch };
    if ('vibrate' in patch) setHapticsEnabled(patch.vibrate);
    if ('keepAwake' in patch && model.game) {
      if (patch.keepAwake) wakeLock.enable();
      else wakeLock.disable();
    }
    saver.schedule();
    if (patch.vibrate) haptic.tap();
  }

  // ---- modules --------------------------------------------------------------------------------
  const api = {
    change,
    toggleMarker: toggleMarkerFor,
    editPlayer: (pid) => dialogs.editPlayer(pid),
  };

  const tools = initTools({
    getGame: () => model.game,
    onStarter: (seat) => model.board?.flashStarter(seat),
  });

  const dialogs = initDialogs({
    getGame: () => model.game,
    actions: {
      dice: () => tools.openDice(),
      coin: () => tools.flipCoin(),
      starter: () => tools.pickStarter(),
      undo: undoLast,
      new: newGame,
      settings: () => setup.open(model.settings, { inGame: true }),
      rename: (pid, name) => commit(setName(model.game, pid, name)),
      recolor: (pid, colorId) => commit(setColor(model.game, pid, colorId)),
    },
  });

  const setup = initSetup({
    vibrateSupported: hapticsSupported,
    wakeLockSupported: wakeLock.supported,
    onStart: startFromSetup,
    onCancel: () => setup.close(),
    onOption: changeOption,
  });

  undoBtn.addEventListener('click', undoLast);
  $('btn-menu').addEventListener('click', () => dialogs.openMenu());

  // ---- device behaviour -----------------------------------------------------------------------
  // iOS Safari reports pinch gestures separately from touch-action.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
  $('board').addEventListener('contextmenu', (event) => event.preventDefault());

  // The page can be killed right after it is hidden, so write pending changes immediately.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saver.flush();
  });
  window.addEventListener('pagehide', () => saver.flush());

  // ---- start ----------------------------------------------------------------------------------
  if (model.game) showGame();
  else setup.open(model.settings, { inGame: false });

  registerServiceWorker();
}

// Offline support. Service workers need HTTPS (localhost counts as secure).
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!secure) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.warn('Service Worker konnte nicht registriert werden:', error);
    });
  });
}
