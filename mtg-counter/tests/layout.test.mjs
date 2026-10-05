import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_COUNTS, getLayout } from '../js/layout.js';

test('layouts exist for 2 to 6 players only', () => {
  assert.deepEqual(LAYOUT_COUNTS, [2, 3, 4, 5, 6]);
  for (const bad of [0, 1, 7, NaN, undefined]) assert.throws(() => getLayout(bad), RangeError);
});

test('every layout fills the grid exactly once (no gaps, no overlaps)', () => {
  for (const n of LAYOUT_COUNTS) {
    const { cols, rows, cells } = getLayout(n);
    assert.equal(cells.length, n);
    assert.deepEqual(cells.map((c) => c.seat), [...Array(n).keys()]);
    const covered = new Map();
    for (const c of cells) {
      for (let r = c.row; r < c.row + c.rowSpan; r++) {
        for (let k = c.col; k < c.col + c.colSpan; k++) {
          const key = `${r}/${k}`;
          assert.ok(!covered.has(key), `${n} players: cell ${key} used twice`);
          covered.set(key, c.seat);
        }
      }
    }
    assert.equal(covered.size, cols * rows, `${n} players: grid not fully covered`);
  }
});

test('rotation points every field towards its nearest edge', () => {
  for (const n of LAYOUT_COUNTS) {
    const { rows, cells } = getLayout(n);
    for (const c of cells) {
      assert.ok([0, 90, 180, 270].includes(c.rotation));
      assert.equal(c.sideways, c.rotation === 90 || c.rotation === 270);
      if (c.row === 1 && rows > 1) assert.equal(c.rotation, 180, `${n}p seat ${c.seat}: top row faces the top edge`);
      if (c.row + c.rowSpan - 1 === rows) assert.equal(c.rotation, 0, `${n}p seat ${c.seat}: bottom row faces the bottom edge`);
      if (c.row > 1 && c.row + c.rowSpan - 1 < rows) {
        assert.equal(c.rotation, c.col === 1 ? 90 : 270, `${n}p seat ${c.seat}: middle row faces the side`);
      }
    }
  }
});

test('two players sit opposite each other, three and five use one wide field', () => {
  const two = getLayout(2);
  assert.deepEqual(two.cells.map((c) => c.rotation), [0, 180]);
  assert.equal(two.cols, 1);
  for (const n of [3, 5]) {
    const wide = getLayout(n).cells.filter((c) => c.colSpan === 2);
    assert.equal(wide.length, 1);
    assert.equal(wide[0].seat, 0);
    assert.equal(wide[0].rotation, 0);
  }
  for (const n of [2, 4, 6]) assert.ok(getLayout(n).cells.every((c) => c.colSpan === 1));
});

test('edge flags describe which screen edges a cell touches', () => {
  const { cells } = getLayout(6);
  assert.deepEqual(cells[0].edges, { top: false, bottom: true, left: true, right: false });
  assert.deepEqual(cells[1].edges, { top: false, bottom: false, left: true, right: false });
  assert.deepEqual(cells[3].edges, { top: true, bottom: false, left: false, right: true });
  const wide = getLayout(3).cells[0];
  assert.deepEqual(wide.edges, { top: false, bottom: true, left: true, right: true });
  const solo = getLayout(2).cells[1];
  assert.deepEqual(solo.edges, { top: true, bottom: false, left: true, right: true });
});

test('three-row layouts get a vertical dock, all others a horizontal one', () => {
  for (const n of LAYOUT_COUNTS) {
    const { rows, dock } = getLayout(n);
    assert.equal(dock, rows === 3 ? 'vertical' : 'horizontal', `${n} players`);
  }
});

test('seats run clockwise: the next seat is always the next field around the board', () => {
  // clockwise = bottom-left -> up the left side -> across the top -> down the right side
  const order6 = getLayout(6).cells.map((c) => `${c.row}/${c.col}`);
  assert.deepEqual(order6, ['3/1', '2/1', '1/1', '1/2', '2/2', '3/2']);
  const order4 = getLayout(4).cells.map((c) => `${c.row}/${c.col}`);
  assert.deepEqual(order4, ['2/1', '1/1', '1/2', '2/2']);
});
