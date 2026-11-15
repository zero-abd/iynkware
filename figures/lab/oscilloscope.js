// @cf title Oscilloscope
// @cf use engine/lab.list
/* A 2-channel benchtop digital storage oscilloscope of the common 100 MHz school and hobby class (the size of a
   Siglent SDS1000X-E or Rigol DS1000Z: about 310 mm wide, 150 mm tall, 110 mm deep): a 7-inch screen with the
   standard 10 x 8 division graticule on the left, and on the right a VOLTS/DIV knob and a channel button per channel,
   the horizontal (time/div) knob, the trigger LEVEL knob, RUN/STOP, two BNC inputs and the probe-compensation lug
   (a 1 kHz, 3 V square wave, the usual value). A x1/x10 passive probe on CH1 lies on the mat, hooked onto the lug or
   on a circuit, whose signal (wave, frequency, peak-to-peak, offset) the host supplies.
   How it behaves is how a real scope does: the trace is the input in divisions (volts ÷ V/div up, time ÷ s/div
   across, trigger point at the centre), held still while the trigger level lies inside the signal and rolling when it
   does not; the probe divides by 1 or 10 and the channel's probe setting multiplies back, so a mismatch reads ten
   times wrong; the measured Vpp and frequency are shown under the graticule. */
(() => {
const LAB = SL.lab, T = LAB.T;
const CW = 310, CH = 150, Y0 = -28, Y1 = 82;            // case: front panel at Y0, the probe on the mat in front of it
const DIV = 12, GX0 = -135, GZ0 = 40, GX = GX0 + 5 * DIV, GZ = GZ0 + 4 * DIV;   // graticule 10 x 8 divisions of 12 mm
const CASE = { l: '#dfe1de', m: '#c3c6c2', d: '#878b86' }, PANEL = { l: '#4a4c50', m: '#36383c', d: '#212326' };
const CH1C = '#ffd23a', CH2C = '#3ad7ff';
const TIMEBASES = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, .1];
const VDIVS = [.05, .1, .2, .5, 1, 2, 5, 10];
const LEVELS = [-1, 0, .5, 1, 1.5, 2, 3];
const ATT = { x1: 1, x10: 10 };
const KNOBS = { TIME: { x: 125, z: 98, r: 11, key: 'timebase', list: TIMEBASES, print: 'TIME/DIV' }, LEVEL: { x: 125, z: 62, r: 8, key: 'trigLevel', print: 'LEVEL' },
  VDIV1: { x: 30, z: 98, r: 10, key: 'vdiv', list: VDIVS, print: 'VOLTS/DIV' }, VDIV2: { x: 75, z: 98, r: 10, key: 'vdiv2', list: VDIVS, print: 'VOLTS/DIV' } };
const BNC = { CH1: [30, 30], CH2: [75, 30] }, CAL = [122, 30], CALG = [138, 30], RUN = [128, 126], CHB = { CH1: [30, 72], CH2: [75, 72] };
const stepDeg = (list, v) => { const i = list.indexOf(v); return i < 0 ? 0 : -135 + 270 * i / (list.length - 1); };
const levelDeg = v => Math.max(-135, Math.min(135, v * 27));
const knobDeg = (id, p) => id === 'LEVEL' ? levelDeg(p.trigLevel) : stepDeg(KNOBS[id].list, p[KNOBS[id].key]);
const fmtT = s => s >= 1e-3 ? +(s * 1e3).toPrecision(3) + ' ms' : s >= 1e-6 ? +(s * 1e6).toPrecision(3) + ' µs' : +(s * 1e9).toPrecision(3) + ' ns';
const fmtV = v => Math.abs(v) >= 1 ? +v.toPrecision(3) + ' V' : +(v * 1e3).toPrecision(3) + ' mV';
const fmtHz = v => v >= 1e6 ? +(v / 1e6).toPrecision(4) + ' MHz' : v >= 1e3 ? +(v / 1e3).toPrecision(4) + ' kHz' : +v.toPrecision(4) + ' Hz';

// the signal at the probe tip: the CAL lug's square wave, or what the host or the demo pickers supply
const signal = p => p.source === 'cal' ? { wave: 'square', freqHz: 1000, vpp: 3, offset: 1.5 } : { wave: p.wave, freqHz: p.freqHz, vpp: p.vpp, offset: p.offset };
const waveAt = (kind, u) => { u -= Math.floor(u); return kind === 'sine' ? Math.sin(2 * Math.PI * u) : kind === 'square' ? (u < .5 ? 1 : -1) : u < .25 ? 4 * u : u < .75 ? 2 - 4 * u : 4 * u - 4; };
// what the screen shows: the probe divides, the channel's probe setting multiplies back
const view = p => {
  const sg = signal(p), g = ATT[p.atten] / ATT[p.probe], hi = g * (sg.offset + sg.vpp / 2), lo = g * (sg.offset - sg.vpp / 2);
  const cycles = 10 * p.timebase * sg.freqHz, vppShown = g * sg.vpp, divs = vppShown / p.vdiv;
  const clipped = Math.max(Math.abs(hi), Math.abs(lo)) / p.vdiv > 4;
  return { sg, g, hi, lo, cycles, vppShown, divs, clipped, triggered: p.on && p.ch1 && sg.vpp > 0 && p.trigLevel > lo && p.trigLevel < hi };
};
// the phase at the screen's centre: the rising crossing of the trigger level when triggered, else drifting
const phase0 = (p, v, tt) => {
  if (!v.triggered) return (tt * .37) % 1;
  const val = u => v.g * (v.sg.offset + v.sg.vpp / 2 * waveAt(v.sg.wave, u));
  for (let i = 0; i < 400; i++){ const a = val(i / 400), b = val((i + 1) / 400); if (a < p.trigLevel && b >= p.trigLevel) return (i + .5) / 400; }
  return 0;
};

LAB.item('oscilloscope', {
  name: 'Oscilloscope', fig: 'L8', foot: [CW + 10, 2 * Y1 + 2, CH + 4],
  params: {
    source: { label: 'Probe on', values: ['cal', 'demo'], names: { cal: 'CAL lug (1 kHz square)', demo: 'A circuit (demo signal)' } },
    wave: { label: 'Signal wave', values: ['sine', 'square', 'triangle'], names: { sine: 'Sine', square: 'Square', triangle: 'Triangle' } },
    freqHz: { label: 'Signal frequency', values: [50, 100, 500, 1000, 5000, 10000, 100000], range: [.1, 2e7], unit: 'Hz', show: fmtHz },
    vpp: { label: 'Signal size', values: [.1, .5, 1, 2, 3, 5, 10, 20], range: [0, 100], unit: 'V', show: v => fmtV(v) + ' pp', picker: false },
    offset: { label: 'Signal offset', values: [0, -1, 1, 2], range: [-50, 50], unit: 'V', show: fmtV, picker: false },
    timebase: { label: 'Time/div', values: TIMEBASES, unit: 's', show: v => fmtT(v) + '/div' },
    vdiv: { label: 'CH1 volts/div', values: VDIVS, unit: 'V', show: v => fmtV(v) + '/div' },
    vdiv2: { label: 'CH2 volts/div', values: VDIVS, unit: 'V', show: v => fmtV(v) + '/div', picker: false },
    trigLevel: { label: 'Trigger level', values: LEVELS, range: [-50, 50], unit: 'V', show: fmtV },
    probe: { label: 'Probe switch', values: ['x10', 'x1'], names: { x1: '×1', x10: '×10' } },
    atten: { label: 'CH1 probe setting', values: ['x10', 'x1'], names: { x1: '×1', x10: '×10' } },
    on: { label: 'Power', values: [true, false], picker: false },
    running: { label: 'Run', values: [true, false], picker: false },
    ch1: { label: 'CH1', values: [true, false], picker: false },
    ch2: { label: 'CH2', values: [false, true], picker: false },
  },
  defaults: { source: 'cal', wave: 'sine', freqHz: 1000, vpp: 2, offset: 0, timebase: 5e-4, vdiv: 1, vdiv2: 1, trigLevel: 1, probe: 'x10', atten: 'x10', on: true, running: true, ch1: true, ch2: false },
  parts: {
    CASE: { name: 'Case', role: 'body' },
    PANEL: { name: 'Front panel', role: 'body' },
    SCREEN: { name: 'Screen', role: 'light' },
    TIME: { name: 'Time/div knob', role: 'control', press: (st, api) => stepKnob(st, api, 'TIME') },
    LEVEL: { name: 'Trigger level knob', role: 'control', press: (st, api) => stepKnob(st, api, 'LEVEL') },
    VDIV1: { name: 'CH1 volts/div knob', role: 'control', press: (st, api) => stepKnob(st, api, 'VDIV1') },
    VDIV2: { name: 'CH2 volts/div knob', role: 'control', press: (st, api) => stepKnob(st, api, 'VDIV2') },
    RUN: { name: 'RUN/STOP button', role: 'control', press: (st, api) => runStop(st, api) },
    CH1B: { name: 'CH1 button', role: 'control', press: (st, api) => chan(st, api, 'ch1') },
    CH2B: { name: 'CH2 button', role: 'control', press: (st, api) => chan(st, api, 'ch2') },
    POWER: { name: 'Power button', role: 'control', press: (st, api) => power(st, api) },
    BNC1: { name: 'CH1 input', role: 'pin' },
    BNC2: { name: 'CH2 input', role: 'pin' },
    CAL: { name: 'Probe compensation lug', role: 'pin' },
    PROBE: { name: 'CH1 probe', role: 'wire', press: (st, api) => { api.set('probe', st.p.probe === 'x10' ? 'x1' : 'x10'); api.say('{part} is now {value}', { part: T('Probe switch'), value: st.p.probe === 'x10' ? '×10' : '×1' }); } },
  },
  actions: [
    { id: 'power', label: 'Power on/off', run: (st, api) => power(st, api) },
    { id: 'run', label: 'Run/Stop', run: (st, api) => runStop(st, api) },
    { id: 'ch1', label: 'CH1 on/off', run: (st, api) => chan(st, api, 'ch1') },
    { id: 'ch2', label: 'CH2 on/off', run: (st, api) => chan(st, api, 'ch2') },
  ],
  init: st => { st.s.tt = 0; },
  step: (st, dt) => { if (st.p.running) st.s.tt += dt; },
  live: st => st.p.on && st.p.running && st.p.ch1 && !view(st.p).triggered,
  draw(ctx){
    const { p, s, k } = ctx, W = ctx.W, front = vis(sub(W(0, -1, 0), W(0, 0, 0))), Ux = sub(W(1, 0, 0), W(0, 0, 0)), DOWN = [0, 0, -1];
    const txt = (x, z, str, size, col = '#f2efe6', weight = 700, anchor = 'middle') => front ? LAB.textOn(W(x, Y0 - .5, z), Ux, DOWN, str, size, col, weight, anchor) : '';
    const v = view(p);
    ctx.shadow([W(-CW / 2, Y0, 0), W(CW / 2, Y0, 0), W(CW / 2, Y1, 0), W(-CW / 2, Y1, 0), W(-CW / 2, Y0, CH), W(CW / 2, Y0, CH), W(CW / 2, Y1, CH), W(-CW / 2, Y1, CH)]);
    // the case: light grey, with a handle recess and vents on top
    let body = SL.bench.slabW(W, -CW / 2, Y0 + 2, CW / 2, Y1, 0, CH, CASE, toneI, 1.6);
    if (vis(sub(W(0, 0, 1), W(0, 0, 0)))) for (let i = 0; i < 6; i++) body += `<path d="${pd([W(-60 + i * 20, 20, CH + .1), W(-60 + i * 20, 70, CH + .1)], false)}" stroke="${CASE.d}" stroke-width="1.5" stroke-linecap="round"/>`;
    ctx.put([[-CW / 2, Y0 + 2, 0], [CW / 2, Y1, CH]], k > .02 ? `<g opacity="${f(1 - .5 * k)}">${body}</g>` : body, 'CASE');
    // the front panel: dark, with the printing
    let pnl = SL.bench.slabW(W, -CW / 2, Y0, CW / 2, Y0 + 2, 0, CH, PANEL, toneI, 1.2);
    pnl += txt(75, 140, 'DIGITAL OSCILLOSCOPE  100 MHz  2 CH', 3.2, '#f2efe6', 800);
    for (const [id, kn] of Object.entries(KNOBS)) pnl += txt(kn.x, kn.z + kn.r + 4, kn.print, 2.8);
    pnl += txt(BNC.CH1[0], 16, 'CH1', 3.4, CH1C, 800) + txt(BNC.CH2[0], 16, 'CH2', 3.4, CH2C, 800) + txt(130, 16, '1kHz  3V', 2.8) + txt(RUN[0], RUN[1] + 8, 'RUN/STOP', 2.6);
    pnl += txt(52, 50, '1MΩ  16pF  300Vpk CAT I', 2.4, '#bdb8ad', 600);
    ctx.put([[-CW / 2, Y0, 0], [CW / 2, Y0 + 2, CH]], pnl, 'PANEL');
    // the screen: bezel, glass, graticule, traces and readouts
    let scr = LAB.plate(W, Y0 - .2, -148, 22, -2, 144, '#1c1d20', .9);
    const lit = p.on, bg = lit ? '#0e1a22' : '#16181b';
    scr += LAB.plate(W, Y0 - .3, GX0 - 8, 25, GX0 + 10 * DIV + 8, 143, bg, .5);
    if (front && lit){
      let g = '';
      for (let i = 0; i <= 10; i++) g += pd([W(GX0 + i * DIV, Y0 - .4, GZ0), W(GX0 + i * DIV, Y0 - .4, GZ0 + 8 * DIV)], false);
      for (let j = 0; j <= 8; j++) g += pd([W(GX0, Y0 - .4, GZ0 + j * DIV), W(GX0 + 10 * DIV, Y0 - .4, GZ0 + j * DIV)], false);
      scr += `<path d="${g}" stroke="#41535e" stroke-width=".5" fill="none"/>`;
      scr += `<path d="${pd([W(GX, Y0 - .4, GZ0), W(GX, Y0 - .4, GZ0 + 8 * DIV)], false)}${pd([W(GX0, Y0 - .4, GZ), W(GX0 + 10 * DIV, Y0 - .4, GZ)], false)}" stroke="#6d8592" stroke-width=".7" stroke-dasharray="1 1.4" fill="none"/>`;
      const zOf = volts => GZ + Math.max(-4.15, Math.min(4.15, volts / p.vdiv)) * DIV;
      // CH1: one path of samples across the ten divisions; past about 40 cycles a real screen shows a smeared band
      if (p.ch1 && v.sg.vpp >= 0){
        let d;
        if (v.cycles > 40) d = pd([W(GX0, Y0 - .5, zOf(v.lo)), W(GX0 + 10 * DIV, Y0 - .5, zOf(v.lo)), W(GX0 + 10 * DIV, Y0 - .5, zOf(v.hi)), W(GX0, Y0 - .5, zOf(v.hi))]);
        else {
          const u0 = phase0(p, v, s.tt || 0), N = 240, pts = [];
          for (let i = 0; i <= N; i++){ const tdiv = -5 + 10 * i / N, u = u0 + v.sg.freqHz * tdiv * p.timebase;
            pts.push(W(GX0 + (tdiv + 5) * DIV, Y0 - .5, zOf(v.g * (v.sg.offset + v.sg.vpp / 2 * waveAt(v.sg.wave, u))))); }
          d = pd(pts, false);
        }
        scr += `<path d="${d}" stroke="${CH1C}" stroke-width="3" opacity=".25" fill="${v.cycles > 40 ? CH1C : 'none'}" stroke-linejoin="round"/><path d="${d}" stroke="${CH1C}" stroke-width="1.1" fill="none" stroke-linejoin="round"/>`;
        // the trigger level arrow on the right edge, and the channel's ground marker on the left
        const tz = zOf(p.trigLevel);
        scr += `<path d="${pd([W(GX0 + 10 * DIV + 1, Y0 - .5, tz), W(GX0 + 10 * DIV + 5, Y0 - .5, tz + 2), W(GX0 + 10 * DIV + 5, Y0 - .5, tz - 2)])}" fill="#f0a030"/>`;
        scr += `<path d="${pd([W(GX0 - 1, Y0 - .5, GZ), W(GX0 - 5, Y0 - .5, GZ + 2), W(GX0 - 5, Y0 - .5, GZ - 2)])}" fill="${CH1C}"/>`;
      }
      if (p.ch2) scr += `<path d="${pd([W(GX0, Y0 - .5, GZ - 6), W(GX0 + 10 * DIV, Y0 - .5, GZ - 6)], false)}" stroke="${CH2C}" stroke-width="1.1"/>`;
      // the readouts: settings along the top, measurements along the bottom
      const top = (p.running ? 'RUN' : 'STOP') + '   ' + fmtT(p.timebase) + '/div   ' + (v.triggered ? 'TRIG\'D' : 'AUTO') + ' ' + fmtV(p.trigLevel);
      scr += txt(GX0, 138.5, top, 3, p.running ? '#7dff9a' : '#ff6a55', 700, 'start');
      const meas = !p.ch1 ? '' : 'CH1 ' + fmtV(p.vdiv) + '/div ' + p.atten.replace('x', '×') + '   Vpp ' + (v.clipped ? '?' : fmtV(v.vppShown)) + '   f ' + (v.cycles >= 1 && v.vppShown > 0 ? fmtHz(v.sg.freqHz) : '?');
      scr += txt(GX0, 31, meas, 3, CH1C, 700, 'start');
      if (p.ch2) scr += txt(GX0 + 10 * DIV, 31, 'CH2 ' + fmtV(p.vdiv2) + '/div', 3, CH2C, 700, 'end');
    }
    ctx.put([[-148, Y0 - .5, 22], [-2, Y0, 144]], scr, 'SCREEN');
    // knobs
    for (const [id, kn] of Object.entries(KNOBS)) ctx.put([[kn.x - kn.r, Y0 - kn.r - 1, kn.z - kn.r], [kn.x + kn.r, Y0, kn.z + kn.r]], LAB.knob(W, kn.x, Y0, kn.z, kn.r, knobDeg(id, p)), id);
    // buttons: RUN/STOP lit green or red, the channel buttons lit in their colour while on
    const btn = (id, [x, z], col, on, w = 7, h = 4) => {
      const m = on && p.on ? { l: col, m: mix(col, '#000000', .12), d: mix(col, '#000000', .4) } : { l: '#6a6c70', m: '#55575b', d: '#36383b' };
      let s2 = SL.bench.slabW(W, x - w, Y0 - 4, x + w, Y0, z - h, z + h, m, toneI, .8);
      if (on && p.on && front){ const [X, Y] = P(...W(x, Y0 - 4.2, z)); s2 += `<circle cx="${f(X)}" cy="${f(Y)}" r="${f(w * 1.1)}" fill="${col}" opacity=".22"/>`; }
      ctx.put([[x - w, Y0 - 4, z - h], [x + w, Y0, z + h]], s2, id);
    };
    btn('RUN', RUN, p.running ? '#5ee07a' : '#ff5a48', true);
    btn('CH1B', CHB.CH1, CH1C, p.ch1);
    btn('CH2B', CHB.CH2, CH2C, p.ch2);
    ctx.put([[-145, Y0 - 3, 8], [-135, Y0, 18]], rod(W(-140, Y0, 13), W(-140, Y0 - 3, 13), 4.5, p.on ? { l: '#9ff0b0', m: '#5ccf78', d: '#2f7d44' } : LAB.M.blackPl, toneI, .8, 4.5, 12), 'POWER');
    // the BNC inputs and the compensation lug with its ground tab
    ctx.put([[BNC.CH1[0] - 7, Y0 - 11, BNC.CH1[1] - 7], [BNC.CH1[0] + 7, Y0, BNC.CH1[1] + 7]], LAB.bnc(W, BNC.CH1[0], Y0, BNC.CH1[1]), 'BNC1');
    ctx.put([[BNC.CH2[0] - 7, Y0 - 11, BNC.CH2[1] - 7], [BNC.CH2[0] + 7, Y0, BNC.CH2[1] + 7]], LAB.bnc(W, BNC.CH2[0], Y0, BNC.CH2[1]), 'BNC2');
    ctx.put([[CAL[0] - 3, Y0 - 9, CAL[1] - 3], [CALG[0] + 3, Y0, CAL[1] + 3]], SL.bench.slabW(W, CAL[0] - 2, Y0 - 9, CAL[0] + 2, Y0, CAL[1] - 3, CAL[1] + 3, LAB.M.steel, toneI, .7)
      + SL.bench.slabW(W, CALG[0] - 2, Y0 - 9, CALG[0] + 2, Y0, CALG[1] - 3, CALG[1] + 3, LAB.M.steel, toneI, .7), 'CAL');
    // the probe: a cable from CH1 down to the mat, the probe body lying in front, its hook on the lug or off to a circuit
    const GREY = { l: '#6b6e72', m: '#4d5054', d: '#2e3033' }, body0 = [70, -62, 5], body1 = [118, -58, 5];
    const cab = [[BNC.CH1[0], Y0 - 11, BNC.CH1[1]], [BNC.CH1[0], Y0 - 30, 6], [BNC.CH1[0] + 12, -72, 3], body0];
    const curve = []; for (let j = 0; j <= 12; j++){ const u = j / 12, a = cab[0], b = cab[1], c = cab[2], d = cab[3], m0 = 1 - u;
      curve.push([0, 1, 2].map(i => m0 * m0 * m0 * a[i] + 3 * m0 * m0 * u * b[i] + 3 * m0 * u * u * c[i] + u * u * u * d[i])); }
    for (let j = 0; j < 12; j++){ const bx = LAB.aabb3([curve[j], curve[j + 1]]);
      ctx.put([bx[0].map(c => c - 2), bx[1].map(c => c + 2)], rod(W(...curve[j]), W(...curve[j + 1]), 1.8, GREY, toneI, .6, 1.8, 8), 'PROBE'); }
    let pr = rod(W(...body0), W(...body1), 5, GREY, toneI, 1, 4.2, 14) + rod(W(...body1), W(body1[0] + 10, body1[1] + 1, 5), 4.2, GREY, toneI, .8, 1.5, 12);
    pr += SL.bench.slabW(W, 86, -66.5, 94, -60, 7.5, 10, { l: '#f4f1e8', m: '#d8d4c8', d: '#9f9a8c' }, toneI, .5);
    if (vis(sub(W(0, 0, 1), W(0, 0, 0)))) pr += LAB.textOn(W(90, -63.5, 10.2), Ux, sub(W(0, -1, 0), W(0, 0, 0)), p.probe === 'x10' ? '×10' : '×1', 3.2, INK, 800);
    ctx.put([[body0[0] - 5, -67, 0], [body1[0] + 11, -53, 10.5]], pr, 'PROBE');
    // the hook and the ground clip lead: up to the lug, or out toward the front (the circuit is off the mat)
    const tip = [body1[0] + 10, body1[1] + 1, 5], hookTo = p.source === 'cal' ? [CAL[0], Y0 - 8, CAL[1]] : [150, -78, 3];
    const gnd0 = [80, -58, 7], gndTo = p.source === 'cal' ? [CALG[0], Y0 - 8, CALG[1]] : [150, -70, 3];
    for (const [a, b, col] of [[tip, hookTo, '#cfd3d6'], [gnd0, gndTo, '#2b2a28']]){
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(a[2], b[2]) + 4], pts = Array.from({ length: 7 }, (_, j) => { const u = j / 6, m0 = 1 - u; return [0, 1, 2].map(i => m0 * m0 * a[i] + 2 * m0 * u * mid[i] + u * u * b[i]); });
      for (let j = 0; j < 6; j++){ const bx = LAB.aabb3([pts[j], pts[j + 1]]);
        ctx.put([bx[0].map(c => c - 1.5), bx[1].map(c => c + 1.5)], rod(W(...pts[j]), W(...pts[j + 1]), .7, matOf(col), toneI, .5, .7, 6), 'PROBE'); }
    }
    ctx.label(hookTo, p.source === 'cal' ? 'Probe on the CAL lug' : 'To the circuit', p.source === 'cal');
    ctx.label([90, -63, 10], 'Probe ×1/×10 switch', p.probe !== p.atten);
    ctx.label([GX0 + 10 * DIV, Y0, GZ0 + 6 * DIV], 'Trigger level', v.triggered);
  },
  stats: st => {
    const v = view(st.p);
    return [
      { label: T('Vpp'), value: !st.p.on || !st.p.ch1 ? '-' : v.clipped ? T('Clipped') : fmtV(v.vppShown) },
      { label: T('Frequency'), value: !st.p.on || !st.p.ch1 || v.cycles < 1 ? '-' : fmtHz(v.sg.freqHz), small: true },
      { label: T('Cycles on screen'), value: !st.p.on || !st.p.ch1 ? '-' : (v.cycles > 99 ? '>99' : +v.cycles.toFixed(1)), small: true },
    ];
  },
  reportKeys: ['vppShown', 'freqShown', 'cycles', 'divs', 'triggered', 'clipped'],
  report: st => { const p = st.p, v = view(p), shown = p.on && p.ch1;
    return { vppShown: shown && !v.clipped ? +v.vppShown.toPrecision(3) : null, freqShown: shown && v.cycles >= 1 && v.vppShown > 0 ? v.sg.freqHz : null,
      cycles: Math.round(v.cycles * 10) / 10, divs: Math.round(v.divs * 10) / 10, triggered: !!v.triggered, clipped: !!(shown && v.clipped) }; },
  mistake: st => {
    const p = st.p, v = view(p);
    if (!p.on || !p.ch1 || !(v.sg.vpp > 0)) return null;
    if (p.probe !== p.atten) return 'probe-mismatch';
    if (v.clipped) return 'clipped';
    if (v.divs < 1) return 'too-small';
    if (v.cycles < 1 || v.cycles > 5) return 'timebase-off';
    return null;
  },
  xrCaption: 'See-through: labels for the probe, its switch and the trigger level',
  xr: {
    anchors: [
      { id: 'port:CH1', kind: 'port', part: 'BNC1', at: [BNC.CH1[0], Y0 - 11, BNC.CH1[1]], normal: [0, -1, 0], aliases: ['CH1'] },
      { id: 'port:CH2', kind: 'port', part: 'BNC2', at: [BNC.CH2[0], Y0 - 11, BNC.CH2[1]], normal: [0, -1, 0], aliases: ['CH2'] },
      { id: 'CAL', kind: 'pin', part: 'CAL', at: [CAL[0], Y0 - 9, CAL[1]], normal: [0, -1, 0], aliases: ['PROBE_COMP'] },
      { id: 'CAL_GND', kind: 'pin', part: 'CAL', at: [CALG[0], Y0 - 9, CALG[1]], normal: [0, -1, 0], aliases: ['GND'] },
      { id: 'screen:MAIN', kind: 'screen', part: 'SCREEN', at: [GX, Y0 - .4, GZ], normal: [0, -1, 0], text: 'Screen',
        rect: { origin: [GX0 - 8, Y0 - .3, 143], u: [10 * DIV + 16, 0, 0], v: [0, 0, -118], pixels: [800, 480] },
        extras: { graticule: { divisions: [10, 8], mmPerDiv: DIV, origin: [GX0, Y0 - .4, GZ0 + 8 * DIV] } } },
      ...Object.entries(KNOBS).map(([id, kn]) => ({ id: `control:${id}`, kind: 'control', part: id, at: [kn.x, Y0 - kn.r * .9, kn.z], normal: [0, -1, 0], channel: `turn:${id}` })),
      { id: 'control:RUN', kind: 'control', part: 'RUN', at: [RUN[0], Y0 - 4, RUN[1]], normal: [0, -1, 0], channel: 'led:RUN' },
      { id: 'control:CH1', kind: 'control', part: 'CH1B', at: [CHB.CH1[0], Y0 - 4, CHB.CH1[1]], normal: [0, -1, 0], channel: 'led:CH1' },
      { id: 'control:CH2', kind: 'control', part: 'CH2B', at: [CHB.CH2[0], Y0 - 4, CHB.CH2[1]], normal: [0, -1, 0], channel: 'led:CH2' },
      { id: 'control:POWER', kind: 'control', part: 'POWER', at: [-140, Y0 - 3, 13], normal: [0, -1, 0], channel: 'led:POWER' },
      { id: 'control:PROBE', kind: 'control', part: 'PROBE', at: [90, -63, 10], normal: [0, 0, 1] },
    ],
    channels: [
      ...Object.entries(KNOBS).map(([id, kn]) => ({ id: `turn:${id}`, kind: 'rotate', part: id, value: { unit: 'deg', min: -135, max: 135, rest: knobDeg(id, { timebase: 5e-4, vdiv: 1, vdiv2: 1, trigLevel: 1 }) },
        axis: [0, 1, 0], pivot: [kn.x, Y0, kn.z], scale: Math.PI / 180, bind: { source: 'param', key: kn.key },
        extras: kn.list ? { deg: Object.fromEntries(kn.list.map(x => [String(x), stepDeg(kn.list, x)])) } : { degPerVolt: 27, min: -135, max: 135 } })),
      { id: 'led:SCREEN', kind: 'emissive', part: 'SCREEN', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: '#0e1a22', bind: { source: 'param', key: 'on' } },
      { id: 'led:RUN', kind: 'emissive', part: 'RUN', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: '#5ee07a', bind: { source: 'param', key: 'running' }, extras: { colorWhenStopped: '#ff5a48', on: 'params.on' } },
      { id: 'led:CH1', kind: 'emissive', part: 'CH1B', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: CH1C, bind: { source: 'param', key: 'ch1' }, extras: { on: 'params.on && params.ch1' } },
      { id: 'led:CH2', kind: 'emissive', part: 'CH2B', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: CH2C, bind: { source: 'param', key: 'ch2' }, extras: { on: 'params.on && params.ch2' } },
      { id: 'led:POWER', kind: 'emissive', part: 'POWER', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: '#5ccf78', bind: { source: 'param', key: 'on' } },
    ],
    extras: {
      screen: { anchor: 'screen:MAIN', trace: 'y(t) = g·(offset + vpp/2·wave(f·t + phase)) in divisions of vdiv, t in divisions of timebase, trigger point at the centre; g = atten ÷ probe',
        colors: { CH1: CH1C, CH2: CH2C }, triggeredWhen: 'report.triggered', drawBand: 'report.cycles > 40' },
      probe: { part: 'PROBE', hookOnCal: { source: 'cal' }, attenuation: ATT },
      signalFrom: 'a function-generator report.signal can be sent as { source: "demo", wave, freqHz, vpp, offset }',
    },
  },
  lab: {
    lab: 'electronics',
    summary: 'A 2-channel oscilloscope. It draws voltage against time: up is volts (VOLTS/DIV per square), across is time (TIME/DIV per square).',
    safeUse: [
      'Set the probe switch and the channel probe setting the same: both ×10 for normal work.',
      'Check the probe on the CAL lug first: you should see a flat-topped 1 kHz square wave.',
      'Clip the probe ground lead to the circuit ground only, never to any other point.',
      'Turn VOLTS/DIV until the trace fills most of the screen without running off it.',
      'Turn TIME/DIV until you see one to five cycles.',
      'Never probe mains with a bench scope and a standard probe.',
    ],
    mistakes: [
      { id: 'probe-mismatch', when: 'The probe switch and the channel probe setting differ (×10 probe with the channel on ×1, or the other way).', say: 'The probe switch and the channel setting do not match, so every reading is ten times wrong. Set both to ×10.' },
      { id: 'clipped', when: 'The trace runs off the top or bottom of the screen at this VOLTS/DIV.', say: 'The trace runs off the screen. Turn VOLTS/DIV up to a bigger number so the whole wave fits.' },
      { id: 'too-small', when: 'The whole trace is less than one division tall.', say: 'The trace is tiny. Turn VOLTS/DIV down so the wave fills more of the screen.' },
      { id: 'timebase-off', when: 'Fewer than 1 or more than 5 cycles fit across the screen at this TIME/DIV.', say: 'TIME/DIV is off: you cannot see whole cycles clearly. Turn it until one to five cycles fit across.' },
    ],
    hazards: ['The probe ground is connected to mains earth: clipping it to a live point makes a short.', 'High voltages can damage the scope and hurt you.'],
  },
});
function power(st, api){ api.set('on', !st.p.on); api.say(st.p.on ? 'Scope on' : 'Scope off'); }
function runStop(st, api){ api.set('running', !st.p.running); api.say(st.p.running ? 'Running' : 'Stopped: the trace is frozen'); }
function chan(st, api, key){ api.set(key, !st.p[key]); api.say('{part} is now {value}', { part: key === 'ch1' ? 'CH1' : 'CH2', value: T(st.p[key] ? 'ON' : 'OFF') }); }
function stepKnob(st, api, id){
  const kn = KNOBS[id], list = kn.list || LEVELS, i = list.indexOf(st.p[kn.key]), next = list[(i + 1) % list.length];
  api.set(kn.key, next);
  api.say('{part} is now {value}', { part: T({ TIME: 'Time/div', LEVEL: 'Trigger level', VDIV1: 'CH1 volts/div', VDIV2: 'CH2 volts/div' }[id]), value: id === 'TIME' ? fmtT(next) + '/div' : id === 'LEVEL' ? fmtV(next) : fmtV(next) + '/div' });
}
})();
