/**
 * Controller flight (issue #314): gamepad axes and buttons in, flight commands out. The Quest's own layout through
 * IWSDK's input profiles (xr-standard: thumbstick on axes 2 and 3, A and B on buttons 4 and 5), the stick read every
 * frame from the service's reused view, mode 2, dead zones and expo, arming with A and a take-off on the real flight
 * model; and the first-flight hint's logic and strings.
 */
import { InputComponent, loadInputProfile, StatefulGamepad } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import quad5 from '@/content/drones/quad5';
import { flightCalc } from '@/lib/dronelab/fly';
import { flightOf, type Sticks } from '@/lib/flight';
import type { FaceButton, Hand } from '../src/contracts/input';
import { stepButton, type MutableButton } from '../src/input/helpers';
import {
  CONTROLLER_EXPO,
  controllerExpo,
  controllerSticks,
  createRunner,
  newControllerFrame,
  readController,
  STICK_DEADBAND,
  type PadSource,
} from '../src/range/flight/core';
import { FirstFlightHint, hintInput, hintKey } from '../src/range/flight/hint/logic';
import { HINT_STRINGS } from '../src/range/flight/hint/strings';
import { stringProblems } from '../src/range/shared';

const QUEST_PROFILES = ['meta-quest-touch-plus', 'oculus-touch-v3', 'oculus-touch', 'generic-trigger-squeeze-thumbstick'];

/** A Quest controller as WebXR shows it: an `xr-standard` gamepad with four axes and seven buttons. */
function questController(handedness: Hand, profiles = QUEST_PROFILES) {
  const buttons = Array.from({ length: 7 }, () => ({ pressed: false, touched: false, value: 0 }));
  const gamepad = { mapping: 'xr-standard', axes: [0, 0, 0, 0], buttons };
  const source = { handedness, profiles, gamepad } as unknown as XRInputSource;
  return { gamepad, source, stateful: new StatefulGamepad(loadInputProfile(source)) };
}

const BUTTON_ID: Record<Hand, Record<FaceButton, string>> = {
  left: { lower: InputComponent.X_Button, upper: InputComponent.Y_Button, stick: InputComponent.Thumbstick },
  right: { lower: InputComponent.A_Button, upper: InputComponent.B_Button, stick: InputComponent.Thumbstick },
};

/**
 * The input service's controller path in miniature (`xr/src/input/service.ts`): IWSDK's stateful gamepads updated once
 * a frame, one `{x, y}` view per hand rewritten only when `stick()` is called, and buttons stepped in place.
 */
function questPads(profiles?: string[]) {
  const pads = { left: questController('left', profiles), right: questController('right', profiles) };
  const views: Record<Hand, { x: number; y: number }> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  const newButtons = (): Record<FaceButton, MutableButton> => ({
    lower: { pressed: false, down: false, up: false },
    upper: { pressed: false, down: false, up: false },
    stick: { pressed: false, down: false, up: false },
  });
  const buttons: Record<Hand, Record<FaceButton, MutableButton>> = { left: newButtons(), right: newButtons() };
  const service: PadSource = {
    stick(hand) {
      const a = pads[hand].stateful.getAxesValues(InputComponent.Thumbstick);
      views[hand].x = a?.x ?? 0;
      views[hand].y = a?.y ?? 0;
      return views[hand];
    },
    button: (hand, which) => buttons[hand][which],
  };
  const frame = () => {
    for (const hand of ['left', 'right'] as const) {
      pads[hand].stateful.update();
      for (const which of ['lower', 'upper', 'stick'] as const) stepButton(buttons[hand][which], pads[hand].stateful.getButtonPressed(BUTTON_ID[hand][which]));
    }
  };
  return { pads, service, frame };
}

const centred = (): Sticks => ({ throttle: 0.5, yaw: 0, pitch: 0, roll: 0 });

