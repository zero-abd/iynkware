/**
 * Pose observations: what the person looks at (the head ray), what is in or near each hand, and a dwell when they stay
 * on one thing with no action for a while (stuck or hesitating). Pure over sampled poses and target points, so it runs
 * headless in tests; coach/index.ts samples `app.input` and the camera a few times a second and pushes what this
 * returns into the coach.
 *
 * Never a stream: a view (look, left, right) is reported once it has held for `settleMs`, only when it differs from
 * the last one reported, at most one per `gapMs` (the newest view wins), and never for an empty view. A dwell goes out
 * once per episode. Gaze and reach keep their current target a little longer than they take a new one (hysteresis), so
 * a head resting between two parts does not flicker.
 */
import type { Vec3 } from '../../contracts/common';
import type { Hand } from '../../contracts/input';
import type { Observation } from './coach';

/** Something the person may look at or reach for: `ref` as in `Observation.refs`, `name` short English. */
export interface PoseTarget {
  readonly ref: string;
  readonly name: string;
  /** World centre, metres. */
  readonly at: Vec3;
}

export interface PoseSample {
  /** The head ray (camera position and forward, unit), or null when not tracked. */
  readonly head: { readonly origin: Vec3; readonly dir: Vec3 } | null;
  /** Pinch point or grip centre per hand, or null when untracked. */
  readonly hands: Readonly<Record<Hand, Vec3 | null>>;
  /** The ref each hand is holding (a grab in progress), or null. */
  readonly held: Readonly<Record<Hand, string | null>>;
  readonly targets: readonly PoseTarget[];
}

export interface HandView {
  readonly ref: string;
  readonly name: string;
  readonly holding: boolean;
}
export interface PoseView {
  readonly look: PoseTarget | null;
  readonly left: HandView | null;
  readonly right: HandView | null;
}

export interface PoseOptions {
  /** A view must hold this long before it is reported. */
  settleMs?: number;
  /** At most one pose observation per this. */
  gapMs?: number;
  /** Looking at the same thing with no action for this long is a dwell. */
  dwellMs?: number;
  /** Gaze cone half angle, radians. */
  cone?: number;
  /** How far gaze reaches, metres. */
  far?: number;
  /** A hand within this of a target is near it, metres. */
  reach?: number;
}

export const SETTLE_MS = 800;
export const POSE_GAP_MS = 5000;
export const DWELL_MS = 20_000;
const CONE = (8 * Math.PI) / 180;
const FAR = 3;
const REACH = 0.12;
/** The current target is kept until it leaves this many times the cone or the reach. */
const KEEP = 1.5;
/** Within this, a target counts as on the ray whatever the angle (small parts close up), metres. */
const NEAR_RAY = 0.03;

const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));

/**
 * The target closest to the head ray within the cone (by angle, a nearer one winning a tie), or null. `prev` is kept
 * while it stays within `KEEP` times the cone.
 */
export function gazeTarget(head: PoseSample['head'], targets: readonly PoseTarget[], prev: string | null = null, cone = CONE, far = FAR): PoseTarget | null {
  if (!head) return null;
  let best: PoseTarget | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const v = sub(t.at, head.origin);
    const along = dot(v, head.dir);
    if (along <= 0.05 || along > far) continue;
    const off = Math.sqrt(Math.max(0, dot(v, v) - along * along));
    const angle = off <= NEAR_RAY ? 0 : Math.atan2(off - NEAR_RAY, along);
    const limit = t.ref === prev ? cone * KEEP : cone;
    if (angle > limit) continue;
    // The kept target wins while it is in its wider cone, so a slight drift does not hand gaze to a neighbour.
    const score = t.ref === prev ? -1 : angle + along * 1e-3;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** The target nearest `p` within `reach` (`prev` kept within `KEEP` times it), or null. */
export function nearTarget(p: Vec3 | null, targets: readonly PoseTarget[], prev: string | null = null, reach = REACH): PoseTarget | null {
  if (!p) return null;
  let best: PoseTarget | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const d = len(sub(t.at, p));
    if (d > (t.ref === prev ? reach * KEEP : reach)) continue;
    const score = t.ref === prev ? -1 : d;
    if (score < bestD) {
      best = t;
      bestD = score;
    }
  }
  return best;
}

