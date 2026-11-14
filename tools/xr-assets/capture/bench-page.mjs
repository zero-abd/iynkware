// In-page helpers for the bench adapter. Both functions run inside the captured page (jsdom, capture mode on), never
// in a normal figure page: they are stringified and evaluated there by bench.mjs.
//
// install() wraps a few engine drawings so a capture can tell what drew each piece and drive what the engine has no
// state for. Nothing is drawn differently at rest:
// - every kind's draw (and see-through xr) puts its pieces inside <g data-act="xr-part" data-id="<part>">, with the
//   part prefixed by its mat board ('NANO/U1'): a board on a bench's mat draws its parts with no act of their own.
// - X.lit[key] / X.on[key] override ctx.lit / ctx.on for one part's draw: a mat board's LEDs and buttons have no state
//   in the engine (its own st.o and st.ctl are the base board's).
// - the breadboard's holes are one hand-built 2D path (figures/parts/breadboard.js), which a capture cannot place in
//   3D, so the wrapped breadboard draw adds the same squares again through pd(), which records their 3D points.
// - X.wires, when an array, collects each wire end pair the engine draws (matEnd and the breadboard's end()).
export function install() {
  const B = SL.bench;
  if (B.__xr) return true;
  const X = B.__xr = { lit: {}, on: {}, wires: null };
  const base = B.md;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const owner = () => { if (B.md === base) return ''; const it = B.matSetup().items.find((i) => i.md === B.md); return it ? it.id : ''; };
  const wrap = (fn) => function (ctx) {
    const o = owner(), key = (o ? o + '/' : '') + ctx.p.id;
    if (Object.prototype.hasOwnProperty.call(X.lit, key)) ctx.lit = X.lit[key];
    if (Object.prototype.hasOwnProperty.call(X.on, key)) ctx.on = X.on[key];
    const put = ctx.put;
    ctx.put = (bx, svg) => put(bx, svg ? `<g data-act="xr-part" data-id="${esc(key)}">${svg}</g>` : svg);
    try { return fn.call(this, ctx); } finally { ctx.put = put; }
  };
  for (const kd of Object.values(B.kinds)) { kd.draw = wrap(kd.draw); if (typeof kd.xr === 'function') kd.xr = wrap(kd.xr); }
  const bb = B.parts.breadboard;
  if (bb) {
    const d0 = bb.draw;
    bb.draw = function (ctx) {
      d0.call(this, ctx);
      const pl = ctx.pl, g = pl.geo, z = pl.zTop + .02, q = .42;
      let s = '';
      const sq = (x, y) => { s += fill(pd([pl.at(x - q, y - q, z), pl.at(x + q, y - q, z), pl.at(x + q, y + q, z), pl.at(x - q, y + q, z)]), '#3b3631'); };
      for (let c = 1; c <= g.cols; c++) for (const r of 'abcdefghij') sq(g.colX(c), g.rowY[r]);
      for (const y of Object.values(g.rails)) for (const c of g.railCols) sq(g.colX(c), y);
      const a = pl.at(0, 0, z), b = pl.at(g.w, g.h, z + .01);
      ctx.put([[Math.min(a[0], b[0]), Math.min(a[1], b[1]), z], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), z + .01]], act('bb', s, `data-id="${esc((ctx.p && ctx.p.id) || 'BB')}"`));
    };
  }
  const wire = B.parts.wire;
  if (wire) {
    const d0 = wire.draw;
    wire.draw = function (ctx) { if (X.wires) X.wires.push({ a: ctx.a.slice(), b: ctx.b.slice() }); return d0.call(this, ctx); };
  }
  return true;
}

