/**
 * The sketch the Code window shows: the first board's firmware entry in the project document (`boards[].firmware`,
 * `sources[]`), else the first firmware source. Pure.
 */
import type { Project } from '@/project/generated/types';
import { planOf, type CodePlan } from './mapper';

export interface Sketch {
  readonly id: string;
  /** `sketch.ino`. */
  readonly path: string;
  readonly language: string;
  readonly content: string;
  /** Its lines, without the empty one after a final newline. */
  readonly lines: readonly string[];
  /** How the run is followed line by line, or null when it cannot be (no marker is shown). */
  readonly plan: CodePlan | null;
}

/** `LED_BUILTIN` on the boards whose sketches the mapper may follow: pin 13 on the Arduino Uno and Nano family. */
const BUILTIN_LED: Readonly<Record<string, number>> = { 'core.uno-r3': 13, 'core.uno-r4': 13, 'core.nano': 13 };

export function sketchOf(doc: Project): Sketch | null {
  const board = doc.boards[0];
  const entry = board?.firmware?.entry;
  const src = doc.sources.find((s) => s.id === entry) ?? doc.sources.find((s) => s.role === 'firmware');
  if (!src || src.content.trim() === '') return null;
  const lines = src.content.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const arduino = /arduino|c\+\+|cpp/i.test(src.language);
  const builtinLed = board ? BUILTIN_LED[board.definition.ref] : undefined;
  return {
    id: src.id,
    path: src.path,
    language: src.language,
    content: src.content,
    lines,
    plan: arduino ? planOf(src.content, builtinLed === undefined ? {} : { builtinLed }) : null,
  };
}
