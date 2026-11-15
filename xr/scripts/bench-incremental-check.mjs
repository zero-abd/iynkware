// Incremental bench layout in the IWER emulator, headless: enter MR, move the Uno and then the breadboard with real
// project ops from the page, and check that every other object keeps its identity and world position, that the board
// frame does not move, that the seated LED rides along with the breadboard, that undo puts things back, that the run
// views still drive the LED after the edits, and how many draw calls the bench costs before and after (reported only).
//
//   npx vite --mode http --port 23062                       # in another terminal
//   node scripts/bench-incremental-check.mjs [url] [shot.png]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23062/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

await page.goto(target.href, { waitUntil: 'load' });
// The entry page loads no engine until asked: Open on this screen boots the bench on the flat page.
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(() => window.iynkware.ready);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await page.evaluate(() =>
  window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } }),
);
await sleep(900);

await page.evaluate(() => {
  const { app, world } = window.iynkware;
  const ids = ['brd_main', 'cmp_bb', 'cmp_led1', 'cmp_res1'];
  window.__ids = ids;
  window.__calls = () => world.renderer.info.render.calls;
  window.__snap = () => {
    const out = {};
    for (const id of ids) {
      const o = app.bench.objectOf(id);
      out[id] = o ? { obj: o, at: o.getWorldPosition(o.position.clone()).toArray() } : null;
    }
    // a wire is redrawn when its drawn path moves (the inked renderer makes new meshes; the default tube keeps its mesh)
    return { parts: out, frame: app.bench.root.position.toArray(), wires: ['wir_1', 'wir_2'].map((w) => app.bench.wirePath(w)?.map((p) => p.join(',')).join(' ') ?? null) };
  };
  window.__compare = (a, b) => {
    const rows = {};
    for (const id of ids) {
      const x = a.parts[id];
      const y = b.parts[id];
      rows[id] = { same: !!x && !!y && x.obj === y.obj, moved_mm: x && y ? Math.round(Math.hypot(...x.at.map((v, i) => v - y.at[i])) * 1e4) / 10 : null };
    }
    rows.frameMoved_mm = Math.round(Math.hypot(...a.frame.map((v, i) => v - b.frame[i])) * 1e4) / 10;
    rows.wires = a.wires.map((w, i) => ({ drawn: w !== null && b.wires[i] !== null, samePath: w === b.wires[i] }));
    return rows;
  };
  window.__place = (c, patch) => {
    const view = app.project.doc.views.find((v) => v.kind === 'breadboard');
    const placement = { ...view.placements.find((p) => p.c === c), ...patch };
    return app.project.apply({ k: 'view.place', view: view.id, placement }, { label: 'Move' }).ok;
  };
  window.__s0 = window.__snap();
});
const callsBefore = await page.evaluate(() => window.__calls());
// The board frame is drawn at the bench's work scale (3x by default), so a document millimetre is `scale` world ones.
const scale = await page.evaluate(() => window.iynkware.app.bench.scale.value);

// 1. Move the Uno 25 mm left: nothing else moves or is rebuilt; the wires on its pins are redrawn.
const ok1 = await page.evaluate(() => window.__place('brd_main', { x_mm: -115 }));
await sleep(400);
const r1 = await page.evaluate(() => {
  window.__s1 = window.__snap();
  return window.__compare(window.__s0, window.__s1);
});
check('Uno move applied as one op', ok1);
check(
  `Uno moved ${25 * scale} mm in the world (25 mm at scale ${scale}), every object kept, others still, frame still`,
  ['brd_main', 'cmp_bb', 'cmp_led1', 'cmp_res1'].every((id) => r1[id].same) &&
    Math.abs(r1.brd_main.moved_mm - 25 * scale) < 0.5 &&
    r1.cmp_bb.moved_mm === 0 && r1.cmp_led1.moved_mm === 0 && r1.cmp_res1.moved_mm === 0 && r1.frameMoved_mm === 0,
  r1,
);
check('wires on the Uno pins redrawn (a new path)', r1.wires.every((w) => w.drawn && !w.samePath), r1.wires);

// 2. Move the breadboard 10 mm toward the person: the seated LED and resistor ride along, the Uno stays.
const ok2 = await page.evaluate(() => window.__place('cmp_bb', { y_mm: 10 }));
await sleep(400);
const r2 = await page.evaluate(() => {
  window.__s2 = window.__snap();
  return window.__compare(window.__s1, window.__s2);
});
check(
  'breadboard move: LED and resistor ride along as the same objects, Uno and frame still',
  ok2 && ['brd_main', 'cmp_bb', 'cmp_led1', 'cmp_res1'].every((id) => r2[id].same) &&
    r2.brd_main.moved_mm === 0 && Math.abs(r2.cmp_bb.moved_mm - 10 * scale) < 0.5 && Math.abs(r2.cmp_led1.moved_mm - 10 * scale) < 0.5 &&
    Math.abs(r2.cmp_res1.moved_mm - 10 * scale) < 0.5 && r2.frameMoved_mm === 0,
  r2,
);
check('wires with an end hole on the breadboard redrawn', r2.wires.every((w) => w.drawn && !w.samePath), r2.wires);

// 3. Undo twice: everything back where it started, still the same objects.
const r3 = await page.evaluate(async () => {
  window.iynkware.app.project.undo();
  window.iynkware.app.project.undo();
  await new Promise((r) => setTimeout(r, 300));
  return window.__compare(window.__s0, window.__snap());
});
check('two undos: every object back in place, same instances', ['brd_main', 'cmp_bb', 'cmp_led1', 'cmp_res1'].every((id) => r3[id].same && r3[id].moved_mm === 0), r3);

// 4. The run views still drive the LED on the kept object.
await page.evaluate(() => window.__place('brd_main', { x_mm: -100 }));
const samples = await page.evaluate(async () => {
  const { app } = window.iynkware;
  await app.sim.load(app.project.doc);
  await app.sim.run();
  const out = [];
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 150));
    out.push(app.bench.objectOf('cmp_led1')?.getObjectByName('light')?.material.emissiveIntensity ?? -1);
  }
  await app.sim.stop();
  return out;
});
const lit = samples.filter((s) => s > 0).length;
check('after edits the LED still toggles while running', lit > 0 && lit < samples.length, samples);
await sleep(500);
const callsAfter = await page.evaluate(() => window.__calls());
if (SHOT) await page.screenshot({ path: SHOT });
console.log('draw calls (both eyes)', { before: callsBefore, after: callsAfter });
// The draw-call budget is suspended by the owner (2026-11-14): the count is reported, not checked.
if (callsAfter !== callsBefore) console.log('NOTE draw calls changed by the edits', { before: callsBefore, after: callsAfter });
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
