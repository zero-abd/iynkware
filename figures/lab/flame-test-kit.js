// @cf title Flame test kit
// @cf use engine/lab.list
/* A school flame-test kit, as the usual practical sets it out (the RSC "flame tests" practical, AQA GCSE chemistry
   required practical 4.8.3): a nichrome wire loop (0.5 mm wire, a 4 mm loop at the end of 40 mm of wire) set in a
   6 mm glass rod with a cork grip, 135 mm long in all, resting across a small wooden stand so the loop is off the
   bench; eight 50 mm watch glasses on paper labels, seven with a known chloride (LiCl, NaCl, KCl, CaCl2, CuCl2,
   SrCl2, BaCl2) and one marked "?" holding an unknown; and a 50 mL beaker (ISO 3819: 42 mm across, 60 mm tall) of
   dilute hydrochloric acid for cleaning the loop.
   The method: dip the loop in the acid and hold it in a blue flame until it adds no colour (clean), dip it in one
   salt, hold it at the edge of a blue flame and note the colour; clean it again before the next salt. A loop that was
   never cleaned carries sodium from fingers and dust, and a loop dipped in a second salt without cleaning carries
   both, so the colour is mixed; sodium's strong yellow-orange hides most others. The flame itself is the Bunsen
   burner's: this kit reports `sample`, the metal on the loop, which a host passes to bunsen-burner's `sample`. */
