#!/usr/bin/env node
// The iynk command line. The app's modules are TypeScript with "@/" imports that Node does not resolve, so each start
// bundles src/cli/main.ts with esbuild (the repo's own dev dependency) into a temporary folder and runs it from there.
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const scratch = mkdtempSync(join(tmpdir(), "iynk-cli-"));
try {
  const outfile = join(scratch, "main.mjs");
  await build({
    entryPoints: [join(root, "src/cli/main.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    tsconfig: join(root, "tsconfig.json"),
    logLevel: "error",
  });
  const { main } = await import(pathToFileURL(outfile).href);
  process.exitCode = await main(process.argv.slice(2), {
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
    env: process.env,
    now: () => Date.now(),
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
