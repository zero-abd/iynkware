// @cf title Bunsen burner
// @cf use engine/lab.list
/* A school Bunsen burner for natural gas, the common Tirrill-free pattern: a cast base 90 mm across and 12 mm tall,
   a 13 mm brass barrel standing 150 mm above the mat, a 17 mm air collar near its foot with two 8 x 6 mm air holes
   that line up with the barrel's holes as it turns, a brass gas jet inside the foot and a hose barb on the side. An
   orange rubber hose runs to a bench gas tap with a quarter-turn lever (along the nozzle = open).
   The flame follows the air collar: closed, the gas burns with too little air in a tall, wavy, yellow luminous
   flame (the safety flame: easy to see, sooty, cooler); half open, a quiet blue flame with a yellow tip; open, a
   roaring blue flame with a pale blue inner cone (the hottest point, about 1500 °C, is just above that cone's tip).
   Lighting it with the collar open usually fails: the gas comes out too fast and lean, the flame lifts off and goes
   out, and the gas keeps flowing. Gas on without a flame is the hazard this figure is about. */
(() => {
const LAB = SL.lab, T = LAB.T;
const BX = 55, BY = 0;                          // the burner's axis in the item frame
const BASE_R = 45, BASE_H = 12, BAR_R = 6.5, TOP = 150, COL_R = 8.5, COL0 = 22, COL1 = 42, JET_TOP = 20;
const TAP = [-77, 18];                           // the bench gas tap (burner and tap together span x -100 to 100)
const COLLAR = { closed: 0, half: 45, open: 90 };
const OPEN = { closed: 0, half: .5, open: 1 };
const BRASS = LAB.M.brass, IRON = LAB.M.castIron, RUBBER = LAB.M.rubber, STEEL = LAB.M.steel;
// the flame for an air collar position: height, widest radius, outer and inner colours
const FLAMES = {
  closed: { kind: 'luminous', name: 'Yellow safety flame', h: 105, r: 11, outer: '#f6b73c', core: '#fff0a6', op: .92, cone: null },
  half: { kind: 'blue', name: 'Blue flame', h: 82, r: 8.5, outer: '#8d93e6', core: '#f2c55a', op: .62, cone: { h: 34, r: 5, color: '#4f8fe8' } },
  open: { kind: 'roaring', name: 'Roaring blue flame', h: 66, r: 7.5, outer: '#7a86ea', core: null, op: .5, cone: { h: 24, r: 4.6, color: '#46c3f2' } },
};

// a flame (or cone) as a lathe of a teardrop profile, in a flat colour (it gives light, it is not lit)
const flameRings = (ctx, z0, h, r, wob, t, n = 12) => Array.from({ length: 9 }, (_, i) => {
  const u = i / 8, rr = i === 8 ? 0 : r * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15 + .08)), .8) * (1 - .45 * u);
  const sway = wob * Math.sin(t * 9 + u * 5) * u * u;
  return ctx.ring(BX + sway, BY + sway * .4, z0 + h * u, Math.max(.01, rr), n);
});
const flat = (rings, col) => { let s = ''; for (let i = 0; i < rings.length - 1; i++) s += loft(rings[i], rings[i + 1], () => col); return s; };

