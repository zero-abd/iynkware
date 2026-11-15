/**
 * Cells of a strip of inked keys drawn on one face: the scope's controls and the serial keypad are each one canvas
 * (one draw call) with one hit plane, and a hit point is turned into the key under it here. Pure; tested in node.
 */

export interface Cell {
  /** Key id. */
  readonly id: string;
  /** Position and size in the face's own units (0..w, 0..h, y down). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Lays keys out in rows. `rows[r]` lists `[id, weight]` pairs: a key's width is its share of the row's weight. Keys are
 * separated by `gap`, rows too. A blank key (`''`) takes room and is skipped by `cellAt`.
 */
export function layoutCells(w: number, h: number, rows: ReadonlyArray<ReadonlyArray<readonly [string, number]>>, gap: number): Cell[] {
  const out: Cell[] = [];
  const rowH = (h - gap * (rows.length - 1)) / rows.length;
  rows.forEach((row, r) => {
    const total = row.reduce((s, [, weight]) => s + weight, 0);
    const room = w - gap * (row.length - 1);
    let x = 0;
    for (const [id, weight] of row) {
      const cw = (room * weight) / total;
      if (id !== '') out.push({ id, x, y: r * (rowH + gap), w: cw, h: rowH });
      x += cw + gap;
    }
  });
  return out;
}

/** The key under a point of the face (x right, y down), or null between keys. */
export function cellAt(cells: readonly Cell[], x: number, y: number): Cell | null {
  for (const c of cells) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c;
  return null;
}

/** A point on a centred plane of `w` by `h` metres, from its local x and y (y up), in the face's top-left y-down frame. */
export const faceXY = (localX: number, localY: number, w: number, h: number): { x: number; y: number } => ({ x: localX + w / 2, y: h / 2 - localY });
