// Turns one figure into a .glb and its sidecar (docs/XR_ASSETS.md). The engine adapter (bench.mjs, drone.mjs) puts
// the page in its states and names the parts, anchors and channels; this file captures each state, compares them
// (see-through adds the xray layer, explode moves parts, a channel moves or lights pieces), maps the figure's world
// into the asset frame and writes the files.
import { buildPage, loadPage } from './page.mjs';
import { walk } from './walk.mjs';
import { fitRigid, axisAngle } from './fit.mjs';
import { fromPrim, fromPath, fromText, triangulate, newell, add, sub, scale, dot, cross, norm, len } from '../gltf/geom.mjs';
import { MeshBatch, writeGlb } from '../gltf/glb.mjs';

export const VERSION = '1.0.0';
const R2 = (v) => Math.round(v * 100) / 100;
const sigOf = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? R2(v) : v));

/** One capture of the page's current state: every draw with its part, geometry and signatures. */
export function capture(page, adapter) {
  const s = page.scene();
  const { draws, dropped } = walk(s.svg, s);
  const out = [];
  for (const d of draws) {
    let g, geo, col;
    if (d.k === 'prim') {
      const p = s.prims[d.id];
      if (!p) continue;
      g = fromPrim(p, s.shades);
      geo = sigOf(geoKey(p)); col = sigOf(p);
      g.prim = p;
    } else if (d.k === 'path') {
      g = fromPath(d, s.shades);
      geo = sigOf({ t: 'path', pts: d.pts }); col = sigOf({ pts: d.pts, f: d.fill, s: d.stroke });
    } else {
      g = { faces: [], lines: [], marks: [], text: fromText(d) };
      geo = sigOf({ t: 'text', o: d.o, s: d.str }); col = sigOf({ o: d.o, s: d.str, f: d.fill });
    }
    if (!g.faces.length && !g.lines.length && !(g.marks && g.marks.length) && !g.text) continue;
    const part = adapter.partOf(d.ctx, d, g);
    if (part == null) continue;
    out.push({ part, ctx: d.ctx, kind: d.k, faces: g.faces, lines: g.lines, marks: g.marks || [], text: g.text || null, geo, col, opacity: d.ctx.opacity * (d.opacity ?? 1), prim: g.prim || null, draw: d });
  }
  return { draws: out, dropped, errors: page.notes() };
}

function geoKey(p) {
  switch (p.t) {
    case 'loft': return { t: 'loft', q: (p.strips || []).map((s) => s.q) };
    case 'shape': return { t: 'shape', pts: p.pts };
    default: { const { m, cls, c, hint, ...rest } = p; void m; void cls; void c; void hint; return rest; }
  }
}

const verts = (d) => [...d.faces.flatMap((f) => f.v), ...d.lines.flatMap((l) => l.pts)];
function boundsOf(list) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const d of list) for (const p of verts(d)) for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; }
  return mn[0] === Infinity ? null : { min: mn, max: mx };
}
const multiset = (list, key) => { const m = new Map(); for (const d of list) { const k = d.part + '\u0001' + d[key]; m.set(k, (m.get(k) || 0) + 1); } return m; };
/** Draws of `b` that `a` does not have (as a multiset by key). */
function minus(b, a, key) {
  const m = multiset(a, key), out = [];
  for (const d of b) { const k = d.part + '\u0001' + d[key]; const n = m.get(k) || 0; if (n > 0) m.set(k, n - 1); else out.push(d); }
  return out;
}

/** The figure's frames (docs/XR_ASSETS.md section 2): source mm to the asset's axes (before centring and scale). */
const AXES = {
  'board-mm': ([x, y, z]) => [x, z, -y],
  'flu-mm': ([x, y, z]) => [y, z, x],
  'range-m': ([x, y, z]) => [x, z, -y],
};

