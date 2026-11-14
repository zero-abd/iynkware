export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Space left between two parts, so a wire can still be seen between them. */
const GAP_MM = 3;
const MAX_ROUNDS = 200;

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w + GAP_MM && b.x < a.x + a.w + GAP_MM && a.y < b.y + b.h + GAP_MM && b.y < a.y + a.h + GAP_MM;

/**
 * Moves boxes that sit on top of each other apart. `fixed` stays where it is (the board); each box in `parts` keeps its
 * place unless it touches the board or a part before it in reading order, and then goes to the nearest free spot beside
 * what it touched. The same input always gives the same positions.
 */
export function spreadApart(fixed: readonly Box[], parts: readonly Box[]): Map<string, { x: number; y: number }> {
  const placed: Box[] = [...fixed];
  const out = new Map<string, { x: number; y: number }>();
  const ordered = [...parts].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  for (const part of ordered) {
    let box = part;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const hit = placed.filter((p) => overlaps(box, p));
      if (hit.length === 0) break;
      const moves = hit.flatMap((p) => [
        { x: p.x + p.w + GAP_MM, y: box.y },
        { x: p.x - box.w - GAP_MM, y: box.y },
        { x: box.x, y: p.y + p.h + GAP_MM },
        { x: box.x, y: p.y - box.h - GAP_MM },
      ]);
      const free = moves.filter((m) => !placed.some((p) => overlaps({ ...box, ...m }, p)));
      const pool = free.length > 0 ? free : moves;
      const distance = (m: { x: number; y: number }) => Math.hypot(m.x - part.x, m.y - part.y);
      const best = pool.reduce((a, b) => (distance(b) < distance(a) ? b : a));
      box = { ...box, ...best };
    }
    placed.push(box);
    out.set(part.id, { x: box.x, y: box.y });
  }
  return out;
}
