// The lab layer: pages load it through engine/lab.list (// @cf use engine/lab.list).
/* iynk lab equipment (docs/FIGURES-LAB.md). A lab item is one object for a chemistry, physics or electronics-bench
   training lab: a beaker, a Bunsen burner, a bench power supply. It is drawn with the core's primitives in mm, like a
   bench prop (engine/bench-props.js), and it registers once:

     SL.lab.item('beaker-250', { name, fig, foot: [w, d, h], params, actions, parts, draw(ctx), step, live, stats,
                                 report, mistake, explode, xr: { anchors, channels }, lab: { lab, summary, safeUse,
                                 mistakes: [{ id, when, say }], hazards } })

   That one call gives it (1) its own page, public/figures/lab/<id>.html: the item alone on the cutting mat with a
   picker per param, a button per action, see-through, exploded (when `explode`), labels, pressable parts and the
   bridge (cfg.embed report / accept); and (2) a bench prop of the same name (SL.bench.prop, FIGURES-BENCH §9.1), so a
   lesson circuit can stand it on the mat. The bench engine itself is reused, not forked: its registry, materials and
   drawing helpers (B.prop, B.M, B.aabb, B.slabW, B.flatText). The page mounts its own figure, because a lab item has
   no board, power tree or circuit for the bench's state machine to run.

   Item frame: mm, x to the item's right, y away from its front, z up from the mat (the bench's board-mm frame, so the
   XR converter maps it the same way: docs/XR_ASSETS.md §2). Its origin is the centre of `foot` on the mat. */
