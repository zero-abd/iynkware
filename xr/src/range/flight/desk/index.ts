/**
 * The Range on a flat screen (desktop testing without a headset). Only while `app.mode` is `flat` and a flight is set:
 *
 *   view   the camera steps back from the head so Arm, Reset, Back and the course are on the screen (`deskFrame`);
 *          leaving the Range puts the camera back where it was
 *   keys   Space arms or disarms, R resets, W S climb, A D turn, the arrows pitch and roll (mode 2). The keys claim the
 *          sticks only while one is held, so the plates, hands and controllers keep working.
 *
 * Keys typed into a text field (the companion's question box) are left alone.
 */
import type { Sticks } from '@/lib/flight';
import type { FeatureModule, XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import { langOf } from '../../shared';
import { flightSceneOf, type FlightScene } from '../scene';
import { deskFrame, FLIGHT_KEYS, keySticks } from './logic';
import { DESK_STRINGS as S } from './strings';

const OWNER = 'range/flight/desk';
const FLIGHT = new Set<string>(FLIGHT_KEYS);

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
};

function mountDesk(app: XrApp): Unsubscribe {
  if (typeof window === 'undefined') return () => undefined;
  const cam = app.world.camera;
  let saved: { p: [number, number, number]; q: [number, number, number, number] } | null = null;
  let flight: FlightScene | null = null;
  let release: (() => void) | null = null;
  const held = new Set<string>();

  const flat = () => app.mode.value === 'flat';
  const unclaim = () => {
    release?.();
    release = null;
  };
  const restore = () => {
    if (!saved) return;
    cam.position.set(...saved.p);
    cam.quaternion.set(...saved.q);
    cam.updateMatrixWorld(true);
    saved = null;
  };
  const sync = () => {
    const next = flat() ? flightSceneOf(app).value : null;
    if (next === flight) return;
    held.clear();
    unclaim();
    flight = next;
    if (!flight) return restore();
    if (!saved) saved = { p: cam.position.toArray() as [number, number, number], q: cam.quaternion.toArray() as [number, number, number, number] };
    const f = deskFrame(flight.head);
    cam.position.set(...f.position);
    cam.lookAt(...f.target);
    cam.updateMatrixWorld(true);
    flight.say(S.t(langOf(app), 'keys'));
  };

  const read = (out: Sticks) => keySticks(held, out);
  const onDown = (e: KeyboardEvent) => {
    if (!flight || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      if (!e.repeat) flight.arm();
    } else if (e.code === 'KeyR') {
      if (!e.repeat) flight.reset();
    } else if (FLIGHT.has(e.code)) {
      held.add(e.code);
      if (!release) release = flight.claimSticks(OWNER, read);
    } else return;
    e.preventDefault();
  };
  const onUp = (e: KeyboardEvent) => {
    if (!held.delete(e.code)) return;
    if (held.size === 0) unclaim();
  };
  const onBlur = () => {
    held.clear();
    unclaim();
  };
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  const offs = [flightSceneOf(app).subscribe(sync), app.mode.subscribe(sync)];
  sync();
  return () => {
    for (const off of offs) off();
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', onBlur);
    unclaim();
    restore();
  };
}

export const deskModule: FeatureModule = { id: 'range/flight/desk', mount: (app) => mountDesk(app) };
