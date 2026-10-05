// Keeps the page aligned with the screen on iPhones and measures it for the diagnostics dialog.
//
// Background: in a home-screen web app WebKit can leave the visual viewport shifted against the
// layout viewport (reported after the keyboard closed and after a rotation). Fixed content is then
// painted in one place and hit-tested in another, so taps land beside the buttons that are drawn.
// Scrolling the document to its origin makes WebKit sync both again. That is a best-effort repair:
// the diagnostics dialog measures what is actually going on, in case it is not enough.
// The decisions are pure functions (tested in Node); only measureViewport() and watchViewport()
// touch the DOM.

import { formatSigned } from './format.js';

export const KEYBOARD_MIN_PX = 150; // the on-screen keyboard is never smaller than this
export const TAP_TOLERANCE_PX = 22; // a finger aiming at a crosshair lands closer than this
export const TAP_REACH_PX = 110; // taps farther away were meant for something else
const SHIFT_EPSILON_PX = 1;
const SETTLE_MS = [0, 120, 400, 1000]; // WebKit settles after animations, so look a few times
const BUDGET = { max: 8, windowMs: 10_000 }; // never fight the browser in a loop

// Input types that do not open the on-screen keyboard.
const NO_KEYBOARD_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

export function isEditable(el) {
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !NO_KEYBOARD_TYPES.has(String(el.type || 'text').toLowerCase());
  return el.isContentEditable === true;
}

// metrics: { offsetTop, offsetLeft, scale, height, innerHeight } of the visual viewport.
// True when the visual viewport is displaced although nothing explains it.
export function shouldRealign(metrics, editableFocused) {
  if (editableFocused) return false; // the browser pans on purpose to keep the caret visible
  if (Math.abs(metrics.scale - 1) > 0.01) return false; // pinched: panning is expected
  if (metrics.innerHeight - metrics.height > KEYBOARD_MIN_PX) return false; // keyboard still on screen
  return Math.abs(metrics.offsetTop) > SHIFT_EPSILON_PX || Math.abs(metrics.offsetLeft) > SHIFT_EPSILON_PX;
}

export function isStandalone(win = window) {
  return win.navigator?.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true;
}

// ---- measuring ----------------------------------------------------------------------------------

// Reads the safe-area insets: env() cannot be read directly, so a hidden probe takes them as padding.
function readInsets(doc) {
  const probe = doc.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;'
    + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  doc.body.append(probe);
  const style = doc.defaultView.getComputedStyle(probe);
  const insets = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map((v) => Math.round(parseFloat(v) || 0));
  probe.remove();
  return insets;
}

export function measureViewport(win = window, doc = document) {
  const vv = win.visualViewport ?? null;
  return {
    standalone: isStandalone(win),
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    visualWidth: vv ? vv.width : null,
    visualHeight: vv ? vv.height : null,
    offsetTop: vv ? vv.offsetTop : null,
    offsetLeft: vv ? vv.offsetLeft : null,
    scale: vv ? vv.scale : 1,
    screenWidth: win.screen?.width ?? null,
    screenHeight: win.screen?.height ?? null,
    scrollX: win.scrollX,
    scrollY: win.scrollY,
    bodyTop: doc.body.getBoundingClientRect().top,
    insets: readInsets(doc),
  };
}

const num = (value) => (value === null || value === undefined ? '–' : String(Math.round(value * 100) / 100));
const size = (w, h) => (w === null || h === null ? '–' : `${num(w)} × ${num(h)}`);

// Rows [label, value] for the diagnostics dialog (German, as the rest of the UI).
export function describeViewport(m) {
  const [top, right, bottom, left] = m.insets;
  return [
    ['Modus', m.standalone ? 'Home-Bildschirm' : 'Browser'],
    ['Fenster', size(m.innerWidth, m.innerHeight)],
    ['Sichtbereich', size(m.visualWidth, m.visualHeight)],
    ['Versatz oben / links', m.offsetTop === null ? '–' : `${num(m.offsetTop)} / ${num(m.offsetLeft)}`],
    ['Zoom', num(m.scale)],
    ['Bildschirm', size(m.screenWidth, m.screenHeight)],
    ['Safe Area o / r / u / l', `${top} / ${right} / ${bottom} / ${left}`],
    ['Scroll x / y', `${num(m.scrollX)} / ${num(m.scrollY)}`],
    ['Body oben', num(m.bodyTop)],
  ];
}

// dx, dy: where a tap was registered relative to the centre of the drawn crosshair (CSS pixels).
// Whoever aimed at the centre but is registered far away has touch areas that are shifted against the picture.
export function describeTap(dx, dy) {
  const ok = Math.abs(dx) <= TAP_TOLERANCE_PX && Math.abs(dy) <= TAP_TOLERANCE_PX;
  const numbers = `x ${formatSigned(dx)}, y ${formatSigned(dy)} px`;
  if (ok) return { ok, text: `Tipp erkannt bei ${numbers}. Das passt zur Zeichnung.` };
  const where = [];
  if (Math.abs(dy) > TAP_TOLERANCE_PX) where.push(`${Math.abs(dy)} px ${dy < 0 ? 'über' : 'unter'}`);
  if (Math.abs(dx) > TAP_TOLERANCE_PX) where.push(`${Math.abs(dx)} px ${dx < 0 ? 'links von' : 'rechts von'}`);
  return { ok, text: `Tipp erkannt bei ${numbers}, also ${where.join(' und ')} der Mitte. Wer genau die Mitte getroffen hat, dessen Tippflächen sind gegen die Zeichnung verschoben.` };
}

// ---- keeping aligned ----------------------------------------------------------------------------

// Takes the app out of the layout for one frame so WebKit computes the geometry from scratch.
// Only used on request (diagnostics button): it would cancel a finger that is down.
function relayout(doc) {
  const app = doc.getElementById('app');
  if (!app) return;
  app.style.display = 'none';
  void app.offsetHeight;
  app.style.display = '';
}

export function watchViewport({ win = window, doc = document } = {}) {
  const vv = win.visualViewport ?? null;
  const recent = [];
  let timers = [];

  const read = () => ({
    offsetTop: vv?.offsetTop ?? 0,
    offsetLeft: vv?.offsetLeft ?? 0,
    scale: vv?.scale ?? 1,
    height: vv?.height ?? win.innerHeight,
    innerHeight: win.innerHeight,
  });

  // force: skip the checks and also re-layout (diagnostics button). Returns true when it acted.
  function realign({ force = false } = {}) {
    if (!force) {
      if (!shouldRealign(read(), isEditable(doc.activeElement))) return false;
      const now = Date.now();
      while (recent.length > 0 && now - recent[0] > BUDGET.windowMs) recent.shift();
      if (recent.length >= BUDGET.max) return false;
      recent.push(now);
    }
    win.scrollTo(0, 0);
    if (force) relayout(doc);
    return true;
  }

  function schedule() {
    for (const timer of timers) win.clearTimeout(timer);
    timers = SETTLE_MS.map((ms) => win.setTimeout(() => realign(), ms));
  }

  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  win.addEventListener('pageshow', schedule);
  doc.addEventListener('focusout', schedule); // the keyboard is about to close
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') schedule();
  });
  schedule();

  return { realign, schedule };
}