(() => {
const SL = window.SL = window.SL || {};
const B = SL.bench || null;
const LAB = SL.lab = { items: {}, order: [], st: null };
const T = (s, v) => CF_T(s, v);
const note = m => CF_NOTE('lab: ' + m);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const MAT_H = 3, FRAME_M = 10, MAT_M = 16;   // mat thickness; the frame and the mat round `foot` (mm)
LAB.T = T;
const LABS = ['chemistry', 'physics', 'electronics'];
const ANCHOR_KINDS = new Set(['pin', 'led', 'control', 'label', 'screen', 'port', 'motor']);
const CHANNEL_KINDS = new Set(['emissive', 'rotate', 'spin', 'translate']);

/* ---------- materials shared by lab items ---------- */
LAB.M = {
  glass: CLEAR, liquidWater: '#cfe6f2', steel: B ? B.M.steel : METAL, blackPl: B ? B.M.blackPl : DARK, white: B ? B.M.white : CERAMIC,
  brass: B ? B.M.gold : { l: '#f4d37c', m: '#d8b04f', d: '#8d6a24' }, mat: B ? B.M.mat : { l: '#dfe3d2', m: '#c6cbb6', d: '#9da38c' },
  castIron: { l: '#5d6b7a', m: '#46525f', d: '#2e3741' }, rubber: { l: '#e9893f', m: '#cf6f27', d: '#8c4716' },
};

// liquids a vessel can hold: the picker's name and the colour of a 2-3 cm depth of it
LAB.LIQUIDS = {
  water: { name: 'Water', color: '#cfe6f2' },
  'copper-sulfate': { name: 'Copper sulfate solution', color: '#3f8fd8' },
  permanganate: { name: 'Potassium permanganate solution', color: '#8e3fa8' },
  iodine: { name: 'Iodine solution', color: '#c98a2a' },
  indicator: { name: 'Universal indicator', color: '#53b35a' },
};
LAB.liquidParam = () => ({ label: 'Liquid', values: Object.keys(LAB.LIQUIDS), names: Object.fromEntries(Object.entries(LAB.LIQUIDS).map(([k, v]) => [k, v.name])) });

/* ---------- geometry helpers (item frame in, world out) ---------- */
// a horizontal ring round (cx, cy) at height z; r may be a function of the angle (radians, 0 = item +x)
LAB.ring = (W, cx, cy, z, r, n = 24) => Array.from({ length: n }, (_, i) => { const a = i / n * 2 * Math.PI, rr = typeof r === 'function' ? r(a) : r;
  return W(cx + rr * Math.cos(a), cy + rr * Math.sin(a), z); });
// the box round some item-frame points: [[lo], [hi]]
LAB.aabb3 = pts => [[0, 1, 2].map(i => Math.min(...pts.map(q => q[i]))), [0, 1, 2].map(i => Math.max(...pts.map(q => q[i])))];
// text on any plane through world point o: U the reading direction, V down the glyphs (world vectors); hidden when the
// plane faces away (the core's txM collapses mirrored text)
LAB.textOn = (o, U, V, str, size, col = INK, weight = 700, anchor = 'middle') => {
  const p = P(...o);
  return `<text transform="${txM(p, Dv(...U), Dv(...V))}" font-size="${f(size)}" fill="${col}" text-anchor="${anchor}" font-family="ui-monospace,Menlo,monospace" font-weight="${weight}" letter-spacing=".04em">${CF_ESC(str)}</text>`;
};
// a lathe body (bottle, barrel, knob) from a profile [[r, z], …] bottom to top, around the item point (cx, cy)
LAB.lathe = (W, cx, cy, prof, m, shade = toneI, w = 1.1, n = 20) => {
  const rings = prof.map(([r, z]) => LAB.ring(W, cx, cy, z, r, n));
  let s = '';
  for (let i = 0; i < rings.length - 1; i++) s += loft(rings[i], rings[i + 1], nr => shade(nr, m));
  const top = rings[rings.length - 1];
  if (prof[prof.length - 1][0] > 0 && vis([0, 0, 1])) s += fill(pd(top), shade([0, 0, 1], m)) + ink(pd(top), w * .7);
  return s + hullInk(rings.flat(), w);
};
// volume (mL) of a lathe's inside from its floor up to height h, the inside given as a profile [[r, z], …]
LAB.volumeTo = (prof, h) => {
  let v = 0;
  for (let i = 0; i < prof.length - 1; i++){
    const [r0, z0] = prof[i], [r1, z1] = prof[i + 1];
    if (h <= z0) break;
    const top = Math.min(h, z1), t = z1 > z0 ? (top - z0) / (z1 - z0) : 0, rt = r0 + (r1 - r0) * t, dh = top - z0;
    v += Math.PI * dh / 3 * (r0 * r0 + r0 * rt + rt * rt);
  }
  return v / 1000;
};
// the height (mm) of the surface for a volume (mL), by bisection on volumeTo
LAB.levelFor = (prof, mL) => {
  if (mL <= 0) return prof[0][1];
  let lo = prof[0][1], hi = prof[prof.length - 1][1];
  if (LAB.volumeTo(prof, hi) <= mL) return hi;
  for (let i = 0; i < 40; i++){ const mid = (lo + hi) / 2; if (LAB.volumeTo(prof, mid) < mL) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
};
LAB.radiusAt = (prof, z) => {
  for (let i = 0; i < prof.length - 1; i++){ const [r0, z0] = prof[i], [r1, z1] = prof[i + 1];
    if (z >= z0 && z <= z1) return z1 > z0 ? r0 + (r1 - r0) * (z - z0) / (z1 - z0) : Math.max(r0, r1); }
  return prof[prof.length - 1][0];
};
// the profile cut at height h (the liquid's shape inside a vessel)
const cutAt = (prof, h) => { const out = [];
  for (const [r, z] of prof){ if (z < h) out.push([r, z]); else { out.push([LAB.radiusAt(prof, h), h]); break; } }
  return out.length > 1 ? out : null; };
const GLASS_FAR = { l: '#dcecef', m: '#c4dfe4', d: '#a9c8cf' };
/* a clear glass vessel with its liquid: far wall, floor, liquid, near wall, rim, printed marks.
   o = { outer: [[r, z], …], inner: [[r, z], …] (the inside, from the floor up), level (mm) or null, liquid (hex),
         marks: [{ z, text, major }], markAt (radians, the side the marks are printed on), lip (r at angle a → extra r
         at the rim, a spout), surface (radians of tilt wobble, swirl), k (see-through), n } */
LAB.glass = (W, o) => {
  const n = o.n || 24, k = o.k || 0, lip = o.lip || (() => 0);
  const rimR = a => o.outer[o.outer.length - 1][0] + lip(a), rimIn = a => o.inner[o.inner.length - 1][0] + lip(a);
  const ringsO = o.outer.map(([r, z], i) => LAB.ring(W, 0, 0, z, i === o.outer.length - 1 ? rimR : r, n));
  const ringsI = o.inner.map(([r, z], i) => LAB.ring(W, 0, 0, z, i === o.inner.length - 1 ? rimIn : r, n));
  const glassOp = .32 * (1 - .45 * k), farOp = .5 * (1 - .4 * k);
  let s = '';
  // far wall, seen from inside through the near wall
  let far = '';
  for (let i = 0; i < ringsI.length - 1; i++) far += loft(ringsI[i], ringsI[i + 1], nr => toneI(nr, GLASS_FAR), true);
  if (vis([0, 0, 1])) far += fill(pd(ringsI[0]), mix(GLASS_FAR.l, '#ffffff', .3));
  s += `<g opacity="${f(farOp)}">${far}</g>`;
  // the liquid: its near side and its surface, with a darker meniscus ring where it meets the glass
  if (o.level != null && o.level > o.inner[0][1] + .3){
    const cut = cutAt(o.inner, o.level), liq = matOf(o.liquid);
    if (cut){
      const tilt = o.surface || 0, rs = cut.map(([r, z], i) => LAB.ring(W, 0, 0, z, i === cut.length - 1 ? (a => r - .25) : r - .2, n));
      // a swirl tips the surface: lift one side and drop the other (only the top ring)
      if (tilt){ const last = rs[rs.length - 1], rr = cut[cut.length - 1][0];
        rs[rs.length - 1] = last.map((q, i) => { const a = i / n * 2 * Math.PI; return [q[0], q[1], q[2] + Math.cos(a - (o.swirlAt || 0)) * rr * Math.tan(tilt)]; }); }
      let body = '';
      for (let i = 0; i < rs.length - 1; i++) body += loft(rs[i], rs[i + 1], nr => toneI(nr, liq));
      const surf = rs[rs.length - 1];
      if (vis([0, 0, 1])) body += fill(pd(surf), mix(o.liquid, '#ffffff', .28)) + `<path d="${pd(surf)}" fill="none" stroke="${mix(o.liquid, '#000000', .35)}" stroke-width=".9"/>`;
      // its own group, so a converter can take the liquid as a part of its own (docs/FIGURES-LAB.md, XR)
      s += `<g data-part="LIQUID" opacity=".82">${body}</g>`;
    }
  }
  // near wall: the glass itself, faint, with a highlight streak and the silhouette
  let near = '';
  for (let i = 0; i < ringsO.length - 1; i++) near += loft(ringsO[i], ringsO[i + 1], nr => toneI(nr, CLEAR));
  s += `<g opacity="${f(glassOp)}">${near}</g>`;
  // the highlight: a white streak down the side toward the light, at about 60° left of the viewer
  const hiA = (YAW + 150) * Math.PI / 180;
  const streak = o.outer.slice(1, -1).map(([r, z]) => W(Math.cos(hiA) * (r + .2), Math.sin(hiA) * (r + .2), z));
  if (streak.length > 1) s += `<path d="${pd(streak, false)}" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>`;
  // printed marks on the outside, white enamel, only on the side toward the viewer
  for (const mk of o.marks || []){
    const a0 = o.markAt || -Math.PI / 2, r = LAB.radiusAt(o.outer, mk.z) + .15, half = mk.major ? .16 : .09;
    const nrm = [Math.cos(a0), Math.sin(a0), 0], wn = sub(W(nrm[0], nrm[1], 0), W(0, 0, 0));
    if (!vis(wn)) continue;
    const arc = Array.from({ length: 5 }, (_, i) => { const a = a0 - half + 2 * half * i / 4; return W(r * Math.cos(a), r * Math.sin(a), mk.z); });
    s += `<path d="${pd(arc, false)}" fill="none" stroke="#ffffff" stroke-width="${mk.major ? 1.1 : .7}" stroke-linecap="round"/>`;
    if (mk.text){
      const a = a0 + half + .05, at = W(r * Math.cos(a), r * Math.sin(a), mk.z - 1.2), tan = sub(W(-Math.sin(a), Math.cos(a), 0), W(0, 0, 0));
      s += LAB.textOn(at, tan, [0, 0, -1], mk.text, 3, '#ffffff', 800, 'start');
    }
  }
  // the rim: a fire-polished bead, inked
  const rimO = ringsO[ringsO.length - 1], rimI = ringsI[ringsI.length - 1];
  s += `<path d="${pd(rimO)}" fill="none" stroke="${INK}" stroke-width="1.1"/><path d="${pd(rimI)}" fill="none" stroke="${INK}" stroke-width=".6" opacity=".7"/>`;
  s += hullInk(ringsO.flat(), 1.5);
  return s;
};

/* ---------- registration ---------- */
const PAGE_DIRS = /\/(boards|modules|robotics|parts|drones|flight)\/[^/]*$/;
// a lab page (public/figures/lab/<id>.html, or a page built elsewhere for a lab item) mounts a lab item, so the bench
// engine loaded under it must not mount anything itself: its DOMContentLoaded fallback would note "nothing registered"
const labPage = !PAGE_DIRS.test(location.pathname);
if (labPage && B) B.started = true;
const mine = id => CF_Q.get('id') ? CF_Q.get('id') === id : new RegExp('/lab/' + id.replace(/[^\w-]/g, '') + '\\.html$').test(location.pathname);
// numbers in a picker spec are values; a two-number `range` lets the host set anything between
const paramOk = (spec, v) => spec.values.some(x => x === v) || (Array.isArray(spec.range) && typeof v === 'number' && Number.isFinite(v) && v >= spec.range[0] && v <= spec.range[1]);
const check = (id, def) => {
  const bad = m => note(`${id}: ${m}`);
  if (typeof def.draw !== 'function') bad('no draw');
  if (!def.name) bad('no name');
  if (!def.xrCaption) bad('no xrCaption (the see-through caption)');
  if (!Array.isArray(def.foot) || def.foot.length !== 3) bad('foot must be [w, d, h] mm');
  const lab = def.lab || {};
  if (!LABS.includes(lab.lab)) bad(`lab.lab must be one of ${LABS.join(', ')}`);
  if (typeof lab.summary !== 'string' || !lab.summary) bad('lab.summary missing');
  for (const k of ['safeUse', 'hazards', 'mistakes']) if (!Array.isArray(lab[k])) bad(`lab.${k} must be a list`);
  const ids = new Set();
  for (const m of lab.mistakes || []){ if (!m || !m.id || !m.when || !m.say) bad('a mistake needs id, when and say'); else if (ids.has(m.id)) bad(`two mistakes "${m.id}"`); ids.add(m && m.id); }
  for (const [k, spec] of Object.entries(def.params || {})){
    if (!spec || !Array.isArray(spec.values) || !spec.values.length) bad(`param ${k}: values missing`);
    else if (!paramOk(spec, own(def.defaults || {}, k) ? def.defaults[k] : spec.values[0])) bad(`param ${k}: the default is not one of its values`);
  }
  const bids = new Set(Object.entries(def.params || {}).filter(([, s]) => s && s.picker !== false).map(([k]) => k));
  for (const a of def.actions || []){ if (!a.id || typeof a.run !== 'function') bad('an action needs id and run'); if (bids.has(a.id)) bad(`two buttons "${a.id}"`); bids.add(a.id); }
  const xr = def.xr || {}, aids = new Set();
  for (const a of xr.anchors || []){
    if (!a.id || !ANCHOR_KINDS.has(a.kind) || !Array.isArray(a.at) || !a.part) bad(`anchor ${a.id}: needs id, kind, part, at`);
    if (aids.has(a.id)) bad(`two anchors "${a.id}"`); aids.add(a.id);
  }
  const cids = new Set();
  for (const c of xr.channels || []){
    if (!c.id || !CHANNEL_KINDS.has(c.kind) || !c.part || !c.value) bad(`channel ${c.id}: needs id, kind, part, value`);
    if (cids.has(c.id)) bad(`two channels "${c.id}"`); cids.add(c.id);
    if (c.bind && c.bind.source === 'param' && !own(def.params || {}, c.bind.key)) bad(`channel ${c.id}: binds unknown param ${c.bind.key}`);
  }
  for (const a of xr.anchors || []) if (a.channel && !cids.has(a.channel)) bad(`anchor ${a.id}: no channel "${a.channel}"`);
  for (const pid of [...(xr.anchors || []), ...(xr.channels || [])].map(x => x.part)) if (pid && !own(def.parts || {}, pid)) bad(`xr part "${pid}" is not in parts`);
};
LAB.item = (id, def) => {
  if (typeof id !== 'string' || !def) return note('item without an id');
  def.id = id;
  check(id, def);
  LAB.items[id] = def; LAB.order.push(id);
  if (B && B.prop) B.prop(id, asProp(def));
  if (labPage && mine(id)) mount(id);
};
// defaults with every param filled in
const defaultsOf = def => { const p = {}; for (const [k, spec] of Object.entries(def.params || {})) p[k] = own(def.defaults || {}, k) ? def.defaults[k] : spec.values[0]; return p; };

/* ---------- the drawing context (shared by the page and the bench prop) ---------- */
const boxOf = (W, b) => { const a = W(...b[0]), c = W(...b[1]); return [[0, 1, 2].map(i => Math.min(a[i], c[i])), [0, 1, 2].map(i => Math.max(a[i], c[i]))]; };
function makeCtx(def, W, base){
  const ctx = Object.assign({}, base, {
    W,
    // a part of the item: drawn in its own box, pressable when `part` names one of def.parts
    put: (box, svg, part) => { if (!svg) return; const wb = boxOf(W, box); base._items.push({ box: wb, svg: part ? base._wrap(part, svg) : svg }); },
    // a cast shadow of world points (ctx.ring and ctx.W give them), on the mat; build.py's TAIL draws shadows solid
    shadow: pts => base._shadows.push(pts),
    label: (at, text, on) => { if (base.k > .5 && text) base._labels.push({ at: W(...at), text, on: !!on }); },
    ring: (cx, cy, z, r, n) => LAB.ring(W, cx, cy, z, r, n),
    // the same drawing moved by `off` × the exploded ease (an exploded part rises or slides out on its own)
    lift: off => makeCtx(def, (x, y, z) => W(x + off[0] * base.ex, y + off[1] * base.ex, z + off[2] * base.ex), base),
  });
  return ctx;
}

/* ---------- a lab item as a bench prop (FIGURES-BENCH §9.1): the same drawing on a lesson's mat ---------- */
function asProp(def){
  const params = {};
  for (const [k, spec] of Object.entries(def.params || {})) params[k] = spec.values;
  return { name: def.name, foot: def.foot, params, defaults: defaultsOf(def),
    draw(bctx){
      const o = bctx.origin, aim = bctx.aim;
      let ax = null;
      if (aim){ const dx = aim[0] - o[0], dy = aim[1] - o[1], d = Math.hypot(dx, dy); if (d > 1) ax = [dx / d, dy / d]; }
      if (!ax){ const r = (+bctx.p.rot || 0) * Math.PI / 180; ax = [Math.cos(r), Math.sin(r)]; }
      // the item's front (-y) faces the aim; x is its right, as on its own page
      const ux = [ax[1], -ax[0]], uy = [-ax[0], -ax[1]];
      const W = (x, y, z) => [o[0] + ux[0] * x + uy[0] * y, o[1] + ux[1] * x + uy[1] * y, o[2] + z];
      const items = [], shadows = [], st = bctx.st || {};
      const base = { def, p: Object.assign(defaultsOf(def), bctx.p), s: {}, t: st.t || 0, k: bctx.k || 0, ex: 0, sel: !!bctx.sel, solo: false,
        _items: items, _shadows: shadows, _labels: [], _wrap: (part, svg) => svg };
      try { def.draw(makeCtx(def, W, base)); } catch (e) { note(`${def.id}: ${e.message}`); }
      for (const pts of shadows) bctx.put(B.aabb(pts.map(q => [q[0], q[1], o[2]])), castShadow(pts, o[2]));
      for (const it of items) bctx.put(it.box, it.svg);
    } };
}

/* ---------- the page ---------- */
let ui = null, st = null, def = null, frame = null;
const roundDeep = v => typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)
  : Array.isArray(v) ? v.map(roundDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)])) : v;
