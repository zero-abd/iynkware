// The fault lab in the IWER emulator, headless: Blink on the bench, Enter, Menu row Fault lab opens the panel, a
// controller ray and trigger picks the dead-LED card and Apply, Run: the LED stays dark; a hand pinch on Take back: it
// blinks again.
//
//   npm run dev:http                                     # in another terminal
//   node scripts/run-faults-check.mjs [url]              # url defaults to http://localhost:8081/
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:8081/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__led = () => window.iynkware.app.bench.objectOf('cmp_led1')?.getObjectByName('light')?.material.emissiveIntensity ?? -1;
  window.__at = (name) => window.iynkware.world.scene.getObjectByName(name).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray();
  window.__ev = [];
  window.iynkware.app.input.onAny((e) => { if (!e.type.endsWith('move')) window.__ev.push(`${e.type}:${e.target}:${e.pointer.source}`); });
  window.__lab = () => window.iynkware.world.scene.getObjectByName('shell-panel:run/fault-lab')?.userData.faults ?? null;
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(800);

/** Points `device` at the object named `name` from `back` metres in front and pulls the trigger (or pinches). */
const press = async (device, name, back) => {
  const p = await page.evaluate((n) => window.__at(n), name);
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(450);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
};
const leds = async (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(await page.evaluate(() => window.__led()));
    await sleep(200);
  }
  return out;
};

// Menu row: the lab opens, facing the person, with its deck.
const row = await page.evaluate(() => {
  const item = window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'run/fault-lab');
  item?.run();
  return !!item;
});
await page.waitForFunction(() => window.__lab()?.deck?.length > 0, null, { timeout: 10000 }).catch(() => undefined);
await sleep(1200); // the panel eases in; press once it has settled
const lab = await page.evaluate(() => window.__lab());
check('menu row opens the fault lab with a deck', row && lab?.deck?.some((c) => c.kind === 'missing-part' && c.part === 'cmp_led1'), lab?.deck);

// Controller ray on the dead-LED card, then Apply.
const i = lab.deck.findIndex((c) => c.kind === 'missing-part' && c.part === 'cmp_led1');
await press('controller-right', `button:faults/card-${i}`, 0.3);
await page.waitForFunction((id) => window.__lab()?.selected === id, lab.deck[i].id, { timeout: 5000 }).catch(() => undefined);
check('controller trigger selects the card', (await page.evaluate(() => window.__lab()?.selected)) === lab.deck[i].id);
await press('controller-right', 'button:faults/apply', 0.3);
await page.waitForFunction(() => window.__lab()?.active?.length === 1, null, { timeout: 5000 }).catch(() => undefined);
check('Apply puts the fault in the project', (await page.evaluate(() => window.iynkware.app.project.doc.simulation.faults.map((f) => f.id))).includes(lab.deck[i].id));

// Run: the dead LED stays dark.
await press('controller-right', 'run:run', 0.3);
await page.waitForFunction(() => window.iynkware.app.sim.state === 'running', null, { timeout: 10000 }).catch(() => undefined);
await sleep(400);
const dark = await leds(8);
check('the run keeps the dead LED dark', dark.every((v) => v === 0), dark);

// A hand pinch on Take back: the run reloads and the LED blinks again.
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(700);
await press('hand-right', 'button:faults/back-0', 0.35);
await page.waitForFunction(() => window.__lab()?.active?.length === 0, null, { timeout: 5000 }).catch(() => undefined);
await page.waitForFunction(() => window.iynkware.app.sim.state === 'running', null, { timeout: 10000 }).catch(() => undefined);
await sleep(400);
const blink = await leds(12);
check('hand pinch on Take back: the LED blinks again', blink.some((v) => v > 0) && blink.some((v) => v === 0), blink);

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
