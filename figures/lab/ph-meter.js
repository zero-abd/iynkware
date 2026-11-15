// @cf title pH meter
// @cf use engine/lab.list
/* A benchtop pH meter of the usual school and teaching-lab kind (the class of the Mettler Toledo FiveEasy and the
   Hanna HI2210): a meter 130 mm wide, 130 mm deep and 64 mm tall with an LCD (pH to 0.01 and the temperature), ON,
   CAL and READ keys and a BNC electrode socket; beside it a stand with a heavy base, a 230 mm post and a swing arm
   that holds a 12 mm combination glass electrode, 120 mm long, over a 100 mL beaker (ISO 3819: 50 mm across, 70 mm
   tall). In front stand the three calibration buffers, pH 4.00 (red), 7.00 (green) and 10.00 (blue), and behind, a
   wash bottle of distilled water; the electrode's storage cap (KCl solution) sits on its bulb when it is put away.
   How it behaves: the reading follows the liquid the electrode is in. Until it is calibrated (pH 7, then 4, then 10)
   the meter reads with the offset and slope error of an aged electrode, so it is wrong by up to about a unit. A drop
   of the last liquid carried over on an unrinsed electrode pulls the reading toward that liquid. Left out of its cap
   in the air, the glass bulb dries, which spoils it. Distilled water left in the open absorbs carbon dioxide and
   reads about pH 6.5, not 7. */
