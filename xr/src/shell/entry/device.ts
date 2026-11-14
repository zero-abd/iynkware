/**
 * The entry page's device check, as plain data: what the browser can do in, three rows out (WebXR, passthrough,
 * hands), each with a state, a state word and a sentence. Hands cannot be known before a session, so that row reports
 * what the last session granted (`./hands.ts`).
 */
import type { EntryKey } from './copy';
import type { HandsMemory } from './hands';

export interface Capabilities {
  /** `window.isSecureContext`: WebXR is hidden on plain http (except localhost). */
  readonly secure: boolean;
  /** `navigator.xr` exists. */
  readonly xr: boolean;
  /** `isSessionSupported('immersive-ar')`; null while the browser has not answered. */
  readonly ar: boolean | null;
  /** `isSessionSupported('immersive-vr')`; null while unanswered or not asked (AR answered yes). */
  readonly vr: boolean | null;
  /** What the last session granted, or null before any. */
  readonly hands: HandsMemory | null;
}

/** `ok` tick (good), `no` cross (bad), `warn` triangle (works another way), `later` and `checking` info circle, `off` dash. */
export type RowState = 'ok' | 'no' | 'warn' | 'later' | 'checking' | 'off';

export interface DeviceRow {
  readonly id: 'webxr' | 'passthrough' | 'hands';
  readonly label: EntryKey;
  readonly state: RowState;
  readonly word: EntryKey;
  readonly detail: EntryKey;
}

/** true when headset mode can start, false when it cannot, null while the browser has not answered. */
export function canEnter(c: Capabilities): boolean | null {
  if (!c.secure || !c.xr) return false;
  if (c.ar === true || c.vr === true) return true;
  if (c.ar === null || c.vr === null) return null;
  return false;
}

export function deviceRows(c: Capabilities): DeviceRow[] {
  const can = canEnter(c);
  const webxr: DeviceRow = !c.secure
    ? { id: 'webxr', label: 'rowWebxr', state: 'no', word: 'wMissing', detail: 'dWebxrInsecure' }
    : !c.xr
      ? { id: 'webxr', label: 'rowWebxr', state: 'no', word: 'wMissing', detail: 'dWebxrMissing' }
      : can === null
        ? { id: 'webxr', label: 'rowWebxr', state: 'checking', word: 'wChecking', detail: 'dWebxrChecking' }
        : can
          ? { id: 'webxr', label: 'rowWebxr', state: 'ok', word: 'wWorks', detail: 'dWebxrOk' }
          : { id: 'webxr', label: 'rowWebxr', state: 'no', word: 'wNoHeadset', detail: 'dWebxrMissing' };

  const passthrough: DeviceRow =
    can === null
      ? { id: 'passthrough', label: 'rowPass', state: 'checking', word: 'wChecking', detail: 'dWebxrChecking' }
      : !can
        ? { id: 'passthrough', label: 'rowPass', state: 'off', word: 'wNotHere', detail: 'dNeedsHeadset' }
        : c.ar
          ? { id: 'passthrough', label: 'rowPass', state: 'ok', word: 'wWorks', detail: 'dPassOk' }
          : { id: 'passthrough', label: 'rowPass', state: 'warn', word: 'wPaper', detail: 'dPassPaper' };

  const hands: DeviceRow =
    can === false
      ? { id: 'hands', label: 'rowHands', state: 'off', word: 'wNotHere', detail: 'dNeedsHeadset' }
      : c.hands === 'granted'
        ? { id: 'hands', label: 'rowHands', state: 'ok', word: 'wLastTime', detail: 'dHandsOk' }
        : c.hands === 'denied'
          ? { id: 'hands', label: 'rowHands', state: 'warn', word: 'wNotGranted', detail: 'dHandsNo' }
          : { id: 'hands', label: 'rowHands', state: 'later', word: 'wOnEntry', detail: 'dHandsLater' };

  return [webxr, passthrough, hands];
}