describe('the Quest controller layout through IWSDK', () => {
  it('reads the thumbstick from axes 2 and 3, A from button 4 and Y from button 5 (xr-standard)', () => {
    const { pads, service, frame } = questPads();
    const out = newControllerFrame();
    // the touchpad slots (axes 0 and 1) are not the stick
    pads.left.gamepad.axes.splice(0, 4, 0.9, 0.9, 0, -1);
    pads.right.gamepad.axes.splice(0, 4, -0.9, 0.9, 1, 0);
    frame();
    readController(service, 2, 0, out);
    expect(out.sticks).toEqual({ throttle: 1, yaw: 0, pitch: 0, roll: -1 }); // full climb, bank right
    expect(out.arm).toBe(false);

    pads.right.gamepad.buttons[4]!.pressed = true; // A
    frame();
    readController(service, 2, 0, out);
    expect(out.arm).toBe(true);
    frame(); // still held: one press is one toggle
    readController(service, 2, 0, out);
    expect(out.arm).toBe(false);

    pads.left.gamepad.buttons[5]!.pressed = true; // Y (B is the input switch)
    frame();
    readController(service, 2, 0, out);
    expect(out.reset).toBe(true);
    expect(out.arm).toBe(false);
  });

  it('a left X is not A, and the left stick click is the menu, not a flight command', () => {
    const { pads, service, frame } = questPads();
    const out = newControllerFrame();
    pads.left.gamepad.buttons[4]!.pressed = true; // X
    pads.left.gamepad.buttons[3]!.pressed = true; // left stick click
    frame();
    readController(service, 2, 0, out);
    expect(out.arm).toBe(false);
    expect(out.reset).toBe(false);
  });

  it('a Quest 2 (oculus-touch-v3 first) has the same layout', () => {
    const { pads, service, frame } = questPads(['oculus-touch-v3', 'oculus-touch', 'generic-trigger-squeeze-thumbstick']);
    const out = newControllerFrame();
    pads.right.gamepad.axes.splice(0, 4, 0, 0, 0, -1);
    frame();
    readController(service, 2, 0, out);
    expect(out.sticks.pitch).toBe(1); // nose down: forward
  });

  it('reads the sticks afresh every frame: a stick moved after the first read still flies', () => {
    // the room once kept the view from its first `stick()` call; the service only rewrites a view when asked
    const { pads, service, frame } = questPads();
    const out = newControllerFrame();
    frame();
    readController(service, 2, 0, out);
    expect(out.sticks).toEqual(centred());
    pads.left.gamepad.axes[3] = -1;
    pads.left.gamepad.axes[2] = 0.5;
    frame();
    readController(service, 2, 0, out);
    expect(out.sticks.throttle).toBe(1);
    expect(out.sticks.yaw).toBeGreaterThan(0.4);
    pads.left.gamepad.axes[3] = 0;
    pads.left.gamepad.axes[2] = 0;
    frame();
    readController(service, 2, 0, out);
    expect(out.sticks).toEqual(centred());
  });
});

