// Bench engine adapter (figures/engine/bench.js): boards, modules, part pages and robotics benches.
// The figure's world is Colorfigures coordinates; BP() maps board mm into it with a reflection, which coreToSource
// undoes, so the asset shows the board as its data describes it (docs/XR_ASSETS.md section 2).
//
// What each item is at rest (fully built, power off, nothing selected, explode 0, see-through 0, every mat step on):
// - a board or module: its board view, the PCB with every part on it;
// - a robotics bench: the view the figure opens on (B.mountView: the board view with its mat items and pre-routed
//   wires, or the breadboard view for a bench whose circuit is the point: led-resistor, transistor-switch);
// - a part page (figures/parts/*): the page draws the part in a breadboard view, often several of it (five LED colours,
//   four resistor values). The asset is its first circuit part alone, with the page's params (a demo param at its
//   first, resting value; colour duties and presses off): the breadboard, the other instances and the mat are left
//   out, and y = 0 is the breadboard's top (the leads go into it) or the mat for a part that lies on the mat. The
//   breadboard page itself is the bare half breadboard on the mat. The jumper-wire page keeps its first wire.
// The cutting mat is never in an asset: anything drawn at or below the mat's top is left out.
import { descriptorFor, descriptorName, matchPins, matchLegs } from './bench-desc.mjs';
import { install, info as pageInfo } from './bench-page.mjs';

const KIND = { boards: 'board', modules: 'module', parts: 'part', robotics: 'bench' };
const matches = (item) => /^(boards|modules|parts|robotics)\//.test(item);

const CONNECTOR = /header|socket|jack|usb|term|male|female|pads|castellated|edge|barrel|jst|rj45|hdmi|pmod|ffc|plug|vga|slots|ring|jumper|-pins$|box/i;
const CHIP = /multiwatt|bulk|chip|dip|soic|qfp|qfn|ssop|tssop/i;
const PORT_KINDS = /^(usb-b|usb-micro|usb-mini|usb-c|usb-a|barrel|pi-hdmi|pi-rj45|basys3-usba|microbit-usb)$/;
// how far a push button's cap goes down when pressed (bench-kinds.js tact, button-smd; parts/push-button.js plunger):
// the drawings shorten the cap rather than move it, which no rigid fit recovers, so the press axis and travel are given
const PRESS_MM = { tact: .6, 'button-smd': .3, 'microbit-back-tact': .6, 'push-button': .25 };
const TOUCH = /^(pad|microbit-logo)$/;      // touch pads: pressing changes a colour, nothing moves (no press channel)
const MOTOR_PARTS = new Set(['tt-motor', 'dc-motor', 'fan', 'nema17', 'stepper-28byj48']);
const ROLE_OF_PART = { 'push-button': 'control', potentiometer: 'control', 'servo-sg90': 'motor', wire: 'wire', 'traffic-light': 'led', 'rgb-led': 'led', led: 'led' };
// displays: the active area in the part's own frame (centre origin, x along size[0]) and its pixels; else the top face
const SCREENS = {
  'ssd1306-glass': () => ({ a0: -21.74 / 2, b0: 19.26 / 2 - 2.4, w: 21.74, h: 10.86, z: 1.47, pixels: [128, 64] }),   // figures/modules/ssd1306.js GLASS, AA, AA_TOP
  matrix: (p) => ({ pixels: [p.cols || 5, p.rows || 5] }),
  'microbit-matrix': () => ({ pixels: [5, 5] }),
  'lm2596-disp': () => ({ pixels: [3, 1], type: 'seg7' }),
  'basys3-seg7': () => ({ pixels: [4, 1], type: 'seg7' }),
  'de10-hex': (p) => ({ pixels: [(p.digits || [0, 0]).length, 1], type: 'seg7' }),
  seg7: (p) => ({ pixels: [p.digits || 4, 1], type: 'seg7' }),
};
const BB_DEPTH = 5;      // mm a lead goes into a breadboard hole (the figure draws leads to the hole's mouth)
const WIRE_SEAT = 2;     // mm: the engine seats a jumper's end 2 mm below a header pin's top (bench.js matEnd)

const roleOf = (p) => p.led ? 'led' : p.control ? 'control' : (CONNECTOR.test(p.kind) || (p.pins && !CHIP.test(p.kind))) ? 'connector' : 'part';
const roleOfCircuit = (q) => ROLE_OF_PART[q.part] || (MOTOR_PARTS.has(q.part) ? 'motor' : q.elec.includes('led') ? 'led'
  : q.elec.includes('button') || q.elec.includes('pot') ? 'control' : q.elec.some((e) => e === 'motor' || e === 'servo' || e === 'stepper') ? 'motor' : 'part');
