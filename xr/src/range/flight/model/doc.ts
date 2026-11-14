/**
 * The bench lives in the project document, so every bench step is an op (`app.project.apply`) with undo: a
 * `domain.patch` on the `drone` domain under `ext['x-iynkware-bench']`. Stored with arrays and scalars only, so an
 * RFC 7396 merge patch of the whole value replaces it exactly (a null removes an optional key).
 */
import type { Op, Project } from '@/project/generated/types';
import { EMPTY_BENCH } from './bench';
import type { BenchState } from './types';

export const BENCH_EXT = 'x-iynkware-bench';

interface StoredBench {
  v: 1;
  parts: Array<[string, 0 | 1]>;
  plugged: boolean;
  fault?: string;
  smokeOk: boolean;
  motorOk: boolean;
  accOk: boolean;
  wireJobs: number;
  crossed: string[];
  esc: string[];
  wrongMotor?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function droneData(doc: Project): Record<string, unknown> | null {
  const d = (doc.domains as Record<string, { data?: unknown } | undefined> | undefined)?.drone?.data;
  return isRecord(d) ? d : null;
}

/** The bench state stored in the document, or an empty bench. */
export function benchOf(doc: Project): BenchState {
  const ext = droneData(doc)?.ext;
  const s = isRecord(ext) ? ext[BENCH_EXT] : undefined;
  if (!isRecord(s) || s.v !== 1) return EMPTY_BENCH;
  const placed: Record<string, 0 | 1> = {};
  if (Array.isArray(s.parts))
    for (const p of s.parts) if (Array.isArray(p) && typeof p[0] === 'string' && (p[1] === 0 || p[1] === 1)) placed[p[0]] = p[1];
  return {
    placed,
    plugged: s.plugged === true,
    fault: typeof s.fault === 'string' ? s.fault : null,
    smokeOk: s.smokeOk === true,
    motorOk: s.motorOk === true,
    accOk: s.accOk === true,
    wireJobs: typeof s.wireJobs === 'number' ? s.wireJobs : 0,
    crossed: strings(s.crossed),
    escReversed: strings(s.esc),
    wrongMotor: typeof s.wrongMotor === 'string' ? s.wrongMotor : null,
  };
}

const same = (a: BenchState, b: BenchState) => JSON.stringify(stored(a)) === JSON.stringify(stored(b));

function stored(st: BenchState): StoredBench {
  return {
    v: 1,
    parts: Object.entries(st.placed),
    plugged: st.plugged,
    ...(st.fault ? { fault: st.fault } : {}),
    smokeOk: st.smokeOk,
    motorOk: st.motorOk,
    accOk: st.accOk,
    wireJobs: st.wireJobs,
    crossed: [...st.crossed],
    esc: [...st.escReversed],
    ...(st.wrongMotor ? { wrongMotor: st.wrongMotor } : {}),
  };
}

/** The ops that store `next` in the document: none when it is what the document holds, or the doc has no drone domain. */
export function benchOps(doc: Project, next: BenchState): Op[] {
  if (!droneData(doc)) return [];
  if (same(benchOf(doc), next)) return [];
  const value: Record<string, unknown> = { ...stored(next) };
  if (!next.fault) value.fault = null;
  if (!next.wrongMotor) value.wrongMotor = null;
  return [{ k: 'domain.patch', domain: 'drone', patch: { ext: { [BENCH_EXT]: value } } }];
}
