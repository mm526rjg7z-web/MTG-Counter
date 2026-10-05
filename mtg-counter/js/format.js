// Text formatting helpers (pure). German UI strings live here and in index.html.

import { isMarkerKind } from './game.js';

export const MINUS = '−';

// "−12" instead of "-12": the typographic minus matches the width of the plus sign.
export function formatNumber(n) {
  return n < 0 ? `${MINUS}${-n}` : String(n);
}

// Signed change: "+3", "−7", "0".
export function formatSigned(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${-n}`;
  return '0';
}

const pad2 = (n) => String(n).padStart(2, '0');

// Local time as HH:MM:SS.
export function formatTime(timestamp) {
  const d = new Date(timestamp);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export const KIND_LABELS = {
  life: 'Leben',
  poison: 'Gift',
  energy: 'Energie',
  experience: 'Erfahrung',
  cmd: 'Commander-Schaden',
  monarch: 'Monarch',
  initiative: 'Initiative',
};

// Why a player is out (short, used in the chip of an eliminated field).
export const REASON_LABELS = {
  life: 'Leben',
  poison: 'Gift',
  commander: 'Commander',
};

// Plain-language sentence for a marker change, e.g. "Anna wird Monarch".
function markerPhrase(entry, game) {
  const nameOf = (id) => game.players[id]?.name ?? '?';
  const { kind, from, to } = entry;
  if (from !== null && to !== null) return `${KIND_LABELS[kind]}: ${nameOf(from)} \u2192 ${nameOf(to)}`;
  const holder = nameOf(to ?? from);
  if (kind === 'monarch') return to !== null ? `${holder} wird Monarch` : `${holder} ist nicht mehr Monarch`;
  return to !== null ? `${holder} \u00fcbernimmt die Initiative` : `${holder} verliert die Initiative`;
}

// Turns a history entry into display parts: { pid, label, from, to, delta, phrase }.
// Markers (monarch / initiative) have no numeric change: `delta` is null and `phrase` holds a sentence.
export function describeEntry(entry, game) {
  const nameOf = (id) => (id === null || id === undefined ? '\u2013' : game.players[id]?.name ?? '?');
  if (isMarkerKind(entry.kind)) {
    return {
      pid: entry.to ?? entry.from,
      label: KIND_LABELS[entry.kind],
      from: nameOf(entry.from),
      to: nameOf(entry.to),
      delta: null,
      phrase: markerPhrase(entry, game),
    };
  }
  const label = entry.kind === 'cmd'
    ? `${KIND_LABELS.cmd} von ${nameOf(entry.src)}`
    : KIND_LABELS[entry.kind];
  return {
    pid: entry.pid,
    label,
    from: formatNumber(entry.from),
    to: formatNumber(entry.to),
    delta: entry.to - entry.from,
    phrase: null,
  };
}

// Short one-line summary, e.g. for the undo button's label.
export function summarizeEntry(entry, game) {
  const d = describeEntry(entry, game);
  if (d.phrase !== null) return d.phrase;
  const who = game.players[d.pid]?.name ?? '?';
  return `${who}: ${d.label} ${d.from} \u2192 ${d.to} (${formatSigned(d.delta)})`;
}