const showValue = (spec, v) => spec.show ? spec.show(v) : spec.names && own(spec.names, String(v)) ? spec.names[String(v)] : typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : String(v);
const say = (text, vars, ms) => { if (!ui) return; st.msg = vars ? T(text, vars) : text; ui.flash(vars ? T(text, vars) : text, ms || 2200); };
let driving = false;
const kick = () => {
  if (!ui || driving) return;
  driving = true;
  ui.animate(dt => { step(dt); const go = live(); if (!go) driving = false; return go; });
};
const live = () => st.ex !== st.exT || !!(def.live && def.live(st)) || (st.mistakeWait != null);
// the item's own time step, then the mistake check: a new mistake shows its plain-English warning once
function step(dt){
  st.t += dt;
  if (st.ex !== st.exT){ const g = Math.sign(st.exT - st.ex); st.ex = clamp(st.ex + g * dt / .6, 0, 1); }
  if (def.step) try { def.step(st, dt, api); } catch (e) { note(`step: ${e.message}`); }
  checkMistake();
}
function checkMistake(){
  let m = null;
  if (def.mistake) try { m = def.mistake(st) || null; } catch (e) { note(`mistake: ${e.message}`); }
  if (m && !(def.lab.mistakes || []).some(x => x.id === m)){ note(`unknown mistake "${m}"`); m = null; }
  if (m === st.mistake) return;
  st.mistake = m;
  if (m) say(def.lab.mistakes.find(x => x.id === m).say, null, 4200);
}
const setParam = (k, v, by) => {
  const spec = (def.params || {})[k];
  if (!spec || !paramOk(spec, v)) return false;
  const old = st.p[k];
  st.p[k] = v;
  if (def.onParam) try { def.onParam(st, k, v, old, api, by); } catch (e) { note(`onParam: ${e.message}`); }
  checkMistake(); kick();
  return true;
};
const api = { say, kick, set: (k, v) => setParam(k, v, 'item'), sfx: name => { try { if (window.CF_BRIDGE) CF_BRIDGE.send('sfx', { name }); } catch (e) {} } };

