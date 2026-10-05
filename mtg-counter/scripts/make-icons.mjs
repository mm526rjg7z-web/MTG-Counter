// Generates every app icon from one self-drawn vector design (no external artwork).
//   NODE_PATH=$(npm root -g) node scripts/make-icons.mjs
// Needs Playwright (any Chromium) only to rasterise the SVG; the SVG files themselves are committed.
//
// Design: four arcs in the player colours around a bold "40" drawn as plain strokes (no font needed,
// so the result is identical on every machine).
// Output (in icons/):
//   icon.svg, icon-maskable.svg                  vector sources ("any" has rounded corners, maskable is full bleed)
//   icon-192.png, icon-512.png                   purpose "any"
//   icon-maskable-192.png, icon-maskable-512.png purpose "maskable" (all content inside the central 80 % safe zone)
//   apple-touch-icon.png (180)                   iOS home screen, opaque and full bleed
//   favicon-32.png

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');

const COLORS = ['#c62828', '#1565c0', '#2e7d32', '#f5c400']; // red, blue, green, yellow
const CENTER = 256;
const RING_RADIUS = 168;
const RING_WIDTH = 30;

function arc(fromDeg, toDeg) {
  const point = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${(CENTER + RING_RADIUS * Math.cos(rad)).toFixed(2)} ${(CENTER + RING_RADIUS * Math.sin(rad)).toFixed(2)}`;
  };
  return `M${point(fromDeg)}A${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${point(toDeg)}`;
}

export function buildSvg({ maskable }) {
  const corner = maskable ? 0 : 112;
  // each colour covers 70 degrees of the ring with 20 degrees of gap
  const arcs = COLORS.map((color, i) => {
    const start = -80 + i * 90;
    return `<path d="${arc(start, start + 70)}" stroke="${color}"/>`;
  }).join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="36%" r="80%">
      <stop offset="0" stop-color="#2a2a3a"/>
      <stop offset="1" stop-color="#0c0c12"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${corner}" fill="url(#bg)"/>
  <g fill="none" stroke-width="${RING_WIDTH}" stroke-linecap="round">
    ${arcs}
  </g>
  <g fill="none" stroke="#ffffff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
    <path d="M214 191V321M214 191L150 283H244"/>
    <ellipse cx="322" cy="256" rx="40" ry="65"/>
  </g>
</svg>
`;
}

async function render(browser, svg, size, file, { transparent }) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const sized = svg.replace('width="512" height="512"', `width="${size}" height="${size}"`);
  await page.setContent(`<!doctype html><body style="margin:0;background:${transparent ? 'transparent' : '#0c0c12'}">${sized}</body>`);
  await page.screenshot({ path: join(outDir, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { chromium } = require('playwright');
  await mkdir(outDir, { recursive: true });
  const any = buildSvg({ maskable: false });
  const maskable = buildSvg({ maskable: true });
  await writeFile(join(outDir, 'icon.svg'), any);
  await writeFile(join(outDir, 'icon-maskable.svg'), maskable);

  const browser = await chromium.launch();
  await render(browser, any, 192, 'icon-192.png', { transparent: true });
  await render(browser, any, 512, 'icon-512.png', { transparent: true });
  await render(browser, maskable, 192, 'icon-maskable-192.png', { transparent: false });
  await render(browser, maskable, 512, 'icon-maskable-512.png', { transparent: false });
  await render(browser, maskable, 180, 'apple-touch-icon.png', { transparent: false });
  await render(browser, any, 32, 'favicon-32.png', { transparent: true });
  await browser.close();
  console.log('Icons geschrieben nach', outDir);
}
