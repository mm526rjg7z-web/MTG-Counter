// The board: a CSS grid with one field per player, laid out according to js/layout.js.

import { createField } from './field.js';

export function createBoard(container, { layout, api }) {
  container.replaceChildren();
  container.style.setProperty('--cols', String(layout.cols));
  container.style.setProperty('--rows', String(layout.rows));

  const playerCount = layout.cells.length;
  const fields = layout.cells.map((cell) => createField({ cell, playerCount, api }));
  container.append(...fields.map((f) => f.el));

  return {
    fields,
    update(game, now = Date.now()) {
      for (const field of fields) field.update(game, now);
    },
    flashStarter(seat) {
      fields[seat]?.flashStarter();
    },
    destroy() {
      for (const field of fields) field.destroy();
      container.replaceChildren();
    },
  };
}
