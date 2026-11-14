/**
 * The entry page's state machine, pure: `step(state, event)` gives the next state and what the page must do (load the
 * engine, ask for a session, reload). `./index.ts` feeds it the person's presses and the engine's news and draws the
 * result. The engine loads only after a press (Enter or Open on this screen) and stays loaded after that.
 */
import type { BootStage } from '../../main';

export type Phase =
  /** The start page: what iynkware is, the device check, Enter. */
  | { readonly k: 'start' }
  /** Loading the engine for `then`, at `stage`. */
  | { readonly k: 'loading'; readonly stage: BootStage; readonly then: 'enter' | 'flat' }
  /** Loaded after the click's activation ran out: the next press of Enter asks for the session. */
  | { readonly k: 'armed' }
  /** A session was asked for and has not settled. */
  | { readonly k: 'entering' }
  | { readonly k: 'immersive' }
  /** The browser or the headset did not start the session. */
  | { readonly k: 'refused' }
  /** The session ended: `asked` when the person left from the menu, otherwise it ended on its own. */
  | { readonly k: 'ended'; readonly asked: boolean }
  /** The engine did not load; `offline` when the browser had no connection. */
  | { readonly k: 'failed'; readonly offline: boolean }
  /** The bench open on this screen, under the slim top bar. */
  | { readonly k: 'flat' };

export interface EntryState {
  readonly phase: Phase;
  /** The engine is booted (it never unloads). */
  readonly loaded: boolean;
}

export type EntryEvent =
  | { readonly type: 'enter' }
  | { readonly type: 'flat' }
  | { readonly type: 'back' }
  | { readonly type: 'stage'; readonly stage: BootStage }
  /** The engine is ready; `active` while the press's user activation still lasts. */
  | { readonly type: 'ready'; readonly active: boolean }
  | { readonly type: 'loadFailed'; readonly offline: boolean }
  /** `enter()` resolved. */
  | { readonly type: 'settled'; readonly ok: boolean }
  /** A session started: ours, or one the browser offered with its own button. */
  | { readonly type: 'sessionStart' }
  | { readonly type: 'sessionEnd'; readonly asked: boolean };

/** `load`: import and boot the engine; `enter`: call `Booted.enter()` now, inside the press; `reload`: reload the page. */
export type Effect = 'load' | 'enter' | 'reload';

export interface Step {
  readonly state: EntryState;
  readonly effect: Effect | null;
}

export const INITIAL: EntryState = { phase: { k: 'start' }, loaded: false };

const to = (state: EntryState, phase: Phase, effect: Effect | null = null, loaded = state.loaded): Step => ({ state: { phase, loaded }, effect });
const same = (state: EntryState): Step => ({ state, effect: null });

export function step(state: EntryState, ev: EntryEvent): Step {
  const { phase } = state;
  switch (ev.type) {
    case 'enter':
      if (phase.k === 'failed') return to(state, phase, 'reload');
      if (phase.k === 'immersive' || phase.k === 'entering') return same(state);
      if (phase.k === 'loading') return to(state, { ...phase, then: 'enter' });
      if (!state.loaded) return to(state, { k: 'loading', stage: 'project', then: 'enter' }, 'load');
      return to(state, { k: 'entering' }, 'enter');
    case 'flat':
      if (phase.k === 'failed') return to(state, phase, 'reload');
      if (phase.k === 'immersive' || phase.k === 'entering' || phase.k === 'flat') return same(state);
      if (phase.k === 'loading') return to(state, { ...phase, then: 'flat' });
      if (!state.loaded) return to(state, { k: 'loading', stage: 'project', then: 'flat' }, 'load');
      return to(state, { k: 'flat' });
    case 'back':
      return phase.k === 'flat' ? to(state, { k: 'start' }) : same(state);
    case 'stage':
      return phase.k === 'loading' ? to(state, { ...phase, stage: ev.stage }) : same(state);
    case 'ready':
      if (phase.k !== 'loading') return to(state, phase, null, true);
      if (phase.then === 'flat') return to(state, { k: 'flat' }, null, true);
      return ev.active ? to(state, { k: 'entering' }, 'enter', true) : to(state, { k: 'armed' }, null, true);
    case 'loadFailed':
      return phase.k === 'loading' ? to(state, { k: 'failed', offline: ev.offline }, null, false) : same(state);
    case 'settled':
      if (phase.k !== 'entering') return same(state);
      return ev.ok ? to(state, { k: 'immersive' }) : to(state, { k: 'refused' });
    case 'sessionStart':
      return to(state, { k: 'immersive' }, null, true);
    case 'sessionEnd':
      return phase.k === 'immersive' ? to(state, { k: 'ended', asked: ev.asked }) : same(state);
  }
}
