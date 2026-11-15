// Lab equipment adapter (figures/engine/lab.js): the items in figures/lab (docs/FIGURES-LAB.md).
// A lab page runs no bench state machine: SL.lab.item(id, def) mounts its own figure, the item alone on the cutting mat,
// with its state in SL.lab.st ({ p: params, s: the item's own state, xr, ex, ... }). The item frame is the bench's board
// frame (board-mm: mm, x right, y back, z up from the mat, origin the centre of `foot`), and the page maps it into the
// Colorfigures world with W(x, y, z) = [c0 - y, c1 - x, MAT_H + z] (lab.js mount), a reflection, which coreToSource
// undoes. The asset then has the item's front (-y) towards +Z (docs/XR_ASSETS.md section 2).
//
// What the item declares in `xr` (anchors, channels, extras, item mm) is mapped into the asset frame; what its drawing
// shows is captured as for any figure:
// - parts: every ctx.put(box, svg, part) is a pressable <g data-act="part" data-id>; a bare <g data-part> inside one (the
//   glass's LIQUID, the burner's FLAME) names a piece of its own (capture/walk.mjs, act 'group').
// - channels: each declared channel is driven to an active value through its bound param, and what changed becomes its
//   node. A knob or collar turns as one piece (`whole`: its body is round, only its pointer is drawn differently); an
//   emissive lamp drawn as part of a bigger part (the supply's panel) keeps only the pieces within a few mm of its anchor;
//   a piece drawn only while active (a lit flame) is taken from the active drawing. A rotate keeps the declared axis,
//   pivot and scale, and is checked against the rigid turn the figure draws.
// - the liquid in glassware stays at the default volume, in its own static node ('static.liquid'), and the item's
//   xr.extras.liquid (inner profile, level per volume, item mm) rides in the sidecar's extras.
// - the tutor notes (def.lab) ride in extras.lab.
import { capture, pairMoved } from './assemble.mjs';
import { fitRigid, axisAngle } from './fit.mjs';
import { sub, scale, dot, len, norm, avg } from '../gltf/geom.mjs';

const matches = (item) => /^lab\//.test(item);
const MAT_H = 3, FRAME_M = 10, MAT_GRID = '#a9b096';       // lab.js: the mat's thickness and the frame margin round `foot` (mm)
const ROUND_MM = 0.5;                // mm: a part whose centre lies this close to its turning axis is round about it
const NEAR_LAMP = 5;
// clear glass (LAB.glass): the near wall at 0.32 opacity, 0.32 x (1 - 0.45) in full see-through; anything drawn fainter
// than GLASS_BELOW at rest goes into the translucent node
const GLASS_BELOW = 0.6, GLASS_OPACITY = [0.32, 0.176];
const RIGID_MM = 0.05, LOOSE_MM = 2;    // rms of a rigid fit, and of one loose enough to check only its axis and sense                 // mm: an emissive lamp inside a bigger part keeps the pieces this close to its anchor
// the lab part roles (docs/FIGURES-LAB.md section 8) as the sidecar's part roles
const ROLE = { body: 'part', control: 'control', pin: 'connector', light: 'led', liquid: 'part', wire: 'wire', cover: 'cover' };
// channel ids the schema allows (xr-asset.schema.json, channel.id); the two lab ids are written in a standard form
const STANDARD_CHANNEL = /^(led|servo|prop|motor|press|turn):.+$/;
const LAB_PREFIX = { flame: 'led', swing: 'turn' };

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const vertsOf = (d) => [...d.faces.flatMap((f) => f.v), ...d.lines.flatMap((l) => l.pts)];

