// @cf title Digital balance
// @cf use engine/lab.list
/* A 0.01 g top-pan balance of the usual school kind (the class of the Ohaus Scout STX 402: about 200 mm wide,
   230 mm deep and 60 mm tall, a 120 mm stainless pan, 400 g by 0.01 g), with its LCD and ON/OFF and TARE keys on the
   front edge. On the pan: nothing, a medium polystyrene weighing boat (89 mm square, 1.82 g) or the boat with a heap
   of sodium chloride (the sample, 5.00 g unless the host says otherwise).
   TARE sets the zero to whatever is on the pan, so the reading is the pan's load minus the tare. Weighing the sample
   in a boat without taring the empty boat first reads the boat too; taring with the sample already in it reads 0. */
(() => {
const LAB = SL.lab, T = LAB.T;
const BW = 200, BH = 60, Y0 = -115, Y1 = 115, PAN = [0, 20], PAN_R = 60, PAN_Z = BH + 8, BOAT = 1.82;
const BODY = { l: '#eeeeea', m: '#d6d6d0', d: '#9d9d96' };
const PANS = { empty: 'Nothing', boat: 'Empty weighing boat', 'boat-sample': 'Boat with the sample' };
const massOf = p => p.pan === 'empty' ? 0 : p.pan === 'boat' ? BOAT : BOAT + p.sampleG;
const readG = p => p.on ? Math.round((massOf(p) - p.tareG) * 100) / 100 : null;

LAB.item('digital-balance', {
  name: 'Digital balance', fig: 'L11', foot: [BW + 10, Y1 * 2 + 2, PAN_Z + 22],
  params: {
    pan: { label: 'On the pan', values: Object.keys(PANS), names: PANS },
    sampleG: { label: 'Sample', values: [2.5, 5, 10], range: [0, 398], unit: 'g', show: v => v.toFixed(2) + ' g' },
    tareG: { label: 'Tare', values: [0, BOAT], range: [0, 400], unit: 'g', picker: false },
    on: { label: 'Power', values: [true, false], picker: false },
  },
  defaults: { pan: 'empty', sampleG: 5, tareG: 0, on: true },
  parts: {
    BODY: { name: 'Balance and display', role: 'body' },
    PAN: { name: 'Weighing pan', role: 'body' },
    BOAT: { name: 'Weighing boat and sample', role: 'body' },
    TARE: { name: 'TARE key', role: 'control', press: (st, api) => tare(st, api) },
    POWER: { name: 'ON/OFF key', role: 'control', press: (st, api) => power(st, api) },
  },
  actions: [
    { id: 'tare', label: 'Tare (zero)', run: (st, api) => tare(st, api) },
    { id: 'power', label: 'Power on/off', run: (st, api) => power(st, api) },
  ],
  onParam: (st, k, v) => { if (k === 'on' && v) st.p.tareG = massOf(st.p); },
  draw(ctx){
    const { p, k } = ctx, W = ctx.W, front = vis(sub(W(0, -1, 0), W(0, 0, 0))), Ux = sub(W(1, 0, 0), W(0, 0, 0));
    // the front face slopes back: from the bench edge (y = Y0, z 0..24) up to the deck (y = Y0 + 24, z = BH)
    const FY = Y0 + 24, slopeV = norm(sub(W(0, FY, BH), W(0, Y0, 24)));
    const onSlope = (x, u) => [x, Y0 + (FY - Y0) * u, 24 + (BH - 24) * u];   // u 0..1 up the slope
    const stxt = (x, u, str, size, col, weight = 800, anchor = 'middle') => vis(sub(W(0, -1, 1), W(0, 0, 0))) ? LAB.textOn(W(...onSlope(x, u)), Ux, slopeV.map(v => -v), str, size, col, weight, anchor) : '';
    ctx.shadow([W(-BW / 2, Y0, 0), W(BW / 2, Y0, 0), W(BW / 2, Y1, 0), W(-BW / 2, Y1, 0), W(-BW / 2, Y1, BH), W(BW / 2, Y1, BH), W(-BW / 2, FY, BH), W(BW / 2, FY, BH)]);
    // the body: a box from the deck back, and the sloped front with the display and keys
    ctx.put([[-BW / 2, FY, 0], [BW / 2, Y1, BH]], SL.bench.slabW(W, -BW / 2, FY, BW / 2, Y1, 0, BH, BODY, toneI, 1.5), 'BODY');
    let b = SL.bench.slabW(W, -BW / 2, Y0, BW / 2, FY, 0, 24, BODY, toneI, 1.3);
    const sl = [W(-BW / 2, Y0, 24), W(BW / 2, Y0, 24), W(BW / 2, FY, BH), W(-BW / 2, FY, BH)];
    if (vis(sub(W(0, -1, 1), W(0, 0, 0)))) b += shape(sl, toneI(norm([0, -1, 1]), BODY), 1.2);
    for (const side of [-1, 1]){ const sd = [W(side * BW / 2, Y0, 24), W(side * BW / 2, FY, BH), W(side * BW / 2, FY, 24)];
      if (vis(sub(W(side, 0, 0), W(0, 0, 0)))) b += shape(sd, toneI([side, 0, 0], BODY), 1); }
    const quad = (x0, u0, x1, u1, col, w = .6) => shape([W(...onSlope(x0, u0)), W(...onSlope(x1, u0)), W(...onSlope(x1, u1)), W(...onSlope(x0, u1))], col, w);
    b += quad(-50, .15, 40, .85, '#1c1d20', .8) + quad(-48, .2, 38, .8, p.on ? '#c9d6b0' : '#7b8270', .5);
    const r = readG(p);
    if (p.on){ b += stxt(30, .32, (r < 0 ? '-' : '') + Math.abs(r).toFixed(2), 11, '#1d2414', 800, 'end') + stxt(35, .34, 'g', 4, '#1d2414', 800, 'start');
      if (Math.abs(p.tareG) > .001) b += stxt(-45, .7, 'NET', 3, '#1d2414', 800, 'start'); }
    b += stxt(-80, .55, '400 g × 0.01 g', 2.6, '#55524b', 700);
    ctx.put([[-BW / 2, Y0, 0], [BW / 2, FY, BH]], b, 'BODY');
    for (const [id, x, label, col] of [['POWER', -78, 'ON/OFF', '#6b7178'], ['TARE', 70, 'TARE', '#2f7fd8']]){
      const s = quad(x - 12, .25, x + 12, .65, col, .7) + stxt(x, .52, label, 3, '#ffffff');
      ctx.put([[x - 12, Y0 + 5, 30], [x + 12, Y0 + 17, 48]], s, id);
    }
    // the pan: a stainless disc on its spider
    ctx.shadow([...ctx.ring(PAN[0], PAN[1], BH, PAN_R, 16), ...ctx.ring(PAN[0], PAN[1], PAN_Z, PAN_R, 16)]);
    ctx.put([[PAN[0] - PAN_R, PAN[1] - PAN_R, BH], [PAN[0] + PAN_R, PAN[1] + PAN_R, PAN_Z]],
      LAB.lathe(W, PAN[0], PAN[1], [[8, BH], [8, PAN_Z - 2.5], [PAN_R - 1, PAN_Z - 2], [PAN_R, PAN_Z - .8], [PAN_R - 2, PAN_Z]], LAB.M.steel, toneI, 1.2, 28), 'PAN');
    // the boat: a shallow square tray, the sample a white heap in it
    if (p.pan !== 'empty'){
      const z0 = PAN_Z, h = 22, t = 44.5, bt = 30, BOATM = { l: '#fbfbf8', m: '#e6e6df', d: '#a9a9a0' };
      const ring = (hw, z) => [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]].map(([x, y]) => W(PAN[0] + x, PAN[1] + y, z));
      const lo = ring(bt, z0), hi = ring(t, z0 + h);
      // translucent white polystyrene: the far walls seen from inside, the floor, the sample, then the near walls
      let s = loft(lo, hi, nr => toneI(nr, BOATM), true);
      if (vis([0, 0, 1])) s += fill(pd(lo), mix(BOATM.m, '#ffffff', .2)) + `<path d="${pd(lo)}" fill="none" stroke="${BOATM.d}" stroke-width=".6"/>`;
      if (p.pan === 'boat-sample'){ const rr = 10 + 6 * Math.min(1, p.sampleG / 10);
        s += LAB.lathe(W, PAN[0], PAN[1], [[rr, z0 + .5], [rr * .7, z0 + 4], [rr * .35, z0 + 7], [.5, z0 + 8]], matOf('#f4f2ec'), toneI, .8, 14); }
      s += `<g opacity=".45">${loft(lo, hi, nr => toneI(nr, BOATM))}</g>`;
      s += `<path d="${pd(hi)}" fill="none" stroke="${INK}" stroke-width="1.1"/>` + hullInk([...lo, ...hi], 1.2);
      ctx.put([[PAN[0] - t, PAN[1] - t, z0], [PAN[0] + t, PAN[1] + t, z0 + h]], s, 'BOAT');
    }
    ctx.label([PAN[0], PAN[1], PAN_Z + 4], p.pan === 'empty' ? 'Empty pan' : p.pan === 'boat' ? 'Boat only' : 'Boat and sample', p.pan !== 'empty');
    ctx.label([70, Y0 + 10, 40], 'TARE sets the zero', Math.abs(p.tareG) > .001);
  },
  stats: st => [
    { label: T('Reading'), value: st.p.on ? readG(st.p).toFixed(2) + ' g' : '-' },
    { label: T('On the pan'), value: massOf(st.p).toFixed(2) + ' g', small: true },
    { label: T('Tare'), value: st.p.tareG.toFixed(2) + ' g', small: true },
  ],
  reportKeys: ['readingG', 'massG', 'net'],
  report: st => ({ readingG: readG(st.p), massG: Math.round(massOf(st.p) * 100) / 100, net: Math.abs(st.p.tareG) > .001 }),
  mistake: st => {
    const p = st.p;
    if (!p.on || p.pan !== 'boat-sample') return null;
    if (p.tareG < BOAT - .005) return 'no-tare';
    if (p.tareG > BOAT + .005) return 'tared-with-sample';
    return null;
  },
  xrCaption: 'See-through: labels for the pan and the TARE key',
  xr: {
    anchors: [
      { id: 'screen:LCD', kind: 'screen', part: 'BODY', at: onSlopeAt(-5, .5), normal: [0, -.707, .707], text: 'Display',
        rect: { origin: onSlopeAt(-48, .8), u: [86, 0, 0], v: [0, -.6 * 24, -.6 * (BH - 24)], pixels: [192, 64] } },
      { id: 'control:TARE', kind: 'control', part: 'TARE', at: onSlopeAt(70, .45), normal: [0, -.707, .707], channel: 'press:TARE' },
      { id: 'control:POWER', kind: 'control', part: 'POWER', at: onSlopeAt(-78, .45), normal: [0, -.707, .707], channel: 'led:LCD' },
      { id: 'label:PAN', kind: 'label', part: 'PAN', at: [PAN[0], PAN[1], PAN_Z], normal: [0, 0, 1], text: 'Pan' },
    ],
    channels: [
      { id: 'led:LCD', kind: 'emissive', part: 'BODY', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: '#c9d6b0', bind: { source: 'param', key: 'on' } },
      { id: 'press:TARE', kind: 'translate', part: 'TARE', value: { unit: 'press', min: 0, max: 1, rest: 0 }, axis: [0, .707, -.707], scale: .001, bind: { source: 'press', key: 'tare' } },
    ],
    extras: { panMassG: { empty: 0, boat: BOAT, 'boat-sample': `${BOAT} + sampleG` }, boat: { part: 'BOAT', shownWhen: 'params.pan !== "empty"' },
      readout: 'report.readingG to 2 decimals and "g"; "NET" while report.net' },
  },
  lab: {
    lab: 'chemistry',
    summary: 'A balance that weighs to 0.01 g. TARE sets the zero, so put the empty boat on, press TARE, then add the sample.',
    safeUse: [
      'Stand it level, on a steady bench away from draughts.',
      'Put the empty weighing boat on the pan and press TARE before you add the sample.',
      'Add the sample with a spatula, off to the side of the balance, not over it.',
      'Wait for the reading to settle before you write it down.',
      'Never put anything hot, wet or heavier than 400 g on the pan.',
    ],
    mistakes: [
      { id: 'no-tare', when: 'The sample is weighed in the boat without the empty boat having been tared.', say: 'You did not tare the empty boat, so the reading includes the boat. Take the sample out, tare the empty boat, then weigh again.' },
      { id: 'tared-with-sample', when: 'TARE was pressed with the sample already in the boat.', say: 'You pressed TARE with the sample in the boat, so it reads zero. Tare the empty boat, then add the sample.' },
    ],
    hazards: ['Spilt chemicals on the pan corrode it and spoil later readings.'],
  },
});
function onSlopeAt(x, u){ return [x, +(Y0 + 24 * u).toFixed(1), +(24 + (BH - 24) * u).toFixed(1)]; }
function tare(st, api){ if (!st.p.on) return api.say('The balance is off: press Power first'); api.set('tareG', Math.round(massOf(st.p) * 100) / 100); api.say('Tared: it reads 0.00 g'); }
function power(st, api){ api.set('on', !st.p.on); api.say(st.p.on ? 'Balance on: it zeroes itself' : 'Balance off'); }
})();
