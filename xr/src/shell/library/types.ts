/**
 * The project library the shell's panels code against: projects kept between sessions (iynk's own IndexedDB stores,
 * so they match the 2D Studio once the two apps share an origin), autosave of the open project, `.iynk` files and
 * `#project=` links. Shell-internal, not a contract: `./index.ts` builds it and provides it per app on mount; the home
 * and projects panels read it with `libraryOf(app)`, which is null until the library module has mounted.
 */
import type { XrApp } from '../../contracts/app';
import type { ReadonlyValue } from '../../contracts/common';

export interface LibraryRow {
  readonly id: string;
  readonly title: string;
  /** ISO date of the last change. */
  readonly updatedAt: string;
  /** The first board's name, for the row's detail line ("Arduino Uno R3"), or empty. */
  readonly board: string;
}

/** `ok`; `loading` before the first list; `unavailable` when storage is blocked (private window); `full` on a quota error. */
export type LibraryState = 'loading' | 'ok' | 'unavailable' | 'full';

export type LinkResult = { ok: true; link: string } | { ok: false; reason: 'tooLarge' | 'hasFiles' | 'failed' };

export interface ShellLibrary {
  /** Newest first. Empty is the "no projects yet" state. */
  readonly rows: ReadonlyValue<readonly LibraryRow[]>;
  readonly state: ReadonlyValue<LibraryState>;
  /** The library project on the bench now, autosaved; null for a lesson, a template or nothing. */
  readonly current: ReadonlyValue<string | null>;
  /** The project to continue from Home: the one last opened, or null. */
  readonly last: ReadonlyValue<LibraryRow | null>;

  /** Makes a project (a blank Uno bench, or a fork of a template id) and opens it. Resolves to its id. */
  create(opts?: { title?: string; template?: string }): Promise<string>;
  open(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  /** A copy beside it ("<title> copy"); resolves to the new id. Does not open it. */
  duplicate(id: string): Promise<string>;
  /** Moves it to the trash (kept 30 days, as the 2D Studio does). The panel confirms first. */
  remove(id: string): Promise<void>;
  /** Downloads it as an `.iynk` file. Call from a select handler: the download needs a user gesture. */
  exportFile(id: string): Promise<void>;
  /** Reads an `.iynk` or `.iynkz` file into a new project; resolves to its id. Does not open it. */
  importFile(file: Blob & { readonly name?: string }): Promise<string>;
  /** A link that carries the project in its `#project=` fragment and opens it in this app. */
  shareLink(id: string): Promise<LinkResult>;
  /** Saves the project in a link's code as a new project and opens it; resolves to its id. */
  openLink(code: string): Promise<string>;
}

const slots = new WeakMap<XrApp, ShellLibrary>();

export function provideLibrary(app: XrApp, library: ShellLibrary): () => void {
  slots.set(app, library);
  return () => {
    if (slots.get(app) === library) slots.delete(app);
  };
}

export const libraryOf = (app: XrApp): ShellLibrary | null => slots.get(app) ?? null;