(() => {
const LAB = SL.lab, T = LAB.T, FT = LAB.FLAME_TESTS;
const DISH_R = 25, COLS = [-140, -82, -24, 34], ROWS = [-38, 42], CARD = 31;
const DISHES = { li: [0, 0], na: [1, 0], k: [2, 0], ca: [3, 0], cu: [0, 1], sr: [1, 1], ba: [2, 1], unknown: [3, 1] };
const dishAt = id => [COLS[DISHES[id][0]], ROWS[DISHES[id][1]]];
const PART = id => 'DISH_' + id.toUpperCase();
const SALT_COLOUR = { cu: '#58ab95' };   // copper(II) chloride is blue-green; the others are white
const saltHex = el => SALT_COLOUR[el] || '#f4f2ec';
const DISH_NAMES = Object.assign(Object.fromEntries(Object.entries(FT).map(([k, v]) => [k, v.salt])), { unknown: 'Unknown salt (?)' });
const ACID = [92, 42], ACID_R = 21, ACID_H = 60;
const AOUT = [[ACID_R - 1.5, 0], [ACID_R, 2], [ACID_R, ACID_H - 1.5], [ACID_R + .5, ACID_H]], AIN = [[ACID_R - 1.4, 1.6], [ACID_R - 1.4, ACID_H - .5]];
// the loop: from the cork end on the mat, over the stand, to the loop in the air
const LX = 140, A0 = [LX, -75, 6], STAND_TOP = [LX, -5, 21];
const DIR = (() => { const d = [0, 1, 2].map(i => STAND_TOP[i] - A0[i]), l = Math.hypot(...d); return d.map(v => v / l); })();
const along = d => [0, 1, 2].map(i => A0[i] + DIR[i] * d);
const CORK = 18, ROD = 95, WIRE = 133, LOOP_R = 2.4, TIP = along(WIRE + LOOP_R);
const WATCH_OUT = [[4, 0], [14, 1.4], [22, 4.6], [DISH_R, 7]], WATCH_IN = [[3, 1.1], [13, 2.4], [21.2, 5.4], [DISH_R - .8, 7]];
const SALT_IDS = [...Object.keys(FT), 'unknown'];
const CARRY = [null, 'hand', ...SALT_IDS];

// the metal a dish holds (the unknown is whichever the host or the picker chose)
const metal = (p, id) => id === 'unknown' ? p.unknown : id;
// what the loop carries now, as metals: the salt it was last dipped in, and anything left on it from before
const onLoop = p => { const m = new Set(); if (p.salt) m.add(metal(p, p.salt)); if (p.salt && p.carry === 'hand') m.add('na'); else if (p.carry && p.carry !== 'hand') m.add(metal(p, p.carry)); return [...m]; };
// the colour a blue flame shows: sodium's yellow-orange swamps any other metal; otherwise the newest salt's colour
const sampleOf = p => { const m = onLoop(p); return m.includes('na') ? 'na' : m.length ? metal(p, p.salt) : null; };

LAB.item('flame-test-kit', {
  name: 'Flame test kit', fig: 'L7', foot: [330, 156, 62],
  params: {
    dish: { label: 'Salt dish', values: SALT_IDS, names: DISH_NAMES },
    unknown: { label: 'The unknown is', values: Object.keys(FT), names: Object.fromEntries(Object.entries(FT).map(([k, v]) => [k, v.salt])) },
    clean: { label: 'Loop cleaned', values: [false, true], picker: false },
    salt: { label: 'Salt on the loop', values: [null, ...SALT_IDS], picker: false },
    carry: { label: 'Left on the loop from before', values: CARRY, picker: false },
  },
  defaults: { dish: 'li', unknown: 'sr', clean: false, salt: null, carry: null },
  refuse: (next) => next.clean && (next.salt || next.carry) ? 'a clean loop carries nothing (send clean: true with salt: null, carry: null)'
    : next.carry && !next.salt ? 'carry is what is left on the loop under a salt: send a salt too' : null,
  parts: Object.assign({
    LOOP: { name: 'Nichrome wire loop', role: 'control', press: (st, api) => api.say(st.p.salt ? 'The loop carries {salt}' : st.p.clean ? 'The loop is clean' : 'The loop has not been cleaned yet', st.p.salt ? { salt: T(DISH_NAMES[st.p.salt]) } : null) },
    STAND: { name: 'Loop stand', role: 'body' },
    ACID: { name: 'Dilute hydrochloric acid', role: 'control', press: (st, api) => cleanLoop(st, api) },
  }, Object.fromEntries(SALT_IDS.map(id => [PART(id), { name: DISH_NAMES[id], role: 'control', press: (st, api) => { api.set('dish', id); dip(st, api); } }]))),
  actions: [
    { id: 'clean', label: 'Clean in acid', run: (st, api) => cleanLoop(st, api) },
    { id: 'dip', label: 'Dip in the salt', run: (st, api) => dip(st, api) },
  ],
  draw(ctx){
    const { p, k } = ctx, W = ctx.W, Ux = sub(W(1, 0, 0), W(0, 0, 0)), Uy = sub(W(0, -1, 0), W(0, 0, 0));
    const flatText = (x, y, s, size, col = INK, weight = 800) => LAB.textOn(W(x, y, .7), Ux, Uy, s, size, col, weight);
    // the watch glasses on their labels
    for (const id of SALT_IDS){
      const [cx, cy] = dishAt(id), el = metal(p, id), Wd = (x, y, z) => W(cx + x, cy + y, z);
      let card = SL.bench.slabW(W, cx - 19, cy - CARD - 6, cx + 19, cy - CARD + 5, 0, .6, LAB.M.white, toneI, .7);
      card += flatText(cx, cy - CARD + 2.2, id === 'unknown' ? '?' : FT[id].print, id === 'unknown' ? 9 : 7);
      ctx.put([[cx - 19, cy - CARD - 6, 0], [cx + 19, cy - CARD + 5, .7]], card, PART(id));
      let s = LAB.glass(Wd, { outer: WATCH_OUT, inner: WATCH_IN, level: null, k, n: 20 });
      // the salt: a small heap of crystals in the middle of the glass
      s += LAB.lathe(Wd, 0, 0, [[10, 2.2], [7.5, 4], [4, 5.2], [.6, 5.8]], matOf(saltHex(el)), toneI, .8, 12);
      for (let i = 0; i < 5; i++){ const a = i * 1.3 + cx, r = 2 + (i * 3) % 7, [X, Y] = P(...Wd(r * Math.cos(a), r * Math.sin(a), 5.2 - r * .2));
        s += `<path d="M${f(X - .8)} ${f(Y)}h1.6" stroke="${mix(saltHex(el), '#000000', .35)}" stroke-width=".6"/>`; }
      ctx.put([[cx - DISH_R, cy - DISH_R, 0], [cx + DISH_R, cy + DISH_R, 7]], s, PART(id));
    }
    // the acid beaker and its label
    ctx.shadow([...ctx.ring(ACID[0], ACID[1], 0, ACID_R, 12), ...ctx.ring(ACID[0], ACID[1], ACID_H, ACID_R, 12)]);
    const Wa = (x, y, z) => W(ACID[0] + x, ACID[1] + y, z);
    ctx.put([[ACID[0] - ACID_R, ACID[1] - ACID_R, 0], [ACID[0] + ACID_R, ACID[1] + ACID_R, ACID_H]],
      LAB.glass(Wa, { outer: AOUT, inner: AIN, level: 26, liquid: '#dcedf3', marks: [], k, n: 20 }), 'ACID');
    ctx.put([[ACID[0] - 19, ACID[1] - CARD - 6, 0], [ACID[0] + 19, ACID[1] - CARD + 5, .7]],
      SL.bench.slabW(W, ACID[0] - 19, ACID[1] - CARD - 6, ACID[0] + 19, ACID[1] - CARD + 5, 0, .6, LAB.M.white, toneI, .7) + flatText(ACID[0], ACID[1] - CARD + 2, 'dil. HCl', 5.6, '#b0322a'), 'ACID');
    // the stand: a wooden block with a V notch the rod lies in
    const WOOD = { l: '#e2b77a', m: '#c8975a', d: '#8e6532' };
    ctx.shadow([W(LX - 12, -12, 0), W(LX + 12, -12, 0), W(LX + 12, 2, 0), W(LX - 12, 2, 0), W(LX - 12, -12, 18), W(LX + 12, 2, 18)]);
    ctx.put([[LX - 12, -12, 0], [LX + 12, 2, 18]], SL.bench.slabW(W, LX - 12, -12, LX + 12, 2, 0, 18, WOOD, toneI, 1)
      + SL.bench.slabW(W, LX - 12, -12, LX - 4, 2, 18, 22, WOOD, toneI, .8) + SL.bench.slabW(W, LX + 4, -12, LX + 12, 2, 18, 22, WOOD, toneI, .8), 'STAND');
    // the loop: cork grip, glass rod, nichrome wire, the loop and what it carries
    const m = onLoop(p), bead = p.salt ? saltHex(metal(p, p.salt)) : null, CORKM = { l: '#d9a86c', m: '#b98546', d: '#7d5626' };
    const pieces = [[0, CORK, rod(W(...along(0)), W(...along(CORK)), 5.5, CORKM, toneI, 1, 5, 14)],
      [CORK, ROD, rod(W(...along(CORK)), W(...along(ROD)), 3, CLEAR, toneI, .9, 3, 12)]];
    for (const [d0, d1, svg] of pieces){ const b = LAB.aabb3([along(d0), along(d1)]); ctx.put([b[0].map(c => c - 6), b[1].map(c => c + 6)], svg, 'LOOP'); }
    // the wire and the loop (the loop lies in the vertical plane through the rod)
    const up = norm(cross(cross(DIR, [0, 0, 1]), DIR)), lc = along(WIRE);
    const loopPts = Array.from({ length: 14 }, (_, i) => { const a = i / 14 * 2 * Math.PI; return W(...[0, 1, 2].map(c => lc[c] + DIR[c] * LOOP_R * (1 + Math.cos(a)) + up[c] * LOOP_R * Math.sin(a))); });
    let w = `<path d="${pd([W(...along(ROD)), W(...along(WIRE))], false)}" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/><path d="${pd([W(...along(ROD)), W(...along(WIRE))], false)}" stroke="#c9cdd0" stroke-width=".9" stroke-linecap="round"/>`;
    if (bead) w += `<path d="${pd(loopPts)}" fill="${bead}" stroke="${INK}" stroke-width=".8"/>`;
    w += `<path d="${pd(loopPts)}" fill="none" stroke="${INK}" stroke-width="1.8"/><path d="${pd(loopPts)}" fill="none" stroke="${bead ? mix(bead, '#000000', .2) : '#d7dbde'}" stroke-width=".9"/>`;
    // two salts: specks of the earlier one on the bead
    if (m.length > 1) for (let i = 0; i < 4; i++){ const a = i * 1.7, [X, Y] = P(...[0, 1, 2].map(c => lc[c] + DIR[c] * LOOP_R * (1 + .6 * Math.cos(a)) + up[c] * LOOP_R * .6 * Math.sin(a)));
      w += `<circle cx="${f(X)}" cy="${f(Y)}" r=".9" fill="${p.carry === 'hand' ? '#c9b48a' : saltHex(metal(p, p.carry))}" stroke="${INK}" stroke-width=".3"/>`; }
    const wb = LAB.aabb3([along(ROD), TIP]);
    ctx.put([wb[0].map(c => c - 4), wb[1].map(c => c + 4)], w, 'LOOP');
    ctx.label(TIP, p.salt ? (m.length > 1 ? 'Two salts on the loop' : 'Salt on the loop') : p.clean ? 'Clean loop' : 'Loop not cleaned yet', !!p.salt && m.length < 2);
    ctx.label([ACID[0], ACID[1], 26], 'Acid for cleaning', false);
    ctx.label([...dishAt('unknown'), 6], 'Unknown salt', false);
  },
  stats: st => {
    const ft = FT[sampleOf(st.p)];
    return [
      { label: T('Loop'), value: st.p.salt ? (st.p.salt === 'unknown' ? '?' : FT[st.p.salt].print) : st.p.clean ? T('Clean') : T('Not cleaned') },
      { label: T('Flame colour'), value: ft ? T(ft.name) : T('None'), small: true },
    ];
  },
  reportKeys: ['sample', 'mixed', 'flameColour'],
  report: st => { const s = sampleOf(st.p); return { sample: s, mixed: onLoop(st.p).length > 1, flameColour: s ? FT[s].colour : null }; },
  mistake: st => st.p.salt && st.p.carry === 'hand' ? 'salt-before-clean'
    : st.p.salt && st.p.carry && st.p.carry !== st.p.salt && metal(st.p, st.p.carry) !== metal(st.p, st.p.salt) ? 'dirty-loop' : null,
  xrCaption: 'See-through: labels for the loop, the acid and the unknown',
  xr: {
    anchors: [
      { id: 'control:LOOP', kind: 'control', part: 'LOOP', at: along(CORK / 2).map(v => +v.toFixed(1)), normal: [0, 0, 1] },
      { id: 'label:LOOP', kind: 'label', part: 'LOOP', at: TIP.map(v => +v.toFixed(1)), normal: [0, 0, 1], text: 'Loop' },
      { id: 'port:ACID', kind: 'port', part: 'ACID', at: [ACID[0], ACID[1], ACID_H], normal: [0, 0, 1] },
      ...SALT_IDS.map(id => ({ id: `port:${PART(id)}`, kind: 'port', part: PART(id), at: [...dishAt(id), 5], normal: [0, 0, 1] })),
      ...SALT_IDS.map(id => ({ id: `label:${PART(id)}`, kind: 'label', part: PART(id), at: [dishAt(id)[0], dishAt(id)[1] - CARD, .7], normal: [0, 0, 1], text: id === 'unknown' ? '?' : FT[id].print })),
    ],
    channels: [],
    extras: {
      loop: { part: 'LOOP', axis: DIR.map(v => +v.toFixed(4)), cork: A0, tip: TIP.map(v => +v.toFixed(1)),
        bead: 'colour the loop tip with saltColor[report.sample] while params.salt is set; bare wire when it is null' },
      saltColor: Object.fromEntries(Object.keys(FT).map(k => [k, saltHex(k)])),
      flameTests: Object.fromEntries(Object.entries(FT).map(([k, v]) => [k, { hex: v.hex, colour: v.colour }])),
      toBurner: 'pass report.sample to bunsen-burner as its sample param while the loop is held in the flame',
    },
  },
  lab: {
    lab: 'chemistry',
    summary: 'A wire loop, seven known metal chlorides, one unknown and dilute acid. A clean loop dipped in a salt and held in a blue flame colours the flame by the metal.',
    safeUse: [
      'Wear goggles: the acid and some of the salts are harmful, and barium and copper salts are toxic.',
      'Clean the loop first: dip it in the acid, then hold it in a blue flame until it adds no colour.',
      'Clean it again between every two salts.',
      'Hold the loop at the edge of a blue flame, not in the yellow safety flame.',
      'Look at the first flash of colour: compare it with the known salts before you name the unknown.',
      'Rest the loop on its stand so the hot wire does not touch the bench.',
    ],
    mistakes: [
      { id: 'salt-before-clean', when: 'The loop touched a salt before it was ever cleaned in the acid.', say: 'The loop was not cleaned first, so it carries sodium from your fingers. Clean it in the acid and the flame, then dip again.' },
      { id: 'dirty-loop', when: 'The loop was dipped in a second salt without cleaning it after the first one.', say: 'The loop still carries the last salt, so the colour will be mixed, and sodium yellow hides the others. Clean it first.' },
    ],
    hazards: ['Hydrochloric acid irritates skin and eyes.', 'Barium and copper salts are toxic if swallowed.', 'The wire stays hot after the flame.', 'Long hair and sleeves near the flame catch fire.'],
  },
});
function cleanLoop(st, api){
  if (st.p.clean && !st.p.salt) return api.say('The loop is already clean');
  api.set('salt', null); api.set('carry', null); api.set('clean', true);
  api.say('Loop cleaned in the acid and burned clean in the flame');
}
function dip(st, api){
  const p = st.p, carry = p.clean ? null : p.salt || p.carry || 'hand';
  // carry first, then the salt, so no in-between state names a mistake that the end state does not hold
  api.set('clean', false); api.set('carry', carry); api.set('salt', p.dish);
  api.say('Loop dipped in {salt}', { salt: T(DISH_NAMES[p.dish]) });
}
})();
