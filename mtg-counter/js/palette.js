// Player colours. `bg` is the field background, `fg` the text colour used on top of it.
// Every pair keeps a WCAG contrast ratio of at least 4.5:1 (verified in tests/palette.test.mjs).

export const PALETTE = [
  { id: 'red', name: 'Rot', bg: '#c62828', fg: '#ffffff' },
  { id: 'blue', name: 'Blau', bg: '#1565c0', fg: '#ffffff' },
  { id: 'green', name: 'Grün', bg: '#2e7d32', fg: '#ffffff' },
  { id: 'yellow', name: 'Gelb', bg: '#f5c400', fg: '#141414' },
  { id: 'purple', name: 'Violett', bg: '#7b1fa2', fg: '#ffffff' },
  { id: 'orange', name: 'Orange', bg: '#fb8c00', fg: '#141414' },
  { id: 'cyan', name: 'Cyan', bg: '#26c6da', fg: '#141414' },
  { id: 'pink', name: 'Pink', bg: '#c2185b', fg: '#ffffff' },
];

// Order in which colours are handed out to new players (neighbouring seats differ strongly).
export const DEFAULT_COLOR_ORDER = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

export function getColor(id) {
  return PALETTE.find((c) => c.id === id) ?? PALETTE[0];
}

export function isColorId(id) {
  return PALETTE.some((c) => c.id === id);
}

// First colour (default order first, then the rest of the palette) that is not in `used`.
export function pickFreeColor(used) {
  const order = [...DEFAULT_COLOR_ORDER, ...PALETTE.map((c) => c.id)];
  return order.find((id) => !used.has(id)) ?? PALETTE[0].id;
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// WCAG 2.x contrast ratio between two #rrggbb colours.
export function contrastRatio(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
