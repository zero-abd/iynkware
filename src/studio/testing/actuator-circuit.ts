import { newId, type RandomSource } from "../../core/ids.ts";
import { blankProject } from "../../project/blank.ts";
import type { Op, Project } from "../../project/generated/types.ts";
import { createSession } from "../../project/session.ts";
import { steppingClock, USER } from "../../project/session.testing.ts";
import { builtinRegistry } from "../../parts/builtin.ts";
import { interfaceOf } from "../../parts/pins.ts";
import { canConnect, wireRecipe } from "../rules/connect.ts";
import type { WireEndRef } from "../rules/connect.ts";
import { createDocStore } from "../stores/doc.ts";
import type { IdSource } from "../views/breadboard.ts";

const VIEW = "vw_bb";

/** The shared seeded source repeats after 251 bytes, which is fewer than this project needs ids for. */
function lcgRandom(): RandomSource {
  let n = 1;
  return { bytes: (count) => Uint8Array.from({ length: count }, () => ((n = (n * 1103515245 + 12345) % 2 ** 31) >>> 16) & 255) };
}

export const ACTUATOR_SKETCH = `#include <Servo.h>

Servo arm;

void setup() {
  arm.attach(9);
  arm.write(135);
  pinMode(6, OUTPUT);
  analogWrite(6, 200);
}

void loop() {
  delay(100);
}
`;

export type ActuatorCircuit = { project: Project; servo: string; motor: string; transistor: string };

/**
 * An Uno, an SG90 servo on D9 and a DC motor on a 4 AA pack, switched to ground by a TIP120 whose base takes D6 through 1 kohm, with a 1N4007 across the motor. The parts stand on the canvas with pin to pin wires.
 */
export function actuatorCircuit(sketch = ACTUATOR_SKETCH): ActuatorCircuit {
  const registry = builtinRegistry();
  const rnd = lcgRandom();
  const ids: IdSource = (prefix) => newId(prefix, rnd);
  const doc = createDocStore(
    createSession({
      state: blankProject({ board: "uno", title: "Actuators", locale: "en", actor: USER.actor, now: "2026-10-28T10:00:00.000Z", id: "prj_actuators" }),
      clock: steppingClock(),
      rnd,
    }),
  );
  const commit = (batch: Op[], label: string) => {
    const done = doc.commit(batch, { label });
    if (!done.ok) throw new Error(`${label}: ${done.reject}: ${done.message}`);
  };

  commit([{ k: "view.place", view: VIEW, placement: { c: "brd_uno", x_mm: -80, y_mm: 0 } }], "Place the board");
  const add = (ref: string, refdes: string, x_mm: number, y_mm: number, params?: Record<string, number>): string => {
    const desc = registry.latest(ref)!;
    const c = ids("cmp");
    commit(
      [
        { k: "dep.set", dependency: { ref: desc.id, version: desc.version, origin: "builtin", interface: interfaceOf(desc) } },
        { k: "component.add", component: { id: c, definition: { ref: desc.id, version: desc.version }, refdes, ...(params ? { params } : {}) } },
        { k: "view.place", view: VIEW, placement: { c, x_mm, y_mm } },
      ],
      `Place ${refdes}`,
    );
    return c;
  };
  const servo = add("core.servo-sg90", "M1", 0, 0);
  const motor = add("core.dc-motor", "M2", 0, 40);
  const transistor = add("core.tip120", "Q1", 40, 40);
  const base = add("core.resistor", "R1", 40, 60, { ohms: 1000 });
  const flyback = add("core.diode-1n4007", "D1", 40, 20);
  const pack = add("core.aa-holder-4", "BT1", 80, 40);

  const pin = (c: string, p: string): WireEndRef => ({ kind: "pin", c, p });
  const runs: [WireEndRef, WireEndRef][] = [
    [pin("brd_uno", "D9"), pin(servo, "SIG")],
    [pin("brd_uno", "P5V"), pin(servo, "VPLUS")],
    [pin("brd_uno", "GND"), pin(servo, "GND")],
    [pin(pack, "PLUS"), pin(motor, "PLUS")],
    [pin(pack, "MINUS"), pin("brd_uno", "GND")],
    [pin(motor, "MINUS"), pin(transistor, "C")],
    [pin(transistor, "E"), pin("brd_uno", "GND")],
    [pin("brd_uno", "D6"), pin(base, "P1")],
    [pin(base, "P2"), pin(transistor, "B")],
    [pin(flyback, "A"), pin(motor, "MINUS")],
    [pin(flyback, "K"), pin(motor, "PLUS")],
  ];
  for (const [a, b] of runs) {
    const state = doc.getState().state;
    const verdict = canConnect(state, VIEW, a, b);
    if (!verdict.ok) throw new Error(`wire refused: ${verdict.code}`);
    const recipe = wireRecipe(state, VIEW, a, b, ids);
    commit(recipe.batch, recipe.label);
  }

  const project = structuredClone(doc.getState().state);
  project.sources = project.sources.map((s) => (s.role === "firmware" ? { ...s, content: sketch } : s));
  return { project, servo, motor, transistor };
}
