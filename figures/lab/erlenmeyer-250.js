// @cf title 250 mL conical flask
// @cf use engine/lab.list
/* A 250 mL narrow-neck Erlenmeyer (conical) flask in borosilicate glass 3.3, the ISO 1773 size: 85 mm across the
   base, 145 mm tall, a 34 mm neck with a beaded rim, a 1.6 mm wall. Approximate graduations every 50 mL from 50 to
   250 mL; the 250 mark sits in the cone, well below the shoulder, and the flask holds about 310 mL to the neck.
   The sloping sides keep a swirled liquid inside, which is what the flask is for: mixing and titrations. Swirling it
   tips and turns the surface for a few seconds. */
(() => {
const LAB = SL.lab, T = LAB.T;
const R = 42.5, H = 145, NECK = 17, WALL = 1.6;
const OUTER = [[R - 2.5, 0], [R, 3], [R, 10], [NECK + 1.6, 108], [NECK, 116], [NECK, 141], [NECK + 1.5, 143.5], [NECK + .6, H]];
const INNER = [[R - WALL, 2], [R - WALL, 10], [NECK + 1.6 - WALL, 108], [NECK - WALL, 116], [NECK - WALL, H - .5]];
const marks = [50, 100, 150, 200, 250].map(v => ({ z: LAB.levelFor(INNER, v), major: true, text: String(v) }));
const VOLUMES = [0, 50, 100, 150, 200, 250, 300];
const levelTable = Object.fromEntries(VOLUMES.map(v => [v, +LAB.levelFor(INNER, v).toFixed(1)]));
const SWIRL = 3;   // seconds a swirl lasts

LAB.item('erlenmeyer-250', {
  name: '250 mL conical flask', fig: 'L2', foot: [2 * R + 6, 2 * R + 6, H],
  params: {
    liquid: LAB.liquidParam(),
    volume: { label: 'Volume', values: VOLUMES, range: [0, 337], unit: 'mL', show: v => v + ' mL' },
    swirling: { label: 'Swirling', values: [false, true], picker: false },
  },
  defaults: { liquid: 'indicator', volume: 100, swirling: false },
  parts: {
    FLASK: { name: 'Conical flask', role: 'body' },
    LIQUID: { name: 'Liquid', role: 'liquid' },
  },
  actions: [
    { id: 'fill', label: 'Fill 50 mL', run: (st, api) => { if (st.p.volume >= 300) return api.say('The flask is full to the neck'); api.set('volume', Math.min(300, st.p.volume + 50)); } },
    { id: 'empty', label: 'Empty', run: (st, api) => { api.set('volume', 0); } },
    { id: 'swirl', label: 'Swirl', run: (st, api) => { if (!st.p.volume) return api.say('There is nothing in the flask to swirl'); api.set('swirling', true); } },
  ],
  init: st => { st.s.vol = st.p.volume; st.s.swirlT = 0; },
  onLoad: st => { st.s.vol = st.p.volume; },
  onParam: (st, k, v) => { if (k === 'swirling') st.s.swirlT = v ? SWIRL : 0; },
  step: (st, dt, api) => {
    const s = st.s, target = st.p.volume;
    if (s.vol !== target){ const g = Math.sign(target - s.vol); s.vol = g > 0 ? Math.min(target, s.vol + 120 * dt) : Math.max(target, s.vol - 240 * dt); }
    if (s.swirlT > 0){ s.swirlT = Math.max(0, s.swirlT - dt); if (!s.swirlT) api.set('swirling', false); }
  },
  live: st => st.s.vol !== st.p.volume || st.s.swirlT > 0,
  draw(ctx){
    const { p, s, k, t } = ctx, liq = LAB.LIQUIDS[p.liquid] || LAB.LIQUIDS.water, vol = s.vol != null ? s.vol : p.volume;
    const level = vol > .5 ? LAB.levelFor(INNER, vol) : null;
    // a swirl: the surface tips (more at the start) and its high side runs round
    const sw = s.swirlT > 0 ? Math.sin(Math.PI * s.swirlT / SWIRL) : 0;
    ctx.shadow([...ctx.ring(0, 0, 0, R, 16), ...ctx.ring(0, 0, 108, NECK + 2, 12), ...ctx.ring(0, 0, H, NECK, 12)]);
    let svg = LAB.glass(ctx.W, { outer: OUTER, inner: INNER, level, liquid: liq.color, marks, markAt: -Math.PI / 2, k, n: 28,
      surface: sw * .22, swirlAt: t * 7 });
    const U = sub(ctx.W(1, 0, 0), ctx.W(0, 0, 0)), toward = vis(sub(ctx.W(0, -1, 0), ctx.W(0, 0, 0)));
    if (toward) svg += LAB.textOn(ctx.W(0, -R - .2, 5.5), U, [0, 0, -1], '250 mL', 3.6, '#ffffff', 800);
    ctx.put([[-R - 1, -R - 1, 0], [R + 1, R + 1, H + 1]], svg, 'FLASK');
    ctx.label([0, -NECK, 128], 'Narrow neck', false);
    ctx.label([R * .6, -R * .6, 40], 'Sloping sides', false);
    if (level != null) ctx.label([LAB.radiusAt(INNER, level), 0, level], 'Liquid level', true);
  },
  stats: st => [
    { label: T('Volume'), value: Math.round(st.s.vol != null ? st.s.vol : st.p.volume) + ' mL' },
    { label: T('Swirling'), value: st.p.swirling ? T('yes') : T('no'), small: true },
  ],
  reportKeys: [],
  mistake: st => st.p.swirling && st.p.volume > 150 ? 'swirl-too-full' : st.p.volume > 250 ? 'overfilled' : null,
  xrCaption: 'See-through: the glass fades and the graduations and the level show',
  xr: {
    anchors: [
      { id: 'port:NECK', kind: 'port', part: 'FLASK', at: [0, 0, H], normal: [0, 0, 1] },
      { id: 'label:LIQUID', kind: 'label', part: 'LIQUID', at: [+LAB.radiusAt(INNER, levelTable[100]).toFixed(1), 0, levelTable[100]], normal: [1, 0, 0], text: 'Liquid' },
      { id: 'label:FLASK', kind: 'label', part: 'FLASK', at: [0, -NECK, 128], normal: [0, -1, 0], text: 'Conical flask' },
    ],
    channels: [],
    extras: { liquid: { part: 'LIQUID', bind: { source: 'param', key: 'volume' }, color: { source: 'param', key: 'liquid' }, inner: INNER, levelMm: levelTable,
      how: 'The liquid is a lathe of the inner profile from the floor to levelMm[volume]; rebuild it, since the cone is not a straight scale' },
      swirl: { bind: { source: 'param', key: 'swirling' }, seconds: SWIRL, tiltDeg: 12.4 } },
  },
  lab: {
    lab: 'chemistry',
    summary: 'A 250 mL conical (Erlenmeyer) flask for mixing, swirling and titrations. Its sloping sides keep the liquid in when you swirl it.',
    safeUse: [
      'Swirl it by moving your wrist in small circles, holding the neck.',
      'Keep it to 150 mL or less when you swirl it, so nothing climbs out.',
      'Stand it on a white tile under a burette to see a colour change.',
      'Never heat it with a stopper in: the pressure can burst it.',
    ],
    mistakes: [
      { id: 'swirl-too-full', when: 'The flask is swirled with more than 150 mL in it.', say: 'That flask is too full to swirl: keep it under about half full or it will slop out.' },
      { id: 'overfilled', when: 'The flask holds more than its 250 mL mark.', say: 'The flask is filled past 250 mL: there is no room left to mix.' },
    ],
    hazards: ['Glass breaks and cuts.', 'A stoppered flask can burst when heated.', 'Some solutions are harmful: wear goggles.'],
  },
});
})();
