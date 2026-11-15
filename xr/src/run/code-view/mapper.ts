/**
 * Which line of a sketch is running, read off the run rather than a debugger (#311, demo quality). Pure, so it is
 * tested on its own and against the inline sim.
 *
 * `planOf` reads a sketch and keeps it only when its timing can be told from one pin: a `loop()` of one statement per
 * line that writes one pin HIGH and LOW (in turn) with resolvable `delay`s between, and a `setup()` with nothing but
 * one-line statements. Blink and its variants qualify; anything with branches, loops, unknown delays or a toggle does
 * not, and gets no line marker (never a guessed one).
 *
 * `createTracker` follows the run from what the sim reports: each frame's time and that pin's level. A change of level
 * means the `digitalWrite` for that level ran since the last frame; otherwise the run is inside the `delay` that the
 * time since the last change falls in.
 *
 *   const plan = planOf(source, { builtinLed: 13 });
 *   const track = plan && createTracker(plan);
 *   const pos = track?.observe(frame.atNs, frame.pins[pinKeyOf(plan.pin, frame.pins)!]);   // pos.line: 1-based
 */

/** One line of the plan. `fromMs` is when it starts, from the start of its run of lines (the pre-edge part or a segment). */
export interface PlanStep {
  /** 1-based line number in the source. */
  readonly line: number;
  readonly kind: 'write' | 'delay' | 'instant';
  readonly fromMs: number;
  /** How long it takes: the delay, or 0. */
  readonly ms: number;
}

/** The lines from one write of the tracked pin up to the next: the write first, then what follows it in the loop. */
export interface Segment {
  /** The level this segment's write sets. */
  readonly level: 0 | 1;
  /** The write's line. */
  readonly write: number;
  readonly steps: readonly PlanStep[];
  /** Total delay, ms: when the next write runs, measured from this one. */
  readonly ms: number;
}

export interface CodePlan {
  /** The tracked pin as the sketch names it: `13`, or a board name such as `D1` or `GPIO4`. */
  readonly pin: string;
  /** The pin's level once `setup()` is done (LOW unless setup writes it). */
  readonly initial: 0 | 1;
  /** What runs from t = 0 until the first change of the pin: setup's delays, the loop's lines before it. */
  readonly pre: readonly PlanStep[];
  /** When the pin first changes, ms. */
  readonly firstEdgeMs: number;
  /** The segment that starts with each level's write. */
  readonly segments: Readonly<Record<0 | 1, Segment>>;
}

export interface PlanOptions {
  /** What `LED_BUILTIN` is on this board (13 on the Uno and Nano). Unknown: a sketch that uses it is not tracked. */
  readonly builtinLed?: number;
}

/** A segment shorter than this can change twice between two frames (30 a simulated second), so it is not tracked. */
export const MIN_SEGMENT_MS = 40;

/** The source with comments blanked out (newlines kept, so line numbers stay), strings left as they are. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const INT_TYPES = '(?:unsigned\\s+|signed\\s+)?(?:int|long|short|byte|word|size_t|u?int(?:8|16|32)_t|long\\s+long)';
const DECL = new RegExp(`^\\s*(?:static\\s+)?(const\\s+|constexpr\\s+)?(?:static\\s+)?${INT_TYPES}\\s+([A-Za-z_]\\w*)\\s*=\\s*([^;]+);`, 'gm');
const DEFINE = /^\s*#define\s+([A-Za-z_]\w*)\s+(\S+)\s*$/gm;

/** Global integer constants: `const int X = 13;`, `#define X 13`, and plain `int x = 13;` that nothing assigns again. */
export function constantsOf(code: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of code.matchAll(DEFINE)) out.set(m[1]!, m[2]!);
  for (const m of code.matchAll(DECL)) {
    const name = m[2]!;
    if (!m[1]) {
      // A plain variable counts only if nothing else writes it.
      const writes = new RegExp(`\\b${name}\\s*(?:[-+*/%|&^]?=(?!=)|\\+\\+|--)|(?:\\+\\+|--)\\s*${name}\\b`, 'g');
      if ((code.match(writes) ?? []).length > 1) continue;
    }
    out.set(name, m[3]!.trim());
  }
  return out;
}

const resolve = (expr: string, consts: Map<string, string>, depth = 0): string | null => {
  const e = expr.trim().replace(/^\((.*)\)$/, '$1').trim();
  if (depth > 6) return null;
  const n = /^(\d+)[uUlL]*$/.exec(e);
  if (n) return String(Number(n[1]));
  if (consts.has(e)) return resolve(consts.get(e)!, consts, depth + 1);
  return /^[A-Za-z_]\w*$/.test(e) ? e : null;
};

/** A pin expression as a pin name: `13`, `D1`, or null when it cannot be told. */
function pinOf(expr: string, consts: Map<string, string>, o: PlanOptions): string | null {
  const r = resolve(expr, consts);
  if (r === null) return null;
  if (r === 'LED_BUILTIN') return o.builtinLed === undefined ? null : String(o.builtinLed);
  if (/^\d+$/.test(r) || /^(?:D|A|GPIO|GP|IO|P[A-K])\d+$/.test(r)) return r;
  return null;
}

