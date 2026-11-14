// Board Bench flat sheets: the schematic of the lesson circuit and the board's power tree. Both are drawn in viewBox
// units on a paper plate inside #art, so they get the same hand-ink filter, wobble and grain as the 3D views. Every
// symbol is pressable and selects the same part id as the 3D figure; live pin levels, rail voltages, LED current
// and state are drawn on the sheet. Data: the circuit (FIGURES-BENCH.md §9) and power.rails (§6).
(() => {
const B = SL.bench, T = B.T;
const vb = () => { const el = document.getElementById('fig'); const v = el && el.viewBox && el.viewBox.baseVal; return v && v.width ? v : { x: 0, y: 0, width: 200, height: 150 }; };
// the part of the frame the figure's own buttons and stats leave free (all of it with ?bare=1 or on a phone)
const sheetBox = () => { const v = vb(), el = document.getElementById('fig'); let x0 = v.x, x1 = v.x + v.width;
  try { const m = el.getScreenCTM(); if (m){ const inv = m.inverse(), btn = document.getElementById('btns'), sts = document.getElementById('stats');
    if (btn && btn.offsetParent){ const r = btn.getBoundingClientRect(), q = new DOMPoint(r.right + 10, r.top).matrixTransform(inv); if (q.x > x0 && q.x < v.x + v.width * .45) x0 = q.x; }
    if (sts && sts.offsetParent){ const r = sts.getBoundingClientRect(), q = new DOMPoint(r.left - 10, r.top).matrixTransform(inv); if (q.x < x1 && q.x > v.x + v.width * .55) x1 = q.x; } } } catch (e) {}
  return { x: x0, y: v.y, width: x1 - x0, height: v.height }; };
const esc = s => CF_ESC(String(s));
const txt = (x, y, s, size, col = INK, anchor = 'middle', weight = 700) => `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" fill="${col}" text-anchor="${anchor}" font-family="ui-monospace,Menlo,monospace" font-weight="${weight}">${esc(s)}</text>`;
const ln = (pts, w = 1.1, col = INK, extra = '') => `<path d="M${pts.map(p => p.map(f).join(' ')).join('L')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const plate = (v, title) => {
  const m = v.width * .04;
  return `<rect x="${f(v.x + m)}" y="${f(v.y + m)}" width="${f(v.width - 2 * m)}" height="${f(v.height - 2 * m)}" rx="${f(m * .4)}" fill="#fbf8ef" stroke="${INK}" stroke-width="1.4"/>`
    + txt(v.x + m * 2, v.y + m * 2 + v.width * .022, title, v.width * .028, INK, 'start', 800);
};
const accent = 'var(--accent,#f4b829)';

/* ---------- schematic ---------- */
// The circuit as a netlist: a net is what the breadboard strips and rails and the wires join, a part a symbol on its legs
// (the same joins the solver makes). Two-legged parts whose shared net touches nothing else stand in series on one row,
// every other part is a block listing its pins. A board pin that reaches a part is a wire from the board block to it;
// ground, supply pins and the nets the series rows end on are drawn as a symbol or a name at the pin.
const SERIES_W = 12, LINK_W = 4;
function netlist(){
  const st = B.st, c = B.circuitNow(), pl = c && B.bbPlace(); if (!pl) return null;
  const par = {}, names = {}, sockets = new Set(), find = a => { while (par[a] !== a) a = par[a]; return a; }, add = a => { if (par[a] == null) par[a] = a; return a; };
  const uni = (a, b) => { if (a == null || b == null) return; const x = find(add(a)), y = find(add(b)); if (x !== y) par[x] = y; };
  const parts = (c.parts || []).map(p => Object.assign({}, p, (st.cparams || {})[p.id] || {}));
  const byId = Object.fromEntries(parts.map(p => [p.id, p])), defOf = p => B.parts[p.part];
  // the node under leg i: its hole's strip, or the leg itself for a part lying on the mat (a wire may end on it)
  const legNode = (p, i) => { const h = p.holes && p.holes[i] ? B.hole(pl.geo, p.holes[i]) : null; if (h) return add(h.node);
    const d = defOf(p), n = 'L:' + p.id + '.' + i; names[n] = p.id + '.' + (((d && d.legs) || [])[i] || ((d && d.nodes) || [])[i - ((d && d.legs) || []).length] || i); return add(n); };
  const end = ref => { const h = B.hole(pl.geo, ref); if (h) return add(h.node);
    const m = /^([A-Za-z_][\w-]*)\.([\w+~-]+)$/.exec(ref), q = m && byId[m[1]];
    if (q){ const d = defOf(q), i = d && d.legs ? d.legs.indexOf(m[2]) : -1; return i >= 0 ? legNode(q, i) : null; }
    const pin = B.pinOf(ref); return pin ? add('N:' + pin.net) : null; };
  for (const w of c.wires || []) uni(end(w.from), end(w.to));
  // a plug pushed into another part's socket joins that part's socket nodes in order
  for (const q of parts){ const r = byId[q.plug], d = defOf(q), rd = r && defOf(r), sock = rd && rd.socket; if (!r || !d || !Array.isArray(sock)) continue;
    const all = [...(rd.legs || []), ...(rd.nodes || [])];
    (d.legs || []).forEach((_, i) => { const j = i < sock.length ? all.indexOf(sock[i]) : -1; if (j >= 0){ uni(legNode(q, i), legNode(r, j)); sockets.add(legNode(r, j)); } }); }
  const els = [], blocks = [];
  for (const [at, p] of parts.entries()){
    const d = defOf(p); if (!d) continue;
    const legs = d.legs || [], N = i => find(legNode(p, i));
    let es = []; try { es = [].concat(d.elec ? d.elec(p) : []); } catch (e) { es = []; }
    const e = es.length === 1 ? es[0] : null;
    if (e && e.type === 'wire'){ uni(legNode(p, 0), legNode(p, 1)); continue; }
    if (e && e.type === 'button') for (const [a, b] of e.pairs || []) uni(legNode(p, a), legNode(p, b));
    const two = e && legs.length === 2 ? { shape: ({ res: 'res', led: 'led', diode: 'diode' })[e.type] || 'block', i: [0, 1] } : e && e.type === 'button' ? { shape: 'switch', i: [0, 2] } : null;
    if (two) els.push({ at, p, d, shape: two.shape, ends: two.i.map(i => ({ leg: legs[i], node: N(i) })) });
    else blocks.push({ at, p, d, pins: legs.map((leg, i) => ({ leg, node: N(i) })) });
  }
  // what each net holds: board nets (a pin or a rail) and the part pins that end on it
  const rails = (B.md.power && B.md.power.rails) || {}, info = {};
  const slot = a => { const r = find(a); return info[r] || (info[r] = { nets: [], n: 0, ends: [] }); };
  for (const k of Object.keys(par)) if (k.startsWith('N:')) slot(k).nets.push(k.slice(2));
  const touch = (node, el) => { const i = slot(node); i.n++; i.ends.push(el); };
  for (const el of els) for (const x of el.ends) touch(x.node, el);
  for (const b of blocks) for (const x of b.pins) touch(x.node, b);
  const socketOf = node => [...sockets].find(k => find(k) === find(node));
  const kindOf = node => { const i = info[find(node)] || { nets: [], n: 0 };
    return i.nets.includes('GND') ? 'gnd' : i.nets.some(n => Object.prototype.hasOwnProperty.call(rails, n)) ? 'power' : i.nets.length ? 'pin' : i.n > 1 || socketOf(node) ? 'node' : 'open'; };
  // a net's name: the board pin it reaches, else the socket node of the part it plugs into, else N1, N2 in order of use
  const numbered = {};
  const netName = node => { const i = info[find(node)] || { nets: [] };
    const pin = i.nets.find(n => n !== 'GND' && Object.prototype.hasOwnProperty.call(rails, n)) || i.nets.find(n => n !== 'GND') || i.nets[0];
    if (pin) return pin;
    const sock = socketOf(node); if (sock) return names[sock];
    return kindOf(node) === 'node' ? numbered[find(node)] || (numbered[find(node)] = 'N' + (Object.keys(numbered).length + 1)) : ''; };
  // series rows: two-legged parts joined end to end by a net nothing else touches
  const linked = node => { const i = info[find(node)]; return !!i && !i.nets.length && i.n === 2 && i.ends[0] !== i.ends[1] && i.ends.every(x => els.includes(x)); };
  const peer = (el, node) => info[find(node)].ends.find(x => x !== el);
  const score = node => ({ pin: 3, node: 2, power: 1, open: 1, gnd: 0 })[kindOf(node)];
  const rows = [], seen = new Set();
  for (const el of els){
    if (seen.has(el)) continue;
    let first = el, from = el.ends[0].node;
    for (const guard = new Set([el]);;){ if (!linked(from)) break; const nb = peer(first, from); if (guard.has(nb)) break; guard.add(nb);
      from = nb.ends[0].node === from || find(nb.ends[0].node) === find(from) ? nb.ends[1].node : nb.ends[0].node; first = nb; }
    const items = []; let l = from, cur = first;
    for (;;){ seen.add(cur); const a = find(cur.ends[0].node) === find(l) ? 0 : 1, r = cur.ends[1 - a].node; items.push({ el: cur, a, l, r });
      const nb = linked(r) ? peer(cur, r) : null; if (!nb || seen.has(nb)) break; cur = nb; l = r; }
    if (score(items[items.length - 1].r) > score(items[0].l)) items.reverse().forEach(it => { [it.l, it.r] = [it.r, it.l]; it.a = 1 - it.a; });
    rows.push({ at: Math.min(...items.map(it => it.el.at)), items, left: items[0].l, right: items[items.length - 1].r });
  }
  for (const b of blocks) rows.push({ at: b.at, block: b });
  rows.sort((x, y) => x.at - y.at);
  return { st, rows, kindOf, netName, find, info };
}
const resSym = (x, y, w, sel, hi) => { const n = 6, h = w * .13, pts = [[x, y]]; for (let i = 0; i < n; i++) pts.push([x + w * (i + .5) / n, y + (i % 2 ? h : -h)]); pts.push([x + w, y]);
  return ln(pts, sel ? 2 : 1.3, hi ? '#b8402f' : INK); };
// an LED or diode from x to x + d * .8 s (d = -1 points it left); rays and glow only for an LED
const ledSym = (x, y, s, lit, col, sel, d = 1, rays = true) => {
  const tip = x + d * s * .8, tri = [[x, y - s * .5], [x, y + s * .5], [tip, y]];
  let g = `<path d="M${tri.map(p => p.map(f).join(' ')).join('L')}Z" fill="${lit > .05 ? col : '#fbf8ef'}" stroke="${INK}" stroke-width="${sel ? 2 : 1.3}" stroke-linejoin="round"/>` + ln([[tip, y - s * .5], [tip, y + s * .5]], 1.4);
  if (rays) for (const k of [0, 1]){ const ax = x + d * s * (.3 + k * .3), ay = y - s * .6; g += ln([[ax, ay], [ax + s * .35, ay - s * .4]], .9) + ln([[ax + s * .35, ay - s * .4], [ax + s * .18, ay - s * .37]], .9) + ln([[ax + s * .35, ay - s * .4], [ax + s * .32, ay - s * .22]], .9); }
  if (rays && lit > .05) g = `<circle cx="${f(x + d * s * .4)}" cy="${f(y)}" r="${f(s * (.9 + lit * .5))}" fill="${col}" opacity="${f(.25 * lit)}"/>` + g;
  return g; };
// ground bars across a wire ending at (x, y), pointing out to the side d
const gndSym = (x, y, d, s) => [0, 1, 2].map(i => ln([[x + d * s * .3 * i, y - s * (.5 - i * .17)], [x + d * s * .3 * i, y + s * (.5 - i * .17)]], 1.3 - i * .1)).join('');
B.viewDef('schematic', { flat: true, scene: () => {
  const v = sheetBox(), md = B.md, st = B.st, c = B.circuitNow();
  let s = plate(v, T('Schematic · {name}', { name: c ? T(c.title || st.circuit) : T(md.name) }));
  const u = v.width / 100, meas = st.meas || {}, sel = id => st.sel === id;
  const net = netlist();
  if (!net){ return s + txt(v.x + v.width / 2, v.y + v.height / 2, T('No circuit on the breadboard'), 3.2 * u, '#857d6e'); }
  const { rows, kindOf, netName, find, info } = net;
  const live = name => (+st.o.pins[name] || 0) > .5 || (st.ev.rails[name] || 0) > .5;
  const hot = node => live(netName(node)), wcol = node => hot(node) ? '#b8402f' : INK;
  const part = (id, name, svg) => act('bb', svg, `data-id="${esc(id)}" data-label="${esc(T(name) + ' ' + id)}"`);
  // geometry of every row first (local units, origin at the board block's top left): the lanes need to know where each part's pins are
  const bw = 16 * u, stub = 3 * u, pinH = 6 * u;
  const lane = {}, pinList = [];
  const lefts = [];
  for (const r of rows) for (const n of r.block ? r.block.pins.map(x => x.node) : [r.left]) if (kindOf(n) === 'pin' && !(find(n) in lane)){ lane[find(n)] = 0; lefts.push(find(n)); }
  const kinds = k => [...new Set(Object.keys(info).filter(r => kindOf(r) === k))];
  const ordered = [...lefts, ...kinds('power').filter(r => rows.some(w => (w.block ? w.block.pins.map(x => x.node) : [w.left, w.right]).some(n => find(n) === r))), ...kinds('gnd')];
  ordered.forEach((r, i) => { pinList.push({ node: r, y: 10 * u + i * pinH }); });
  const pinY = Object.fromEntries(pinList.map(p => [p.node, p.y]));
  lefts.forEach((r, i) => { lane[r] = bw + 9 * u + i * 2.6 * u; });
  const xp = bw + 9 * u + lefts.length * 2.6 * u + 10 * u;
  let y = 0, maxX = 0, body = '';
  const ends = {};                          // net root -> left terminals [x, y] that wire up to the board
  const term = (node, d, x, yy) => {
    const k = kindOf(node), name = netName(node), col = wcol(node), tx = x + d * stub, anchor = d < 0 ? 'end' : 'start', at = tx + d * 1 * u;
    if (k === 'pin' && d < 0){ (ends[find(node)] = ends[find(node)] || []).push([x, yy]); return ''; }
    const label = (t, c2 = col) => txt(at, yy + .8 * u, t, 2.1 * u, c2, anchor, 800);
    return ln([[x, yy], [tx, yy]], 1.3, col) + (k === 'gnd' ? gndSym(tx, yy, d, 3.4 * u) : k === 'open' ? label(T('not connected'), '#b8402f') : label(name || '·'));
  };
  for (const r of rows){
    if (r.block){
      const { p, d, pins } = r.block, h = pins.length * 5.5 * u + 3 * u, m = meas[p.id] || {}, bwid = 17 * u;
      body += part(p.id, d.name || p.part, `<rect x="${f(xp)}" y="${f(y)}" width="${f(bwid)}" height="${f(h)}" rx="${f(u)}" fill="#fff4d6" stroke="${INK}" stroke-width="${sel(p.id) ? 2 : 1.4}"/>`
        + txt(xp + bwid / 2, y + h - 1.2 * u, p.id, 2.2 * u, INK, 'middle', 800)
        + pins.map((x, i) => txt(xp + 1.2 * u, y + 4.6 * u + i * 5.5 * u, x.leg, 2 * u, INK, 'start', 700)).join(''));
      pins.forEach((x, i) => { body += term(x.node, -1, xp, y + 3.8 * u + i * 5.5 * u); });
      let cap = ''; try { cap = d.tag ? d.tag(p, m) : ''; } catch (e) { cap = ''; }
      body += txt(xp + bwid + 2 * u, y + h / 2 + .8 * u, cap, 2 * u, '#2f6b4f', 'start', 800);
      maxX = Math.max(maxX, xp + bwid + 2 * u + CF_TW(cap, 2 * u));
      y += h + 4 * u;
      continue;
    }
    const lit = r.items.some(it => it.el.shape === 'led'), top = lit ? 11 * u : 5.5 * u, bot = lit ? 9 * u : 4.5 * u, yy = y + top;
    let x = xp;
    body += term(r.left, -1, x, yy);
    r.items.forEach((it, i) => {
      const { el, a } = it, p = el.p, m = meas[p.id] || {}, w = SERIES_W * u, hiW = hot(it.l), c1 = hiW ? '#b8402f' : INK;
      let g = '';
      if (el.shape === 'res') g = resSym(x, yy, w, sel(p.id), hiW) + txt(x + w / 2, yy - 3.4 * u, p.id + ' ' + (p.ohms != null ? B.ohmsText(p.ohms) : T(el.d.name || p.part)), 2.1 * u);
      else if (el.shape === 'led' || el.shape === 'diode'){
        const isLed = el.shape === 'led', s0 = 6 * u, d = a === 0 ? 1 : -1, x0 = x + (w - s0 * .8) / 2 + (d < 0 ? s0 * .8 : 0);
        const lv = isLed && m.state === 'ok' ? Math.min(1, Math.pow(Math.max(0, m.i_mA) / 13.6, .55)) : 0, col = (B.LED_COLORS || {})[p.color] || '#e8392e';
        g = ln([[x, yy], [x + (w - s0 * .8) / 2, yy]], 1.3, c1) + ln([[x + (w + s0 * .8) / 2, yy], [x + w, yy]], 1.3) + ledSym(x0, yy, s0, lv, col, sel(p.id), d, isLed)
          + txt(x + w / 2, yy + 7.5 * u, p.id + (p.color ? ' ' + T(p.color) : ''), 2.1 * u)
          + (isLed ? txt(x + w / 2, yy - 9.5 * u, m.state === 'ok' && m.i_mA > 0 ? T('{n} mA', { n: m.i_mA.toFixed(1) }) : m.state ? T(m.state) : '', 2 * u, m.state === 'burnt' ? '#b8402f' : '#2f6b4f', 'middle', 800) : '');
      } else if (el.shape === 'switch'){
        const closed = +p.pressed > 0 || m.closed, xa = x + 3 * u, xb = x + w - 3 * u;
        g = ln([[x, yy], [xa, yy]], 1.3, c1) + ln([[xb, yy], [x + w, yy]], 1.3) + ln([[xa, yy], closed ? [xb, yy] : [xb - .8 * u, yy - 3.2 * u]], 1.5, INK)
          + `<circle cx="${f(xa)}" cy="${f(yy)}" r="${f(.6 * u)}" fill="${INK}"/><circle cx="${f(xb)}" cy="${f(yy)}" r="${f(.6 * u)}" fill="${INK}"/>`
          + txt(x + w / 2, yy - 5.2 * u, p.id, 2.1 * u);
      } else {
        const bwid = w - 3 * u;
        g = ln([[x, yy], [x + 1.5 * u, yy]], 1.3, c1) + ln([[x + w - 1.5 * u, yy], [x + w, yy]], 1.3)
          + `<rect x="${f(x + 1.5 * u)}" y="${f(yy - 3.4 * u)}" width="${f(bwid)}" height="${f(6.8 * u)}" rx="${f(u)}" fill="#fff4d6" stroke="${INK}" stroke-width="${sel(p.id) ? 2 : 1.4}"/>`
          + txt(x + w / 2, yy + .8 * u, p.id, 2.1 * u, INK, 'middle', 800)
          + txt(x + 2.4 * u, yy - 4.5 * u, el.ends[a].leg, 1.8 * u, '#857d6e', 'middle') + txt(x + w - 2.4 * u, yy - 4.5 * u, el.ends[1 - a].leg, 1.8 * u, '#857d6e', 'middle');
      }
      body += part(p.id, el.d.name || p.part, g);
      x += w;
      if (i < r.items.length - 1){ body += ln([[x, yy], [x + LINK_W * u, yy]], 1.3, wcol(it.r)); x += LINK_W * u; }
    });
    body += term(r.right, 1, x, yy);
    maxX = Math.max(maxX, x + stub + 14 * u);
    y += top + bot + 2 * u;
  }
  // the board block and its wires
  const bh = Math.max(24 * u, 10 * u + pinList.length * pinH);
  let wires = '', blockSvg = act('part', `<rect x="0" y="0" width="${f(bw)}" height="${f(bh)}" rx="${f(u)}" fill="#e8f1ef" stroke="${INK}" stroke-width="1.6"/>` + txt(bw / 2, 4.6 * u, T(md.name), Math.min(2.2 * u, (bw - 2 * u) / CF_TW(T(md.name), 1)), INK, 'middle', 800),
    `data-id="${esc(md.power.mcu ? md.power.mcu.part : '')}" data-label="${esc(md.name)}"`);
  for (const pn of pinList){
    const k = kindOf(pn.node), name = netName(pn.node), isLane = pn.node in lane, col = wcol(pn.node), py = pn.y;
    blockSvg += txt(bw - 1.2 * u, py + .8 * u, name, 2.3 * u, hot(pn.node) ? '#b8402f' : INK, 'end', 800);
    if (k === 'gnd') blockSvg += ln([[bw, py], [bw + stub, py]]) + gndSym(bw + stub, py, 1, 3.4 * u);
    else if (!isLane) blockSvg += ln([[bw, py], [bw + stub, py]], 1.3, col) + ln([[bw + stub, py - 1.6 * u], [bw + stub, py + 1.6 * u]], 1.6, col);
    else {
      const lx = lane[pn.node], ts = ends[pn.node] || [], ys = [py, ...ts.map(t => t[1])], y0 = Math.min(...ys), y1 = Math.max(...ys);
      wires += ln([[bw, py], [lx, py]], 1.3, col) + (y1 > y0 ? ln([[lx, y0], [lx, y1]], 1.3, col) : '') + ts.map(t => ln([[lx, t[1]], [t[0], t[1]]], 1.3, col)).join('');
      for (const yv of new Set(ys)){ const n = ys.filter(q => q === yv).length + (yv > y0 && yv < y1 ? 2 : 1); if (n >= 3) wires += `<circle cx="${f(lx)}" cy="${f(yv)}" r="${f(.7 * u)}" fill="${col}"/>`; }
      blockSvg += txt(bw + 1.5 * u, py - 1.6 * u, hot(pn.node) ? 'HIGH' : 'LOW', 1.8 * u, hot(pn.node) ? '#b8402f' : '#857d6e', 'start', 800);
    }
  }
  const W = Math.max(maxX, xp + 20 * u), H = Math.max(y, bh), k = Math.min(2.2, (v.width - 18 * u) / W, (v.height - 24 * u) / H);
  return s + `<g transform="translate(${f(v.x + 9 * u)} ${f(v.y + 16 * u)}) scale(${f(k)})">${wires}${blockSvg}${body}</g>`;
} });

/* ---------- power tree ---------- */
B.viewDef('power', { flat: true, scene: () => {
  const v = sheetBox(), md = B.md, st = B.st, pw = md.power, u = v.width / 100;
  let s = plate(v, T('Power tree · {name}', { name: T(md.name) }));
  const rails = pw.rails || {}, srcs = pw.sources || {};
  // columns: sources, then rails by depth
  const depth = {}; const dOf = id => { if (depth[id] != null) return depth[id]; depth[id] = 1; const r = rails[id];
    let d = 1; for (const fd of r.from || []) if (fd.rail && rails[fd.rail] && fd.rail !== id) d = Math.max(d, dOf(fd.rail) + 1); return depth[id] = d; };
  Object.keys(rails).forEach(dOf);
  const cols = Math.max(1, ...Object.values(depth)) + 1, cw = (v.width - 16 * u) / cols, pos = {};
  const place = (ids, col) => ids.forEach((id, i) => { pos[id] = [v.x + 8 * u + cw * col + cw * .1, v.y + 16 * u + i * (v.height - 22 * u) / Math.max(1, ids.length) + 2 * u]; });
  place(Object.keys(srcs), 0);
  for (let d = 1; d < cols; d++) place(Object.keys(rails).filter(id => depth[id] === d), d);
  const bw = cw * .58, bh = 9 * u;
  // edges first, then the boxes, then the via-part pills on top
  let pills = '';
  for (const [rid, r] of Object.entries(rails)) for (const fd of r.from || []){
    const a = pos[fd.src || fd.rail], b = pos[rid]; if (!a || !b) continue;
    const live = (st.ev.rails[rid] || 0) > .5 && (fd.src ? st.power === fd.src : (st.ev.rails[fd.rail] || 0) > .5);
    const p0 = [a[0] + bw, a[1] + bh / 2], p1 = [b[0], b[1] + bh / 2], mx = (p0[0] + p1[0]) / 2;
    s += ln([p0, [mx, p0[1]], [mx, p1[1]], p1], live ? 2 : 1.1, live ? '#b8402f' : '#857d6e');
    const via = (fd.via || []).filter(id => !(srcs[fd.src] && srcs[fd.src].part === id));
    // a pill on a straight run between two boxes only has the gap, so it keeps to the part ids
    const horiz = Math.abs(p1[1] - p0[1]) < 1;
    if (via.length){ const lbl = via.join(' + ') + (!horiz && fd.reg != null ? ' · ' + T('{v} V reg.', { v: fd.reg }) : ''), missing = via.filter(id => !B.isSet(id));
      const fs = horiz ? Math.min(1.9 * u, (p1[0] - p0[0] - 2) / (CF_TW(lbl, 1) + 1.2)) : 1.9 * u, pw2 = CF_TW(lbl, fs) + fs * 1.2, my = (p0[1] + p1[1]) / 2;
      pills += act('part', `<rect x="${f(mx - pw2 / 2)}" y="${f(my - fs * .95)}" width="${f(pw2)}" height="${f(fs * 1.9)}" rx="${f(fs * .95)}" fill="${missing.length ? '#f6d1c9' : '#fff4d6'}" stroke="${INK}" stroke-width=".9"/>`
        + txt(mx, my + fs * .36, lbl, fs, INK, 'middle', 800), `data-id="${esc(via[0])}" data-label="${esc(B.md.byId[via[0]] ? B.md.byId[via[0]].name : via[0])}"`); }
  }
  const boxAt = (id, label, sub, live, actId) => { const [x, y] = pos[id];
    return act('part', `<rect x="${f(x)}" y="${f(y)}" width="${f(bw)}" height="${f(bh)}" rx="${f(1.5 * u)}" fill="${live ? accent : '#fbf8ef'}" stroke="${INK}" stroke-width="1.4"/>`
      + txt(x + bw / 2, y + bh * .45, label, Math.min(2.4 * u, bw / Math.max(4, label.length) * 1.3), INK, 'middle', 800) + txt(x + bw / 2, y + bh * .82, sub, Math.min(1.9 * u, bw / Math.max(4, String(sub).length) * 1.3), INK, 'middle', 700), `data-id="${esc(actId || '')}" data-label="${esc(label)}"`); };
  for (const [k, src] of Object.entries(srcs)){ const on = st.power === k, v2 = st.supply[k] != null ? st.supply[k] : src.v;
    s += boxAt(k, T(src.label || k), on ? T('{v} V connected', { v: v2 }) : T('{v} V', { v: src.range ? src.range.join('–') : src.v }), on, src.part); }
  for (const rid of Object.keys(rails)){ const vv = st.ev.rails[rid] || 0; s += boxAt(rid, rid, vv > .05 ? vv.toFixed(2) + ' V' : T('off'), vv > .5, ''); }
  s += pills;
  if (st.ev.why) s += txt(v.x + v.width / 2, v.y + v.height - 7 * u, st.ev.why, 2.2 * u, '#b8402f', 'middle', 800);
  return s;
} });
})();
