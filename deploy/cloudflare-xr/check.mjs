#!/usr/bin/env node
// Checks a live iynkware-xr URL against _headers: the page, a client side route (SPA fallback) and one hashed asset,
// plus a missing asset, which must be a 404.
//
//   npm run check -- https://iynkware-xr.<subdomain>.workers.dev
//
// Exit 0 when those three responses are 200 with exactly the headers from _headers and the missing asset is a 404.

import { readFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The header rules of a _headers file, in file order: [{ pattern, set: Map, detach: Set }]. */
export function parseHeaders(text) {
  const rules = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), set: new Map(), detach: new Set() });
      continue;
    }
    const rule = rules.at(-1);
    const line = raw.trim();
    if (line.startsWith("! ")) rule.detach.add(line.slice(2).trim().toLowerCase());
    else {
      const colon = line.indexOf(":");
      rule.set.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return rules;
}

/** The headers _headers gives a path: every matching rule in order, a detach dropping what earlier rules set. */
export function expectedFor(rules, path) {
  const out = new Map();
  for (const rule of rules) {
    const re = new RegExp(`^${rule.pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", ".*")}$`);
    if (!re.test(path)) continue;
    for (const name of rule.detach) out.delete(name);
    for (const [name, value] of rule.set) out.set(name, out.has(name) ? `${out.get(name)}, ${value}` : value);
  }
  return out;
}

// Browser-like request headers. node:https rather than fetch, which replaces Sec-Fetch-Mode with "cors", so a
// navigation (the SPA fallback) could not be asked for.
const NAVIGATE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", accept: "text/html" };
const SCRIPT = { "sec-fetch-mode": "cors", "sec-fetch-dest": "script", accept: "*/*" };

function get(url, headers) {
  return new Promise((done, reject) => {
    const req = request(url, { headers: { "user-agent": "iynkware-xr-check", "accept-encoding": "identity", ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const header = (name) => {
          const value = res.headers[name];
          return value === undefined ? null : Array.isArray(value) ? value.join(", ") : value;
        };
        done({ status: res.statusCode, header, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const base = process.argv[2];
  if (!base || !/^https:\/\//.test(base)) {
    console.error("usage: npm run check -- https://<host>");
    process.exit(1);
  }
  const origin = new URL(base).origin;
  const rules = parseHeaders(readFileSync(join(here, "_headers"), "utf8"));
  const failures = [];
  const results = [];

  async function check(label, path, headers, expectType) {
    const { status, header, body } = await get(`${origin}${path}`, headers);
    const problems = [];
    if (status !== 200) problems.push(`status ${status}`);
    const type = header("content-type") ?? "";
    if (expectType && !type.startsWith(expectType)) problems.push(`content-type ${type}`);
    for (const [name, value] of expectedFor(rules, path)) {
      const got = header(name);
      if (got !== value) problems.push(`${name}: expected "${value}", got ${got === null ? "nothing" : `"${got}"`}`);
    }
    results.push({ label, path, status, type, cache: header("cache-control") });
    for (const problem of problems) failures.push(`${label} ${path}: ${problem}`);
    return body;
  }

  const html = await check("page", "/", NAVIGATE, "text/html");
  await check("spa route", "/some/client/route", NAVIGATE, "text/html");
  // Vite writes "/assets/..." or, with base "./", "./assets/..."; both resolve to /assets/ from the page at /.
  const ref = /(?:src|href)="(?:\.?\/)?(assets\/[^"]+)"/.exec(html)?.[1];
  const asset = ref && `/${ref}`;
  if (asset) await check("asset", asset, SCRIPT, null);
  else failures.push("page /: no /assets/ reference in the HTML to check the long cache on");

  // A missing hashed file must be a 404 from not-found.js, never index.html under a year-long cache.
  const missing = await get(`${origin}/assets/not-a-file-${Date.now()}.js`, SCRIPT);
  if (missing.status !== 404) failures.push(`missing asset: expected 404, got ${missing.status}`);
  results.push({
    label: "missing asset",
    path: "/assets/not-a-file-….js",
    status: missing.status,
    type: missing.header("content-type") ?? "",
    cache: missing.header("cache-control"),
  });

  console.log(`checked ${origin}`);
  for (const r of results) console.log(`  ${r.label.padEnd(13)} ${String(r.status).padEnd(4)} ${r.type.padEnd(32)} ${r.cache ?? ""}  ${r.path}`);
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):`);
    for (const failure of failures) console.log(`  ${failure}`);
    process.exit(1);
  }
  console.log("\nall headers match _headers");
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
