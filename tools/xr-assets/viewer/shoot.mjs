#!/usr/bin/env node
/* Screenshots of the viewer, headless: starts viewer/serve.mjs on a free port, opens the viewer per item in Chromium
   (Playwright from the repo root; WebGL through SwiftShader) and writes out/shots/<dir>__<id>.png.

     node viewer/shoot.mjs [items...] [--variants] [--size 1200x900] [--param k=v ...] [--out <dir>]

   items: '<dir>/<id>' ids; none = every item in out/index.json (else samples/index.json, else the built-in fixture).
   --variants also writes <dir>__<id>__x.png (explode 0.6, see-through 1, LEDs lit). --param adds viewer URL
   parameters to every shot (yaw=30, ortho=1, lines=gl ...). Exits 1 if a page reports an error or never draws. */
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer } from './serve.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '..');
const REPO = resolve(TOOL, '..', '..');

function loadPlaywright() {
  const req = createRequire(join(REPO, 'package.json'));
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    try { const m = req(name); if (m.chromium) return m; } catch { /* next */ }
  }
  throw new Error('Playwright not found from ' + REPO + ' (npm i at the repo root; then npx playwright install chromium)');
}

/** Playwright's own Chromium; if that build is not installed, another headless shell Playwright installed
    (CHROMIUM_PATH overrides), so a version bump does not force a download. */
async function launch(chromium) {
  const launchArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: launchArgs });
  try { return await chromium.launch({ args: launchArgs }); } catch (e) {
    const { readdirSync } = await import('node:fs');
    const os = await import('node:os');
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin' ? join(os.homedir(), 'Library', 'Caches', 'ms-playwright') : join(os.homedir(), '.cache', 'ms-playwright'));
    const found = [];
    try {
      for (const d of readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
        for (const sub of readdirSync(join(cache, d))) {
          const exe = join(cache, d, sub, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
          if (existsSync(exe)) found.push(exe);
        }
      }
    } catch { /* no cache */ }
    for (const exe of found) { try { return await chromium.launch({ executablePath: exe, args: launchArgs }); } catch { /* next */ } }
    throw new Error(e.message.split('\n')[0] + '\n(run `npx playwright install chromium` at the repo root, or set CHROMIUM_PATH)');
  }
}

const args = process.argv.slice(2);
const opt = { variants: false, size: [1200, 900], params: [], out: join(TOOL, 'out', 'shots'), items: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--variants') opt.variants = true;
  else if (a === '--size') { const [w, h] = args[++i].split('x').map(Number); opt.size = [w, h]; }
  else if (a === '--param') opt.params.push(args[++i]);
  else if (a === '--out') opt.out = resolve(args[++i]);
  else if (a.startsWith('--')) { console.error('unknown option ' + a); process.exit(2); }
  else opt.items.push(a.replace(/\.js$/, ''));
}
if (!opt.items.length) {
  for (const f of ['out/index.json', 'samples/index.json']) {
    const p = join(TOOL, f);
    if (existsSync(p)) { opt.items = JSON.parse(readFileSync(p, 'utf8')).items.map((x) => x.id); break; }
  }
  if (!opt.items.length) opt.items = ['fixtures/ink-board'];
}
mkdirSync(opt.out, { recursive: true });

const { chromium } = loadPlaywright();
const server = await startServer({ port: 0, quiet: true });
const port = server.address().port;
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: opt.size[0], height: opt.size[1] }, deviceScaleFactor: 1 });
const logs = [];
// the viewer probes out/index.json then samples/index.json: a 404 there is expected, any other failed load is not
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400 && !/\/index\.json$/.test(new URL(r.url()).pathname)) logs.push(`error: ${r.status()} ${r.url()}`); });

let bad = 0;
const shots = [];
for (const id of opt.items) {
  const variants = [['', {}]];
  if (opt.variants) variants.push(['__x', { explode: 0.6, xr: 1, leds: 1 }]);
  for (const [suffix, extra] of variants) {
    const q = new URLSearchParams({ item: id, shot: '1', ...extra });
    for (const p of opt.params) { const [k, v = '1'] = p.split('='); q.set(k, v); }
    const url = `http://127.0.0.1:${port}/viewer/?${q.toString().replace(/%2F/g, '/')}`;
    logs.length = 0;
    const file = join(opt.out, id.replace(/\//g, '__') + suffix + '.png');
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.dataset.ready === '1' || !!document.documentElement.dataset.errors, null, { timeout: 120000 });
      const info = await page.evaluate(() => {
        const v = window.__viewer, i = v.renderer.info.render;
        return { errors: document.documentElement.dataset.errors || '', calls: i.calls, triangles: i.triangles, item: v.asset ? v.asset.drawCalls() : 0 };
      });
      await page.screenshot({ path: file });
      const errs = [info.errors, ...logs.filter((l) => /error/i.test(l))].filter(Boolean);
      if (errs.length) bad++;
      shots.push(file);
      console.log(`${errs.length ? 'FAIL' : 'ok  '} ${file}  (${info.calls} draw calls, ${info.triangles} triangles)${errs.length ? '\n      ' + errs.join('\n      ') : ''}`);
    } catch (e) {
      bad++;
      console.log(`FAIL ${id}${suffix}: ${e.message.split('\n')[0]}${logs.length ? '\n      ' + logs.join('\n      ') : ''}`);
    }
  }
}
await browser.close();
server.close();
process.exit(bad ? 1 : 0);
