// iynk offline worker. Every page registers /sw.js?v=<build id>, so every build is a new worker.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL = `iynk-shell-${VERSION}`;
const STATIC = `iynk-static-${VERSION}`;
const FIGURES = "iynk-figures-v1";
const ENGINES = "iynk-engines-v1";
const CURRENT = [SHELL, STATIC, FIGURES, ENGINES];

const NAVIGATION_TIMEOUT_MS = 3000;
const FIGURES_LIMIT_BYTES = 200 * 1024 * 1024;
const DEFAULT_LANG = "en";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pageKey = (url) => new URL(new URL(url).pathname, self.location.origin).href;

function langOfPath(path) {
  const match = /^\/([a-z]{2,3})(?:\/|$)/.exec(path);
  return match ? match[1] : null;
}

const langOf = (href) => langOfPath(new URL(href).pathname) ?? DEFAULT_LANG;

function assetUrls(text, base) {
  const found = new Set();
  for (const match of text.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) {
    found.add(new URL(match[0].replaceAll("&amp;", "&"), base).href);
  }
  return found;
}

function cssUrls(text, base) {
  const found = new Set();
  for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
    if (/^(data:|#|%23)/.test(match[1])) continue;
    const url = new URL(match[1], base);
    url.hash = "";
    if (url.origin === self.location.origin) found.add(url.href);
  }
  return found;
}

async function fetchOk(url) {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`precache ${url}: ${response.status}`);
  return response;
}

async function windowPaths() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.map((client) => new URL(client.url).pathname);
}

// Stores a page and the files it needs to draw: its scripts and styles, and what the styles point to.
async function precachePage(path) {
  const shell = await caches.open(SHELL);
  const statics = await caches.open(STATIC);
  const page = `${self.location.origin}${path}`;
  const html = await fetchOk(page);
  const assets = assetUrls(await html.clone().text(), page);
  await shell.put(pageKey(page), html);

  const sheets = [...assets].filter((url) => new URL(url).pathname.endsWith(".css"));
  const linked = new Set();
  for (const sheet of sheets) {
    const response = await fetchOk(sheet);
    for (const url of cssUrls(await response.clone().text(), sheet)) linked.add(url);
    await statics.put(sheet, response);
  }
  const rest = [...assets, ...linked].filter((url) => !sheets.includes(url));
  await Promise.all(
    rest.map(async (url) => {
      if (await statics.match(url)) return;
      await statics.put(url, await fetchOk(url));
    }),
  );
}

const STUDIO_PAGE = /^\/([a-z]{2,3})\/studio$/;

// The Studio pages to keep: those open in a window now, and those the worker this one replaces had stored,
// so an update made from any page does not take the Studio away from someone who uses it offline.
async function studioPages(paths) {
  const found = new Set(paths.map((path) => /^\/([a-z]{2,3})\/studio(?:\/|$)/.exec(path)).filter(Boolean).map((match) => `/${match[1]}/studio`));
  for (const name of await caches.keys()) {
    if (!name.startsWith("iynk-shell-") || name === SHELL) continue;
    for (const entry of await (await caches.open(name)).keys()) {
      const path = new URL(entry.url).pathname;
      if (STUDIO_PAGE.test(path)) found.add(path);
    }
  }
  return found;
}

// The offline page in the language of the page that registered the worker, and the Studio where it is in use,
// so one visit there opens the project list offline. Any other page is stored as it is visited.
async function precache() {
  const paths = await windowPaths();
  const lang = paths.map(langOfPath).find(Boolean) ?? DEFAULT_LANG;
  await precachePage(`/${lang}/offline`);
  for (const studio of await studioPages(paths)) await precachePage(studio);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("iynk-") && !CURRENT.includes(name)).map((name) => caches.delete(name)));
      await caches.open(ENGINES);
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function keep(cacheName, request, response) {
  if (!response.ok) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // Private windows and full disks have no room; the network answer still stands.
  }
}

