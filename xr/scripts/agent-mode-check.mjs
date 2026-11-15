// The companion's Assist / Build mode in the IWER emulator, headless: the mode button floats over the bunny, the
// Tools menu has the switch, pressing the button flips the mode, Assist refuses a tool that changes things (and says
// so in look), Build runs it, and the context carries the scene brief of the open lab.
//
//   npx vite --mode http --port 23265                 # in another terminal
//   node scripts/agent-mode-check.mjs [url] [shot-dir]
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:8081/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOTS = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready && window.iynkware.agent && window.iynkware.lab, null, { timeout: 60000 });
await page.evaluate(() => window.iynkware.ready);
await page.waitForTimeout(1500);

const button = () =>
  page.evaluate(() => {
    const o = window.iynkware.world.scene.getObjectByName('agent:mode');
    if (!o) return null;
    const V = window.iynkware.world.camera.position.constructor;
    return { visible: o.visible, at: o.getWorldPosition(new V()).toArray().map((x) => +x.toFixed(3)) };
  });
const b = await button();
check('the mode button is in the scene, over the bunny', !!b && b.visible && b.at[1] > 0.5, b);

const mode = () => page.evaluate(async () => (await window.iynkware.agent.call('look')).companion);
check('the companion starts in build mode', (await mode()) === 'build');

const flip = () =>
  page.evaluate(() => {
    const m = window.iynkware.app?.shell?.menuItems?.value?.find((x) => x.id === 'agent/mode');
    if (m) m.run();
    return !!m;
  });
const hasMenu = await flip();
if (hasMenu) {
  check('the Tools menu switch flips it to assist', (await mode()) === 'assist');
} else {
  // no app on window: press the button's face through the bridge-free path (the menu row is the same run)
  check('the menu row is reachable', false, 'window.iynkware.app is missing');
}

const r = await page.evaluate(async () => {
  const a = window.iynkware.agent;
  const open = await a.call('open_lab', { lab: 'chemistry' });
  const start = await a.call('start_experiment', { id: 'chemistry/ph' });
  const ctx = a.context();
  return { open: open.ok, start, scene: ctx.scene?.scene, experiments: ctx.scene?.lab?.experiments?.map((e) => e.title) };
});
check('assist opens a lab (moving around is allowed)', r.open, r);
check('assist refuses start_experiment', r.start.ok === false && r.start.mode === 'assist', r.start);
check('the context has the chemistry brief', r.scene === 'lab:chemistry' && r.experiments?.length >= 2, r.experiments);

await flip();
const s = await page.evaluate(async () => (await window.iynkware.agent.call('start_experiment', { id: 'chemistry/ph' })).ok);
check('build runs start_experiment', (await mode()) === 'build' && s);
await page.evaluate(() => window.iynkware.agent.call('leave_lab'));

if (SHOTS) await page.screenshot({ path: `${SHOTS.replace(/\/$/, '')}/agent-mode.png` });
check('no page errors', errors.length === 0, errors);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
