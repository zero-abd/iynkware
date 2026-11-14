/**
 * Whether the last immersive session got hand tracking, kept in `localStorage["iynk:xr:entry:v1"]` so the entry page
 * can say so before the next one. Every storage access is guarded: blocked storage means "not known".
 */
export const ENTRY_KEY = 'iynk:xr:entry:v1';

export type HandsMemory = 'granted' | 'denied';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStore = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function readHands(store: Store | null = defaultStore()): HandsMemory | null {
  try {
    const saved = JSON.parse(store?.getItem(ENTRY_KEY) ?? 'null') as { hands?: unknown } | null;
    return saved?.hands === 'granted' || saved?.hands === 'denied' ? saved.hands : null;
  } catch {
    return null;
  }
}

/**
 * Records what a session that just started granted, from `session.enabledFeatures`. A browser that does not list its
 * features (`undefined`) tells nothing, so nothing is written. Returns what was recorded.
 */
export function rememberHands(features: readonly string[] | undefined, store: Store | null = defaultStore()): HandsMemory | null {
  if (!features) return null;
  const hands: HandsMemory = features.includes('hand-tracking') ? 'granted' : 'denied';
  try {
    store?.setItem(ENTRY_KEY, JSON.stringify({ hands }));
  } catch {
    /* storage blocked: the page says "checked when you enter" next time */
  }
  return hands;
}
