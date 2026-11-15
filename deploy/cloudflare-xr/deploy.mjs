#!/usr/bin/env node
// Deploys a static build of the headset app to the iynkware-xr Worker on Cloudflare (docs/XR_DEPLOY.md).
//
//   npm run deploy                         ../../xr/dist to production
//   npm run deploy -- <dir>                another build folder (relative to where npm was run)
//   npm run deploy -- --test-page          the built-in immersive test page (test-page/)
//   npm run preview -- [<dir>]             a Preview named after the current git branch
//   npm run preview -- [<dir>] --name <n>  a Preview with another name
//   ... --dry-run                          stage and check, upload nothing (production only)
//   ... --keep                             keep the staging folder and print its path
//
// The build folder is never changed. It is copied into a temporary folder outside the repo together with _headers
// and .assetsignore from this folder, and Wrangler runs against a copy of wrangler.jsonc that points at it.

import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildTestPage } from "./test-page/build.mjs";

export const WRANGLER = "wrangler@4.162.0";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const DEFAULT_BUILD = resolve(here, "..", "..", "xr", "dist");

class DeployError extends Error {}

function fail(message) {
  throw new DeployError(message);
}

function parseArgs(argv) {
  const opts = { dir: null, preview: false, name: null, dryRun: false, keep: false, testPage: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--preview") opts.preview = true;
    else if (arg === "--name") opts.name = argv[++i] ?? fail("--name needs a value");
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--keep") opts.keep = true;
    else if (arg === "--test-page") opts.testPage = true;
    else if (arg.startsWith("-")) fail(`unknown option ${arg}`);
    else if (opts.dir) fail(`one build folder only, got ${opts.dir} and ${arg}`);
    else opts.dir = arg;
  }
  if (opts.testPage && opts.dir) fail("give a build folder or --test-page, not both");
  if (opts.name && !opts.preview) fail("--name is for previews: npm run preview -- --name <name>");
  if (opts.dryRun && opts.preview) fail("--dry-run works for production deploys only");
  return opts;
}

function git(...args) {
  const out = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "";
}

/** A Preview name from a git branch: lower case letters, digits and dashes, as a DNS label allows. */
export function previewName(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
}

/** wrangler.jsonc without its comment lines. Comments in that file sit on lines of their own. */
export function readConfig(file) {
  const text = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(text);
}

function describeSource(dir) {
  const rel = relative(repoRoot, dir);
  if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  return dir.split(sep).slice(-2).join("/");
}

function stageBuild(opts, staging) {
  const site = join(staging, "site");
  let source;
  if (opts.testPage) {
    source = "deploy/cloudflare-xr/test-page";
    buildTestPage(site);
  } else {
    const base = process.env.INIT_CWD ?? process.cwd();
    const dir = opts.dir ? resolve(base, opts.dir) : DEFAULT_BUILD;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      fail(`${dir} is not a folder. Build the headset app first (its output goes to xr/dist), or pass a folder.`);
    }
    if (!existsSync(join(dir, "index.html"))) fail(`${dir} has no index.html, so it is not a static build`);
    if (existsSync(join(dir, "_headers"))) {
      fail(`${dir} ships its own _headers. The headers live in deploy/cloudflare-xr/_headers; remove the build's copy.`);
    }
    source = describeSource(dir);
    cpSync(dir, site, { recursive: true });
    // Voice is the headset app's own client now (xr/src/agent/voice); the old demo page script is not injected.
  }
  copyFileSync(join(here, "_headers"), join(site, "_headers"));
  const ignore = readFileSync(join(here, ".assetsignore"), "utf8");
  if (existsSync(join(site, ".assetsignore"))) appendFileSync(join(site, ".assetsignore"), `\n${ignore}`);
  else writeFileSync(join(site, ".assetsignore"), ignore);
  return source;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    report(error);
    return;
  }
  const staging = mkdtempSync(join(tmpdir(), "iynkware-xr-"));
  try {
    const source = stageBuild(opts, staging);

    const config = readConfig(join(here, "wrangler.jsonc"));
    config.assets = { ...config.assets, directory: "./site" };
    if (config.main) config.main = join(here, config.main);
    writeFileSync(join(staging, "wrangler.json"), `${JSON.stringify(config, null, 2)}\n`);

    const sha = git("rev-parse", "--short", "HEAD") || "nogit";
    const dirty = git("status", "--porcelain") ? "+dirty" : "";
    const message = `${source} at ${sha}${dirty}`;

    const args = ["--yes", WRANGLER];
    if (opts.preview) {
      const name = opts.name ? previewName(opts.name) : previewName(git("rev-parse", "--abbrev-ref", "HEAD") || "preview");
      if (!name) fail("could not make a Preview name; pass --name <name>");
      args.push("preview", "--config", join(staging, "wrangler.json"), "--name", name, "--message", message);
      console.log(`deploy: Preview "${name}" of ${source} (${basename(staging)})`);
    } else {
      args.push("deploy", "--config", join(staging, "wrangler.json"), "--message", message);
      if (opts.dryRun) args.push("--dry-run");
      console.log(`deploy: ${opts.dryRun ? "dry run of" : "production deploy of"} ${source} (${basename(staging)})`);
    }

    const run = spawnSync("npx", args, { cwd: staging, stdio: "inherit", shell: process.platform === "win32" });
    if (run.status !== 0) fail(`wrangler exited with ${run.status ?? run.signal}`);
    if (!opts.dryRun) console.log("deploy: check the headers with  npm run check -- <the URL above>");
  } catch (error) {
    report(error);
  } finally {
    if (opts.keep) console.log(`deploy: staging folder kept at ${staging}`);
    else rmSync(staging, { recursive: true, force: true });
  }
}

function report(error) {
  if (!(error instanceof DeployError)) throw error;
  console.error(`deploy: ${error.message}`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
