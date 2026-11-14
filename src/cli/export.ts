import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { exportIno } from "@/export/ino";
import { bomCsv, projectBom } from "@/export/bom";
import { getAppRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import type { Flags, Io } from "./io";
import type { Words } from "./messages";

/** Where an export tool reports itself in the sketch header; the command line has no app version of its own. */
export interface ExportContext {
  version: string;
  /** ISO time stamped into the header of an exported sketch. */
  exportedAt: string;
}

function write(path: string, text: string, io: Io, { t }: Words): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  io.out(t("export.wrote", { file: relative(io.cwd, path) || path }));
}

/** `iynk export --format ino|bom`. Returns the exit code. */
export function exportCommand(project: Project, flags: Flags, io: Io, words: Words, context: ExportContext): number {
  const { t } = words;
  if (flags.format === "bom") {
    const csv = bomCsv(projectBom(project, (ref, version) => getAppRegistry().get(ref, version)));
    if (flags.out === undefined) for (const line of csv.trimEnd().split("\r\n")) io.out(line);
    else write(resolve(io.cwd, flags.out), csv, io, words);
    return 0;
  }
  if (flags.format !== "ino") {
    io.err(t("error.badFormat"));
    return 2;
  }
  const board = project.boards.find((b) => b.firmware?.language === "arduino-cpp");
  const made = board && exportIno(project, board.id, { exportedAt: context.exportedAt, appVersion: context.version });
  if (!made || !made.ok) {
    io.err(t("error.noBoard"));
    return 1;
  }
  const target = resolve(io.cwd, flags.out ?? ".");
  for (const file of made.value.files) write(join(target, file.path), file.text, io, words);
  write(join(target, made.value.folder, "wiring.csv"), made.value.wiringCsv, io, words);
  return 0;
}
