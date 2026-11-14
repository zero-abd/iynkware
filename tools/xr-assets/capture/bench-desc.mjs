// Component descriptors (src/parts/data/*.component.json) for the bench adapter: which descriptor an item, a mat board
// or a breadboard part is, and which descriptor pin each figure pin is, so pin anchors carry the simulation's ids
// (docs/XR_ASSETS.md section 5).
//
// A descriptor matches a figure through visual.breadboard.figure { kind, id } (kind 'board', 'module' or 'part' and
// the figure's file id), else through its legacy ids. Descriptor pin positions are board mm with the origin at the
// board's bottom-left corner, x right and y towards the back: the figures' own board frame (checked on the Uno R3,
// the Nano, the L298N and the breadboard, where every positioned pin sits within 0.01 mm of the figure's pin).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './page.mjs';

let ALL = null;
/** Every component descriptor, read once. */
export function descriptors() {
  if (ALL) return ALL;
  const dir = join(ROOT, 'src', 'parts', 'data');
  ALL = readdirSync(dir).filter((f) => f.endsWith('.component.json')).map((f) => {
    const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    d._file = f.replace(/\.component\.json$/, '');
    return d;
  });
  return ALL;
}

/** The descriptor for a figure { kind: 'board' | 'module' | 'part', id }, or null. */
export function descriptorFor(kind, id) {
  const all = descriptors();
  const fig = (d) => d.visual && d.visual.breadboard && d.visual.breadboard.figure;
  // boards and modules register with either registry (a module figure may sit on a bench as a board)
  const kinds = kind === 'part' ? ['part'] : ['board', 'module'];
  return all.find((d) => fig(d) && kinds.includes(fig(d).kind) && fig(d).id === id)
    || all.find((d) => fig(d) && fig(d).id === id)
    || all.find((d) => d._file === id || ((d.identity && d.identity.legacy_ids) || []).includes(id))
    || null;
}

/** The short id a sidecar's source.descriptor names: the descriptor's file name ('uno-r3', 'l298n-module'). */
export const descriptorName = (d) => d._file;

const TOL = 0.3;   // mm: a figure pin and a positioned descriptor pin closer than this are the same pin

/** Figure pins -> descriptor pins.
    pins: [{ id, part, n, at: [x, y], net, label }] (the figure's md.pins); parts: { id: { pins: [...] } } (header nets in
    order). Returns { map: Map(figurePinId -> descriptorPin), twins: Map(figurePinId -> the co-located figure pin that
    stands for it), unmatched: physical descriptor pins no figure pin took }. Order of the rules: position, then a
    connector whose id is a header part's id with the same pin count, then a header that is a run of a connector, then
    the net name equal to a descriptor pin id, then the silkscreen label equal to a descriptor designator (each only
    when unambiguous). */
