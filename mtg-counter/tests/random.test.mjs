import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICE, flipCoin, pickIndex, randomInt, rollDice, rollDie } from '../js/random.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Feeds a fixed sequence of "random" 32-bit values.
function sequence(...values) {
  let i = 0;
  return (buffer) => {
    buffer[0] = values[i++ % values.length];
    return buffer;
  };
}

test('randomInt stays inside the requested range', () => {
  for (const max of [1, 2, 3, 6, 20, 1000]) {
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(max);
      assert.ok(Number.isInteger(v) && v >= 0 && v < max, `${v} not in [0, ${max})`);
    }
  }
  assert.equal(randomInt(1), 0);
});

test('randomInt validates its argument', () => {
  for (const bad of [0, -1, 1.5, NaN, 2 ** 32 + 1, '6', undefined]) {
    assert.throws(() => randomInt(bad), RangeError);
  }
});

test('randomInt rejects values from the biased tail (no modulo bias)', () => {
  // For max=3 the largest multiple of 3 below 2^32 is 2^32-1, so 0xFFFFFFFF must be skipped.
  assert.equal(randomInt(3, sequence(0xffffffff, 5)), 2);
  assert.equal(randomInt(3, sequence(0xfffffffe, 5)), 0xfffffffe % 3);
  // Powers of two have no biased tail at all.
  assert.equal(randomInt(8, sequence(0xffffffff)), 7);
  assert.equal(randomInt(2 ** 32, sequence(0xffffffff)), 0xffffffff);
});

test('dice are uniformly distributed (chi-square, real crypto source)', () => {
  for (const sides of [6, 20]) {
    const rolls = sides * 4000;
    const counts = new Array(sides).fill(0);
    for (let i = 0; i < rolls; i++) counts[rollDie(sides) - 1]++;
    const expected = rolls / sides;
    const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    // critical value for p=0.0001 at 19 degrees of freedom is ~43.8; 60 keeps the test stable
    assert.ok(chi2 < 60, `d${sides}: chi-square ${chi2.toFixed(1)} too high`);
  }
});

test('rollDice honours the selected counts and die sizes', () => {
  assert.deepEqual(rollDice({}), []);
  const rolled = rollDice({ 6: 2, 20: 1, 4: 3 });
  assert.equal(rolled.length, 6);
  assert.deepEqual(rolled.map((r) => r.sides), [4, 4, 4, 6, 6, 20]);
  for (const r of rolled) assert.ok(r.value >= 1 && r.value <= r.sides);
  assert.deepEqual(DICE, [4, 6, 8, 10, 12, 20]);
});

test('coin and index helpers use the same source', () => {
  assert.equal(flipCoin(sequence(0)), 'heads');
  assert.equal(flipCoin(sequence(1)), 'tails');
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(flipCoin());
  assert.deepEqual([...seen].sort(), ['heads', 'tails']);
  for (let i = 0; i < 200; i++) assert.ok(pickIndex(5) < 5);
});

test('no source file uses Math.random', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'tests') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|mjs|html)$/.test(name) && /Math\s*\.\s*random/.test(readFileSync(path, 'utf8'))) offenders.push(path);
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
