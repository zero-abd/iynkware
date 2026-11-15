/**
 * Panels and tools that start closed and open from the menu (the calm default layout, owner 2026-11-14): each one is
 * a switch row in the menu, on or off, plus a value its pillar follows to show or hide it. The panel's own close
 * control turns the same switch off. The state is kept per world and id, so a panel rebuilt for another project
 * keeps it; nothing is open at the start.
 *
 *   const look = openable(app, { id: 'scale/look-inside', label: TITLE_TEXT });
 *   look.open.subscribe((on) => (on ? panel.open() : panel.close()));
 *   closeButton.onSelect = () => look.set(false);
 *
 * `available` hides the row while the thing cannot be opened (the drone design panel without a drone project).
 */
import type { XrApp } from '../../contracts/app';
import type { LocalizedText, ReadonlyValue, Unsubscribe } from '../../contracts/common';
import type { MenuItem } from '../../contracts/shell';
import { value, type Value } from '../value';

export interface Openable {
  /** Whether the person has it open. */
  readonly open: ReadonlyValue<boolean>;
  set(on: boolean): void;
  dispose(): void;
}

export interface OpenableOptions {
  /** The menu row's id (`scale/look-inside`); also the key of the open state. */
  readonly id: string;
  readonly label: LocalizedText;
  /** The menu section; `view` (with Tidy up) by default. */
  readonly group?: MenuItem['group'];
  /** Whether it can be opened now; the row shows only then. Always, by default. */
  readonly available?: ReadonlyValue<boolean>;
}

interface Shared {
  readonly state: Value<boolean>;
  users: number;
  offRow: Unsubscribe | null;
  offAvailable: Unsubscribe | null;
}

const perApp = new WeakMap<object, Map<string, Shared>>();

/** The open state of `id` in this app (closed until someone opens it). */
export function openState(app: Pick<XrApp, 'shell'>, id: string): Value<boolean> {
  return sharedOf(app, id).state;
}

function sharedOf(app: Pick<XrApp, 'shell'>, id: string): Shared {
  let map = perApp.get(app.shell);
  if (!map) {
    map = new Map();
    perApp.set(app.shell, map);
  }
  let s = map.get(id);
  if (!s) {
    s = { state: value(false), users: 0, offRow: null, offAvailable: null };
    map.set(id, s);
  }
  return s;
}

/** Registers a thing that starts closed and opens from its menu row; see the file comment. */
export function openable(app: Pick<XrApp, 'shell'>, o: OpenableOptions): Openable {
  const s = sharedOf(app, o.id);
  s.users++;
  if (s.users === 1) {
    const row = () => {
      if (s.offRow) return;
      s.offRow = app.shell.addMenuItem({ id: o.id, group: o.group ?? 'view', label: o.label, toggle: s.state, run: () => s.state.set(!s.state.value) });
    };
    const sync = () => {
      if (!o.available || o.available.value) row();
      else {
        s.offRow?.();
        s.offRow = null;
        s.state.set(false);
      }
    };
    sync();
    s.offAvailable = o.available ? o.available.subscribe(sync) : null;
  }
  let done = false;
  return {
    open: s.state,
    set: (on) => s.state.set(on),
    dispose() {
      if (done) return;
      done = true;
      s.users--;
      if (s.users > 0) return;
      s.offAvailable?.();
      s.offAvailable = null;
      s.offRow?.();
      s.offRow = null;
    },
  };
}
