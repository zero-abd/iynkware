// @cf title 250 mL beaker
// @cf use engine/lab.list
/* A 250 mL low-form (Griffin) beaker in borosilicate glass 3.3, the size ISO 3819 gives: 70 mm outside diameter,
   95 mm tall, about 1.5 mm wall and a 2 mm floor, a pouring spout at the rim and white enamel graduations every
   25 mL from 50 to 250 mL (approximate: a beaker is for holding and heating, not measuring; ±5 %). Brim-full it holds
   about 330 mL. The liquid's level is computed from the inside volume, so 250 mL stands where the 250 mark is.
   Heating stands for a hot plate under it: the liquid warms with a rate that falls with its volume (about eight times
   faster than a real 500 W plate, so a lesson does not wait), bubbles near 100 °C and steams. */
(() => {
const LAB = SL.lab, T = LAB.T;
const R = 35, H = 95, WALL = 1.5, FLOOR = 2;
const OUTER = [[R - 2, 0], [R, 2.5], [R, H - 2], [R + .6, H]];
const INNER = [[R - WALL, FLOOR], [R - WALL, H - .5]];
const SPOUT = Math.PI / 2 + .7;      // the spout sits back-left, away from the printed marks at the front
const lip = a => { const d = Math.atan2(Math.sin(a - SPOUT), Math.cos(a - SPOUT)); return Math.abs(d) < .45 ? 4.2 * Math.pow(Math.cos(d / .45 * Math.PI / 2), 2) : 0; };
const marks = [];
for (let v = 50; v <= 250; v += 25) marks.push({ z: LAB.levelFor(INNER, v), major: v % 50 === 0, text: v % 50 === 0 ? String(v) : '' });
const VOLUMES = [0, 50, 100, 150, 200, 250, 300];
const levelTable = Object.fromEntries(VOLUMES.map(v => [v, +LAB.levelFor(INNER, v).toFixed(1)]));

LAB.item('beaker-250', {
  name: '250 mL beaker', fig: 'L1', foot: [2 * R + 10, 2 * R + 10, H],
  params: {
    liquid: LAB.liquidParam(),
    volume: { label: 'Volume', values: VOLUMES, range: [0, 330], unit: 'mL', show: v => v + ' mL' },
    heat: { label: 'Hot plate', values: [false, true], picker: false },
  },
  defaults: { liquid: 'copper-sulfate', volume: 150, heat: false },
  parts: {
    BEAKER: { name: 'Beaker', role: 'body' },
    LIQUID: { name: 'Liquid', role: 'liquid' },
  },
  actions: [
    { id: 'fill', label: 'Fill 50 mL', run: (st, api) => { if (st.p.volume >= 300) return api.say('The beaker is full to the brim'); api.set('volume', Math.min(300, st.p.volume + 50)); } },
    { id: 'empty', label: 'Empty', run: (st, api) => { api.set('volume', 0); } },
    { id: 'heat', label: 'Hot plate on/off', run: (st, api) => { api.set('heat', !st.p.heat); api.say(st.p.heat ? 'Hot plate on' : 'Hot plate off'); } },
  ],
  init: st => { st.s.vol = st.p.volume; st.s.temp = 20; },
  onLoad: st => { st.s.vol = st.p.volume; },
  // the level eases to the new volume (a pour, not a jump); the liquid warms on the plate and cools off it
  step: (st, dt) => {
    const s = st.s, target = st.p.volume;
    if (s.vol !== target){ const g = Math.sign(target - s.vol); s.vol = g > 0 ? Math.min(target, s.vol + 120 * dt) : Math.max(target, s.vol - 240 * dt); }
    if (st.p.heat) s.temp = Math.min(st.p.volume > 0 ? 100 : 250, s.temp + 600 / (st.p.volume + 20) * dt);
    else s.temp = Math.max(20, s.temp - (s.temp - 20) * .03 * dt - .05 * dt);
  },
  live: st => st.s.vol !== st.p.volume || st.p.heat || st.s.temp > 20.5,
  draw(ctx){
    const { p, s, k, t } = ctx, liq = LAB.LIQUIDS[p.liquid] || LAB.LIQUIDS.water, vol = s.vol != null ? s.vol : p.volume;
    const level = vol > .5 ? LAB.levelFor(INNER, vol) : null, temp = s.temp || 20;
    ctx.shadow([...ctx.ring(0, 0, 0, R, 16), ...ctx.ring(0, 0, H, R, 16)]);
    let svg = LAB.glass(ctx.W, { outer: OUTER, inner: INNER, level, liquid: liq.color, marks, markAt: -Math.PI / 2 - .02, lip, k, n: 28 });
    // "250 mL" and the maker's mark printed beside the graduations, on the front left
    const pa = -Math.PI / 2 - .62, at = z => ctx.W((R + .2) * Math.cos(pa), (R + .2) * Math.sin(pa), z), U = sub(ctx.W(-Math.sin(pa), Math.cos(pa), 0), ctx.W(0, 0, 0));
    if (vis(sub(ctx.W(Math.cos(pa), Math.sin(pa), 0), ctx.W(0, 0, 0)))) svg += LAB.textOn(at(40), U, [0, 0, -1], '250 mL', 3.6, '#ffffff', 800) + LAB.textOn(at(34), U, [0, 0, -1], 'Boro 3.3', 2.4, '#ffffff', 600);
    // near the boil: bubbles rising from the floor, steam over the rim
    if (level != null && temp > 70){
      const n = Math.round((temp - 70) / 5);
      for (let i = 0; i < n; i++){
        const a = i * 2.4, r = 8 + (i * 7) % 22, ph = (t * (.8 + (i % 3) * .3) + i * .37) % 1, z = FLOOR + 2 + ph * (level - FLOOR - 3);
        const [X, Y] = P(...ctx.W(r * Math.cos(a), r * Math.sin(a), z));
        svg += `<circle cx="${f(X)}" cy="${f(Y)}" r="${f(.6 + .9 * ph)}" fill="none" stroke="#ffffff" stroke-width=".6" opacity=".85"/>`;
      }
    }
    if (temp > 85 && level != null){
      for (let i = 0; i < 3; i++){
        const ph = (t * .5 + i / 3) % 1, x0 = -12 + i * 12, pts = Array.from({ length: 8 }, (_, j) => ctx.W(x0 + Math.sin(j * .9 + ph * 6.28) * 3, 0, H + 4 + j * 4 + ph * 8));
        svg += `<path d="${pd(pts, false)}" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" opacity="${f(.55 * (1 - ph))}"/>`;
      }
    }
    ctx.put([[-R - 5, -R - 1, 0], [R + 5, R + 5, H + 1]], svg, 'BEAKER');
    ctx.label([(R + 3) * Math.cos(SPOUT), (R + 3) * Math.sin(SPOUT), H], 'Spout and rim', false);
    ctx.label([R, 0, marks[4].z], 'Approximate graduations', false);
    if (level != null) ctx.label([R - WALL, 0, level], 'Liquid level', true);
  },
  stats: st => [
    { label: T('Volume'), value: Math.round(st.s.vol != null ? st.s.vol : st.p.volume) + ' mL' },
    { label: T('Temperature'), value: Math.round(st.s.temp || 20) + ' °C', small: true },
    { label: T('Hot plate'), value: st.p.heat ? T('ON') : T('OFF'), small: true },
  ],
  reportKeys: ['tempC', 'boiling'],
  report: st => ({ tempC: Math.round((st.s.temp || 20) / 5) * 5, boiling: !!(st.p.heat && st.p.volume > 0 && st.s.temp >= 99.5) }),
  mistake: st => st.p.heat && st.p.volume === 0 ? 'heating-empty'
    : st.p.heat && st.p.volume > 150 ? 'heating-too-full'
    : st.p.volume > 250 ? 'overfilled' : null,
  xrCaption: 'See-through: the glass fades and the graduations and the level show',
  xr: {
    anchors: [
      { id: 'port:SPOUT', kind: 'port', part: 'BEAKER', at: [+((R + 4) * Math.cos(SPOUT)).toFixed(1), +((R + 4) * Math.sin(SPOUT)).toFixed(1), H], normal: [+Math.cos(SPOUT).toFixed(3), +Math.sin(SPOUT).toFixed(3), 0] },
      { id: 'label:LIQUID', kind: 'label', part: 'LIQUID', at: [R - WALL, 0, levelTable[150]], normal: [1, 0, 0], text: 'Liquid' },
      { id: 'label:BEAKER', kind: 'label', part: 'BEAKER', at: [0, -R, 60], normal: [0, -1, 0], text: 'Beaker' },
    ],
    channels: [],
    extras: { liquid: { part: 'LIQUID', bind: { source: 'param', key: 'volume' }, color: { source: 'param', key: 'liquid' }, inner: INNER, levelMm: levelTable,
      how: 'The liquid is a lathe of the inner profile from the floor to levelMm[volume]; scale its node along up from the floor, or rebuild it' } },
  },
  lab: {
    lab: 'chemistry',
    summary: 'A 250 mL glass beaker for holding, mixing and heating liquids. Its marks are only approximate.',
    safeUse: [
      'Carry it with one hand under the base, not by the rim.',
      'When you heat it, fill it to 150 mL at most, so it cannot boil over.',
      'Heat it on a hot plate or on a gauze over a tripod, never straight in a flame.',
      'Use a measuring cylinder or pipette when the volume matters.',
      'Let hot glass cool before you touch it: hot glass looks the same as cold glass.',
    ],
    mistakes: [
      { id: 'heating-empty', when: 'The hot plate is on and the beaker is empty.', say: 'The beaker is empty on a hot plate: heating dry glass can crack it. Turn the plate off.' },
      { id: 'heating-too-full', when: 'The hot plate is on with more than 150 mL in the beaker.', say: 'That is too full to heat: it can boil over. Pour some out first.' },
      { id: 'overfilled', when: 'The beaker holds more than its 250 mL mark.', say: 'The beaker is filled past 250 mL: it will spill when you carry it.' },
    ],
    hazards: ['Hot glass and hot liquid can burn.', 'Chipped or cracked glass can cut and can break when heated.', 'Some solutions (copper sulfate, potassium permanganate) are harmful: wear goggles and gloves.'],
  },
});
})();
