// Start screen / settings: player count, starting life, options.

import { h, icon } from './dom.js';
import { START_LIFE_MAX } from './game.js';
import { getLayout } from './layout.js';
import { DEFAULT_COLOR_ORDER, getColor } from './palette.js';
import { APP_VERSION } from './version.js';

const PRESETS = [20, 30, 40];

export function initSetup({ vibrateSupported, wakeLockSupported, onStart, onCancel, onOption }) {
  const root = document.getElementById('setup');
  const playerInputs = [...root.querySelectorAll('input[name="players"]')];
  const presetInputs = [...root.querySelectorAll('input[name="life-preset"]')];
  const lifeInput = root.querySelector('#life-input');
  const lifeError = root.querySelector('#life-error');
  const vibrate = root.querySelector('#opt-vibrate');
  const awake = root.querySelector('#opt-awake');
  const startBtn = root.querySelector('#btn-start');
  const cancelBtn = root.querySelector('#btn-setup-cancel');
  const preview = root.querySelector('#setup-preview');
  let playerCount = 4;

  // Only whole numbers from 1 to START_LIFE_MAX count as a valid starting life.
  function readLife() {
    const text = lifeInput.value.trim();
    if (!/^\d{1,4}$/.test(text)) return null;
    const value = Number(text);
    return value >= 1 && value <= START_LIFE_MAX ? value : null;
  }

  function syncLife() {
    const life = readLife();
    const isPreset = life !== null && PRESETS.includes(life);
    for (const input of presetInputs) input.checked = isPreset && Number(input.value) === life;
    lifeInput.classList.toggle('is-custom', life !== null && !isPreset);
    const invalid = life === null;
    lifeInput.classList.toggle('is-invalid', invalid && lifeInput.value.trim() !== '');
    lifeInput.setAttribute('aria-invalid', String(invalid));
    lifeError.hidden = !invalid || lifeInput.value.trim() === '';
    startBtn.disabled = invalid;
  }

  function renderPreview() {
    const layout = getLayout(playerCount);
    preview.replaceChildren(h('div', {
      class: 'pv-grid',
      style: {
        'grid-template-columns': `repeat(${layout.cols}, minmax(0, 1fr))`,
        'grid-template-rows': `repeat(${layout.rows}, minmax(0, 1fr))`,
      },
    }, layout.cells.map((cell) => {
      const color = getColor(DEFAULT_COLOR_ORDER[cell.seat]);
      return h('div', {
        class: 'pv-cell',
        style: {
          'grid-row': `${cell.row} / span ${cell.rowSpan}`,
          'grid-column': `${cell.col} / span ${cell.colSpan}`,
          background: color.bg,
          color: color.fg,
        },
      }, h('div', { class: 'pv-inner', style: { transform: `rotate(${cell.rotation}deg)` } },
        icon('chevron-up'), String(cell.seat + 1)));
    })));
  }

  for (const input of playerInputs) {
    input.addEventListener('change', () => {
      playerCount = Number(input.value);
      renderPreview();
    });
  }
  for (const input of presetInputs) {
    input.addEventListener('change', () => {
      lifeInput.value = input.value;
      syncLife();
    });
  }
  lifeInput.addEventListener('input', syncLife);

  vibrate.addEventListener('change', () => onOption({ vibrate: vibrate.checked }));
  awake.addEventListener('change', () => onOption({ keepAwake: awake.checked }));

  startBtn.addEventListener('click', () => {
    const startLife = readLife();
    if (startLife !== null) onStart({ playerCount, startLife });
  });
  cancelBtn.addEventListener('click', onCancel);

  root.querySelector('#setup-version').textContent = `Version ${APP_VERSION}`;
  root.querySelector('#vibrate-hint').hidden = vibrateSupported;
  vibrate.disabled = !vibrateSupported;
  root.querySelector('#awake-hint').hidden = wakeLockSupported;
  awake.disabled = !wakeLockSupported;

  return {
    // inGame: opened from a running game, so it can be cancelled and starting needs confirmation.
    open(settings, { inGame }) {
      playerCount = settings.playerCount;
      for (const input of playerInputs) input.checked = Number(input.value) === playerCount;
      lifeInput.value = String(settings.startLife);
      vibrate.checked = settings.vibrate;
      awake.checked = settings.keepAwake;
      cancelBtn.hidden = !inGame;
      startBtn.textContent = inGame ? 'Neues Spiel starten' : 'Spiel starten';
      syncLife();
      renderPreview();
      root.hidden = false;
      root.scrollTop = 0;
    },
    close() {
      root.hidden = true;
    },
  };
}
