// App entry: wires game state, board, dialogs, tools and device APIs together.
// Game rules live in js/game.js (pure, tested in Node); this file only connects them to the UI.

import { createBoard } from './js/board.js';
import { initDiagnostics } from './js/diagnostics.js';
import { initDialogs } from './js/dialogs.js';
import { summarizeEntry } from './js/format.js';
import { adjust, createGame, isEliminated, lastEntry, resetGame, setColor, setName, toggleMarker, undo } from './js/game.js';
import { haptic, hapticsSupported, setHapticsEnabled } from './js/haptics.js';
import { getLayout } from './js/layout.js';
import { initSetup } from './js/setup.js';
import { createSaver, getStorage, loadSaved } from './js/storage.js';
import { initTools } from './js/tools.js';
import { watchViewport } from './js/viewport.js';
import { createWakeLock } from './js/wakelock.js';

const $ = (id) => document.getElementById(id);
const TOAST_MS = 2800;
const UPDATE_CHECK_MS = 5 * 60 * 1000; // at most one look for a new version per 5 minutes

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

  // A short note says what was undone: the dock sits where several fingers meet, and with six
  // fields an accidental undo would otherwise go unnoticed.
  let toastTimer = 0;
  function showToast(text) {
    const toast = $('toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  }

  function undoLast() {
    const entry = lastEntry(model.game);
    const next = undo(model.game);
    if (next === model.game) return;
    showToast(`Rückgängig: ${summarizeEntry(entry, model.game)}`);
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
  // Keeps iOS from leaving the visual viewport shifted against the page (taps beside the buttons).
  const diagnostics = initDiagnostics({ viewport: watchViewport() });
  $('btn-diag-setup').addEventListener('click', () => diagnostics.open());
  $('btn-diag-help').addEventListener('click', () => {
    $('dlg-help').close();
    diagnostics.open();
  });

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

  registerServiceWorker({ beforeReload: () => saver.flush() });
}

// Offline support. Service workers need HTTPS (localhost counts as secure).
// A new version installs in the background and takes over at once (see sw.js). The page then reloads
// one time, so a running app never keeps old files; beforeReload() saves the game first.
function registerServiceWorker({ beforeReload }) {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!secure) return;

  // A page that started without a service worker gets one controllerchange for the first install:
  // it already runs the newest files. Every later controllerchange is an update.
  let controlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    beforeReload();
    location.reload();
  });

  window.addEventListener('load', async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register('sw.js');
    } catch (error) {
      console.warn('Service Worker konnte nicht registriert werden:', error);
      return;
    }
    // A home-screen app can stay open for days, so look for a new version whenever it comes back.
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => {});
    });
  });
}
