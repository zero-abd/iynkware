import { existsSync, globSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { newProjectId, type Clock } from "@/core/ids";
import type { Locale } from "@/i18n/config";
import { importWokwi } from "@/export/wokwi/import";
import type { LossItem } from "@/export/loss";
import { getAppRegistry } from "@/parts/builtin";
import { LOCAL_ACTOR } from "@/studio/templates";
import { readIynk } from "@/export/iynk";
import { readIynkz } from "@/export/iynkz";
import type { Project } from "@/project/generated/types";
import { validateText } from "@/project/validate";

export type LoadErrorKind = "unsupported" | "unreadable" | "invalid" | "submission";

/** `loss` is what a Wokwi import could not carry over; a project file has none. */
export type Loaded = { ok: true; project: Project; loss: LossItem[] } | { ok: false; kind: LoadErrorKind; detail: string };

const PROJECT_EXTENSIONS = [".iynk", ".iynkz", ".json"];

/** What a folder stands for; a bare `.json` would also pick up package.json and the like. */
const FOLDER_PATTERNS = ["**/*.iynk", "**/*.iynkz", "**/*.project.json", "**/diagram.json"];

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", ".git"]);

const glob = (pattern: string, cwd: string): string[] => globSync(pattern, { cwd, exclude: (name) => SKIPPED_FOLDERS.has(name) });

const GLOB_CHARS = /[*?[\]{}]/;

const failed = (kind: LoadErrorKind, detail = ""): Loaded => ({ ok: false, kind, detail });

const WOKWI_FILE = "diagram.json";

/** A Wokwi project is read the way the Studio reads it, from the diagram and the sketch, `main.py` and `libraries.txt` beside it. */
function loadWokwi(file: string, clock: Clock, lang: Locale): Loaded {
  const folder = dirname(file);
  try {
    const files = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({ name: entry.name, bytes: new Uint8Array(readFileSync(join(folder, entry.name))) }));
    const imported = importWokwi(files, {
      id: newProjectId(clock()),
      now: new Date(clock()).toISOString(),
      locale: lang,
      actor: LOCAL_ACTOR,
      title: basename(folder),
      registry: getAppRegistry(),
    });
    return imported.ok ? { ok: true, project: imported.value.project, loss: imported.value.loss } : failed("invalid", imported.error.message);
  } catch (error) {
    return failed("unreadable", error instanceof Error ? error.message : String(error));
  }
}

/** Reads one project file: an iynk project, or a Wokwi `diagram.json` turned into one. */
export async function loadProject(file: string, clock: Clock, lang: Locale): Promise<Loaded> {
  const extension = extname(file).toLowerCase();
  if (!PROJECT_EXTENSIONS.includes(extension)) return failed("unsupported");
  if (basename(file) === WOKWI_FILE) return loadWokwi(file, clock, lang);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    return failed("unreadable", error instanceof Error ? error.message : String(error));
  }
  if (extension === ".json") {
    const report = validateText(new TextDecoder().decode(bytes));
    return report.ok && report.doc ? { ok: true, project: report.doc, loss: [] } : failed("invalid", report.first20[0]?.message ?? "");
  }
  const report = extension === ".iynk" ? readIynk(bytes, clock) : await readIynkz(bytes, clock);
  return report.ok ? { ok: true, project: report.project, loss: [] } : failed("invalid", report.error.message);
}

/** The project files the patterns name, sorted and without repeats. A folder stands for every project file inside it. */
export function expandPatterns(patterns: readonly string[], cwd: string): string[] {
  const found = new Set<string>();
  for (const pattern of patterns) {
    const path = resolve(cwd, pattern);
    if (!GLOB_CHARS.test(pattern) && existsSync(path)) {
      if (statSync(path).isDirectory()) {
        for (const folderPattern of FOLDER_PATTERNS) for (const match of glob(folderPattern, path)) found.add(join(path, match));
      } else {
        found.add(path);
      }
    } else {
      for (const match of glob(pattern, cwd)) found.add(resolve(cwd, match));
    }
  }
  return [...found].sort();
}
