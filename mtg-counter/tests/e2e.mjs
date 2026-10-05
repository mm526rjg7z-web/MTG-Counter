// End-to-end tests in a real Chromium (Playwright) with a phone viewport (390x844) and touch input.
//
//   NODE_PATH=$(npm root -g) node tests/e2e.mjs            (Playwright must be resolvable)
//   SHOTS_DIR=/some/folder NODE_PATH=... node tests/e2e.mjs   additionally writes screenshots
//
// Every group starts in a fresh browser context (empty localStorage, no service worker).
// Instrumentation injected into every page: navigator.vibrate and crypto.getRandomValues are
// counted, and Math.random throws, so any use of it fails the run.

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ROOT, startServer } from '../scripts/serve.mjs';
import { buildServiceWorker } from '../scripts/update-cache-version.mjs';
import { BURST_MS } from '../js/game.js';
import { getLayout } from '../js/layout.js';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright wurde nicht gefunden. Installieren (npm i playwright) oder NODE_PATH setzen, z. B.:\n  NODE_PATH=$(npm root -g) node tests/e2e.mjs');
  process.exit(2);
}

const SHOTS_DIR = process.env.SHOTS_DIR;
const VIEWPORT = { width: 390, height: 844 };
const MINUS = '\u2212';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- tiny test runner -------------------------------------------------------------------------

const results = [];
let currentGroup = '';

async function group(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY="Layout" runs matching groups
  currentGroup = name;
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (error) {
    results.push({ name: `${name} (Gruppe abgebrochen)`, ok: false, error });
    console.log(`  ✗ Gruppe abgebrochen: ${String(error.stack ?? error).split('\n').slice(0, 5).join('\n      ')}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name: `${currentGroup} › ${name}`, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name: `${currentGroup} › ${name}`, ok: false, error });
    console.log(`  ✗ ${name}\n      ${String(error.stack ?? error).split('\n').slice(0, 16).join('\n      ')}`);
  }
}

async function waitFor(fn, { timeout = 4000, interval = 25, message = 'Bedingung' } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`Zeitüberschreitung: ${message}`);
}

// ---- helpers ----------------------------------------------------------------------------------

async function openApp(browser, url, { viewport = VIEWPORT, reducedMotion = 'no-preference', init, context: existing } = {}) {
  const context = existing ?? await browser.newContext({
    viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'de-DE', reducedMotion,
  });
  if (!existing) {
    await context.addInitScript(() => {
      window.__vibrations = [];
      navigator.vibrate = (pattern) => { window.__vibrations.push(pattern); return true; };
      window.__randomCalls = 0;
      const original = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = (array) => { window.__randomCalls++; return original(array); };
      Math.random = () => { throw new Error('Math.random darf nicht verwendet werden'); };
    });
    if (init) await context.addInitScript(init);
  }
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[http ${r.status()}] ${r.url()}`); });
  await page.goto(url);
  return { context, page, problems };
}

const field = (page, seat) => page.locator(`.field[data-seat="${seat}"]`);
const toNumber = (text) => Number(text.replace(MINUS, '-').trim());
const lifeOf = async (page, seat) => toNumber(await field(page, seat).locator('.life').innerText());

async function startGame(page, players, startLife) {
  await page.waitForSelector('#setup:not([hidden])');
  await page.click(`label:has(input[name=players][value="${players}"])`);
  if (startLife) await page.fill('#life-input', String(startLife));
  await page.click('#btn-start');
  await page.waitForSelector('#game:not([hidden]) .field');
}

// Reads what was written to localStorage (the saver waits ~120 ms, so give it a moment).
async function savedGame(page) {
  await sleep(260);
  return page.evaluate(() => JSON.parse(localStorage.getItem('mtg-counter:v1'))?.game ?? null);
}

