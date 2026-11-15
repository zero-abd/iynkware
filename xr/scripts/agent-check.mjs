// The agent pillar in the IWER emulator, headless: enter the session, open the Chemistry lab, ask "where is the
// burner" (the scripted brain points at it: a callout whose leader starts at the burner), turn the gas on and leave it
// unlit (a hazard observation for the companion, and nothing popping up over the bench), then a fake brain registered with `use` that
// calls point_at and streams its words (the speech bubble shows them), then voice: enabled from the 2D button with a
// fake Gemini socket (the dev build's test seam), held to talk with the fake microphone, the fake answer's transcript
// in the bubble and its tool call's callout on the beaker.
//
//   npx vite --mode http --port 23201                 # in another terminal
//   node scripts/agent-check.mjs [url] [shot-dir]     # url defaults to http://localhost:8081/
import { chromium } from 'playwright';

const target = new globalThis.URL(process.argv[2] ?? 'http://localhost:8081/');
if (!target.searchParams.has('project')) target.searchParams.set('project', 'prj_uno-r3-blink');
const SHOTS = process.argv[3];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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

// Gas on, not lit: the coach notes a hazard for the companion, and nothing pops up over the bench (no lab pop-ups).
await page.evaluate(() => {
  window.iynkware.agent.call('clear_callouts', {});
  window.iynkware.agent.use({ name: 'silent', turn() {}, observe() {} });
  const b = window.iynkware.lab.store.byKind('bunsen-burner');
  window.iynkware.lab.store.apply(b.id, { type: 'gas' });
});
const t0 = Date.now();
await page.waitForFunction(() => window.iynkware.agent.observations(5).some((o) => o.kind === 'hazard'), null, { timeout: 6000 }).catch(() => undefined);
const hazard = await page.evaluate(() => ({ callouts: window.__callouts(), obs: window.iynkware.agent.observations(5).map((o) => o.kind) }));
check('gas on unlit -> a hazard observation within 6 s, and no callout over the bench', hazard.callouts.length === 0 && hazard.obs.includes('hazard'), { ...hazard, ms: Date.now() - t0 });
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


