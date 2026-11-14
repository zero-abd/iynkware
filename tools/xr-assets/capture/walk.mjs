// Walks the SVG string a figure's scene returned in capture mode and lists what was drawn, each with the data-act
// groups around it. A recorded primitive is a <g data-cfp="n"> (its insides are skipped); any other <path> is looked
// up in the paths pd() recorded, so its 3D points are known; <text> is looked up by its transform. Screen-space marks
// (circles, rects, ellipses, paths not made by pd) have no 3D and are counted as dropped.
const SKIP = new Set(['clippath', 'defs', 'filter', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'style', 'title', 'desc', 'symbol']);
const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
const TOKEN = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|([^<]+)/g;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescape = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));

function attrs(src) {
  const a = {};
  if (!src) return a;
  for (const m of src.matchAll(ATTR)) a[m[1].toLowerCase()] = unescape(m[2]);
  if (a.style) for (const part of a.style.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) { const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim(); if (!(k in a)) a[k] = v; }
  }
  return a;
}

/** One frame of context: the act groups (outermost first), the product of opacities, and group classes. */
const frame0 = { acts: [], opacity: 1, classes: [] };

export function walk(svg, { paths, texts }) {
  const draws = [];
  const dropped = {};
  const stack = [{ tag: '#root', ctx: frame0, skip: 0 }];
  let text = null;
  const drop = (k) => { dropped[k] = (dropped[k] || 0) + 1; };
  for (const m of svg.matchAll(TOKEN)) {
    if (m[0].startsWith('<!--')) continue;
    const top = stack[stack.length - 1];
    if (m[5] != null) { if (text) text.str += m[5]; continue; }
    const close = m[1] === '/', tag = m[2].toLowerCase(), selfClose = m[4] === '/';
    if (close) {
      if (tag === 'text' && text) { if (!top.skip) finishText(text, draws, texts, drop); text = null; }
      // pop to the matching open tag (the figures write well-formed SVG; this only guards against surprises)
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const a = attrs(m[3]);
    let ctx = top.ctx, skip = top.skip;
    if (!skip && SKIP.has(tag)) skip = 1;
    if (!skip && tag === 'g') {
      if (a['data-cfp'] != null) { draws.push({ k: 'prim', id: +a['data-cfp'], ctx }); skip = 1; }
      else {
        const op = a.opacity != null ? +a.opacity : 1;
        const act = a['data-act'] ? { act: a['data-act'], id: a['data-id'] || '', label: a['data-label'] || '', part: a['data-part'] || '' } : null;
        if (act || op !== 1 || a.class) ctx = { acts: act ? [...ctx.acts, act] : ctx.acts, opacity: ctx.opacity * (isFinite(op) ? op : 1), classes: a.class ? [...ctx.classes, a.class] : ctx.classes };
      }
    } else if (!skip) {
      if (tag === 'path') {
        const rec = paths.get(a.d);
        if (!rec) drop('path');
        else draws.push({ k: 'path', pts: rec.pts, close: rec.close, fill: a.fill, stroke: a.stroke, sw: a['stroke-width'] != null ? +a['stroke-width'] : 1,
          dash: !!a['stroke-dasharray'], opacity: (a.opacity != null ? +a.opacity : 1) * (a['fill-opacity'] != null ? +a['fill-opacity'] : 1), ctx });
      } else if (tag === 'text') {
        text = { a, str: '', ctx };
      } else if (tag !== 'svg' && tag !== 'tspan' && tag !== 'g') drop(tag);
    }
    if (!selfClose) stack.push({ tag, ctx, skip });
  }
  return { draws, dropped };
}

function finishText(t, draws, texts, drop) {
  const rec = texts.get(t.a.transform);
  if (!rec || !rec.o || !rec.U || !rec.V) return drop('text');
  if (!t.str.trim()) return;
  draws.push({ k: 'text', o: rec.o, U: rec.U, V: rec.V, str: unescape(t.str).trim(), size: +(t.a['font-size'] || 3), fill: t.a.fill || '#231e16',
    weight: +(t.a['font-weight'] || 700), anchor: t.a['text-anchor'] || 'start', central: t.a['dominant-baseline'] === 'central', ctx: t.ctx });
}
