// Drone engine adapter (figures/engine/drone.js): the crafts in figures/drones.
// The engine maps craft mm (x forward, y left, z up, z = 0 on the mat; docs/FIGURES-DRONE.md section 2) into the
// Colorfigures world with a pure translation (SD.W in drone-geo.js), and the Colorfigures camera is mirrored (R x U =
// -V), so the 2D figure is the mirror image of the craft data. coreToSource undoes the translation only; the asset then
// holds the data's true geometry (docs/XR_ASSETS.md section 2): M1 of a Betaflight quad is rear-right, -X and -Z.
import { capture } from './assemble.mjs';
import { axisAngle, fitRigid as rigidFit } from './fit.mjs';
import { add, sub, scale, dot, cross, norm, len, avg } from '../gltf/geom.mjs';

const matches = (item) => /^drones\//.test(item);
const MT = 4;                                   // the mat's thickness: drone.js scene() puts the craft's z = 0 on it
const SPIN_STEP = 0.1;                          // rad a spin channel turns its motor by to find what moves

// Motion a craft keeps in its own state rather than the engine's (figures/drones/<id>.js): how to pose it, the value
// that pose stands for, and the craft-mm hinge the figure draws it about (checked against the fit).
const CRAFT_CHANNELS = {
  // gpscam.js gimbalPitch: the gimbal test's keyframes run -20 -> -90 (1 s in) -> +25 -> -20 deg; camera about o = [X0, 0, 64]
  gpscam: [{ id: 'servo:GIMBAL', part: 'GIMBAL', value: { unit: 'deg', min: -90, max: 25, rest: -20 }, active: -90,
    bind: { source: 'param', key: 'GIMBAL.pitch' }, extras: { axis: 'pitch', note: 'camera pitch, + nose up; roll is held level' },
    pose: (st, gc0) => { st.gc = { ...JSON.parse(gc0), gimbalT0: st.t - 1 }; }, state: 'gc', hingeDir: [0, 1, 0] }],
};

const role = (p) => {
  const kinds = [].concat(p.piece || []).map((pc) => pc.kind);
  if (p.id === 'FRAME' || kinds.includes('frame')) return 'frame';
  if (p.id === 'MOTORS') return 'motor';
  if (p.id === 'PROPS') return 'prop';
  if (p.id === 'WIRES') return 'wire';
  if (p.id === 'LED') return 'led';
  if (p.id === 'XT60') return 'connector';
  if (p.cover && p.id !== 'BATT') return 'cover';
  if (kinds.includes('board')) return 'board';
  return 'part';
};

/** The engine's own motor frame, as data: the mount point and the shaft direction, craft-local. */
function dataAxis(SD, craft, mo) {
  const Mf = SD.motorFrame(mo, SD.motorZ(craft)), o = Mf(0, 0, 0), q = Mf(0, 0, 1);
  return { origin: [o[0], o[1], o[2]], axis: norm(sub([q[0], q[1], q[2]], o)) };
}

/** Pairs moved draws of one part (rest -> driven) by vertex count and nearest centroid; returns point lists. byFit
    pairs each with the candidate it fits best as one rigid piece instead: after a big turn a box's faces (all 9
    points, all alike) land nearer another face's rest place than their own. */
function pairMoved(rest, act, part, byFit = false) {
  const key = (d) => d.geo;
  const R = rest.filter((d) => d.part === part), A = act.filter((d) => d.part === part);
  const count = new Map();
  for (const d of A) count.set(key(d), (count.get(key(d)) || 0) + 1);
  const gone = [];
  for (const d of R) { const n = count.get(key(d)) || 0; if (n > 0) count.set(key(d), n - 1); else gone.push(d); }
  const restKeys = new Map();
  for (const d of R) restKeys.set(key(d), (restKeys.get(key(d)) || 0) + 1);
  const came = [];
  for (const d of A) { const n = restKeys.get(key(d)) || 0; if (n > 0) restKeys.set(key(d), n - 1); else came.push(d); }
  const vs = (d) => [...d.faces.flatMap((f) => f.v), ...d.lines.flatMap((l) => l.pts)];
  const P = [], Q = [], used = new Set();
  for (const g of gone) {
    const a = vs(g), ca = avg(a);
    let best = null, bd = Infinity;
    for (const c of came) {
      if (used.has(c)) continue;
      const b = vs(c);
      if (b.length !== a.length) continue;
      const dd = byFit ? rigidFit(a, b).rms * 1e3 + len(sub(avg(b), ca)) * 1e-3 : len(sub(avg(b), ca));
      if (dd < bd) { bd = dd; best = c; }
    }
    if (!best) continue;
    used.add(best);
    P.push(...a); Q.push(...vs(best));
  }
  return { gone, came, P, Q };
}