// The page itself, or for a page never stored the offline page, as a redirect so the address matches what shows.
async function cachedPage(request, key) {
  const shell = await caches.open(SHELL);
  const exact = await shell.match(key, { ignoreVary: true });
  if (exact || isRsc(request)) return exact;
  const stored = (await shell.keys()).map((entry) => entry.url);
  const offline = (lang) => stored.find((url) => new URL(url).pathname === `/${lang}/offline`);
  const found = offline(langOf(request.url)) ?? stored.find((url) => /^\/[a-z]{2,3}\/offline$/.test(new URL(url).pathname));
  return found ? Response.redirect(found, 302) : undefined;
}

// Pages and Next's RSC data for them: network first, the stored copy when the network is slow or gone. A page
// request stores under its path; an RSC request under its full URL, so the two never meet.
async function answerPage(event) {
  const { request } = event;
  const key = isRsc(request) ? request.url : pageKey(request.url);
  const network = fetch(request).then((response) => {
    event.waitUntil(keep(SHELL, key, response.clone()));
    return response;
  });
  event.waitUntil(network.catch(() => {}));

  let first = null;
  try {
    first = await Promise.race([network, wait(NAVIGATION_TIMEOUT_MS).then(() => null)]);
  } catch {
    first = null;
  }
  if (first) return first;

  const hit = await cachedPage(request, key);
  if (hit) return hit;
  try {
    return await network;
  } catch {
    return Response.error();
  }
}

async function answerStatic(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return request.destination === "worker" ? withoutUrl(hit) : hit;
  const response = await fetch(request);
  await keep(STATIC, request, response.clone());
  return response;
}

// Every Turbopack worker starts from one script and takes its chunk list from the URL fragment. The cache
// stores the first fragment with the response, and a worker takes its location from the response it is given,
// so a copy with no URL is what makes the next worker keep its own fragment.
async function withoutUrl(response) {
  return new Response(await response.blob(), { status: response.status, headers: response.headers });
}

async function trimFigures() {
  const cache = await caches.open(FIGURES);
  const requests = await cache.keys();
  const sizes = await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      return Number(response && response.headers.get("content-length")) || 0;
    }),
  );
  let total = sizes.reduce((sum, size) => sum + size, 0);
  for (let i = 0; i < requests.length && total > FIGURES_LIMIT_BYTES; i += 1) {
    await cache.delete(requests[i]);
    total -= sizes[i];
  }
}

async function refreshFigure(request) {
  const response = await fetch(request);
  await keep(FIGURES, request, response.clone());
  await trimFigures();
  return response;
}

async function answerFigure(event) {
  const { request } = event;
  const cache = await caches.open(FIGURES);
  const hit = await cache.match(request);
  const refreshed = refreshFigure(request);
  event.waitUntil(refreshed.catch(() => {}));
  return hit || refreshed;
}

// Engines are versioned files the loader checks against their hash, so a stored one is never refetched. The
// manifest that lists them is the exception: the network answers first, and the stored copy covers being offline.
async function answerEngine(request) {
  const cache = await caches.open(ENGINES);
  const hit = await cache.match(request);
  const isManifest = new URL(request.url).pathname.endsWith("/manifest.json");
  if (hit && !isManifest) return hit;
  try {
    const response = await fetch(request);
    await keep(ENGINES, request, response.clone());
    return response;
  } catch (error) {
    if (hit) return hit;
    throw error;
  }
}

const isRsc = (request) => request.headers.has("rsc") || new URL(request.url).searchParams.has("_rsc");

function handles(request) {
  if (request.method !== "GET" || request.headers.has("range")) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/sw.js" || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/api/")) return false;
  return true;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!handles(request)) return;
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/_next/static/")) event.respondWith(answerStatic(request));
  else if (pathname.startsWith("/figures/")) event.respondWith(answerFigure(event));
  else if (pathname.startsWith("/engines/")) event.respondWith(answerEngine(request));
  else if (request.mode === "navigate" || isRsc(request)) event.respondWith(answerPage(event));
});
