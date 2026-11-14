import { INTERP_LANGUAGE } from "@/lib/interp";
import { pinNet } from "@/lib/interp/pins";
import { boardIdOf, getProfile } from "@/sim/boards/profiles";
import type { Descriptor } from "@/parts/descriptor";
import { builtinRegistry } from "@/parts/builtin";
import { serveWorker, type WorkerScopeLike } from "@/protocol";
import { simDiag } from "@/sim/core/diagnostic";
import { cyclesToNs } from "@/sim/core/clock";
import { createDigitalNets } from "@/sim/digital/nets";
import type { HexProgram, SimDiagnostic, SimNetlist } from "@/sim/engine";
import { defaultRules } from "@/sim/faults/rules";
import { createRunAnalog } from "@/sim/analog/run";
import { type LiveAnalog, modelIdsOf, pinElementId } from "@/sim/analog/live";
import { createProbeTap } from "@/sim/probe/tap";
import { buildSimNetlist } from "@/sim/netlist";
import { loadRegistry } from "@/sim/registry/entries";
import type { Registry } from "@/sim/registry/types";
import { RATE, type Avr8js, type AvrEngine } from "@/sim/mcu/avr8js";
import { createFirmwareEngine, I2C_BUS, netlistBus } from "@/sim/mcu/firmware";
import type { createRp2040Engine, Rp2040Engine } from "@/sim/mcu/rp2040/engine";
import type { Rp2040js } from "@/sim/mcu/rp2040/lib";
import { bindAnalog, wiredI2cDevices } from "./engines/bind";
import { createLoader, detectFeatures, importEngineScript } from "./engines/loader";
import { boardNetVolts } from "./engines/board-volts";
import { createInterpEngine, type InterpEngine } from "./engines/interp-engine";
import { createSimHandler, type SimEngine } from "./handler";
import { packRunIo, prepareMech, rangersOf, robotReport } from "./mech";

const parts = builtinRegistry();

const describe = (id: string): Descriptor | undefined => {
  const [ref = "", version = ""] = id.split("@");
  return parts.get(ref, version);
};

let fidelity: Registry | null = null;
const fidelityRegistry = (): Registry => (fidelity ??= loadRegistry());

/** Where a compiled program's analog pins read the circuit; set once the run's solver exists. */
let firmwareVolts: ((pin: string) => number | null) | null = null;

/** The engine's own pin events carry its writes to the circuit; only the ADC reads the solver back. */
const unwired = {
  drive: () => undefined,
  mode: () => undefined,
  level: () => null,
  volts: (pin: string) => firmwareVolts?.(pin) ?? null,
};

const loadFromManifest = createLoader({ fetch: (input, init) => fetch(input, init), features: { wasm: new Set(), deviceMemoryGb: undefined, desktop: true } });

let avr: Avr8js | null = null;
let rp2040: { lib: Rp2040js; bootrom: Uint32Array; create: typeof createRp2040Engine } | null = null;

const engineFailure = (message: string): SimDiagnostic[] => [simDiag("engine-load-failed", "error", {}, { message })];

/** Fetches an engine script from the manifest, checked against its hash; null with the diagnostics when it cannot be had. */
async function fetchEngine<T>(id: string): Promise<{ module: T } | { blocked: SimDiagnostic[] }> {
  const offer = await loadFromManifest(id);
  if (!offer.ok) return { blocked: engineFailure(offer.detail) };
  const fetched = await offer.fetchFiles();
  if (!fetched.ok) return { blocked: engineFailure(fetched.reason === "integrity" ? "engine file failed its check" : fetched.detail) };
  const script = fetched.files.find((f) => f.kind === "js");
  if (!script) return { blocked: engineFailure("the engine has no script file") };
  try {
    return { module: await importEngineScript<T>(script) };
  } catch (error) {
    return { blocked: engineFailure(error instanceof Error ? error.message : String(error)) };
  }
}

/** Fetches the engine a compiled program runs on the first time one is loaded: avr8js for a hex, rp2040js and the boot ROM for a UF2. */
async function loadCompiled(kind: "hex" | "uf2"): Promise<SimDiagnostic[]> {
  if (kind === "hex" ? avr : rp2040) return [];
  const engine = await fetchEngine<Avr8js | Rp2040js>(kind === "hex" ? "avr8js" : "rp2040js");
  if ("blocked" in engine) return engine.blocked;
  if (kind === "hex") avr = engine.module as Avr8js;
  else {
    const [{ createRp2040Engine: create }, { BOOTROM_B1: bootrom }] = await Promise.all([import("@/sim/mcu/rp2040/engine"), import("@/sim/mcu/rp2040/bootrom")]);
    rp2040 = { lib: engine.module as Rp2040js, bootrom, create };
  }
  return [];
}

function firmwareEngine(program: HexProgram, net: SimNetlist): SimEngine {
  const board = net.parts.find((p) => p.kind === "board");
  const boardId = boardIdOf(board?.descriptor ?? "");
  if (!avr) throw new Error("the AVR engine is not loaded");
  firmwareVolts = null;
  if (!board || (boardId !== "uno-r3" && boardId !== "nano")) throw new Error(`${boardId} does not run on the AVR engine`);
  const supplyV = getProfile(boardId).logicV;
  const running: { engine?: AvrEngine } = {};
  const bus = netlistBus(net, board.id, supplyV, (part) => describe(part.descriptor), () => cyclesToNs(running.engine?.cycles ?? 0, RATE));
  const made = createFirmwareEngine(avr, { board: boardId, hex: program.hex, elf: program.elf, wiring: { pins: unwired, bus, busId: I2C_BUS, vref: supplyV }, rangers: rangersOf(net) });
  if (!made.ok) throw new Error("message" in made.error ? made.error.message : made.error.kind);
  running.engine = made.engine;
  return made.engine;
}

