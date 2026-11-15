// The Projects panel in the IWER emulator, headless: Home's Projects tile opens it, New project makes and opens a blank
// bench, a second New, then a row opens the older project, a hand pinch on a row's bin asks to delete, Delete removes
// it, and Close closes the panel.
//
//   npx vite --mode http --port 23083                          # in another terminal
//   node scripts/shell-projects-check.mjs [url] [shot.png]     # url defaults to http://localhost:23083/
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23083/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const waitFor = (fn, arg, ms = 12000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  const w = window.iynkware.world;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__pos = (name) => w.scene.getObjectByName(name)?.getWorldPosition(w.camera.position.clone()).toArray() ?? null;
  window.__open = (name) => !!w.scene.getObjectByName(`shell-panel:${name}`)?.visible;
  window.__doc = () => window.iynkware.app.project.doc.id;
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await waitFor(() => window.iynkware.app.shell.homeOpen.value, null, 10000);
await sleep(900);

/** Ray and select on a button with `device`, from `back` metres in front of it. */
const press = async (name, device = 'controller-right', back = 0.15) => {
  const p = await page.evaluate((n) => window.__pos(`button:${n}`), name);
  if (!p) return false;
  await page.evaluate(([d, q, b]) => window.__x('set_transform', { device: d, position: { x: q[0], y: q[1], z: q[2] + b }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), [device, p, back]);
  await sleep(450);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(220);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(600);
  return true;
};
const openFromHome = async () => {
  await page.evaluate(() => window.iynkware.app.shell.openHome());
  await sleep(800);
  await press('home/projects');
  return waitFor(() => window.__open('projects') && !window.iynkware.app.shell.homeOpen.value, null, 4000);
};

check('Home Projects tile opens the panel and closes Home', await openFromHome());
if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-empty.png') });

const doc0 = await page.evaluate(() => window.__doc());
await press('projects/new');
const made = await waitFor((id) => window.__doc() !== id && window.iynkware.app.shell && !window.__open('projects'), doc0);
const doc1 = await page.evaluate(() => window.__doc());
check('New project opens a blank bench and closes the panel', made, { doc0, doc1 });
await sleep(1500);

check('Projects opens again', await openFromHome());
await press('projects/new');
await waitFor((id) => window.__doc() !== id, doc1);
const doc2 = await page.evaluate(() => window.__doc());
await sleep(1500);

check('Projects opens a third time', await openFromHome());
// Newest first: row 0 is the project on the bench now, row 1 the one made before it.
const listed = await page.evaluate(() => {
  const s = window.iynkware.world.scene;
  return [0, 1, 2].filter((i) => s.getObjectByName(`button:projects/row-${i}`));
});
check('the list shows the saved projects', listed.length >= 2, listed);
if (SHOT) await page.screenshot({ path: SHOT });
await press('projects/row-1');
const opened = await waitFor((id) => window.__doc() !== id, doc2);
check('a row opens that project', opened, { doc2, now: await page.evaluate(() => window.__doc()) });
await sleep(1500);

// Delete by hand pinch on a row's bin, then Delete on the confirm card.
check('Projects opens for a delete', await openFromHome());
const before = await page.evaluate(() => window.iynkware.world.scene.getObjectByName('button:projects/row-1') ? 1 : 0);
const rowsBefore = await page.evaluate(() => {
  const s = window.iynkware.world.scene;
  return [0, 1, 2, 3, 4].filter((i) => s.getObjectByName(`button:projects/row-${i}`)).length;
});
await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(900);
await press('projects/delete-1', 'hand-right', 0.2);
const asked = await waitFor(() => window.__open('projects/delete'), null, 4000);
check('a hand pinch on the bin asks to delete', asked && before === 1);
await press('projects/delete/confirm', 'hand-right', 0.2);
const gone = await waitFor((n) => {
  const s = window.iynkware.world.scene;
  return [0, 1, 2, 3, 4].filter((i) => s.getObjectByName(`button:projects/row-${i}`)).length === n - 1;
}, rowsBefore, 6000);
check('Delete removes the row', gone, { rowsBefore });
await page.evaluate(() => window.__x('set_input_mode', { mode: 'controller' }));
await sleep(900);

await press('projects/close');
check('Close closes the panel', await waitFor(() => !window.__open('projects'), null, 3000));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
