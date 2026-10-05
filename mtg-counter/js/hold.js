// Press-and-hold repeat for +/- controls.
//   press            -> one step immediately (a tap is exactly one point)
//   hold > 400 ms    -> repeats single steps every 100 ms
//   hold > 1 s       -> repeats steps of 5 every 200 ms
// Pointer capture keeps the hold alive when the finger drifts, and every hold ends on
// pointerup / pointercancel / lost capture / window blur, so a missed event can never leave a
// control repeating forever. Several fingers on different controls work independently.

export const HOLD_DELAY_MS = 400;
export const REPEAT_MS = 100;
export const ACCELERATE_AFTER_MS = 1000;
export const FAST_REPEAT_MS = 200;
export const FAST_STEP = 5;

const running = new Set();

export function stopAllHolds() {
  for (const stop of [...running]) stop();
}

if (typeof window !== 'undefined') {
  window.addEventListener('blur', stopAllHolds);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') stopAllHolds();
  });
}

// onStep(size, phase): size is 1 or 5, phase is 'tap' | 'repeat' | 'fast' | 'key'.
// The caller decides the sign. `accelerate()` can veto the 5-steps (e.g. for small counters).
export function attachHold(el, onStep, { accelerate = () => true } = {}) {
  let hold = null;

  function stop() {
    if (!hold) return;
    clearTimeout(hold.timer);
    el.classList.remove('is-down');
    running.delete(stop);
    const { pointerId } = hold;
    hold = null;
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      /* element already detached */
    }
  }

  function tick() {
    if (!hold) return;
    if (el.getClientRects().length === 0) return stop(); // hidden or removed while held
    const fast = accelerate() && performance.now() - hold.startedAt >= ACCELERATE_AFTER_MS;
    onStep(fast ? FAST_STEP : 1, fast ? 'fast' : 'repeat');
    if (hold) hold.timer = setTimeout(tick, fast ? FAST_REPEAT_MS : REPEAT_MS);
  }

  el.addEventListener('pointerdown', (event) => {
    if (hold || event.button !== 0) return;
    event.preventDefault();
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable: window listeners below still end the hold */
    }
    hold = { pointerId: event.pointerId, startedAt: performance.now(), timer: 0 };
    running.add(stop);
    el.classList.add('is-down');
    onStep(1, 'tap');
    if (hold) hold.timer = setTimeout(tick, HOLD_DELAY_MS);
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(type, (event) => {
      if (hold && event.pointerId === hold.pointerId) stop();
    });
  }

  // Keyboard and assistive technology activate buttons with a click that has no pointer (detail 0).
  el.addEventListener('click', (event) => {
    if (event.detail === 0) onStep(1, 'key');
  });

  el.addEventListener('contextmenu', (event) => event.preventDefault());
}
