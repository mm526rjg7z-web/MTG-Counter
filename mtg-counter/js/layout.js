// Board layouts per player count (pure data, no DOM).
//
// The board is a CSS grid. Each cell hosts one player field, rotated towards the nearest table edge:
//   top row    -> 180°  (player sits at the top edge, reads upside down from the bottom's view)
//   bottom row ->   0°
//   middle row -> 90° (left column) / 270° (right column): the player sits at the left / right edge
// `rotation` is the clockwise CSS rotation of the field's content. Seats are numbered clockwise,
// starting at the bottom of the phone, so "next player" is simply seat + 1.

const LAYOUTS = {
  2: {
    cols: 1,
    rows: 2,
    cells: [
      { row: 2, col: 1, rotation: 0 },
      { row: 1, col: 1, rotation: 180 },
    ],
  },
  3: {
    cols: 2,
    rows: 2,
    cells: [
      { row: 2, col: 1, colSpan: 2, rotation: 0 },
      { row: 1, col: 1, rotation: 180 },
      { row: 1, col: 2, rotation: 180 },
    ],
  },
  4: {
    cols: 2,
    rows: 2,
    cells: [
      { row: 2, col: 1, rotation: 0 },
      { row: 1, col: 1, rotation: 180 },
      { row: 1, col: 2, rotation: 180 },
      { row: 2, col: 2, rotation: 0 },
    ],
  },
  5: {
    cols: 2,
    rows: 3,
    dock: 'vertical',
    cells: [
      { row: 3, col: 1, colSpan: 2, rotation: 0 },
      { row: 2, col: 1, rotation: 90 },
      { row: 1, col: 1, rotation: 180 },
      { row: 1, col: 2, rotation: 180 },
      { row: 2, col: 2, rotation: 270 },
    ],
  },
  6: {
    cols: 2,
    rows: 3,
    dock: 'vertical',
    cells: [
      { row: 3, col: 1, rotation: 0 },
      { row: 2, col: 1, rotation: 90 },
      { row: 1, col: 1, rotation: 180 },
      { row: 1, col: 2, rotation: 180 },
      { row: 2, col: 2, rotation: 270 },
      { row: 3, col: 2, rotation: 0 },
    ],
  },
};

export const LAYOUT_COUNTS = Object.keys(LAYOUTS).map(Number);

// Returns { cols, rows, dock, cells: [{ seat, row, col, rowSpan, colSpan, rotation, sideways, edges }] }.
// `edges` tells which screen edges a cell touches (used for safe-area padding).
// `dock` is the shape of the menu button group in the screen centre. With three rows the centre
// lies inside the sideways middle fields, whose "top" edge is the screen's left/right edge, so
// there the dock is a vertical pill: it then reaches only half its (small) width into those fields.
export function getLayout(playerCount) {
  const def = LAYOUTS[playerCount];
  if (!def) throw new RangeError(`Unsupported player count: ${playerCount}`);
  const cells = def.cells.map((c, seat) => {
    const rowSpan = c.rowSpan ?? 1;
    const colSpan = c.colSpan ?? 1;
    return {
      seat,
      row: c.row,
      col: c.col,
      rowSpan,
      colSpan,
      rotation: c.rotation,
      sideways: c.rotation === 90 || c.rotation === 270,
      edges: {
        top: c.row === 1,
        bottom: c.row + rowSpan - 1 === def.rows,
        left: c.col === 1,
        right: c.col + colSpan - 1 === def.cols,
      },
    };
  });
  return { cols: def.cols, rows: def.rows, dock: def.dock ?? 'horizontal', cells };
}