function rp2040Engine(net: SimNetlist): SimEngine {
  const board = net.parts.find((p) => p.kind === "board");
  const boardId = boardIdOf(board?.descriptor ?? "");
  if (!rp2040) throw new Error("the RP2040 engine is not loaded");
  firmwareVolts = null;
  if (!board || boardId !== "pico") throw new Error(`${boardId} does not run on the RP2040 engine`);
  const supplyV = getProfile(boardId).logicV;
  const running: { engine?: Rp2040Engine } = {};
  const nowNs = () => running.engine?.nowNs ?? 0;
  running.engine = rp2040.create({
    lib: rp2040.lib,
    bootrom: rp2040.bootrom,
    wiring: { volts: unwired.volts, i2c: (sda, scl) => netlistBus(net, board.id, supplyV, (part) => describe(part.descriptor), nowNs, {}, { sda, scl }) },
  });
  return running.engine;
}

// The interpreter engines this worker made. The firmware engines have no Run world, and an `in` check cannot tell them
// apart: the AVR engine has a private run() method.
const interpEngines = new WeakSet<SimEngine>();
const isInterp = (engine: SimEngine): engine is InterpEngine => interpEngines.has(engine);

/** A run without a circuit solver: a probe reads what the board's pins show, and "not modelled" elsewhere. */
const boardAnalog = (netVolts: (net: string) => number | null) => ({
  netVolts,
  pinVolts: () => null,
  componentResult: () => null,
  nodeIndex: () => null,
  whatIf: (): never => {
    throw new Error("no analog solver in the worker");
  },
});

function bindRun(engine: SimEngine, live: LiveAnalog, net: SimNetlist): void {
  const board = net.parts.find((p) => p.kind === "board");
  if (!board) return;
  const boardId = boardIdOf(board.descriptor);
  if (isInterp(engine)) bindAnalog(engine, live, board.id, getProfile(boardId));
  else firmwareVolts = (pin) => live.pinVolts(pinElementId(board.id, pin));
}

/**
 * Reads the I2C pins from the sketch's `Wire.begin` as it runs, and probes by writing an address to the interpreter's bus.
 * The pins come out as the board's net names, which are the names on the headers.
 */
function scanTap(engine: SimEngine) {
  if (!isInterp(engine)) throw new Error("the bus scan needs the interpreter; firmware runs cannot be scanned");
  const { world } = engine.run;
  let bound: { sda: number; scl: number } | undefined;
  const inner = world.i2cBinder;
  world.i2cBinder = (sda, scl) => {
    bound = { sda, scl };
    inner?.(sda, scl);
  };
  return {
    probe: (addr: number) => (world.i2cTransfer(addr, [], 0).ack ? ("ack" as const) : ("nack" as const)),
    pins() {
      const pins = bound ?? world.profile.i2c;
      return pins ? { sda: pinNet(world.profile, pins.sda), scl: pinNet(world.profile, pins.scl) } : null;
    },
  };
}

const loadPhysics = createLoader({ fetch: (input, init) => fetch(input, init), features: detectFeatures() });

const latestPart = (ref: string): Descriptor | undefined => parts.latest(ref);

serveWorker(
  self as unknown as WorkerScopeLike,
  createSimHandler({
    diag: self.name === "sim-diag",
    wallMs: () => performance.now(),
    schedule: (fn) => void setTimeout(fn, 0),
    prepareCompiled: loadCompiled,
    makeEngine: (program, net, opts) => {
      if (program.kind === "hex") return firmwareEngine(program, net);
      if (program.kind === "uf2") return rp2040Engine(net);
      const board = net.parts.find((p) => p.kind === "board");
      const engine = createInterpEngine({
        id: board?.id ?? "mcu",
        board: boardIdOf(board?.descriptor ?? ""),
        language: INTERP_LANGUAGE[program.language as keyof typeof INTERP_LANGUAGE] ?? "arduino",
        seed: opts.seed,
        rangers: rangersOf(net),
        i2cDevices: board ? (nowNs) => wiredI2cDevices(net, board.id, getProfile(boardIdOf(board.descriptor)), (part) => describe(part.descriptor), nowNs) : undefined,
      });
      interpEngines.add(engine);
      return engine;
    },
    makeDigital: createDigitalNets,
    scan: scanTap,
    mech: {
      prepare: (doc, net, onState) => prepareMech(doc, net, { loadEngine: loadPhysics, describe: latestPart, onState }),
      runIo: (net) => packRunIo(net, latestPart),
      report: (doc) => robotReport(doc, latestPart, buildSimNetlist(doc, parts).net),
    },
    faults: {
      describe,
      rules: defaultRules,
    },
    analog: { create: () => createRunAnalog(parts, fidelityRegistry()), bind: bindRun },
    makeTap: (net, engine, live) =>
      createProbeTap({
        analog: live ?? boardAnalog(isInterp(engine) ? boardNetVolts(net, engine) : () => null),
        registry: fidelityRegistry(),
        modelOf: (id) => [...modelIdsOf(net.parts.find((p) => p.id === id)?.descriptor ?? "")],
      }),
  }),
);
