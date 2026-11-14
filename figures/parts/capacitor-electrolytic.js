// @cf title Electrolytic capacitor
// @cf use engine/bench.list
/* Radial aluminium electrolytic capacitor with a printed sleeve: the value and rated voltage on the side and a pale
   stripe with minus signs down the negative side; the positive lead is the longer one. Sizes follow the common
   105 degC general purpose families (diameter x height: 5 x 11 mm for 10 uF to 47 uF, 6.3 x 11 mm for 100 uF, 8 x 12 mm for
   220 uF, 10 x 16 mm for 470 uF and 1000 uF) at 16 V, 25 V, 35 V or 50 V. It is polarised: a reversed or over-voltage
   capacitor heats and vents (the top bulges and splits along its scored cross). ESR about 0.1 to 1 ohm. Facts:
   docs/facts/analog-parts.md section 4. See-through: the wound foil, the paper soaked in electrolyte, the
   two lead tabs and the rubber seal. */
(() => {
const B = SL.bench, T = B.T;
const UF = [10, 22, 47, 100, 220, 470, 1000], VOLTS = [16, 25, 35, 50];
const SIZE = u => u <= 47 ? [5, 11] : u <= 100 ? [6.3, 11] : u <= 220 ? [8, 12] : [10, 16];
const DEF = { uF: 100, volts: 25, demo: 'ok' };
const DEMO = { ok: null, 'put in backwards': 'reverse', 'over its voltage': 'burnt' };
const SLEEVE = { l: '#4a7fc4', m: '#35629f', d: '#1d3a63' }, STRIPE = { l: '#e9eef2', m: '#c6cfd6', d: '#8c97a1' };
const frame = (legs) => {
  const o = [0, 1, 2].map(k => (legs[0][k] + legs[1][k]) / 2), dx = legs[1][0] - legs[0][0], dy = legs[1][1] - legs[0][1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
  return { o, ux, uy, W: (a, b, z) => [o[0] + ux * a - uy * b, o[1] + uy * a + ux * b, o[2] + z] };
};
const uF = p => UF.includes(+p.uF) ? +p.uF : DEF.uF;
const volts = p => VOLTS.includes(+p.volts) ? +p.volts : DEF.volts;
const label = p => (uF(p) >= 1000 ? '1000' : String(uF(p))) + 'µF';
const stateOf = (p, m) => DEMO[p.demo] || (m && m.state) || null;
B.part('capacitor-electrolytic', {
  name: 'Electrolytic capacitor', fig: 'P34', legs: ['+', '-'], span: [1, 3],
  params: { uF: UF, volts: VOLTS, demo: Object.keys(DEMO) }, paramNames: { uF: 'Capacitance (µF)', volts: 'Rated voltage (V)', demo: 'Show' },
  defaults: DEF,
  elec: p => ({ type: 'cap', farads: uF(p) * 1e-6, polar: true, vrated: volts(p) }),
  tag: (p, m) => { const s = stateOf(p, m);
    if (s === 'burnt') return T('{id} · vented', { id: p.id });
    if (s === 'reverse' || s === 'reversed') return T('{id} · backwards', { id: p.id });
    return T('{id} · {v} µF {r} V', { id: p.id, v: uF(p), r: volts(p) }); },
  draw(ctx){
    const p = Object.assign({}, DEF, ctx.p), legs = ctx.legs, F = frame(legs), k = ctx.k != null ? ctx.k : (ctx.st && ctx.st.xr) || 0;
    const s0 = stateOf(p, ctx.m), dead = s0 === 'burnt', [d, h] = SIZE(uF(p)), r = d / 2, z0 = 1.2, z1 = z0 + h;
    const c = F.W(0, 0, 0);
    let s = rod(F.W(-1.27, 0, -.3), F.W(-1.27, 0, z0 + .2), .2, B.M.tin, toneI, .4) + rod(F.W(1.27, 0, -.3), F.W(1.27, 0, z0 + .2), .2, B.M.tin, toneI, .4);
    // the minus stripe sits on the side facing the negative lead (a = -1)
    const stripe = () => { const pts = [];
      for (let i = 0; i <= 10; i++){ const t = Math.PI + (i / 10 - .5) * 1.1, n = [Math.cos(t), Math.sin(t), 0], wn = [F.ux * n[0] - F.uy * n[1], F.uy * n[0] + F.ux * n[1], 0];
        if (vis(wn)) pts.push(wn); }
      if (!pts.length) return '';
      const top = [], bot = [];
      for (let i = 0; i <= 10; i++){ const t = Math.PI + (i / 10 - .5) * 1.1, a = (r + .02) * Math.cos(t), b = (r + .02) * Math.sin(t), wn = [F.ux * Math.cos(t) - F.uy * Math.sin(t), F.uy * Math.cos(t) + F.ux * Math.sin(t), 0];
        if (!vis(wn)) continue; top.push(F.W(a, b, z1 - .6)); bot.unshift(F.W(a, b, z0 + .5)); }
      return top.length > 1 ? fill(pd([...top, ...bot]), STRIPE.m) : ''; };
    let body = cyl(c[0], c[1], c[2] + z0, c[2] + z1, r, dead ? matOf('#3a3028') : SLEEVE, toneI, .8, 28);
    if (!dead) body += stripe();
    if (k < .5 && !dead) body += B.flatText(F.W(0, 0, z1 + .02), -F.uy, -F.ux, label(p), Math.min(1.6, r * .5), '#e9eef2', 700);
    if (dead){ body += `<path d="${pd([F.W(-r * .6, 0, z1 + .4), F.W(0, r * .5, z1 + 1.4), F.W(r * .6, 0, z1 + .4), F.W(0, -r * .5, z1 + 1.1)])}" fill="#5a4a3a" opacity=".85"/>`;
      const [X, Y] = P(...F.W(0, 0, z1 + 2.5)); body += `<circle cx="${f(X)}" cy="${f(Y - 4)}" r="3" fill="#8a847a" opacity=".45"/><circle cx="${f(X + 3)}" cy="${f(Y - 8)}" r="2.2" fill="#8a847a" opacity=".3"/>`; }
    if (k > .02){
      let x = rod(F.W(-1.27, 0, z0), F.W(-1.27, 0, z1 - 2), .2, B.M.tin, toneI, .3) + rod(F.W(1.27, 0, z0), F.W(1.27, 0, z1 - 1.4), .2, B.M.tin, toneI, .3);
      x += cyl(c[0], c[1], c[2] + z0 + .9, c[2] + z1 - .8, r - .5, { l: '#d8dcdf', m: '#b4bbbf', d: '#7d868a' }, toneI, .4, 24);
      x += cyl(c[0], c[1], c[2] + z0, c[2] + z0 + .9, r - .1, { l: '#3a3835', m: '#2a2826', d: '#1a1918' }, toneI, .4, 24);
      body = `<g opacity="${f(1 - .72 * k)}">${body}</g><g opacity="${f(k)}">${x}</g>`;
      if (k > .5 && typeof ctx.label === 'function' && (!!ctx.sel || !!(B.md && B.md.def && B.md.def.partPage))){ ctx.label(F.W(0, 0, z0 + h * .5), 'Wound foil'); ctx.label(F.W(0, 0, z0 + .4), 'Rubber seal'); }
    }
    s += body;
    ctx.put([[c[0] - r - 1.5, c[1] - r - 1.5, c[2]], [c[0] + r + 1.5, c[1] + r + 1.5, c[2] + z1 + 1.5]], s);
  },
  show: { breadboard: 'mini', parts: [
    { id: 'C1', part: 'capacitor-electrolytic', uF: 100, volts: 25, holes: ['c4', 'c6'] },
    { id: 'C2', part: 'capacitor-electrolytic', uF: 1000, volts: 16, holes: ['c10', 'c12'] },
  ], wires: [] },
});
})();
