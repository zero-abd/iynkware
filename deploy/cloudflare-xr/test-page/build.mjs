// Builds the immersive test page into a folder: index.html, the page script under a content hash, and the three.js
// module build from npm, checked against a pinned integrity hash. Used by `npm run deploy -- --test-page`.
//
//   node test-page/build.mjs <out dir>     build only, to look at the output

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const THREE_VERSION = "0.187.0";
const THREE_INTEGRITY = "sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA==";
const THREE_FILES = ["build/three.module.js", "build/three.core.js", "LICENSE"];

const here = dirname(fileURLToPath(import.meta.url));

function run(command, args, cwd) {
  const out = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (out.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${out.stderr}`);
  return out.stdout.trim();
}

function fetchThree(into) {
  const work = mkdtempSync(join(tmpdir(), "iynkware-three-"));
  try {
    const tarball = run("npm", ["pack", `three@${THREE_VERSION}`, "--ignore-scripts", "--silent", "--pack-destination", work], work)
      .split("\n")
      .pop();
    const digest = `sha512-${createHash("sha512").update(readFileSync(join(work, tarball))).digest("base64")}`;
    if (digest !== THREE_INTEGRITY) throw new Error(`three@${THREE_VERSION} tarball does not match the pinned integrity`);
    run("tar", ["-xzf", tarball, ...THREE_FILES.map((file) => `package/${file}`)], work);
    mkdirSync(into, { recursive: true });
    for (const file of THREE_FILES) copyFileSync(join(work, "package", file), join(into, file.split("/").pop()));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Writes the test page into `out`, which must not exist yet or be empty. */
export function buildTestPage(out) {
  const assets = join(out, "assets");
  fetchThree(join(assets, `three-${THREE_VERSION}`));

  const script = readFileSync(join(here, "xr-test.js"), "utf8").replaceAll("__THREE_VERSION__", THREE_VERSION);
  const scriptName = `xr-test-${createHash("sha256").update(script).digest("hex").slice(0, 10)}.js`;
  writeFileSync(join(assets, scriptName), script);

  const html = readFileSync(join(here, "index.html"), "utf8").replaceAll("__XR_TEST_JS__", `/assets/${scriptName}`);
  writeFileSync(join(out, "index.html"), html);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node test-page/build.mjs <out dir>");
    process.exit(1);
  }
  buildTestPage(resolve(out));
  console.log(`test page written to ${resolve(out)}`);
}