// Voice with a fake Gemini on the dev build's seams: token route, socket.
await page.evaluate(() => {
  window.__voice = { sent: [], urls: [] };
  window.__iynkwareVoiceFetch = async () => ({ ok: true, status: 200, json: async () => ({ token: 'auth_tokens/fake-token-for-the-check', model: 'models/gemini-3.8-live' }) });
  window.__iynkwareVoiceSocket = (url) => {
    const fns = {};
    const s = {
      readyState: 0,
      addEventListener: (t, fn) => (fns[t] ??= []).push(fn),
      close() { this.readyState = 3; for (const fn of fns.close ?? []) fn({}); },
      send(data) {
        const m = JSON.parse(data);
        window.__voice.sent.push(m);
        const reply = (msg) => setTimeout(() => { for (const fn of fns.message ?? []) fn({ data: JSON.stringify(msg) }); }, 20);
        if (m.setup) reply({ setupComplete: {} });
        if (m.realtimeInput?.activityEnd) {
          reply({ serverContent: { inputTranscription: { text: 'which glass do I use' } } });
          reply({ toolCall: { functionCalls: [{ id: 'fc-check-1', name: 'point_at', args: { target: 'beaker', text: 'Use this one', tone: 'do' } }] } });
          setTimeout(() => {
            reply({ serverContent: { outputTranscription: { text: 'Use the beaker, ' } } });
            reply({ serverContent: { outputTranscription: { text: 'it is marked.' } } });
            reply({ serverContent: { turnComplete: true } });
          }, 60);
        }
      },
    };
    window.__voice.urls.push(url.replace(/access_token=[^&]+/, 'access_token=…'));
    setTimeout(() => { s.readyState = 1; for (const fn of fns.open ?? []) fn({}); }, 10);
    return s;
  };
  window.iynkware.agent.call('clear_callouts', {});
  window.iynkware.agent.use({ name: 'silent-2', turn() {}, observe() {} });
});
// In the session the page's 2D controls are under the emulator, as on a headset: turn voice on from the menu row,
// then select "Enable voice" on the in-world consent panel with the right controller's ray (a real XR select).
await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'agent/voice').run());
await sleep(400);
const agreeAt = await page.evaluate(() => window.__pos(window.iynkware.world.scene.getObjectByName('lab-ui:agent-voice-consent:agree')));
const aimed = await page.evaluate((p) => {
  const cam = window.iynkware.world.camera;
  const V = cam.position.constructor, Q = cam.quaternion.constructor, M = cam.matrix.constructor;
  const head = cam.getWorldPosition(new V());
  const from = new V(head.x + 0.08, head.y - 0.1, head.z - 0.05);
  const q = new Q().setFromRotationMatrix(new M().lookAt(from, new V(p[0], p[1], p[2]), new V(0, 1, 0)));
  window.__x('set_transform', { device: 'controller-right', position: { x: from.x, y: from.y, z: from.z }, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } });
  return { from: from.toArray(), to: p, visible: window.iynkware.world.scene.getObjectByName('agent:voice-consent').visible };
}, agreeAt);
console.log('aim at Enable voice', JSON.stringify(aimed));
await sleep(400);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 1 }));
await sleep(180);
await page.evaluate(() => window.__x('set_select_value', { device: 'controller-right', value: 0 }));
await page.waitForFunction(() => window.__voice.sent.some((m) => m.setup), null, { timeout: 10000 }).catch(() => undefined);
await sleep(300);
check('voice: enabled from the in-world consent panel', await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'agent/voice').toggle.value));
// Hold to talk (the 2D button's handlers; the thumbstick does the same on a headset).
const hold = (type) => page.evaluate((t) => document.getElementById('agent-voice-talk').dispatchEvent(new PointerEvent(t, { pointerId: 1, bubbles: true })), type);
await hold('pointerdown');
await sleep(900);
await shot('agent-4-talking');
await hold('pointerup');
await page.waitForFunction(() => window.__voice.sent.some((m) => m.toolResponse), null, { timeout: 6000 }).catch(() => undefined);
await sleep(600);
const voice = await page.evaluate(() => {
  const v = window.__iynkwareVoice;
  const kinds = window.__voice.sent.map((m) => (m.realtimeInput ? `rt:${Object.keys(m.realtimeInput)[0]}` : Object.keys(m)[0]));
  const resp = window.__voice.sent.find((m) => m.toolResponse)?.toolResponse.functionResponses[0];
  const beaker = window.iynkware.lab.store.byKind('beaker-250');
  return {
    urls: window.__voice.urls,
    mic: { chunks: v?.audio.chunks, ctx: v?.audio.state, status: v?.session.status, path: v?.session.path },
    first: kinds.slice(0, 3),
    audio: kinds.filter((k) => k === 'rt:audio').length,
    end: kinds.includes('rt:activityEnd'),
    resp: resp && { id: resp.id, name: resp.name, ok: resp.response.ok },
    turns: window.iynkware.agent.transcript.turns.slice(-2).map((t) => [t.who, t.text]),
    callouts: window.__callouts().map((c) => c.name),
    beakerAt: window.__pos(window.iynkware.world.scene.getObjectByName(`lab-item:${beaker.id}`)),
    start: window.__callouts()[0]?.start,
  };
});
check('voice: one direct session, grounding then activityStart, mic audio streamed with no gate, activityEnd', voice.urls.length === 1 && voice.urls[0].includes('BidiGenerateContentConstrained') && voice.first.join() === 'setup,clientContent,rt:activityStart' && voice.audio >= 5 && voice.end, voice);
check('voice: the fake toolCall ran point_at and answered with the same id', voice.resp?.id === 'fc-check-1' && voice.resp.name === 'point_at' && voice.resp.ok === true && voice.callouts.length === 1 && near(voice.start, voice.beakerAt, 0.03), voice);
check('voice: the bubble shows the fake transcripts', JSON.stringify(voice.turns) === JSON.stringify([['user', 'which glass do I use'], ['agent', 'Use the beaker, it is marked.']]), voice.turns);
await shot('agent-5-voice-answer');
await page.evaluate(() => window.iynkware.app.shell.menuItems.value.find((m) => m.id === 'agent/voice').run());
await page.evaluate(() => window.iynkware.lab.leave());
check('no page errors', errors.length === 0, errors.slice(0, 5));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