function buttons(){
  const bt = [];
  for (const a of def.actions || []) bt.push({ id: a.id, label: a.label, onClick: () => { try { a.run(st, api); } catch (e) { note(`${a.id}: ${e.message}`); } checkMistake(); kick(); } });
  for (const [k, spec] of Object.entries(def.params || {})){
    if (spec.picker === false) continue;
    bt.push({ id: k, label: spec.label || k, choices: () => spec.values.map(v => ({ id: CF_SLUG(String(v)), label: showValue(spec, v), current: st.p[k] === v,
      onClick: () => { if (setParam(k, v, 'user') && spec.announce !== false) say('{part} is now {value}', { part: T(spec.label || k), value: T(showValue(spec, v)) }); } })) });
  }
  if (def.explode) bt.push({ id: 'exploded', label: 'Exploded view', onClick: () => { st.exploded = !st.exploded; st.exT = st.exploded ? 1 : 0; kick(); } });
  return bt;
}
// stats: [{ label, value, small }] with the label and any words already through T in the item file
const stats = () => (def.stats ? def.stats(st) : []).filter(Boolean).map(x => ({ label: x.label, value: String(x.value), small: !!x.small }));

function scene(s){
  const k = ease(s.xr || 0), ex = ease(s.ex || 0), items = [], shadows = [], labels = [];
  const base = { def, p: s.p, s: s.s, t: s.t, k, ex, sel: s.sel, solo: true, _items: items, _shadows: shadows, _labels: labels,
    _wrap: (part, svg) => { const pd0 = (def.parts || {})[part], name = pd0 ? pd0.name : part;
      return act('part', s.sel === part ? `<g class="lsel">${svg}</g>` : svg, `data-id="${CF_ESC(part)}" data-label="${CF_ESC(name)}" tabindex="0" role="button" aria-label="${CF_ESC(T(name))}"`); } };
  try { def.draw(makeCtx(def, frame.W, base)); } catch (e) { note(`draw: ${e.message}`); }
  let out = drawMat();
  // shadows lie on the mat and stop at its edge, as on a bench (a tall item's would otherwise run out over the page)
  const top = boardTop(...frame.mat, MAT_H, 4);
  for (const pts of shadows) out += castShadow(pts, MAT_H, top);
  out += byDepth(items);
  if (labels.length) out += xrCallouts(labels, frame.bounds);
  return out;
}
function drawMat(){
  const [x0, y0, x1, y1] = frame.mat, step = frame.grid;
  let s = board(x0, y0, x1, y1, MAT_H, 4, LAB.M.mat), g = '';
  for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) g += `M${P(x, y0 + 1, MAT_H).map(f).join(' ')}L${P(x, y1 - 1, MAT_H).map(f).join(' ')}`;
  for (let y = Math.ceil(y0 / step) * step; y < y1; y += step) g += `M${P(x0 + 1, y, MAT_H).map(f).join(' ')}L${P(x1 - 1, y, MAT_H).map(f).join(' ')}`;
  return s + `<path d="${g}" fill="none" stroke="#a9b096" stroke-width=".5" opacity=".7"/>`;
}

