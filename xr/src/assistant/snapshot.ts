/**
 * The bench as a co-builder sees it (contracts/assistant.ts `BenchSnapshot`): plain JSON, small enough to send to a
 * model. Pure: built from the document and the app's state, read once per proposal.
 */
import type {
  BenchSnapshot,
  FindingSummary,
  LessonSummary,
  SnapshotNet,
  SnapshotPart,
  SnapshotSource,
  SnapshotWire,
} from '../contracts/assistant';
import { pickText, type Lang } from '../contracts/common';
import type { LessonGuideState } from '../contracts/lesson';
import type { Project } from '../contracts/project';
import type { Finding, RunState } from '../contracts/sim';

/** Source text is cut here: enough for a model to read a sketch, not a library. */
export const SOURCE_CHARS = 4000;

export interface SnapshotInput {
  readonly doc: Project;
  readonly lang: Lang;
  readonly selection?: readonly string[];
  readonly run?: RunState;
  /** Simulated time of the last frame, ns. */
  readonly atNs?: number | null;
  readonly findings?: readonly Finding[];
  readonly guide?: LessonGuideState | null;
}

type Scalar = string | number | boolean | null;
type View = Project['views'][number];
type WireEnd = NonNullable<View['wires']>[number]['from'];

const pinKey = (c: string, p: string) => `${c}.${p}`;

const endKey = (end: WireEnd): string =>
  end.kind === 'pin' ? pinKey(end.c, end.p) : end.kind === 'hole' ? pinKey(end.surface, end.hole) : `junction:${end.id}`;

/** The breadboard view the bench lays out: the first breadboard view, as `xr/src/bench/space.ts` takes it. */
export const benchView = (doc: Project): View | undefined => doc.views.find((v) => v.kind === 'breadboard');

function resolvedParams(doc: Project, params: Record<string, unknown> | undefined): Record<string, Scalar> | undefined {
  if (!params || Object.keys(params).length === 0) return undefined;
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(params)) {
    const bound = v && typeof v === 'object' && 'param' in v ? doc.parameters.find((p) => p.id === (v as { param: string }).param)?.value : v;
    out[k] = typeof bound === 'string' || typeof bound === 'number' || typeof bound === 'boolean' ? bound : null;
  }
  return out;
}

function parts(doc: Project, view: View | undefined): SnapshotPart[] {
  const at = new Map((view?.placements ?? []).map((p) => [p.c, p]));
  const one = (kind: SnapshotPart['kind'], e: Project['boards'][number] | Project['components'][number]): SnapshotPart => {
    const p = at.get(e.id);
    const params = resolvedParams(doc, e.params as Record<string, unknown> | undefined);
    const legs = p?.legs ? Object.fromEntries(Object.entries(p.legs).filter((x): x is [string, string] => typeof x[1] === 'string')) : undefined;
    return {
      id: e.id,
      refdes: e.refdes,
      kind,
      def: `${e.definition.ref}@${e.definition.version}`,
      ...(params && { params }),
      ...(p && {
        at: { xMm: p.x_mm, yMm: p.y_mm, rotationDeg: p.rotation_deg ?? 0, ...(legs && Object.keys(legs).length > 0 && { legs }) },
      }),
    };
  };
  return [...doc.boards.map((b) => one('board', b)), ...doc.components.map((c) => one('component', c))];
}

const nets = (doc: Project): SnapshotNet[] =>
  doc.nets.map((n) => ({
    id: n.id,
    ...(n.name !== undefined && { name: n.name }),
    ...(n.class !== undefined && { class: n.class }),
    pins: n.connections.map((c) => pinKey(c.c, c.p)),
  }));

const wires = (view: View | undefined): SnapshotWire[] =>
  (view?.wires ?? []).map((w) => ({ id: w.id, from: endKey(w.from), to: endKey(w.to), net: w.net, ...(w.color && { color: w.color }) }));

const sources = (doc: Project): SnapshotSource[] =>
  doc.sources.map((s) => {
    const text = typeof s.content === 'string' ? s.content : '';
    return { id: s.id, path: s.path, language: s.language, text: text.slice(0, SOURCE_CHARS), truncated: text.length > SOURCE_CHARS };
  });

const finding = (f: Finding): FindingSummary => ({
  rule: f.ruleId,
  severity: f.severity,
  key: f.messageKey,
  args: { ...f.args },
  targets: f.targets.map((t) => (t.kind === 'pin' && t.pin ? `pin:${pinKey(t.id, t.pin)}` : `${t.kind}:${t.id}`)),
});

function lesson(guide: LessonGuideState | null | undefined, lang: Lang): LessonSummary | null {
  if (!guide) return null;
  const step = guide.steps[guide.current];
  return {
    lessonId: guide.lessonId,
    title: pickText(guide.title, lang),
    step: guide.current,
    steps: guide.steps.length,
    text: step ? pickText(step.text, lang) : '',
    done: guide.done,
  };
}

export function snapshotOf(input: SnapshotInput): BenchSnapshot {
  const { doc, lang } = input;
  const view = benchView(doc);
  return {
    v: 1,
    lang,
    project: {
      id: doc.id,
      title: doc.meta.title,
      revision: doc.revision,
      parts: parts(doc, view),
      surface: view?.surface ?? null,
      nets: nets(doc),
      wires: wires(view),
      sources: sources(doc),
    },
    selection: [...(input.selection ?? [])],
    run: { state: input.run ?? 'unloaded', atMs: input.atNs == null ? null : input.atNs / 1e6 },
    findings: (input.findings ?? []).map(finding),
    lesson: lesson(input.guide, lang),
  };
}
