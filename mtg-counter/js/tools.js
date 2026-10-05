// Dice, coin and random starting player. Results are drawn first (crypto randomness) and the
// animation is purely cosmetic, so the shown result can never differ from the drawn one.

import { h, icon, prefersReducedMotion } from './dom.js';
import { haptic } from './haptics.js';
import { getColor } from './palette.js';
import { DICE, flipCoin, pickIndex, randomInt, rollDice } from './random.js';

const MAX_PER_DIE = 10;
const MAX_TOTAL = 20; // keeps every result on screen: the overlay does not scroll
const ROLL_MS = 700;
const DICE_CYCLE_MS = 65;
const FLIP_MS = 1100;
const CYCLE_MS = 80;
const STARTER_MS = 1000;

const byId = (id) => document.getElementById(id);

// getGame(): current game. onStarter(seat): called after the overlay closed (to highlight the field).
export function initTools({ getGame, onStarter }) {
  const diceDlg = byId('dlg-dice');
  const diceList = byId('dice-list');
  const rollBtn = byId('dice-roll');
  const clearBtn = byId('dice-clear');
  const resultDlg = byId('dlg-result');
  const resultBody = byId('result-body');
  const resultSr = byId('result-sr');
  const againBtn = byId('result-again');

  const counts = Object.fromEntries(DICE.map((sides) => [sides, sides === 20 ? 1 : 0]));
  const rows = new Map();
  let timers = [];
  let again = null;
  let pendingStarter = null;

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function stopTimers() {
    for (const t of timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    timers = [];
  }

  // ---- dice picker ----------------------------------------------------------------------------
  for (const sides of DICE) {
    const count = h('span', { class: 'dice-count', 'aria-live': 'polite' }, '0');
    const minus = h('button', { type: 'button', 'aria-label': `Einen d${sides} weniger`, onclick: () => bump(sides, -1) }, icon('minus'));
    const plus = h('button', { type: 'button', 'aria-label': `Einen d${sides} mehr`, onclick: () => bump(sides, 1) }, icon('plus'));
    const row = h('li', { class: 'dice-row' }, h('span', { class: 'dice-name' }, `d${sides}`), h('div', { class: 'dice-ctl' }, minus, count, plus));
    rows.set(sides, { row, count, minus, plus });
    diceList.append(row);
  }

  const totalDice = () => DICE.reduce((sum, sides) => sum + counts[sides], 0);

  function bump(sides, delta) {
    if (delta > 0 && totalDice() >= MAX_TOTAL) return;
    counts[sides] = Math.min(MAX_PER_DIE, Math.max(0, counts[sides] + delta));
    renderPicker();
  }

  function renderPicker() {
    const total = totalDice();
    for (const [sides, r] of rows) {
      r.count.textContent = String(counts[sides]);
      r.row.classList.toggle('is-active', counts[sides] > 0);
      r.minus.disabled = counts[sides] === 0;
      r.plus.disabled = counts[sides] === MAX_PER_DIE || total >= MAX_TOTAL;
    }
    rollBtn.disabled = total === 0;
    rollBtn.textContent = total === 0 ? 'Würfeln' : `Würfeln (${total})`;
    clearBtn.disabled = total === 0;
  }

  clearBtn.addEventListener('click', () => {
    for (const sides of DICE) counts[sides] = 0;
    renderPicker();
  });
  rollBtn.addEventListener('click', () => {
    diceDlg.close();
    rollSelected();
  });

  // ---- result overlay -------------------------------------------------------------------------
  function openResult(rerun) {
    stopTimers();
    again = rerun;
    // "Nochmal" re-enters while the overlay is open; older browsers throw when a dialog that is
    // already open is opened again.
    if (!resultDlg.open) resultDlg.showModal();
  }

  resultDlg.addEventListener('click', (event) => {
    if (event.target.closest('#result-again')) return;
    resultDlg.close();
  });
  againBtn.addEventListener('click', () => again?.());
  resultDlg.addEventListener('close', () => {
    stopTimers();
    if (pendingStarter !== null) {
      const seat = pendingStarter;
      pendingStarter = null;
      onStarter(seat);
    }
  });

  function rollSelected() {
    const results = rollDice(counts);
    if (results.length === 0) return;
    const size = results.length === 1 ? 200 : results.length <= 4 ? 140 : results.length <= 9 ? 100 : 76;
    const sum = results.reduce((total, r) => total + r.value, 0);
    const dice = results.map((r) => h('div', { class: 'die is-rolling', style: { '--die': `${size}px` } },
      h('span', { class: 'die-val' }, '?'), h('span', { class: 'die-label' }, `d${r.sides}`)));
    const sumValue = h('strong', {}, '…');
    const sumEl = results.length > 1 ? h('div', { class: 'dice-sum' }, 'Summe ', sumValue) : null;
    resultBody.replaceChildren(h('div', { class: 'dice-grid' }, dice), sumEl);
    resultSr.textContent = '';
    openResult(rollSelected);

    const finish = () => {
      stopTimers();
      dice.forEach((die, i) => {
        die.classList.remove('is-rolling');
        die.querySelector('.die-val').textContent = String(results[i].value);
      });
      sumValue.textContent = String(sum);
      resultSr.textContent = `Ergebnis: ${results.map((r) => `d${r.sides}: ${r.value}`).join(', ')}${results.length > 1 ? `. Summe ${sum}` : ''}`;
      haptic.roll();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    timers.push(setInterval(() => {
      dice.forEach((die, i) => {
        die.querySelector('.die-val').textContent = String(1 + randomInt(results[i].sides));
      });
    }, DICE_CYCLE_MS));
    later(finish, ROLL_MS);
  }

  function flip() {
    const side = flipCoin();
    const label = side === 'heads' ? 'Kopf' : 'Zahl';
    const coin = h('div', { class: `coin ${side}` },
      h('div', { class: 'coin-face coin-heads' }, 'KOPF'),
      h('div', { class: 'coin-face coin-tails' }, 'ZAHL'));
    const title = h('p', { class: 'result-title' }, ' ');
    resultBody.replaceChildren(h('div', { class: 'coin-stage' }, coin), title);
    resultSr.textContent = '';
    openResult(flip);

    const finish = () => {
      title.textContent = label.toUpperCase();
      resultSr.textContent = `Ergebnis: ${label}`;
      haptic.roll();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    coin.classList.add('is-flipping');
    later(finish, FLIP_MS);
  }

  function pickStarter() {
    const game = getGame();
    if (!game) return;
    const players = game.players;
    const index = pickIndex(players.length);
    const name = h('div', { class: 'starter-name' }, ' ');
    const sub = h('div', { class: 'starter-sub' }, ' ');
    const card = h('div', { class: 'starter' }, name, sub);
    const show = (player, done) => {
      const color = getColor(player.color);
      card.style.setProperty('--sc-bg', color.bg);
      card.style.setProperty('--sc-fg', color.fg);
      name.textContent = player.name;
      sub.textContent = done ? 'beginnt!' : ' ';
    };
    show(players[0], false);
    resultBody.replaceChildren(card);
    resultSr.textContent = '';
    pendingStarter = null;
    openResult(pickStarter);

    const finish = () => {
      stopTimers();
      show(players[index], true);
      resultSr.textContent = `${players[index].name} beginnt`;
      pendingStarter = index;
      haptic.roll();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    let step = 0;
    timers.push(setInterval(() => show(players[++step % players.length], false), CYCLE_MS));
    later(finish, STARTER_MS);
  }

  renderPicker();

  return {
    openDice() {
      renderPicker();
      diceDlg.showModal();
    },
    flipCoin: flip,
    pickStarter,
  };
}