/** How to drive one channel: the params (and own state) that make it active and the channel value that stands for. */
function driveOf(def, c) {
  const params = def.params || {}, p0 = defaults(def), ex = c.extras || {};
  const key = c.bind && c.bind.source === 'param' ? c.bind.key : null;
  if (c.kind === 'emissive') {
    // lamps lit by reported state, not a param of their own
    if (c.extras && typeof c.extras.on === 'string') {
      if (/mode === "CV"/.test(c.extras.on)) return { patch: { on: true, load: 'r100' } };
      if (/mode === "CC"/.test(c.extras.on)) return { patch: { on: true, load: 'short' } };
      if (/report\.heating/.test(c.extras.on)) return { patch: { on: true } };
      return null;
    }
    if (key && params[key] && params[key].values.includes(true)) {
      const patch = { [key]: true };
      // the item's own rule for a flame: lit needs the gas on (def.refuse)
      if (def.refuse) { const why = def.refuse({ ...p0, ...patch }, patch); if (why && params.gasOn) patch.gasOn = true; }
      return { patch };
    }
    return null;
  }
  if (c.kind === 'rotate') {
    // a swing: released, at the start of its first swing the bob is at the release angle
    if (/^swing:/.test(c.id) && params.swinging) return { patch: { swinging: true }, s: { swingT: 0 }, value: p0.amplitude };
    if (!key || !params[key]) return null;
    const spec = params[key], rest = c.value.rest;
    if (ex.deg) {
      // a mapping from the param's values to degrees: the value farthest from rest
      const opts = Object.entries(ex.deg).map(([k, deg]) => [spec.values.find((v) => String(v) === k), deg]).filter(([v]) => v !== undefined);
      const [v, deg] = opts.sort((a, b) => Math.abs(b[1] - rest) - Math.abs(a[1] - rest))[0] || [];
      return v === undefined ? null : { patch: { [key]: v }, value: deg };
    }
    const lin = ex.degPerUnit != null ? (v) => ex.degAtZero + ex.degPerUnit * v : ex.degPerC != null ? (v) => ex.degAt200 + ex.degPerC * (v - 200) : null;
    if (!lin) return null;
    const v = spec.values.filter((x) => typeof x === 'number').sort((a, b) => Math.abs(lin(b) - rest) - Math.abs(lin(a) - rest))[0];
    return { patch: { [key]: v }, value: lin(v) };
  }
  return null;
}
function defaults(def) {
  const p = {};
  for (const [k, spec] of Object.entries(def.params || {})) p[k] = def.defaults && Object.prototype.hasOwnProperty.call(def.defaults, k) ? def.defaults[k] : spec.values[0];
  return p;
}