describe('the stick mapping', () => {
  it('mode 2: left y climbs, left x turns right, right y forward pitches nose down, right x right banks right', () => {
    const s = centred();
    controllerSticks({ x: 1, y: 1 }, { x: -1, y: -1 }, 2, s);
    expect(s).toEqual({ throttle: 0, yaw: 1, pitch: 1, roll: 1 });
  });

  it('dead zone: rest noise is centre, and a channel leaves zero smoothly past it', () => {
    const s = centred();
    controllerSticks({ x: 0.05, y: -0.05 }, { x: -0.05, y: 0.05 }, 2, s, CONTROLLER_EXPO);
    expect(s).toEqual(centred());
    controllerSticks({ x: 0, y: -(STICK_DEADBAND + 0.01) }, { x: 0, y: 0 }, 2, s);
    expect(s.throttle).toBeGreaterThan(0.5);
    expect(s.throttle).toBeLessThan(0.51);
  });

  it('expo softens the centre of pitch and roll, keeps full stick full, and leaves yaw and climb straight', () => {
    const lin = centred(), exp = centred();
    controllerSticks({ x: 0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, 2, lin, 0);
    controllerSticks({ x: 0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, 2, exp, CONTROLLER_EXPO);
    expect(Math.abs(exp.pitch)).toBeLessThan(Math.abs(lin.pitch));
    expect(Math.abs(exp.roll)).toBeLessThan(Math.abs(lin.roll));
    expect(exp.yaw).toBe(lin.yaw);
    expect(exp.throttle).toBe(lin.throttle);
    controllerSticks({ x: 0, y: 0 }, { x: 1, y: -1 }, 2, exp, CONTROLLER_EXPO);
    expect(exp.pitch).toBe(1);
    expect(exp.roll).toBe(-1);
  });

  it('a mode with expo of its own gets none from the sticks (the flight model shapes it)', () => {
    expect(controllerExpo({ expo: 0.7 })).toBe(0);
    expect(controllerExpo({})).toBe(CONTROLLER_EXPO);
    expect(controllerExpo(undefined)).toBe(CONTROLLER_EXPO);
  });
});

describe('a controller take-off on the real flight model', () => {
  const { craft, courses } = flightOf(quad5)!;
  const race = courses.find((c) => c.id === 'race')!;
  const calc = flightCalc(quad5, quad5.design.default);

  it('A arms with the sticks centred, the left stick up lifts off, A again disarms', () => {
    const { pads, service, frame } = questPads();
    const r = createRunner(craft, race, calc, { mode: 'race' });
    const out = newControllerFrame();
    const step = () => {
      frame();
      readController(service, 2, controllerExpo(craft.modes.find((m) => m.id === r.mode)), out);
      if (out.arm) r.toggleArm();
      r.setSticks(out.sticks);
      r.tick(1 / 72);
    };
    step();
    pads.right.gamepad.buttons[4]!.pressed = true;
    step();
    pads.right.gamepad.buttons[4]!.pressed = false;
    step();
    expect(r.phase).toBe('armed');
    expect(r.frame.airborne).toBe(false);
    const z0 = r.frame.z;
    pads.left.gamepad.axes[3] = -1;
    for (let i = 0; i < 72 * 2; i++) step();
    expect(r.frame.airborne).toBe(true);
    expect(r.frame.z).toBeGreaterThan(z0 + 1);
    pads.left.gamepad.axes[3] = 0;
    for (let i = 0; i < 36; i++) step();
    const hold = r.frame.z;
    for (let i = 0; i < 72; i++) step();
    expect(Math.abs(r.frame.z - hold)).toBeLessThan(0.5); // a centred left stick holds the height
    pads.right.gamepad.buttons[4]!.pressed = true;
    step();
    expect(r.phase).toBe('disarmed');
  });
});

describe('the first-flight hint', () => {
  it('says how to arm, then how to take off, and goes for good at the first take-off', () => {
    const h = new FirstFlightHint();
    expect(h.step(false, false)).toBe('arm');
    expect(h.step(true, false)).toBe('takeoff');
    expect(h.step(false, false)).toBe('arm'); // disarmed again on the pad
    expect(h.step(true, true)).toBeNull();
    expect(h.done).toBe(true);
    expect(h.step(false, false)).toBeNull(); // landed and disarmed: it stays gone
  });

  it('speaks to hands when a hand is tracked, to controllers otherwise', () => {
    expect(hintInput({ left: 'controller', right: 'controller' })).toBe('controller');
    expect(hintInput({ left: null, right: null })).toBe('controller');
    expect(hintInput({ left: 'hand', right: null })).toBe('hand');
    expect(hintKey('arm', 'controller')).toBe('armController');
    expect(hintKey('takeoff', 'hand')).toBe('takeoffHand');
  });

  it('has its strings in six languages, and the controller lines name A', () => {
    expect(stringProblems(HINT_STRINGS.table)).toEqual([]);
    for (const lang of ['en', 'de', 'es', 'fr', 'hi', 'zh'] as const) {
      expect(HINT_STRINGS.t(lang, 'armController')).toContain('A');
      expect(HINT_STRINGS.t(lang, 'takeoffController')).toContain('A');
    }
  });
});
