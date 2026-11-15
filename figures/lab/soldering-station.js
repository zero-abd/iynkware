// @cf title Soldering station
// @cf use engine/lab.list
/* A temperature-controlled soldering station of the usual hobby kind (about 60 W): a control box 80 mm wide,
   140 mm deep and 95 mm tall with a temperature dial (200-480 °C), a red HEAT lamp that lights while the element
   heats, a power rocker and the iron's socket; beside it a weighted stand with a cone-shaped steel spring that holds
   the iron, and a tray with a cellulose cleaning sponge. The iron's tip warms toward the set temperature in about
   20 s and cools slowly off. A tip at 350 °C does not glow: it looks exactly like a cold one. */
(() => {
const LAB = SL.lab, T = LAB.T;
const BOX = [-92, -60, -12, 80], BOX_H = 95, DIAL = [-52, 52], STAND = [42, 25];
const BLUE = { l: '#4f86c9', m: '#3a6ba8', d: '#24476f' }, YELLOW = { l: '#f3d36a', m: '#d8b444', d: '#957a22' };
const TEMPS = [200, 250, 300, 330, 350, 400, 450];
const dialDeg = c => -135 + 270 * (c - 200) / 280;
// the iron's axis: in the stand (tip down in the spring) or held up in a hand over the front of the mat
const ironAxis = inHolder => inHolder
  ? { tip: [STAND[0], STAND[1] - 30, 14], mid: [STAND[0], STAND[1] + 8, 46], end: [STAND[0], STAND[1] + 52, 84] }
  : { tip: [20, -92, 30], mid: [36, -62, 60], end: [56, -24, 100] };
const at = (a, b, u) => [0, 1, 2].map(c => a[c] + (b[c] - a[c]) * u);

LAB.item('soldering-station', {
  name: 'Soldering station', fig: 'L6', foot: [200, 230, 130],
  params: {
    tempSet: { label: 'Temperature', values: TEMPS, range: [200, 480], unit: '°C', show: v => v + ' °C' },
    sponge: { label: 'Sponge', values: ['damp', 'dry'], names: { damp: 'Damp', dry: 'Dry' } },
    on: { label: 'Power', values: [false, true], picker: false },
    inHolder: { label: 'Iron in its stand', values: [true, false], picker: false },
  },
  defaults: { tempSet: 330, sponge: 'damp', on: false, inHolder: true },
  parts: {
    STATION: { name: 'Control box', role: 'body' },
    DIAL: { name: 'Temperature dial', role: 'control', press: (st, api) => { const i = TEMPS.indexOf(st.p.tempSet), next = TEMPS[(i + 1) % TEMPS.length];
      api.set('tempSet', next); api.say('{part} is now {value}', { part: T('Temperature'), value: next + ' °C' }); } },
    POWER: { name: 'Power switch', role: 'control', press: (st, api) => power(st, api) },
    STAND: { name: 'Iron stand and sponge', role: 'body' },
    IRON: { name: 'Soldering iron', role: 'control', press: (st, api) => pick(st, api) },
    CABLE: { name: 'Iron cable', role: 'wire' },
  },
  actions: [
    { id: 'power', label: 'Power on/off', run: (st, api) => power(st, api) },
    { id: 'iron', label: 'Pick up / put back', run: (st, api) => pick(st, api) },
  ],
  init: st => { st.s.tip = 22; st.s.outT = 0; },
  onParam: (st, k) => { if (k === 'inHolder' || k === 'on') st.s.outT = 0; },
  step: (st, dt) => {
    const s = st.s, target = st.p.on ? st.p.tempSet : 22;
    s.tip += (target - s.tip) * (1 - Math.exp(-dt / (st.p.on && target > s.tip ? 6 : 40)));
    s.outT = st.p.on && !st.p.inHolder ? s.outT + dt : 0;
  },
  live: st => st.p.on || st.s.tip > 25 || !st.p.inHolder,
  draw(ctx){
    const { p, s, k, t } = ctx, W = ctx.W, front = vis(sub(W(0, -1, 0), W(0, 0, 0))), Ux = sub(W(1, 0, 0), W(0, 0, 0));
    const heating = p.on && s.tip < p.tempSet - 3;
    const [x0, y0, x1, y1] = BOX;
    ctx.shadow([W(x0, y0, 0), W(x1, y0, 0), W(x1, y1, 0), W(x0, y1, 0), W(x0, y0, BOX_H), W(x1, y1, BOX_H)]);
    ctx.shadow([...ctx.ring(STAND[0], STAND[1], 0, 34, 12), W(...ironAxis(p.inHolder).end)]);
    // the box: dark grey with a blue front, the maker's printing, the HEAT lamp and the socket
    let body = SL.bench.slabW(W, x0, y0 + 2, x1, y1, 0, BOX_H, LAB.M.blackPl, toneI, 1.6) + SL.bench.slabW(W, x0, y0, x1, y0 + 2, 0, BOX_H, BLUE, toneI, 1.2);
    const txt = (x, z, str, size) => front ? LAB.textOn(W(x, y0 - .4, z), Ux, [0, 0, -1], str, size, '#f2efe6', 700) : '';
    body += txt((x0 + x1) / 2, 84, 'SOLDERING STATION', 3.4) + txt(DIAL[0], 28, '200  °C  480', 3) + txt(-28, 72, 'HEAT', 2.8);
    const lamp = Array.from({ length: 10 }, (_, i) => { const a = i / 10 * 2 * Math.PI; return W(-28 + 2.2 * Math.cos(a), y0 - .4, 78 + 2.2 * Math.sin(a)); });
    body += shape(lamp, heating ? '#ff4b33' : '#5a2a24', .5);
    if (heating && front){ const [X, Y] = P(...W(-28, y0 - .5, 78)); body += `<circle cx="${f(X)}" cy="${f(Y)}" r="6" fill="#ff4b33" opacity=".3"/>`; }
    for (let c = 200; c <= 480; c += 40){ const a = dialDeg(c) * Math.PI / 180;
      body += front ? `<path d="${pd([W(DIAL[0] + 15 * Math.sin(a), y0 - .4, DIAL[1] + 15 * Math.cos(a)), W(DIAL[0] + 18 * Math.sin(a), y0 - .4, DIAL[1] + 18 * Math.cos(a))], false)}" stroke="#f2efe6" stroke-width=".9"/>` : ''; }
    body += rod(W(-28, y0, 20), W(-28, y0 - 6, 20), 6, LAB.M.steel, toneI, .8, 6, 14);
    ctx.put([[x0, y0, 0], [x1, y1, BOX_H]], body, 'STATION');
    // dial knob, turned by the setting
    const a = dialDeg(p.tempSet) * Math.PI / 180, face = y0 - 11;
    let dial = rod(W(DIAL[0], y0, DIAL[1]), W(DIAL[0], face, DIAL[1]), 12, LAB.M.blackPl, toneI, 1.1, 10.5, 20);
    if (front) dial += `<path d="${pd([W(DIAL[0], face - .2, DIAL[1]), W(DIAL[0] + 9 * Math.sin(a), face - .2, DIAL[1] + 9 * Math.cos(a))], false)}" stroke="#f6f1e3" stroke-width="1.8" stroke-linecap="round"/>`;
    ctx.put([[DIAL[0] - 12, face, DIAL[1] - 12], [DIAL[0] + 12, y0, DIAL[1] + 12]], dial, 'DIAL');
    const lit = p.on ? { l: '#ff6a55', m: '#e2483d', d: '#9a2a20' } : { l: '#9a3a32', m: '#7a2c26', d: '#4e1c18' };
    ctx.put([[-82, y0 - 4, 10], [-68, y0, 24]], SL.bench.slabW(W, -82, y0 - 3, -68, y0, 10, 24, LAB.M.blackPl, toneI, .8) + SL.bench.slabW(W, -80, y0 - 4, -70, y0 - 3, 12, 22, lit, toneI, .6), 'POWER');
    // the stand: a weighted dish, the sponge tray in front of it, and the coil spring
    let stand = LAB.lathe(W, STAND[0], STAND[1], [[34, 0], [34, 6], [30, 9]], LAB.M.blackPl, toneI, 1.4, 24);
    stand += SL.bench.slabW(W, STAND[0] - 24, STAND[1] - 62, STAND[0] + 24, STAND[1] - 30, 0, 6, LAB.M.blackPl, toneI, 1);
    stand += SL.bench.slabW(W, STAND[0] - 20, STAND[1] - 59, STAND[0] + 20, STAND[1] - 33, 6, 10, p.sponge === 'damp' ? YELLOW : { l: '#f4e7b8', m: '#ddcc90', d: '#a5965f' }, toneI, .7);
    // the spring: a cone of coil along the holder axis, from 6 mm across at the bottom to 15 at the mouth
    const sa = [STAND[0], STAND[1] - 24, 16], sb = [STAND[0], STAND[1] + 32, 70], ax = norm(sub(sb, sa)), u = norm(cross(ax, [1, 0, 0])), v = cross(ax, u);
    const coil = Array.from({ length: 73 }, (_, i) => { const q = i / 72, ang = q * 12 * 2 * Math.PI, r = 6 + 9 * q, c = at(sa, sb, q);
      return W(c[0] + (u[0] * Math.cos(ang) + v[0] * Math.sin(ang)) * r, c[1] + (u[1] * Math.cos(ang) + v[1] * Math.sin(ang)) * r, c[2] + (u[2] * Math.cos(ang) + v[2] * Math.sin(ang)) * r); });
    stand += rod(W(STAND[0], STAND[1] - 4, 8), W(...sa), 2, LAB.M.steel, toneI, .7, 2, 8);
    stand += `<path d="${pd(coil, false)}" fill="none" stroke="${INK}" stroke-width="2.2"/><path d="${pd(coil, false)}" fill="none" stroke="#dfe4e4" stroke-width="1.1"/>`;
    ctx.put([[STAND[0] - 34, STAND[1] - 62, 0], [STAND[0] + 34, STAND[1] + 47, 82]], stand, 'STAND');
    // the iron: steel tip, hot barrel, blue grip; in the stand it lies along the spring's axis
    const ia = ironAxis(p.inHolder), tipEnd = at(ia.tip, ia.mid, .35), grip0 = at(ia.mid, ia.end, .15);
    const hot = Math.min(1, Math.max(0, (s.tip - 60) / 300));
    let iron = rod(W(...ia.tip), W(...tipEnd), .8, LAB.M.steel, toneI, .7, 2.2, 10) + rod(W(...tipEnd), W(...grip0), 3.2, { l: mix('#e9ecec', '#c79a6a', hot), m: mix('#bcc3c5', '#a5784b', hot), d: '#7f888b' }, toneI, .9, 3.2, 12)
      + rod(W(...grip0), W(...ia.end), 7, BLUE, toneI, 1.2, 6, 16);
    if (s.tip > 150){ const ph = (t * .8) % 1; const [X, Y] = P(...W(...at(ia.tip, tipEnd, .3)));
      iron += `<path d="M${f(X - 3)} ${f(Y - 4 - ph * 6)}q3 -4 0 -8M${f(X + 3)} ${f(Y - 6 - ph * 6)}q3 -4 0 -8" fill="none" stroke="#b9b2a4" stroke-width="1" opacity="${f(.7 * (1 - ph))}"/>`; }
    const ib = LAB.aabb3([ia.tip, ia.end]);
    ctx.put([ib[0].map(c => c - 7), ib[1].map(c => c + 7)], iron, 'IRON');
    // the cable: from the socket, along the mat, up to the end of the grip
    const c0 = [-28, y0 - 6, 20], c3 = ia.end, mid = [(c0[0] + c3[0]) / 2, Math.min(c0[1], c3[1]) - 20, 2];
    const cp = Array.from({ length: 11 }, (_, j) => { const q = j / 10, r = 1 - q; return [0, 1, 2].map(c => r * r * c0[c] + 2 * q * r * mid[c] + q * q * c3[c]); });
    for (let j = 0; j < 10; j++){ const bx = LAB.aabb3([cp[j], cp[j + 1]]);
      ctx.put([bx[0].map(c => c - 2), bx[1].map(c => c + 2)], rod(W(...cp[j]), W(...cp[j + 1]), 2, { l: '#5a5550', m: '#3a3632', d: '#24221f' }, toneI, .6, 2, 8), 'CABLE'); }
    ctx.label(ia.tip, s.tip > 50 ? 'Hot tip: it does not glow' : 'Tip', s.tip > 50);
    ctx.label([STAND[0], STAND[1] - 46, 10], p.sponge === 'damp' ? 'Damp sponge' : 'Dry sponge', p.sponge === 'damp');
    ctx.label([DIAL[0], y0 - 11, DIAL[1]], 'Temperature dial', false);
  },
  stats: st => [
    { label: T('Tip'), value: Math.round(st.s.tip) + ' °C' },
    { label: T('Set'), value: st.p.tempSet + ' °C', small: true },
    { label: T('Power'), value: st.p.on ? T('ON') : T('OFF'), small: true },
  ],
  reportKeys: ['tipC', 'heating'],
  report: st => ({ tipC: Math.round(st.s.tip / 10) * 10, heating: !!(st.p.on && st.s.tip < st.p.tempSet - 3) }),
  mistake: st => !st.p.on ? null
    : !st.p.inHolder && st.s.outT > 15 ? 'iron-left-out'
    : st.p.tempSet >= 400 ? 'too-hot'
    : st.p.sponge === 'dry' ? 'dry-sponge' : null,
  xrCaption: 'See-through: labels for the tip, the dial and the sponge',
  xr: {
    anchors: [
      { id: 'control:DIAL', kind: 'control', part: 'DIAL', at: [DIAL[0], BOX[1] - 11, DIAL[1]], normal: [0, -1, 0], channel: 'turn:DIAL' },
      { id: 'control:POWER', kind: 'control', part: 'POWER', at: [-75, BOX[1] - 4, 17], normal: [0, -1, 0], channel: 'led:POWER' },
      { id: 'led:HEAT', kind: 'led', part: 'STATION', at: [-28, BOX[1] - .4, 78], normal: [0, -1, 0], channel: 'led:HEAT' },
      { id: 'control:IRON', kind: 'control', part: 'IRON', at: ironAxis(true).end, normal: [0, 0, 1] },
      { id: 'label:TIP', kind: 'label', part: 'IRON', at: ironAxis(true).tip, normal: [0, -1, 0], text: 'Tip' },
    ],
    channels: [
      { id: 'turn:DIAL', kind: 'rotate', part: 'DIAL', value: { unit: 'deg', min: -135, max: 135, rest: dialDeg(330) }, axis: [0, 1, 0], pivot: [DIAL[0], BOX[1], DIAL[1]], scale: Math.PI / 180,
        bind: { source: 'param', key: 'tempSet' }, extras: { degAt200: -135, degPerC: 270 / 280 } },
      { id: 'led:POWER', kind: 'emissive', part: 'POWER', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#ff4b33', bind: { source: 'param', key: 'on' } },
      { id: 'led:HEAT', kind: 'emissive', part: 'STATION', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#ff4b33', extras: { on: 'report.heating' } },
    ],
    extras: { ironPoses: { inHolder: ironAxis(true), inHand: ironAxis(false) } },
  },
  lab: {
    lab: 'electronics',
    summary: 'A temperature-controlled soldering iron. The tip runs at the dial temperature, about 330 °C for normal work, and looks the same hot or cold.',
    safeUse: [
      'Always put the iron back in its stand, never down on the bench.',
      'Hold it by the grip only; never touch the metal.',
      'Use about 320 to 350 °C for normal through-hole soldering.',
      'Keep the sponge damp, not wet, and wipe the tip on it before each joint.',
      'Work with a fan or fume extractor so you do not breathe the flux smoke.',
      'Switch it off when you finish or walk away.',
    ],
    mistakes: [
      { id: 'iron-left-out', when: 'The station is on and the iron has been out of its stand for over 15 seconds.', say: 'Put the iron back in its stand when you are not soldering: a hot iron on the bench burns things.' },
      { id: 'too-hot', when: 'The station is on with the dial at 400 °C or more.', say: 'That is hotter than you need. Around 330 °C is enough; hotter burns the tip and can lift the pads.' },
      { id: 'dry-sponge', when: 'The station is on with a dry sponge.', say: 'Dampen the sponge first: a dry one melts and does not clean the tip.' },
    ],
    hazards: ['The tip is around 330 °C and looks cold.', 'Flux smoke irritates the lungs.', 'Solder can spit: wear safety glasses.'],
  },
});
function power(st, api){ api.set('on', !st.p.on); api.say(st.p.on ? 'Station on: the tip heats up' : 'Station off'); }
function pick(st, api){ api.set('inHolder', !st.p.inHolder); api.say(st.p.inHolder ? 'Iron back in its stand' : 'Iron picked up'); }
})();
