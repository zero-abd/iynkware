/**
 * The shell service (contracts/shell.ts): plain observable state and registries. The panels that draw it (home, menu,
 * notices, the mode switch) are the shell's sub-modules; this file holds no three.js so it can be tested in Node.
 */
import type { Unsubscribe } from '../contracts/common';
import type { HomeEntry, MenuItem, Notice, Place, ShellService } from '../contracts/shell';
import { value } from '../ui/value';

/** A list keyed by `id`: adding an id already present replaces it in place; the returned function removes that one. */
function registry<T extends { readonly id: string }>() {
  const list = value<readonly T[]>([]);
  const add = (item: T): Unsubscribe => {
    const at = list.value.findIndex((x) => x.id === item.id);
    list.set(at < 0 ? [...list.value, item] : list.value.map((x, i) => (i === at ? item : x)));
    return () => {
      if (list.value.includes(item)) list.set(list.value.filter((x) => x !== item));
    };
  };
  return { list, add };
}

export function createShellService(opts: { setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout } = {}): ShellService {
  const later = opts.setTimeout ?? globalThis.setTimeout;
  const cancel = opts.clearTimeout ?? globalThis.clearTimeout;
  const place = value<Place>('bench');
  const homeOpen = value(false);
  const offers = value<ReadonlyArray<{ place: Place; owner: string }>>([]);
  const offered = value<readonly Place[]>(['bench']);
  const syncOffered = () => {
    const next: Place[] = ['bench'];
    for (const p of ['room', 'range'] as const) if (offers.value.some((o) => o.place === p)) next.push(p);
    if (next.join() !== offered.value.join()) offered.set(next);
    // A place whose last owner went away cannot be stayed in.
    if (!next.includes(place.value)) place.set('bench');
  };
  const entries = registry<HomeEntry>();
  const menu = registry<MenuItem>();
  const notices = registry<Notice>();

  return {
    place,
    go(next) {
      if (!offered.value.includes(next)) return false;
      homeOpen.set(false);
      place.set(next);
      return true;
    },
    offer(p, owner) {
      if (p === 'bench') return () => undefined;
      const entry = { place: p, owner };
      offers.set([...offers.value, entry]);
      syncOffered();
      return () => {
        if (!offers.value.includes(entry)) return;
        offers.set(offers.value.filter((o) => o !== entry));
        syncOffered();
      };
    },
    offered,
    homeOpen,
    openHome: () => homeOpen.set(true),
    closeHome: () => homeOpen.set(false),
    addEntry: entries.add,
    entries: entries.list,
    addMenuItem: menu.add,
    menuItems: menu.list,
    notify(notice) {
      const remove = notices.add(notice);
      if (notice.ms === undefined) return remove;
      const timer = later(remove, notice.ms);
      return () => {
        cancel(timer);
        remove();
      };
    },
    notices: notices.list,
  };
}