const report = () => {
  const r = { id: def.id, lab: def.lab.lab, exploded: st.exploded, selected: st.sel };
  for (const [k, v] of Object.entries(st.p)) r[k] = roundDeep(v);
  let extra = {};
  if (def.report) try { extra = def.report(st) || {}; } catch (e) { note(`report: ${e.message}`); }
  for (const [k, v] of Object.entries(extra)){ if (own(r, k) || k === 'mistake') note(`report key "${k}" is taken`); else r[k] = roundDeep(v); }
  r.mistake = st.mistake;
  return r;
};
// a host patch: any param by its key (validated against its values or range), exploded, select. One patch is one
// moment: every key is checked before any is applied, so a bad value changes nothing
const accept = (s, patch) => {
  if (!patch || typeof patch !== 'object') return 'patch must be an object';
  for (const [k, v] of Object.entries(patch)){
    if (k === 'exploded'){ if (typeof v !== 'boolean') return 'exploded must be true or false'; if (v && !def.explode) return 'this item has no exploded view'; continue; }
    if (k === 'select'){ if (v !== null && !own(def.parts || {}, v)) return `unknown part ${v}`; continue; }
    const spec = (def.params || {})[k];
    if (!spec) return `unknown key ${k}`;
    if (!paramOk(spec, v)) return `${k}: ${JSON.stringify(v)} is not one of its values`;
  }
  // an item may refuse a combination its params allow one by one (a flame without gas): refuse(next, patch) gives the
  // reason, next being the params as the patch would leave them
  if (def.refuse){ const why = def.refuse(Object.assign({}, st.p, patch), patch); if (why) return why; }
  for (const [k, v] of Object.entries(patch)){
    if (k === 'exploded'){ st.exploded = v; st.exT = v ? 1 : 0; continue; }
    if (k === 'select'){ st.sel = v; continue; }
    setParam(k, v, 'host');
  }
  kick();
  return true;
};

