// What this device remembers about assignments, so a reload does not lose them. None of it is needed to work:
// every read and write can fail (a private window, blocked storage) and the page then starts from nothing.

export type SavedAssignment = { id: string; title: string; code: string };

const MADE = "iynk.assignments.made";
const STARTED = "iynk.assignments.started";
const STUDENT = "iynk.assignments.student";
const KEEP = 10;
/** A larger code is left out: it would not fit with the others. */
const MAX_CODE = 400_000;

function read<T>(key: string, fallback: T): T {
  try {
    const text = localStorage.getItem(key);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: the next visit starts without it.
  }
}

export const madeAssignments = (): SavedAssignment[] => {
  const list = read<unknown>(MADE, []);
  return Array.isArray(list) ? list.filter((s): s is SavedAssignment => typeof s?.id === "string" && typeof s.title === "string" && typeof s.code === "string") : [];
};

/** The teacher's assignments, newest first, so the grade view can offer them. */
export function rememberMade(saved: SavedAssignment): void {
  if (saved.code.length > MAX_CODE) return;
  write(MADE, [saved, ...madeAssignments().filter((s) => s.id !== saved.id)].slice(0, KEEP));
}

const started = (): Record<string, string> => {
  const map = read<unknown>(STARTED, {});
  return typeof map === "object" && map !== null && !Array.isArray(map) ? (map as Record<string, string>) : {};
};

/** The project a student made from an assignment, so opening the link again goes back to it. */
export const startedProject = (assignment: string): string | null => started()[assignment] ?? null;

export function rememberStarted(assignment: string, project: string): void {
  write(STARTED, { ...started(), [assignment]: project });
}

export const rememberedStudent = (): string => {
  const name = read<unknown>(STUDENT, "");
  return typeof name === "string" ? name : "";
};

export const rememberStudent = (name: string): void => write(STUDENT, name);