(() => {
const LAB = SL.lab, T = LAB.T;
const MX0 = -140, MX1 = -10, Y0 = -50, MY1 = 80, MH = 64;                  // the meter
const POST = [30, 60], BK = [30, -38], BK_R = 25, BK_H = 70;              // the stand's post and the sample beaker
const EL_L = 120, EL_R = 6, DIP_Z = 12, UP_Z = 95;                        // the electrode: length, radius, bulb bottom dipped and raised
const BOTTLES = { buffer4: { x: 76, col: '#e0483a', print: 'pH 4' }, buffer7: { x: 106, col: '#4fb35a', print: 'pH 7' }, buffer10: { x: 136, col: '#3f7fe0', print: 'pH 10' } };
const BOT_Y = -58, BOT_R = 14, BOT_H = 55, WASH = [112, 40];
const LIQUIDS = {
  none: { name: 'Nothing (in the air)', ph: null },
  water: { name: 'Distilled water', ph: 6.5, color: '#d6ebf4' },
  acid: { name: 'Dilute acid', ph: 3.0, color: '#f0e4c4' },
  base: { name: 'Dilute alkali', ph: 11.0, color: '#d9e6f6' },
  buffer4: { name: 'Buffer pH 4', ph: 4.0, color: '#ef8a80' },
  buffer7: { name: 'Buffer pH 7', ph: 7.0, color: '#8fd197' },
  buffer10: { name: 'Buffer pH 10', ph: 10.0, color: '#8fb4ef' },
};
const BOUT = [[BK_R - 2, 0], [BK_R, 2.5], [BK_R, BK_H - 2], [BK_R + .6, BK_H]], BIN = [[BK_R - 1.3, 2], [BK_R - 1.3, BK_H - .5]];
const LEVEL = LAB.levelFor(BIN, 65);
// the reading: the liquid's pH, pulled toward a carried-over liquid, through the electrode's error until calibrated
const truePH = p => LIQUIDS[p.liquid].ph;
const reading = (p, s) => {
  const ph = truePH(p);
  if (ph == null || !p.on) return null;
  let x = ph;
  if (s.carry && LIQUIDS[s.carry].ph != null) x += .15 * (LIQUIDS[s.carry].ph - x);
  if (!p.calibrated) x = 7 + (x - 7) * .82 + .45;
  return Math.round(x * 100) / 100;
};
const elZ = p => p.liquid === 'none' ? UP_Z : DIP_Z;   // the electrode bulb's bottom

LAB.item('ph-meter', {
  name: 'pH meter', fig: 'L10', foot: [300, 162, 245],
  params: {
    liquid: { label: 'Electrode in', values: Object.keys(LIQUIDS), names: Object.fromEntries(Object.entries(LIQUIDS).map(([k, v]) => [k, v.name])) },
    calibrated: { label: 'Calibrated', values: [false, true], picker: false },
    rinsed: { label: 'Rinsed', values: [true, false], picker: false },
    capped: { label: 'Storage cap on', values: [true, false], picker: false },
    on: { label: 'Power', values: [true, false], picker: false },
  },
  defaults: { liquid: 'none', calibrated: false, rinsed: true, capped: true, on: true },
  refuse: next => next.capped && next.liquid !== 'none' ? 'the storage cap is on: send capped: false to dip the electrode' : null,
  parts: Object.assign({
    METER: { name: 'Meter and display', role: 'body' },
    KEY_ON: { name: 'ON key', role: 'control', press: (st, api) => power(st, api) },
    KEY_CAL: { name: 'CAL key', role: 'control', press: (st, api) => calibrate(st, api) },
    STAND: { name: 'Electrode stand', role: 'body' },
    ELECTRODE: { name: 'pH electrode on its arm', role: 'control', press: (st, api) => dipOrLift(st, api) },
    CAP: { name: 'Storage cap', role: 'cover', press: (st, api) => cap(st, api) },
    BEAKER: { name: 'Sample beaker', role: 'body' },
    WASH: { name: 'Wash bottle (distilled water)', role: 'control', press: (st, api) => rinse(st, api) },
    CABLE: { name: 'Electrode cable', role: 'wire' },
  }, Object.fromEntries(Object.entries(BOTTLES).map(([k, b]) => ['BOTTLE_' + k.slice(6), { name: LIQUIDS[k].name, role: 'control', press: (st, api) => dipIn(st, api, k) }]))),
  actions: [
    { id: 'rinse', label: 'Rinse the electrode', run: (st, api) => rinse(st, api) },
    { id: 'calibrate', label: 'Calibrate', run: (st, api) => calibrate(st, api) },
    { id: 'cap', label: 'Storage cap on/off', run: (st, api) => cap(st, api) },
    { id: 'power', label: 'Power on/off', run: (st, api) => power(st, api) },
  ],
  init: st => { st.s.dryT = 0; st.s.carry = null; st.s.last = null; },
  onParam: (st, k, v, old, api, by) => {
    const s = st.s;
    if (k === 'liquid' && v !== 'none'){
      if (st.p.capped){ st.p.capped = false; if (by !== 'host') api.say('Storage cap taken off'); }
      // a liquid left on an unrinsed electrode is carried into the next one (distilled water carries nothing harmful)
      s.carry = !st.p.rinsed && s.last && s.last !== v && s.last !== 'water' ? s.last : null;
      s.last = v; st.p.rinsed = false;
    }
    if (k === 'rinsed' && v) s.carry = null;
    if (k === 'capped' || k === 'liquid') s.dryT = 0;
  },
  step: (st, dt) => { st.s.dryT = st.p.liquid === 'none' && !st.p.capped ? st.s.dryT + dt : 0; },
  live: st => st.p.liquid === 'none' && !st.p.capped && st.s.dryT < 11,
  draw(ctx){
    const { p, s, k } = ctx, W = ctx.W, front = vis(sub(W(0, -1, 0), W(0, 0, 0))), Ux = sub(W(1, 0, 0), W(0, 0, 0)), DOWN = [0, 0, -1];
    const txt = (x, y, z, str, size, col, weight = 800, anchor = 'middle') => front ? LAB.textOn(W(x, y, z), Ux, DOWN, str, size, col, weight, anchor) : '';
    const rd = reading(p, s), bz = elZ(p), armZ = bz + EL_L - 10;
    // the meter: a dark grey box with a light front panel
    ctx.shadow([W(MX0, Y0, 0), W(MX1, Y0, 0), W(MX1, MY1, 0), W(MX0, MY1, 0), W(MX0, Y0, MH), W(MX1, MY1, MH)]);
    let m = SL.bench.slabW(W, MX0, Y0 + 2, MX1, MY1, 0, MH, { l: '#5a6068', m: '#454a51', d: '#2c3035' }, toneI, 1.5) + SL.bench.slabW(W, MX0, Y0, MX1, Y0 + 2, 0, MH, { l: '#e8eaea', m: '#cfd2d2', d: '#929696' }, toneI, 1.1);
    m += LAB.plate(W, Y0 - .3, -130, 26, -46, 56, '#1c1d20', .8) + LAB.plate(W, Y0 - .4, -128, 28, -48, 54, p.on ? '#c9d6b0' : '#7b8270', .5);
    if (p.on){
      m += txt(-54, Y0 - .5, 35, rd == null ? '-.--' : rd.toFixed(2), 14, '#1d2414', 800, 'end') + txt(-124, Y0 - .5, 48, 'pH', 4.4, '#1d2414', 800, 'start');
      m += txt(-124, Y0 - .5, 30.5, '25.0 °C', 3, '#1d2414', 700, 'start') + txt(-52, Y0 - .5, 49, p.calibrated ? 'CAL 3' : 'UNCAL', 3, '#1d2414', 800, 'end');
    }
    m += txt(-75, Y0 - .5, 59.5, 'pH METER', 3.6, '#2b2f33') + txt(-24, Y0 - .5, 25, 'pH', 2.6, '#2b2f33');
    // the BNC socket the electrode cable plugs into
    m += LAB.bnc(W, -24, Y0, 36);
    ctx.put([[MX0, Y0 - 11, 0], [MX1, MY1, MH]], m, 'METER');
    for (const [id, x, label, col] of [['KEY_ON', -124, 'ON', '#e2483d'], ['KEY_CAL', -100, 'CAL', '#6b7178'], ['KEY_READ', -76, 'READ', '#6b7178']]){
      const s2 = SL.bench.slabW(W, x - 8, Y0 - 3, x + 8, Y0, 9, 17, matOf(col), toneI, .7) + txt(x, Y0 - 3.1, 11.8, label, 3, '#f6f3ea');
      ctx.put([[x - 8, Y0 - 3, 9], [x + 8, Y0, 17]], s2, id === 'KEY_READ' ? 'METER' : id);
    }
    // the stand: base plate, post, the arm's clamp and the arm out to the electrode
    const STEEL = LAB.M.steel, IRON = LAB.M.castIron;
    ctx.shadow([W(2, 30, 0), W(58, 30, 0), W(58, 80, 0), W(2, 80, 0), ...ctx.ring(POST[0], POST[1], 232, 6, 8)]);
    ctx.put([[2, 30, 0], [58, 80, 8]], SL.bench.slabW(W, 2, 30, 58, 80, 0, 8, IRON, toneI, 1.3), 'STAND');
    ctx.put([[POST[0] - 5, POST[1] - 5, 8], [POST[0] + 5, POST[1] + 5, 232]], rod(W(POST[0], POST[1], 8), W(POST[0], POST[1], 232), 5, STEEL, toneI, 1.1, 5, 14), 'STAND');
    let arm = SL.bench.slabW(W, POST[0] - 9, POST[1] - 9, POST[0] + 9, POST[1] + 9, armZ - 9, armZ + 9, LAB.M.blackPl, toneI, 1);
    arm += rod(W(POST[0], POST[1] - 9, armZ), W(BK[0], BK[1] + 9, armZ), 4, LAB.M.blackPl, toneI, 1, 4, 12);
    arm += SL.bench.slabW(W, BK[0] - 9, BK[1] - 9, BK[0] + 9, BK[1] + 9, armZ - 5, armZ + 5, LAB.M.blackPl, toneI, 1);
    ctx.put([[BK[0] - 9, BK[1] - 9, armZ - 9], [POST[0] + 9, POST[1] + 9, armZ + 9]], arm, 'ELECTRODE');
    // the electrode: black cap and body, a glass stem and the bulb at the bottom
    let el = rod(W(BK[0], BK[1], bz + EL_L), W(BK[0], BK[1], bz + EL_L - 18), EL_R, LAB.M.blackPl, toneI, 1, EL_R, 14);
    // the body is dark epoxy down to a short clear glass stem with the reference junction
    el += rod(W(BK[0], BK[1], bz + EL_L - 18), W(BK[0], BK[1], bz + 30), EL_R, { l: '#5d646c', m: '#474d54', d: '#2d3136' }, toneI, 1, EL_R, 14);
    el += rod(W(BK[0], BK[1], bz + 30), W(BK[0], BK[1], bz + 14), EL_R, { l: '#e6f0f3', m: '#c9dce2', d: '#8fa9b1' }, toneI, 1, EL_R * .9, 14);
    el += rod(W(BK[0], BK[1], bz + 14), W(BK[0], BK[1], bz + 2), 3.5, CLEAR, toneI, .9, 3.5, 12) + LAB.lathe(W, BK[0], BK[1], [[0, bz], [3.4, bz + 1.2], [4.4, bz + 4], [3.5, bz + 6]], { l: '#eef5f7', m: '#d3e4ea', d: '#9fb6be' }, toneI, .8, 12);
    if (front) el += txt(BK[0], BK[1] - EL_R - .2, bz + EL_L - 30, 'pH', 3, '#f2efe6', 800);
    ctx.put([[BK[0] - EL_R, BK[1] - EL_R, bz], [BK[0] + EL_R, BK[1] + EL_R, bz + EL_L]], el, 'ELECTRODE');
    // the storage cap: on the bulb, or standing on the stand's base
    const capAt = p.capped ? [BK[0], BK[1], bz - 2] : [16, 44, 8];
    ctx.put([[capAt[0] - 7.5, capAt[1] - 7.5, capAt[2]], [capAt[0] + 7.5, capAt[1] + 7.5, capAt[2] + 26]],
      LAB.lathe(W, capAt[0], capAt[1], [[7, capAt[2]], [7.5, capAt[2] + 2], [7.5, capAt[2] + 22], [6.5, capAt[2] + 26]], { l: '#6fa8f0', m: '#4a86d6', d: '#2a5794' }, toneI, 1, 14), 'CAP');
    // the cable from the electrode's top over to the meter's socket
    const c0 = [BK[0], BK[1], bz + EL_L], c1 = [BK[0] - 4, BK[1] - 2, bz + EL_L + 45], c2 = [-30, Y0 - 16, 95], c3 = [-24, Y0 - 11, 36];
    const cp = Array.from({ length: 13 }, (_, j) => { const u = j / 12, m0 = 1 - u; return [0, 1, 2].map(i => m0 * m0 * m0 * c0[i] + 3 * m0 * m0 * u * c1[i] + 3 * m0 * u * u * c2[i] + u * u * u * c3[i]); });
    for (let j = 0; j < 12; j++){ const bx = LAB.aabb3([cp[j], cp[j + 1]]);
      ctx.put([bx[0].map(q => q - 2), bx[1].map(q => q + 2)], rod(W(...cp[j]), W(...cp[j + 1]), 1.6, { l: '#4a4744', m: '#33302d', d: '#1e1c1a' }, toneI, .6, 1.6, 8), 'CABLE'); }
    // the sample beaker with what the electrode is in (or the last liquid, once it is lifted out)
    const shown = p.liquid !== 'none' ? p.liquid : s.last || 'water', Wb = (x, y, z) => W(BK[0] + x, BK[1] + y, z);
    ctx.shadow([...ctx.ring(BK[0], BK[1], 0, BK_R, 12), ...ctx.ring(BK[0], BK[1], BK_H, BK_R, 12)]);
    ctx.put([[BK[0] - BK_R, BK[1] - BK_R, 0], [BK[0] + BK_R, BK[1] + BK_R, BK_H]],
      LAB.glass(Wb, { outer: BOUT, inner: BIN, level: LEVEL, liquid: LIQUIDS[shown].color, marks: [], k, n: 22 }), 'BEAKER');
    // the buffer bottles: white bodies, coloured caps and labels
    for (const [kk, b] of Object.entries(BOTTLES)){
      ctx.shadow([...ctx.ring(b.x, BOT_Y, 0, BOT_R, 10), ...ctx.ring(b.x, BOT_Y, BOT_H + 10, 7, 8)]);
      let s2 = LAB.lathe(W, b.x, BOT_Y, [[BOT_R - 1, 0], [BOT_R, 2], [BOT_R, BOT_H - 8], [9, BOT_H - 2], [7, BOT_H]], { l: '#f6f4ee', m: '#e1ddd2', d: '#a9a497' }, toneI, 1.1, 16);
      s2 += LAB.lathe(W, b.x, BOT_Y, [[7.4, BOT_H], [7.4, BOT_H + 10], [6.8, BOT_H + 11]], matOf(b.col), toneI, 1, 14);
      if (front){ s2 += LAB.plate(W, BOT_Y - BOT_R - .2, b.x - 9, 18, b.x + 9, 34, b.col, .5) + txt(b.x, BOT_Y - BOT_R - .4, 24, b.print, 4.2, '#ffffff'); }
      ctx.put([[b.x - BOT_R, BOT_Y - BOT_R, 0], [b.x + BOT_R, BOT_Y + BOT_R, BOT_H + 11]], s2, 'BOTTLE_' + kk.slice(6));
    }
    // the wash bottle: a squeeze bottle with its bent nozzle
    ctx.shadow([...ctx.ring(WASH[0], WASH[1], 0, 22, 10), ...ctx.ring(WASH[0], WASH[1], 92, 8, 8)]);
    let wsh = LAB.lathe(W, WASH[0], WASH[1], [[21, 0], [22, 3], [22, 70], [12, 84], [8, 88]], { l: '#f1f4f6', m: '#d9e0e4', d: '#9faab0' }, toneI, 1.2, 18);
    wsh += LAB.lathe(W, WASH[0], WASH[1], [[9, 86], [9, 94], [3, 96]], { l: '#ffffff', m: '#e6e6e6', d: '#a5a5a5' }, toneI, .9, 12);
    wsh += rod(W(WASH[0], WASH[1], 96), W(WASH[0] - 4, WASH[1] - 4, 118), 1.6, { l: '#ffffff', m: '#e6e6e6', d: '#a5a5a5' }, toneI, .7, 1.6, 8) + rod(W(WASH[0] - 4, WASH[1] - 4, 118), W(WASH[0] - 18, WASH[1] - 18, 110), 1.6, { l: '#ffffff', m: '#e6e6e6', d: '#a5a5a5' }, toneI, .7, 1, 8);
    if (front) wsh += txt(WASH[0], WASH[1] - 22.3, 45, 'H₂O', 6, '#3a7bd5');
    ctx.put([[WASH[0] - 22, WASH[1] - 22, 0], [WASH[0] + 22, WASH[1] + 22, 118]], wsh, 'WASH');
    ctx.label([BK[0], BK[1], bz + 3], p.capped ? 'Bulb in its storage cap' : p.liquid === 'none' ? 'Glass bulb in the air' : 'Glass bulb', p.liquid === 'none' && !p.capped);
    ctx.label([-88, Y0, 42], p.calibrated ? 'Calibrated' : 'Not calibrated', !p.calibrated);
    ctx.label([BOTTLES.buffer7.x, BOT_Y, BOT_H], 'Calibration buffers', false);
  },
  stats: st => {
    const r = reading(st.p, st.s);
    return [
      { label: T('Reading'), value: r == null ? '-' : 'pH ' + r.toFixed(2) },
      { label: T('Calibrated'), value: st.p.calibrated ? T('Yes') : T('No'), small: true },
      { label: T('Electrode'), value: st.p.capped ? T('Capped') : st.p.liquid === 'none' ? T('In the air') : st.p.rinsed ? T('Rinsed') : T('Not rinsed'), small: true },
    ];
  },
  reportKeys: ['readingPH', 'truePH', 'carryOver', 'dryS'],
  report: st => ({ readingPH: reading(st.p, st.s), truePH: truePH(st.p), carryOver: st.p.liquid !== 'none' ? st.s.carry || null : null, dryS: Math.floor(st.s.dryT || 0) }),
  mistake: st => {
    const p = st.p, s = st.s;
    if (p.liquid !== 'none' && s.carry) return 'not-rinsed';
    if (p.on && !p.calibrated && ['water', 'acid', 'base'].includes(p.liquid)) return 'not-calibrated';
    if (p.liquid === 'none' && !p.capped && s.dryT > 10) return 'stored-dry';
    return null;
  },
  xrCaption: 'See-through: labels for the electrode bulb, the calibration and the buffers',
  xr: {
    anchors: [
      { id: 'screen:LCD', kind: 'screen', part: 'METER', at: [-88, Y0 - .4, 41], normal: [0, -1, 0], text: 'Display', rect: { origin: [-128, Y0 - .4, 54], u: [80, 0, 0], v: [0, 0, -26], pixels: [160, 52] } },
      { id: 'port:ELECTRODE', kind: 'port', part: 'METER', at: [-24, Y0 - 11, 36], normal: [0, -1, 0], aliases: ['BNC', 'INPUT'] },
      { id: 'control:ON', kind: 'control', part: 'KEY_ON', at: [-124, Y0 - 3, 13], normal: [0, -1, 0], channel: 'led:LCD' },
      { id: 'control:CAL', kind: 'control', part: 'KEY_CAL', at: [-100, Y0 - 3, 13], normal: [0, -1, 0] },
      { id: 'control:ELECTRODE', kind: 'control', part: 'ELECTRODE', at: [BK[0], BK[1], UP_Z + EL_L - 10], normal: [0, 0, 1], channel: 'lift:ELECTRODE' },
      { id: 'label:BULB', kind: 'label', part: 'ELECTRODE', at: [BK[0], BK[1], UP_Z + 3], normal: [0, -1, 0], text: 'Glass bulb', channel: 'lift:ELECTRODE' },
      { id: 'port:BEAKER', kind: 'port', part: 'BEAKER', at: [BK[0], BK[1], BK_H], normal: [0, 0, 1] },
      { id: 'control:WASH', kind: 'control', part: 'WASH', at: [WASH[0], WASH[1], 60], normal: [0, -1, 0] },
      ...Object.entries(BOTTLES).map(([kk, b]) => ({ id: `control:BOTTLE_${kk.slice(6)}`, kind: 'control', part: 'BOTTLE_' + kk.slice(6), at: [b.x, BOT_Y - BOT_R, 30], normal: [0, -1, 0], text: b.print })),
    ],
    channels: [
      // the arm and electrode slide up the post together: raised (1) when it is in no liquid, lowered into the beaker (0)
      { id: 'lift:ELECTRODE', kind: 'translate', part: 'ELECTRODE', value: { unit: 'press', min: 0, max: 1, rest: 1 }, axis: [0, 0, 1], scale: (UP_Z - DIP_Z) / 1000,
        bind: { source: 'param', key: 'liquid' }, extras: { press: Object.fromEntries(Object.keys(LIQUIDS).map(kk => [kk, kk === 'none' ? 1 : 0])) } },
      { id: 'led:LCD', kind: 'emissive', part: 'METER', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: '#c9d6b0', bind: { source: 'param', key: 'on' } },
    ],
    extras: {
      liquid: { part: 'BEAKER', bind: { source: 'param', key: 'liquid' }, inner: BIN, levelMm: +LEVEL.toFixed(1), colors: Object.fromEntries(Object.entries(LIQUIDS).filter(([, v]) => v.color).map(([kk, v]) => [kk, v.color])) },
      cap: { part: 'CAP', onBulb: [BK[0], BK[1], 'bulb - 2'], parked: [16, 44, 8], bind: { source: 'param', key: 'capped' } },
      pH: Object.fromEntries(Object.entries(LIQUIDS).map(([kk, v]) => [kk, v.ph])),
      readout: 'report.readingPH to 2 decimals and 25.0 °C; "-.--" when null',
    },
  },
  lab: {
    lab: 'chemistry',
    summary: 'A pH meter reads how acidic or alkaline a liquid is from a glass electrode. It must be calibrated with buffers first, and the electrode rinsed between liquids.',
    safeUse: [
      'Calibrate it before you measure: pH 7 buffer first, then 4, then 10.',
      'Rinse the electrode with distilled water between every two liquids, and dab it dry with a tissue; never wipe the bulb.',
      'Dip the bulb fully and wait for the reading to settle.',
      'Never let the bulb touch the bottom or sides of the beaker: the glass is thin.',
      'When you finish, rinse it and put the storage cap back on.',
      'Wear goggles with acids and alkalis.',
    ],
    mistakes: [
      { id: 'not-rinsed', when: 'The electrode went from one liquid into the next without being rinsed.', say: 'The electrode was not rinsed, so the last liquid is spoiling this reading. Rinse it with distilled water first.' },
      { id: 'not-calibrated', when: 'A sample (water, acid or alkali) is being measured before the meter was calibrated.', say: 'The meter is not calibrated, so this reading can be a whole unit out. Calibrate it with the pH 7, 4 and 10 buffers first.' },
      { id: 'stored-dry', when: 'The electrode has been out of any liquid and out of its storage cap for over 10 seconds.', say: 'The electrode is drying out in the air, which spoils the glass bulb. Put its storage cap back on.' },
    ],
    hazards: ['Acids and alkalis harm skin and eyes.', 'The glass bulb breaks easily and can cut.'],
  },
});
function power(st, api){ api.set('on', !st.p.on); api.say(st.p.on ? 'Meter on' : 'Meter off'); }
function rinse(st, api){
  if (st.p.capped) return api.say('Take the storage cap off first');
  api.set('liquid', 'none'); api.set('rinsed', true); api.say('Electrode rinsed with distilled water and dabbed dry');
}
function calibrate(st, api){
  if (!st.p.on) return api.say('The meter is off: press Power first');
  // the three-point routine, rinsing between buffers; it ends with the electrode in the pH 10 buffer
  if (st.p.capped) api.set('capped', false);
  api.set('rinsed', true); api.set('liquid', 'buffer10'); api.set('calibrated', true);
  api.say('Calibrated with pH 7, 4 and 10. Rinse the electrode before you measure');
}
function cap(st, api){
  if (st.p.capped){ api.set('capped', false); return api.say('Storage cap off'); }
  if (st.p.liquid !== 'none') api.set('liquid', 'none');
  api.set('capped', true); api.say('Storage cap on');
}
function dipIn(st, api, liquid){ api.set('liquid', liquid); api.say('{part} is now {value}', { part: T('Electrode in'), value: T(LIQUIDS[liquid].name) }); }
function dipOrLift(st, api){ if (st.p.liquid === 'none') dipIn(st, api, st.s.last || 'water'); else { api.set('liquid', 'none'); api.say('Electrode lifted out'); } }
})();