const handText = (hand: Hand, v: HandView | null) => (v ? `${hand} hand ${v.holding ? 'holding' : 'near'} ${v.name}` : null);

/** One compact English line for a view, or '' when it is empty. */
export function describePose(v: PoseView): string {
  return [v.look ? `looking at ${v.look.name}` : null, handText('left', v.left), handText('right', v.right)].filter(Boolean).join('; ');
}

const refsOf = (v: PoseView) => [...new Set([v.look?.ref, v.left?.ref, v.right?.ref].filter((r): r is string => !!r))];
const keyOf = (v: PoseView) => `${v.look?.ref ?? ''}|${v.left ? `${v.left.holding ? 'h' : 'n'}:${v.left.ref}` : ''}|${v.right ? `${v.right.holding ? 'h' : 'n'}:${v.right.ref}` : ''}`;
const isEmpty = (v: PoseView) => !v.look && !v.left && !v.right;

export type PoseObservation = Omit<Observation, 'at'>;

export interface PoseWatcher {
  /** Takes one sample; returns the observation to push, if any. */
  sample(s: PoseSample): PoseObservation | null;
  /** The person did something (an action, a select or grab, a project or lab change): no dwell until they settle again. */
  activity(): void;
  /** The view of the last sample. */
  readonly view: PoseView;
}

export function createPoseWatcher(now: () => number, opts: PoseOptions = {}): PoseWatcher {
  const settle = opts.settleMs ?? SETTLE_MS;
  const gap = opts.gapMs ?? POSE_GAP_MS;
  const dwell = opts.dwellMs ?? DWELL_MS;
  const cone = opts.cone ?? CONE;
  const far = opts.far ?? FAR;
  const reach = opts.reach ?? REACH;

  let view: PoseView = { look: null, left: null, right: null };
  let key = keyOf(view);
  let since = now();
  let reported = key;
  let lastReport = -Infinity;
  let lookRef: string | null = null;
  let lookSince = now();
  let lastActivity = -Infinity;
  let dwellSent = false;

  const hand = (h: Hand, s: PoseSample, prev: HandView | null): HandView | null => {
    const held = s.held[h];
    if (held) {
      const t = s.targets.find((x) => x.ref === held);
      return { ref: held, name: t?.name ?? held.replace(/^[a-z]+:/, ''), holding: true };
    }
    const t = nearTarget(s.hands[h], s.targets, prev && !prev.holding ? prev.ref : null, reach);
    return t ? { ref: t.ref, name: t.name, holding: false } : null;
  };

  return {
    get view() {
      return view;
    },
    activity() {
      lastActivity = now();
      dwellSent = false;
    },
    sample(s) {
      const t = now();
      const look = gazeTarget(s.head, s.targets, view.look?.ref ?? null, cone, far);
      view = { look, left: hand('left', s, view.left), right: hand('right', s, view.right) };
      const k = keyOf(view);
      if (k !== key) {
        key = k;
        since = t;
      }
      if ((look?.ref ?? null) !== lookRef) {
        lookRef = look?.ref ?? null;
        lookSince = t;
        dwellSent = false;
      }

      // Dwell: on one thing, no action, for `dwell`. Once per episode; it is the one pose line that skips the gap.
      if (look && !dwellSent && t - Math.max(lookSince, lastActivity) >= dwell) {
        dwellSent = true;
        lastReport = t;
        reported = key;
        const secs = Math.round((t - Math.max(lookSince, lastActivity)) / 1000);
        return { kind: 'dwell', text: `dwell ${secs} s with no action: ${describePose(view)} (may be stuck)`, refs: refsOf(view) };
      }

      if (t - since < settle || key === reported || t - lastReport < gap) return null;
      reported = key;
      if (isEmpty(view)) return null;
      lastReport = t;
      return { kind: 'pose', text: describePose(view), refs: refsOf(view) };
    },
  };
}