const create = () => ({
  engine: 'drone',

  async setup(page) {
    const SD = page.eval('SL.drone');
    const craft = SD && SD.craft && SD.craft();
    if (!craft || !SD.ui()) throw new Error(`${page.item}: the drone engine did not start`);
    this.SD = SD; this.craft = craft;
    const st = SD.ui().st;
    this.st = st;
    // rest: fully built, every part landed and the right way round, unplugged, motors still, no test, no sheet,
    // closed, see-through off, nothing selected
    for (const p of craft.parts) st.placed[p.id] = { t: 1, orient: 0, leave: false, delay: 0 };
    Object.assign(st, { plugged: false, fault: null, popT: 0, smoke: [], test: null, queue: [], queueT: 0, later: [], sheet: null,
      ex: 0, exT: 0, exploded: false, xr: 0, xrT: 0, sel: null });
    st.rpm = st.rpm.map(() => 0);
    this.snap = JSON.stringify(st);
    // Two engine helpers draw for the 2D sort, not for 3D, so on this capture page only they are swapped (the figure
    // file and its built page are unchanged):
    // - g.wire builds its SVG from P() itself rather than pd(), so the capture would see no 3D behind any wire or
    //   cable: each wire segment becomes a core rod() of the wire's own thickness, a real tube;
    // - g.rod cuts a rod into 12 mm pieces so it depth-sorts at every angle, and each piece's end rings would ink a
    //   ladder along every antenna, boom and pushrod: it becomes one rod() end to end, with the same rings at its ends.
    page.eval(`(() => { const SD = SL.drone, g = SD.g; if (g.wire.xrTube) return;
      const wire = (pts, color, d = 1.6) => { const out = [], m = matOf(SD.colOf(color));
        for (let i = 0; i + 1 < pts.length; i++){ const p = SD.W(...pts[i]), q = SD.W(...pts[i + 1]);
          if (SD.len3(p, q) > 1e-6) out.push({ box: SD.bbox([p, q], d / 2), svg: rod(p, q, d / 2, m, toneI, 0, d / 2, 8) }); }
        return out; };
      const whole = (a, b, r, c, maxL = 12, n = 8) => { const p = SD.W(...a), q = SD.W(...b);
        return [{ box: SD.bbox([p, q], r), svg: rod(p, q, r, SD.mat(c), tone, .8, r, n) }]; };
      wire.xrTube = true; g.wire = wire; g.rod = whole; })()`);
    const M = craft.mat;
    this.G = { ox: M / 2, oy: M / 2, oz: MT };
    const g = this.G;
    const design = SD.resolved(st);
    return {
      name: craft.title, kind: 'drone', az: st.az,
      extras: {
        craft: craft.id, layout: craft.frame.layout, numbering: craft.frame.numbering || null, design: { ...st.design },
        explodeMm: craft.explode, mirroredFigure: true,
        motors: craft.motors.map((m) => ({ id: m.id, at: [+m.x.toFixed(3), +m.y.toFixed(3), m.z], dir: m.dir, tilt: m.tilt || 0 })),
        battery: { cells: design.batt.cells, chem: design.batt.chem || 'lipo' },
      },
      frame: { source: 'flu-mm', origin: 'craft-centre', restZ: 0, coreToSource: ([X, Y, Z]) => [X - g.ox, Y - g.oy, Z - g.oz] },
    };
  },

  /** craft-local mm -> Colorfigures world at rest (SD.W with G.dz = 0) */
  W([x, y, z]) { const g = this.G; return [x + g.ox, y + g.oy, z + g.oz]; },

  partOf(ctx, d, g) {
    for (let i = ctx.acts.length - 1; i >= 0; i--) { const a = ctx.acts[i]; if (a.act === 'part' && a.id) return a.id; }
    // outside every part: the bench mat (SD.matSvg) stays out; label pills and callouts are kept for their anchor points
    if (g.marks && g.marks.length) return '';
    return null;
  },

  async xray(page, on) { const st = this.st; st.xr = st.xrT = on ? 1 : 0; },
  async explode(page, on) { const st = this.st; st.ex = st.exT = on ? 1 : 0; st.exploded = !!on; },
  async reset() {
    const st = this.st, s = JSON.parse(this.snap);
    for (const k of Object.keys(st)) if (!(k in s)) delete st[k];
    Object.assign(st, s);
  },

  parts() {
    const craft = this.craft;
    return craft.parts.map((p) => ({
      id: p.id, name: p.name || p.short, role: role(p), cover: !!p.cover, after: p.after || [],
      extras: { short: p.short, z: p.z || 0, explodeMm: craft.explode, ...(p.polar ? { polar: p.polar } : {}) },
    }));
  },

  async channels(page, { warn }) {
    const SD = this.SD, craft = this.craft, st = this.st, out = [];
    const design = SD.resolved(st), b = design.batt, kv = design.motor.kv || 0;
    const volts = b.cells * (b.chem === 'lihv' ? 4.35 : 4.2);
    const maxRpm = kv > 0 ? Math.round(kv * volts / 100) * 100 : 30000;
    if (!(kv > 0)) warn(`the motor "${st.design.motor}" gives no kv, so the spin channels' maximum is a guess (30000 rpm)`);
    const rest = capture(page, this).draws;
    const Rp = design.prop.d * 25.4 / 2;
    const vertsNear = (part, p0, a, r) => rest.filter((d) => d.part === part).flatMap((d) => [...d.faces.flatMap((f) => f.v), ...d.lines.flatMap((l) => l.pts)])
      .filter((v) => { const q = sub(v, p0); return len(sub(q, scale(a, dot(q, a)))) <= r; });
    this.axes = [];
    craft.motors.forEach((mo, i) => {
      const d = dataAxis(SD, craft, mo);
      // the figure's own motion: turn this motor's rotor a little (as the motor test does) and fit the rigid motion of
      // what moved, so the channel's axis is the one the figure turns the rotor about
      const s0 = st.spin[i];
      st.spin[i] = s0 + SPIN_STEP;
      const act = capture(page, this).draws;
      st.spin[i] = s0;
      const fits = {}, moved = {};
      for (const part of ['PROPS', 'MOTORS']) {
        const m = pairMoved(rest, act, part);
        moved[part] = m.gone.length;
        if (m.P.length < 3) continue;
        const fit = rigidFit(m.P, m.Q), aa = axisAngle(fit, avg(m.P));
        if (fit.rms < 0.01 && Math.abs(aa.angle - SPIN_STEP) < 1e-4) fits[part] = { axis: aa.axis, pivot: aa.pivot };
        else warn(`${mo.id}: what moved in ${part} when the rotor turned is not one rigid turn (rms ${fit.rms.toFixed(3)} mm, ${(aa.angle * 180 / Math.PI).toFixed(2)} deg), so the craft data's axis is used`);
      }
      const ref = fits.PROPS || fits.MOTORS;
      let axisW = d.axis, line = this.W(d.origin);
      if (ref) {
        const off = Math.acos(Math.max(-1, Math.min(1, dot(ref.axis, d.axis)))) * 180 / Math.PI;
        if (off > 1) warn(`${mo.id}: the figure turns the rotor about [${ref.axis.map((v) => +v.toFixed(3))}] (craft x, y, z), ${off.toFixed(0)} deg from the shaft the craft data gives (frame.motors tilt ${mo.tilt || 0}); the drawn axis is used`);
        axisW = ref.axis; line = ref.pivot;
      }
      this.axes[i] = { axis: axisW, point: line, fitted: !!ref };
      const onAxis = (p) => add(line, scale(axisW, dot(sub(p, line), axisW)));
      const sense = mo.dir === 'CW' ? -1 : 1;
      const value = { unit: 'rpm', min: 0, max: maxRpm, rest: 0 };
      const bind = { source: 'motor', key: mo.id };
      const extras = { dir: mo.dir, kv, volts: +volts.toFixed(2) };
      const turn = () => { st.spin[i] = s0 + SPIN_STEP; };
      // a prop drawn parked (it ignores the rotor angle) is found by spinning it up: its blades give way to a disc
      let propApply = turn, propPivot = fits.PROPS ? onAxis(fits.PROPS.pivot) : null;
      if (!moved.PROPS) {
        propApply = () => { st.rpm[i] = 1; };
        warn(`prop:${mo.id}: the figure draws this prop parked (it does not follow the rotor angle), so its node is the blades the figure swaps for a disc when it spins`);
      }
      if (!propPivot) { const vs = vertsNear('PROPS', line, axisW, Rp + 1); propPivot = vs.length ? onAxis(avg(vs)) : line; }
      out.push({ id: `prop:${mo.id}`, kind: 'spin', part: 'PROPS', parts: ['PROPS'], value, bind, extras, apply: propApply, axis: axisW, pivot: propPivot, scale: sense });
      // the bell turns with the prop (its spokes follow the rotor angle); a separate node so each keeps its own explode
      if (moved.MOTORS) out.push({ id: `motor:${mo.id}`, kind: 'spin', part: 'MOTORS', parts: ['MOTORS'], value, bind, extras, apply: turn, axis: axisW,
        pivot: fits.MOTORS ? onAxis(fits.MOTORS.pivot) : line, scale: sense });
    });
    // the craft's own hinges: pose it, fit the rigid turn of what moved, hand assemble the axis, pivot and angle
    for (const c of CRAFT_CHANNELS[craft.id] || []) {
      const s0 = JSON.stringify(st[c.state] || {});
      const pose = () => { c.pose(st, s0); };
      pose();
      const act = capture(page, this).draws;
      st[c.state] = JSON.parse(s0);
      const m = pairMoved(rest, act, c.part, true);
      if (m.P.length < 3) { warn(`${c.id}: nothing in ${c.part} moved when it was posed, so it has no channel`); continue; }
      const fit = rigidFit(m.P, m.Q), aa = axisAngle(fit, avg(m.P));
      if (fit.rms > 0.05) warn(`${c.id}: what moved is not one rigid turn (rms ${fit.rms.toFixed(3)} mm)`);
      const off = Math.acos(Math.min(1, Math.abs(dot(aa.axis, c.hingeDir)))) * 180 / Math.PI;
      if (off > 1) warn(`${c.id}: the figure turns it about [${aa.axis.map((v) => +v.toFixed(3))}], ${off.toFixed(0)} deg off the hinge the craft draws`);
      out.push({ id: c.id, kind: 'rotate', part: c.part, parts: [c.part], value: c.value, active: c.active, bind: c.bind,
        extras: { ...c.extras, fitRmsMm: +fit.rms.toFixed(4) }, apply: pose, axis: aa.axis, pivot: aa.pivot, angle: aa.angle });
    }
    return out;
  },

  async anchors(page, { marks, rest }) {
    const SD = this.SD, craft = this.craft, st = this.st, out = [];
    const design = SD.resolved(st), Rb = design.motor.bell[0] / 2, Rp = design.prop.d * 25.4 / 2;
    const draws = rest.draws;
    const vertsOf = (part) => draws.filter((d) => d.part === part).flatMap((d) => [...d.faces.flatMap((f) => f.v), ...d.lines.flatMap((l) => l.pts)]);
    const motorV = vertsOf('MOTORS'), propV = vertsOf('PROPS');
    // the highest point of a part's geometry along the axis, within r of it
    const topAlong = (vs, p0, a, r) => {
      let h = -Infinity;
      for (const v of vs) { const q = sub(v, p0), t = dot(q, a); if (len(sub(q, scale(a, t))) <= r && t > h) h = t; }
      return h === -Infinity ? null : h;
    };
    craft.motors.forEach((mo, i) => {
      const ax = this.axes && this.axes[i] ? this.axes[i] : (() => { const d = dataAxis(SD, craft, mo); return { axis: d.axis, point: this.W(d.origin) }; })();
      const hm = topAlong(motorV, ax.point, ax.axis, Rb + 1), hp = topAlong(propV, ax.point, ax.axis, Math.max(2, 0.12 * Rp));
      const at = (h) => add(ax.point, scale(ax.axis, h));
      if (hm != null) out.push({ id: `motor:${mo.id}`, kind: 'motor', part: 'MOTORS', position: at(hm), normal: ax.axis, dir: mo.dir, channel: `motor:${mo.id}` });
      if (hp != null) out.push({ id: `prop:${mo.id}`, kind: 'prop', part: 'PROPS', position: at(hp), normal: ax.axis, dir: mo.dir, channel: `prop:${mo.id}` });
    });

    // labels: the part tags at rest, the see-through callouts
    const UP = [0, 0, 1], FWD = [1, 0, 0];
    const fromAsset = ([X, Y, Z]) => this.W([Z * 1000, X * 1000, Y * 1000]);
    const tagMarks = marks.filter((m) => m.kind === 'tag' && m.layer === 'base');
    const callouts = new Map();
    for (const p of craft.parts) {
      if (p.tag !== false) {
        let at = p.tag && p.tag.at ? this.W(p.tag.at) : null;
        if (!at) { const m = tagMarks.find((q) => q.text === p.short); if (m) at = fromAsset(m.position); }
        if (at) out.push({ id: `label:${p.id}`, kind: 'label', part: p.id, position: at, normal: UP, up: FWD, text: p.short, layer: 'base' });
      }
      for (const c of p.xr || []) { if (!callouts.has(p.id)) callouts.set(p.id, []); callouts.get(p.id).push(c); }
    }
    for (const c of craft.inside || []) { const k = c.part || ''; if (!callouts.has(k)) callouts.set(k, []); callouts.get(k).push(c); }
    for (const [part, list] of callouts) list.forEach((c, n) => out.push({ id: `label:${part || 'inside'}.${n + 1}`, kind: 'label', part,
      position: this.W(c.at), normal: UP, up: FWD, text: c.text, layer: 'xray' }));

    // ports and LEDs from the pieces that give their positions
    const used = new Set(out.map((a) => a.id));
    const uniq = (id) => { let k = id, n = 2; while (used.has(k)) k = `${id}.${n++}`; used.add(k); return k; };
    for (const p of craft.parts) for (const pc of [].concat(p.piece || [])) {
      if (pc.kind === 'xt60' && Array.isArray(pc.at)) {
        const dir = norm(pc.dir || [-1, 0, 0]), [sl] = pc.size || [16, 15.5, 8];
        out.push({ id: uniq(`port:${p.id}`), kind: 'port', part: p.id, position: this.W(add(pc.at, scale(dir, sl / 2))), normal: dir, extras: { connector: pc.size ? 'battery plug' : 'XT60' } });
      }
      if (pc.kind === 'board' && Array.isArray(pc.at)) {
        const [x, y, z] = pc.at, [l, w] = pc.size, top = z + (pc.t || 1.6);
        if (pc.usb) {
          const [ux, uy] = pc.usb, n = Math.abs(ux) > Math.abs(uy) ? [Math.sign(ux), 0, 0] : [0, Math.sign(uy) || 1, 0];
          out.push({ id: uniq(`port:${p.id}`), kind: 'port', part: p.id, position: this.W([x + ux + n[0] * 4.5, y + uy + n[1] * 3.6, top + 1.6]), normal: n, extras: { connector: 'USB' } });
        }
        if (pc.led) out.push({ id: uniq(`led:${p.id}`), kind: 'led', part: p.id, position: this.W([x + (pc.ledAt ? pc.ledAt[0] : -l * .3), y + (pc.ledAt ? pc.ledAt[1] : w * .32), top + .6]), normal: UP, extras: { color: pc.led } });
      }
      if (pc.kind === 'module' && Array.isArray(pc.at) && pc.led) {
        const [x, y, z] = pc.at, [l, w, h] = pc.size;
        out.push({ id: uniq(`led:${p.id}`), kind: 'led', part: p.id, position: this.W([x + (pc.ledAt ? pc.ledAt[0] : l * .3), y + (pc.ledAt ? pc.ledAt[1] : w * .3), z + h + .4]), normal: UP, extras: { color: pc.led } });
      }
    }
    return out;
  },
});

export default { matches, create };
