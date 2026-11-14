// Talks to Quest Browser over the Chrome DevTools Protocol (no dependencies; Node's global WebSocket). From the XR spike.
// First: metavr adb forward tcp:9223 localabstract:chrome_devtools_remote
//   node scripts/cdp.mjs logs [seconds]      # replays the buffered console, then streams it for N s (default 3)
//   node scripts/cdp.mjs eval '<js expr>'    # evaluates in the page (awaits a promise), prints JSON; keeps the session
//   node scripts/cdp.mjs reload              # reloads the page (ends any XR session)
// Example: node scripts/cdp.mjs eval 'JSON.stringify({fr: iynkware.world.session?.frameRate, sim: iynkware.app.sim.state})'
const PORT = process.env.CDP_PORT || 9223;
const [cmd = 'logs', arg] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && /localhost|https?:/.test(t.url));
if (!page) {
  console.error('no page target', targets.map((t) => t.url));
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const args = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    console.log(`[${m.params.type}] ${args}`);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log(`[EXCEPTION] ${d.exception?.description ?? d.text}`);
  } else if (m.method === 'Log.entryAdded') {
    console.log(`[log.${m.params.entry.level}] ${m.params.entry.text}`);
  }
};
await new Promise((r) => (ws.onopen = r));
console.error(`# ${page.url}`);
if (cmd === 'logs') {
  await send('Runtime.enable');
  await send('Log.enable');
  await new Promise((r) => setTimeout(r, Number(arg ?? 3) * 1000));
} else if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', {
    expression: arg,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 2));
} else if (cmd === 'reload') {
  await send('Page.reload', { ignoreCache: true });
}
ws.close();
process.exit(0);