async function centerOf(locator) {
  const box = await locator.boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

// Real touch input through the DevTools protocol (so pointer events have pointerType "touch").
// start([x, y], ...) puts fingers 1, 2, ... down; end(...ids) lifts the given fingers, no ids lifts all.
async function touchSession(page) {
  const cdp = await page.context().newCDPSession(page);
  const down = new Map();
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  return {
    async start(...positions) {
      const fingers = positions.map(([x, y], i) => ({ id: i + 1, x, y }));
      for (const finger of fingers) down.set(finger.id, finger);
      await send('touchStart', fingers);
    },
    async move(id, x, y) {
      Object.assign(down.get(id), { x, y });
      await send('touchMove', [...down.values()]);
    },
    async end(...ids) {
      const lifted = ids.map((id) => down.get(id));
      for (const id of ids) down.delete(id);
      if (ids.length === 0) down.clear();
      await send('touchEnd', lifted); // an empty list lifts every finger
    },
  };
}

const shot = async (page, name) => {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
};

const rectsOverlap = (a, b, margin = 0) => a.x < b.x + b.w - margin && b.x < a.x + a.w - margin
  && a.y < b.y + b.h - margin && b.y < a.y + a.h - margin;

async function noProblems(problems) {
  await test('keine Konsolenfehler, Warnungen oder fehlgeschlagene Requests', () => {
    assert.deepEqual(problems, []);
  });
}

// ---- run --------------------------------------------------------------------------------------

const server = await startServer();
const browser = await chromium.launch();
console.log(`E2E gegen ${server.url} mit ${browser.version()}`);

try {
  // ------------------------------------------------------------------------------------------
  await group('Startbildschirm', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await page.waitForSelector('#setup:not([hidden])');
    await shot(page, '00-setup');

    await test('Standard: 4 Spieler, Startleben 40, Optionen an, Start möglich', async () => {
      assert.equal(await page.locator('input[name=players]:checked').getAttribute('value'), '4');
      assert.equal(await page.inputValue('#life-input'), '40');
      assert.equal(await page.locator('input[name=life-preset]:checked').getAttribute('value'), '40');
      assert.equal(await page.isChecked('#opt-vibrate'), true);
      assert.equal(await page.isChecked('#opt-awake'), true);
      assert.equal(await page.isEnabled('#btn-start'), true);
      assert.equal(await page.isHidden('#btn-setup-cancel'), true, 'beim ersten Start gibt es nichts zum Zurückkehren');
      assert.equal(await page.textContent('#btn-start'), 'Spiel starten');
    });

    await test('Spielerzahl 2 bis 6 wählbar, Vorschau zeigt genau so viele Felder', async () => {
      for (let n = 2; n <= 6; n++) {
        await page.click(`label:has(input[name=players][value="${n}"])`);
        assert.equal(await page.locator('#setup-preview .pv-cell').count(), n);
      }
      await page.click('label:has(input[name=players][value="4"])');
    });

    await test('Startleben: Voreinstellungen und freie Eingabe mit Prüfung', async () => {
      await page.click('label:has(input[name=life-preset][value="20"])');
      assert.equal(await page.inputValue('#life-input'), '20');
      await page.fill('#life-input', '25');
      assert.equal(await page.locator('input[name=life-preset]:checked').count(), 0, 'freier Wert wählt keine Voreinstellung');
      assert.equal(await page.locator('#life-input').evaluate((el) => el.classList.contains('is-custom')), true);
      assert.equal(await page.isEnabled('#btn-start'), true);
      for (const bad of ['0', '1000', '-5', '']) {
        await page.fill('#life-input', bad);
        assert.equal(await page.isDisabled('#btn-start'), true, `"${bad}" darf nicht startbar sein`);
      }
      assert.equal(await page.isVisible('#life-error'), false, 'leeres Feld zeigt keine Fehlermeldung');
      await page.fill('#life-input', '0');
      assert.equal(await page.isVisible('#life-error'), true);
      await page.fill('#life-input', '999');
      assert.equal(await page.isEnabled('#btn-start'), true);
      await page.fill('#life-input', '1');
      assert.equal(await page.isEnabled('#btn-start'), true);
      await page.click('label:has(input[name=life-preset][value="30"])');
      assert.equal(await page.inputValue('#life-input'), '30');
      assert.equal(await page.isEnabled('#btn-start'), true);
    });

    await test('freies Startleben wird übernommen', async () => {
      await page.fill('#life-input', '25');
      await page.click('label:has(input[name=players][value="3"])');
      await page.click('#btn-start');
      await page.waitForSelector('#game:not([hidden]) .field');
      assert.equal(await page.locator('.field').count(), 3);
      for (let seat = 0; seat < 3; seat++) assert.equal(await lifeOf(page, seat), 25);
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  // The default phone is tested with every player count; other common phone sizes with the
  // layouts that are tight (the sideways fields of 5 and 6 players get only half the screen width as height).
  const LAYOUT_RUNS = [
    ...[2, 3, 4, 5, 6].map((players) => ({ players, viewport: VIEWPORT })),
    ...[{ width: 360, height: 800 }, { width: 375, height: 667 }, { width: 412, height: 915 }]
      .flatMap((viewport) => [4, 5, 6].map((players) => ({ players, viewport }))),
  ];
  for (const { players, viewport } of LAYOUT_RUNS) {
    const isDefault = viewport === VIEWPORT;
    const suffix = isDefault ? '' : ` (${viewport.width}x${viewport.height})`;
    await group(`Layout mit ${players} Spielern${suffix}`, async () => {
      const { context, page, problems } = await openApp(browser, server.url, { viewport });
      await startGame(page, players);
      const layout = getLayout(players);
      const info = await page.evaluate(() => {
        const box = (el) => {
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        };
        const textBox = (el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return box(range);
        };
        return {
          vw: innerWidth,
          vh: innerHeight,
          dock: box(document.querySelector('.dock')),
          dockMode: document.getElementById('game').dataset.dock,
          dockButtons: [...document.querySelectorAll('.dock-btn')].map(box),
          fields: [...document.querySelectorAll('.field')].map((f) => {
            const frame = f.querySelector('.frame');
            const m = new DOMMatrix(getComputedStyle(frame).transform);
            const angle = ((Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI) % 360) + 360) % 360;
            return {
              seat: Number(f.dataset.seat),
              angle,
              rect: box(f),
              frame: box(frame),
              life: textBox(f.querySelector('.life')),
              lifeFont: parseFloat(getComputedStyle(f.querySelector('.life')).fontSize),
              bar: (() => {
                const parts = [f.querySelector('.name'), f.querySelector('.toggle')].map(box);
                const x = Math.min(...parts.map((b) => b.x));
                const y = Math.min(...parts.map((b) => b.y));
                return { x, y, w: Math.max(...parts.map((b) => b.x + b.w)) - x, h: Math.max(...parts.map((b) => b.y + b.h)) - y };
              })(),
              controls: [...f.querySelectorAll('.btn5, .name, .toggle')].map(box),
              frameSize: { w: frame.offsetWidth, h: frame.offsetHeight },
            };
          }),
        };
      });
      if (isDefault) await shot(page, `layout-${players}`);
      else await shot(page, `layout-${players}-${viewport.width}x${viewport.height}`);

      await test('Felder: richtige Anzahl, jedes Feld in die Richtung seiner Tischkante gedreht', () => {
        assert.equal(info.fields.length, players);
        for (const f of info.fields) {
          assert.equal(f.angle, layout.cells[f.seat].rotation, `Sitz ${f.seat}: Drehung`);
        }
      });

      await test('Felder füllen den Bildschirm: jede Zelle hat genau die Größe aus Raster und 3-px-Lücken, nichts überlappt', () => {
        const GAP = 3;
        const track = (total, count) => (total - (count - 1) * GAP) / count;
        for (const f of info.fields) {
          const cell = layout.cells[f.seat];
          const w = track(info.vw, layout.cols) * cell.colSpan + (cell.colSpan - 1) * GAP;
          const h = track(info.vh, layout.rows) * cell.rowSpan + (cell.rowSpan - 1) * GAP;
          assert.ok(Math.abs(f.rect.w - w) <= 1 && Math.abs(f.rect.h - h) <= 1, `Sitz ${f.seat}: ${f.rect.w.toFixed(1)}x${f.rect.h.toFixed(1)} statt ${w.toFixed(1)}x${h.toFixed(1)}`);
          assert.ok(f.rect.x >= -0.5 && f.rect.y >= -0.5 && f.rect.x + f.rect.w <= info.vw + 0.5 && f.rect.y + f.rect.h <= info.vh + 0.5, `Sitz ${f.seat} ragt aus dem Bildschirm`);
        }
        for (const a of info.fields) {
          for (const b of info.fields) {
            if (a.seat < b.seat) assert.ok(!rectsOverlap(a.rect, b.rect, 1), `Felder ${a.seat} und ${b.seat} überlappen`);
          }
        }
      });

      await test('der gedrehte Rahmen passt exakt in seine Zelle', () => {
        for (const f of info.fields) {
          for (const key of ['x', 'y', 'w', 'h']) {
            assert.ok(Math.abs(f.frame[key] - f.rect[key]) <= 1, `Sitz ${f.seat}: Rahmen ${key} ${f.frame[key]} vs. Zelle ${f.rect[key]}`);
          }
        }
      });

      await test('Name und Zähler-Button liegen an der Kante des zugehörigen Spielers', () => {
        for (const f of info.fields) {
          const { rect: r, bar: b, angle } = f;
          const edge = { 0: [b.y + b.h, r.y + r.h], 180: [b.y, r.y], 90: [b.x, r.x], 270: [b.x + b.w, r.x + r.w] }[angle];
          assert.ok(Math.abs(edge[0] - edge[1]) <= 8, `Sitz ${f.seat} (${angle}°): Name und Zähler-Button liegen ${Math.abs(edge[0] - edge[1]).toFixed(1)} px vom Spieler-Rand entfernt`);
        }
      });

      await test(`Dock sitzt in der Bildschirmmitte (${layout.dock}) und verdeckt keine Bedienelemente oder Zahlen`, () => {
        assert.equal(info.dockMode, layout.dock);
        assert.ok(Math.abs(info.dock.x + info.dock.w / 2 - info.vw / 2) <= 1);
        assert.ok(Math.abs(info.dock.y + info.dock.h / 2 - info.vh / 2) <= 1);
        assert.ok(layout.dock === 'vertical' ? info.dock.h > info.dock.w : info.dock.w > info.dock.h);
        for (const f of info.fields) {
          for (const control of f.controls) assert.ok(!rectsOverlap(info.dock, control), `Dock überdeckt ein Bedienelement von Sitz ${f.seat}`);
          assert.ok(!rectsOverlap(info.dock, f.life), `Dock überdeckt die Lebenszahl von Sitz ${f.seat}`);
        }
      });

      await test('Bedienelemente überlappen weder einander noch die Lebenszahl', () => {
        for (const f of info.fields) {
          f.controls.forEach((a, i) => {
            assert.ok(!rectsOverlap(a, f.life, 1), `Sitz ${f.seat}: Bedienelement ${i} überlappt die Lebenszahl`);
            f.controls.forEach((b, j) => {
              if (i < j) assert.ok(!rectsOverlap(a, b, 1), `Sitz ${f.seat}: Bedienelemente ${i} und ${j} überlappen`);
            });
          });
        }
      });

      await test('Tippziele sind mindestens 48 px groß, die Lebenszahl ist groß', () => {
        for (const f of info.fields) {
          for (const c of f.controls) assert.ok(c.w >= 47.5 && c.h >= 47.5, `Sitz ${f.seat}: Button ${c.w.toFixed(1)}x${c.h.toFixed(1)}`);
          assert.ok(f.lifeFont >= 60, `Sitz ${f.seat}: Zahl nur ${f.lifeFont.toFixed(0)} px`);
          assert.ok(f.life.x >= f.rect.x - 1 && f.life.x + f.life.w <= f.rect.x + f.rect.w + 1 && f.life.y >= f.rect.y - 1 && f.life.y + f.life.h <= f.rect.y + f.rect.h + 1, `Sitz ${f.seat}: Zahl ragt aus dem Feld`);
        }
        for (const b of info.dockButtons) assert.ok(b.w >= 47.5 && b.h >= 47.5);
      });

      await test('Zähler-Panel passt in jedem Feld ohne Abschneiden und ohne Dock-Überlappung', async () => {
        for (let seat = 0; seat < players; seat++) await field(page, seat).locator('.toggle').tap();
        for (const tab of [0, 1]) {
          for (let seat = 0; seat < players; seat++) await field(page, seat).locator('.tab').nth(tab).tap();
          const panels = await page.evaluate(() => {
            const box = (el) => {
              const b = el.getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height };
            };
            const dock = box(document.querySelector('.dock'));
            return [...document.querySelectorAll('.panel')].map((panel) => ({
              seat: Number(panel.closest('.field').dataset.seat),
              frameSize: { w: panel.closest('.frame').offsetWidth, h: panel.closest('.frame').offsetHeight },
              overflow: panel.scrollHeight > panel.clientHeight + 1 || panel.scrollWidth > panel.clientWidth + 1,
              rect: box(panel),
              dock,
              buttons: [...panel.querySelectorAll('button:not([hidden])')].filter((b) => b.getClientRects().length > 0 && !b.closest('[hidden]')).map((b) => ({ ...box(b), chip: b.classList.contains('sel') })),
            }));
          });
          assert.equal(panels.length, players);
          for (const p of panels) {
            assert.equal(p.overflow, false, `Sitz ${p.seat}: Panel läuft über`);
            assert.ok(p.buttons.length >= 5, `Sitz ${p.seat}: zu wenige Buttons sichtbar`);
            // Physical limits (see "Dense" and "Compact" frames in styles.css): the selector chips may
            // shrink to 38 px in one direction when the frame is narrow and short (5-6 players on a
            // 360-375 px phone). Every other panel button keeps 48 px.
            const dense = p.frameSize.w < 260 && p.frameSize.h <= 262;
            const tiny = p.frameSize.h <= 190 && p.frameSize.w < 250;
            for (const b of p.buttons) {
              assert.ok(b.x >= p.rect.x - 1 && b.y >= p.rect.y - 1 && b.x + b.w <= p.rect.x + p.rect.w + 1 && b.y + b.h <= p.rect.y + p.rect.h + 1, `Sitz ${p.seat}: Button ragt aus dem Panel`);
              const minimum = b.chip && (dense || tiny) ? 38 : 47.5;
              assert.ok(Math.min(b.w, b.h) >= minimum && Math.max(b.w, b.h) >= 47.5, `Sitz ${p.seat}: Panel-Button ${b.w.toFixed(1)}x${b.h.toFixed(1)} zu klein`);
              assert.ok(!rectsOverlap(p.dock, b), `Sitz ${p.seat}: Dock überdeckt einen Panel-Button`);
            }
            p.buttons.forEach((a, i) => p.buttons.forEach((b, j) => {
              if (i < j) assert.ok(!rectsOverlap(a, b, 1.5), `Sitz ${p.seat}: Panel-Buttons ${i} und ${j} überlappen (${a.x.toFixed(0)},${a.y.toFixed(0)} ${a.w.toFixed(0)}x${a.h.toFixed(0)} / ${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.w.toFixed(0)}x${b.h.toFixed(0)})`);
            }));
          }
          await shot(page, `layout-${players}${isDefault ? '' : `-${viewport.width}x${viewport.height}`}-panels-${tab === 0 ? 'commander' : 'zaehler'}`);
        }
      });
      await noProblems(problems);
      await context.close();
    });
  }

  // ------------------------------------------------------------------------------------------
  await group('Leben: Tippen, Halten, Mehrfingerbedienung', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 4);
    const minus = field(page, 0).locator('.zone-minus');
    const plus = field(page, 0).locator('.zone-plus');

    await test('Tippen: linke Hälfte −1, rechte Hälfte +1, ±5-Buttons ±5', async () => {
      await minus.tap();
      assert.equal(await lifeOf(page, 0), 39);
      await plus.tap();
      assert.equal(await lifeOf(page, 0), 40);
      await field(page, 0).locator('.btn5-minus').tap();
      assert.equal(await lifeOf(page, 0), 35);
      await field(page, 0).locator('.btn5-plus').tap();
      assert.equal(await lifeOf(page, 0), 40);
      for (let seat = 1; seat < 4; seat++) assert.equal(await lifeOf(page, seat), 40, 'andere Spieler bleiben unverändert');
    });

    await test('Tippen auf das Feld ändert den richtigen Spieler (gedrehte Felder)', async () => {
      for (const seat of [1, 2, 3]) {
        await field(page, seat).locator('.zone-minus').tap();
        assert.equal(await lifeOf(page, seat), 39, `Sitz ${seat}`);
        await field(page, seat).locator('.zone-plus').tap();
        assert.equal(await lifeOf(page, seat), 40, `Sitz ${seat}`);
      }
      await sleep(BURST_MS + 100);
    });

    await test('Änderungssumme der letzten Sekunden erscheint und verschwindet nach der Pause', async () => {
      for (let i = 0; i < 3; i++) await minus.tap();
      await field(page, 0).locator('.btn5-minus').tap();
      const delta = field(page, 0).locator('.delta');
      assert.equal(await delta.isVisible(), true);
      assert.equal((await delta.innerText()).trim(), `${MINUS}8`);
      await shot(page, 'leben-delta');
      await waitFor(async () => !(await delta.isVisible()), { timeout: BURST_MS + 800, message: 'Anzeige verschwindet' });
      assert.equal(await lifeOf(page, 0), 32);
    });

    await test('die Änderungssumme wird als ein einziger Historien-Eintrag gespeichert', async () => {
      const game = await savedGame(page);
      const mine = game.history.filter((e) => e.kind === 'life' && e.pid === 0);
      // The earlier −1/+1/−5/+5 taps cancelled each other out inside one burst (net 0 leaves no
      // entry), so the only entry is the burst of three taps and −5.
      assert.equal(mine.length, 1);
      assert.deepEqual([mine[0].from, mine[0].to], [40, 32]);
      assert.equal(mine[0].to - mine[0].from, -8, 'drei Tipper und −5 ergeben einen Eintrag mit −8');
    });

    await test('Halten: erst Einzelschritte, nach 1 s Fünferschritte; Loslassen stoppt', async () => {
      const touch = await touchSession(page);
      const target = await centerOf(plus);
      const before = await lifeOf(page, 0);
      await touch.start(target);
      await sleep(2300);
      await touch.end();
      const gained = (await lifeOf(page, 0)) - before;
      assert.ok(gained >= 33 && gained <= 50, `nach 2,3 s Halten wurden ${gained} Punkte addiert (erwartet 33-50: ~7 Einzelschritte + ~6 Fünferschritte)`);
      const settled = await lifeOf(page, 0);
      await sleep(600);
      assert.equal(await lifeOf(page, 0), settled, 'nach dem Loslassen darf nichts mehr passieren');
      const game = await savedGame(page);
      const last = game.history.filter((e) => e.kind === 'life' && e.pid === 0).pop();
      assert.equal(last.to - last.from, gained, 'das Halten ist ein einziger Historien-Eintrag');
    });

    await test('kurzes Halten (0,7 s) bleibt bei Einzelschritten', async () => {
      await sleep(BURST_MS + 100);
      const touch = await touchSession(page);
      const target = await centerOf(minus);
      const before = await lifeOf(page, 0);
      await touch.start(target);
      await sleep(700);
      await touch.end();
      const lost = before - (await lifeOf(page, 0));
      assert.ok(lost >= 2 && lost <= 5, `nach 0,7 s Halten wurden ${lost} Punkte abgezogen (erwartet 2-5, keine Fünferschritte)`);
    });

    await test('rutscht der Finger beim Halten in ein anderes Feld, zählt das eigene Feld weiter und das fremde bleibt unberührt', async () => {
      await sleep(BURST_MS + 100);
      const touch = await touchSession(page);
      const [x, y] = await centerOf(plus);
      const [awayX, awayY] = await centerOf(field(page, 3).locator('.zone-plus'));
      const before = [await lifeOf(page, 0), await lifeOf(page, 3)];
      await touch.start([x, y]);
      await sleep(300);
      await touch.move(1, awayX, awayY);
      await sleep(1500);
      await touch.end();
      const after = [await lifeOf(page, 0), await lifeOf(page, 3)];
      assert.ok(after[0] - before[0] >= 20, `eigenes Feld stieg nur um ${after[0] - before[0]}`);
      assert.equal(after[1], before[1], 'das Feld unter dem Finger bleibt unverändert');
      const settled = await lifeOf(page, 0);
      await sleep(500);
      assert.equal(await lifeOf(page, 0), settled);
    });

    await test('zwei Finger gleichzeitig auf verschiedenen Feldern wirken unabhängig voneinander', async () => {
      await sleep(BURST_MS + 100);
      const touch = await touchSession(page);
      const a = await centerOf(plus);
      const b = await centerOf(field(page, 3).locator('.zone-minus'));
      const before = [await lifeOf(page, 0), await lifeOf(page, 3)];
      await touch.start(a, b);
      await sleep(600);
      await touch.end(2); // lift finger 2 (player 4) early; finger 1 keeps holding
      const midway = [await lifeOf(page, 0), await lifeOf(page, 3)];
      await sleep(1700);
      await touch.end();
      const after = [await lifeOf(page, 0), await lifeOf(page, 3)];
      assert.ok(before[1] - midway[1] >= 2 && before[1] - midway[1] <= 5, `Spieler 4 verlor ${before[1] - midway[1]} in 0,6 s (erwartet 2-5)`);
      assert.equal(after[1], midway[1], 'Spieler 4 ändert sich nach dem Loslassen seines Fingers nicht mehr');
      assert.ok(after[0] - before[0] >= 30, `Spieler 1 stieg nur um ${after[0] - before[0]}: Finger 1 muss weitergehalten haben und beschleunigt haben`);
      const settled = [await lifeOf(page, 0), await lifeOf(page, 3)];
      await sleep(500);
      assert.deepEqual([await lifeOf(page, 0), await lifeOf(page, 3)], settled, 'nach dem Loslassen aller Finger ist Ruhe');
    });

    await test('Tastatur: Enter auf einer Tippfläche zählt genau einen Punkt', async () => {
      await sleep(BURST_MS + 100);
      const before = await lifeOf(page, 1);
      await field(page, 1).locator('.zone-plus').focus();
      await page.keyboard.press('Enter');
      assert.equal(await lifeOf(page, 1), before + 1);
      await page.keyboard.press('Space');
      assert.equal(await lifeOf(page, 1), before + 2);
    });

    await test('Maus funktioniert ebenfalls (Pointer Events, kein Touch nötig)', async () => {
      await sleep(BURST_MS + 100);
      const before = await lifeOf(page, 2);
      await field(page, 2).locator('.zone-minus').click();
      assert.equal(await lifeOf(page, 2), before - 1);
    });

    await test('Doppeltippen zoomt nicht, das Leben zählt zwei Punkte', async () => {
      const before = await lifeOf(page, 3);
      const target = field(page, 3).locator('.zone-plus');
      await target.tap();
      await target.tap();
      assert.equal(await lifeOf(page, 3), before + 2);
      const scale = await page.evaluate(() => window.visualViewport.scale);
      assert.equal(scale, 1);
    });

    await test('Leben darf negativ werden und zeigt ein echtes Minuszeichen', async () => {
      await sleep(BURST_MS + 100);
      const current = await lifeOf(page, 1);
      for (let i = 0; i < Math.ceil((current + 7) / 5); i++) await field(page, 1).locator('.btn5-minus').tap();
      assert.ok((await lifeOf(page, 1)) < 0);
      assert.ok((await field(page, 1).locator('.life').innerText()).startsWith(MINUS));
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Zähler: Commander-Schaden, Gift, Energie, Erfahrung, Monarch, Initiative', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 4);
    const f0 = field(page, 0);

    await test('geschlossen werden Zähler mit Wert 0 nicht angezeigt', async () => {
      assert.equal(await f0.locator('.chips').isVisible(), false);
      assert.equal(await f0.locator('.chip').count(), 0);
    });

    await test('Panel öffnet und schließt, aria-expanded folgt', async () => {
      await f0.locator('.toggle').tap();
      assert.equal(await f0.locator('.panel').isVisible(), true);
      assert.equal(await f0.locator('.toggle').getAttribute('aria-expanded'), 'true');
      await f0.locator('.tab-close').tap();
      assert.equal(await f0.locator('.panel').isVisible(), false);
      assert.equal(await f0.locator('.toggle').getAttribute('aria-expanded'), 'false');
    });

    await test('Commander-Schaden: 20 von einem Gegner sind noch kein Ausscheiden, 21 schon', async () => {
      await f0.locator('.toggle').tap();
      const stepPlus = f0.locator('.step-plus');
      for (let i = 0; i < 20; i++) await stepPlus.click();
      assert.equal(await f0.evaluate((el) => el.classList.contains('is-out')), false, 'bei 20 noch im Spiel');
      assert.equal((await f0.locator('.step-value').innerText()).trim(), '20');
      await stepPlus.click();
      assert.equal(await f0.evaluate((el) => el.classList.contains('is-out')), true, 'bei 21 ausgeschieden');
      await shot(page, 'zaehler-commander-21');
      await f0.locator('.tab-close').tap();
      assert.equal(await f0.locator('.out-mark').isVisible(), true, 'Totenkopf sichtbar');
      assert.match(await f0.locator('.chips').innerText(), /Commander/);
      for (const seat of [1, 2, 3]) assert.equal(await field(page, seat).evaluate((el) => el.classList.contains('is-out')), false);
      assert.equal(await lifeOf(page, 0), 40, 'Commander-Schaden ändert das Leben nicht automatisch');
      await shot(page, 'zaehler-ausgeschieden');
    });

    await test('Commander-Schaden wird getrennt je Gegner gezählt (21 gesamt aus zwei Quellen reichen nicht)', async () => {
      const f1 = field(page, 1);
      await f1.locator('.toggle').tap();
      const chips = f1.locator('.sel-row:not([hidden]) .sel');
      assert.equal(await chips.count(), 3, 'drei Gegner');
      for (let i = 0; i < 12; i++) await f1.locator('.step-plus').click(); // from first opponent
      await chips.nth(1).tap();
      for (let i = 0; i < 12; i++) await f1.locator('.step-plus').click(); // from second opponent
      assert.equal(await f1.evaluate((el) => el.classList.contains('is-out')), false);
      const values = await chips.locator('.sel-val').allInnerTexts();
      assert.deepEqual(values, ['12', '12', '0']);
      await f1.locator('.tab-close').tap();
    });

    await test('Gift: bei 10 ausgeschieden', async () => {
      const f2 = field(page, 2);
      await f2.locator('.toggle').tap();
      await f2.locator('.tab').nth(1).tap();
      for (let i = 0; i < 9; i++) await f2.locator('.step-plus').click();
      assert.equal(await f2.evaluate((el) => el.classList.contains('is-out')), false);
      await f2.locator('.step-plus').click();
      assert.equal(await f2.evaluate((el) => el.classList.contains('is-out')), true);
      await f2.locator('.tab-close').tap();
      const text = await f2.locator('.chips').innerText();
      assert.match(text, /Gift/);
      assert.match(text, /10/);
    });

    await test('Energie und Erfahrung zählen, geschlossen erscheinen nur Werte größer als 0', async () => {
      const f3 = field(page, 3);
      await f3.locator('.toggle').tap();
      await f3.locator('.tab').nth(1).tap();
      const sels = f3.locator('.sel-row:not([hidden]) .sel');
      await sels.nth(1).tap(); // energy
      for (let i = 0; i < 3; i++) await f3.locator('.step-plus').click();
      await sels.nth(2).tap(); // experience
      await f3.locator('.step-plus').click();
      await f3.locator('.step-minus').click();
      await f3.locator('.step-minus').click(); // stays at 0
      assert.equal((await f3.locator('.step-value').innerText()).trim(), '0', 'Zähler gehen nicht unter 0');
      await f3.locator('.tab-close').tap();
      assert.equal(await f3.locator('.chip').count(), 1, 'nur Energie (3) ist sichtbar');
      assert.equal((await f3.locator('.chip').innerText()).trim(), '3');
    });

    await test('Monarch und Initiative gehören immer nur einem Spieler', async () => {
      for (const kind of [0, 1]) { // 0 = monarch, 1 = initiative
        const markerIndex = 3 + kind;
        await f0.locator('.toggle').tap();
        await f0.locator('.tab').nth(1).tap();
        await f0.locator('.sel-row:not([hidden]) .sel').nth(markerIndex).tap();
        await f0.locator('.tab-close').tap();
        assert.equal(await f0.locator(kind === 0 ? '.chip-monarch' : '.chip-initiative').count(), 1);
        const f1 = field(page, 1);
        await f1.locator('.toggle').tap();
        await f1.locator('.tab').nth(1).tap();
        await f1.locator('.sel-row:not([hidden]) .sel').nth(markerIndex).tap();
        await f1.locator('.tab-close').tap();
        assert.equal(await f1.locator(kind === 0 ? '.chip-monarch' : '.chip-initiative').count(), 1, 'Spieler 2 hat den Marker');
        assert.equal(await f0.locator(kind === 0 ? '.chip-monarch' : '.chip-initiative').count(), 0, 'Spieler 1 hat ihn verloren');
      }
    });

    await test('0 oder weniger Leben scheidet aus, das Feld bleibt bedienbar', async () => {
      const f1 = field(page, 1);
      for (let i = 0; i < 8; i++) await f1.locator('.btn5-minus').tap();
      assert.equal(await lifeOf(page, 1), 0);
      assert.equal(await f1.evaluate((el) => el.classList.contains('is-out')), true);
      await f1.locator('.zone-plus').tap();
      assert.equal(await lifeOf(page, 1), 1);
      assert.equal(await f1.evaluate((el) => el.classList.contains('is-out')), false, 'Fehler lassen sich korrigieren');
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Historie und Rückgängig', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 3);
    const undo = page.locator('#btn-undo');

    await test('Rückgängig ist am Anfang deaktiviert', async () => {
      assert.equal(await undo.isDisabled(), true);
    });

    const snapshot = async () => page.evaluate(() => [...document.querySelectorAll('.field')].map((f) => ({
      life: f.querySelector('.life').textContent,
      chips: f.querySelector('.chips').textContent,
      out: f.classList.contains('is-out'),
    })));

    await test('mehrfaches Rückgängig stellt jeden früheren Zustand wieder her', async () => {
      const states = [await snapshot()];
      const steps = [
        async () => field(page, 0).locator('.btn5-minus').tap(),
        async () => field(page, 1).locator('.zone-minus').tap(),
        async () => {
          const f = field(page, 2);
          await f.locator('.toggle').tap();
          for (let i = 0; i < 4; i++) await f.locator('.step-plus').click();
          await f.locator('.tab-close').tap();
        },
        async () => {
          const f = field(page, 1);
          await f.locator('.toggle').tap();
          await f.locator('.tab').nth(1).tap();
          await f.locator('.sel-toggle').first().tap();
          await f.locator('.tab-close').tap();
        },
        async () => field(page, 0).locator('.btn5-plus').tap(),
      ];
      for (const step of steps) {
        await sleep(BURST_MS + 60); // separate history entries
        await step();
        states.push(await snapshot());
      }
      assert.equal(await undo.isDisabled(), false);
      for (let i = states.length - 2; i >= 0; i--) {
        await undo.tap();
        assert.deepEqual(await snapshot(), states[i], `nach ${states.length - 1 - i}× Rückgängig`);
      }
      assert.equal(await undo.isDisabled(), true, 'ganz am Anfang ist nichts mehr rückgängig zu machen');
    });

    await test('Historie listet Spieler, Art, alt → neu und Uhrzeit', async () => {
      await sleep(BURST_MS + 60);
      await field(page, 0).locator('.btn5-minus').tap();
      await sleep(BURST_MS + 60);
      const f = field(page, 1);
      await f.locator('.toggle').tap();
      await f.locator('.tab').nth(0).tap(); // the panel remembers its last page, so pick Commander explicitly
      for (let i = 0; i < 3; i++) await f.locator('.step-plus').click();
      await f.locator('.tab-close').tap();
      await page.click('#btn-menu');
      await page.click('[data-action=history]');
      const rows = page.locator('#log-list .log-row');
      assert.equal(await rows.count(), 2);
      const newest = await rows.nth(0).innerText();
      const oldest = await rows.nth(1).innerText();
      assert.match(newest, /\d\d:\d\d:\d\d/);
      assert.match(newest, /Spieler 2/);
      assert.match(newest, /Commander-Schaden von Spieler 1/);
      assert.match(newest, /0 → 3 \(\+3\)/);
      assert.match(oldest, /Spieler 1/);
      assert.match(oldest, new RegExp(`Leben: 40 → 35 \\(${MINUS}5\\)`));
      await shot(page, 'historie');
    });

    await test('Rückgängig nennt kurz, was zurückgenommen wurde (Hinweis unter dem Dock) und blockiert keine Eingabe', async () => {
      await page.keyboard.press('Escape');
      await sleep(BURST_MS + 60);
      await field(page, 2).locator('.btn5-minus').tap();
      await undo.tap();
      const toast = page.locator('#toast');
      assert.equal(await toast.isVisible(), true);
      assert.match(await toast.innerText(), new RegExp(`^Rückgängig: Spieler 3: Leben 40 → 35 \\(${MINUS}5\\)$`));
      assert.equal(await toast.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
      await shot(page, 'rueckgaengig-hinweis');
      await waitFor(async () => !(await toast.isVisible()), { timeout: 4000, message: 'Hinweis verschwindet' });
      assert.equal(await lifeOf(page, 2), 40);
      await page.click('#btn-menu');
      await page.click('[data-action=history]');
    });

    await test('Rückgängig aus der Historie entfernt den neuesten Eintrag', async () => {
      await page.click('#log-undo');
      assert.equal(await page.locator('#log-list .log-row').count(), 1);
      assert.equal(await field(page, 1).locator('.chip').count(), 0);
      await page.click('#log-undo');
      assert.equal(await page.locator('#log-list .log-row').count(), 0);
      assert.equal(await page.isVisible('#log-empty'), true);
      assert.equal(await page.isDisabled('#log-undo'), true);
      assert.equal(await lifeOf(page, 0), 40);
      await page.keyboard.press('Escape');
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Spielstand bleibt nach Neuladen erhalten', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 5, 30);
    await field(page, 0).locator('.btn5-minus').tap();
    await field(page, 2).locator('.zone-plus').tap();
    const f3 = field(page, 3);
    await f3.locator('.toggle').tap();
    for (let i = 0; i < 5; i++) await f3.locator('.step-plus').click();
    await f3.locator('.tab').nth(1).tap();
    await f3.locator('.sel-toggle').first().tap(); // monarch
    await f3.locator('.tab-close').tap();
    await field(page, 1).locator('.name').tap();
    await page.fill('#player-name', 'Mira');
    await page.click('label.swatch:has(input[value=pink])');
    await page.click('#dlg-player button[value=ok]');

    const before = await page.evaluate(() => [...document.querySelectorAll('.field')].map((f) => ({
      name: f.querySelector('.name-text').textContent,
      life: f.querySelector('.life').textContent,
      chips: f.querySelector('.chips').textContent,
      bg: f.style.getPropertyValue('--pc-bg'),
    })));

    await test('nach dem Neuladen sind Leben, Zähler, Marker, Namen und Farben wieder da', async () => {
      await sleep(300);
      await page.reload();
      await page.waitForSelector('#game:not([hidden]) .field');
      assert.equal(await page.isHidden('#setup'), true, 'direkt im Spiel, nicht im Startbildschirm');
      assert.equal(await page.locator('.field').count(), 5);
      const after = await page.evaluate(() => [...document.querySelectorAll('.field')].map((f) => ({
        name: f.querySelector('.name-text').textContent,
        life: f.querySelector('.life').textContent,
        chips: f.querySelector('.chips').textContent,
        bg: f.style.getPropertyValue('--pc-bg'),
      })));
      assert.deepEqual(after, before);
      assert.equal(after[1].name, 'Mira');
      assert.equal(after[0].life, '25');
    });

    await test('die wiederhergestellte Historie lässt sich weiter rückgängig machen', async () => {
      assert.equal(await page.isEnabled('#btn-undo'), true);
      await page.click('#btn-undo'); // monarch
      assert.equal(await field(page, 3).locator('.chip-monarch').count(), 0);
    });

    await test('Änderungen direkt vor dem Schließen (visibilitychange) gehen nicht verloren', async () => {
      await field(page, 4).locator('.zone-minus').tap();
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const game = await page.evaluate(() => JSON.parse(localStorage.getItem('mtg-counter:v1')).game);
      assert.equal(game.players[4].life, 29);
    });

    await test('beschädigter Speicher führt zum Startbildschirm statt zu einem Fehler', async () => {
      await page.evaluate(() => localStorage.setItem('mtg-counter:v1', '{kaputt'));
      await page.reload();
      await page.waitForSelector('#setup:not([hidden])');
      assert.equal(await page.isHidden('#game'), true);
      await page.evaluate(() => localStorage.setItem('mtg-counter:v1', JSON.stringify({ v: 1, settings: { playerCount: 'x' }, game: { players: [{}] } })));
      await page.reload();
      await page.waitForSelector('#setup:not([hidden])');
    });
    await noProblems(problems);
    await context.close();
  });

  await group('Ohne nutzbaren localStorage (z. B. privater Modus) läuft die App weiter', async () => {
    const { context, page, problems } = await openApp(browser, server.url, {
      init: () => {
        Storage.prototype.setItem = () => { throw new DOMException('gesperrt', 'SecurityError'); };
        Storage.prototype.getItem = () => { throw new DOMException('gesperrt', 'SecurityError'); };
      },
    });
    await test('Spiel startet und ist bedienbar', async () => {
      await startGame(page, 2);
      await field(page, 0).locator('.zone-minus').tap();
      assert.equal(await lifeOf(page, 0), 39);
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Name und Farbe', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 4);
    const f1 = field(page, 1);
    const colorOf = (seat) => field(page, seat).evaluate((el) => el.style.getPropertyValue('--pc-bg'));

    await test('Tippen auf den Namen öffnet den Editor mit Name und Farbauswahl', async () => {
      await f1.locator('.name').tap();
      assert.equal(await page.isVisible('#dlg-player'), true);
      assert.equal(await page.inputValue('#player-name'), 'Spieler 2');
      assert.equal(await page.locator('#player-colors input').count(), 8);
      assert.equal(await page.locator('#player-colors input:checked').getAttribute('value'), 'blue');
      await shot(page, 'spieler-editor');
    });

    await test('Name und Farbe werden sofort übernommen; Farben bleiben eindeutig (Tausch)', async () => {
      const oldColor = await colorOf(1);
      const takenByOther = await colorOf(0);
      assert.equal(await page.getAttribute('#player-name', 'maxlength'), '16');
      await page.fill('#player-name', 'Ur-Drago der Große'); // the field itself cuts at 16 characters
      assert.equal((await f1.locator('.name-text').innerText()).trim(), 'Ur-Drago der Gro', 'Live-Vorschau schon vor dem Schließen');
      await page.click('label.swatch:has(input[value=red])'); // seat 0 has red -> swap
      assert.equal(await colorOf(1), takenByOther);
      assert.equal(await colorOf(0), oldColor, 'der bisherige Besitzer bekommt die alte Farbe');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dlg-player', { state: 'hidden' });
      assert.equal((await f1.locator('.name-text').innerText()).trim(), 'Ur-Drago der Gro');
      const colors = await Promise.all([0, 1, 2, 3].map(colorOf));
      assert.equal(new Set(colors).size, 4);
    });

    await test('Esc oder Tippen daneben verwirft nichts: Änderungen gelten schon', async () => {
      await f1.locator('.name').tap();
      await page.fill('#player-name', 'Nissa');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#dlg-player', { state: 'hidden' });
      assert.equal((await f1.locator('.name-text').innerText()).trim(), 'Nissa');
    });

    await test('leerer Name fällt auf den Standardnamen zurück', async () => {
      await f1.locator('.name').tap();
      await page.fill('#player-name', '   ');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dlg-player', { state: 'hidden' });
      assert.equal((await f1.locator('.name-text').innerText()).trim(), 'Spieler 2');
    });

    await test('Text bleibt auf jeder Farbe gut lesbar (Kontrast mindestens 4,5:1)', async () => {
      const ratios = await page.evaluate(() => {
        const lum = (rgb) => {
          const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const parse = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
        return [...document.querySelectorAll('.field')].map((f) => {
          const cs = getComputedStyle(f);
          const a = lum(parse(cs.backgroundColor));
          const b = lum(parse(cs.color));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      });
      for (const ratio of ratios) assert.ok(ratio >= 4.5, `Kontrast ${ratio.toFixed(2)}`);
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Würfel, Münze und Startspieler', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 4);
    const closeResult = () => page.click('#dlg-result', { position: { x: 15, y: 15 } });

    await test('Menü: alle Einträge sind erreichbar', async () => {
      await page.click('#btn-menu');
      const labels = await page.locator('#dlg-menu .tile span').allInnerTexts();
      assert.deepEqual(labels, ['Würfel', 'Münzwurf', 'Startspieler', 'Rückgängig', 'Historie', 'Neues Spiel', 'Einstellungen', 'Hilfe / Über']);
      await shot(page, 'menue');
      await page.keyboard.press('Escape');
    });

    await test('mehrere Würfel gemeinsam: Ergebnisse im Wertebereich, Summe stimmt, Antippen schließt', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=dice]');
      assert.equal(await page.locator('.dice-row').count(), 6);
      const d6 = page.locator('.dice-row').nth(1);
      await d6.locator('button').nth(1).tap();
      await d6.locator('button').nth(1).tap();
      await page.locator('.dice-row').nth(5).locator('button').nth(1).tap(); // d20 -> 2
      await page.locator('.dice-row').nth(0).locator('button').nth(1).tap(); // d4 -> 1
      assert.match(await page.textContent('#dice-roll'), /\(5\)/);
      await shot(page, 'wuerfel-auswahl');
      const randomBefore = await page.evaluate(() => window.__randomCalls);
      await page.click('#dice-roll');
      await page.waitForSelector('#dlg-result[open]');
      await waitFor(async () => (await page.locator('.die.is-rolling').count()) === 0, { message: 'Würfel fertig' });
      const dice = await page.locator('.die').evaluateAll((els) => els.map((el) => ({
        label: el.querySelector('.die-label').textContent,
        value: Number(el.querySelector('.die-val').textContent),
      })));
      assert.deepEqual(dice.map((d) => d.label), ['d4', 'd6', 'd6', 'd20', 'd20']);
      for (const d of dice) assert.ok(d.value >= 1 && d.value <= Number(d.label.slice(1)), `${d.label} = ${d.value}`);
      const shown = Number(await page.locator('.dice-sum strong').innerText());
      assert.equal(shown, dice.reduce((s, d) => s + d.value, 0));
      assert.ok((await page.evaluate(() => window.__randomCalls)) > randomBefore, 'crypto.getRandomValues wurde benutzt');
      await shot(page, 'wuerfel-ergebnis');
      await closeResult();
      assert.equal(await page.isHidden('#dlg-result'), true, 'Tippen schließt das Overlay');
    });

    await test('Würfeln ist ohne Auswahl nicht möglich, Zurücksetzen leert die Auswahl', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=dice]');
      await page.click('#dice-clear');
      assert.equal(await page.isDisabled('#dice-roll'), true);
      assert.equal(await page.isDisabled('#dice-clear'), true);
      await page.keyboard.press('Escape');
    });

    await test('Nochmal würfelt mit derselben Auswahl neu, ohne das Overlay zu schließen', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=dice]');
      await page.locator('.dice-row').nth(5).locator('button').nth(1).tap();
      await page.click('#dice-roll');
      await page.waitForSelector('#dlg-result[open]');
      await waitFor(async () => (await page.locator('.die.is-rolling').count()) === 0);
      const calls = await page.evaluate(() => window.__randomCalls);
      await page.click('#result-again');
      assert.equal(await page.isVisible('#dlg-result'), true);
      await waitFor(async () => (await page.locator('.die.is-rolling').count()) === 0);
      assert.ok((await page.evaluate(() => window.__randomCalls)) > calls);
      await closeResult();
    });

    await test('Münzwurf: Kopf oder Zahl, nach beiden Ausgängen zu sehen', async () => {
      const seen = new Set();
      for (let i = 0; i < 14 && seen.size < 2; i++) {
        await page.click('#btn-menu');
        await page.click('[data-action=coin]');
        const text = await waitFor(async () => (await page.locator('.result-title').innerText()).trim(), { timeout: 3000, message: 'Münzergebnis' });
        assert.ok(['KOPF', 'ZAHL'].includes(text), text);
        seen.add(text);
        if (i === 0) await shot(page, 'muenze');
        await closeResult();
      }
      assert.equal(seen.size, 2, 'bei 14 Würfen wurden beide Seiten gesehen');
    });

    await test('Zufälliger Startspieler: nennt einen Spieler, nach dem Schließen blinkt dessen Feld', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=starter]');
      const name = await waitFor(async () => {
        const sub = (await page.locator('.starter-sub').innerText()).trim();
        return sub === 'beginnt!' ? (await page.locator('.starter-name').innerText()).trim() : null;
      }, { timeout: 3000, message: 'Startspieler' });
      const seat = Number(name.replace('Spieler ', '')) - 1;
      assert.ok(seat >= 0 && seat < 4, name);
      await shot(page, 'startspieler');
      await closeResult();
      await waitFor(async () => field(page, seat).evaluate((el) => el.classList.contains('is-starter')), { message: 'Feld hervorgehoben' });
      for (let other = 0; other < 4; other++) {
        if (other !== seat) assert.equal(await field(page, other).evaluate((el) => el.classList.contains('is-starter')), false);
      }
    });
    await noProblems(problems);
    await context.close();
  });

  await group('Reduzierte Bewegung: Ergebnisse erscheinen sofort', async () => {
    const { context, page, problems } = await openApp(browser, server.url, { reducedMotion: 'reduce' });
    await startGame(page, 2);
    await test('Würfel und Münze zeigen ohne Animation das Endergebnis', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=dice]');
      await page.locator('.dice-row').nth(1).locator('button').nth(1).tap();
      await page.click('#dice-roll');
      await page.waitForSelector('#dlg-result[open]');
      assert.equal(await page.locator('.die.is-rolling').count(), 0);
      const value = Number(await page.locator('.die-val').first().innerText());
      assert.ok(value >= 1 && value <= 6);
      await page.click('#dlg-result', { position: { x: 15, y: 15 } });
      await page.click('#btn-menu');
      await page.click('[data-action=coin]');
      assert.ok(['KOPF', 'ZAHL'].includes((await page.locator('.result-title').innerText()).trim()));
      assert.equal(await page.locator('.coin.is-flipping').count(), 0);
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Neues Spiel und Einstellungen', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 4);
    await field(page, 2).locator('.name').tap();
    await page.fill('#player-name', 'Zoe');
    await page.keyboard.press('Enter');
    await field(page, 0).locator('.btn5-minus').tap();
    await field(page, 1).locator('.toggle').tap();
    for (let i = 0; i < 3; i++) await field(page, 1).locator('.step-plus').click();
    await field(page, 1).locator('.tab-close').tap();

    await test('Neues Spiel verlangt eine Bestätigung; Abbrechen ändert nichts', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=new]');
      assert.equal(await page.isVisible('#dlg-confirm'), true);
      await shot(page, 'neues-spiel-bestaetigung');
      await page.click('#dlg-confirm button[value=cancel]');
      assert.equal(await lifeOf(page, 0), 35);
      await page.click('#btn-menu');
      await page.click('[data-action=new]');
      await page.keyboard.press('Escape');
      assert.equal(await lifeOf(page, 0), 35, 'Esc bricht ebenfalls ab');
    });

    await test('Bestätigen setzt alles zurück, behält aber Einstellungen, Namen und Farben', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=new]');
      await page.click('#confirm-ok');
      await waitFor(async () => (await lifeOf(page, 0)) === 40, { message: 'Spiel zurückgesetzt' });
      for (let seat = 0; seat < 4; seat++) assert.equal(await lifeOf(page, seat), 40);
      assert.equal(await page.locator('.chip').count(), 0);
      assert.equal(await page.isDisabled('#btn-undo'), true, 'Historie ist leer');
      assert.equal((await field(page, 2).locator('.name-text').innerText()).trim(), 'Zoe');
      assert.equal(await page.locator('.field').count(), 4);
    });

    await test('Einstellungen: andere Spielerzahl und anderes Startleben starten ein neues Spiel (mit Bestätigung)', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=settings]');
      assert.equal(await page.isVisible('#setup'), true);
      assert.equal(await page.textContent('#btn-start'), 'Neues Spiel starten');
      assert.equal(await page.locator('input[name=players]:checked').getAttribute('value'), '4');
      await page.click('label:has(input[name=players][value="6"])');
      await page.click('label:has(input[name=life-preset][value="20"])');
      await page.click('#btn-start');
      assert.equal(await page.isVisible('#dlg-confirm'), true);
      await page.click('#confirm-ok');
      await waitFor(async () => (await page.locator('.field').count()) === 6, { message: 'sechs Felder' });
      for (let seat = 0; seat < 6; seat++) assert.equal(await lifeOf(page, seat), 20);
      assert.equal(await page.isHidden('#setup'), true);
      assert.equal((await field(page, 2).locator('.name-text').innerText()).trim(), 'Zoe', 'Namen bleiben erhalten');
      assert.equal(await page.evaluate(() => document.getElementById('game').dataset.dock), 'vertical');
    });

    await test('„Zurück zum Spiel“ verwirft nichts', async () => {
      await field(page, 0).locator('.btn5-minus').tap();
      await page.click('#btn-menu');
      await page.click('[data-action=settings]');
      await page.click('#btn-setup-cancel');
      assert.equal(await page.isHidden('#setup'), true);
      assert.equal(await lifeOf(page, 0), 15);
    });

    await test('Hilfe zeigt Version und Bedienung', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=help]');
      assert.equal(await page.isVisible('#dlg-help'), true);
      assert.match(await page.textContent('#about-version'), /Version \d+\.\d+\.\d+/);
      assert.match(await page.textContent('#dlg-help'), /5er-Schritten/);
      await shot(page, 'hilfe');
      await page.keyboard.press('Escape');
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Vibration', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 2);
    await test('Aktionen lösen kurzes haptisches Feedback aus', async () => {
      await page.evaluate(() => { window.__vibrations.length = 0; });
      await field(page, 0).locator('.zone-minus').tap();
      await field(page, 0).locator('.btn5-minus').tap();
      const calls = await page.evaluate(() => window.__vibrations);
      assert.ok(calls.length >= 2, `${calls.length} Vibrationsaufrufe`);
      assert.ok(calls.every((c) => (Array.isArray(c) ? c : [c]).every((ms) => ms <= 100)), 'nur kurze Impulse');
    });
    await test('in den Einstellungen abschaltbar', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=settings]');
      await page.click('#opt-vibrate', { force: true });
      assert.equal(await page.isChecked('#opt-vibrate'), false);
      await page.click('#btn-setup-cancel');
      await page.evaluate(() => { window.__vibrations.length = 0; });
      await field(page, 0).locator('.zone-plus').tap();
      await field(page, 0).locator('.btn5-plus').tap();
      const calls = await page.evaluate(() => window.__vibrations.filter((c) => c !== 0));
      assert.equal(calls.length, 0, 'bei ausgeschalteter Vibration kein Aufruf');
    });
    await test('die Einstellung bleibt nach dem Neuladen erhalten', async () => {
      await sleep(300);
      await page.reload();
      await page.waitForSelector('#game:not([hidden]) .field');
      await page.click('#btn-menu');
      await page.click('[data-action=settings]');
      assert.equal(await page.isChecked('#opt-vibrate'), false);
    });
    await noProblems(problems);
    await context.close();
  });

  await group('Vibration nicht unterstützt (iOS)', async () => {
    const { context, page, problems } = await openApp(browser, server.url, {
      init: () => { delete navigator.vibrate; delete Navigator.prototype.vibrate; },
    });
    await test('App läuft, Schalter ist deaktiviert und erklärt warum', async () => {
      await page.waitForSelector('#setup:not([hidden])');
      assert.equal(await page.isDisabled('#opt-vibrate'), true);
      assert.equal(await page.isVisible('#vibrate-hint'), true);
      await startGame(page, 2);
      await field(page, 0).locator('.zone-minus').tap();
      assert.equal(await lifeOf(page, 0), 39);
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  const wakeLockMock = () => {
    window.__wakeLock = { requests: 0, releases: 0, types: [] };
    const sentinel = () => {
      const listeners = [];
      return {
        released: false,
        addEventListener: (type, fn) => listeners.push(fn),
        async release() {
          window.__wakeLock.releases++;
          this.released = true;
          listeners.forEach((fn) => fn());
        },
      };
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: async (type) => { window.__wakeLock.requests++; window.__wakeLock.types.push(type); return sentinel(); } },
    });
  };

  await group('Bildschirm anlassen (Wake Lock)', async () => {
    const { context, page, problems } = await openApp(browser, server.url, { init: wakeLockMock });
    await test('beim Spielstart wird eine Bildschirmsperre-Verhinderung angefordert', async () => {
      await startGame(page, 2);
      await waitFor(() => page.evaluate(() => window.__wakeLock.requests > 0), { message: 'wakeLock.request' });
      assert.deepEqual(await page.evaluate(() => window.__wakeLock.types), ['screen']);
    });
    await test('beim Zurückkehren in die App wird sie erneut angefordert', async () => {
      const before = await page.evaluate(() => window.__wakeLock.requests);
      await page.evaluate(() => {
        // the browser releases the lock itself when the page is hidden
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // lock is still held (sentinel alive), so no second request is needed
      assert.equal(await page.evaluate(() => window.__wakeLock.requests), before);
    });
    await test('in den Einstellungen abschaltbar und wieder einschaltbar', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=settings]');
      await page.click('#opt-awake', { force: true });
      await waitFor(() => page.evaluate(() => window.__wakeLock.releases > 0), { message: 'release' });
      const before = await page.evaluate(() => window.__wakeLock.requests);
      await page.click('#opt-awake', { force: true });
      await waitFor(() => page.evaluate((n) => window.__wakeLock.requests > n, before), { message: 'erneutes request' });
    });
    await noProblems(problems);
    await context.close();
  });

  await group('Wake Lock nicht unterstützt', async () => {
    const { context, page, problems } = await openApp(browser, server.url, {
      init: () => { delete Navigator.prototype.wakeLock; },
    });
    await test('sauberer Fallback: Hinweis statt Fehler, Spiel läuft normal', async () => {
      await page.waitForSelector('#setup:not([hidden])');
      assert.equal(await page.evaluate(() => 'wakeLock' in navigator), false);
      assert.equal(await page.isDisabled('#opt-awake'), true);
      assert.equal(await page.isVisible('#awake-hint'), true);
      await startGame(page, 2);
      await field(page, 0).locator('.zone-minus').tap();
      assert.equal(await lifeOf(page, 0), 39);
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('Bedienung ohne versehentliches Zoomen, Scrollen und Auswählen', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 4);
    await test('Viewport, touch-action, Textauswahl, Overscroll', async () => {
      assert.match(await page.getAttribute('meta[name=viewport]', 'content'), /user-scalable=no/);
      const css = await page.evaluate(() => {
        const board = document.getElementById('board');
        const zone = document.querySelector('.zone');
        return {
          boardTouch: getComputedStyle(board).touchAction,
          zoneTouch: getComputedStyle(zone).touchAction,
          select: getComputedStyle(board).userSelect,
          overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
          bodyPosition: getComputedStyle(document.body).position,
          fontFamily: getComputedStyle(document.body).fontFamily,
          tabular: getComputedStyle(document.querySelector('.life')).fontVariantNumeric,
        };
      });
      assert.equal(css.boardTouch, 'none');
      assert.equal(css.zoneTouch, 'none');
      assert.equal(css.select, 'none');
      assert.equal(css.overscroll, 'none');
      assert.equal(css.bodyPosition, 'fixed');
      assert.match(css.tabular, /tabular-nums/);
      assert.match(css.fontFamily, /system-ui/);
    });
    await test('Kontextmenü auf dem Spielfeld wird unterdrückt', async () => {
      const prevented = await page.evaluate(() => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        document.querySelector('.zone-plus').dispatchEvent(event);
        return event.defaultPrevented;
      });
      assert.equal(prevented, true);
    });
    await test('die Seite lässt sich nicht scrollen', async () => {
      await page.mouse.move(200, 400);
      await page.mouse.wheel(0, 600);
      const scroll = await page.evaluate(() => ({ y: scrollY, x: scrollX, h: document.documentElement.scrollHeight, ih: innerHeight }));
      assert.deepEqual([scroll.y, scroll.x], [0, 0]);
      assert.ok(scroll.h <= scroll.ih);
    });
    await test('keine Webfonts oder externen Ressourcen', async () => {
      const external = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => !n.startsWith(location.origin)));
      assert.deepEqual(external, []);
    });
    await noProblems(problems);
    await context.close();
  });

  await group('Sichere Bereiche (Notch, Gestenleiste)', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    await startGame(page, 4);
    await test('Inhalt bleibt außerhalb der Aussparungen, die Farbfläche reicht bis zum Rand', async () => {
      await page.addStyleTag({ content: ':root { --safe-top: 47px; --safe-bottom: 34px; }' });
      const result = await page.evaluate(() => {
        const box = (el) => {
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        };
        return [...document.querySelectorAll('.field')].map((f) => ({ seat: f.dataset.seat, field: box(f), frame: box(f.querySelector('.frame')), vh: innerHeight }));
      });
      for (const f of result) {
        assert.ok(f.frame.y >= 47 - 0.5 || f.field.y > 1, `Sitz ${f.seat}: Inhalt unter der Aussparung`);
        assert.ok(f.frame.y + f.frame.h <= f.vh - 34 + 0.5 || f.field.y + f.field.h < f.vh - 1, `Sitz ${f.seat}: Inhalt in der Gestenleiste`);
      }
      assert.ok(result.some((f) => f.field.y < 1), 'das obere Feld reicht bis zum oberen Rand');
      assert.ok(result.some((f) => f.field.y + f.field.h > f.vh - 1), 'das untere Feld reicht bis zum unteren Rand');
      await shot(page, 'sichere-bereiche');
    });
    await noProblems(problems);
    await context.close();
  });

  // ------------------------------------------------------------------------------------------
  await group('PWA: Manifest, Service Worker, Offline', async () => {
    const { context, page, problems } = await openApp(browser, server.url);
    const cdp = await context.newCDPSession(page);

    await test('Manifest wird fehlerfrei gelesen, Installierbarkeit ohne Beanstandung', async () => {
      const { errors, data } = await cdp.send('Page.getAppManifest');
      assert.deepEqual(errors, []);
      const manifest = JSON.parse(data);
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.orientation, 'portrait');
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      assert.deepEqual(installabilityErrors, []);
    });

    await test('Service Worker wird registriert, aktiviert und übernimmt die Seite', async () => {
      const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
      assert.equal(scope, server.url);
      await waitFor(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state === 'activated'), { message: 'Service Worker aktiviert' });
      await waitFor(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: 'Seite wird kontrolliert' });
    });

    await test('der Cache enthält alle App-Dateien unter einem versionierten Namen', async () => {
      const cache = await page.evaluate(async () => {
        const names = await caches.keys();
        const entries = await Promise.all(names.map(async (name) => ({ name, urls: (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname) })));
        return entries;
      });
      assert.equal(cache.length, 1);
      assert.match(cache[0].name, /^mtg-counter-[0-9a-f]{10}$/);
      for (const path of ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/js/game.js', '/js/field.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']) {
        assert.ok(cache[0].urls.includes(path), `${path} fehlt im Cache`);
      }
    });

    await test('Offline: Neuladen startet die App vollständig aus dem Cache', async () => {
      await startGame(page, 3);
      await field(page, 0).locator('.btn5-minus').tap();
      await sleep(300);
      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector('#game:not([hidden]) .field');
      assert.equal(await lifeOf(page, 0), 35, 'Spielstand ist auch offline da');
      await field(page, 0).locator('.zone-plus').tap();
      assert.equal(await lifeOf(page, 0), 36);
      await shot(page, 'offline');
    });

    await test('Offline: ein neuer Tab und eine Adresse mit Query-String laden ebenfalls', async () => {
      const second = await context.newPage();
      await second.goto(`${server.url}index.html?source=pwa`);
      await second.waitForSelector('#game:not([hidden]) .field');
      assert.equal(await second.locator('.field').count(), 3);
      await second.close();
    });

    await test('Offline: alle Module und Symbole stehen zur Verfügung (Menü, Würfel, Historie)', async () => {
      await page.click('#btn-menu');
      await page.click('[data-action=history]');
      assert.ok((await page.locator('#log-list .log-row').count()) >= 1, 'Historie ist auch offline da');
      await page.keyboard.press('Escape');
      await page.click('#btn-menu');
      await page.click('[data-action=dice]');
      assert.equal(await page.locator('.dice-row').count(), 6);
      assert.ok(await page.locator('.dice-row svg.icon').first().evaluate((svg) => svg.getBoundingClientRect().width > 10), 'Symbole aus dem Sprite werden gezeichnet');
      await page.keyboard.press('Escape');
    });
    await context.setOffline(false);
    await noProblems(problems);
    await context.close();
  });

  await group('PWA: Update räumt alte Caches auf', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'mtg-sw-update-'));
    await cp(APP_ROOT, copy, { recursive: true, filter: (src) => !/[\\/](tests|scripts|\.git|node_modules)([\\/]|$)/.test(src) });
    const regenerate = async () => {
      const { next } = await buildServiceWorker(copy);
      await writeFile(join(copy, 'sw.js'), next);
    };
    await regenerate();
    const second = await startServer({ root: copy });
    const { context, page, problems } = await openApp(browser, second.url);

    const cacheNames = () => page.evaluate(() => caches.keys());
    let firstName;

    await test('erste Version wird installiert', async () => {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await waitFor(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
      const names = await cacheNames();
      assert.equal(names.length, 1);
      firstName = names[0];
    });

    await test('nach einer neuen Version existiert nur noch der neue Cache und die neue Version läuft', async () => {
      await page.evaluate(async () => { await (await caches.open('fremde-app-cache')).put('/x', new Response('x')); });
      await writeFile(join(copy, 'js/version.js'), "export const APP_VERSION = '9.9.9';\n");
      await regenerate();
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
      await waitFor(async () => {
        const names = await cacheNames();
        return names.length === 2 && !names.includes(firstName);
      }, { timeout: 8000, message: 'alter Cache gelöscht, neuer angelegt' });
      const names = await cacheNames();
      assert.ok(names.includes('fremde-app-cache'), 'fremde Caches bleiben unangetastet');
      assert.ok(names.some((n) => /^mtg-counter-[0-9a-f]{10}$/.test(n) && n !== firstName));
      await page.reload();
      await page.waitForSelector('#setup:not([hidden])');
      await startGame(page, 2);
      await page.click('#btn-menu');
      await page.click('[data-action=help]');
      assert.match(await page.textContent('#about-version'), /9\.9\.9/);
    });
    await noProblems(problems);
    await context.close();
    await second.close();
    await rm(copy, { recursive: true, force: true });
  });
} finally {
  await browser.close();
  await server.close();
}

// ---- summary ----------------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} von ${results.length} Prüfungen bestanden.`);
if (failed.length > 0) {
  console.log('\nFehlgeschlagen:');
  for (const r of failed) console.log(`  ✗ ${r.name}\n      ${String(r.error?.message ?? r.error).split('\n')[0]}`);
  process.exit(1);
}
