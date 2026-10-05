// One player field: big life total, tap zones, +/-5 buttons, counter chips and the counter panel.
// The DOM is built once and then only updated in place, so elements that currently hold a captured
// pointer (hold-to-repeat) are never replaced.

import { h, icon, setAttr, setText } from './dom.js';
import { attachHold } from './hold.js';
import { getColor } from './palette.js';
import { COMMANDER_LETHAL, POISON_LETHAL, eliminationReasons, getBurst } from './game.js';
import { REASON_LABELS, formatNumber, formatSigned } from './format.js';

const MISC_COUNTERS = [
  { kind: 'poison', label: 'Gift', icon: 'drop', hint: `ab ${POISON_LETHAL} ausgeschieden` },
  { kind: 'energy', label: 'Energie', icon: 'bolt', hint: '' },
  { kind: 'experience', label: 'Erfahrung', icon: 'star', hint: '' },
];

const MARKERS = [
  { kind: 'monarch', label: 'Monarch', icon: 'crown' },
  { kind: 'initiative', label: 'Initiative', icon: 'tower' },
];

const STARTER_FLASH_MS = 3200;

// api: { change(target, delta, phase), toggleMarker(kind, pid), editPlayer(pid) }
export function createField({ cell, playerCount, api }) {
  const seat = cell.seat;
  const ui = { open: false, page: 'cmd', cmdSrc: null, miscKind: 'poison' };
  let game = null;
  let renderedColor = '';
  let renderedName = null;
  let chipsKey = null;
  let deltaTimer = 0;
  let starterTimer = 0;

  const lifeTarget = { pid: seat, kind: 'life' };
  const opponents = Array.from({ length: playerCount }, (_, i) => i).filter((i) => i !== seat);

  // ---- main view ------------------------------------------------------------------------------
  const zoneMinus = h('button', { class: 'zone zone-minus', type: 'button' });
  const zonePlus = h('button', { class: 'zone zone-plus', type: 'button' });
  attachHold(zoneMinus, (size, phase) => api.change(lifeTarget, -size, phase));
  attachHold(zonePlus, (size, phase) => api.change(lifeTarget, size, phase));

  const lifeEl = h('div', { class: 'life', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const outMark = h('div', { class: 'out-mark', hidden: true }, icon('skull', 'out-icon'));
  const deltaEl = h('div', { class: 'delta', hidden: true, 'aria-hidden': 'true' });
  const chipsBtn = h('button', { class: 'chips', type: 'button', hidden: true, onclick: () => setOpen(true) });

  const minus5 = h('button', { class: 'btn5 btn5-minus', type: 'button', onclick: () => api.change(lifeTarget, -5, 'step5') }, '−5');
  const plus5 = h('button', { class: 'btn5 btn5-plus', type: 'button', onclick: () => api.change(lifeTarget, 5, 'step5') }, '+5');
  const nameText = h('span', { class: 'name-text' });
  const nameBtn = h('button', { class: 'name', type: 'button', onclick: () => api.editPlayer(seat) }, nameText, icon('pencil', 'icon name-icon'));
  const toggleBtn = h('button', { class: 'toggle', type: 'button', 'aria-expanded': 'false', onclick: () => setOpen(!ui.open) },
    icon('chevron-up'), h('span', { class: 'toggle-label' }, 'Zähler'));

  // ---- counter panel --------------------------------------------------------------------------
  const cmdSelectors = new Map(); // source seat -> { btn, val }
  const cmdRow = h('div', { class: 'sel-row', role: 'group', 'aria-label': 'Commander-Schaden von' });
  for (const src of opponents) {
    const dot = h('span', { class: 'dot' });
    const val = h('span', { class: 'sel-val' }, '0');
    const btn = h('button', {
      class: 'sel',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        ui.cmdSrc = src;
        refreshPanel();
      },
    }, dot, val);
    cmdSelectors.set(src, { btn, dot, val });
    cmdRow.append(btn);
  }

  const miscSelectors = new Map(); // counter kind -> { btn, val }
  const markerButtons = new Map(); // marker kind -> button
  const miscRow = h('div', { class: 'sel-row', role: 'group', 'aria-label': 'Zähler und Marker' });
  for (const counter of MISC_COUNTERS) {
    const val = h('span', { class: 'sel-val' }, '0');
    const btn = h('button', {
      class: 'sel',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        ui.miscKind = counter.kind;
        refreshPanel();
      },
    }, icon(counter.icon, `icon sel-icon sel-icon-${counter.kind}`), val);
    miscSelectors.set(counter.kind, { btn, val });
    miscRow.append(btn);
  }
  for (const marker of MARKERS) {
    const btn = h('button', {
      class: 'sel sel-toggle',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => api.toggleMarker(marker.kind, seat),
    }, icon(marker.icon, `icon sel-icon sel-icon-${marker.kind}`));
    markerButtons.set(marker.kind, btn);
    miscRow.append(btn);
  }

  // The label has a long and a short form; CSS picks one by frame width.
  const stepLabelLong = h('span', { class: 'lbl-long' });
  const stepLabelShort = h('span', { class: 'lbl-short' });
  const stepLabel = h('span', { class: 'step-label' }, stepLabelLong, stepLabelShort);
  const stepHint = h('span', { class: 'step-hint' });
  const stepValue = h('span', { class: 'step-value' });
  const stepMinus = h('button', { class: 'step-btn step-minus', type: 'button' }, icon('minus'));
  const stepPlus = h('button', { class: 'step-btn step-plus', type: 'button' }, icon('plus'));
  const stepper = h('div', { class: 'stepper' }, stepLabel, stepMinus, stepValue, stepPlus, stepHint);

  const currentTarget = () => (ui.page === 'cmd'
    ? { pid: seat, kind: 'cmd', src: ui.cmdSrc }
    : { pid: seat, kind: ui.miscKind });
  attachHold(stepMinus, (size, phase) => api.change(currentTarget(), -size, phase), { accelerate: () => ui.page === 'cmd' });
  attachHold(stepPlus, (size, phase) => api.change(currentTarget(), size, phase), { accelerate: () => ui.page === 'cmd' });

  const tabCmd = h('button', { class: 'tab', type: 'button', 'aria-pressed': 'true', 'aria-label': 'Commander-Schaden', onclick: () => setPage('cmd') },
    icon('shield'), h('span', { class: 'tab-label' }, 'Commander'));
  const tabMisc = h('button', { class: 'tab', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Gift, Energie, Erfahrung und Marker', onclick: () => setPage('misc') },
    icon('drop'), h('span', { class: 'tab-label' }, 'Zähler'));
  const closeBtn = h('button', { class: 'tab tab-close', type: 'button', onclick: () => setOpen(false) }, icon('close'));

  const panel = h('div', { class: 'panel', hidden: true, role: 'group' },
    h('div', { class: 'panel-body' }, cmdRow, miscRow, stepper),
    h('div', { class: 'panel-bar' }, tabCmd, tabMisc, closeBtn));

  // ---- assembly -------------------------------------------------------------------------------
  const content = h('div', { class: 'fc' },
    zoneMinus, zonePlus,
    icon('minus', 'sym sym-minus'), icon('plus', 'sym sym-plus'),
    outMark, lifeEl, deltaEl, chipsBtn,
    h('div', { class: 'bar' }, minus5, nameBtn, toggleBtn, plus5),
    panel);

  const el = h('section', {
    class: `field ${Object.entries(cell.edges).filter(([, on]) => on).map(([edge]) => `edge-${edge}`).join(' ')}`,
    dataset: { seat: String(seat) },
    style: { 'grid-row': `${cell.row} / span ${cell.rowSpan}`, 'grid-column': `${cell.col} / span ${cell.colSpan}` },
  }, h('div', { class: 'field-inner' },
    h('div', { class: `frame${cell.sideways ? ' sideways' : ''}`, dataset: { rotation: String(cell.rotation) }, style: { '--rot': `${cell.rotation}deg` } }, content)));

  // ---- behaviour ------------------------------------------------------------------------------
  function setPage(page) {
    ui.page = page;
    refreshPanel();
  }

  function setOpen(open) {
    if (ui.open === open) return;
    const hadFocusInside = panel.contains(document.activeElement);
    ui.open = open;
    panel.hidden = !open;
    toggleBtn.setAttribute('aria-expanded', String(open));
    el.classList.toggle('has-panel', open);
    if (open) {
      refreshPanel();
      requestAnimationFrame(() => panel.querySelector('.sel[aria-pressed="true"]')?.focus({ preventScroll: true }));
    } else if (hadFocusInside) {
      toggleBtn.focus({ preventScroll: true });
    }
  }

  function refreshPanel() {
    if (!game || !ui.open) return;
    const p = game.players[seat];
    const onCmd = ui.page === 'cmd';
    cmdRow.hidden = !onCmd || opponents.length === 1; // a single opponent needs no selector
    miscRow.hidden = onCmd;
    tabCmd.setAttribute('aria-pressed', String(onCmd));
    tabMisc.setAttribute('aria-pressed', String(!onCmd));
    setAttr(panel, 'aria-label', `Zähler von ${p.name}`);

    if (ui.cmdSrc === null || ui.cmdSrc === seat) ui.cmdSrc = opponents[0];

    for (const [src, c] of cmdSelectors) {
      const source = game.players[src];
      const value = p.cmd[src];
      c.dot.style.background = getColor(source.color).bg;
      setText(c.val, String(value));
      c.btn.setAttribute('aria-pressed', String(src === ui.cmdSrc));
      c.btn.classList.toggle('is-lethal', value >= COMMANDER_LETHAL);
      setAttr(c.btn, 'aria-label', `Commander-Schaden von ${source.name}: ${value}`);
    }
    for (const counter of MISC_COUNTERS) {
      const c = miscSelectors.get(counter.kind);
      const value = p[counter.kind];
      setText(c.val, String(value));
      c.btn.setAttribute('aria-pressed', String(counter.kind === ui.miscKind));
      c.btn.classList.toggle('is-lethal', counter.kind === 'poison' && value >= POISON_LETHAL);
      setAttr(c.btn, 'aria-label', `${counter.label}: ${value}`);
    }
    for (const marker of MARKERS) {
      const btn = markerButtons.get(marker.kind);
      const on = game[marker.kind] === seat;
      btn.setAttribute('aria-pressed', String(on));
      setAttr(btn, 'aria-label', `${marker.label}${on ? ' (aktiv)' : ''}`);
    }

    let label;
    let shortLabel;
    let hint = '';
    let value;
    let lethal = false;
    if (onCmd) {
      const source = game.players[ui.cmdSrc];
      label = `Commander-Schaden von ${source.name}`;
      shortLabel = `von ${source.name}`;
      hint = `ab ${COMMANDER_LETHAL} ausgeschieden`;
      value = p.cmd[ui.cmdSrc];
      lethal = value >= COMMANDER_LETHAL;
    } else {
      const counter = MISC_COUNTERS.find((c) => c.kind === ui.miscKind);
      label = counter.label;
      shortLabel = counter.label;
      hint = counter.hint;
      value = p[counter.kind];
      lethal = counter.kind === 'poison' && value >= POISON_LETHAL;
    }
    setText(stepLabelLong, label);
    setText(stepLabelShort, shortLabel);
    setText(stepHint, hint);
    setText(stepValue, String(value));
    stepper.classList.toggle('is-lethal', lethal);
    setAttr(stepMinus, 'aria-label', `${label} verringern`);
    setAttr(stepPlus, 'aria-label', `${label} erhöhen`);
  }

  // Commander shields take the colour of the player who dealt the damage.
  function makeChip(c) {
    const svg = icon(c.icon, 'icon chip-icon');
    if (c.iconColor) svg.style.color = c.iconColor;
    return h('span', { class: c.cls, title: c.label }, svg, c.text ? h('span', {}, c.text) : null);
  }

  function renderChips(p, reasons) {
    const chips = [];
    if (reasons.length > 0) {
      chips.push({ key: 'out', cls: 'chip chip-out', icon: 'skull', text: reasons.map((r) => REASON_LABELS[r]).join(' · '), label: `Ausgeschieden: ${reasons.map((r) => REASON_LABELS[r]).join(', ')}` });
    }
    for (const src of opponents) {
      const value = p.cmd[src];
      if (value <= 0) continue;
      const source = game.players[src];
      chips.push({
        key: `c${src}:${source.color}`,
        cls: `chip${value >= COMMANDER_LETHAL ? ' is-lethal' : ''}`,
        icon: 'shield',
        iconColor: getColor(source.color).bg,
        text: String(value),
        label: `Commander-Schaden von ${source.name}: ${value}`,
      });
    }
    for (const counter of MISC_COUNTERS) {
      const value = p[counter.kind];
      if (value <= 0) continue;
      chips.push({
        key: counter.kind,
        cls: `chip chip-${counter.kind}${counter.kind === 'poison' && value >= POISON_LETHAL ? ' is-lethal' : ''}`,
        icon: counter.icon,
        text: String(value),
        label: `${counter.label}: ${value}`,
      });
    }
    for (const marker of MARKERS) {
      if (game[marker.kind] !== seat) continue;
      chips.push({ key: marker.kind, cls: `chip chip-${marker.kind}`, icon: marker.icon, text: '', label: marker.label });
    }

    const key = JSON.stringify(chips);
    if (key === chipsKey) return;
    chipsKey = key;
    chipsBtn.replaceChildren(...chips.map(makeChip));
    chipsBtn.hidden = chips.length === 0;
    setAttr(chipsBtn, 'aria-label', chips.length ? `Zähler öffnen. ${chips.map((c) => c.label).join(', ')}` : 'Zähler öffnen');
  }

  function renderBurst(burst, now) {
    clearTimeout(deltaTimer);
    if (!burst || burst.delta === 0) {
      deltaEl.hidden = true;
      return;
    }
    setText(deltaEl, formatSigned(burst.delta));
    deltaEl.dataset.sign = burst.delta > 0 ? 'plus' : 'minus';
    deltaEl.hidden = false;
    deltaTimer = setTimeout(() => {
      deltaEl.hidden = true;
    }, Math.max(0, burst.expiresAt - now) + 40);
  }

  function update(nextGame, now = Date.now()) {
    game = nextGame;
    const p = game.players[seat];

    if (renderedColor !== p.color) {
      renderedColor = p.color;
      const color = getColor(p.color);
      el.style.setProperty('--pc-bg', color.bg);
      el.style.setProperty('--pc-fg', color.fg);
    }

    if (renderedName !== p.name) {
      renderedName = p.name;
      setText(nameText, p.name);
      zoneMinus.setAttribute('aria-label', `${p.name}: Leben verringern`);
      zonePlus.setAttribute('aria-label', `${p.name}: Leben erhöhen`);
      minus5.setAttribute('aria-label', `${p.name}: Leben um 5 verringern`);
      plus5.setAttribute('aria-label', `${p.name}: Leben um 5 erhöhen`);
      nameBtn.setAttribute('aria-label', `Name und Farbe von ${p.name} ändern`);
      toggleBtn.setAttribute('aria-label', `Zähler von ${p.name}`);
    }

    const lifeText = formatNumber(p.life);
    if (lifeEl.textContent !== lifeText) {
      lifeEl.textContent = lifeText;
      lifeEl.style.setProperty('--len', String(Math.max(2, lifeText.length)));
    }

    const reasons = eliminationReasons(p);
    el.classList.toggle('is-out', reasons.length > 0);
    outMark.hidden = reasons.length === 0;

    renderChips(p, reasons);
    renderBurst(getBurst(game, seat, now), now);
    refreshPanel();
  }

  function flashStarter() {
    clearTimeout(starterTimer);
    el.classList.remove('is-starter');
    void el.offsetWidth; // restart the animation if it is already running
    el.classList.add('is-starter');
    starterTimer = setTimeout(() => el.classList.remove('is-starter'), STARTER_FLASH_MS);
  }

  function destroy() {
    clearTimeout(deltaTimer);
    clearTimeout(starterTimer);
  }

  return { el, seat, update, flashStarter, destroy, closePanel: () => setOpen(false) };
}
