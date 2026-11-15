// The lab pillar in the IWER emulator, headless: open the bench, enter the session, open the Chemistry lab from the
// menu, see the Bunsen burner drawn, turn its gas on by a controller ray on the tap and leave it unlit, wait for the
// tutor's `gas-unlit` warning, carry the beaker with a ray grab, then run the flame test through to the result sheet
// (the gas tap and Light by controller, the rest through the lab store, as the panel and the controls would).
//
//   npx vite --mode http --port 23183                 # in another terminal
//   node scripts/lab-check.mjs [url] [shot-dir]       # url defaults to http://localhost:8081/
//
// Needs a Playwright Chromium (`npx playwright install chromium`). Exit 0 when every check passes.
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:8081/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOTS = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]')) return;
  if (m.type() === 'error' || (m.type() === 'warning' && t.includes('[lab]'))) {
    errors.push(t.slice(0, 300));
    console.log('[page]', m.type(), t.slice(0, 300));
  }
});
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('[pageerror]', e.message);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS.replace(/\/$/, '')}/${name}.png` });
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready && window.iynkware.lab, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__events = [];
  window.iynkware.lab.tutor.subscribe((e) => window.__events.push({ kind: e.kind, mistakeId: e.mistakeId, itemKind: e.itemKind, stepId: e.stepId, en: e.text.en, de: e.text.de }));
  window.__pos = (name) => window.iynkware.world.scene.getObjectByName(name)?.getWorldPosition(window.iynkware.world.camera.position.clone()).toArray() ?? null;
});
check('lab context on window.iynkware.lab', await page.evaluate(() => typeof window.iynkware.lab.feed.snapshot === 'function'));

await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(600);
check('immersive session with controllers', await page.evaluate(() => window.iynkware.app.input.sources.value.right === 'controller'));

// Home tile and menu rows are offered.
const shell = await page.evaluate(() => ({
  tile: window.iynkware.app.shell.entries.value.some((e) => e.id === 'lab/labs'),
  rows: window.iynkware.app.shell.menuItems.value.filter((m) => m.id.startsWith('lab/')).map((m) => m.id),
}));
check('Home tile and four lab menu rows', shell.tile && ['lab/chemistry', 'lab/physics', 'lab/electrical', 'lab/signals', 'lab/leave'].every((id) => shell.rows.includes(id)), shell);

// Open the Chemistry lab from the menu row.
await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'lab/chemistry').run());
await page.waitForFunction(() => {
  const lab = window.iynkware.lab;
  const b = lab.store.byKind('bunsen-burner');
  return b && window.iynkware.world.scene.getObjectByName(`lab-item:${b.id}`)?.getObjectByName('lab-visual:bunsen-burner');
}, null, { timeout: 10000 });
const opened = await page.evaluate(() => ({
  lab: window.iynkware.lab.store.lab,
  kinds: window.iynkware.lab.store.items().map((i) => i.kind),
  benchHidden: window.iynkware.app.bench.root.visible === false,
}));
check('Chemistry lab laid out, burner drawn, circuit bench hidden', opened.lab === 'chemistry' && opened.kinds.includes('bunsen-burner') && opened.benchHidden, opened);

// A seated head looking down at the bench, for the pictures.
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0.05 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } }));
await sleep(800);
await shot('lab-1-chemistry');

// Aims the right controller at a world point from above and in front (where a seated person's hand is, clear of the
// rail's poke targets, which would otherwise win the press: IWSDK ranks touch over ray), pitched down at it.
const UP = 0.3;
const OUT = 0.4;
const PITCH = -Math.atan2(UP, OUT);
const AIM = { x: Math.sin(PITCH / 2), y: 0, z: 0, w: Math.cos(PITCH / 2) };
const aim = (q, dx = 0) => page.evaluate(([q, a, dx, up, out]) => window.__x('set_transform', { device: 'controller-right', position: { x: q[0] + dx, y: q[1] + up, z: q[2] + out }, orientation: a }), [q, AIM, dx, UP, OUT]);
// Presses a lab control (`lab-control:<id>:<control>`) with the right controller's ray.
const press = async (name) => {
  const p = await page.evaluate((n) => window.__pos(n), name);
  if (!p) return false;
  await aim(p);
  await sleep(350);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
  await sleep(180);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
  await sleep(250);
  return true;
};
const burnerId = await page.evaluate(() => window.iynkware.lab.store.byKind('bunsen-burner').id);

// Gas on by the controller, not lit: the tutor warns (gas-unlit) after 2 s.
await press(`lab-control:${burnerId}:tap`);
const gasOn = await page.evaluate((id) => window.iynkware.lab.store.get(id).state.p.gasOn, burnerId);
check('controller ray on the gas tap turns the gas on', gasOn === true, { gasOn });
await page.waitForFunction(() => window.__events.some((e) => e.mistakeId === 'gas-unlit'), null, { timeout: 8000 }).catch(() => undefined);
const warned = await page.evaluate(() => window.__events.filter((e) => e.mistakeId === 'gas-unlit'));
check("tutor says 'gas-unlit' (warn or hazard) on the burner", warned.length > 0 && ['warn', 'hazard'].includes(warned[0].kind) && warned[0].itemKind === 'bunsen-burner', warned);
await sleep(400);
await shot('lab-2-gas-unlit');
const snap = await page.evaluate(() => window.iynkware.lab.feed.snapshot('en'));
check('feed snapshot names the mistake', snap.schema === 'iynkware.lab-snapshot/1' && snap.mistakes.some((m) => m.mistakeId === 'gas-unlit'), { mistakes: snap.mistakes });
await page.evaluate((id) => window.iynkware.lab.store.apply(id, { type: 'gas' }), burnerId);

// Carry the beaker with a ray grab: trigger on its body, move the controller 12 cm right, release.
const beaker = await page.evaluate(() => {
  const b = window.iynkware.lab.store.byKind('beaker-250');
  return { id: b.id, x: b.pose.x, z: b.pose.z };
});
const grabAt = await page.evaluate((id) => window.__pos(`lab-grab:${id}`), beaker.id);
await aim(grabAt);
await sleep(350);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
await sleep(200);
for (let i = 1; i <= 6; i++) {
  await aim(grabAt, -0.02 * i);
  await sleep(80);
}
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
await sleep(700);
const moved = await page.evaluate((id) => {
  const it = window.iynkware.lab.store.get(id);
  const g = window.iynkware.world.scene.getObjectByName(`lab-item:${id}`);
  return { x: Math.round(it.pose.x), z: Math.round(it.pose.z), yaw: Math.round(it.pose.yaw), drawnY: +g.position.y.toFixed(4) };
}, beaker.id);
check('ray grab carries the beaker and it settles upright on the bench', Math.abs(moved.x - beaker.x) > 40 && moved.drawnY < 0.002, { from: beaker, to: moved });

// The flame test, practice, seeded.
await page.evaluate(() => {
  window.__events.length = 0;
  window.iynkware.lab.start('chemistry/flame-test', 'practice', 7);
});
await sleep(800);
const burner2 = await page.evaluate(() => window.iynkware.lab.store.byKind('bunsen-burner').id);
await press(`lab-control:${burner2}:tap`);
await press(`lab-control:${burner2}:light`);
const lit = await page.evaluate((id) => window.iynkware.lab.store.get(id).state.p.lit, burner2);
check('Light by controller lights the burner (collar closed)', lit === true, { lit });
const step = () => page.evaluate(() => window.iynkware.lab.runner.state.value?.step?.id ?? 'done');
const apply = (kind, type, value) =>
  page.evaluate(([k, t, v]) => window.iynkware.lab.store.apply(window.iynkware.lab.store.byKind(k).id, v === undefined ? { type: t } : { type: t, value: v }), [kind, type, value]);
check('runner moved past lighting', (await step()) === 'blue', await step());
await apply('bunsen-burner', 'collar', 'half');
await apply('flame-test-kit', 'dip-acid');
await apply('flame-test-kit', 'to-flame');
await page.waitForFunction(() => window.iynkware.lab.store.byKind('flame-test-kit').state.s.clean === true, null, { timeout: 8000 }).catch(() => undefined);
await apply('flame-test-kit', 'dip-salt', 'unknown');
await apply('flame-test-kit', 'to-flame');
await page.waitForFunction(() => window.iynkware.lab.store.byKind('flame-test-kit').state.s.seenUnknown === true, null, { timeout: 8000 }).catch(() => undefined);
await sleep(600);
await shot('lab-3-flame-colour');
const seen = await page.evaluate(() => {
  const k = window.iynkware.lab.store.byKind('flame-test-kit');
  return { unknown: k.state.s.unknown, colour: window.iynkware.lab.store.report(k.id).flameColour, step: window.iynkware.lab.runner.state.value.step?.id };
});
check('the unknown salt colours the flame and the runner asks which metal', seen.step === 'identify' && typeof seen.colour === 'string' && seen.colour !== 'none', seen);
await page.evaluate((s) => window.iynkware.lab.store.answer('salt', s), seen.unknown);
await apply('flame-test-kit', 'to-rack');
await apply('bunsen-burner', 'gas');
await sleep(600);
const result = await page.evaluate(() => {
  const run = window.iynkware.lab.runner.state.value;
  return run && { done: run.done, score: run.result?.score, checks: run.result?.checks.map((c) => [c.id, c.pass]) };
});
check('flame test done with a result sheet', result?.done === true && typeof result.score === 'number', result);
const instructs = await page.evaluate(() => window.__events.filter((e) => e.kind === 'instruct').map((e) => e.stepId));
check('tutor instructed every step', ['light', 'blue', 'clean', 'dip', 'flame', 'identify', 'shutdown'].every((s) => instructs.includes(s)), instructs);
// The panel on the right: look at it for the result sheet.
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0.1, y: 1.2, z: 0.05 }, orientation: { x: -0.17, y: -0.26, z: -0.046, w: 0.95 } }));
await sleep(800);
await shot('lab-4-results');

// Leave: the circuit bench comes back as it was.
const docBefore = await page.evaluate(() => window.iynkware.app.project.revision);
await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'lab/leave').run());
await sleep(500);
const left = await page.evaluate(() => ({
  lab: window.iynkware.lab.store.lab,
  items: window.iynkware.lab.store.items().length,
  bench: window.iynkware.app.bench.root.visible,
  revision: window.iynkware.app.project.revision,
}));
check('leaving restores the circuit bench and never touched the project', left.lab === null && left.items === 0 && left.bench === true && left.revision === docBefore, left);
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0.05 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } }));
await sleep(600);
await shot('lab-5-bench-back');
// Pictures of the other three labs, each working (no checks: the unit tests run their experiments).
for (const [lab, setup] of [
  ['signals', [['function-generator', 'power'], ['oscilloscope', 'probe'], ['oscilloscope', 'power'], ['oscilloscope', 'timeDiv', -1], ['oscilloscope', 'timeDiv', -1], ['oscilloscope', 'timeDiv', -1], ['oscilloscope', 'voltsDiv', -1], ['oscilloscope', 'voltsDiv', -1], ['oscilloscope', 'measure']]],
  ['electrical', [['bench-power-supply', 'power'], ['soldering-station', 'power'], ['soldering-station', 'iron']]],
  ['physics', [['pendulum-stand', 'swing']]],
]) {
  await page.evaluate((l) => window.iynkware.app.shell.menuItems.value.find((m) => m.id === `lab/${l}`).run(), lab);
  await sleep(1200);
  for (const [kind, type, value] of setup) await apply(kind, type, value);
  await sleep(1500);
  await shot(`lab-6-${lab}`);
}
await page.evaluate(() => window.iynkware.lab.leave());
check('no page errors', errors.length === 0, errors.slice(0, 5));
const perf = await page.evaluate(() => ({ calls: window.iynkware.world.renderer.info.render.calls, tris: window.iynkware.world.renderer.info.render.triangles }));
console.log('render', perf);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
