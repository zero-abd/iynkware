// @cf title Bench power supply
// @cf use engine/lab.list
/* A single-channel linear bench supply of the common 0-30 V, 0-5 A kind: a grey steel case 150 mm wide, 125 mm tall
   and 240 mm deep, a dark front panel with two 4-digit seven-segment readouts (volts in red, amps in green), a
   VOLTAGE and a CURRENT knob, a green CV and a red CC lamp, a rocker POWER switch and three 4 mm binding posts:
   - (black), GND (green, the case and mains earth) and + (red).
   How it behaves is how a real one does: it holds the output at the voltage you set (constant voltage, CV lamp)
   until the load would draw more than the current limit you set; then it holds the current at the limit and the
   voltage drops to whatever the load allows (constant current, CC lamp). The readouts show what comes out, not the
   settings. The load on the mat in front is a 100 Ω 2 W resistor, a 10 Ω 5 W cement resistor or a wire link (a
   short), clipped to + and -; a resistor asked to burn more than its rating glows and smokes.
   Inside (see-through, or exploded with the cover lifted): the mains transformer, the pass transistor on its
   heatsink, the control board and the fan. */
(() => {
const LAB = SL.lab, T = LAB.T;
const CW = 150, CH = 125, Y0 = -98, Y1 = 142, LOAD_Y = -136;   // the case from its front panel (Y0) back; the load on the mat in front
const GREY = { l: '#d9dcd8', m: '#b9bdb8', d: '#868b85' }, PANEL = { l: '#4a4743', m: '#36332f', d: '#22201d' }, KNOB = LAB.M.blackPl;
const POSTS = { '-': { x: 20, mat: { l: '#5a5550', m: '#3a3632', d: '#24221f' } }, GND: { x: 38, mat: { l: '#5cc06e', m: '#3f9a50', d: '#24612f' } }, '+': { x: 56, mat: { l: '#ef6a5b', m: '#d8453a', d: '#8e2a21' } } };
const POST_Z = 22, KNOB_Z = 50, KNOBS = { VSET: { x: -38, key: 'vSet', max: 30, print: 'VOLTAGE' }, ISET: { x: 38, key: 'iSet', max: 5, print: 'CURRENT' } };
const LOADS = {
  open: { name: 'Nothing connected', ohms: Infinity },
  r100: { name: '100 Ω 2 W resistor', ohms: 100, watts: 2 },
  r10: { name: '10 Ω 5 W resistor', ohms: 10, watts: 5 },
  short: { name: 'Wire link (short)', ohms: .05 },
};
// see-through notes on the load
const NOTES = { hot: { text: 'Overloaded: too hot' }, short: { text: 'Short circuit' }, load: { text: 'Load' } };
const VSETS = [0, 1.5, 3.3, 5, 9, 12, 15, 24, 30], ISETS = [.1, .2, .5, 1, 2, 3, 5];

// the output for the settings and the load: CV until the load wants more than the limit, then CC
const solve = p => {
  if (!p.on) return { v: 0, i: 0, mode: null, w: 0 };
  const R = LOADS[p.load].ohms, want = p.vSet / R;
  if (want > p.iSet) return { v: p.iSet * R, i: p.iSet, mode: 'CC', w: p.iSet * p.iSet * R };
  return { v: p.vSet, i: Number.isFinite(want) ? want : 0, mode: 'CV', w: Number.isFinite(want) ? p.vSet * want : 0 };
};
const hot = (p, o) => { const ld = LOADS[p.load]; return !!(ld.watts && o.w > ld.watts); };
// knob angle: 300° of travel, -150° at zero
const knobDeg = (key, v) => -150 + 300 * v / KNOBS[key].max;

// seven segments: which ones each character lights, and each segment's quad in a 6 x 11 cell
const SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', ' ': '' };
const CELL_W = 6, CELL_H = 11, TH = 1.15;
const segQuad = (sg) => {
  const w = CELL_W, h = CELL_H, t = TH / 2, m = h / 2;
  const H = (v) => [[t, v - t], [w - t, v - t], [w - t, v + t], [t, v + t]], V = (u, v0, v1) => [[u - t, v0 + t], [u + t, v0 + t], [u + t, v1 - t], [u - t, v1 - t]];
  return { a: H(h), g: H(m), d: H(0), f: V(0, m, h), b: V(w, m, h), e: V(0, 0, m), c: V(w, 0, m) }[sg];
};
// a 4-digit reading on the front panel, its left edge at panel x, baseline at z
const sevenSeg = (W, x0, z0, text, on, col) => {
  const cells = []; for (const ch of text){ if (ch === '.' && cells.length) cells[cells.length - 1].dp = true; else cells.push({ ch, dp: false }); }
  const P2 = (u, v) => W(x0 + u + v * .12, Y0 - .45, z0 + v);
  let s = '';
  cells.forEach((c, i) => {
    const u0 = i * (CELL_W + 4.2), lit = on ? SEGS[c.ch] || '' : '';
    for (const sg of 'abcdefg'){ const q = segQuad(sg).map(([u, v]) => P2(u0 + u, v));
      s += `<path d="${pd(q)}" fill="${lit.includes(sg) ? col : mix(col, '#151311', .82)}"/>`; }
    const dq = [[CELL_W + 1.2, 0], [CELL_W + 2.4, 0], [CELL_W + 2.4, 1.2], [CELL_W + 1.2, 1.2]].map(([u, v]) => P2(u0 + u, v));
    s += `<path d="${pd(dq)}" fill="${on && c.dp ? col : mix(col, '#151311', .82)}"/>`;
  });
  return s;
};
// the two readout windows: id, left edge x (the window runs x0 - 3 to x0 + 47, z 82 to 108), name, digit colour
const SCREENS = [['VOUT', -62, 'Volts', '#ff4b33'], ['IOUT', 8, 'Amps', '#4dff6a']];
const fmtV = v => (v < 10 ? ' ' : '') + v.toFixed(2), fmtI = i => i.toFixed(3);

LAB.item('bench-power-supply', {
  name: 'Bench power supply', fig: 'L4', foot: [CW + 10, Y1 - LOAD_Y + 12, CH + 2],
  params: {
    vSet: { label: 'Voltage', values: VSETS, range: [0, 30], unit: 'V', show: v => v + ' V' },
    iSet: { label: 'Current limit', values: ISETS, range: [0, 5], unit: 'A', show: v => v + ' A' },
    load: { label: 'Load', values: Object.keys(LOADS), names: Object.fromEntries(Object.entries(LOADS).map(([k, v]) => [k, v.name])) },
    on: { label: 'Output', values: [false, true], picker: false },
  },
  defaults: { vSet: 5, iSet: .5, load: 'r100', on: false },
  parts: {
    CASE: { name: 'Steel case', role: 'cover', explode: [0, 0, 70] },
    PANEL: { name: 'Front panel and readouts', role: 'body' },
    VSET: { name: 'Voltage knob', role: 'control', press: (st, api) => stepKnob(st, api, 'vSet', VSETS, 'Voltage', 'V') },
    ISET: { name: 'Current limit knob', role: 'control', press: (st, api) => stepKnob(st, api, 'iSet', ISETS, 'Current limit', 'A') },
    POWER: { name: 'Power switch', role: 'control', press: (st, api) => power(st, api) },
    POST_PLUS: { name: 'Red + terminal', role: 'pin' },
    POST_MINUS: { name: 'Black - terminal', role: 'pin' },
    POST_GND: { name: 'Green earth terminal', role: 'pin' },
    LOAD: { name: 'Load', role: 'body' },
    INSIDE: { name: 'Transformer, regulator and control board', role: 'body', layer: 'xray' },
  },
  actions: [{ id: 'power', label: 'Power on/off', run: (st, api) => power(st, api) }],
  live: st => st.p.on && hot(st.p, solve(st.p)),
  draw(ctx){
    const { p, k, t } = ctx, o = solve(p), ex = ctx.ex, W = ctx.W, front = vis(sub(W(0, -1, 0), W(0, 0, 0)));
    const Ux = sub(W(1, 0, 0), W(0, 0, 0)), DOWN = [0, 0, -1];
    const txt = (x, z, s, size, col = '#f2efe6', weight = 700) => front ? LAB.textOn(W(x, Y0 - .5, z), Ux, DOWN, s, size, col, weight) : '';
    ctx.shadow([W(-CW / 2, Y0, 0), W(CW / 2, Y0, 0), W(CW / 2, Y1, 0), W(-CW / 2, Y1, 0), W(-CW / 2, Y0, CH), W(CW / 2, Y0, CH), W(CW / 2, Y1, CH), W(-CW / 2, Y1, CH)]);
    // inside: transformer (back left), pass transistor on a finned heatsink (right), control board, fan on the back
    const inside = () => {
      let s = SL.bench.slabW(W, -70, Y0 + 4, 70, Y1 - 4, 3, 5, { l: '#8fbf7a', m: '#6f9f5c', d: '#4a7039' }, toneI, .7);
      s += SL.bench.slabW(W, -62, 50, -8, 110, 5, 62, { l: '#7d8288', m: '#5f646a', d: '#3e4246' }, toneI, 1);
      s += LAB.lathe(W, -35, 80, [[22, 14], [22, 54]], { l: '#e0945a', m: '#c27438', d: '#8a4b1e' }, toneI, .8, 16);
      for (let i = 0; i < 7; i++) s += SL.bench.slabW(W, 40 + i * 4, -20, 41.2 + i * 4, 60, 5, 70, LAB.M.steel, toneI, .5);
      s += SL.bench.slabW(W, 34, 10, 40, 22, 30, 50, LAB.M.blackPl, toneI, .6);
      s += SL.bench.slabW(W, -40, -60, 20, -20, 5, 18, { l: '#2f9ea3', m: '#237a7e', d: '#175457' }, toneI, .6);
      s += SL.bench.slabW(W, -10, Y1 - 12, 50, Y1 - 4, 30, 90, LAB.M.blackPl, toneI, .7);
      return s;
    };
    // the cover: top and both sides in one U of grey steel, with its vents; lifted when exploded, faded in see-through
    const cover = (Wc) => {
      let s = SL.bench.slabW(Wc, -CW / 2, Y0 + 2, CW / 2, Y1, 3, CH, GREY, toneI, 1.6);
      if (vis(sub(Wc(0, 0, 1), Wc(0, 0, 0)))) for (let i = 0; i < 8; i++) s += `<path d="${pd([Wc(-40, 40 + i * 10, CH + .1), Wc(40, 40 + i * 10, CH + .1)], false)}" stroke="${GREY.d}" stroke-width="1.6" stroke-linecap="round"/>`;
      return s;
    };
    const showInside = k > .02 || ex > .02;
    const coverOp = 1 - .72 * k;
    if (ex < .05){
      const s = (showInside ? inside() : '') + (coverOp < .999 ? `<g opacity="${f(coverOp)}">${cover(W)}</g>` : cover(W));
      ctx.put([[-CW / 2, Y0 + 2, 0], [CW / 2, Y1, CH]], s, 'CASE');
    } else {
      ctx.put([[-CW / 2, Y0 + 2, 0], [CW / 2, Y1, 72]], SL.bench.slabW(W, -CW / 2, Y0 + 2, CW / 2, Y1, 0, 3, GREY, toneI, 1) + inside(), 'INSIDE');
      const lid = ctx.lift([0, 0, 70]);
      lid.put([[-CW / 2, Y0 + 2, 73], [CW / 2, Y1, CH]], `<g opacity="${f(coverOp)}">${cover(lid.W)}</g>`, 'CASE');
    }
    // the front panel with its readouts, lamps and printing
    let pnl = SL.bench.slabW(W, -CW / 2, Y0, CW / 2, Y0 + 2, 0, CH, PANEL, toneI, 1.2);
    for (const [sid, x0, , col] of SCREENS){ const text = sid === 'VOUT' ? fmtV(o.v) : fmtI(o.i);
      pnl += shape([W(x0 - 3, Y0 - .3, 82), W(x0 + 47, Y0 - .3, 82), W(x0 + 47, Y0 - .3, 108), W(x0 - 3, Y0 - .3, 108)], '#151311', .7);
      if (front) pnl += sevenSeg(W, x0 + 2, 89, text, p.on, col);
    }
    pnl += txt(-36, 77, 'V', 4, '#ff8a76') + txt(34, 77, 'A', 4, '#8dffa0');
    pnl += txt(0, 117, 'DC POWER SUPPLY  0-30V  0-5A', 3.4, '#f2efe6', 800);
    for (const [key, kn] of Object.entries(KNOBS)) pnl += txt(kn.x, KNOB_Z - 17, kn.print, 3.2);
    // CV and CC lamps between the knobs
    for (const [id, x, col] of [['CV', -7, '#4dff6a'], ['CC', 7, '#ff4b33']]){
      const lit = o.mode === id, c = W(x, Y0 - .4, 62), ring = Array.from({ length: 12 }, (_, i) => { const a = i / 12 * 2 * Math.PI; return W(x + 2.4 * Math.cos(a), Y0 - .5, 62 + 2.4 * Math.sin(a)); });
      pnl += shape(ring, lit ? col : mix(col, '#151311', .7), .6) + txt(x, 55, id, 3);
      if (lit && front){ const [X, Y] = P(...c); pnl += `<circle cx="${f(X)}" cy="${f(Y)}" r="7" fill="${col}" opacity=".3"/>`; }
    }
    for (const [id, pst] of Object.entries(POSTS)) pnl += txt(pst.x, POST_Z - 12, id, 3.6);
    pnl += txt(-52, 8, 'POWER', 3);
    ctx.put([[-CW / 2, Y0, 0], [CW / 2, Y0 + 2, CH]], pnl, 'PANEL');
    // knobs: black, a white pointer on the face, turned by the setting
    for (const [id, kn] of Object.entries(KNOBS)){
      const a = knobDeg(id, p[kn.key]) * Math.PI / 180, face = Y0 - 13;
      let s = rod(W(kn.x, Y0, KNOB_Z), W(kn.x, Y0 - 10, KNOB_Z), 10, KNOB, toneI, 1.1, 10, 20) + rod(W(kn.x, Y0 - 10, KNOB_Z), W(kn.x, face, KNOB_Z), 10, KNOB, toneI, 1, 8.5, 20);
      if (front) s += `<path d="${pd([W(kn.x + 2 * Math.sin(a), face - .2, KNOB_Z + 2 * Math.cos(a)), W(kn.x + 7.5 * Math.sin(a), face - .2, KNOB_Z + 7.5 * Math.cos(a))], false)}" stroke="#f6f1e3" stroke-width="1.6" stroke-linecap="round"/>`;
      ctx.put([[kn.x - 10, face, KNOB_Z - 10], [kn.x + 10, Y0, KNOB_Z + 10]], s, id);
    }
    // the rocker: lit red while on; the pressed half (I, the top, when on) sits in and the other stands out
    const rk = p.on ? -1.2 : 1.2;
    ctx.put([[-60, Y0 - 5, 13], [-44, Y0, 25]], SL.bench.slabW(W, -60, Y0 - 3, -44, Y0, 13, 25, KNOB, toneI, .9)
      + SL.bench.slabW(W, -58, Y0 - 5 - Math.max(0, -rk), -46, Y0 - 3, 14.5, 19, p.on ? { l: '#ff6a55', m: '#e2483d', d: '#9a2a20' } : { l: '#9a3a32', m: '#7a2c26', d: '#4e1c18' }, toneI, .6)
      + SL.bench.slabW(W, -58, Y0 - 5 - Math.max(0, rk), -46, Y0 - 3, 19, 23.5, p.on ? { l: '#ff6a55', m: '#e2483d', d: '#9a2a20' } : { l: '#9a3a32', m: '#7a2c26', d: '#4e1c18' }, toneI, .6), 'POWER');
    // binding posts: a coloured nut and a brass stud
    const postIds = { '+': 'POST_PLUS', '-': 'POST_MINUS', GND: 'POST_GND' };
    for (const [id, pst] of Object.entries(POSTS)){
      const s = rod(W(pst.x, Y0, POST_Z), W(pst.x, Y0 - 9, POST_Z), 5, pst.mat, toneI, 1, 4.2, 18) + rod(W(pst.x, Y0 - 9, POST_Z), W(pst.x, Y0 - 13, POST_Z), 2, LAB.M.brass, toneI, .7, 2, 10);
      ctx.put([[pst.x - 5, Y0 - 13, POST_Z - 5], [pst.x + 5, Y0, POST_Z + 5]], s, postIds[id]);
    }
    // the load on the mat, clipped to + and - by short leads
    if (p.load !== 'open'){
      const glow = p.on && hot(p, o), ld = LOADS[p.load];
      const ends = p.load === 'r10' ? [-26, 26] : p.load === 'r100' ? [-12, 12] : [-14, 14], cx = 38, z = 5;
      let s;
      if (p.load === 'r10') s = SL.bench.slabW(W, cx - 24, LOAD_Y - 5, cx + 24, LOAD_Y + 5, 0, 10, glow ? { l: '#ffb08a', m: '#e86f4a', d: '#9a3a22' } : LAB.M.white, toneI, 1);
      else if (p.load === 'r100') s = rod(W(cx - 9, LOAD_Y, z), W(cx + 9, LOAD_Y, z), 3, glow ? { l: '#ffb08a', m: '#e86f4a', d: '#9a3a22' } : { l: '#7ab7d8', m: '#4f93bb', d: '#2c6487' }, toneI, .9, 3, 14);
      else s = rod(W(cx - 14, LOAD_Y, 2), W(cx + 14, LOAD_Y, 2), 1.4, LAB.M.steel, toneI, .7, 1.4, 10);
      if (p.load !== 'short') s += rod(W(cx + ends[0], LOAD_Y, z), W(cx - 9, LOAD_Y, z), .45, LAB.M.steel, toneI, .4) + rod(W(cx + 9, LOAD_Y, z), W(cx + ends[1], LOAD_Y, z), .45, LAB.M.steel, toneI, .4);
      if (glow) for (let i = 0; i < 3; i++){ const ph = (t * .6 + i / 3) % 1, pts = Array.from({ length: 6 }, (_, j) => W(cx - 8 + i * 8 + Math.sin(j + ph * 6.3) * 2, LOAD_Y, 12 + j * 5 + ph * 8));
        s += `<path d="${pd(pts, false)}" fill="none" stroke="#8a847a" stroke-width="2" stroke-linecap="round" opacity="${f(.6 * (1 - ph))}"/>`; }
      ctx.put([[cx - 27, LOAD_Y - 6, 0], [cx + 27, LOAD_Y + 6, 12]], s, 'LOAD');
      // leads: red from + to the right end, black from - to the left end, sagging onto the mat in boxed pieces
      for (const [id, end, col] of [['-', ends[0], { l: '#5a5550', m: '#3a3632', d: '#24221f' }], ['+', ends[1], { l: '#ef6a5b', m: '#d8453a', d: '#8e2a21' }]]){
        const a = [POSTS[id].x, Y0 - 11, POST_Z], b = [cx + end, LOAD_Y, z], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 2];
        const pts = Array.from({ length: 9 }, (_, j) => { const u = j / 8, v = 1 - u; return [0, 1, 2].map(c => v * v * a[c] + 2 * u * v * mid[c] + u * u * b[c]); });
        for (let j = 0; j < 8; j++){ const q0 = pts[j], q1 = pts[j + 1];
          ctx.put([[Math.min(q0[0], q1[0]) - 1.2, Math.min(q0[1], q1[1]) - 1.2, Math.min(q0[2], q1[2]) - 1.2], [Math.max(q0[0], q1[0]) + 1.2, Math.max(q0[1], q1[1]) + 1.2, Math.max(q0[2], q1[2]) + 1.2]],
            rod(W(...q0), W(...q1), 1.1, col, toneI, .6, 1.1, 8), 'LOAD'); }
      }
      ctx.label([cx, LOAD_Y, 10], (glow ? NOTES.hot : ld.ohms < 1 ? NOTES.short : NOTES.load).text, glow || p.load === 'short');
    }
    ctx.label([-35, 80, 60], 'Mains transformer', false);
    ctx.label([46, 20, 70], 'Regulator on its heatsink', !!o.i);
    ctx.label([-10, -40, 18], 'Control board', !!p.on);
    ctx.label([-7, Y0, 62], o.mode === 'CC' ? 'CC: current limit reached' : 'CV: holding the voltage', !!o.mode);
  },
  stats: st => {
    const o = solve(st.p);
    return [
      { label: T('Output'), value: st.p.on ? o.mode : T('OFF') },
      { label: T('Set'), value: `${st.p.vSet} V · ${st.p.iSet} A`, small: true },
      { label: T('Out'), value: `${o.v.toFixed(2)} V · ${o.i.toFixed(3)} A`, small: true },
    ];
  },
  reportKeys: ['vOut', 'iOut', 'mode', 'pLoadW', 'loadHot'],
  report: st => { const o = solve(st.p); return { vOut: +o.v.toFixed(2), iOut: +o.i.toFixed(3), mode: o.mode, pLoadW: +o.w.toFixed(1), loadHot: hot(st.p, o) }; },
  mistake: st => {
    const p = st.p, o = solve(p);
    if (!p.on) return null;
    if (p.load === 'short' && p.iSet > 1) return 'short-high-limit';
    if (hot(p, o)) return 'resistor-overload';
    if (p.load !== 'open' && p.iSet >= 5) return 'limit-at-max';
    return null;
  },
  explode: true,
  xrCaption: 'See-through: the transformer, the regulator on its heatsink and the control board',
  xr: {
    anchors: [
      { id: '+', kind: 'pin', part: 'POST_PLUS', at: [POSTS['+'].x, Y0 - 13, POST_Z], normal: [0, -1, 0], aliases: ['V+', 'OUT+'] },
      { id: '-', kind: 'pin', part: 'POST_MINUS', at: [POSTS['-'].x, Y0 - 13, POST_Z], normal: [0, -1, 0], aliases: ['V-', 'OUT-'] },
      { id: 'GND', kind: 'pin', part: 'POST_GND', at: [POSTS.GND.x, Y0 - 13, POST_Z], normal: [0, -1, 0], aliases: ['EARTH'] },
      { id: 'control:VSET', kind: 'control', part: 'VSET', at: [KNOBS.VSET.x, Y0 - 13, KNOB_Z], normal: [0, -1, 0], channel: 'turn:VSET' },
      { id: 'control:ISET', kind: 'control', part: 'ISET', at: [KNOBS.ISET.x, Y0 - 13, KNOB_Z], normal: [0, -1, 0], channel: 'turn:ISET' },
      { id: 'control:POWER', kind: 'control', part: 'POWER', at: [-52, Y0 - 5, 19], normal: [0, -1, 0], channel: 'press:POWER' },
      { id: 'led:CV', kind: 'led', part: 'PANEL', at: [-7, Y0 - .5, 62], normal: [0, -1, 0], channel: 'led:CV' },
      { id: 'led:CC', kind: 'led', part: 'PANEL', at: [7, Y0 - .5, 62], normal: [0, -1, 0], channel: 'led:CC' },
      ...SCREENS.map(([sid, x0, text]) => ({ id: `screen:${sid}`, kind: 'screen', part: 'PANEL', at: [x0 + 22, Y0 - .3, 95], normal: [0, -1, 0], text,
        rect: { origin: [x0 - 3, Y0 - .3, 108], u: [50, 0, 0], v: [0, 0, -26], pixels: [200, 104] } })),
    ],
    channels: [
      { id: 'turn:VSET', kind: 'rotate', part: 'VSET', value: { unit: 'deg', min: -150, max: 150, rest: knobDeg('VSET', 5) }, axis: [0, 1, 0], pivot: [KNOBS.VSET.x, Y0, KNOB_Z], scale: Math.PI / 180,
        bind: { source: 'param', key: 'vSet' }, extras: { degPerUnit: 10, degAtZero: -150 } },
      { id: 'turn:ISET', kind: 'rotate', part: 'ISET', value: { unit: 'deg', min: -150, max: 150, rest: knobDeg('ISET', .5) }, axis: [0, 1, 0], pivot: [KNOBS.ISET.x, Y0, KNOB_Z], scale: Math.PI / 180,
        bind: { source: 'param', key: 'iSet' }, extras: { degPerUnit: 60, degAtZero: -150 } },
      { id: 'led:CV', kind: 'emissive', part: 'PANEL', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#4dff6a', extras: { on: 'report.mode === "CV"' } },
      { id: 'led:CC', kind: 'emissive', part: 'PANEL', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#ff4b33', extras: { on: 'report.mode === "CC"' } },
      // the rocker tips 24° about x: off (rest) its top stands out (+12°), on its bottom does (-12°)
      { id: 'press:POWER', kind: 'rotate', part: 'POWER', value: { unit: 'deg', min: -12, max: 12, rest: 12 }, axis: [1, 0, 0], pivot: [-52, Y0 - 3, 19], scale: Math.PI / 180,
        bind: { source: 'param', key: 'on' }, extras: { deg: { false: 12, true: -12 } } },
    ],
    extras: { screens: { VOUT: { digits: 4, format: 'vOut, 2 decimals', color: '#ff4b33' }, IOUT: { digits: 4, format: 'iOut, 3 decimals', color: '#4dff6a' } } },
  },
  lab: {
    lab: 'electronics',
    summary: 'A 0-30 V, 0-5 A bench supply. It holds the voltage you set (CV) until the load wants more than the current limit, then it holds the current (CC).',
    safeUse: [
      'Turn the output off before you connect or change anything.',
      'Set the voltage first, then set the current limit a little above what your circuit should draw.',
      'Use red for + and black for -; green is mains earth, not the negative output.',
      'If the CC lamp lights when you did not expect it, something draws too much: turn off and check the circuit.',
      'Never short the output with the current limit turned up.',
    ],
    mistakes: [
      { id: 'short-high-limit', when: 'The output is on into a short with the current limit above 1 A.', say: 'That is a short with the current limit turned up. Turn the output off and turn the current limit down.' },
      { id: 'resistor-overload', when: 'The resistor on the output burns more power than its rating.', say: 'The resistor is burning more than its rating and will overheat. Lower the voltage or use a bigger resistor.' },
      { id: 'limit-at-max', when: 'The output is on into a load with the current limit at the 5 A maximum.', say: 'The current limit is at maximum, so it protects nothing. Set it just above what the circuit needs.' },
    ],
    hazards: ['A short or a wrong connection can burn parts and wires.', 'Overloaded resistors get hot enough to burn fingers.', 'The mains inside the case is dangerous: never open it while plugged in.'],
  },
});
function power(st, api){ api.set('on', !st.p.on); api.say(st.p.on ? 'Output on' : 'Output off'); }
function stepKnob(st, api, key, list, label, unit){
  const i = list.indexOf(st.p[key]), next = list[(i + 1) % list.length];
  api.set(key, next); api.say('{part} is now {value}', { part: T(label), value: next + ' ' + unit });
}
})();