LAB.item('bunsen-burner', {
  name: 'Bunsen burner', fig: 'L3', foot: [205, 92, 260],
  params: {
    collar: { label: 'Air collar', values: ['closed', 'half', 'open'], names: { closed: 'Closed', half: 'Half open', open: 'Open' } },
    gasOn: { label: 'Gas tap', values: [false, true], picker: false },
    lit: { label: 'Flame', values: [false, true], picker: false },
  },
  defaults: { collar: 'closed', gasOn: false, lit: false },
  // lit: true needs the gas on; turning the gas off puts the flame out (onParam)
  refuse: (next, patch) => patch.lit === true && !next.gasOn ? 'a flame needs the gas on (send gasOn: true with lit: true)' : null,
  parts: {
    BASE: { name: 'Heavy base', role: 'body' },
    BARREL: { name: 'Barrel', role: 'body', explode: [0, 0, 45] },
    COLLAR: { name: 'Air collar', role: 'control', explode: [0, 0, 10], press: (st, api) => {
      const order = ['closed', 'half', 'open'], next = order[(order.indexOf(st.p.collar) + 1) % 3];
      api.set('collar', next); api.say('{part} is now {value}', { part: T('Air collar'), value: T({ closed: 'Closed', half: 'Half open', open: 'Open' }[next]) }); } },
    JET: { name: 'Gas jet', role: 'body', layer: 'xray' },
    INLET: { name: 'Gas inlet', role: 'body' },
    HOSE: { name: 'Rubber gas hose', role: 'wire' },
    TAP: { name: 'Gas tap', role: 'control', press: (st, api) => gasTap(st, api) },
    FLAME: { name: 'Flame', role: 'light' },
  },
  actions: [
    { id: 'gas', label: 'Gas tap on/off', run: (st, api) => gasTap(st, api) },
    { id: 'light', label: 'Light', run: (st, api) => {
      if (!st.p.gasOn) return api.say('No gas: open the gas tap first');
      if (st.p.lit) return api.say('It is already lit');
      if (st.p.collar === 'open'){ st.s.badLight = true; return api.say('The flame lifted off and went out: close the air collar, then light it'); }
      st.s.badLight = false; api.set('lit', true); api.sfx('whoosh'); api.say(st.p.collar === 'closed' ? 'Lit: a yellow safety flame' : 'Lit: a blue flame');
    } },
  ],
  init: st => { st.s.gasT = 0; st.s.blueT = 0; st.s.badLight = false; },
  onParam: (st, k, v) => {
    if (k === 'gasOn' && !v){ st.p.lit = false; st.s.badLight = false; st.s.gasT = 0; }
    // a failed light is about the open collar: once the collar moves or it lights, the plain unlit-gas warning takes over
    if ((k === 'lit' && v) || k === 'collar') st.s.badLight = false;
    if (k === 'collar' || k === 'lit') st.s.blueT = 0;
  },
  step: (st, dt) => {
    const s = st.s;
    s.gasT = st.p.gasOn && !st.p.lit ? s.gasT + dt : 0;
    s.blueT = st.p.lit && st.p.collar === 'open' ? s.blueT + dt : 0;
  },
  live: st => st.p.gasOn,
  draw(ctx){
    const { p, s, k, t } = ctx, open = OPEN[p.collar], deg = COLLAR[p.collar];
    const bar = ctx.lift([0, 0, 45]), col = ctx.lift([0, 0, 10]);
    ctx.shadow([...ctx.ring(BX, BY, 0, BASE_R, 16), ...ctx.ring(BX, BY, TOP, BAR_R, 8)]);
    ctx.shadow([...ctx.ring(TAP[0], TAP[1], 0, 16, 8), ...ctx.ring(TAP[0], TAP[1], 42, 10, 8)]);
    // base: a low cast dome, with the hose barb's boss
    ctx.put([[BX - BASE_R, BY - BASE_R, 0], [BX + BASE_R, BY + BASE_R, BASE_H]],
      LAB.lathe(ctx.W, BX, BY, [[BASE_R, 0], [BASE_R, 4], [BASE_R - 6, BASE_H - 2], [12, BASE_H]], IRON, toneI, 1.6, 28), 'BASE');
    // the jet: a small brass nozzle on the base, inside the barrel's foot (seen in see-through and exploded)
    const jetVis = Math.max(k, ctx.ex);
    if (jetVis > .05) ctx.put([[BX - 3, BY - 3, BASE_H], [BX + 3, BY + 3, JET_TOP]],
      `<g opacity="${f(Math.min(1, jetVis * 1.4))}">${LAB.lathe(ctx.W, BX, BY, [[3, BASE_H], [3, BASE_H + 3], [1.6, JET_TOP]], BRASS, toneI, .8, 12)}</g>`, 'JET');
    // the barrel: brass, ghosted in see-through so the gas and air inside show
    let barrel = LAB.lathe(bar.W, BX, BY, [[BAR_R, BASE_H], [BAR_R, TOP - 1.5], [BAR_R + .5, TOP]], BRASS, toneI, 1.3, 18);
    if (k > .02) barrel = `<g opacity="${f(1 - .7 * k)}">${barrel}</g>`;
    bar.put([[BX - BAR_R, BY - BAR_R, BASE_H], [BX + BAR_R, BY + BAR_R, TOP]], barrel, 'BARREL');
    // the hose barb on the side of the foot, toward the tap
    const barb0 = ctx.W(BX - BAR_R - 2, BY, 7), barb1 = ctx.W(BX - 34, BY, 7);
    ctx.put([[BX - 34, BY - 4, 3], [BX - BAR_R, BY + 4, 11]], rod(barb0, barb1, 3.8, BRASS, toneI, .9, 3.2, 12) + rod(ctx.W(BX - 30, BY, 7), barb1, 4.4, BRASS, toneI, .7, 3.2, 12), 'INLET');
    // the air collar: a sleeve with two windows; the dark opening is as wide as the holes line up
    const colW = col.W;
    let sleeve = LAB.lathe(colW, BX, BY, [[COL_R, COL0], [COL_R, COL1]], STEEL, toneI, 1.1, 18);
    for (const side of [-1, 1]){
      const a0 = side < 0 ? -Math.PI / 2 : Math.PI / 2, nrm = sub(colW(Math.cos(a0), Math.sin(a0), 0), colW(0, 0, 0));
      if (!vis(nrm)) continue;
      const half = .32 * open + .02, win = [];
      for (let i = 0; i <= 4; i++){ const a = a0 - half + 2 * half * i / 4; win.push(colW(BX + (COL_R + .05) * Math.cos(a), BY + (COL_R + .05) * Math.sin(a), 28)); }
      for (let i = 4; i >= 0; i--){ const a = a0 - half + 2 * half * i / 4; win.push(colW(BX + (COL_R + .05) * Math.cos(a), BY + (COL_R + .05) * Math.sin(a), 35)); }
      sleeve += shape(win, open > 0 ? '#2b2522' : STEEL.d, .6);
      // a grip ridge, which turns with the collar
      const g = (deg + (side < 0 ? 0 : 180) + 90) * Math.PI / 180;
      sleeve += rod(colW(BX + COL_R * Math.cos(g), BY + COL_R * Math.sin(g), COL0 + 2), colW(BX + COL_R * Math.cos(g), BY + COL_R * Math.sin(g), COL1 - 2), .9, STEEL, toneI, .5, .9, 8);
    }
    if (k > .02) sleeve = `<g opacity="${f(1 - .6 * k)}">${sleeve}</g>`;
    col.put([[BX - COL_R - 1, BY - COL_R - 1, COL0], [BX + COL_R + 1, BY + COL_R + 1, COL1]], sleeve, 'COLLAR');
    // see-through: gas up from the jet (orange), air in through the holes (blue), mixing up the barrel
    if (k > .3 && p.gasOn){
      const ph = (t * 1.2) % 1;
      let flow = '';
      for (let i = 0; i < 6; i++){ const u = (i / 6 + ph) % 1, [X, Y] = P(...bar.W(BX, BY, JET_TOP + u * (TOP - JET_TOP)));
        flow += `<circle cx="${f(X)}" cy="${f(Y)}" r="1.3" fill="${open ? mix('#f08a2b', '#3e86d9', Math.min(1, u * 2) * open) : '#f08a2b'}" opacity="${f(k)}"/>`; }
      if (open) for (const side of [-1, 1]) for (let i = 0; i < 3; i++){ const u = (i / 3 + ph) % 1, [X, Y] = P(...col.W(BX, BY + side * (COL_R + 10) * (1 - u), 31));
        flow += `<circle cx="${f(X)}" cy="${f(Y)}" r="1.1" fill="#3e86d9" opacity="${f(k)}"/>`; }
      bar.put([[BX - 1, BY - 1, COL1 + 1], [BX + 1, BY + 1, TOP - 1]], flow);
    }
    // the hose: a sagging curve from the barb to the tap's nozzle, in short boxed pieces so it sorts
    const h0 = [BX - 34, BY, 7], h1 = [TAP[0] + 14, TAP[1], 30], mid = [(h0[0] + h1[0]) / 2, (h0[1] + h1[1]) / 2 - 22, 4.2];
    const hp = Array.from({ length: 11 }, (_, j) => { const u = j / 10, v = 1 - u; return [0, 1, 2].map(c => v * v * h0[c] + 2 * u * v * mid[c] + u * u * h1[c]); });
    for (let j = 0; j < 10; j++){ const a = hp[j], b = hp[j + 1];
      ctx.put([[Math.min(a[0], b[0]) - 4, Math.min(a[1], b[1]) - 4, Math.min(a[2], b[2]) - 4], [Math.max(a[0], b[0]) + 4, Math.max(a[1], b[1]) + 4, Math.max(a[2], b[2]) + 4]],
        rod(ctx.W(...a), ctx.W(...b), 4, RUBBER, toneI, .8, 4, 12), 'HOSE'); }
    // the gas tap: a block on the bench, a nozzle toward the burner and a lever (along the nozzle = open)
    let tap = B_SLAB(ctx.W, TAP[0] - 12, TAP[1] - 12, TAP[0] + 12, TAP[1] + 12, 0, 22, STEEL) + LAB.lathe(ctx.W, TAP[0], TAP[1], [[8, 22], [8, 34], [6, 38]], BRASS, toneI, 1, 14);
    tap += rod(ctx.W(TAP[0] + 4, TAP[1], 30), ctx.W(TAP[0] + 16, TAP[1], 30), 3.4, BRASS, toneI, .8, 2.6, 12);
    const lv = (p.gasOn ? 0 : 90) * Math.PI / 180, lever = [Math.cos(lv), Math.sin(lv)];
    tap += rod(ctx.W(TAP[0] - lever[0] * 5, TAP[1] - lever[1] * 5, 40), ctx.W(TAP[0] + lever[0] * 22, TAP[1] + lever[1] * 22, 40), 2.2, { l: '#f2c230', m: '#d4a514', d: '#8e6c06' }, toneI, .9, 2.2, 10);
    ctx.put([[TAP[0] - 23, TAP[1] - 23, 0], [TAP[0] + 23, TAP[1] + 23, 42]], tap, 'TAP');
    // the flame, or the invisible gas pouring out of an unlit burner (a shimmer)
    const fl = FLAMES[p.collar], z0 = TOP + .5 + 45 * ctx.ex;
    if (p.lit){
      const wob = fl.kind === 'luminous' ? 3.2 : .8;
      let s2 = `<g opacity="${f(fl.op)}">${flat(flameRings(ctx, z0, fl.h, fl.r, wob, t), fl.outer)}</g>`;
      if (fl.core && fl.kind === 'luminous') s2 += `<g opacity=".8">${flat(flameRings(ctx, z0 + 4, fl.h * .55, fl.r * .55, wob * .6, t), fl.core)}</g>`;
      if (fl.core && fl.kind === 'blue') s2 += `<g opacity=".75">${flat(flameRings(ctx, z0 + fl.h * .72, fl.h * .3, fl.r * .45, wob, t, 10), fl.core)}</g>`;
      if (fl.cone) s2 += `<g opacity=".9">${flat(flameRings(ctx, z0, fl.cone.h, fl.cone.r, 0, t, 10), fl.cone.color)}</g>`;
      ctx.put([[BX - fl.r, BY - fl.r, z0], [BX + fl.r, BY + fl.r, z0 + fl.h]], `<g data-part="FLAME">${s2}</g>`, 'FLAME');
      ctx.label([BX, BY, TOP + fl.h * .6], fl.name, true);
      if (fl.cone) ctx.label([BX, BY + fl.cone.r, TOP + fl.cone.h + 4], 'Hottest just above the inner cone', false);
    } else if (p.gasOn){
      let g = '';
      for (let i = 0; i < 3; i++){ const ph = (t * .9 + i / 3) % 1, pts = Array.from({ length: 7 }, (_, j) => ctx.W(BX + Math.sin(j * 1.1 + ph * 6.3 + i) * 2.5, BY + (i - 1) * 3, z0 + 2 + j * 7 + ph * 10));
        g += `<path d="${pd(pts, false)}" fill="none" stroke="#9a958c" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 3" opacity="${f(.75 * (1 - ph))}"/>`; }
      ctx.put([[BX - 4, BY - 4, TOP + 1], [BX + 4, BY + 4, TOP + 60]], g);
      ctx.label([BX, BY, TOP + 20], 'Unburnt gas', true);
    }
    ctx.label([BX + COL_R, BY, 31], 'Air collar', open > 0);
    ctx.label([BX, BY, JET_TOP], 'Gas jet', !!p.gasOn);
    ctx.label([TAP[0], TAP[1], 40], 'Gas tap', !!p.gasOn);
  },
  stats: st => [
    { label: T('Gas'), value: st.p.gasOn ? T('ON') : T('OFF') },
    { label: T('Flame'), value: st.p.lit ? T({ luminous: 'Yellow', blue: 'Blue', roaring: 'Roaring blue' }[FLAMES[st.p.collar].kind]) : T('None'), small: true },
    { label: T('Air collar'), value: T({ closed: 'Closed', half: 'Half open', open: 'Open' }[st.p.collar]), small: true },
  ],
  reportKeys: ['flame', 'gasUnlitS'],
  report: st => ({ flame: st.p.lit ? FLAMES[st.p.collar].kind : 'none', gasUnlitS: Math.floor(st.s.gasT || 0) }),
  mistake: st => st.s.badLight && st.p.gasOn && !st.p.lit ? 'light-collar-open'
    : st.p.gasOn && !st.p.lit && st.s.gasT > 2 ? 'gas-unlit'
    : st.p.lit && st.p.collar === 'open' && st.s.blueT > 20 ? 'blue-flame-idle' : null,
  explode: true,
  xrCaption: 'See-through: gas rises from the jet and mixes with the air the collar lets in',
  xr: {
    anchors: [
      { id: 'control:COLLAR', kind: 'control', part: 'COLLAR', at: [BX, BY - COL_R, 31], normal: [0, -1, 0], channel: 'turn:COLLAR' },
      { id: 'control:TAP', kind: 'control', part: 'TAP', at: [TAP[0] + 10, TAP[1], 40], normal: [0, 0, 1], channel: 'turn:TAP' },
      { id: 'port:INLET', kind: 'port', part: 'INLET', at: [BX - 34, BY, 7], normal: [-1, 0, 0] },
      { id: 'label:FLAME', kind: 'label', part: 'FLAME', at: [BX, BY, TOP + 40], normal: [0, -1, 0], text: 'Flame' },
    ],
    channels: [
      { id: 'turn:COLLAR', kind: 'rotate', part: 'COLLAR', value: { unit: 'deg', min: 0, max: 90, rest: 0 }, axis: [0, 0, 1], pivot: [BX, BY, 32], scale: Math.PI / 180,
        bind: { source: 'param', key: 'collar' }, extras: { deg: COLLAR } },
      { id: 'turn:TAP', kind: 'rotate', part: 'TAP', value: { unit: 'deg', min: 0, max: 90, rest: 90 }, axis: [0, 0, 1], pivot: [TAP[0], TAP[1], 40], scale: Math.PI / 180,
        bind: { source: 'param', key: 'gasOn' }, extras: { deg: { false: 90, true: 0 } } },
      { id: 'flame:BURNER', kind: 'emissive', part: 'FLAME', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#7a86ea',
        bind: { source: 'param', key: 'lit' }, extras: { colorByCollar: Object.fromEntries(Object.entries(FLAMES).map(([key, v]) => [key, v.outer])), heightMm: Object.fromEntries(Object.entries(FLAMES).map(([key, v]) => [key, v.h])) } },
    ],
  },
  lab: {
    lab: 'chemistry',
    summary: 'A gas burner. The air collar sets the flame: closed gives a yellow safety flame, open gives a hot roaring blue flame.',
    safeUse: [
      'Tie back long hair, wear goggles, and stand the burner on a heat-proof mat away from paper.',
      'Close the air collar before you light it.',
      'Have the lit splint or lighter ready over the barrel before you turn the gas on, then light it at once.',
      'Open the collar for a hot blue flame only while you are heating something.',
      'When you are not heating, close the collar to the yellow safety flame so everyone can see it.',
      'Turn the gas off at the tap when you finish.',
    ],
    mistakes: [
      { id: 'gas-unlit', when: 'The gas tap has been on for more than 2 seconds with no flame.', say: 'Gas is on but not lit. Turn the gas tap off now, then light it the right way.' },
      { id: 'light-collar-open', when: 'Someone tried to light it with the air collar open, and the gas is still on.', say: 'It will not light with the collar open. Turn the gas off, close the collar, then try again.' },
      { id: 'blue-flame-idle', when: 'A roaring blue flame has burned for over 20 seconds.', say: 'A blue flame is hard to see. If you are not heating, close the collar to the yellow safety flame.' },
    ],
    hazards: ['Unburnt gas can build up and explode.', 'A blue flame is almost invisible in daylight.', 'The barrel stays hot after the flame is out.', 'Hair, sleeves and paper catch fire.'],
  },
});
// the bench's rotated slab, through the lab layer's frame
function B_SLAB(W, a0, b0, a1, b1, z0, z1, m){ return SL.bench.slabW(W, a0, b0, a1, b1, z0, z1, m, toneI, 1); }
function gasTap(st, api){ api.set('gasOn', !st.p.gasOn); api.say(st.p.gasOn ? 'Gas tap open' : 'Gas tap closed'); }
})();