// info() returns, as plain data, what the adapter needs from the engine: the base board, every mat item, the
// breadboard circuit with its placement, the wires and the frame. Positions are board mm of the board they belong to;
// leg and wire-end points the engine only knows in its world are given in its world ('w').
export function info() {
  const B = SL.bench, md = B.md, st = B.st, G = B.G, MAT = B.matSetup();
  const stepOn = (sid) => !sid || MAT.steps.findIndex((s) => s.id === sid) <= st.matStep;
  const partOf = (p) => ({ id: p.id, name: p.name, short: p.short || null, kind: p.kind, at: p.at, size: p.size, rot: p.rot || 0, h: p.h, z: p.z || 0,
    side: p.side || 'top', group: p.group, led: p.led || null, control: p.control || null, pins: Array.isArray(p.pins) ? p.pins : null, fixed: !!p.fixed,
    plug: !!(B.kinds[p.kind] && B.kinds[p.kind].plug), xr: !!(B.kinds[p.kind] && B.kinds[p.kind].xr),
    xrLabel: B.kinds[p.kind] && B.kinds[p.kind].xrLabel ? (() => { try { return B.kinds[p.kind].xrLabel(p); } catch (e) { return null; } })() : null });
  const boardOf = (m) => ({ id: m.id, name: m.name, type: m.type, pcb: m.pcb, parts: m.parts.map(partOf), pins: Object.values(m.pins).map((q) => ({ ...q })),
    tags: m.def.tags || [], notes: (m.def.xr && m.def.xr.notes) || [], sources: (m.power && m.power.sources) || {} });
  const out = {
    G: { ...G }, view: st.view, mountView: B.mountView || 'board', partPage: md.def.partPage ? md.def.partPage.name : null, noBoard: !!md.def.noBoard,
    base: boardOf(md), mat: [], wires: [], circuit: null,
  };
  for (const it of MAT.items) {
    const e = { id: it.id, kind: it.kind, name: it.name, at: it.at, w: it.w, h: it.h, on: stepOn(it.step), step: it.step };
    if (it.kind === 'board') {
      e.board = it.q.board; e.module = !!B.defs.module[it.q.board] && !B.defs.board[it.q.board];
      e.md = boardOf(it.md); e.dz = G.matH + it.md.pcb.standoff + it.md.pcb.thick - G.top;
    } else {
      e.part = it.q.part;
      const n = (it.def.legs || []).length, z = G.matH - G.top;
      const pts = it.q.legs || Array.from({ length: n }, (_, i) => [it.at[0] + it.w * (i + 1) / (n + 1), it.at[1]]);
      e.legs = (it.def.legs || []).slice(); e.legW = pts.map(([x, y]) => B.BP(x, y, z));
    }
    out.mat.push(e);
  }
  for (const w of MAT.wires) out.wires.push({ from: w.from, to: w.to, on: stepOn(w.step), mat: true });
  const pl = B.bbPlace && st.circuit ? B.bbPlace() : null;
  if (pl && (st.view === 'breadboard' || md.def.noBoard)) {
    const g = pl.geo;
    const c = { ox: pl.ox, oy: pl.oy, zTop: pl.zTop, geo: { kind: g.kind, cols: g.cols, w: g.w, h: g.h, x0: g.x0, rowY: g.rowY, rails: g.rails, railCols: g.railCols }, parts: [], props: [] };
    for (const q0 of pl.c.parts || []) {
      const q = Object.assign({}, q0, (st.cparams || {})[q0.id] || {}), def = B.parts[q.part] || {};
      const legs = (def.legs || []).slice();
      const legW = legs.map((_, i) => {
        const h = q.holes && q.holes[i] ? B.hole(g, q.holes[i]) : null;
        if (h) return { w: pl.at(h.x, h.y, pl.zTop + (def.pinZ || 0)), up: !!def.pinZ, hole: q.holes[i] };
        if (typeof def.legAt === 'function' && Array.isArray(q.at)) { try { return { w: def.legAt(q, B.BP(q.at[0], q.at[1], G.matH - G.top), i), up: true }; } catch (e) { return null; } }
        return null;
      });
      let elec = null; try { elec = typeof def.elec === 'function' ? def.elec(Object.assign({}, def.defaults || {}, def.example || {}, q)) : null; } catch (e) { elec = null; }
      c.parts.push({ id: q.id, part: q.part, name: def.name || q.part, holes: q.holes || null, at: q.at || null, legs, legW, pinZ: def.pinZ || 0,
        params: Object.keys(def.params || {}), press: typeof def.press === 'function', elec: Array.isArray(elec) ? elec.map((e) => e && e.type) : elec ? [elec.type] : [],
        color: q.color || null, angle: q.angle != null ? q.angle : null });
    }
    for (const q of pl.c.props || []) c.props.push({ id: q.id, prop: q.prop, name: (B.props[q.prop] || {}).name || q.prop });
    for (const w of pl.c.wires || []) out.wires.push({ from: w.from, to: w.to, on: true, mat: false });
    out.circuit = c;
  }
  return JSON.stringify(out);
}
