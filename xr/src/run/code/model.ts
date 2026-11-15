/**
 * The bench's program, as plain functions over the document (tested without a world): what the Code window can edit, and
 * the one batch of ops that writes a whole new program (the window's Edit on a flat screen, the companion's `write_code`).
 *
 * The program is the entry source of the first board with firmware (the sim's `programOf`), else the first firmware
 * source. A board with no firmware yet (a blank project's Uno) gets one: a `source.add` and a `board.set` with the
 * language its part descriptor lists first (`software.environments`), so one undo takes both back.
 */
import { newId } from '@/core/ids';
import type { Firmware, Language } from '@/project/generated/types';
import { wholeFileOp } from '@/studio/code/sources';
import type { Descriptor, Op, Project } from '../../contracts/project';

type Board = Project['boards'][number];

export interface Program {
  /** The source shown and written, or null when the board has no firmware yet. */
  readonly sourceId: string | null;
  readonly boardId: string;
  readonly boardName: string;
  readonly path: string;
  readonly language: Language;
  readonly text: string;
}

/** The languages a board can be programmed in, from its descriptor; empty for a board that runs no program. */
export type LanguagesOf = (board: Board) => readonly string[];

const PROGRAM_LANGUAGES: ReadonlySet<string> = new Set<Language>(['arduino-cpp', 'micropython', 'python', 'verilog']);

/** A new program's file name and starting text, by language. */
const STARTER: Readonly<Record<Language, { path: string; text: string }>> = {
  'arduino-cpp': { path: 'sketch.ino', text: 'void setup() {\n}\n\nvoid loop() {\n}\n' },
  micropython: { path: 'main.py', text: '# Write your program here\n' },
  python: { path: 'main.py', text: '# Write your program here\n' },
  verilog: { path: 'top.v', text: 'module top();\nendmodule\n' },
};

/** `describe`-backed `LanguagesOf`: the descriptor's environments, in order. */
export function languagesFrom(describe: (ref: string, version?: string) => Descriptor | undefined): LanguagesOf {
  return (board) => describe(board.definition.ref, board.definition.version)?.software?.environments?.map((e) => e.language) ?? [];
}

const nameOf = (b: Board) => b.label ?? b.refdes ?? b.id;

/** The program the Code window edits, or null when no board on the bench can run one. */
export function programOf(doc: Project, languagesOf: LanguagesOf): Program | null {
  const coded = doc.boards.find((b) => b.firmware);
  if (coded?.firmware) {
    const src = doc.sources.find((s) => s.id === coded.firmware!.entry) ?? doc.sources.find((s) => coded.firmware!.sources.includes(s.id));
    if (src) return { sourceId: src.id, boardId: coded.id, boardName: nameOf(coded), path: src.path, language: coded.firmware.language, text: src.content };
  }
  for (const board of doc.boards) {
    const language = languagesOf(board).find((l) => PROGRAM_LANGUAGES.has(l)) as Language | undefined;
    if (!language) continue;
    const starter = STARTER[language];
    return { sourceId: null, boardId: board.id, boardName: nameOf(board), path: starter.path, language, text: starter.text };
  }
  return null;
}

/** A path for a new source that no other source has, ignoring case. */
function freePath(doc: Project, path: string): string {
  const taken = new Set(doc.sources.map((s) => s.path.toLowerCase()));
  if (!taken.has(path.toLowerCase())) return path;
  const dot = path.lastIndexOf('.');
  for (let i = 2; ; i++) {
    const p = `${path.slice(0, dot)}${i}${path.slice(dot)}`;
    if (!taken.has(p.toLowerCase())) return p;
  }
}

/**
 * The ops that make `text` the program: one whole-file `source.edit`, or for a board without firmware a `source.add`
 * plus the `board.set` that makes it the entry. An error string when there is nothing to write to, or nothing changes.
 */
export function writeProgramOps(doc: Project, text: string, languagesOf: LanguagesOf, newSourceId: () => string = () => newId('src')): Op[] | string {
  const p = programOf(doc, languagesOf);
  if (!p) return 'no board on the bench runs a program';
  const body = text.replace(/\r\n?/g, '\n');
  if (p.sourceId) {
    if (body === p.text) return 'the program is already that';
    return [wholeFileOp(p.sourceId, doc.revision, p.text.length, body)];
  }
  const id = newSourceId();
  const firmware: Firmware = { language: p.language, entry: id, sources: [id] };
  return [
    { k: 'source.add', source: { id, path: freePath(doc, p.path), language: p.language, role: 'firmware', board: p.boardId, content: body } },
    { k: 'board.set', id: p.boardId, firmware },
  ];
}
