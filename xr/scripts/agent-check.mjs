// The agent pillar in the IWER emulator, headless: enter the session, open the Chemistry lab, ask "where is the
// burner" (the scripted brain points at it: a callout whose leader starts at the burner), turn the gas on and leave it
// unlit (a local hazard callout from the burner, with no brain involved), then a fake brain registered with `use` that
// calls point_at and streams its words (the speech bubble shows them).
//
//   npx vite --mode http --port 23201                 # in another terminal
//   node scripts/agent-check.mjs [url] [shot-dir]     # url defaults to http://localhost:8081/
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
  if (m.type() === 'error' || (m.type() === 'warning' && t.includes('[agent]'))) {
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
await page.waitForFunction(() => window.iynkware?.ready && window.iynkware.agent && window.iynkware.lab, null, { timeout: 60000 });
await page.evaluate(async () => {
  await window.iynkware.ready;
  window.__x = (method, params) => window.IWER_DEVICE.remote.dispatch(method, params);
  const V = window.iynkware.world.camera.position.constructor;
  window.__pos = (o) => (o ? o.getWorldPosition(new V()).toArray() : null);
  // Where a callout's leader starts and what it is about, from the scene.
  window.__callouts = () =>
    window.iynkware.world.scene.getObjectByName('agent:callouts').children.filter((g) => g.visible).map((g) => {
      const a = g.getObjectByName('agent-callout-leader').geometry.getAttribute('position');
      return { name: g.name, start: [a.getX(0), a.getY(0), a.getZ(0)], end: [a.getX(1), a.getY(1), a.getZ(1)], label: window.__pos(g.getObjectByName('agent-callout-label')) };
    });
});
const api = await page.evaluate(() => ['context', 'state', 'user', 'say', 'functionDeclarations', 'call', 'observe', 'ask', 'use'].filter((k) => typeof window.iynkware.agent[k] !== 'function'));
check('window.iynkware.agent has the bridge calls', api.length === 0, api);
const decl = await page.evaluate(() => window.iynkware.agent.functionDeclarations().map((d) => d.name));
check('functionDeclarations lists the tools', decl.includes('point_at') && decl.includes('propose_build'), decl);
check('Ask the assistant menu row', await page.evaluate(() => window.iynkware.app.shell.menuItems.value.some((m) => m.id === 'agent/ask')));

await page.click('#enter');
await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 }).catch(async () => {
  await page.evaluate(() => window.__x('accept_session'));
  await page.waitForFunction(() => window.iynkware.world.visibilityState.value === 'visible', null, { timeout: 20000 });
});
await sleep(600);
await page.evaluate(() => window.__x('set_transform', { device: 'headset', position: { x: 0, y: 1.2, z: 0.05 }, orientation: { x: -0.3007, y: 0, z: 0, w: 0.9537 } }));

// Open the chemistry lab through the tool.
const opened = await page.evaluate(() => window.iynkware.agent.call('open_lab', { lab: 'chemistry' }));
check('open_lab tool opens the chemistry lab', opened.ok && (await page.evaluate(() => window.iynkware.lab.store.lab)) === 'chemistry', opened);
await page.waitForFunction(() => {
  const b = window.iynkware.lab.store.byKind('bunsen-burner');
  return b && window.iynkware.world.scene.getObjectByName(`lab-item:${b.id}`)?.getObjectByName('lab-visual:bunsen-burner');
}, null, { timeout: 10000 });
await sleep(800);

// Ask the scripted brain where the burner is.
await page.evaluate(() => window.iynkware.agent.ask('Where is the burner?'));
await sleep(500);
const where = await page.evaluate(() => {
  const b = window.iynkware.lab.store.byKind('bunsen-burner');
  const g = window.iynkware.world.scene.getObjectByName(`lab-item:${b.id}`);
  const top = window.__pos(g);
  return { burner: top, callouts: window.__callouts(), turns: window.iynkware.agent.log.slice(-1) };
});
const near = (a, b, tol) => a && b && Math.hypot(a[0] - b[0], a[2] - b[2]) < tol;
const c1 = where.callouts[0];
check('"where is the burner" -> a callout whose leader starts over the burner', where.callouts.length === 1 && near(c1.start, where.burner, 0.02) && c1.start[1] > where.burner[1] + 0.03 && c1.end[1] > c1.start[1], where);
await shot('agent-1-where-burner');

// Gas on, not lit: the coach shows a hazard callout from the burner by itself (no brain involved).
await page.evaluate(() => {
  window.iynkware.agent.call('clear_callouts', {});
  window.iynkware.agent.use({ name: 'silent', turn() {}, observe() {} });
  const b = window.iynkware.lab.store.byKind('bunsen-burner');
  window.iynkware.lab.store.apply(b.id, { type: 'gas' });
});
const t0 = Date.now();
await page.waitForFunction(() => window.iynkware.world.scene.getObjectByName('agent:callouts').children.some((g) => g.visible), null, { timeout: 6000 }).catch(() => undefined);
const hazard = await page.evaluate(() => {
  const b = window.iynkware.lab.store.byKind('bunsen-burner');
  return { burner: window.__pos(window.iynkware.world.scene.getObjectByName(`lab-item:${b.id}`)), callouts: window.__callouts(), obs: window.iynkware.agent.observations(5).map((o) => o.kind) };
});
check('gas on unlit -> a local hazard callout from the burner within 6 s', hazard.callouts.length === 1 && near(hazard.callouts[0].start, hazard.burner, 0.02) && hazard.obs.includes('hazard'), { ...hazard, ms: Date.now() - t0 });
await sleep(400);
await shot('agent-2-hazard');
await page.evaluate(() => {
  const b = window.iynkware.lab.store.byKind('bunsen-burner');
  window.iynkware.lab.store.apply(b.id, { type: 'gas' });
  window.iynkware.agent.call('clear_callouts', {});
});

// A fake Gemini-like brain: one tool call, then streamed words.
const bubble = await page.evaluate(async () => {
  const agent = window.iynkware.agent;
  agent.use({
    name: 'fake-live',
    async turn(_input, io) {
      await io.call('point_at', { target: 'beaker', text: 'Use this one', tone: 'do' });
      io.say('Use the beaker ');
      io.say('on the right.');
      io.say('', { final: true, suggestions: ['Thanks'] });
    },
  });
  agent.state('listening');
  await agent.ask('which glass do I use?');
  const speech = window.iynkware.world.scene.getObjectByName('agent:speech');
  return { visible: speech.visible, text: agent.transcript.turns.at(-1)?.text, pos: window.__pos(speech), log: agent.log.slice(-1), callouts: window.__callouts().length };
});
const turns = await page.evaluate(() => window.iynkware.world && JSON.stringify(window.iynkware.agent.context()).length);
check('fake brain: point_at ran and the speech bubble shows its words', bubble.visible && bubble.text === 'Use the beaker on the right.' && bubble.log[0]?.name === 'point_at' && bubble.log[0].ok && bubble.callouts === 1, bubble);
check('context() fits the voice client (under 16k chars)', turns < 16000, turns);
await sleep(500);
await shot('agent-3-bubble');

await page.evaluate(() => window.iynkware.lab.leave());
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