const wireId = (label) => { const m = /^Wire from (.+) to (.+)$/.exec(label || ''); return m ? `wire:${m[1]}-${m[2]}` : 'wire:' + (label || '?'); };
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mean3 = (ps) => { const s = [0, 0, 0]; for (const p of ps) for (let k = 0; k < 3; k++) s[k] += p[k]; return s.map((v) => v / (ps.length || 1)); };
const unit3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

const create = () => ({
  engine: 'bench',
  query: 'power=0',

  async setup(page, { warn }) {
    const B = page.eval('SL.bench');
    if (!B || !B.st || !B.md) throw new Error(`${page.item}: the bench engine did not start`);
    this.B = B; this.page = page; this.warn = warn;
    page.eval(`(${install})()`);
    const st = B.st, md = B.md, MAT = B.matSetup();
    // rest: fully built, every mat step set out, power off, nothing selected or exploded, the view the figure opens on
    if (st.power) B.actions.power(null);
    st.faults = []; st.left = {}; st.drop = {}; st.reflowT = null; st.solderQ = null;
    for (const p of md.parts) st.placed[p.id] = { orient: 0, sold: true };
    st.matStep = MAT.steps.length - 1;
    st.view = B.mountView || 'board';
    st.exploded = false; st.exK = 0; st.xr = 0; st.xrT = 0;
    this.pagePart = md.def.partPage ? md.def.partPage.name : null;
    if (this.pagePart) page.eval(`(() => { const B = SL.bench, st = B.st, c = B.md.circuits[st.circuit]; st.cparams = st.cparams || {};
      for (const q of (c && c.parts) || []) { const def = B.parts[q.part] || {}, pr = def.params || {}, v = {};
        if (Array.isArray(pr.demo)) v.demo = pr.demo[0];
        for (const k of ['r', 'g', 'b', 'pressed', 'on']) if (pr[k]) v[k] = 0;
        st.cparams[q.id] = Object.assign({}, st.cparams[q.id] || {}, v); } })()`);
    B.refresh();
    st.sel = null; st.accent = []; st.msg = '';
    this.info = JSON.parse(page.eval(`(${pageInfo})()`));
    this.ledColors = page.eval('JSON.stringify(SL.bench.LED_COLORS || {})');
    this.ledColors = JSON.parse(this.ledColors);
    page.eval(`SL.bench.__xr.snap = JSON.stringify((() => { const st = SL.bench.st; return { ctl: st.ctl, o: { pins: st.o.pins, leds: st.o.leds }, cparams: st.cparams || {}, readings: st.readings || {}, meas: st.meas || {}, drv: st.drv || {}, t: st.t || 0 }; })())`);
    const G = { ...B.G };
    this.G = G;
    this.BPw = (x, y, z = 0) => [G.ox + G.ph - y, G.oy + G.pw - x, G.top + z];
    this.toBoard = ([X, Y, Z]) => [G.oy + G.pw - Y, G.ox + G.ph - X, Z - G.top];
    const I = this.info;
    // what a part page keeps: its first circuit part, the breadboard on its own page, the first wire on the wire page
    if (this.pagePart) {
      const c = I.circuit;
      this.keep = this.pagePart === 'breadboard' ? 'BB' : c && c.parts.length ? c.parts[0].id : null;
      this.keepWire = !this.keep && I.wires.length ? wireId(`Wire from ${I.wires[0].from} to ${I.wires[0].to}`) : null;
    }
    // the boards drawn: the base board (unless the bench has none), and in the board view each mat board set out
    this.boards = [];
    if (!I.noBoard) this.boards.push({ prefix: '', md: I.base, off: [0, 0, 0], name: I.base.name });
    this.matOn = I.view === 'board' && !I.noBoard;
    if (this.matOn) for (const it of I.mat) if (it.on && it.kind === 'board') this.boards.push({ prefix: it.id + '/', id: it.id, md: it.md, off: [it.at[0], it.at[1], it.dz], name: it.name, board: it.board });
    // descriptors: the item's own, each mat board's, each breadboard part's
    const [dir, fid] = page.item.split('/');
    this.descs = {};
    const kindOf = { boards: 'board', modules: 'module', parts: 'part' }[dir];
    let own = null;
    if (kindOf) own = descriptorFor(kindOf, fid);
    else if (!I.noBoard) { const bd = page.eval(`(() => { const d = SL.bench.md.def; return d.board || null; })()`); if (bd) own = descriptorFor('board', bd); }
    this.descs[''] = own;
    for (const b of this.boards) if (b.prefix) this.descs[b.id] = descriptorFor('board', b.board);
    const frame = {
      source: 'board-mm', origin: 'footprint-centre', restZ: G.matH - G.top,
      coreToSource: ([X, Y, Z]) => [G.oy + G.pw - Y, G.ox + G.ph - X, Z - G.top],
    };
    if (this.pagePart && this.keep && this.keep !== 'BB') {
      const q = I.circuit.parts.find((x) => x.id === this.keep);
      if (q && !q.at) frame.restZ = I.circuit.zTop;     // a part in the breadboard stands on its top
    }
    const extras = {};
    const used = Object.fromEntries(Object.entries(this.descs).filter(([, d]) => d).map(([k, d]) => [k, descriptorName(d)]));
    if (Object.keys(used).length > 1 || (Object.keys(used).length && !used[''])) extras.descriptors = used;
    if (this.pagePart && this.keep && this.keep !== 'BB') extras.partPage = { instance: this.keep };
    return {
      name: I.base.name, kind: KIND[dir], az: st.az, frame,
      ...(own && (this.pagePart ? this.pagePart !== 'wire' : true) ? { descriptor: descriptorName(own) } : {}),
      ...(Object.keys(extras).length ? { extras: { bench: extras } } : {}),
    };
  },

  partOf(ctx, d, g) {
    // the cutting mat and anything lying in it stays out (the headset has its own bench)
    const z = this.G.matH + 1e-3;
    const pts = [...g.faces.flatMap((f) => f.v), ...g.lines.flatMap((l) => l.pts)];
    if (pts.length && pts.every((p) => p[2] <= z)) return null;
    if (g.text && g.text.o[2] <= z) return null;
    const acts = ctx.acts;
    let id = '';
    for (let i = acts.length - 1; i >= 0; i--) {
      const a = acts[i];
      if (a.act === 'xr-part' && a.id) { id = a.id; break; }
      if (a.act === 'pin') { id = wireId(a.label); break; }
      if ((a.act === 'part' || a.act === 'ctl' || a.act === 'periph' || a.act === 'bb') && a.id) { id = a.id; break; }
    }
    if (this.pagePart) {
      if (id === '' ) return pts.length || g.text ? null : '';     // label marks stay (anchors() picks the part's own)
      return id === this.keep || id === this.keepWire ? id : null;
    }
    return id;
  },

  async xray(page, on) { const st = this.B.st; st.xr = st.xrT = on ? 1 : 0; },
  async explode(page, on) { const st = this.B.st; st.exploded = on; st.exK = on ? 1 : 0; },
  async reset(page) {
    page.eval(`(() => { const B = SL.bench, st = B.st, s = JSON.parse(B.__xr.snap);
      st.ctl = s.ctl; st.o.pins = s.o.pins; st.o.leds = s.o.leds; st.cparams = s.cparams; st.readings = s.readings; st.meas = s.meas; st.drv = s.drv; st.t = s.t;
      st.xr = st.xrT = 0; st.exploded = false; st.exK = 0; B.__xr.lit = {}; B.__xr.on = {}; })()`);
  },

  parts() {
    const I = this.info, out = [];
    if (this.pagePart) {
      if (this.keep === 'BB') return [{ id: 'BB', name: 'Breadboard', role: 'part' }];
      const q = I.circuit && I.circuit.parts.find((x) => x.id === this.keep);
      if (q) out.push({ id: q.id, name: `${q.name} ${q.id}`, role: roleOfCircuit(q) });
      if (this.keepWire) out.push({ id: this.keepWire, name: this.keepWire.replace(/^wire:(.+)-(.+)$/, 'Wire from $1 to $2'), role: 'wire' });
      return out;
    }
    for (const b of this.boards) {
      if (b.prefix) {
        const it = I.mat.find((x) => x.id === b.id);
        out.push({ id: b.id, name: b.name, role: it.module ? 'module' : 'board', extras: { board: b.board } });
      }
      for (const p of b.md.parts) out.push({ id: b.prefix + p.id, name: p.name, parent: b.prefix ? b.id : '', role: roleOf(p), group: p.group });
    }
    if (this.matOn) for (const it of I.mat) if (it.on && it.kind === 'part') out.push({ id: it.id, name: it.name, role: MOTOR_PARTS.has(it.part) || it.part === 'servo-sg90' ? 'motor' : 'part', extras: { part: it.part } });
    const c = I.circuit;
    if (c) {
      out.push({ id: 'BB', name: 'Breadboard', role: 'part' });
      for (const q of c.parts) out.push({ id: q.id, name: `${q.name} ${q.id}`, role: roleOfCircuit(q), extras: { part: q.part } });
      for (const q of c.props) out.push({ id: q.id, name: q.name, role: 'part', extras: { prop: q.prop } });
    }
    for (const w of I.wires) if (w.on && (w.mat ? this.matOn : !!c)) { const id = wireId(`Wire from ${w.from} to ${w.to}`); out.push({ id, name: `Wire from ${w.from} to ${w.to}`, role: 'wire' }); }
    return out;
  },

  async channels(page, { warn }) {
    const I = this.info, out = [];
    const ev = (src) => page.eval(src);
    const js = (v) => JSON.stringify(v);
    const motors = this.motorChans = [];
    // board LEDs and buttons: the base board's from the engine's own state, a mat board's through the draw override
    for (const b of this.boards) {
      for (const p of b.md.parts) {
        const id = b.prefix + p.id;
        if (p.led) {
          const L = p.led, key = (k) => b.prefix + k;
          const rgb = p.kind === 'rgb';
          const bind = L.net ? { source: 'net', key: key(L.net) } : L.rail ? { source: 'rail', key: key(L.rail) } : L.serial ? { source: 'serial', key: key(String(L.serial)) } : undefined;
          const lit = p.kind === 'matrix' ? `st.o.pins[${js(L.net || 'MATRIX')}] = '1'.repeat(${(p.rows || 5) * (p.cols || 5)});` : rgb ? `st.o.pins[${js((L.net || '') + '.rgb')}] = '#ffffff';` : '';
          out.push({ id: `led:${id}`, kind: 'emissive', part: id, parts: [id], value: rgb ? { unit: 'rgb', min: 0, max: 1, rest: 0 } : { unit: 'level', min: 0, max: 1, rest: 0 },
            ...(rgb ? {} : { color: (L.color || '#f7a531').toLowerCase() }), bind,
            apply: () => ev(b.prefix ? `SL.bench.__xr.lit[${js(id)}] = 1; (() => { const st = SL.bench.st; ${lit} })()` : `(() => { const st = SL.bench.st; st.o.leds[${js(p.id)}] = 1; ${lit} })()`) });
        }
        if (p.control && p.control.type === 'button' && !TOUCH.test(p.kind)) {
          const mm = PRESS_MM[p.kind];
          out.push({ id: `press:${id}`, kind: 'translate', part: id, parts: [id], value: { unit: 'press', min: 0, max: 1, rest: 0 }, bind: { source: 'press', key: id },
            ...(mm ? { axis: p.side === 'bottom' ? [0, 0, 1] : [0, 0, -1], amount: mm } : {}),
            apply: () => ev(b.prefix ? `SL.bench.__xr.on[${js(id)}] = true` : `SL.bench.st.ctl[${js(p.id)}] = 1`) });
        }
      }
    }
    // mat parts and breadboard parts: LEDs, buttons, knobs, servos and motors from the solver's and the model's state
    const circuit = this.pagePart ? (I.circuit ? I.circuit.parts.filter((q) => q.id === this.keep) : []) : I.circuit ? I.circuit.parts : [];
    const cp = (id, patch) => `(() => { const st = SL.bench.st; st.cparams = st.cparams || {}; st.cparams[${js(id)}] = Object.assign({}, st.cparams[${js(id)}] || {}, ${js(patch)}); })()`;
    const cur = (id) => JSON.parse(ev(`JSON.stringify((() => { const B = SL.bench, st = B.st, c = B.md.circuits[st.circuit], q = c && (c.parts || []).find((x) => x.id === ${js(id)}), def = q && B.parts[q.part];
      return q ? Object.assign({}, (def && def.defaults) || {}, (def && def.example) || {}, q, (st.cparams || {})[q.id] || {}) : {}; })())`));
    for (const q of circuit) {
      const id = q.id;
      if (q.part === 'rgb-led') {
        out.push({ id: `led:${id}`, kind: 'emissive', part: id, parts: [id], value: { unit: 'rgb', min: 0, max: 1, rest: 0 }, apply: () => ev(cp(id, { r: 1, g: 1, b: 1 })) });
      } else if (q.elec.includes('led')) {
        out.push({ id: `led:${id}`, kind: 'emissive', part: id, parts: [id], value: { unit: 'level', min: 0, max: 1, rest: 0 },
          color: (this.ledColors[q.color || 'red'] || '#e8392e').toLowerCase(),
          apply: () => ev(`SL.bench.st.meas[${js(id)}] = { kind: 'led', state: 'ok', i_mA: 13.6, r: 220 }`) });
      }
      if (q.press && q.params.includes('pressed')) {
        const mm = PRESS_MM[q.part];
        out.push({ id: `press:${id}`, kind: 'translate', part: id, parts: [id], value: { unit: 'press', min: 0, max: 1, rest: 0 }, bind: { source: 'press', key: id },
          ...(mm ? { axis: [0, 0, -1], amount: mm } : {}), apply: () => ev(cp(id, { pressed: 1 })) });
      }
      if (q.params.includes('pos') && q.elec.includes('pot')) {
        const pos = +cur(id).pos || 0, sweep = 300, to = pos > .5 ? pos - .25 : pos + .25;
        out.push({ id: `turn:${id}`, kind: 'rotate', part: id, parts: [id], value: { unit: 'deg', min: -sweep / 2, max: sweep / 2, rest: +((pos - .5) * sweep).toFixed(3) },
          active: (to - .5) * sweep, bind: { source: 'param', key: `${id}.pos` }, extras: { param: 'pos', deg: `(pos - 0.5) * ${sweep}` }, apply: () => ev(cp(id, { pos: to })) });
      }
      if (q.elec.includes('servo') || q.part === 'servo-sg90') {
        const a0 = JSON.parse(ev(`JSON.stringify(((SL.bench.st.drv || {})[${js(id)}] || {}).a ?? null)`));
        const rest = a0 != null ? a0 : q.angle != null ? q.angle : 90, to = rest <= 90 ? rest + 45 : rest - 45;
        out.push({ id: `servo:${id}`, kind: 'rotate', part: id, parts: [id], value: { unit: 'deg', min: 0, max: 180, rest }, active: to, bind: { source: 'param', key: `${id}.angle` },
          apply: () => ev(`(() => { const st = SL.bench.st; (st.drv = st.drv || {})[${js(id)}] = Object.assign({}, st.drv[${js(id)}] || {}, { a: ${to}, t: st.t || 0 }); })(); ${cp(id, { demo: null, angle: to })}`) });
      }
      if (MOTOR_PARTS.has(q.part)) motors.push({ id, part: q.part });
    }
    if (this.matOn) for (const it of I.mat) if (it.on && it.kind === 'part' && MOTOR_PARTS.has(it.part)) motors.push({ id: it.id, part: it.part });
    for (const m of motors) {
      const id = m.id;
      const ch = { id: `motor:${id}`, kind: 'spin', part: id, parts: [id], value: { unit: 'rpm', min: -300, max: 300, rest: 0 }, bind: { source: 'motor', key: id },
        // the sense of a positive speed about the asset's axis, read once the core has fitted the turn: the bench frame
        // is a mirror of the figure's world (det -1), so a turn about the fitted axis there is the opposite turn here
        get scale() { const s = Math.sign(this.fitAngle || 0); return s ? -s : 1; },
        // live with no speed and the shaft turned on by 60 degrees: a positive speed turns it the same way (the drawings
        // add rpm x dt to the angle)
        apply: () => ev(`(() => { const st = SL.bench.st, r = { kind: 'motor', state: 'ok', v: 0, i_mA: 0, rpm: 0 };
          (st.meas = st.meas || {})[${js(id)}] = r; (st.readings = st.readings || {})[${js(id)}] = Object.assign({}, r);
          (st.drv = st.drv || {})[${js(id)}] = Object.assign({ rpm: 0, h: 0, on: {}, state: 'ok' }, st.drv[${js(id)}] || {}, { rpm: 0, a: 60, h: 60, t: st.t || 0 }); })()`) };
      out.push(ch); m.ch = ch;
    }
    void warn;
    return out;
  },

  async anchors(page, { marks, warn, rest }) {
    const I = this.info, out = [], BPw = this.BPw, toBoard = this.toBoard;
    // the rest geometry per part, in base board mm: what a pin's tip or a part's top is found from
    const geo = new Map();
    for (const d of rest.draws) {
      if (!d.faces.length) continue;
      if (!geo.has(d.part)) geo.set(d.part, []);
      for (const f of d.faces) {
        const v = f.v.map(toBoard);
        const lo = [Math.min(...v.map((p) => p[0])), Math.min(...v.map((p) => p[1])), Math.min(...v.map((p) => p[2]))];
        const hi = [Math.max(...v.map((p) => p[0])), Math.max(...v.map((p) => p[1])), Math.max(...v.map((p) => p[2]))];
        geo.get(d.part).push({ lo, hi });
      }
    }
    const boundsOf = (part) => { const fs = geo.get(part); if (!fs || !fs.length) return null; const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const f of fs) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], f.lo[k]); hi[k] = Math.max(hi[k], f.hi[k]); } return { lo, hi }; };
    // the z range of a part's faces over one board point
    const over = (part, x, y, e = .05) => { const zs = []; for (const f of geo.get(part) || []) if (x >= f.lo[0] - e && x <= f.hi[0] + e && y >= f.lo[1] - e && y <= f.hi[1] + e) zs.push(f.lo[2], f.hi[2]); return zs; };
    const W = (pt) => BPw(pt[0], pt[1], pt[2]);
    const UP = [0, 0, 1], DOWN = [0, 0, -1];
    const BACK = [-1, 0, 0];      // world direction of board +y (B.wdir(0, 1)): a label's top points to the back
    const partFrame = (b, p) => {
      const r = (p.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), th = b.md.pcb.thick;
      return (a, bb, z) => add3(b.off, [p.at[0] + a * c - bb * s, p.at[1] + a * s + bb * c, p.side === 'bottom' ? -th - p.z - z : p.z + z]);
    };
    const dirOf = (b, p, a, bb) => { const L = partFrame(b, p); const v = sub3(L(a, bb, 0), L(0, 0, 0)); return unit3([-v[1], -v[0], 0]); };   // a board direction as a world direction

    // ---- boards: pins, headers, LEDs, controls, ports, screens
    for (const b of this.boards) {
      const desc = this.descs[b.prefix ? b.id : ''];
      const parts = Object.fromEntries(b.md.parts.map((p) => [p.id, p]));
      const { map, twins, unmatched } = desc ? matchPins(desc, b.md.pins, parts) : { map: new Map(), twins: new Map(), unmatched: [] };
      if (desc && unmatched.length) warn(`${b.prefix || ''}${descriptorName(desc)}: ${unmatched.length} descriptor pin${unmatched.length === 1 ? '' : 's'} match no figure pin (${unmatched.slice(0, 6).map((q) => q.id).join(', ')}${unmatched.length > 6 ? ', ...' : ''})`);
      const kept = b.md.pins.filter((q) => !map.has(q.id) && !twins.has(q.id)).length;
      if (desc && kept) warn(`${b.prefix || ''}${descriptorName(desc)}: ${kept} figure pin${kept === 1 ? '' : 's'} match no descriptor pin and keep the figure's id`);
      const pinIds = new Map();
      const twinOf = new Map();      // primary figure pin -> its co-located twins' figure ids (aliases)
      for (const [t, prim] of twins) { if (!twinOf.has(prim)) twinOf.set(prim, []); twinOf.get(prim).push(t); }
      for (const pin of b.md.pins) {
        if (twins.has(pin.id)) continue;
        const p = parts[pin.part], dp = map.get(pin.id), part = b.prefix + pin.part;
        const id = b.prefix + (dp ? dp.id : pin.id);
        const X = b.off[0] + pin.at[0], Y = b.off[1] + pin.at[1];
        const zs = over(part, X, Y);
        let z, n = UP, depth = null;
        if (p.side === 'bottom') {
          // a pin through the board from below: its stub on top is where the figure's wires end; else its tip below
          const above = zs.filter((v) => v >= b.off[2] - .01);
          if (above.length) z = Math.max(...above); else { z = zs.length ? Math.min(...zs) : b.off[2] - b.md.pcb.thick - p.z - p.h; n = DOWN; }
        } else {
          z = zs.length ? Math.max(...zs) : b.off[2] + p.z + p.h;
          if (z - b.off[2] - p.z >= WIRE_SEAT) depth = WIRE_SEAT;
        }
        pinIds.set(pin.id, id);
        const aliases = [pin.net, pin.label, dp ? pin.id : null, dp && dp.designator, ...(twinOf.get(pin.id) || [])].filter((a) => a && a !== (dp ? dp.id : pin.id)).map((a) => b.prefix + a);
        out.push({ id, kind: 'pin', part, position: W([X, Y, z]), normal: n, aliases: [...new Set(aliases)], ...(depth ? { depth } : {}),
          extras: { figurePin: b.prefix + pin.id } });
      }
      for (const [t, prim] of twins) pinIds.set(t, pinIds.get(prim));
      for (const p of b.md.parts) {
        const id = b.prefix + p.id, L = partFrame(b, p), [l, w] = p.size;
        if (p.pins && p.pins.filter((x) => x !== null).length >= 2 && roleOf(p) === 'connector') {
          const members = b.md.pins.filter((q) => q.part === p.id).sort((x, y) => x.n - y.n).map((q) => pinIds.get(q.id));
          const pos = mean3(out.filter((a) => members.includes(a.id)).map((a) => a.position));
          out.push({ id: `header:${id}`, kind: 'header', part: id, position: pos, normal: p.side === 'bottom' && !out.find((a) => a.id === members[0]).normal[2] ? DOWN : out.find((a) => a.id === members[0]).normal, members, text: p.name });
        }
        const top = p.side === 'bottom' ? DOWN : UP;
        if (p.led) out.push({ id: `led:${id}`, kind: 'led', part: id, position: W(L(0, 0, p.h)), normal: top, channel: `led:${id}`, text: p.name });
        if (p.control) {
          const side = p.kind === 'button-smd' && p.side && p.side !== 'top' && p.side !== 'bottom';
          out.push({ id: `control:${id}`, kind: 'control', part: id, position: W(side ? L(0, -w / 2 - .8, p.h * .33) : L(0, 0, p.h)), normal: side ? dirOf(b, p, 0, -1) : top, text: p.name,
            ...(p.control.type === 'button' ? { channel: `press:${id}` } : {}), extras: { type: p.control.type, ...(p.control.net ? { net: b.prefix + p.control.net } : {}) } });
        }
        const isSource = Object.values(b.md.sources || {}).some((s) => s && s.part === p.id);
        if (PORT_KINDS.test(p.kind) || p.plug || isSource) {
          // a socket opens at its -x end (bench-kinds.js usb-*, barrel; pi-hdmi, pi-rj45, basys3-usba); a screw
          // terminal's wire entries are on its -y face (l298n-term and the like)
          const term = /-term$/.test(p.kind);
          const zc = p.kind === 'barrel' ? p.h * .55 : term ? 2.9 : p.h / 2;
          const src = Object.entries(b.md.sources || {}).find(([, s]) => s && s.part === p.id);
          out.push({ id: `port:${id}`, kind: 'port', part: id, position: W(term ? L(0, -w / 2, zc) : L(-l / 2, 0, zc)), normal: term ? dirOf(b, p, 0, -1) : dirOf(b, p, -1, 0), text: p.name,
            ...(src ? { extras: { source: src[0], ...(src[1].label ? { label: src[1].label } : {}) } } : {}) });
        }
        const sc = SCREENS[p.kind] && SCREENS[p.kind](p);
        if (sc) {
          const a0 = sc.a0 ?? -l / 2, b0 = sc.b0 ?? w / 2, sw = sc.w ?? l, sh = sc.h ?? w, z = sc.z ?? p.h + .02;
          const o = L(a0, b0, z), U = sub3(L(a0 + sw, b0, z), o), V = sub3(L(a0, b0 - sh, z), o);
          const wv = (v) => sub3(BPw(v[0], v[1], v[2]), BPw(0, 0, 0));
          out.push({ id: `screen:${id}`, kind: 'screen', part: id, position: W(L(a0 + sw / 2, b0 - sh / 2, z)), normal: top, text: p.name,
            rect: { origin: W(o), u: wv(U), v: wv(V), pixels: sc.pixels }, ...(sc.type ? { extras: { type: sc.type } } : {}) });
        }
      }
    }

    // ---- the breadboard: holes, strips, rails
    const c = I.circuit;
    const keepBB = c && (!this.pagePart || this.keep === 'BB');
    if (keepBB) {
      const g = c.geo, bp = this.pagePart ? '' : 'BB/';
      const at = (x, y) => BPw(c.ox + x, c.oy + y, c.zTop);
      const colX = (k) => g.x0 + (k - 1) * 2.54;
      const strips = [];
      for (let k = 1; k <= g.cols; k++) {
        for (const [half, rows] of [['u', 'abcde'], ['l', 'fghij']]) {
          const members = [];
          for (const r of rows) { const id = `${r}${k}`; members.push(bp + id); out.push({ id: bp + id, kind: 'hole', part: 'BB', position: at(colX(k), g.rowY[r]), normal: UP, depth: BB_DEPTH }); }
          strips.push({ id: `strip:${bp}S${k}${half}`, kind: 'strip', part: 'BB', position: at(colX(k), (g.rowY[rows[0]] + g.rowY[rows[4]]) / 2), normal: UP, members });
        }
      }
      const RAIL = { 'T+': 'RAIL_TP', 'T-': 'RAIL_TN', 'B+': 'RAIL_BP', 'B-': 'RAIL_BN' };
      const rails = [];
      for (const [ref, rid] of Object.entries(RAIL)) {
        if (g.rails[ref] == null) continue;
        const members = [];
        for (const k of g.railCols) { const id = `${rid}${k}`; members.push(bp + id); out.push({ id: bp + id, kind: 'hole', part: 'BB', position: at(colX(k), g.rails[ref]), normal: UP, depth: BB_DEPTH, aliases: [bp + ref + k] }); }
        rails.push({ id: `rail:${bp}${rid}`, kind: 'rail', part: 'BB', position: at((colX(g.railCols[0]) + colX(g.railCols[g.railCols.length - 1])) / 2, g.rails[ref]), normal: UP, members, text: ref });
      }
      out.push(...strips, ...rails);
    }

    // ---- breadboard parts and mat parts: their legs, and the LED, control and screen points of the part
    const legParts = [];
    if (c) for (const q of c.parts) if (!this.pagePart || q.id === this.keep) legParts.push({ id: q.id, part: q.part, legs: q.legs, legW: q.legW, q });
    if (this.matOn) for (const it of I.mat) if (it.on && it.kind === 'part') legParts.push({ id: it.id, part: it.part, legs: it.legs, legW: it.legW.map((w) => ({ w, up: true })), mat: true });
    for (const lp of legParts) {
      const desc = descriptorFor('part', lp.part), pfx = this.pagePart ? '' : lp.id + '/';
      const dps = matchLegs(desc, lp.legs);
      lp.legs.forEach((name, i) => {
        const e = lp.legW[i];
        if (!e) return;
        const dp = dps[i], id = pfx + (dp ? dp.id : name);
        const aliases = [name, dp && dp.designator].filter((a) => a && a !== (dp ? dp.id : name)).map((a) => pfx + a);
        out.push({ id, kind: 'pin', part: lp.id, position: e.w, normal: e.up ? UP : DOWN, aliases: [...new Set(aliases)],
          extras: { leg: name, ...(e.hole ? { hole: e.hole } : {}), ...(lp.mat ? { onMat: true } : {}) } });
      });
      const bd = boundsOf(lp.id);
      if (bd && lp.q) {
        const role = roleOfCircuit(lp.q), topC = [(bd.lo[0] + bd.hi[0]) / 2, (bd.lo[1] + bd.hi[1]) / 2, bd.hi[2]];
        if (role === 'led') out.push({ id: `led:${lp.id}`, kind: 'led', part: lp.id, position: W(topC), normal: UP, channel: lp.part === 'traffic-light' ? undefined : `led:${lp.id}`, text: lp.q.name });
        if (role === 'control') out.push({ id: `control:${lp.id}`, kind: 'control', part: lp.id, position: W(topC), normal: UP, text: lp.q.name,
          channel: lp.part === 'potentiometer' ? `turn:${lp.id}` : lp.part === 'push-button' ? `press:${lp.id}` : undefined });
      }
    }
    // jumper wires on the wire page: its two ends
    if (this.keepWire) {
      const w = I.wires[0], g = c.geo, hole = (ref) => { const m = /^([a-j])(\d{1,2})$/.exec(ref); return m ? BPw(c.ox + g.x0 + (+m[2] - 1) * 2.54, c.oy + g.rowY[m[1]], c.zTop) : null; };
      [w.from, w.to].forEach((ref, i) => { const p = hole(ref); if (p) out.push({ id: String(i + 1), kind: 'pin', part: this.keepWire, position: p, normal: DOWN, extras: { hole: ref } }); });
    }

    // ---- motors: on the fitted axis at the hub's top. The fitted pivot is the axis point nearest the turning parts'
    // centre (the wheel, the shaft, the fan's blades); the motor's body lies to one side of it along the axis, the hub
    // on the other, so the hub's top is the part's farthest point on the side away from the body.
    for (const m of this.motorChans || []) {
      const ch = m.ch;
      if (!ch.fitAxis || !ch.fitPivot) { warn(`${ch.id}: no fitted axis, so no motor anchor`); continue; }
      const ax = ch.fitAxis, pv = ch.fitPivot;
      let sum = 0, n = 0, lo = 0, hi = 0;
      for (const d of rest.draws) if (d.part === m.id) for (const f of d.faces) for (const v of f.v) {
        const t = (v[0] - pv[0]) * ax[0] + (v[1] - pv[1]) * ax[1] + (v[2] - pv[2]) * ax[2];
        sum += t; n++; lo = Math.min(lo, t); hi = Math.max(hi, t);
      }
      const side = n && sum / n > 0 ? -1 : 1, t = side > 0 ? hi : lo;
      out.push({ id: `motor:${m.id}`, kind: 'motor', part: m.id, position: add3(pv, ax.map((x) => x * t)), normal: ax.map((x) => x * side), channel: ch.id,
        extras: { model: m.part } });
    }

    // ---- labels: the figure's surface tags (label:<part>) and see-through callouts (label:<part>.<n>, layer xray)
    const owners = [...geo.keys()].filter((k) => k !== '').map((k) => ({ k, b: boundsOf(k) })).filter((o) => o.b);
    const ownerOf = (w) => {
      const [x, y] = toBoard(w);
      let best = null, ba = Infinity;
      for (const o of owners) { const { lo, hi } = o.b; if (x >= lo[0] - .5 && x <= hi[0] + .5 && y >= lo[1] - .5 && y <= hi[1] + .5) { const a = (hi[0] - lo[0]) * (hi[1] - lo[1]); if (a < ba) { ba = a; best = o.k; } } }
      if (best != null) return best;
      let bd = 15;
      for (const o of owners) { const cx = (o.b.lo[0] + o.b.hi[0]) / 2, cy = (o.b.lo[1] + o.b.hi[1]) / 2, d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = o.k; } }
      return best ?? '';
    };
    const seen = new Set(out.map((a) => a.id)), count = new Map();
    for (const mk of marks) {
      if (!Array.isArray(mk.at) || !mk.text) continue;
      const part = ownerOf(mk.at);
      if (this.pagePart && part !== this.keep && part !== this.keepWire) continue;
      const name = part || String(mk.text).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      let id;
      if (mk.kind === 'tag') { id = `label:${name}`; if (seen.has(id)) continue; }
      else { const n = (count.get(name) || 0) + 1; count.set(name, n); id = `label:${name}.${n}`; }
      seen.add(id);
      out.push({ id, kind: 'label', part, position: mk.at, normal: UP, up: BACK, text: mk.text, layer: mk.kind === 'tag' ? 'base' : 'xray' });
    }

    // aliases never name another anchor
    const ids = new Set(out.map((a) => a.id));
    for (const a of out) if (a.aliases) { a.aliases = a.aliases.filter((x) => !ids.has(x)); if (!a.aliases.length) delete a.aliases; }
    for (const a of out) if (a.channel === undefined) delete a.channel;
    return out;
  },
});

export default { matches, create };