function mount(id){
  if (st) return;
  if (B) B.started = true;
  def = LAB.items[id];
  // framed on the item as a bench part page is (FIGURES-BENCH §8): the frame is `foot` plus FRAME_M all round, and the
  // mat a little larger, so a beaker fills its figure as a power supply does
  const [w, d, h] = def.foot, m = FRAME_M, e = MAT_M - FRAME_M;
  // world: the item's x runs along world -y and its y along world -x (the bench's board-mm mapping, bench.js BP), so
  // its front (-y) faces world +x: the lower-right face in the default view, toward the viewer, as a board's front does
  const c0 = d / 2 + m, c1 = w / 2 + m;
  frame = {
    W: (x, y, z) => [c0 - y, c1 - x, MAT_H + z],
    mat: [-e, -e, d + 2 * m + e, w + 2 * m + e], grid: Math.max(w, d) > 260 ? 20 : 10,
    bounds: [c0 - d / 2, c0 + d / 2, c1 - w / 2, c1 + w / 2, MAT_H, MAT_H + h],
  };
  st = LAB.st = { id, p: defaultsOf(def), s: {}, t: 0, xr: 0, xrT: 0, exploded: false, ex: 0, exT: 0, sel: null, mistake: null, msg: '' };
  if (def.init) try { def.init(st, api); } catch (e) { note(`init: ${e.message}`); }
  const css = document.createElement('style');
  css.textContent = '#fig .lsel > *{filter:drop-shadow(0 0 1.6px var(--accent,#f4b829)) drop-shadow(0 0 1.6px var(--accent,#f4b829))}#fig [data-act]{cursor:pointer}'
    + '#fig [data-act=part]:focus{outline:none}#fig [data-act=part]:focus-visible{outline:2px dashed var(--accent,#f4b829);outline-offset:2px}';
  document.head.appendChild(css);
  ui = mountFigure({
    fig: def.fig || '', title: def.name, turn: 'full', size: [d + 2 * m, w + 2 * m, h + MAT_H], center: [c0, c1],
    palette: def.pal || 'mustard', state: st, credit: true,
    scene: s => scene(s), buttons: buttons(), stats: () => stats(),
    acts: { part: (s, el) => { const pid = el.dataset.id, pdef = (def.parts || {})[pid];
      st.sel = st.sel === pid && !(pdef && pdef.press) ? null : pid;
      if (pdef && pdef.press) try { pdef.press(st, api); } catch (e) { note(`${pid}: ${e.message}`); }
      checkMistake(); kick(); } },
    readout: () => st.msg || '',
    params: (s, q) => {
      for (const [k, spec] of Object.entries(def.params || {})){
        if (!q.has(k)) continue;
        const raw = q.get(k), v = spec.values.find(x => String(x) === raw) ?? (Array.isArray(spec.range) && raw !== '' && Number.isFinite(+raw) ? +raw : undefined);
        if (v === undefined || !paramOk(spec, v)) note(`?${k}=${raw} is not one of its values`); else s.p[k] = v;
      }
      if (def.onLoad) try { def.onLoad(s, api); } catch (e) { note(`onLoad: ${e.message}`); }
      if (def.explode && q.get('exploded') === '1'){ s.exploded = true; s.ex = s.exT = 1; }
      if (q.get('sel') && own(def.parts || {}, q.get('sel'))) s.sel = q.get('sel');
    },
    embed: { report: () => report(), accept: (s, p) => accept(s, p) },
  });
  xrMount(() => ui, s => s.xr > .5 ? def.xrCaption || '' : '');
  const fig = document.getElementById('fig');
  // the drawing holds pressable parts (one tab stop each), so it is a group, as on the drone pages
  if (fig) fig.setAttribute('role', 'group');
  if (fig) fig.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest && e.target.closest('[data-act="part"][tabindex]');
    if (!el) return;
    e.preventDefault();
    const pid = el.dataset.id;
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'keyboard' }));
    const again = fig.querySelector(`[data-act="part"][tabindex][data-id="${pid}"]`);
    if (again) again.focus();
  });
  checkMistake();
  kick();
}
LAB.report = () => (st ? report() : null);
LAB.accept = p => accept(st, p);
LAB.press = id => { const b = buttons().find(x => x.id === id); if (b && b.onClick) b.onClick(); else note(`no action "${id}"`); };
// tests and the probe run the clock without frames
LAB.advance = (seconds, dt = 1 / 30) => { for (let t = 0; t < seconds - 1e-9; t += dt) step(Math.min(dt, seconds - t)); if (ui) ui.render(); };
// what the voice tutor and the XR converter read without running the page (figures/lab/catalogue.json)
LAB.catalogue = id => {
  const d = LAB.items[id]; if (!d) return null;
  const xr = d.xr || {};
  const params = {};
  for (const [k, spec] of Object.entries(d.params || {})) params[k] = Object.assign({ label: spec.label || k, values: spec.values }, spec.range ? { range: spec.range } : {}, spec.unit ? { unit: spec.unit } : {});
  return {
    id, kind: 'lab', name: d.name, page: `public/figures/lab/${id}.html`, lab: d.lab.lab, summary: d.lab.summary,
    safeUse: d.lab.safeUse, mistakes: d.lab.mistakes.map(m => ({ id: m.id, when: m.when, say: m.say })), hazards: d.lab.hazards,
    foot: d.foot, params, defaults: defaultsOf(d), actions: (d.actions || []).map(a => ({ id: a.id, label: a.label })), report: ['id', 'lab', 'exploded', 'selected', ...Object.keys(d.params || {}), ...(d.reportKeys || []), 'mistake'],
    exploded: !!d.explode, parts: Object.entries(d.parts || {}).map(([pid, p]) => Object.assign({ id: pid, name: p.name }, p.role ? { role: p.role } : {}, p.layer ? { layer: p.layer } : {}, p.explode ? { explode: p.explode } : {})),
    anchors: (xr.anchors || []).map(a => Object.assign({ id: a.id, kind: a.kind, part: a.part, at: a.at, normal: a.normal || [0, 0, 1] }, a.aliases ? { aliases: a.aliases } : {}, a.channel ? { channel: a.channel } : {},
      a.text ? { text: a.text } : {}, a.rect ? { rect: a.rect } : {}, a.extras ? { extras: a.extras } : {})),
    channels: (xr.channels || []).map(c => Object.assign({ id: c.id, kind: c.kind, part: c.part, value: c.value }, c.color ? { color: c.color } : {}, c.axis ? { axis: c.axis } : {}, c.pivot ? { pivot: c.pivot } : {}, c.scale != null ? { scale: c.scale } : {}, c.bind ? { bind: c.bind } : {}, c.extras ? { extras: c.extras } : {})),
    extras: xr.extras || {},
  };
};
// a page built elsewhere (cfbuild --out, the engine tests) mounts the last lab item once everything has registered
addEventListener('DOMContentLoaded', () => { if (labPage && !st){ const last = LAB.order[LAB.order.length - 1]; if (last) mount(last); else note('nothing registered'); } });
})();