export function matchPins(desc, pins, parts) {
  const map = new Map(), used = new Set();
  const dps = desc.pins || [];
  const take = (fp, dp) => { map.set(fp.id, dp); used.add(dp.id); };
  // 1. position, nearest first
  const pairs = [];
  for (const fp of pins) for (const dp of dps) if (dp.position && Number.isFinite(dp.position.x)) {
    const d = Math.hypot(dp.position.x - fp.at[0], dp.position.y - fp.at[1]);
    if (d < TOL) pairs.push([d, fp, dp]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, fp, dp] of pairs) if (!map.has(fp.id) && !used.has(dp.id)) take(fp, dp);
  // 2. connector order: descriptor connector C lists its pins in order; figure part C has as many pins
  const byPart = new Map();
  for (const fp of pins) { if (!byPart.has(fp.part)) byPart.set(fp.part, []); byPart.get(fp.part).push(fp); }
  for (const c of desc.connectors || []) {
    const part = parts[c.id] || Object.values(parts).find((p) => p.id.toLowerCase() === String(c.id).toLowerCase());
    if (!part || !Array.isArray(part.pins) || part.pins.length !== (c.pins || []).length) continue;
    const list = byPart.get(part.id) || [];
    c.pins.forEach((pid, i) => {
      const fp = list.find((q) => q.n === i + 1), dp = dps.find((q) => q.id === pid);
      if (fp && dp && !map.has(fp.id) && !used.has(dp.id)) take(fp, dp);
    });
  }
  // 3. a figure header that is a run of a descriptor connector (the Pico's castellated PINS1 is edge pins 1-20, the
  //    Uno R4's JANALOG_P and JANALOG_A are JANALOG 1-8 and 9-14): the offset where the figure pins' nets or labels
  //    agree with the connector's ids or designators, taken when at least 3 of 4 agree and no other offset does as well
  const key = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const agree = (fp, dp) => { const d = [dp.id, dp.designator].map(key).filter(Boolean); return [fp.net, fp.label].map(key).some((x) => x && d.includes(x)); };
  for (const c of desc.connectors || []) {
    const cps = (c.pins || []).map((pid) => dps.find((q) => q.id === pid) || null);
    for (const part of Object.values(parts)) {
      const list = (byPart.get(part.id) || []).slice().sort((a, b) => a.n - b.n);
      if (list.length < 3 || list.length > cps.length || list.every((fp) => map.has(fp.id))) continue;
      const score = [];
      for (let o = 0; o + list.length <= cps.length; o++) score.push([list.reduce((t, fp, i) => t + (cps[o + i] && agree(fp, cps[o + i]) ? 1 : 0), 0), o]);
      score.sort((a, b) => b[0] - a[0]);
      if (!score.length || score[0][0] < list.length * .75 || (score[1] && score[1][0] === score[0][0])) continue;
      const o = score[0][1];
      list.forEach((fp, i) => { const dp = cps[o + i]; if (dp && !map.has(fp.id) && !used.has(dp.id)) take(fp, dp); });
    }
  }
  // 4. net == descriptor id, 5. label == designator: only when one figure pin and one descriptor pin are left
  const rule = (fkey, dkey) => {
    const left = pins.filter((fp) => !map.has(fp.id)), free = dps.filter((dp) => !used.has(dp.id));
    for (const dp of free) {
      const want = dp[dkey];
      if (!want) continue;
      const hits = left.filter((fp) => fp[fkey] === want && !map.has(fp.id));
      const twins = free.filter((q) => q[dkey] === want && !used.has(q.id));
      if (hits.length === 1 && twins.length === 1) take(hits[0], dp);
    }
  };
  rule('net', 'id');
  rule('label', 'designator');
  rule('net', 'designator');
  // co-located figure pins (a male header soldered through castellated pads: the Pico's H1.1 over PINS1.1) are one
  // point: the taller part's pin keeps the descriptor pin, the other becomes its twin (an alias, not an anchor)
  const twins = new Map();
  const tall = (fp) => { const p = parts[fp.part] || {}; return (p.h || 0) + (p.z || 0); };
  for (const a of pins) {
    if (!map.has(a.id)) continue;
    for (const b of pins) {
      if (b === a || map.has(b.id) || twins.has(b.id) || Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) > .05) continue;
      if (tall(b) > tall(a)) { map.set(b.id, map.get(a.id)); map.delete(a.id); twins.set(a.id, b.id); break; }
      twins.set(b.id, a.id);
    }
  }
  // pins of a connector that is not a header (an FPGA's 'other' list of switch and LED signals) are logical, not
  // physical: they are not reported as missing
  const logical = new Set((desc.connectors || []).filter((c) => c.kind && c.kind !== 'header').flatMap((c) => c.pins || []));
  return { map, twins, unmatched: dps.filter((dp) => !used.has(dp.id) && !logical.has(dp.id)) };
}

/** A breadboard part's legs -> descriptor pins: a leg name equal to a pin id or designator, else by order when the
    counts agree. Returns an array of descriptor pins (or null) per leg. */
export function matchLegs(desc, legs) {
  const dps = (desc && desc.pins) || [];
  const used = new Set();
  const out = legs.map((name) => {
    const dp = dps.find((q) => !used.has(q.id) && q.id === name) || dps.find((q) => !used.has(q.id) && q.designator === name);
    if (dp) used.add(dp.id);
    return dp || null;
  });
  if (out.some((x) => !x) && dps.length === legs.length) {
    out.forEach((x, i) => { if (!x && !used.has(dps[i].id)) { out[i] = dps[i]; used.add(dps[i].id); } });
  }
  return out;
}
