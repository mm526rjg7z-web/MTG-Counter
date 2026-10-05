// Dialogs built on the native <dialog> element (focus trap, Esc to close, top layer):
// menu, history, player name/colour, confirmation and help.

import { h, icon } from './dom.js';
import { describeEntry, formatSigned, formatTime, summarizeEntry } from './format.js';
import { lastEntry } from './game.js';
import { PALETTE, getColor } from './palette.js';
import { APP_VERSION } from './version.js';

const byId = (id) => document.getElementById(id);

// actions: { dice, coin, starter, undo, new, settings, rename(pid, name), recolor(pid, colorId) }
export function initDialogs({ getGame, actions }) {
  const menu = byId('dlg-menu');
  const history = byId('dlg-history');
  const help = byId('dlg-help');
  const player = byId('dlg-player');
  const confirmDlg = byId('dlg-confirm');
  const logList = byId('log-list');
  const logEmpty = byId('log-empty');
  const logUndo = byId('log-undo');
  const nameInput = byId('player-name');
  const swatches = byId('player-colors');
  let editing = null;

  byId('about-version').textContent = `Version ${APP_VERSION}`;

  // Close buttons and a tap on the backdrop (the dialog element itself) close any dialog.
  document.addEventListener('click', (event) => {
    event.target.closest?.('[data-close]')?.closest('dialog')?.close();
  });
  for (const dlg of document.querySelectorAll('dialog:not(.overlay)')) {
    dlg.addEventListener('click', (event) => {
      if (event.target === dlg) dlg.close();
    });
  }

  // ---- menu -----------------------------------------------------------------------------------
  function updateMenu() {
    const game = getGame();
    const tile = byId('menu-undo');
    const entry = game ? lastEntry(game) : null;
    tile.disabled = !entry;
    let hint = tile.querySelector('small');
    if (!entry) {
      hint?.remove();
      return;
    }
    if (!hint) {
      hint = h('small');
      tile.append(hint);
    }
    hint.textContent = summarizeEntry(entry, game);
  }

  const handlers = {
    history: openHistory,
    help: () => help.showModal(),
    dice: actions.dice,
    coin: actions.coin,
    starter: actions.starter,
    undo: actions.undo,
    new: actions.new,
    settings: actions.settings,
  };
  menu.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-action]');
    if (!tile || tile.disabled) return;
    menu.close();
    handlers[tile.dataset.action]?.();
  });

  function openMenu() {
    updateMenu();
    menu.showModal();
  }

  // ---- history --------------------------------------------------------------------------------
  function renderHistory() {
    const game = getGame();
    if (!game) return;
    logEmpty.hidden = game.history.length > 0;
    logUndo.disabled = game.history.length === 0;
    logList.replaceChildren(...[...game.history].reverse().map((entry) => {
      const d = describeEntry(entry, game);
      const who = game.players[d.pid];
      // numbers: "Leben: 40 → 33 (−7)", markers: "Anna wird Monarch"
      const what = d.phrase !== null
        ? h('span', { class: 'log-change' }, d.phrase)
        : [`${d.label}: `, h('span', { class: 'log-change' }, `${d.from} → ${d.to} (${formatSigned(d.delta)})`)];
      return h('li', { class: 'log-row' },
        h('span', { class: 'log-time' }, formatTime(entry.t)),
        h('span', { class: 'log-who' }, h('i', { class: 'log-dot', style: { background: getColor(who.color).bg } }), h('span', {}, who.name)),
        h('span', { class: 'log-what' }, what));
    }));
  }

  function openHistory() {
    renderHistory();
    history.showModal();
    byId('dlg-history').querySelector('.dlg-body').scrollTop = 0;
  }

  logUndo.addEventListener('click', () => actions.undo());

  // ---- player name and colour -----------------------------------------------------------------
  function editPlayer(pid) {
    const game = getGame();
    const current = game?.players[pid];
    if (!current) return;
    editing = pid;
    nameInput.value = current.name;
    swatches.replaceChildren(...PALETTE.map((color) => h('label', { class: 'swatch', style: { '--sw': color.bg, '--sw-fg': color.fg } },
      h('input', { type: 'radio', name: 'player-color', value: color.id, 'aria-label': color.name, checked: color.id === current.color }),
      h('span', {}, icon('check')))));
    player.showModal();
    nameInput.select();
  }

  // Name and colour apply live (the board behind the dialog is the preview), so closing the dialog
  // in any way, including Esc and a tap on the backdrop, never loses an edit.
  swatches.addEventListener('change', (event) => {
    if (editing !== null && event.target.name === 'player-color') actions.recolor(editing, event.target.value);
  });
  nameInput.addEventListener('input', () => {
    if (editing !== null) actions.rename(editing, nameInput.value);
  });
  player.addEventListener('close', () => {
    editing = null;
  });

  // ---- confirmation ---------------------------------------------------------------------------
  // Resolves true only for the OK button; Cancel, Esc and a tap on the backdrop resolve false.
  function confirm({ title, text, okLabel }) {
    byId('confirm-title').textContent = title;
    byId('confirm-text').textContent = text;
    byId('confirm-ok').textContent = okLabel;
    return new Promise((resolve) => {
      confirmDlg.returnValue = '';
      confirmDlg.addEventListener('close', () => resolve(confirmDlg.returnValue === 'ok'), { once: true });
      confirmDlg.showModal();
    });
  }

  return {
    openMenu,
    editPlayer,
    confirm,
    // Called after every state change so open dialogs never show stale data.
    refresh() {
      if (menu.open) updateMenu();
      if (history.open) renderHistory();
    },
  };
}
