/**
 * Moving a "Build it with me" session several steps at once (`go_to_step`, `stop_steps`): forward by performing the
 * proposed step (the companion's carry, one undo entry each), back by the co-builder's own undo, until the session
 * shows the step asked for. A walk runs in the background so the person can still talk: the tool answers at once, and a
 * new walk or `stop_steps` ends the one before it at the step it has reached.
 *
 * Steps are counted from 1: "step N" is the step shown next, so N - 1 steps are done; the start is step 1, and the end
 * is the session's own "done". Pure over `CoBuildSession`: tested headless.
 */
import type { CoBuildSession } from '../../contracts/assistant';

/** Where to go: the start, the end, step N (shown next), or N steps forward (positive) or back (negative). */
export type StepTarget = { readonly to: 'start' | 'end' } | { readonly step: number } | { readonly by: number };

const IDLE_MS = 50;
/** How long a walk waits for a session that is thinking or performing before it gives up (a stuck plan), ms. */
const MAX_IDLE_MS = 20_000;
/** At most this many moves per walk: far more than any template has steps. */
const MAX_MOVES = 200;

/** The walk each session is on: a new walk replaces the token, and the old one stops at its next check. */
const walks = new WeakMap<CoBuildSession, object>();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The step the session shows now, from 1, or null once it is done. */
export function stepNow(s: CoBuildSession): number | null {
  const st = s.state.value;
  return st.status === 'done' ? null : st.performed.length + 1;
}

/** How many steps must be done for `target`; `end` is Infinity (until the session is done). */
export function doneFor(s: CoBuildSession, target: StepTarget): number {
  const done = s.state.value.performed.length;
  if ('to' in target) return target.to === 'start' ? 0 : Infinity;
  if ('step' in target) return Math.max(0, Math.floor(target.step) - 1);
  return Math.max(0, done + Math.trunc(target.by));
}

/** True while a walk is moving this session. */
export const walking = (s: CoBuildSession): boolean => walks.has(s);

/** Ends the walk this session is on, at the step it has reached. */
export function stopWalk(s: CoBuildSession): boolean {
  return walks.delete(s);
}

/**
 * Walks the session until `want` steps are done (Infinity: until it is done), or the walk is replaced or stopped, or a
 * move does nothing (a refused step, an undo with nothing left). Resolves with the steps done when it stopped.
 */
export async function walkTo(s: CoBuildSession, want: number): Promise<number> {
  const token = {};
  walks.set(s, token);
  const mine = () => walks.get(s) === token;
  let idle = 0;
  try {
    for (let moves = 0; moves < MAX_MOVES && mine(); ) {
      const st = s.state.value;
      const done = st.performed.length;
      if (done === want || st.status === 'stopped' || st.status === 'failed') break;
      const forward = done < want;
      if (forward && st.status === 'done') break;
      const ready = forward ? st.status === 'proposing' && !!st.current : st.status === 'proposing' || st.status === 'done';
      if (!ready) {
        // thinking about the next step, or performing one somebody else accepted: wait for it
        if ((idle += IDLE_MS) > MAX_IDLE_MS) break;
        await sleep(IDLE_MS);
        continue;
      }
      idle = 0;
      moves++;
      if (forward) await s.accept();
      else await s.undo();
      const after = s.state.value.performed.length;
      if (forward ? after <= done && s.state.value.status !== 'thinking' : after >= done) break;
    }
  } finally {
    if (mine()) walks.delete(s);
  }
  return s.state.value.performed.length;
}
