// @cf title Inductor
// @cf use engine/bench.list
/* Axial moulded inductor (a leaded choke) with three colour bands read as the value in microhenries, like a resistor
   (brown black brown = 100 uH; brown black orange = 10 mH). 100 uH: DC resistance about 0.5 ohm and 0.4 A
   rating; 10 mH: about 30 ohm and 0.05 A, typical of small axial chokes (docs/facts/analog-parts.md section 5).
   Pushed past its current rating it overheats and burns out; a coil at DC is a short, and
   switched off it kicks the voltage back (the reason for a flyback diode). See-through: the ferrite core and the winding. */
(() => {
const B = SL.bench, T = B.T;
const VALUES = { '100 uH': 100, '10 mH': 10000 };
const DEF = { value: '100 uH', demo: 'ok' };
const DEMO = { ok: null, 'over its current': 'burnt' };
const BANDS = ['#2a2623', '#8a5a34', '#e2483d', '#f08a2b', '#f2c230', '#43b05c', '#3e86d9', '#8c4bd1', '#9a958c', '#f6f3ea'];
const bands = uH => { const e = Math.floor(Math.log10(uH) + 1e-9) - 1, sig = Math.round(uH / Math.pow(10, e)); return [BANDS[Math.floor(sig / 10) % 10], BANDS[sig % 10], BANDS[Math.max(0, Math.min(9, e))]]; };
const valueOf = p => VALUES[p.value] ? p.value : DEF.value;
const text = v => v.replace(' uH', ' µH');
B.part('inductor', {
  name: 'Inductor', fig: 'P35', legs: ['1', '2'], span: [3, 6],
  params: { value: Object.keys(VALUES), demo: Object.keys(DEMO) }, paramNames: { value: 'Value', demo: 'Show' },
  defaults: DEF,
  elec: p => ({ type: 'res', ohms: valueOf(p) === '100 uH' ? .5 : 30 }),
  tag: (p, m) => (DEMO[p.demo] || (m && m.state)) === 'burnt' ? T('{id} · burnt', { id: p.id }) : T('{id} · {v}', { id: p.id, v: text(valueOf(p)) }),
  draw(ctx){
    const p = Object.assign({}, DEF, ctx.p), [a, b] = ctx.legs, k = ctx.k != null ? ctx.k : (ctx.st && ctx.st.xr) || 0;
    const dead = (DEMO[p.demo] || (ctx.m && ctx.m.state)) === 'burnt', z = 2.6, d = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(...d) || 1, u = d.map(v => v / len);
    const bl = Math.min(7, len - 2.6), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2] + z];
    const at = t => [mid[0] + u[0] * t, mid[1] + u[1] * t, mid[2]], c0 = at(-bl / 2), c1 = at(bl / 2);
    let s = rod(a, [a[0], a[1], a[2] + z - .3], .22, B.M.tin, toneI, .45) + rod([a[0], a[1], a[2] + z - .3], c0, .22, B.M.tin, toneI, .45)
      + rod(b, [b[0], b[1], b[2] + z - .3], .22, B.M.tin, toneI, .45) + rod([b[0], b[1], b[2] + z - .3], c1, .22, B.M.tin, toneI, .45);
    let body = rod(c0, c1, 1.7, dead ? matOf('#2a2420') : { l: '#c8d4b4', m: '#9fb089', d: '#667a55' }, toneI, .8);
    if (!dead) bands(VALUES[valueOf(p)]).forEach((col, i) => { const t = (.2 + i * .15) * bl - bl / 2; body += rod(at(t - .22), at(t + .22), 1.75, matOf(col), toneI, .3); });
    if (k > .02){
      let x = rod(c0, c1, .8, { l: '#8a8f94', m: '#62676b', d: '#3e4245' }, toneI, .3);
      for (let i = 0; i < 9; i++){ const t = -bl / 2 + .6 + i * (bl - 1.2) / 8; x += rod(at(t - .12), at(t + .12), 1.25, B.M.copper, toneI, .25); }
      body = `<g opacity="${f(1 - .75 * k)}">${body}</g><g opacity="${f(k)}">${x}</g>`;
      if (k > .5 && typeof ctx.label === 'function' && (!!ctx.sel || !!(B.md && B.md.def && B.md.def.partPage))){ ctx.label(at(0), 'Winding'); ctx.label(at(bl / 2 - .8), 'Ferrite core'); }
    }
    s += body;
    if (dead){ const [X, Y] = P(mid[0], mid[1], mid[2] + 2); s += `<circle cx="${f(X)}" cy="${f(Y - 4)}" r="3" fill="#8a847a" opacity=".45"/>`; }
    ctx.put([[Math.min(a[0], b[0]) - 2, Math.min(a[1], b[1]) - 2, a[2]], [Math.max(a[0], b[0]) + 2, Math.max(a[1], b[1]) + 2, a[2] + z + 2]], s);
  },
  show: { breadboard: 'mini', parts: [
    { id: 'L1', part: 'inductor', value: '100 uH', holes: ['c4', 'c9'] },
    { id: 'L2', part: 'inductor', value: '10 mH', holes: ['h9', 'h14'] },
  ], wires: [] },
});
})();
