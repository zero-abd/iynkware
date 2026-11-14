/**
 * Tells the entry page that the person chose to leave headset mode, so it says "You left headset mode" instead of
 * "Headset mode ended". The menu's Leave headset mode calls `noteLeaveAsked()` just before it ends the session.
 */
let asked = false;

export function noteLeaveAsked(): void {
  asked = true;
}

/** Whether the session that just ended was left on purpose; clears the note. */
export function takeLeaveAsked(): boolean {
  const was = asked;
  asked = false;
  return was;
}
