// Current flow in the IWER emulator, headless: turn Current flow on, run Uno Blink, check the instanced dots exist and
// move while running, hold still when paused and move by a step on Step, and that the node voltage labels exist.
//
//   npx vite --mode http --port 23090                           # in another terminal
//   node scripts/scale-flow-check.mjs [url]                     # url defaults to http://localhost:23090/
//
// Exit 0 when every check passes. Playwright comes with @iwsdk/vite-plugin-dev.
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23090/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]')) return;
  if (m.type() === 'error') console.log('[page]', m.type(), t.slice(0, 300));
});
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
  const w = window.iynkware.world;
  /** What the dots and labels look like now. */
  window.__flow = () => {
    const dots = w.scene.getObjectByName('scale-flow-dots');
    const labels = w.scene.getObjectByName('scale-flow-labels');
    const read = (m, per) => (m ? Array.from(m.instanceMatrix.array.slice(0, m.count * per)) : []);
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    return {
      visible: !!dots && dots.parent?.visible === true,
      dots: dots?.count ?? 0,
      dotSum: +sum(read(dots, 16)).toFixed(5),
      dotFirst: read(dots, 16).slice(12, 15).map((v) => +v.toFixed(5)),
      labels: labels?.count ?? 0,
      labelsVisible: !!labels && labels.visible,
    };
  };
});
await sleep(800);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(1500);
await page.evaluate(() => window.iynkware.app.shell.closeHome?.());

const flow = () => page.evaluate(() => window.__flow());
check('flow is off at the start and draws nothing', !(await flow()).visible);

await page.evaluate(async () => {
  const a = window.iynkware.app;
  a.scale.setFlow(true);
  if (a.sim.state === 'unloaded') await a.sim.load(a.project.doc);
  await a.sim.setSpeed(1);
  await a.sim.run();
});
await page.waitForFunction(() => window.__flow().dots > 0, null, { timeout: 30000 }).catch(() => undefined);
await sleep(500);
const a1 = await flow();
await sleep(400);
const a2 = await flow();
check('dots and labels are shown while running', a1.visible && a1.dots > 0 && a1.labels > 0, a1);
check('the dots move while the run goes', a1.dotSum !== a2.dotSum, [a1.dotSum, a2.dotSum]);

await page.evaluate(() => window.iynkware.app.sim.pause());
await sleep(1200);
const p1 = await flow();
console.log('after pause', await page.evaluate(() => ({ state: window.iynkware.app.sim.state, at: window.iynkware.app.sim.lastFrame?.atNs, view: !!window.iynkware.app.sim.lastFrame?.analog })), p1);
await sleep(800);
const p2 = await flow();
check('the dots hold still when paused', p1.dots > 0 && p1.dotSum === p2.dotSum, [p1.dotSum, p2.dotSum]);

await page.evaluate(() => window.iynkware.app.sim.step(100));
await sleep(1200);
const s1 = await flow();
await sleep(600);
const s2 = await flow();
check('Step moves the dots, then they hold again', s1.dotSum !== p2.dotSum && s1.dotSum === s2.dotSum, [p2.dotSum, s1.dotSum, s2.dotSum]);

await page.evaluate(() => window.iynkware.app.scale.setFlow(false));
await sleep(300);
const off = await flow();
check('turning flow off hides everything', !off.visible && !off.labelsVisible && off.dots === 0, off);

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
