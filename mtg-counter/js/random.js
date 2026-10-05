// Randomness for dice, coin and starting player. The only entropy source is crypto.getRandomValues.

export const DICE = [4, 6, 8, 10, 12, 20];

const UINT32_RANGE = 0x100000000;

function defaultFill(buffer) {
  return globalThis.crypto.getRandomValues(buffer);
}

// Uniform integer in [0, maxExclusive). Rejection sampling avoids modulo bias.
// `fill` can be replaced in tests to feed a deterministic stream.
export function randomInt(maxExclusive, fill = defaultFill) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError('maxExclusive must be an integer between 1 and 2^32');
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive); // largest multiple of maxExclusive
  const buffer = new Uint32Array(1);
  let value;
  do {
    fill(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % maxExclusive;
}

export function rollDie(sides, fill) {
  return 1 + randomInt(sides, fill);
}

// counts: { 6: 2, 20: 1 } -> [{ sides: 6, value: 3 }, { sides: 6, value: 5 }, { sides: 20, value: 17 }]
export function rollDice(counts, fill) {
  const results = [];
  for (const sides of DICE) {
    for (let i = 0; i < (counts[sides] ?? 0); i++) results.push({ sides, value: rollDie(sides, fill) });
  }
  return results;
}

export function flipCoin(fill) {
  return randomInt(2, fill) === 0 ? 'heads' : 'tails';
}

export function pickIndex(length, fill) {
  return randomInt(length, fill);
}
