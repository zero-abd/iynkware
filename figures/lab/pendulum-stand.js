// @cf title Simple pendulum
// @cf use engine/lab.list
/* A simple pendulum on a school retort stand: a cast-iron base 200 x 130 x 12 mm, a 12 mm steel rod 600 mm tall
   screwed into one end of it, a boss head 560 mm up holding a 10 mm clamp rod out over the base, and from the end of
   that rod a thin string with a 23 mm bob (brass, about 50 g, or wood, about 5 g). The string swings across the
   clamp rod, so the bob never meets the stand.
   The swing runs on the figure's clock with the real period: T0 = 2π√(L/g) for small swings (L from the pivot to the
   centre of the bob, g = 9.81 m/s²), and longer for big ones, T ≈ T0 (1 + θ0²/16 + 11θ0⁴/3072). The mass does not
   change it: that is the experiment. */
(() => {
const LAB = SL.lab, T = LAB.T;
const G = 9.81, BW = 200, BD = 130, BH = 12, ROD_X = -78, ROD_R = 6, ROD_TOP = 612, BOSS_Z = 560, PIV = [62, 0, BOSS_Z - 7], BOB_R = 11.5;
const BOBS = { brass: { name: 'Brass bob, 50 g', grams: 50, mat: LAB.M.brass }, wood: { name: 'Wooden bob, 5 g', grams: 5, mat: { l: '#e0b47a', m: '#c49556', d: '#8a6533' } } };
const rad = d => d * Math.PI / 180;
const period0 = mm => 2 * Math.PI * Math.sqrt(mm / 1000 / G);
const period = (mm, deg) => { const q = rad(deg); return period0(mm) * (1 + q * q / 16 + 11 * Math.pow(q, 4) / 3072); };
// the bob's angle at time t after release (0 = hanging straight down)
const angleAt = st => st.p.swinging ? st.p.amplitude * Math.cos(2 * Math.PI * st.s.swingT / period(st.p.length, st.p.amplitude)) : 0;

LAB.item('pendulum-stand', {
  name: 'Simple pendulum', fig: 'L5', foot: [BW + 20, 300, ROD_TOP + 8],
  params: {
    length: { label: 'String length', values: [200, 300, 400, 500], range: [100, 520], unit: 'mm', show: v => v + ' mm' },
    amplitude: { label: 'Release angle', values: [5, 10, 20, 45], range: [0, 60], unit: 'deg', show: v => v + '°' },
    bob: { label: 'Bob', values: Object.keys(BOBS), names: Object.fromEntries(Object.entries(BOBS).map(([k, v]) => [k, v.name])) },
    swinging: { label: 'Swinging', values: [false, true], picker: false },
  },
  defaults: { length: 400, amplitude: 10, bob: 'brass', swinging: false },
  parts: {
    BASE: { name: 'Retort stand base', role: 'body' },
    ROD: { name: 'Stand rod', role: 'body' },
    CLAMP: { name: 'Boss head and clamp rod', role: 'body' },
    STRING: { name: 'String', role: 'wire' },
    BOB: { name: 'Bob', role: 'control', press: (st, api) => swing(st, api) },
  },
  actions: [{ id: 'swing', label: 'Release / stop', run: (st, api) => swing(st, api) }],
  init: st => { st.s.swingT = 0; },
  onParam: (st, k) => { if (k === 'swinging' || k === 'length' || k === 'amplitude') st.s.swingT = 0; },
  step: (st, dt) => { if (st.p.swinging) st.s.swingT += dt; },
  live: st => st.p.swinging,
  draw(ctx){
    const { p, k } = ctx, W = ctx.W, th = rad(angleAt({ p, s: ctx.s })), Lm = p.length, bob = BOBS[p.bob] || BOBS.brass;
    const bc = [PIV[0], PIV[1] + Lm * Math.sin(th), PIV[2] - Lm * Math.cos(th)];
    ctx.shadow([W(-BW / 2, -BD / 2, 0), W(BW / 2, -BD / 2, 0), W(BW / 2, BD / 2, 0), W(-BW / 2, BD / 2, 0), W(-BW / 2, -BD / 2, BH), W(BW / 2, BD / 2, BH)]);
    ctx.shadow([...ctx.ring(ROD_X, 0, 0, ROD_R, 8), ...ctx.ring(ROD_X, 0, ROD_TOP, ROD_R, 8), W(PIV[0] + 6, 0, BOSS_Z)]);
    ctx.shadow([...ctx.ring(bc[0], bc[1], bc[2] - BOB_R, BOB_R, 10), ...ctx.ring(bc[0], bc[1], bc[2] + BOB_R, 2, 6)]);
    // base: a cast slab with a boss for the rod
    ctx.put([[-BW / 2, -BD / 2, 0], [BW / 2, BD / 2, BH]], SL.bench.slabW(W, -BW / 2, -BD / 2, BW / 2, BD / 2, 0, BH, LAB.M.castIron, toneI, 1.6)
      + LAB.lathe(W, ROD_X, 0, [[13, BH], [11, BH + 6]], LAB.M.castIron, toneI, 1, 18), 'BASE');
    // the rod, cut in two so it sorts against the clamp rod and the string
    ctx.put([[ROD_X - ROD_R, -ROD_R, BH], [ROD_X + ROD_R, ROD_R, BOSS_Z - 12]], rod(W(ROD_X, 0, BH), W(ROD_X, 0, BOSS_Z - 12), ROD_R, LAB.M.steel, toneI, 1.1, ROD_R, 14), 'ROD');
    ctx.put([[ROD_X - ROD_R, -ROD_R, BOSS_Z + 12], [ROD_X + ROD_R, ROD_R, ROD_TOP]], rod(W(ROD_X, 0, BOSS_Z + 12), W(ROD_X, 0, ROD_TOP), ROD_R, LAB.M.steel, toneI, 1.1, ROD_R, 14), 'ROD');
    // boss head on the rod, its thumbscrew, and the clamp rod out to the pivot
    let cl = SL.bench.slabW(W, ROD_X - 11, -11, ROD_X + 11, 11, BOSS_Z - 12, BOSS_Z + 12, LAB.M.castIron, toneI, 1.1)
      + rod(W(ROD_X, -11, BOSS_Z + 4), W(ROD_X, -22, BOSS_Z + 4), 2, LAB.M.steel, toneI, .7, 2, 10) + rod(W(ROD_X, -22, BOSS_Z + 4), W(ROD_X, -25, BOSS_Z + 4), 5, LAB.M.blackPl, toneI, .8, 5, 12)
      + rod(W(ROD_X + 11, 0, BOSS_Z), W(PIV[0] + 6, 0, BOSS_Z), 5, LAB.M.steel, toneI, 1, 5, 14);
    cl += rod(W(PIV[0], 0, BOSS_Z - 5), W(PIV[0], 0, PIV[2]), 1.4, LAB.M.steel, toneI, .6, 1, 8);
    ctx.put([[ROD_X - 11, -25, BOSS_Z - 12], [PIV[0] + 6, 11, BOSS_Z + 12]], cl, 'CLAMP');
    // the string, in pieces so the bob and the rod sort round it
    const n = 6;
    for (let i = 0; i < n; i++){
      const a = [0, 1, 2].map(c => PIV[c] + (bc[c] - PIV[c]) * i / n), b = [0, 1, 2].map(c => PIV[c] + (bc[c] - PIV[c]) * (i + 1) / n);
      ctx.put([[Math.min(a[0], b[0]) - .5, Math.min(a[1], b[1]) - .5, Math.min(a[2], b[2])], [Math.max(a[0], b[0]) + .5, Math.max(a[1], b[1]) + .5, Math.max(a[2], b[2])]],
        rod(W(...a), W(...b), .45, { l: '#f4efe2', m: '#d9d2bf', d: '#9c9480' }, toneI, .5, .45, 6), 'STRING');
    }
    // the bob: a sphere (a lathe of nine rings) with a small eye on top
    const sph = Array.from({ length: 9 }, (_, i) => { const q = -Math.PI / 2 + Math.PI * i / 8; return [Math.max(.01, BOB_R * Math.cos(q)), bc[2] + BOB_R * Math.sin(q)]; });
    const bobSvg = LAB.lathe(W, bc[0], bc[1], sph, bob.mat, toneI, 1.2, 16) + rod(W(bc[0], bc[1], bc[2] + BOB_R - .5), W(bc[0], bc[1], bc[2] + BOB_R + 2.5), 1.2, LAB.M.steel, toneI, .5, 1.2, 8);
    ctx.put([[bc[0] - BOB_R, bc[1] - BOB_R, bc[2] - BOB_R], [bc[0] + BOB_R, bc[1] + BOB_R, bc[2] + BOB_R + 3]], bobSvg, 'BOB');
    // see-through: the arc it swings through and the length L, measured to the centre of the bob
    if (k > .05){
      const A = rad(p.amplitude), arc = Array.from({ length: 17 }, (_, i) => { const q = -A + 2 * A * i / 16; return W(PIV[0], PIV[1] + Lm * Math.sin(q), PIV[2] - Lm * Math.cos(q)); });
      let s = `<path d="${pd(arc, false)}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="4 3" opacity="${f(k)}"/>`;
      const d0 = W(PIV[0] + 20, 0, PIV[2]), d1 = W(PIV[0] + 20, 0, PIV[2] - Lm);
      s += `<path d="${pd([d0, d1], false)}" fill="none" stroke="#e2483d" stroke-width="1.3" opacity="${f(k)}"/>`;
      for (const e of [d0, d1]){ const [X, Y] = P(...e); s += `<circle cx="${f(X)}" cy="${f(Y)}" r="2" fill="#e2483d" opacity="${f(k)}"/>`; }
      ctx.put([[PIV[0] + 19, -1, PIV[2] - Lm], [PIV[0] + 21, 1, PIV[2]]], s);
    }
    ctx.label([PIV[0], 0, PIV[2]], 'Pivot', false);
    ctx.label([PIV[0] + 20, 0, PIV[2] - Lm / 2], 'Length L', true);
    ctx.label(bc, 'Bob', !!p.swinging);
  },
  stats: st => [
    { label: T('Period'), value: period(st.p.length, st.p.amplitude).toFixed(2) + ' s' },
    { label: T('Swings'), value: String(st.p.swinging ? Math.floor(st.s.swingT / period(st.p.length, st.p.amplitude)) : 0), small: true },
    { label: '2π√(L/g)', value: period0(st.p.length).toFixed(2) + ' s', small: true },
  ],
  reportKeys: ['swings', 'periodS', 'periodSmallS', 'bobGrams'],
  report: st => ({ swings: st.p.swinging ? Math.floor(st.s.swingT / period(st.p.length, st.p.amplitude)) : 0, periodS: +period(st.p.length, st.p.amplitude).toFixed(2),
    periodSmallS: +period0(st.p.length).toFixed(2), bobGrams: BOBS[st.p.bob].grams }),
  mistake: st => st.p.swinging && st.p.amplitude > 15 ? 'large-angle' : null,
  xrCaption: 'See-through: the arc of the swing and the length L, measured to the centre of the bob',
  xr: {
    anchors: [
      { id: 'label:PIVOT', kind: 'label', part: 'CLAMP', at: PIV, normal: [0, 0, -1], text: 'Pivot' },
      { id: 'control:BOB', kind: 'control', part: 'BOB', at: [PIV[0], 0, PIV[2] - 400], normal: [0, -1, 0], channel: 'swing:BOB', extras: { atLengthMm: 400 } },
    ],
    channels: [
      { id: 'swing:BOB', kind: 'rotate', part: 'BOB', value: { unit: 'deg', min: -60, max: 60, rest: 0 }, axis: [1, 0, 0], pivot: PIV, scale: Math.PI / 180,
        extras: { nodes: ['STRING', 'BOB'], angle: 'amplitude * cos(2π t / report.periodS) while swinging', lengthBind: { source: 'param', key: 'length' } } },
    ],
    extras: { g: G },
  },
  lab: {
    lab: 'physics',
    summary: 'A simple pendulum on a retort stand. Its period depends on the string length, T = 2π√(L/g), not on the mass of the bob.',
    safeUse: [
      'Clamp the stand to the bench, or put a heavy weight on its base, so it cannot tip.',
      'Measure L from the pivot to the centre of the bob.',
      'Release the bob from a small angle, under about 15 degrees, without pushing it.',
      'Time 10 swings and divide by 10: it is much more accurate than timing one.',
      'Start the timer as the bob passes the lowest point, where it moves fastest.',
    ],
    mistakes: [
      { id: 'large-angle', when: 'The bob is swinging from a release angle above 15 degrees.', say: 'That swing is too big for the formula: release it from under about 15 degrees.' },
    ],
    hazards: ['A tall stand can tip over: keep the clamp over the base.', 'A heavy swinging bob can hit faces and glassware.'],
  },
});
function swing(st, api){ api.set('swinging', !st.p.swinging); api.say(st.p.swinging ? 'Released: count the swings' : 'Stopped'); }
})();
