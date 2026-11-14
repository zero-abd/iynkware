/* The shared drawing of an 8-pin DIP chip (0.3 inch row spacing, 9.8 x 6.35 x 3.3 mm moulded body) for the LM358 and
   the NE555. Legs run 1-4 along one row and 5-8 back along the other; pin 1 has a dot and the notch is at its end.
   dip(ctx, { mark, lines, hot, dead, inside }): `mark` is the printed type, `inside(F, k)` draws the die for see-through. */
(() => {
const B = SL.bench;
const EPOXY = { l: '#4a4642', m: '#34312e', d: '#1f1d1b' };
const frame = legs => {
  const n = legs.length, o = [0, 1, 2].map(k => legs.reduce((s, q) => s + q[k], 0) / n);
  const dx = legs[3][0] - legs[0][0], dy = legs[3][1] - legs[0][1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  const W = (a, b, z) => [o[0] + ux * a - uy * b, o[1] + uy * a + ux * b, o[2] + z];
  return { o, ux, uy, W,
    loc: q => { const x = q[0] - o[0], y = q[1] - o[1]; return [x * ux + y * uy, -x * uy + y * ux]; },
    slab: (a0, b0, a1, b1, z0, z1, m, w = .6) => B.slabW(W, a0, b0, a1, b1, z0, z1, m, toneI, w) };
};
B.dip = (ctx, o) => {
  const legs = ctx.legs, F = frame(legs), k = ctx.k != null ? ctx.k : (ctx.st && ctx.st.xr) || 0;
  const z0 = 1.1, z1 = 4.4, hl = 4.9, hw = 3.175;
  let s = '';
  for (const L of legs){
    const [a, b] = F.loc(L), side = b >= 0 ? 1 : -1;
    s += rod(F.W(a, b, -.3), F.W(a, b, z0 + .5), .22, B.M.tin, toneI, .4) + rod(F.W(a, b, z0 + .5), F.W(a, side * (hw + .1), z0 + 1.1), .22, B.M.tin, toneI, .4);
  }
  const body = o.dead ? matOf('#2a2420') : EPOXY;
  let top = F.slab(-hl, -hw, hl, hw, z0, z1, body, .8);
  if (k < .5){
    top += `<path d="${pd(B.circ(0, 0, 1, 14).map(([u, v]) => F.W(-hl + u * .5 - .2, v * .5, z1 + .01)))}" fill="#14120f" opacity=".9"/>`;
    top += `<circle cx="${f(P(...F.W(-hl + 1.6, -hw + 1.3, z1 + .02))[0])}" cy="${f(P(...F.W(-hl + 1.6, -hw + 1.3, z1 + .02))[1])}" r=".5" fill="#14120f"/>`;
    top += B.flatText(F.W(.5, .25, z1 + .02), -F.uy, -F.ux, o.mark, 1.3, '#cfcac0', 700);
  }
  if (k > .02){
    const x = o.inside(F, k) || '';
    top = `<g opacity="${f(1 - .65 * k)}">${top}</g><g opacity="${f(k)}">${x}</g>`;
    if (k > .5 && o.callouts && typeof ctx.label === 'function'){
      ctx.label(F.W(0, 0, z0 + 1.6), 'Silicon die', o.live);
      ctx.label(F.W(2.2, -2.2, z0 + 1.6), 'Bond wires');
    }
  }
  s += top;
  if (o.dead){ const [X, Y] = P(...F.W(0, 0, z1 + 2)); s += `<circle cx="${f(X)}" cy="${f(Y - 4)}" r="3" fill="#8a847a" opacity=".45"/><circle cx="${f(X + 3)}" cy="${f(Y - 8)}" r="2.2" fill="#8a847a" opacity=".3"/>`; }
  const lo = F.W(-hl - 1, -hw - 1, 0), hi = F.W(hl + 1, hw + 1, z1 + 1);
  ctx.put([[Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), F.o[2]], [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), F.o[2] + z1 + 1]], s);
};
// the die and its lead-frame fingers, shared by both chips; `glow` lights the die while it runs
B.dipInside = (F, glow, dead) => {
  let x = '';
  const z = 2.3;
  for (let i = 0; i < 4; i++){ const a = (i - 1.5) * 2.54; for (const sd of [-1, 1]) x += rod(F.W(a, sd * 3.0, z), F.W(a * .45, sd * 1.5, z), .2, B.M.tin, toneI, .3); }
  x += F.slab(-1.9, -1.2, 1.9, 1.2, z - .2, z + .35, B.M.tin, .3);
  x += F.slab(-1.4, -.85, 1.4, .85, z + .35, z + .75, matOf(dead ? '#2a2623' : '#6f7f9a'), .3);
  if (glow && !dead) x += `<path d="${pd([F.W(-1.4, -.85, z + .78), F.W(1.4, -.85, z + .78), F.W(1.4, .85, z + .78), F.W(-1.4, .85, z + .78)])}" fill="#ffd34d" opacity=".5"/>`;
  for (let i = 0; i < 4; i++){ const a = (i - 1.5) * .7; for (const sd of [-1, 1]) x += `<path d="${pd([F.W(a, sd * .85, z + .85), F.W(a * 1.6, sd * 1.5, z + 1.3), F.W((i - 1.5) * 2.54 * .45, sd * 1.5, z + .1)], false)}" fill="none" stroke="#e8c15a" stroke-width=".4"/>`; }
  return x;
};
})();