const create = () => ({
  engine: 'bench',

  async setup(page) {
    const LAB = page.eval('SL.lab'), id = page.item.split('/')[1];
    const def = LAB && LAB.items[id], st = LAB && LAB.st;
    if (!def || !st || st.id !== id) throw new Error(`${page.item}: the lab item did not mount`);
    if (page.eval('CF_UI.st') !== st) throw new Error(`${page.item}: the figure's state is not SL.lab.st`);
    this.def = def; this.st = st; this.id = id;
    // rest: the defaults, see-through and exploded off, nothing selected, the clock at 0
    Object.assign(st, { xr: 0, xrT: 0, exploded: false, ex: 0, exT: 0, sel: null, msg: '', t: 0 });
    this.snap = JSON.stringify({ p: st.p, s: st.s });
    const [w, d] = def.foot, c0 = d / 2 + FRAME_M, c1 = w / 2 + FRAME_M;
    this.c = [c0, c1];
    const lab = def.lab || {};
    const xrx = plain((def.xr && def.xr.extras) || {});
    const extras = {
      ...xrx,
      lab: { lab: lab.lab, summary: lab.summary, safeUse: plain(lab.safeUse || []), hazards: plain(lab.hazards || []),
        mistakes: plain((lab.mistakes || []).map((m) => ({ id: m.id, when: m.when, say: m.say }))) },
      item: { frame: 'board-mm', units: 'mm', foot: plain(def.foot), defaults: plain(defaults(def)), exploded: !!def.explode,
        note: 'mm values in extras are in the item frame (board-mm); frame.fromSource maps them into the asset' },
    };
    return {
      name: def.name, kind: 'lab', az: st.az, extras,
      frame: { source: 'board-mm', origin: 'footprint-centre', restZ: 0, coreToSource: ([X, Y, Z]) => [c1 - Y, c0 - X, Z - MAT_H] },
    };
  },

  /** item mm -> Colorfigures world, as the page's own frame (lab.js mount) */
  W([x, y, z]) { const [c0, c1] = this.c; return [c0 - y, c1 - x, MAT_H + z]; },
  dirW(n) { return norm(sub(this.W(n), this.W([0, 0, 0]))); },

  partOf(ctx, d, g) {
    // the cutting mat stays out (the headset has its own bench)
    const pts = [...g.faces.flatMap((f) => f.v), ...g.lines.flatMap((l) => l.pts)];
    if (pts.length && pts.every((p) => p[2] <= MAT_H + 1e-3)) return null;
    if (g.text && g.text.o[2] <= MAT_H + 1e-3) return null;
    for (let i = ctx.acts.length - 1; i >= 0; i--) { const a = ctx.acts[i]; if ((a.act === 'group' || a.act === 'part') && a.id) return a.id; }
    return '';
  },

  /** the mat's grid (lab.js drawMat) is a plain 2D path; it is the mat, not the item, so it is not a dropped mark */
  notDrawn(a) { return a.stroke === MAT_GRID && a.fill === 'none'; },

  async xray(page, on) { const st = this.st; st.xr = st.xrT = on ? 1 : 0; },
  async explode(page, on) {
    if (!this.def.explode) return;
    const st = this.st; st.exploded = !!on; st.ex = st.exT = on ? 1 : 0;
  },
  async reset() {
    const st = this.st, s = JSON.parse(this.snap);
    for (const k of Object.keys(st.p)) if (!(k in s.p)) delete st.p[k];
    for (const k of Object.keys(st.s)) if (!(k in s.s)) delete st.s[k];
    Object.assign(st.p, s.p); Object.assign(st.s, s.s);
    Object.assign(st, { xr: 0, xrT: 0, exploded: false, ex: 0, exT: 0, sel: null, t: 0 });
  },

  /** see-through insides drawn under a cover (the supply's) belong to the item's one xray part */
  xrayPart(d) {
    const parts = this.def.parts || {}, xr = Object.keys(parts).filter((k) => parts[k].layer === 'xray');
    return xr.length === 1 && parts[d.part] && parts[d.part].role === 'cover' ? xr[0] : null;
  },

  parts() {
    return Object.entries(this.def.parts || {}).map(([id, p]) => {
      const extras = { role: p.role || 'body' };
      if (p.layer) extras.layer = p.layer;
      if (p.explode) extras.explodeMm = plain(p.explode);
      return { id, name: p.name || id, role: ROLE[p.role] || 'part', cover: p.role === 'cover', extras };
    });
  },

  /** a liquid has a static node of its own; clear glass (drawn faint) another, which the app draws translucent */
  staticNode(d) {
    const p = (this.def.parts || {})[d.part];
    if (p && p.role === 'liquid') return 'static.liquid';
    if (d.opacity < GLASS_BELOW && (d.faces.length || d.lines.length)) return 'static.glass';
    return null;
  },
  nodeOpacity(name) { return name === 'static.glass' ? GLASS_OPACITY : null; },

  /** the sidecar id of a declared channel (flame:BURNER -> led:FLAME, swing:BOB -> turn:BOB) */
  channelId(c) {
    if (STANDARD_CHANNEL.test(c.id)) return c.id;
    const pre = LAB_PREFIX[c.id.split(':')[0]];
    return pre ? `${pre}:${c.part}` : null;
  },

  async channels(page, { warn }) {
    const def = this.def, st = this.st, out = [];
    const rest = capture(page, this).draws;
    const declared = (def.xr && def.xr.channels) || [];
    const anchors = (def.xr && def.xr.anchors) || [];
    this.ids = new Map();
    for (const c0 of declared) {
      const c = plain(c0);
      const id = this.channelId(c);
      if (!id) { warn(`${c.id}: not a channel id the schema allows, so it is left out`); continue; }
      if (id !== c.id) warn(`channel ${c.id} is written ${id}: the schema's channel ids are led, servo, prop, motor, press and turn (the lab id is in its extras.labId)`);
      this.ids.set(c.id, id);
      const drive = driveOf(def, c);
      if (!drive) { warn(`${c.id}: no way to drive it from its params, so it has no node`); continue; }
      const apply = () => { Object.assign(st.p, drive.patch); if (drive.s) Object.assign(st.s, drive.s); };
      const extras = { ...(c.extras || {}) };
      if (id !== c.id) extras.labId = c.id;
      if (extras.nodes) { extras.figureParts = extras.nodes; delete extras.nodes; }
      const parts = c.extras && Array.isArray(c.extras.nodes) ? c.extras.nodes : [c.part];
      const ch = { id, kind: c.kind, part: c.part, parts, value: c.value, apply };
      if (c.bind) ch.bind = c.bind;
      const inRest = rest.some((d) => parts.includes(d.part));
      if (c.kind === 'emissive') {
        if (c.color) ch.color = c.color;
        if (!inRest) {
          ch.fromActive = true;
          extras.hiddenAtRest = true;
          warn(`${id}: the figure draws ${c.part} only while it is lit, so its node holds the lit drawing (${Object.entries(drive.patch).map(([k, v]) => `${k} ${v}`).join(', ')}); hide it at level 0`);
        }
        // a lamp drawn as part of a bigger part: only the pieces at its anchor
        const role = (def.parts[c.part] || {}).role;
        const a = anchors.find((q) => q.channel === c.id);
        if (role === 'body' && a) {
          const at = this.W(a.at);
          ch.keep = (d) => { const v = vertsOf(d); return v.length > 0 && len(sub(avg(v), at)) <= NEAR_LAMP; };
        }
      } else if (c.kind === 'rotate') {
        const theta = c.scale * (drive.value - c.value.rest);
        ch.axis = this.dirW(c.axis); ch.pivot = this.W(c.pivot); ch.active = drive.value;
        // the core world is the item frame mirrored, so a right-handed turn there is a left-handed one here
        ch.angle = -theta;
        // a knob or collar turns whole: it is round about its axis and only its pointer is drawn differently. A lever,
        // a rocker or a swinging bob is not, and takes only what the figure moves
        const vs = rest.filter((d) => d.part === c.part).flatMap(vertsOf);
        if (vs.length) {
          const off = sub(avg(vs), ch.pivot);
          ch.whole = len(sub(off, scale(ch.axis, dot(off, ch.axis)))) < ROUND_MM;
        }
        this.check(page, ch, rest, apply, theta, warn);
      } else { warn(`${c.id}: kind ${c.kind} is not converted for lab items`); continue; }
      if (Object.keys(extras).length) ch.extras = extras;
      out.push(ch);
    }
    return out;
  },

  /** the declared turn against the rigid turn the figure draws (when what moved is rigid and enough to fit) */
  check(page, ch, rest, apply, theta, warn) {
    apply();
    const act = capture(page, this).draws;
    this.reset();
    const scope = (l) => l.filter((d) => ch.parts.includes(d.part));
    const R = scope(rest), A = scope(act);
    const key = (d) => d.part + '\u0001' + d.geo;
    const count = (l) => { const m = new Map(); for (const d of l) m.set(key(d), (m.get(key(d)) || 0) + 1); return m; };
    const diff = (a, b) => { const m = count(b); return a.filter((d) => { const n = m.get(key(d)) || 0; if (n > 0) { m.set(key(d), n - 1); return false; } return true; }); };
    const gone = diff(R, A), came = diff(A, R);
    if (!gone.length) { warn(`${ch.id}: nothing moved when it was driven`); return; }
    if (gone.length !== came.length) return;
    const { P, Q } = pairMoved(gone, came);
    if (P.length < 3) return;
    const fit = fitRigid(P, Q);
    // a turn drawn partly as a change of shape (a rocker's halves, a collar's windows, a string cut in pieces) fits
    // loosely: its axis and sense are still checked, its size and pivot only when the fit is rigid
    if (fit.rms > LOOSE_MM) return;
    const aa = axisAngle(fit, avg(P)), along = dot(aa.axis, ch.axis), drawn = along * aa.angle;
    const deg = (r) => (r * 180 / Math.PI).toFixed(1);
    if (Math.abs(along) < Math.cos(8 * Math.PI / 180)) return warn(`${ch.id}: the figure turns it about [${aa.axis.map((v) => +v.toFixed(3))}], not the declared axis`);
    if (Math.sign(drawn) !== Math.sign(ch.angle)) return warn(`${ch.id}: the figure turns it the other way from the declared channel (${deg(-drawn)} deg against ${deg(theta)} deg)`);
    if (fit.rms > RIGID_MM) return;
    if (Math.abs(drawn - ch.angle) > 0.05 * Math.abs(ch.angle) + 0.01) warn(`${ch.id}: the figure turns it ${deg(-drawn)} deg, the declared channel ${deg(theta)} deg`);
    const off = sub(ch.pivot, aa.pivot), miss = len(sub(off, scale(aa.axis, dot(off, aa.axis))));
    if (miss > 1.5) warn(`${ch.id}: the declared pivot is ${miss.toFixed(1)} mm off the axis the figure turns it about`);
  },

  async anchors(page) {
    const out = [];
    for (const a0 of (this.def.xr && this.def.xr.anchors) || []) {
      const a = plain(a0), n = a.normal || [0, 0, 1];
      const o = { id: a.id, kind: a.kind, part: a.part, position: this.W(a.at), normal: this.dirW(n) };
      if (a.aliases) o.aliases = a.aliases;
      if (a.text) o.text = a.text;
      if (a.extras) o.extras = a.extras;
      if (a.channel) { const id = this.ids && this.ids.get(a.channel); if (id) o.channel = id; }
      if (a.kind === 'label') { o.up = Math.abs(n[2]) > 0.9 ? this.dirW([0, 1, 0]) : this.dirW([0, 0, 1]); o.layer = 'base'; }
      if (a.rect) {
        // rect.u and rect.v are item-mm vectors; assemble maps them as Colorfigures vectors from the origin
        const W0 = this.W([0, 0, 0]);
        o.rect = { origin: this.W(a.rect.origin), u: sub(this.W(a.rect.u), W0), v: sub(this.W(a.rect.v), W0), pixels: a.rect.pixels };
      }
      out.push(o);
    }
    return out;
  },
});

export default { matches, create };
