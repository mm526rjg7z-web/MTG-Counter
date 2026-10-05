// Screen Wake Lock: keeps the display on while a game is running.
// The browser drops the lock whenever the page is hidden, so it is requested again when the page
// becomes visible. If a request fails (e.g. it needs a user gesture) it is retried on the next tap.
// Browsers without the API are reported via `supported` and the app keeps working normally.

export function createWakeLock(onChange = () => {}) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  let wanted = false;
  let sentinel = null;
  let pending = false;

  async function acquire() {
    if (!supported || !wanted || sentinel || pending || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!wanted) {
        lock.release().catch(() => {});
      } else {
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
          onChange(false);
        });
        onChange(true);
      }
    } catch {
      sentinel = null; // denied or not allowed right now: try again on the next interaction
    } finally {
      pending = false;
    }
  }

  function release() {
    const lock = sentinel;
    sentinel = null;
    if (lock) lock.release().catch(() => {});
    onChange(false);
  }

  if (supported) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') acquire();
    });
    document.addEventListener('pointerdown', () => {
      if (wanted && !sentinel) acquire();
    }, { capture: true, passive: true });
  }

  return {
    supported,
    get active() {
      return sentinel !== null;
    },
    enable() {
      wanted = true;
      return acquire();
    },
    disable() {
      wanted = false;
      release();
    },
  };
}
