// @cf title Function generator
// @cf use engine/lab.list
/* A benchtop DDS function generator of the common school and hobby kind (about 220 mm wide, 90 mm tall and 200 mm
   deep, like the GW Instek SFG-1000 and Tenma 72-series): a backlit LCD with the frequency and the amplitude, three
   waveform keys (sine, square, triangle), a FREQUENCY and an AMPLITUDE knob, an OUTPUT key with its green lamp, the
   50 Ω BNC OUT socket and a power key. It makes 0.1 Hz to 1 MHz and up to 20 V peak-to-peak into a high-impedance
   load such as a scope input (the usual 50 Ω source: into 50 Ω the voltage halves, into a short it is all dropped
   inside the generator).
   On the mat in front, the BNC lead from OUT goes to what it drives: a scope input (1 MΩ), a 1 kΩ resistor on
   crocodile clips, the clips touching (a short) or nothing. `report.signal` is what reaches that load, in the shape
   the oscilloscope takes as its demo signal. */
(() => {
const LAB = SL.lab, T = LAB.T;
const CW = 220, CH = 90, Y0 = -75, Y1 = 125, ROUT = 50;
const CASE = { l: '#e4e1d8', m: '#c9c5ba', d: '#8e897c' }, PANEL = { l: '#4c5a66', m: '#384550', d: '#222b33' };
const WAVES = { sine: { name: 'Sine', key: 'SINE', x: -94 }, square: { name: 'Square', key: 'SQR', x: -66 }, triangle: { name: 'Triangle', key: 'TRI', x: -38 } };
const FREQS = [1, 10, 100, 1000, 10000, 100000, 1000000], AMPS = [.1, .5, 1, 2, 5, 10, 20];
const LOADS = { open: { name: 'Nothing connected', ohms: Infinity }, scope: { name: 'Oscilloscope input (1 MΩ)', ohms: 1e6 }, r1k: { name: '1 kΩ resistor', ohms: 1000 }, short: { name: 'Clips touching (short)', ohms: 0 } };
const FREQ_K = [20, 52, 15], AMP_K = [64, 52, 11], OUT = [98, 22], OUTKEY = [98, 46], PWR = [-98, 14], LCD = [-104, 50, -20, 80];
const freqDeg = v => -135 + 270 * (Math.log10(Math.max(.1, v)) + 1) / 7;
const ampDeg = v => -135 + 270 * Math.min(20, v) / 20;
const fmtHz = v => v >= 1e6 ? (v / 1e6).toFixed(3) + ' MHz' : v >= 1e3 ? (v / 1e3).toFixed(3) + ' kHz' : v.toFixed(v < 10 ? 3 : 1) + ' Hz';
const fmtV = v => v >= 1 ? v.toFixed(2) + ' Vpp' : (v * 1000).toFixed(0) + ' mVpp';
// what reaches the load through the 50 Ω source
const out = p => {
  const R = LOADS[p.load].ohms, live = p.on && p.output;
  const v = !live ? 0 : R === Infinity ? p.vpp : p.vpp * R / (R + ROUT), i = !live || R === Infinity ? 0 : p.vpp / 2 / (R + ROUT);
  return { v, iPk: i };
};

LAB.item('function-generator', {
  name: 'Function generator', fig: 'L9', foot: [CW + 10, Y1 * 2, CH + 2],
  params: {
    wave: { label: 'Waveform', values: Object.keys(WAVES), names: Object.fromEntries(Object.entries(WAVES).map(([k, v]) => [k, v.name])) },
    freqHz: { label: 'Frequency', values: FREQS, range: [.1, 1e6], unit: 'Hz', show: v => fmtHz(v) },
    vpp: { label: 'Amplitude', values: AMPS, range: [0, 20], unit: 'V', show: v => fmtV(v) },
    load: { label: 'Load', values: Object.keys(LOADS), names: Object.fromEntries(Object.entries(LOADS).map(([k, v]) => [k, v.name])) },
    output: { label: 'Output', values: [false, true], picker: false },
    on: { label: 'Power', values: [true, false], picker: false },
  },
  defaults: { wave: 'sine', freqHz: 1000, vpp: 2, load: 'scope', output: false, on: true },
  parts: Object.assign({
    CASE: { name: 'Case', role: 'body' },
    PANEL: { name: 'Front panel and display', role: 'body' },
    FREQ: { name: 'Frequency knob', role: 'control', press: (st, api) => stepKnob(st, api, 'freqHz', FREQS, 'Frequency', fmtHz) },
    AMPL: { name: 'Amplitude knob', role: 'control', press: (st, api) => stepKnob(st, api, 'vpp', AMPS, 'Amplitude', fmtV) },
    OUTKEY: { name: 'Output key', role: 'control', press: (st, api) => output(st, api) },
    POWER: { name: 'Power key', role: 'control', press: (st, api) => power(st, api) },
    BNC_OUT: { name: 'Output socket (50 Ω)', role: 'pin' },
    LEAD: { name: 'Output lead and load', role: 'wire' },
  }, Object.fromEntries(Object.entries(WAVES).map(([k, v]) => ['KEY_' + v.key, { name: v.name + ' key', role: 'control', press: (st, api) => { api.set('wave', k); api.say('{part} is now {value}', { part: T('Waveform'), value: T(v.name) }); } }]))),
  actions: [
    { id: 'output', label: 'Output on/off', run: (st, api) => output(st, api) },
    { id: 'power', label: 'Power on/off', run: (st, api) => power(st, api) },
  ],
  draw(ctx){
    const { p, k } = ctx, W = ctx.W, front = vis(sub(W(0, -1, 0), W(0, 0, 0))), Ux = sub(W(1, 0, 0), W(0, 0, 0)), DOWN = [0, 0, -1];
    const txt = (x, z, str, size, col = '#f2efe6', weight = 700, anchor = 'middle', y = Y0 - .5) => front ? LAB.textOn(W(x, y, z), Ux, DOWN, str, size, col, weight, anchor) : '';
    const o = out(p), live = p.on && p.output;
    ctx.shadow([W(-CW / 2, Y0, 0), W(CW / 2, Y0, 0), W(CW / 2, Y1, 0), W(-CW / 2, Y1, 0), W(-CW / 2, Y0, CH), W(CW / 2, Y0, CH), W(CW / 2, Y1, CH), W(-CW / 2, Y1, CH)]);
    let body = SL.bench.slabW(W, -CW / 2, Y0 + 2, CW / 2, Y1, 0, CH, CASE, toneI, 1.6);
    if (vis(sub(W(0, 0, 1), W(0, 0, 0)))) for (let i = 0; i < 5; i++) body += `<path d="${pd([W(-50 + i * 25, 40, CH + .1), W(-50 + i * 25, 100, CH + .1)], false)}" stroke="${CASE.d}" stroke-width="1.5" stroke-linecap="round"/>`;
    ctx.put([[-CW / 2, Y0 + 2, 0], [CW / 2, Y1, CH]], k > .02 ? `<g opacity="${f(1 - .5 * k)}">${body}</g>` : body, 'CASE');
    // the panel, its printing and the LCD: frequency big, waveform and amplitude below
    let pnl = SL.bench.slabW(W, -CW / 2, Y0, CW / 2, Y0 + 2, 0, CH, PANEL, toneI, 1.2);
    pnl += txt(-60, 84.5, 'FUNCTION GENERATOR  0.1Hz-1MHz', 3, '#f2efe6', 800);
    pnl += txt(FREQ_K[0], FREQ_K[1] - FREQ_K[2] - 6, 'FREQUENCY', 2.8) + txt(AMP_K[0], AMP_K[1] - AMP_K[2] - 6, 'AMPLITUDE', 2.8);
    pnl += txt(OUT[0], 7, 'OUT 50Ω', 2.8) + txt(OUTKEY[0], OUTKEY[1] + 13, 'OUTPUT', 2.6) + txt(PWR[0], 4, 'POWER', 2.6);
    const [lx0, lz0, lx1, lz1] = LCD, lcdOn = p.on;
    pnl += LAB.plate(W, Y0 - .3, lx0 - 2, lz0 - 2, lx1 + 2, lz1 + 2, '#1c1d20', .8) + LAB.plate(W, Y0 - .4, lx0, lz0, lx1, lz1, lcdOn ? '#b8d26a' : '#5f6a4a', .5);
    if (lcdOn){
      pnl += txt(lx1 - 3, 63, fmtHz(p.freqHz), 8, '#1d2414', 800, 'end', Y0 - .5);
      pnl += txt(lx0 + 3, 54, WAVES[p.wave].key + '  ' + fmtV(p.vpp), 3.6, '#1d2414', 700, 'start', Y0 - .5);
      pnl += txt(lx1 - 3, 54, p.output ? 'OUT ON' : 'OUT OFF', 3.4, '#1d2414', 800, 'end', Y0 - .5);
    }
    ctx.put([[-CW / 2, Y0, 0], [CW / 2, Y0 + 2, CH]], pnl, 'PANEL');
    // waveform keys, each with its symbol; the chosen one lit amber
    for (const [kk, wv] of Object.entries(WAVES)){
      const lit = p.on && p.wave === kk, m = lit ? { l: '#ffcf6a', m: '#f0b03c', d: '#a06e14' } : { l: '#8a8f94', m: '#6c7176', d: '#45494d' };
      let s = SL.bench.slabW(W, wv.x - 11, Y0 - 4, wv.x + 11, Y0, 33, 42, m, toneI, .8);
      if (front){ const sym = Array.from({ length: 13 }, (_, i) => { const u = i / 12, y = kk === 'sine' ? Math.sin(u * 2 * Math.PI) : kk === 'square' ? (u < .5 ? 1 : -1) : (u < .25 ? 4 * u : u < .75 ? 2 - 4 * u : 4 * u - 4); return W(wv.x - 6 + 12 * u, Y0 - 4.1, 37.5 + 2.6 * y); });
        if (kk === 'square') sym.splice(7, 0, W(wv.x, Y0 - 4.1, 40.1), W(wv.x, Y0 - 4.1, 34.9));
        s += `<path d="${pd(sym, false)}" fill="none" stroke="#1d2024" stroke-width=".9" stroke-linejoin="round"/>`; }
      ctx.put([[wv.x - 11, Y0 - 4, 33], [wv.x + 11, Y0, 42]], s, 'KEY_' + wv.key);
    }
    ctx.put([[FREQ_K[0] - FREQ_K[2], Y0 - 15, FREQ_K[1] - FREQ_K[2]], [FREQ_K[0] + FREQ_K[2], Y0, FREQ_K[1] + FREQ_K[2]]], LAB.knob(W, FREQ_K[0], Y0, FREQ_K[1], FREQ_K[2], freqDeg(p.freqHz), { depth: 14, n: 22 }), 'FREQ');
    ctx.put([[AMP_K[0] - AMP_K[2], Y0 - 11, AMP_K[1] - AMP_K[2]], [AMP_K[0] + AMP_K[2], Y0, AMP_K[1] + AMP_K[2]]], LAB.knob(W, AMP_K[0], Y0, AMP_K[1], AMP_K[2], ampDeg(p.vpp)), 'AMPL');
    // OUTPUT key and its lamp
    let ok = SL.bench.slabW(W, OUTKEY[0] - 7, Y0 - 4, OUTKEY[0] + 7, Y0, OUTKEY[1] - 4, OUTKEY[1] + 4, { l: '#8a8f94', m: '#6c7176', d: '#45494d' }, toneI, .8);
    ok += shape(LAB.panelRing(W, OUTKEY[0], Y0 - .5, OUTKEY[1] + 8, 1.8, 10), live ? '#5ee07a' : '#244a2c', .5);
    if (live && front){ const [X, Y] = P(...W(OUTKEY[0], Y0 - .6, OUTKEY[1] + 8)); ok += `<circle cx="${f(X)}" cy="${f(Y)}" r="6" fill="#5ee07a" opacity=".3"/>`; }
    ctx.put([[OUTKEY[0] - 7, Y0 - 4, OUTKEY[1] - 4], [OUTKEY[0] + 7, Y0, OUTKEY[1] + 10]], ok, 'OUTKEY');
    ctx.put([[PWR[0] - 6, Y0 - 3, PWR[1] - 4], [PWR[0] + 6, Y0, PWR[1] + 4]], SL.bench.slabW(W, PWR[0] - 6, Y0 - 3, PWR[0] + 6, Y0, PWR[1] - 4, PWR[1] + 4, p.on ? { l: '#9ff0b0', m: '#5ccf78', d: '#2f7d44' } : LAB.M.blackPl, toneI, .8), 'POWER');
    ctx.put([[OUT[0] - 7, Y0 - 11, OUT[1] - 7], [OUT[0] + 7, Y0, OUT[1] + 7]], LAB.bnc(W, OUT[0], Y0, OUT[1]), 'BNC_OUT');
    // the BNC lead from OUT down to the mat, then to its load
    const BLK = { l: '#4a4744', m: '#33302d', d: '#1e1c1a' }, end = p.load === 'scope' ? [-20, -112, 4] : [40, -105, 4];
    {
      const a = [OUT[0], Y0 - 15, OUT[1]], b = [OUT[0] + 2, Y0 - 34, 4], c = [OUT[0] - 10, -112, 3];
      const pts = Array.from({ length: 13 }, (_, j) => { const u = j / 12, m0 = 1 - u; return [0, 1, 2].map(i => m0 * m0 * m0 * a[i] + 3 * m0 * m0 * u * b[i] + 3 * m0 * u * u * c[i] + u * u * u * end[i]); });
      ctx.put([[OUT[0] - 4, Y0 - 16, OUT[1] - 4], [OUT[0] + 4, Y0 - 11, OUT[1] + 4]], rod(W(OUT[0], Y0 - 11, OUT[1]), W(OUT[0], Y0 - 16, OUT[1]), 5, LAB.M.steel, toneI, .8, 5, 12), 'LEAD');
      for (let j = 0; j < 12; j++){ const bx = LAB.aabb3([pts[j], pts[j + 1]]);
        ctx.put([bx[0].map(q => q - 2.4), bx[1].map(q => q + 2.4)], rod(W(...pts[j]), W(...pts[j + 1]), 2.2, BLK, toneI, .6, 2.2, 8), 'LEAD'); }
    }
    if (p.load === 'scope'){
      // a BNC plug lying on the mat, off toward the scope
      ctx.put([[-46, -117, 0], [-20, -107, 10]], rod(W(-20, -112, 4), W(-32, -112, 4), 5, LAB.M.steel, toneI, .9, 5, 12) + rod(W(-32, -112, 4), W(-44, -112, 4), 3, BLK, toneI, .8, 3, 10), 'LEAD');
      ctx.label([-44, -112, 4], 'To the scope', !!live);
    } else {
      // a splitter block, then red and black clips to the load on the mat
      const RED = { l: '#ef6a5b', m: '#d8453a', d: '#8e2a21' };
      let s = SL.bench.slabW(W, 34, -110, 46, -100, 0, 8, BLK, toneI, .8);
      const clipR = p.load === 'short' ? [-14, -110] : [-8, -110], clipB = p.load === 'short' ? [-18, -110] : [-58, -110];
      for (const [to, col] of [[clipR, RED], [clipB, BLK]]){
        const a = [34, -105, 4], mid = [(a[0] + to[0]) / 2, -100, 2], pts = Array.from({ length: 7 }, (_, j) => { const u = j / 6, m0 = 1 - u; return [0, 1, 2].map(i => m0 * m0 * a[i] + 2 * m0 * u * mid[i] + u * u * [to[0], to[1], 3][i]); });
        for (let j = 0; j < 6; j++) s += rod(W(...pts[j]), W(...pts[j + 1]), 1.1, col, toneI, .5, 1.1, 8);
        s += SL.bench.slabW(W, to[0] - 5, to[1] - 2, to[0] + 5, to[1] + 2, 1, 6, col, toneI, .7);
      }
      if (p.load === 'r1k') s += rod(W(-50, -110, 3.5), W(-16, -110, 3.5), .4, LAB.M.steel, toneI, .4) + rod(W(-38, -110, 3.5), W(-28, -110, 3.5), 2.2, { l: '#e9cf9d', m: '#d2b47a', d: '#8f7647' }, toneI, .8, 2.2, 12);
      ctx.put([[-64, -116, 0], [46, -98, 9]], s, 'LEAD');
      ctx.label(p.load === 'short' ? [-16, -110, 6] : p.load === 'r1k' ? [-33, -110, 5] : [-33, -110, 3], p.load === 'short' ? 'Short circuit' : p.load === 'r1k' ? 'Load' : 'Nothing connected', p.load === 'short' && live);
    }
    ctx.label([OUT[0], Y0 - 11, OUT[1]], 'Output (50 Ω)', !!live);
  },
  stats: st => {
    const o = out(st.p);
    return [
      { label: T('Output'), value: st.p.on && st.p.output ? T('ON') : T('OFF') },
      { label: T('At the load'), value: fmtV(o.v), small: true },
      { label: T('Current'), value: (o.iPk * 1000).toFixed(o.iPk < .01 ? 2 : 0) + ' mA pk', small: true },
    ];
  },
  reportKeys: ['vLoadPp', 'iPeakmA', 'signal'],
  report: st => { const p = st.p, o = out(p), live = p.on && p.output;
    return { vLoadPp: +o.v.toFixed(3), iPeakmA: +(o.iPk * 1000).toFixed(1), signal: live && p.load !== 'short' ? { wave: p.wave, freqHz: p.freqHz, vpp: +o.v.toFixed(3), offset: 0 } : null }; },
  mistake: st => {
    const p = st.p;
    if (!p.on || !p.output) return null;
    if (p.load === 'short') return 'output-shorted';
    if (p.load === 'scope' && p.vpp >= 20) return 'overdrive';
    return null;
  },
  xrCaption: 'See-through: labels for the output and its load',
  xr: {
    anchors: [
      { id: 'port:OUT', kind: 'port', part: 'BNC_OUT', at: [OUT[0], Y0 - 11, OUT[1]], normal: [0, -1, 0], aliases: ['OUT', 'OUTPUT'] },
      { id: 'screen:LCD', kind: 'screen', part: 'PANEL', at: [(LCD[0] + LCD[2]) / 2, Y0 - .4, (LCD[1] + LCD[3]) / 2], normal: [0, -1, 0], text: 'Display',
        rect: { origin: [LCD[0], Y0 - .4, LCD[3]], u: [LCD[2] - LCD[0], 0, 0], v: [0, 0, LCD[1] - LCD[3]], pixels: [240, 90] } },
      { id: 'control:FREQ', kind: 'control', part: 'FREQ', at: [FREQ_K[0], Y0 - 14, FREQ_K[1]], normal: [0, -1, 0], channel: 'turn:FREQ' },
      { id: 'control:AMPL', kind: 'control', part: 'AMPL', at: [AMP_K[0], Y0 - 10, AMP_K[1]], normal: [0, -1, 0], channel: 'turn:AMPL' },
      { id: 'control:OUTPUT', kind: 'control', part: 'OUTKEY', at: [OUTKEY[0], Y0 - 4, OUTKEY[1]], normal: [0, -1, 0], channel: 'led:OUTPUT' },
      { id: 'led:OUTPUT', kind: 'led', part: 'OUTKEY', at: [OUTKEY[0], Y0 - .5, OUTKEY[1] + 8], normal: [0, -1, 0], channel: 'led:OUTPUT' },
      { id: 'control:POWER', kind: 'control', part: 'POWER', at: [PWR[0], Y0 - 3, PWR[1]], normal: [0, -1, 0], channel: 'led:POWER' },
      ...Object.values(WAVES).map(wv => ({ id: `control:KEY_${wv.key}`, kind: 'control', part: 'KEY_' + wv.key, at: [wv.x, Y0 - 4, 37.5], normal: [0, -1, 0], channel: `led:KEY_${wv.key}` })),
    ],
    channels: [
      { id: 'turn:FREQ', kind: 'rotate', part: 'FREQ', value: { unit: 'deg', min: -135, max: 135, rest: freqDeg(1000) }, axis: [0, 1, 0], pivot: [FREQ_K[0], Y0, FREQ_K[1]], scale: Math.PI / 180,
        bind: { source: 'param', key: 'freqHz' }, extras: { deg: '-135 + 270 * (log10(freqHz) + 1) / 7' } },
      { id: 'turn:AMPL', kind: 'rotate', part: 'AMPL', value: { unit: 'deg', min: -135, max: 135, rest: ampDeg(2) }, axis: [0, 1, 0], pivot: [AMP_K[0], Y0, AMP_K[1]], scale: Math.PI / 180,
        bind: { source: 'param', key: 'vpp' }, extras: { degPerVolt: 13.5, degAtZero: -135 } },
      { id: 'led:OUTPUT', kind: 'emissive', part: 'OUTKEY', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#5ee07a', bind: { source: 'param', key: 'output' }, extras: { on: 'params.on && params.output' } },
      { id: 'led:POWER', kind: 'emissive', part: 'POWER', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: '#5ccf78', bind: { source: 'param', key: 'on' } },
      { id: 'led:LCD', kind: 'emissive', part: 'PANEL', value: { unit: 'level', min: 0, max: 1, rest: 1 }, color: '#b8d26a', bind: { source: 'param', key: 'on' } },
      ...Object.entries(WAVES).map(([kk, wv]) => ({ id: `led:KEY_${wv.key}`, kind: 'emissive', part: 'KEY_' + wv.key, value: { unit: 'level', min: 0, max: 1, rest: kk === 'sine' ? 1 : 0 }, color: '#ffcf6a',
        bind: { source: 'param', key: 'wave' }, extras: { on: `params.on && params.wave === "${kk}"` } })),
    ],
    extras: { sourceOhms: ROUT, loads: Object.fromEntries(Object.entries(LOADS).map(([kk, v]) => [kk, Number.isFinite(v.ohms) ? v.ohms : null])),
      toScope: 'report.signal is the oscilloscope demo signal: send it as { source: "demo", ...signal }' },
  },
  lab: {
    lab: 'electronics',
    summary: 'A function generator makes a test signal: a sine, square or triangle wave at the frequency and size you set, from its 50 Ω OUT socket.',
    safeUse: [
      'Set the waveform, frequency and amplitude with the output off, then turn the output on.',
      'Start with a small amplitude, about 1 to 2 V peak-to-peak, and turn it up only as far as you need.',
      'Connect the black (outer) lead to the circuit ground.',
      'Never let the output leads touch each other while the output is on.',
      'Turn the output off before you change the connections.',
    ],
    mistakes: [
      { id: 'output-shorted', when: 'The output is on and its clips touch each other (a short).', say: 'The output is shorted: the clips are touching. Turn the output off, then separate the clips.' },
      { id: 'overdrive', when: 'The output is on into the oscilloscope with the amplitude at its 20 V maximum.', say: 'That is the maximum amplitude, much more than you need. Turn it down to a few volts before it overdrives the circuit or the scope.' },
    ],
    hazards: ['A shorted output heats the generator\'s output stage.', 'Twenty volts peak-to-peak can damage small parts and logic inputs.'],
  },
});
function output(st, api){ if (!st.p.on) return api.say('The generator is off: press Power first'); api.set('output', !st.p.output); api.say(st.p.output ? 'Output on' : 'Output off'); }
function power(st, api){ api.set('on', !st.p.on); if (!st.p.on) api.set('output', false); api.say(st.p.on ? 'Generator on' : 'Generator off'); }
function stepKnob(st, api, key, list, label, fmt){
  const i = list.indexOf(st.p[key]), next = list[(i + 1) % list.length];
  api.set(key, next); api.say('{part} is now {value}', { part: T(label), value: fmt(next) });
}
})();
