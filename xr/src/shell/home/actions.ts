/**
 * App-level actions the home panel and the menu share: restart everything, and exit back to the entry page.
 *
 * Both reload the page, because that is the one reset that is complete: every pillar, the sim worker, the voice
 * session and the WebXR session go away together. Restart asks the entry page (`../entry`) to open the bench on this
 * screen again at once; a headset session cannot restart by itself (the browser needs a fresh press of Enter).
 */
import type { XrApp } from '../../contracts/app';

/** Read by the entry page on load: `flat` opens on this screen without a press. */
export const AUTOSTART_KEY = 'iynkware:autostart';

async function endSession(app: XrApp): Promise<void> {
  const session = app.world.session;
  if (!session) return;
  await session.end().catch(() => undefined);
}

function reload(): void {
  const url = new URL(location.href);
  location.replace(url.toString());
}

/** Starts the whole app over on the same project (`?project=` is kept). */
export async function restartApp(app: XrApp): Promise<void> {
  const wasFlat = !app.world.session;
  await endSession(app);
  try {
    if (wasFlat) sessionStorage.setItem(AUTOSTART_KEY, 'flat');
  } catch {
    // No storage: the entry page shows its buttons instead.
  }
  reload();
}

/** Leaves headset mode and the bench and goes back to the entry page. */
export async function exitApp(app: XrApp): Promise<void> {
  await endSession(app);
  try {
    sessionStorage.removeItem(AUTOSTART_KEY);
  } catch {
    // Nothing to clear.
  }
  reload();
}
