// The paper room switch in the IWER emulator, headless (issue #92): enter the session, switch to the paper room, the look
// kit's studio dome (`look:studio`) fades in inside the same session object, switch back and it fades out; with hand
// input, any hand model IWSDK has drawn is depth-only in passthrough and paper plus ink hull in the paper room.
//
//   npx vite --mode http --port 23092     # in another terminal
//   node scripts/scale-space-check.mjs [url]
//
// Exit 0 when every check passes. Playwright comes with @iwsdk/vite-plugin-dev.
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23092/');
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
  const w = window.iynkware.world;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__studio = () => {
    const o = w.scene.getObjectByName('look:studio');
    if (!o) return null;
    let max = 0;
    o.traverse((c) => {
      const ms = c.material ? [].concat(c.material) : [];
      for (const m of ms) if (m.transparent) max = Math.max(max, m.opacity);
    });
    return { visible: o.visible, opacity: +max.toFixed(3) };
  };
  window.__hands = () => {
    const out = [];
    for (const side of ['left', 'right']) {
      const v = w.input.xr.visualAdapters.hand[side].visual;
      if (!v) continue;
      v.model.traverse((c) => {
        if (!c.isMesh) return;
        const m = c.material;
        out.push({ side, visible: c.visible, colorWrite: m.colorWrite, depthWrite: m.depthWrite, side3: m.side, color: m.color ? m.color.getHexString() : null, order: c.renderOrder });
      });
    }
    return out;
  };
});
await sleep(800);
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(1500);
await page.evaluate(() => {
  window.__session = window.iynkware.world.session;
});
const state = () => page.evaluate(() => {
  const a = window.iynkware.app;
  return { mode: a.mode.value, room: a.scale.room.value, switchable: a.scale.roomSwitchable.value, sameSession: window.iynkware.world.session === window.__session && !!window.__session };
});
const s0 = await state();
check('starts in passthrough with the room switchable', s0.room === 'passthrough' && s0.switchable && s0.sameSession, s0);
const before = await page.evaluate(() => window.__studio());
check('studio dome is hidden', !before || !before.visible || before.opacity < 0.01, before);

await page.evaluate(() => window.iynkware.app.scale.setRoom('paper'));
await sleep(700);
const s1 = await state();
const on = await page.evaluate(() => window.__studio());
check('paper room: studio dome faded in, same session', s1.room === 'paper' && s1.sameSession && !!on && on.visible && on.opacity > 0.95, { s1, on });

await page.evaluate(() => window.iynkware.app.scale.setRoom('passthrough'));
await sleep(700);
const s2 = await state();
const off = await page.evaluate(() => window.__studio());
check('passthrough: studio dome faded out, same session', s2.room === 'passthrough' && s2.sameSession && (!off || !off.visible || off.opacity < 0.01), { s2, off });

await page.evaluate(() => window.__x('set_input_mode', { mode: 'hand' }));
await sleep(1500);
// IWSDK loads the hand model a moment after the input mode changes; give the next frame time to skin it.
await page.waitForFunction(() => window.__hands().length > 0, null, { timeout: 8000 }).catch(() => undefined);
await sleep(500);
const hands = await page.evaluate(() => window.__hands());
if (hands.length === 0) {
  console.log('SKIP hand materials: IWSDK drew no hand model (it loads the model from a CDN, which this run did not fetch)');
} else {
  const fill = hands.filter((h) => h.side3 !== 1);
  check('passthrough: hand fill is depth only', fill.length > 0 && fill.every((h) => h.colorWrite === false && h.depthWrite === true), fill);
  await page.evaluate(() => window.iynkware.app.scale.setRoom('paper'));
  await sleep(300);
  const p = await page.evaluate(() => window.__hands());
  check('paper room: hand is paper and ink', p.some((h) => h.color === 'f2efe7') && p.some((h) => h.color === '231e16'), p);
}

await browser.close();
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
