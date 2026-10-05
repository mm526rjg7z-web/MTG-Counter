import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYBOARD_MIN_PX, TAP_TOLERANCE_PX, describeTap, describeViewport, isEditable, isStandalone, shouldRealign, watchViewport } from '../js/viewport.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- decisions ----------------------------------------------------------------------------------

const steady = { offsetTop: 0, offsetLeft: 0, scale: 1, height: 797, innerHeight: 797 };

test('isEditable: only elements that open the keyboard count', () => {
  assert.equal(isEditable({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isEditable({ tagName: 'INPUT', type: 'number' }), true);
  assert.equal(isEditable({ tagName: 'input' }), true, 'no type means text');
  assert.equal(isEditable({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditable({ tagName: 'DIV', isContentEditable: true }), true);
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'range']) {
    assert.equal(isEditable({ tagName: 'INPUT', type }), false, type);
  }
  assert.equal(isEditable({ tagName: 'BUTTON' }), false);
  assert.equal(isEditable({ tagName: 'DIV' }), false);
  assert.equal(isEditable(null), false);
  assert.equal(isEditable(undefined), false);
});

test('shouldRealign: a displaced visual viewport without a reason is corrected', () => {
  assert.equal(shouldRealign(steady, false), false, 'aligned: nothing to do');
  assert.equal(shouldRealign({ ...steady, offsetTop: 59 }, false), true);
  assert.equal(shouldRealign({ ...steady, offsetTop: -47 }, false), true);
  assert.equal(shouldRealign({ ...steady, offsetLeft: 12 }, false), true);
  assert.equal(shouldRealign({ ...steady, offsetTop: 0.4, offsetLeft: -0.4 }, false), false, 'sub-pixel noise is ignored');
});

test('shouldRealign: leaves the browser alone while the keyboard or a pinch explains the offset', () => {
  const shifted = { ...steady, offsetTop: 59 };
  assert.equal(shouldRealign(shifted, true), false, 'a text field has focus: the browser pans to the caret');
  assert.equal(shouldRealign({ ...shifted, height: 797 - 336 }, false), false, 'keyboard still on screen');
  assert.equal(shouldRealign({ ...shifted, height: 797 - KEYBOARD_MIN_PX }, false), true, 'at the limit it is not a keyboard');
  assert.equal(shouldRealign({ ...shifted, height: 797 - KEYBOARD_MIN_PX - 1 }, false), false);
  assert.equal(shouldRealign({ ...shifted, scale: 2 }, false), false, 'zoomed in on purpose');
});

test('isStandalone: iOS flag or display-mode media query', () => {
  assert.equal(isStandalone({ navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ navigator: { standalone: false }, matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isStandalone({ navigator: {}, matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) }), true);
  assert.equal(isStandalone({ navigator: {} }), false, 'no matchMedia, no flag');
});

test('describeViewport lists the measured numbers in German rows', () => {
  const rows = new Map(describeViewport({
    standalone: true,
    innerWidth: 390, innerHeight: 797,
    visualWidth: 390, visualHeight: 797.5,
    offsetTop: 59, offsetLeft: 0, scale: 1,
    screenWidth: 390, screenHeight: 844,
    scrollX: 0, scrollY: 0, bodyTop: -59,
    insets: [47, 0, 34, 0],
  }));
  assert.equal(rows.get('Modus'), 'Home-Bildschirm');
  assert.equal(rows.get('Fenster'), '390 × 797');
  assert.equal(rows.get('Sichtbereich'), '390 × 797.5');
  assert.equal(rows.get('Versatz oben / links'), '59 / 0');
  assert.equal(rows.get('Zoom'), '1');
  assert.equal(rows.get('Bildschirm'), '390 × 844');
  assert.equal(rows.get('Safe Area o / r / u / l'), '47 / 0 / 34 / 0');
  assert.equal(rows.get('Scroll x / y'), '0 / 0');
  assert.equal(rows.get('Body oben'), '-59');
});

test('describeViewport copes with a browser without visualViewport', () => {
  const rows = new Map(describeViewport({
    standalone: false,
    innerWidth: 800, innerHeight: 600,
    visualWidth: null, visualHeight: null, offsetTop: null, offsetLeft: null, scale: 1,
    screenWidth: null, screenHeight: null,
    scrollX: 0, scrollY: 0, bodyTop: 0,
    insets: [0, 0, 0, 0],
  }));
  assert.equal(rows.get('Modus'), 'Browser');
  assert.equal(rows.get('Sichtbereich'), '–');
  assert.equal(rows.get('Versatz oben / links'), '–');
  assert.equal(rows.get('Bildschirm'), '–');
});

test('describeTap: a tap close to the centre fits the drawing', () => {
  assert.deepEqual(describeTap(0, 0), { ok: true, text: 'Tipp erkannt bei x 0, y 0 px. Das passt zur Zeichnung.' });
  const edge = describeTap(TAP_TOLERANCE_PX, -TAP_TOLERANCE_PX);
  assert.equal(edge.ok, true, 'the limit itself still counts as fitting');
  assert.match(edge.text, /x \+22, y −22 px/);
});

test('describeTap: a tap far from the centre says in which direction the touch area is shifted', () => {
  const above = describeTap(3, -41);
  assert.equal(above.ok, false);
  assert.match(above.text, /x \+3, y −41 px, also 41 px über der Mitte/);
  assert.match(above.text, /Tippflächen sind gegen die Zeichnung verschoben/);
  assert.match(describeTap(0, 59).text, /59 px unter der Mitte/);
  assert.match(describeTap(-30, 0).text, /30 px links von der Mitte/);
  assert.match(describeTap(30, 0).text, /30 px rechts von der Mitte/);
  assert.match(describeTap(-40, 50).text, /50 px unter und 40 px links von der Mitte/);
});

// ---- watching (fake window and document) --------------------------------------------------------

function fakeEnvironment({ active = null, innerHeight = 797 } = {}) {
  const visual = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, scale: 1, width: 390, height: innerHeight });
  const scrolls = [];
  const win = Object.assign(new EventTarget(), {
    visualViewport: visual,
    innerHeight,
    scrollTo: (x, y) => scrolls.push([x, y]),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  });
  const styleLog = [];
  const app = {
    offsetHeight: 100,
    style: {
      set display(value) { styleLog.push(value); },
      get display() { return styleLog.at(-1) ?? ''; },
    },
  };
  const doc = Object.assign(new EventTarget(), {
    activeElement: active,
    visibilityState: 'visible',
    getElementById: (id) => (id === 'app' ? app : null),
  });
  return { win, doc, visual, scrolls, styleLog };
}

test('watchViewport: stays quiet while everything is aligned', async () => {
  const env = fakeEnvironment();
  watchViewport(env);
  env.visual.dispatchEvent(new Event('resize'));
  env.win.dispatchEvent(new Event('orientationchange'));
  await sleep(180);
  assert.deepEqual(env.scrolls, []);
});

test('watchViewport: scrolls the document back to the origin when the visual viewport is displaced', async () => {
  const env = fakeEnvironment();
  watchViewport(env);
  env.visual.offsetTop = 59;
  env.visual.dispatchEvent(new Event('resize'));
  await sleep(60);
  assert.deepEqual(env.scrolls[0], [0, 0]);
});

test('watchViewport: reacts to rotation, coming back to the app and a closing keyboard', async () => {
  for (const trigger of [
    (env) => env.win.dispatchEvent(new Event('orientationchange')),
    (env) => env.win.dispatchEvent(new Event('pageshow')),
    (env) => env.doc.dispatchEvent(new Event('visibilitychange')),
    (env) => env.doc.dispatchEvent(new Event('focusout')),
    (env) => env.visual.dispatchEvent(new Event('scroll')),
  ]) {
    const env = fakeEnvironment();
    watchViewport(env);
    await sleep(20); // the checks at start-up are over
    env.scrolls.length = 0;
    env.visual.offsetTop = 47;
    trigger(env);
    await sleep(60);
    assert.ok(env.scrolls.length >= 1, String(trigger));
  }
});

test('watchViewport: does not react to visibilitychange while the page is hidden', async () => {
  const env = fakeEnvironment();
  watchViewport(env);
  await sleep(20);
  env.doc.visibilityState = 'hidden';
  env.visual.offsetTop = 47;
  env.scrolls.length = 0;
  env.doc.dispatchEvent(new Event('visibilitychange'));
  await sleep(60);
  assert.deepEqual(env.scrolls, []);
});

test('watchViewport: keeps its hands off while a text field has focus or the keyboard is up', async () => {
  const typing = fakeEnvironment({ active: { tagName: 'INPUT', type: 'text' } });
  watchViewport(typing);
  typing.visual.offsetTop = 120;
  typing.visual.dispatchEvent(new Event('resize'));

  const keyboard = fakeEnvironment();
  watchViewport(keyboard);
  keyboard.visual.offsetTop = 120;
  keyboard.visual.height = 797 - 336;
  keyboard.visual.dispatchEvent(new Event('resize'));

  await sleep(180);
  assert.deepEqual(typing.scrolls, []);
  assert.deepEqual(keyboard.scrolls, []);
});

test('watchViewport: corrects the offset once the keyboard is gone', async () => {
  const env = fakeEnvironment({ active: { tagName: 'INPUT', type: 'text' } });
  watchViewport(env);
  env.visual.offsetTop = 120;
  env.visual.dispatchEvent(new Event('resize'));
  await sleep(40);
  assert.deepEqual(env.scrolls, [], 'still typing');
  env.doc.activeElement = { tagName: 'BODY' };
  env.doc.dispatchEvent(new Event('focusout'));
  await sleep(60);
  assert.ok(env.scrolls.length >= 1, 'realigned after the field lost focus');
});

test('watchViewport: realign() reports whether it acted, and a budget stops endless fighting', () => {
  const env = fakeEnvironment();
  const { realign } = watchViewport(env);
  assert.equal(realign(), false, 'aligned');
  env.visual.offsetTop = 59;
  const results = Array.from({ length: 12 }, () => realign());
  assert.deepEqual(results, [...Array(8).fill(true), ...Array(4).fill(false)]);
});

test('watchViewport: realign({ force }) scrolls and re-lays out the app container, restoring it afterwards', () => {
  const env = fakeEnvironment();
  const { realign } = watchViewport(env);
  env.scrolls.length = 0;
  assert.equal(realign({ force: true }), true);
  assert.deepEqual(env.scrolls, [[0, 0]]);
  assert.deepEqual(env.styleLog, ['none', ''], 'hidden for one layout pass, then restored');
});

test('watchViewport works in a browser without visualViewport', async () => {
  const env = fakeEnvironment();
  env.win.visualViewport = null;
  const { realign } = watchViewport(env);
  env.win.dispatchEvent(new Event('resize'));
  await sleep(60);
  assert.equal(realign(), false);
  assert.deepEqual(env.scrolls, []);
});
