import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The server image copies only some of the app's src folders, so a server import of any other src file breaks
// only inside the image, where no local run looks. Follow every run-time import from server/src and check that
// each src file it reaches is copied by deploy/Dockerfile.server and each package those files load is a server
// dependency.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dockerfile = readFileSync(join(root, "deploy/Dockerfile.server"), "utf8");
const serverDeps = Object.keys(JSON.parse(readFileSync(join(root, "server/package.json"), "utf8")).dependencies ?? {});

const copied = [...dockerfile.matchAll(/^COPY (.+) \.\/\S+$/gm)].flatMap(([, sources]) =>
  sources.split(" ").filter((source) => source.startsWith("src/")),
);
const isCopied = (file: string): boolean => copied.some((source) => file === source || file.startsWith(`${source}/`));

// Type-only imports are erased before Node runs the file, so they need nothing in the image.
const runtimeSpecifiers = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^(?:import|export)(\s+type)?\b\s*(?:[^"';]*?\bfrom\s*)?["']([^"']+)["']/gm)]
    .filter(([, typeOnly]) => !typeOnly)
    .map(([, , spec]) => spec);

const packageName = (spec: string): string => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");

function shared(): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const serverSrc = join(root, "server/src");
  const queue = readdirSync(serverSrc, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => join(serverSrc, entry));
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    const inSrc = relative(root, file).startsWith("src/");
    for (const spec of runtimeSpecifiers(file)) {
      if (spec.startsWith("node:")) continue;
      if (!spec.startsWith(".")) {
        if (inSrc) packages.add(packageName(spec));
        continue;
      }
      const target = resolve(dirname(file), spec);
      const rel = relative(root, target);
      if (!rel.startsWith("src/") || files.has(rel)) continue;
      files.add(rel);
      queue.push(target);
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}

test("the server image copies every src file the server runs", () => {
  const { files } = shared();
  assert.ok(files.includes("src/lib/search/schema.ts"), "the walk should reach the shared search schema");
  const missing = files.filter((file) => !isCopied(file));
  assert.deepEqual(missing, [], `deploy/Dockerfile.server does not copy: ${missing.join(", ")}`);
});

test("every package the shared src files load is a server dependency", () => {
  const missing = shared().packages.filter((pkg) => !serverDeps.includes(pkg));
  assert.deepEqual(missing, [], `server/package.json lacks: ${missing.join(", ")}`);
});

test("the image lets shared src files find the server's packages", () => {
  assert.match(dockerfile, /^RUN ln -s server\/node_modules \/app\/node_modules$/m);
});