export async function convert(item, adapter, { log = () => {} } = {}) {
  const t0 = Date.now();
  const { html, sha256 } = buildPage(item);
  const page = await loadPage(html, item, adapter.query || "");
  const warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };
  try {
    const info = await adapter.setup(page, { warn });
    const rest = capture(page, adapter);
    await adapter.xray(page, true);
    const xr = capture(page, adapter);
    await adapter.xray(page, false);
    await adapter.explode(page, true);
    const ex = capture(page, adapter);
    await adapter.explode(page, false);

    // channels: what changes when each one is driven
    const chans = [];
    for (const ch of await adapter.channels(page, { warn })) {
      await ch.apply(page);
      const act = capture(page, adapter);
      await adapter.reset(page);
      const scope = (list) => (ch.parts ? list.filter((d) => ch.parts.includes(d.part)) : list);
      const R = scope(rest.draws), A = scope(act.draws);
      let moved;
      if (ch.kind === 'emissive') {
        // same geometry, other colours: pair rest and active draws by geometry, keep the ones whose colour changed
        const byGeo = new Map();
        for (const d of A) { const k = d.part + '\u0001' + d.geo; if (!byGeo.has(k)) byGeo.set(k, []); byGeo.get(k).push(d); }
        moved = [];
        const lit = new Map();
        for (const d of R) {
          const q = (byGeo.get(d.part + '\u0001' + d.geo) || []).shift();
          if (q && q.col !== d.col) {
            moved.push(d);
            for (const f of q.faces) lit.set(f.mat.l, (lit.get(f.mat.l) || 0) + 1);
          }
        }
        if (!ch.color && lit.size) ch.color = [...lit.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else {
        const gone = minus(R, A, 'geo'), came = minus(A, R, 'geo');
        moved = gone;
        if (!ch.axis && gone.length && gone.length === came.length) {
          const P = [], Q = [];
          for (let i = 0; i < gone.length; i++) { const a = verts(gone[i]), b = verts(came[i]); if (a.length !== b.length) continue; P.push(...a); Q.push(...b); }
          if (P.length >= 3) {
            const fit = fitRigid(P, Q);
            if (ch.kind === 'translate') { const tl = len(fit.t); ch.fitAxis = tl > 1e-6 ? norm(fit.t) : null; ch.fitAmount = tl; }
            else { const aa = axisAngle(fit, centroid(P)); ch.fitAxis = aa.axis; ch.fitPivot = aa.pivot; ch.fitAngle = aa.angle; }
            ch.fitRms = fit.rms;
          }
        } else if (!ch.axis && gone.length !== came.length) warn(`${ch.id}: the moved pieces did not pair up (${gone.length} at rest, ${came.length} moved), so no axis was fitted`);
      }
      if (!moved.length) { warn(`${ch.id}: nothing changed when it was driven, so it has no node`); continue; }
      chans.push({ ch, moved });
      log(`  ${ch.id}: ${moved.length} draws`);
    }

    // the xray layer: drawn only in see-through
    const xray = minus(xr.draws, rest.draws, 'col').filter((d) => d.faces.length || d.lines.length || d.text || d.marks.length);
    const hiddenInXr = minus(rest.draws, xr.draws, 'col').length;
    if (hiddenInXr) log(`  ${hiddenInXr} draws disappear in see-through (kept in base)`);

    // frame: core -> source mm (adapter) -> asset axes; centre and metres below
    const frame = info.frame;
    const toAxes = (p) => AXES[frame.source](frame.coreToSource(p));
    const linDir = (n) => { const o = frame.coreToSource([0, 0, 0]), q = frame.coreToSource(n); return norm(AXES[frame.source](sub(q, o))); };
    const restY = frame.restZ ?? 0;
    const allBase = rest.draws.filter((d) => d.faces.length || d.lines.length);
    const bAxes = boundsOf(allBase.map((d) => ({ faces: d.faces.map((f) => ({ v: f.v.map(toAxes) })), lines: d.lines.map((l) => ({ pts: l.pts.map(toAxes) })) })));
    const centre = frame.origin === 'footprint-centre' && bAxes ? [(bAxes.min[0] + bAxes.max[0]) / 2, restY, (bAxes.min[2] + bAxes.max[2]) / 2]
      : [0, restY, 0];
    const SC = 0.001;
    const toAsset = (p) => { const a = toAxes(p); return [(a[0] - centre[0]) * SC, (a[1] - centre[1]) * SC, (a[2] - centre[2]) * SC]; };
    const dirAsset = (n) => linDir(n);
    const fromSource = sourceMatrix(frame.source, centre, SC);

    // parts
    const partDefs = adapter.parts(page);
    const parts = [{ id: '', index: 0, name: info.name, parent: '', role: 'item', explode: [0, 0, 0] }];
    const byId = new Map([['', parts[0]]]);
    for (const p of partDefs) {
      if (byId.has(p.id)) continue;
      const q = { id: p.id, index: parts.length, name: p.name || p.id, parent: p.parent || '', role: p.role || 'part', explode: [0, 0, 0] };
      if (p.cover) q.cover = true;
      if (p.group) q.group = p.group;
      if (p.after && p.after.length) q.after = p.after;
      if (p.extras) q.extras = p.extras;
      parts.push(q); byId.set(q.id, q);
    }
    for (const d of [...rest.draws, ...xray]) if (!byId.has(d.part)) {
      const q = { id: d.part, index: parts.length, name: d.part, parent: '', role: 'part', explode: [0, 0, 0] };
      parts.push(q); byId.set(q.id, q);
      warn(`part "${d.part}" draws but is not in the engine's part list`);
    }
    if (parts.length > 65535) throw new Error('too many parts');

    // explode: each part's offset from its bounds at explode 0 and 1
    const byPart = (list) => { const m = new Map(); for (const d of list) { if (!m.has(d.part)) m.set(d.part, []); m.get(d.part).push(d); } return m; };
    const restBy = byPart(rest.draws.filter((d) => d.faces.length || d.lines.length)), exBy = byPart(ex.draws.filter((d) => d.faces.length || d.lines.length));
    for (const [id, list] of restBy) {
      const a = boundsOf(list), b = exBy.has(id) ? boundsOf(exBy.get(id)) : null;
      if (!a || !b) continue;
      const da = sub(a.max, a.min), db = sub(b.max, b.min);
      const off = sub(b.min, a.min);
      if (len(sub(da, db)) > 0.2 && len(off) > 0.01) warn(`part "${id}" changes size when exploded; its offset is from its lowest corner`);
      if (len(off) > 0.01) byId.get(id).explode = sub(toAsset(off), toAsset([0, 0, 0])).map((v) => +v.toFixed(6));
    }

    // what goes where: channel nodes take their moved draws; covers and xray get their own static nodes
    const taken = new Map();
    for (const { ch, moved } of chans) for (const d of moved) if (!taken.has(d)) taken.set(d, ch.id); else warn(`${ch.id}: a piece is also driven by ${taken.get(d)}; it stays with ${taken.get(d)}`);
    const anyExplode = parts.some((p) => p.explode.some((v) => v !== 0));
    const nodeStatic = new MeshBatch('static', { explode: anyExplode, extras: { layer: 'base' } });
    const nodeCover = new MeshBatch('static.cover', { explode: anyExplode, extras: { layer: 'cover' } });
    const nodeXray = new MeshBatch('static.xray', { explode: anyExplode, extras: { layer: 'xray' } });
    const chanNodes = new Map();
    const texts = [];
    const marks = [];
    const put = (batch, d, origin = [0, 0, 0], layer = 'base') => {
      const part = byId.get(d.part), ex = part.explode;
      // outline normals: faces of one part welded by position
      const fs = d.faces.map((f) => {
        const v = f.v.map((p) => sub(toAsset(p), origin));
        let n = dirAsset(f.n);
        const geo = newell(v);
        if (dot(geo, n) < 0 && (geo[0] || geo[1] || geo[2])) { /* winding is set by triangulate from n */ }
        if (f.cls === 'flat') { const k = 0.00002; for (const p of v) { p[0] += n[0] * k; p[1] += n[1] * k; p[2] += n[2] * k; } }
        return { v, n, f };
      });
      batch._pending = batch._pending || [];
      batch._pending.push({ fs, part, ex, lines: d.lines.map((l) => ({ pts: l.pts.map((p) => sub(toAsset(p), origin)), col: l.col, w: l.w })) });
      if (d.text) {
        const t = d.text;
        texts.push({ part: d.part, text: t.str, position: round6(toAsset(t.o)), normal: round6(dirAsset(t.n)), up: round6(dirAsset(t.up)), size: +(t.size * 0.72 * SC).toFixed(6), color: t.col, weight: t.weight, layer });
      }
      for (const m of d.marks) marks.push({ ...m, part: d.part, layer, position: toAsset(m.at) });
    };
    for (const d of rest.draws) {
      if (taken.has(d)) continue;
      const part = byId.get(d.part);
      put(part.cover ? nodeCover : nodeStatic, d);
    }
    for (const d of xray) put(nodeXray, d, [0, 0, 0], 'xray');
    for (const { ch, moved } of chans) {
      const mine = moved.filter((d) => taken.get(d) === ch.id);
      if (!mine.length) continue;
      const b = boundsOf(mine);
      let pivotCore = ch.pivot || ch.fitPivot || [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const origin = toAsset(pivotCore);
      const node = new MeshBatch(ch.id, { translation: round6(origin), extras: { layer: 'base', channel: ch.id } });
      for (const d of mine) put(node, d, origin);
      chanNodes.set(ch.id, { node, ch, origin, pivotCore, parts: [...new Set(mine.map((d) => d.part))] });
    }
    const batches = [nodeStatic, nodeCover, nodeXray, ...[...chanNodes.values()].map((c) => c.node)];
    for (const b of batches) flush(b);

    // channels for the sidecar
    const channels = [];
    for (const { ch, origin, pivotCore, parts: cparts, node } of chanNodes.values()) {
      if (node.empty) continue;
      const c = { id: ch.id, kind: ch.kind, part: ch.part || cparts[0], nodes: [ch.id], value: ch.value };
      if (ch.kind === 'emissive') { if (ch.value.unit !== 'rgb') c.color = (ch.color || '#ffd34d').toLowerCase(); }
      else {
        const axisCore = ch.axis || ch.fitAxis;
        if (!axisCore) { warn(`${ch.id}: no axis`); continue; }
        c.axis = round6(dirAsset(axisCore));
        if (ch.kind !== 'translate') c.pivot = round6(origin);
        if (ch.kind === 'translate') c.scale = +(((ch.amount ?? ch.fitAmount ?? 0) * SC) / ((ch.active ?? ch.value.max) - ch.value.rest || 1)).toFixed(6);
        else if (ch.kind === 'rotate') {
          // the fitted angle is about the fitted axis in the figure's frame; the asset frame may be mirrored from it
          const J = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => sub(toAxes(e), toAxes([0, 0, 0])));
          const det = Math.sign(dot(J[0], cross(J[1], J[2]))) || 1;
          const ang = ch.angle ?? ch.fitAngle ?? 0;
          c.scale = +((det * ang) / (((ch.active ?? ch.value.max) - ch.value.rest) || 1)).toFixed(6);
        } else c.scale = ch.scale;
      }
      if (ch.bind) c.bind = ch.bind;
      if (ch.extras) c.extras = ch.extras;
      void pivotCore;
      channels.push(c);
      for (const id of cparts) { const p = byId.get(id); if (p) (p.nodes || (p.nodes = [])).includes(ch.id) || p.nodes.push(ch.id); }
    }

    // anchors (the adapter gives them in the figure's world)
    const anchors = [];
    const seen = new Set();
    for (const a of await adapter.anchors(page, { marks, warn, toAsset, rest })) {
      if (seen.has(a.id)) { warn(`anchor id "${a.id}" twice; the second is dropped`); continue; }
      seen.add(a.id);
      const o = { id: a.id, kind: a.kind, part: a.part ?? '', position: round6(toAsset(a.position)), normal: round6(dirAsset(a.normal)) };
      for (const k of ['aliases', 'members', 'text', 'layer', 'dir', 'channel', 'extras']) if (a[k] != null && !(Array.isArray(a[k]) && !a[k].length)) o[k] = a[k];
      if (a.depth != null) o.depth = +(a.depth * SC).toFixed(6);
      if (a.up) o.up = round6(dirAsset(a.up));
      if (a.rect) o.rect = { origin: round6(toAsset(a.rect.origin)), u: round6(sub(toAsset(a.rect.u), toAsset([0, 0, 0]))), v: round6(sub(toAsset(a.rect.v), toAsset([0, 0, 0]))), pixels: a.rect.pixels };
      if (!byId.has(o.part)) { warn(`anchor ${a.id}: unknown part "${o.part}"`); o.part = ''; }
      anchors.push(o);
    }

    // bounds per part and of the item
    for (const p of parts) {
      const list = [...(restBy.get(p.id) || [])];
      const b = boundsOf(list);
      if (b) { const lo = toAsset(b.min), hi = toAsset(b.max); p.bounds = { min: round6(lo.map((v, i) => Math.min(v, hi[i]))), max: round6(lo.map((v, i) => Math.max(v, hi[i]))) }; }
    }
    const all = boundsOf(allBase);
    const lo = toAsset(all.min), hi = toAsset(all.max);
    const bounds = { min: round6(lo.map((v, i) => Math.min(v, hi[i]))), max: round6(lo.map((v, i) => Math.max(v, hi[i]))) };

    const layers = [{ id: 'base', nodes: ['static', ...[...chanNodes.values()].filter((c) => !c.node.empty).map((c) => c.ch.id)].filter((n) => n !== 'static' || !nodeStatic.empty), opacity: [1, 1] }];
    if (!nodeCover.empty) layers.push({ id: 'cover', nodes: ['static.cover'], opacity: [1, 0.28] });
    if (!nodeXray.empty) layers.push({ id: 'xray', nodes: ['static.xray'], opacity: [0, 1] });

    const glb = writeGlb({ name: item, nodes: batches, extras: { xrAsset: 'iynkware.xr-asset/1', id: item } });
    const drawn = batches.filter((b) => b !== nodeXray);
    const stats = {
      triangles: drawn.reduce((s, b) => s + b.triangleCount, 0), trianglesXray: nodeXray.triangleCount,
      drawCalls: drawn.reduce((s, b) => s + b.primitiveCount, 0), lineSegments: batches.reduce((s, b) => s + b.segmentCount, 0),
      nodes: 1 + batches.filter((b) => !b.empty).length, bytes: glb.length,
    };
    for (const [k, v] of Object.entries(rest.dropped)) if (k !== 'path' || v > 0) warn(`${v} screen-space ${k} element${v === 1 ? '' : 's'} (glows, halos, 2D marks) have no 3D and were left out`);
    for (const e of rest.errors) warn(`figure note: ${e}`);
    const look = lookOf(info.az ?? 105, dirAsset);
    const id = item.split('/')[1];
    const sidecar = {
      schema: 'iynkware.xr-asset/1', id: item, kind: info.kind, name: info.name, glb: `${id}.glb`,
      source: { figure: `figures/${item}.js`, engine: adapter.engine, pageSha256: sha256, ...(info.descriptor ? { descriptor: info.descriptor } : {}) },
      generator: { tool: 'tools/xr-assets', version: VERSION },
      frame: { units: 'm', up: '+Y', front: '+Z', handedness: 'right', origin: frame.origin, source: frame.source, fromSource },
      bounds, stats, look, parts, anchors, channels, layers, texts, warnings,
    };
    if (info.extras) sidecar.extras = info.extras;
    log(`  ${item}: ${stats.triangles} tris, ${stats.drawCalls} draws, ${anchors.length} anchors, ${channels.length} channels, ${Date.now() - t0} ms`);
    return { glb, sidecar };
  } finally {
    page.close();
  }
}

const centroid = (ps) => scale(ps.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / ps.length);
const round6 = (v) => v.map((x) => +x.toFixed(6) + 0);

function flush(batch) {
  const pend = batch._pending || [];
  delete batch._pending;
  // weld by position per part for the outline normal
  const acc = new Map();
  const key = (p, part) => part.index + ':' + Math.round(p[0] * 1e5) + ',' + Math.round(p[1] * 1e5) + ',' + Math.round(p[2] * 1e5);
  for (const e of pend) for (const { v, n, f } of e.fs) {
    if (f.cls === 'flat') continue;
    const area = len(cross(sub(v[1] || v[0], v[0]), sub(v[2] || v[0], v[0]))) + 1e-12;
    for (const p of v) { const k = key(p, e.part); const s = acc.get(k) || [0, 0, 0]; acc.set(k, add(s, scale(n, area))); }
  }
  for (const e of pend) {
    for (const { v, n, f } of e.fs) {
      const tris = triangulate(v, n);
      if (!tris.length) continue;
      const on = v.map((p) => { const s = acc.get(key(p, e.part)); return s && len(s) > 0 ? norm(s) : n; });
      batch.addFace(v, tris, n, f.mat, f.cls, e.part.index, e.ex, on);
    }
    for (const l of e.lines) batch.addLine(l.pts, l.col, l.w, e.part.index, e.ex);
  }
}

function sourceMatrix(source, centre, sc) {
  // column-major 4x4 from source mm to asset metres: asset = sc * (AXES(p) - centre)
  const ax = AXES[source];
  const cols = [ax([1, 0, 0]), ax([0, 1, 0]), ax([0, 0, 1])];
  const m = [];
  for (const c of cols) m.push(c[0] * sc, c[1] * sc, c[2] * sc, 0);
  m.push(-centre[0] * sc, -centre[1] * sc, -centre[2] * sc, 1);
  return m.map((v) => +v.toFixed(9) + 0);
}

function lookOf(az, dirAsset) {
  const a = az * Math.PI / 180, SH = [0.85 * Math.cos(a), 0.85 * Math.sin(a)];
  const L = norm([-SH[0], -SH[1], 1]), LIN = norm([0.6, 0.2, 1]);
  const p = Math.atan(1 / Math.SQRT2), V = [Math.cos(p) * Math.cos(Math.PI / 4), Math.cos(p) * Math.sin(Math.PI / 4), Math.sin(p)];
  return { ink: '#231e16', paper: '#f2efe7', shadow: '#41538f', sun: round6(dirAsset(L)), fixedLight: round6(dirAsset(LIN)), defaultView: round6(dirAsset(V)), shadowLength: 0.45 };
}
