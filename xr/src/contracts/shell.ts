/**
 * The shell: where the person is in the app, the home panel, the one menu and app-level notices. It is what makes the
 * six pillars read as one app with one way to move between them: every pillar moves the person with `go` and reacts to
 * `place`, puts its home tiles and menu rows here instead of building its own, and says app-level things through
 * `notify`. Contract file: changes only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/shell/service.ts` (`createShellService`). The panels that draw it are the shell pillar's.
 */
import type { LocalizedText, ReadonlyValue, Unsubscribe } from './common';

/**
 * Where the person works, one at a time.
 *   bench  the workbench: build, run, learn, the scale steps up to 6x (pillars 1 to 4). Always offered; the default.
 *   room   the bench item at room size, on the floor (pillar 4).
 *   range  drones and robots at 1:1 in the room (pillar 5).
 */
export type Place = 'bench' | 'room' | 'range';

/** A tile on the home panel, put there by the pillar that owns what it opens. */
export interface HomeEntry {
  /** `learn/lessons`, `range/drones`, `learn/onboarding`. Adding an entry with an id already present replaces it. */
  readonly id: string;
  /**
   * `lessons` and `range` are home tiles. `onboarding` is what the shell hands a first entry to instead of opening home;
   * its owner calls `openHome()` when the person finishes or skips it.
   */
  readonly slot: 'lessons' | 'range' | 'onboarding';
  readonly title: LocalizedText;
  /** One short line under the title, such as "4 of 9 lessons". Re-add the entry to change it. */
  readonly detail?: LocalizedText;
  /** Runs when the tile is selected; the shell has closed home first. */
  open(): void;
}

/** A row in the one menu (palm button, rail Menu, controller stick click). */
export interface MenuItem {
  /** `scale/see-through`, `bench/bring-here`. Adding an item with an id already present replaces it. */
  readonly id: string;
  /** The menu's section: Bench, View, Tools. Home, Settings, Help and Leave headset mode are the shell's own. */
  readonly group: 'bench' | 'view' | 'tools';
  readonly label: LocalizedText;
  /** Present for a switch: the row shows on or off, and `run` flips it. Absent for an action, which closes the menu. */
  readonly toggle?: ReadonlyValue<boolean>;
  run(): void;
}

/** An app-level notice: an update is ready, storage is full, the hands are not seen. Not for bench events (the ticker). */
export interface Notice {
  /** One notice per id: a second `notify` with the same id replaces the first. */
  readonly id: string;
  readonly tone: 'info' | 'warn' | 'fail';
  readonly text: LocalizedText;
  /** At most one button on the notice. */
  readonly action?: { readonly label: LocalizedText; run(): void };
  /** Removed after this long; absent keeps it until the returned function runs or the person closes it. */
  readonly ms?: number;
}

export interface ShellService {
  /** Where the person is. Starts at `bench`. */
  readonly place: ReadonlyValue<Place>;
  /**
   * Moves the person to `place`. The shell closes its own panels and sets `place`; the owner of the place that is left
   * and of the place that is entered show, hide and fade their own content on the change (room size enters by a fade).
   * Returns false, and changes nothing, for a place nobody offers.
   */
  go(place: Place): boolean;
  /** A pillar that can run a place says so; the mode switch lists only offered places. `bench` is always offered. */
  offer(place: Place, owner: string): Unsubscribe;
  readonly offered: ReadonlyValue<readonly Place[]>;

  /** The home panel: continue the last project, new project, lessons, drones and robots, settings. Opens on entry. */
  readonly homeOpen: ReadonlyValue<boolean>;
  openHome(): void;
  closeHome(): void;

  addEntry(entry: HomeEntry): Unsubscribe;
  readonly entries: ReadonlyValue<readonly HomeEntry[]>;

  addMenuItem(item: MenuItem): Unsubscribe;
  readonly menuItems: ReadonlyValue<readonly MenuItem[]>;

  notify(notice: Notice): Unsubscribe;
  readonly notices: ReadonlyValue<readonly Notice[]>;
}