const msOf = (expr: string, consts: Map<string, string>): number | null => {
  const r = resolve(expr, consts);
  return r !== null && /^\d+$/.test(r) ? Number(r) : null;
};

/** The body of `void name()`: its lines, 1-based, between the braces. Null when absent or not one brace per line. */
function bodyOf(code: string, name: string): { from: number; to: number } | null {
  const m = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*(?:void)?\\s*\\)\\s*\\{`).exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) {
      const lineAt = (at: number) => code.slice(0, at).split('\n').length;
      const from = lineAt(open);
      const to = lineAt(i);
      // The braces' own lines must hold nothing else (one statement per line, so a line is a step).
      const eol = code.indexOf('\n', open);
      const afterOpen = code.slice(open + 1, eol < 0 ? code.length : eol);
      if (from === to || afterOpen.trim() !== '' || code.split('\n')[to - 1]!.trim() !== '}') return null;
      return { from: from + 1, to: to - 1 };
    }
  }
  return null;
}

type Stmt = { line: number; kind: 'write'; pin: string; level: 0 | 1 } | { line: number; kind: 'delay'; ms: number } | { line: number; kind: 'instant' };

const CONTROL = /^(?:if|else|for|while|do|switch|case|default|return|goto|break|continue)\b/;
/** Calls that wait on the world (or run a loop) and so would break the timing. */
const BLOCKING = /\b(?:pulseIn|pulseInLong|while|for|readString|readStringUntil|readBytes|parseInt|parseFloat|find|findUntil)\b/;

/** One body line as a step, or null when it is not one plain statement this mapper understands. */
function stmtOf(text: string, line: number, consts: Map<string, string>, o: PlanOptions): Stmt | 'skip' | null {
  const t = text.trim();
  if (t === '') return 'skip';
  if (CONTROL.test(t) || /[{}]/.test(t) || !t.endsWith(';') || t.indexOf(';') !== t.length - 1 || BLOCKING.test(t)) return null;
  const w = /^digitalWrite\s*\((.+),\s*(HIGH|LOW|1|0|true|false)\s*\)\s*;$/.exec(t);
  if (w) {
    const pin = pinOf(w[1]!, consts, o);
    if (pin === null) return null;
    return { line, kind: 'write', pin, level: w[2] === 'HIGH' || w[2] === '1' || w[2] === 'true' ? 1 : 0 };
  }
  if (/^digitalWrite\b/.test(t)) return null;
  const d = /^delay\s*\((.+)\)\s*;$/.exec(t);
  if (d) {
    const ms = msOf(d[1]!, consts);
    return ms === null ? null : { line, kind: 'delay', ms };
  }
  if (/\bdelay\s*\(/.test(t)) return null;
  // Any other one-line call or assignment runs in no time worth showing (`Serial.println`, `pinMode`).
  return { line, kind: 'instant' };
}

function stmtsOf(code: string, body: { from: number; to: number }, consts: Map<string, string>, o: PlanOptions): Stmt[] | null {
  const lines = code.split('\n');
  const out: Stmt[] = [];
  for (let n = body.from; n <= body.to; n++) {
    const s = stmtOf(lines[n - 1] ?? '', n, consts, o);
    if (s === null) return null;
    if (s !== 'skip') out.push(s);
  }
  return out;
}

/** The plan of a sketch, or null when the line that runs cannot be told from one pin (see the file comment). */
export function planOf(source: string, o: PlanOptions = {}): CodePlan | null {
  const code = stripComments(source);
  const consts = constantsOf(code);
  const setupBody = bodyOf(code, 'setup');
  const loopBody = bodyOf(code, 'loop');
  if (!setupBody || !loopBody) return null;
  const setup = stmtsOf(code, setupBody, consts, o);
  const loop = stmtsOf(code, loopBody, consts, o);
  if (!setup || !loop) return null;

  const firstWrite = loop.find((s) => s.kind === 'write');
  if (!firstWrite || firstWrite.kind !== 'write') return null;
  const pin = firstWrite.pin;
  type Write = Extract<Stmt, { kind: 'write' }>;
  const isTracked = (s: Stmt): s is Write => s.kind === 'write' && s.pin === pin;
  const writes = loop.filter(isTracked);
  if (writes.length !== 2 || writes[0]!.level === writes[1]!.level) return null;

  let initial: 0 | 1 = 0;
  for (const s of setup) if (isTracked(s)) initial = s.level;

  // Each write's segment: from it, round the loop, to the next tracked write.
  const segOf = (w: Write): Segment => {
    const start = loop.indexOf(w);
    const steps: PlanStep[] = [{ line: w.line, kind: 'write', fromMs: 0, ms: 0 }];
    let t = 0;
    for (let k = 1; k < loop.length; k++) {
      const s = loop[(start + k) % loop.length]!;
      if (s.kind === 'write' && s.pin === pin) break;
      const ms = s.kind === 'delay' ? s.ms : 0;
      steps.push({ line: s.line, kind: s.kind === 'write' ? 'instant' : s.kind, fromMs: t, ms });
      t += ms;
    }
    return { level: w.level, write: w.line, steps, ms: t };
  };
  const a = segOf(writes[0]!);
  const b = segOf(writes[1]!);
  if (a.ms < MIN_SEGMENT_MS || b.ms < MIN_SEGMENT_MS) return null;

  // From t = 0: setup, then the loop up to the first write that changes the pin.
  const pre: PlanStep[] = [];
  let t = 0;
  const push = (s: Stmt) => {
    const ms = s.kind === 'delay' ? s.ms : 0;
    pre.push({ line: s.line, kind: s.kind === 'write' ? 'instant' : s.kind, fromMs: t, ms });
    t += ms;
  };
  for (const s of setup) push(s);
  const edgeAt = loop.indexOf(writes[0]!.level !== initial ? writes[0]! : writes[1]!);
  for (let k = 0; k < edgeAt; k++) push(loop[k]!);
  return { pin, initial, pre, firstEdgeMs: t, segments: { [a.level]: a, [b.level]: b } as Record<0 | 1, Segment> };
}

/** The frame's key for a sketch pin: `13` is `D13` on an Uno header, `GPIO13` on an ESP32. Null when the frame has none. */
export function pinKeyOf(pin: string, pins: Readonly<Record<string, unknown>>): string | null {
  const tries = /^\d+$/.test(pin) ? [`D${pin}`, pin, `GPIO${pin}`, `IO${pin}`, `GP${pin}`] : [pin];
  return tries.find((k) => k in pins) ?? null;
}

/** Where the run is in the sketch. */
export interface CodePosition {
  /** The line to mark, 1-based; null when nothing has run yet or the run cannot be placed. */
  readonly line: number | null;
  /** The pin's write that ran since the last frame (its line is `line`), with the level it set. */
  readonly wrote: { readonly line: number; readonly level: 0 | 1 } | null;
  /** The delay the run is waiting in, and how far into it. */
  readonly delay: { readonly line: number; readonly elapsedMs: number; readonly ms: number } | null;
}

export const NOWHERE: CodePosition = { line: null, wrote: null, delay: null };

export interface CodeTracker {
  /** Feeds one frame: its simulated time and the tracked pin's level (`0`, `1`, or anything else for unknown). */
  observe(atNs: number, level: unknown): CodePosition;
  /** Back to the start of a run (a stop, a new load). */
  reset(): void;
  readonly position: CodePosition;
}

/** The step the time `ms` falls in, among `steps` from `from` on: the delay running then, or the last delay begun. */
function delayAt(steps: readonly PlanStep[], ms: number): PlanStep | null {
  let found: PlanStep | null = null;
  for (const s of steps) {
    if (s.kind !== 'delay') continue;
    if (s.fromMs <= ms) found = s;
    if (ms < s.fromMs + s.ms) break;
  }
  return found;
}

const inDelay = (s: PlanStep | null, ms: number): CodePosition['delay'] =>
  s ? { line: s.line, elapsedMs: Math.max(0, Math.min(s.ms, Math.round(ms - s.fromMs))), ms: s.ms } : null;

export function createTracker(plan: CodePlan): CodeTracker {
  let lastNs = 0;
  let level: 0 | 1 = plan.initial;
  /** When the pin last changed, ns; null before the first change. */
  let edgeNs: number | null = null;
  let position: CodePosition = NOWHERE;

  const reset = () => {
    lastNs = 0;
    level = plan.initial;
    edgeNs = null;
    position = NOWHERE;
  };

  return {
    get position() {
      return position;
    },
    reset,
    observe(atNs, raw) {
      if (atNs < lastNs) reset();
      if (raw !== 0 && raw !== 1) {
        lastNs = Math.max(lastNs, atNs);
        return (position = NOWHERE);
      }
      const now = raw;
      if (now !== level) {
        // When it changed: where the plan says, if that lies since the last frame (exact under Step); else now.
        const predicted = edgeNs === null ? plan.firstEdgeMs * 1e6 : edgeNs + plan.segments[level].ms * 1e6;
        edgeNs = predicted >= lastNs && predicted <= atNs ? predicted : atNs;
        level = now;
        lastNs = atNs;
        const seg = plan.segments[now];
        const d = delayAt(seg.steps, (atNs - edgeNs) / 1e6);
        return (position = { line: seg.write, wrote: { line: seg.write, level: now }, delay: inDelay(d, (atNs - edgeNs) / 1e6) });
      }
      lastNs = atNs;
      if (atNs === 0) return (position = NOWHERE);
      if (edgeNs === null) {
        // Before the first change: setup's delays and the loop's lines before its first write.
        const d = delayAt(plan.pre, atNs / 1e6);
        return (position = d ? { line: d.line, wrote: null, delay: inDelay(d, atNs / 1e6) } : NOWHERE);
      }
      const seg = plan.segments[level];
      const ms = (atNs - edgeNs) / 1e6;
      const d = delayAt(seg.steps, ms);
      return (position = d ? { line: d.line, wrote: null, delay: inDelay(d, ms) } : { line: seg.write, wrote: null, delay: null });
    },
  };
}
