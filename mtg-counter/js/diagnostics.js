// Diagnostics dialog: shows what the device reports about its screen, so a report like "buttons are
// shifted on my iPhone" comes with numbers instead of guesses. Reachable from the help dialog and from
// the start screen (where a shifted layout is noticed first).

import { h } from './dom.js';
import { APP_VERSION } from './version.js';
import { TAP_REACH_PX, describeTap, describeViewport, measureViewport } from './viewport.js';

const byId = (id) => document.getElementById(id);
const CACHE_PREFIX = 'mtg-counter-';

async function describeApp() {
  let cache = 'kein Service Worker';
  if (typeof caches !== 'undefined') {
    const names = (await caches.keys().catch(() => [])).filter((name) => name.startsWith(CACHE_PREFIX));
    cache = names.length > 0 ? names.map((name) => name.slice(CACHE_PREFIX.length)).join(', ') : 'noch nicht angelegt';
  }
  const controlled = typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller);
  return [
    ['App-Version', APP_VERSION],
    ['Offline-Cache', cache],
    ['Service Worker', controlled ? 'aktiv' : 'nicht aktiv'],
  ];
}

// viewport: the object returned by watchViewport() (realign on request).
export function initDiagnostics({ viewport }) {
  const dialog = byId('dlg-diag');
  const list = byId('diag-list');
  const done = byId('diag-done');
  let token = 0; // only the newest measurement may write into the list

  async function render() {
    const mine = ++token;
    const rows = [...describeViewport(measureViewport()), ...await describeApp()];
    if (mine !== token) return;
    list.replaceChildren(...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)]));
  }

  // Tap test: tap the centre of the drawn crosshair. clientX/clientY are where the page registers the
  // touch, the crosshair's rectangle is where the page believes it is. They differ if touch areas are shifted.
  const target = byId('diag-tap');
  const tapResult = byId('diag-tap-result');
  dialog.addEventListener('pointerdown', (event) => {
    const rect = target.getBoundingClientRect();
    const dx = Math.round(event.clientX - (rect.left + rect.width / 2));
    const dy = Math.round(event.clientY - (rect.top + rect.height / 2));
    if (Math.hypot(dx, dy) > TAP_REACH_PX) return;
    const { ok, text } = describeTap(dx, dy);
    tapResult.textContent = text;
    tapResult.classList.toggle('is-ok', ok);
    tapResult.classList.toggle('is-off', !ok);
  });

  byId('diag-realign').addEventListener('click', () => {
    viewport.realign({ force: true });
    done.hidden = false;
    // WebKit needs a moment before the new geometry shows up in the numbers
    setTimeout(render, 250);
  });

  return {
    open() {
      done.hidden = true;
      tapResult.textContent = 'Noch nicht getippt.';
      tapResult.classList.remove('is-ok', 'is-off');
      render();
      if (!dialog.open) dialog.showModal();
    },
  };
}
