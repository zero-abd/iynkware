/**
 * The analog readouts the pillar draws from (current flow, node voltages, the inspector's live values), through one
 * feed per sim bridge. `SimBridge.watchAnalog` keeps one watch and a later call replaces the earlier one, and `load`
 * forgets it, so the sub-modules never call it themselves: each says what it wants here, the feed sends the union and
 * sends it again after every load, and frames' deltas are laid over the last state with iynk's `mergeAnalog`.
 *
 * Usage:
 *   const feed = analogFeed(app);
 *   const off = feed.want('scale/flow', { volts: 'all', amps: [], pinAmps: true, waves: [] });
 *   feed.onChange((view) => ...);    // view.volts by net id, view.pinAmps by part then pin, view.parts health
 */
import { mergeAnalog, type AnalogView } from '@/studio/run/analog';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { AnalogWatch, RunState, SimBridge, SimFrame } from '../../contracts/sim';

export type { AnalogView };

export interface AnalogFeed {
  /** Asks for these values while the returned function is not called. Owners' watches are merged. */
  want(owner: string, watch: AnalogWatch): Unsubscribe;
  /** The newest analog state of the run, or null before the first analog frame of a load. */
  readonly view: AnalogView | null;
  /** After every frame that carried analog values, and with null when a run ends or a new one loads. */
  onChange(fn: (view: AnalogView | null) => void): Unsubscribe;
  /** The watch sent now: the union of every owner's. */
  readonly watch: AnalogWatch;
}

const NONE: AnalogWatch = { volts: [], amps: [], pinAmps: false, waves: [] };

/** The union of several watches: `all` wins, lists are merged, `pinAmps` if any asks. */
export function mergeWatches(watches: Iterable<AnalogWatch>): AnalogWatch {
  let volts: 'all' | Set<string> = new Set();
  let amps: 'all' | Set<string> = new Set();
  let pinAmps = false;
  const waves = new Set<string>();
  for (const w of watches) {
    if (w.volts === 'all') volts = 'all';
    else if (volts !== 'all') for (const v of w.volts) volts.add(v);
    if (w.amps === 'all') amps = 'all';
    else if (amps !== 'all') for (const a of w.amps) amps.add(a);
    pinAmps ||= w.pinAmps;
    for (const id of w.waves) waves.add(id);
  }
  return {
    volts: volts === 'all' ? 'all' : [...volts].sort(),
    amps: amps === 'all' ? 'all' : [...amps].sort(),
    pinAmps,
    waves: [...waves].sort(),
  };
}

const isEmpty = (w: AnalogWatch) => w.volts !== 'all' && w.volts.length === 0 && w.amps !== 'all' && w.amps.length === 0 && !w.pinAmps && w.waves.length === 0;
const LIVE: readonly RunState[] = ['idle', 'running', 'paused'];
/** A frame without analog values while values are wanted means the watch was lost; send it again at most this often. */
const RESEND_MS = 500;

const feeds = new WeakMap<SimBridge, AnalogFeed>();

/** The pillar's one feed for `app.sim`. */
export function analogFeed(app: Pick<XrApp, 'sim'>, now: () => number = () => performance.now()): AnalogFeed {
  const sim = app.sim;
  const existing = feeds.get(sim);
  if (existing) return existing;

  const owners = new Map<string, AnalogWatch>();
  const fns = new Set<(view: AnalogView | null) => void>();
  let watch: AnalogWatch = NONE;
  let view: AnalogView | null = null;
  let lastSend = -Infinity;

  const emit = () => {
    for (const fn of [...fns]) {
      try {
        fn(view);
      } catch (err) {
        console.error('[scale] analog listener threw', err);
      }
    }
  };
  const send = () => {
    if (!LIVE.includes(sim.state)) return;
    lastSend = now();
    // The bridge rejects while nothing is loaded; the next state change sends again.
    void sim.watchAnalog(watch).catch(() => undefined);
  };
  const recompute = () => {
    const next = mergeWatches(owners.values());
    if (JSON.stringify(next) === JSON.stringify(watch)) return;
    watch = next;
    send();
  };

  sim.onState((s) => {
    if (!LIVE.includes(s)) {
      if (view !== null) {
        view = null;
        emit();
      }
      return;
    }
    if (!isEmpty(watch)) send();
  });
  sim.onFrame((f: SimFrame) => {
    if (!f.analog) {
      if (!isEmpty(watch) && now() - lastSend > RESEND_MS) send();
      return;
    }
    view = mergeAnalog(f.analog.full ? null : view, f.analog);
    emit();
  });

  const feed: AnalogFeed = {
    want(owner, w) {
      owners.set(owner, w);
      recompute();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        if (owners.get(owner) === w) owners.delete(owner);
        recompute();
      };
    },
    get view() {
      return view;
    },
    get watch() {
      return watch;
    },
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
  feeds.set(sim, feed);
  return feed;
}
