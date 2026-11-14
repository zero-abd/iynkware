// Builds a figure page with cfbuild and runs it in jsdom with the core's capture mode on (core patch P8,
// figures/vendor/colorfigures/PATCHES.md). Nothing is drawn: the converter calls the figure's own scene function and
// reads what the 3D primitives recorded.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

export const ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const TOOL = resolve(import.meta.dirname, '..');
const CACHE = join(TOOL, '.cache', 'pages');

/** Builds figures/<item>.js into a cached page; returns { html, sha256 }. */
export function buildPage(item) {
  mkdirSync(CACHE, { recursive: true });
  const out = join(CACHE, item.replace('/', '__') + '.html');
  execFileSync('python3', ['-I', join(ROOT, 'figures/tools/cfbuild.py'), item, '--out', out], { cwd: ROOT, stdio: 'pipe' });
  const html = readFileSync(out, 'utf8');
  return { html, sha256: createHash('sha256').update(html).digest('hex') };
}

/** Runs a built page with capture on. Resolves once mountFigure has run. */
export async function loadPage(html, item, query = "") {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/getContext|not implemented|Could not parse CSS/i.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    url: `http://localhost/figures/${item}.html?embed=0${query ? "&" + query : ""}`,
    beforeParse(w) {
      w.CF_CAPTURE = {};
      // the figure writes each frame's SVG into #art; with every face drawn that string is several MB, and jsdom
      // parsing it is the slow part. Nothing here reads #art back, so the write is kept as a string.
      const desc = Object.getOwnPropertyDescriptor(w.Element.prototype, 'innerHTML');
      Object.defineProperty(w.Element.prototype, 'innerHTML', {
        configurable: true,
        get() { return this.id === 'art' && this._cfArt != null ? this._cfArt : desc.get.call(this); },
        set(v) { if (this.id === 'art') { this._cfArt = String(v); return; } desc.set.call(this, v); },
      });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.performance.now = () => 0;
      w.requestAnimationFrame = () => 0;
      w.cancelAnimationFrame = () => {};
    },
  });
  const win = dom.window;
  const ready = () => { try { return !!win.eval('typeof CF_CFG !== "undefined" && !!CF_CFG && !!CF_UI'); } catch { return false; } };
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 10));
  if (!ready()) throw new Error(`${item}: the figure did not mount (${errors.slice(0, 3).join('; ') || 'no error'})`);
  const cap = win.CF_CAPTURE;
  const page = {
    item, win, errors, cap,
    eval: (src) => win.eval(src),
    get st() { return win.eval('CF_UI.st'); },
    notes: () => (win.document.documentElement.dataset.errors || '').split(';').map((s) => s.trim()).filter(Boolean),
    /** Calls the figure's scene for its current state; returns { svg, prims, paths, texts, shades }. */
    scene() {
      cap.reset();
      const svg = win.eval('CF_CFG.scene(CF_UI.st, PALS[CF_UI.st.pal])');
      return { svg: String(svg), prims: cap.prims, paths: cap.paths, texts: cap.texts, shades: cap.shades };
    },
    close: () => win.close(),
  };
  return page;
}
