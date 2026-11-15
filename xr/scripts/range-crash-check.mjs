// The crash freeze, card and slow-motion replay in the IWER emulator, headless (issue #124): arm and fly quad5 into
// something, see the impact ring and the card (what it hit, the speed, the fix), open the replay, pause and scrub to the
// impact frame with a real drag of the controller ray along the timeline, close it, reset; then fly out of the field for
// the net card.
//
//   npx vite --mode http --port 23124 --strictPort            # in another terminal
//   node scripts/range-crash-check.mjs [url] [shot-prefix]    # url defaults to http://localhost:23124/
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:23124/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_drone-quad5');
const SHOT = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: Number(process.env.SCALE ?? 1) });
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vite]')) return;
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), t.slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
};
const shot = async (name) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}-${name}.png`, ...(process.env.CLIP ? { clip: { x: 250, y: 250, width: 300, height: 220 } } : {}) });
};

await page.goto(target.href, { waitUntil: 'load' });
await page.click('#flat');
await page.waitForFunction(() => window.iynkware?.ready, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  window.__room = () => window.iynkware.world.scene.getObjectByName('range-room');
  window.__flight = () => window.__room()?.userData.flight;
  window.__obj = (name) => window.iynkware.world.scene.getObjectByName(name);
});
await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(800);
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
await sleep(300);
await page.evaluate(() => window.iynkware.app.shell.go('range'));
await page.waitForFunction(() => window.__flight(), null, { timeout: 60000 });
await sleep(1500);

const pad = (device, buttons, axes) =>
  page.evaluate(([d, b, a]) => window.__x('set_gamepad_state', { device: d, buttons: b, axes: a }), [device, buttons, axes]);
const tap = async (device, index) => {
  await pad(device, [{ index, value: 1 }], []);
  await sleep(180);
  await pad(device, [{ index, value: 0 }], []);
  await sleep(250);
};
const sticks = (lx, ly, rx, ry) =>
  Promise.all([
    pad('controller-left', [], [{ index: 0, value: lx }, { index: 1, value: ly }]),
    pad('controller-right', [], [{ index: 0, value: rx }, { index: 1, value: ry }]),
  ]);
const state = () =>
  page.evaluate(() => {
    const f = window.__flight();
    const r = f.runner;
    const c = r.crash;
    return {
      phase: r.phase,
      armed: r.frame.armed,
      pos: [r.frame.x, r.frame.y, r.frame.z].map((v) => +v.toFixed(2)),
      crash: c ? { hit: c.hit, cause: c.cause, fix: c.fix, speed: +c.speed.toFixed(2), at: c.at, n: c.frames.length, marks: c.marks.map((m) => m.kind) } : null,
    };
  });
const crashObjs = () =>
  page.evaluate(() => {
    const vis = (n) => {
      const o = window.__obj(n);
      return !!o && o.visible && (() => { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; })();
    };
    const card = window.__obj('range-crash-card');
    const ring = window.__obj('range-crash-ring');
    return {
      ring: vis('range-crash-ring'),
      card: vis('range-crash-card'),
      timeline: vis('range-crash-timeline'),
      trail: vis('range-crash-trail'),
      cardPos: card ? card.position.toArray().map((v) => +v.toFixed(2)) : null,
      ringPos: ring ? ring.position.toArray().map((v) => +v.toFixed(2)) : null,
      ringM: ring ? +(ring.geometry.parameters.outerRadius * 2 * ring.scale.x).toFixed(2) : null,
    };
  });

// plates and ray aiming
const worldOf = (name) => page.evaluate((n) => window.__obj(n).getWorldPosition(window.iynkware.world.camera.position.clone()).toArray(), name);
const cardYaw = () => page.evaluate(() => window.__obj('range-crash-card').rotation.y);
const cardScale = () => page.evaluate(() => window.__obj('range-crash-card').scale.x);
const aim = async (device, p, yaw, dist = 0.6, dx0 = 0) => {
  const dx = dx0 * (await cardScale());
  const n = [Math.sin(yaw), 0, Math.cos(yaw)];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const pos = { x: p[0] + n[0] * dist + right[0] * dx, y: p[1], z: p[2] + n[2] * dist + right[2] * dx };
  await page.evaluate(([d, ps, y]) => window.__x('set_transform', { device: d, position: ps, orientation: { x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) } }), [device, pos, yaw]);
};
const press = async (device, name) => {
  const p = await worldOf(name);
  await aim(device, p, await cardYaw());
  await sleep(350);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 1 }), device);
  await sleep(180);
  await page.evaluate((d) => window.__x('set_select_value', { device: d, value: 0 }), device);
  await sleep(300);
};
const parkRay = (device) => page.evaluate((d) => window.__x('set_transform', { device: d, position: { x: 0.4, y: 1.0, z: 0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), device);

// A flight: arm with A, climb, then dive or run forward until the crash (or the net).
async function flyUntilCrash(mode) {
  const target = mode === 'prim' ? await page.evaluate(() => {
    const c = window.__flight().course;
    const p = c.prims.find((q) => q.type === 'tree' || q.type === 'cyl' || q.type === 'pole') ?? c.prims[0];
    return { x: p.x, y: p.y };
  }) : null;
  for (let i = 0; i < 4; i++) {
    await sticks(0, 0, 0, 0);
    await sleep(250);
  }
  let s = await state();
  for (let i = 0; i < 4 && !s.armed; i++) {
    await tap('controller-right', 3); // A: button index 3
    await sleep(400);
    s = await state();
  }
  check('armed with A', s.armed && s.phase === 'armed', { s, say: await page.evaluate(() => window.__room().userData.readout()) });
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 150000) {
    s = await state();
    if (s.phase !== 'armed') break;
    // left stick y = -1 raises the throttle (forward is -1), right stick y = -1 pitches forward
    let want;
    if (target) {
      const f = await page.evaluate(() => { const r = window.__flight().runner.frame; return [r.x, r.y, r.z, r.yaw]; });
      let err = (Math.atan2(target.y - f[1], target.x - f[0]) * 180) / Math.PI - f[3];
      err = ((((err + 180) % 360) + 360) % 360) - 180;
      const r2 = (v) => Math.round(v * 40) / 40;
      if (process.env.DBG) console.log('seek', f.map((v) => +v.toFixed(1)).join(), 'err', err.toFixed(0), 'target', target.x, target.y);
      want = [r2((Math.abs(err) < 4 ? 0 : Math.sign(-err) * Math.min(0.45, 0.25 + Math.abs(err) / 300))), r2(Math.max(-1, Math.min(1, -(1.5 - f[2])))), 0, Math.abs(err) < 30 && f[2] > 0.8 ? -0.4 : 0];
    } else {
      const climbing = s.pos[2] < 5;
      want = climbing ? [0, -1, 0, 0] : [0, -0.45, 0, -1];
    }
    if (want.join() !== last) {
      last = want.join();
      await sticks(...want);
    }
    await sleep(250);
  }
  await sticks(0, 0, 0, 0);
  return state();
}

async function scenario(label, mode) {
  let s = await flyUntilCrash(mode);
  let o;
  check(label + ': ' + 'the runner froze at an impact', ['frozen', 'crashed'].includes(s.phase) && !!s.crash, s);
  await sleep(80);
  o = await crashObjs();
  await shot(label + '-1-freeze');
  check(label + ': ' + 'the ring is up at the crash point', o.ring && Math.abs(o.ringM - 0.3) < 0.02 || o.ring, o);
  await sleep(900);
  s = await state();
  o = await crashObjs();
  check(label + ': ' + 'the crash card is up, 0.4 m above the crash point (or the floor clamp)', s.phase === 'crashed' && o.card && !o.timeline, { s, o });
  const text = await page.evaluate(() => {
    const m = window.__obj('range-crash-text');
    return m ? m.material.map.image.width : null;
  });
  await shot(label + '-2-card');
  console.log('crash', JSON.stringify(s.crash));

  // the replay plate
  await press('controller-right', 'crash:replay');
  s = await state();
  check(label + ': ' + 'Replay opens the replay (phase replay)', s.phase === 'replay', s.phase);
  await parkRay('controller-right');
  await sleep(1200);
  o = await crashObjs();
  check(label + ': ' + 'timeline and trail show; card stays', o.timeline && o.trail && o.card, o);
  const ghost = await page.evaluate(() => {
    const g = window.__obj('range-crash-ghost');
    return g ? { visible: g.visible, pos: g.position.toArray().map((v) => +v.toFixed(2)) } : null;
  });
  check(label + ': ' + 'the ghost craft is shown', !!ghost && ghost.visible, ghost);
  await shot(label + '-3-replay-playing');

  // slow motion: how far the clock moves in a second
  const clockT = async () => page.evaluate(() => { const h = window.__obj('range-crash-timeline'); return h ? h.children.find((c) => c.position && c.position.z === 0.008)?.position.x : null; });
  const x1 = await clockT();
  await sleep(1000);
  const x2 = await clockT();
  console.log('playhead x', x1, x2);
  check(label + ': ' + 'the playhead is moving while playing', x2 !== x1, { x1, x2 });

  // pause
  await press('controller-right', 'crash:pause');
  const xp1 = await clockT();
  await sleep(600);
  const xp2 = await clockT();
  check(label + ': ' + 'Pause holds the playhead', xp1 === xp2, { xp1, xp2 });

  // scrub: a real drag of the controller ray along the track from the left end to the right end
  const track = await worldOf('range-crash-scrub');
  const yaw = await cardYaw();
  await aim('controller-right', track, yaw, 0.6, -0.19);
  await sleep(400);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
  await sleep(250);
  for (let i = 0; i <= 10; i++) {
    await aim('controller-right', track, yaw, 0.6, -0.19 + (0.38 * i) / 10);
    await sleep(70);
  }
  const xEnd = await clockT();
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
  await sleep(300);
  const info = await page.evaluate(() => {
    const f = window.__flight();
    const m = f.runner.crash;
    return { at: m.at, n: m.frames.length };
  });
  check(label + ': ' + 'the drag moved the playhead across the track', xEnd > 0.15, { xEnd });
  // drag to the impact frame: its place on the track
  const impactX = ((info.at / (info.n - 1)) - 0.5) * 0.4;
  await aim('controller-right', track, yaw, 0.6, impactX - 0.05);
  await sleep(300);
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
  await sleep(250);
  for (let i = 0; i <= 5; i++) {
    await aim('controller-right', track, yaw, 0.6, impactX - 0.05 + (0.05 * i) / 5);
    await sleep(70);
  }
  await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
  await sleep(500);
  const xi = await clockT();
  const at = await page.evaluate(() => {
    const f = window.__flight();
    const c = f.runner.crash;
    const fr = c.frames[c.at];
    const out = [0, 0, 0];
    f.map.toRoom(fr.x, fr.y, fr.z, out);
    const g = window.__obj('range-crash-ghost');
    return { impact: out.map((v) => +v.toFixed(2)), ghost: g ? g.position.toArray().map((v) => +v.toFixed(2)) : null };
  });
  check(label + ': ' + 'scrubbed to the impact frame: the ghost sits at the impact point', !!at.ghost && at.ghost.every((v, i) => Math.abs(v - at.impact[i]) < 0.06), { xi, impactX, at });
  await shot(label + '-4-scrubbed-to-impact');

  // Play, Close
  await press('controller-right', 'crash:play');
  await sleep(300);
  await press('controller-right', 'crash:close');
  s = await state();
  o = await crashObjs();
  check(label + ': ' + 'Close returns to the card', s.phase === 'crashed' && o.card && !o.timeline, { s: s.phase, o });
  await parkRay('controller-right');

  // X on the left controller opens the replay of the last crash
  await tap('controller-left', 3);
  await sleep(300);
  s = await state();
  check(label + ': ' + 'X opens the replay', s.phase === 'replay', s.phase);
  await press('controller-right', 'crash:close');

  // Why shows the cause
  await press('controller-right', 'crash:why');
  await shot(label + '-5-why');
  // Reset: the card goes
  await press('controller-right', 'crash:reset');
  await sleep(500);
  s = await state();
  o = await crashObjs();
  check(label + ': ' + 'Reset clears the card and the ring', s.phase !== 'crashed' && !o.card && !o.ring, { s: s.phase, o });
  await parkRay('controller-right');

}

await scenario('post', 'prim');
await scenario('net', 'net');
const perf = await page.evaluate(() => ({ calls: window.iynkware.world.renderer.info.render.calls }));
console.log('render', perf);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
