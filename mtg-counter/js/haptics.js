// Short haptic feedback via the Vibration API. Unsupported browsers (iOS Safari) simply do nothing.

const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let enabled = true;

export const hapticsSupported = supported;

export function setHapticsEnabled(value) {
  enabled = Boolean(value);
  if (!enabled && supported) navigator.vibrate(0);
}

function pulse(pattern) {
  if (!enabled || !supported) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when called without user activation */
  }
}

export const haptic = {
  tap: () => pulse(8),
  repeat: () => pulse(5),
  big: () => pulse(16),
  out: () => pulse([60, 40, 90]),
  roll: () => pulse([20, 40, 20]),
};
