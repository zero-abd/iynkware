/**
 * The XR app's sim handler: iynk's `createSimHandler` (imported, not copied) with the interpreter engine, the digital
 * nets, the circuit solver, the probe tap (for `meter.read`), the fault rules, robot physics (rapier) and the firmware
 * engines (avr8js for a hex, rp2040js for a UF2), each a lazy chunk imported the first time a program needs it.
 *
 * Pure: runs in the worker (sim.worker.ts) and inline in the headless test, so both see the same handler.
 */
import { fail } from '@/core/result';
import { simDiag } from '@/sim/core/diagnostic';
import { cyclesToNs } from '@/sim/core/clock';
import type { HexProgram, SimDiagnostic } from '@/sim/engine';
import { RATE, type Avr8js, type AvrEngine } from '@/sim/mcu/avr8js';
import { createFirmwareEngine, I2C_BUS, netlistBus } from '@/sim/mcu/firmware';
import type { createRp2040Engine, Rp2040Engine } from '@/sim/mcu/rp2040/engine';
import type { Rp2040js } from '@/sim/mcu/rp2040/lib';
import { pinElementId } from '@/sim/analog/live';
import type { SimEngine } from '@/sim-host/handler';
import { INTERP_LANGUAGE } from '@/lib/interp';
import type { Descriptor } from '@/parts/descriptor';
import { builtinRegistry } from '@/parts/builtin';
import type { WorkerHandler } from '@/protocol';
import { modelIdsOf, type LiveAnalog } from '@/sim/analog/live';
import { createRunAnalog } from '@/sim/analog/run';
import { boardIdOf, getProfile } from '@/sim/boards/profiles';
import { createDigitalNets } from '@/sim/digital/nets';
import type { SimNetlist } from '@/sim/engine';
import { defaultRules } from '@/sim/faults/rules';
import { createProbeTap } from '@/sim/probe/tap';
import { loadRegistry } from '@/sim/registry/entries';
import type { Registry } from '@/sim/registry/types';
import { bindAnalog, wiredI2cDevices } from '@/sim-host/engines/bind';
import { createInterpEngine, type InterpEngine } from '@/sim-host/engines/interp-engine';
import { createSimHandler } from '@/sim-host/handler';
import { packRunIo, prepareMech, rangersOf, robotReport, type MechDeps } from '@/sim-host/mech';
import type { RapierModule } from '@/sim/mech/rapier';
import { buildSimNetlist } from '@/sim/netlist';
import type { SimEv, SimReq } from '@/sim-host/protocol';

export interface XrHandlerOptions {
  /** The wall clock that paces a running run. The headless test passes a fake. */
  wallMs: () => number;
  /** Runs the next slice of a running run. The headless test queues it and drains by hand. */
  schedule: (fn: () => void) => void;
}

const boardOf = (net: SimNetlist) => net.parts.find((p) => p.kind === 'board');

/** Probes on a run without a solver read nothing. Our runs always have one; this only satisfies the type. */
const noSolver = {
  netVolts: () => null,
  pinVolts: () => null,
  componentResult: () => null,
  nodeIndex: () => null,
  whatIf: (): never => {
    throw new Error('this run has no circuit solver');
  },
};

/** The physics engine, imported once per worker and only for a robot project. */
let physics: Promise<RapierModule> | null = null;

/**
 * Brings rapier in from the app's own bundle (a lazy chunk; the compat build carries its wasm inline), so nothing is
 * fetched from a CDN and a board project never loads it. Tells the Run bar `loading-physics` the first time.
 */
async function physicsModule(onState: MechDeps['onState']): Promise<RapierModule> {
  if (!physics) {
    onState('loading-physics');
    physics = import('@dimforge/rapier3d-deterministic-compat');
    physics.catch(() => (physics = null));
  }
  return physics;
}

/** Where a compiled program's analog pins read the circuit; set once the run's solver exists. */
type VoltsOf = ((pin: string) => number | null) | null;

/** The engines a worker has loaded, once per worker. */
let avr: Avr8js | null = null;
let rp2040: { lib: Rp2040js; bootrom: Uint32Array; create: typeof createRp2040Engine } | null = null;

const engineFailure = (message: string): SimDiagnostic[] => [simDiag('engine-load-failed', 'error', {}, { message })];

/**
 * Brings the engine a compiled program runs on in from the app's own bundle: avr8js for a hex, rp2040js and its boot
 * ROM for a UF2. A failure is the diagnostics that refuse the load.
 */
async function loadCompiled(kind: 'hex' | 'uf2'): Promise<SimDiagnostic[]> {
  if (kind === 'hex' ? avr : rp2040) return [];
  try {
    if (kind === 'hex') avr = await import('avr8js');
    else {
      const [lib, { createRp2040Engine: create }, { BOOTROM_B1: bootrom }] = await Promise.all([
        import('rp2040js'),
        import('@/sim/mcu/rp2040/engine'),
        import('@/sim/mcu/rp2040/bootrom'),
      ]);
      rp2040 = { lib, bootrom, create };
    }
    return [];
  } catch (error) {
    return engineFailure(error instanceof Error ? error.message : String(error));
  }
}

/** Never called: `prepareMech` is always handed the module, so it has nothing to download. */
const noDownload: MechDeps['loadEngine'] = () => Promise.reject(new Error('the headset loads physics from its own bundle'));

// The interpreter engines this handler made: the firmware engines have no Run world, and `in` cannot tell them apart.
const interpEngines = new WeakSet<SimEngine>();
const isInterp = (engine: SimEngine): engine is InterpEngine => interpEngines.has(engine);

export function createXrSimHandler(opts: XrHandlerOptions): WorkerHandler<SimReq, SimEv> {
  const parts = builtinRegistry();
  const describe = (id: string): Descriptor | undefined => {
    const [ref = '', version = ''] = id.split('@');
    return parts.get(ref, version);
  };
  let fidelity: Registry | null = null;
  const fidelityRegistry = (): Registry => (fidelity ??= loadRegistry());
  const latestPart = (ref: string): Descriptor | undefined => parts.latest(ref);

  // A firmware run's analog pins (the ADC) read the circuit through this, set once the run's solver exists.
  let firmwareVolts: VoltsOf = null;
  const unwired = {
    drive: () => undefined,
    mode: () => undefined,
    level: () => null,
    volts: (pin: string) => firmwareVolts?.(pin) ?? null,
  };

  function avrEngine(program: HexProgram, net: SimNetlist): SimEngine {
    const board = boardOf(net);
    const boardId = boardIdOf(board?.descriptor ?? '');
    if (!avr) throw new Error('the AVR engine is not loaded');
    if (!board || (boardId !== 'uno-r3' && boardId !== 'nano')) throw new Error(`${boardId} does not run on the AVR engine (an Uno or Nano hex)`);
    firmwareVolts = null;
    const supplyV = getProfile(boardId).logicV;
    const running: { engine?: AvrEngine } = {};
    const bus = netlistBus(net, board.id, supplyV, (part) => describe(part.descriptor), () => cyclesToNs(running.engine?.cycles ?? 0, RATE));
    const made = createFirmwareEngine(avr, {
      board: boardId,
      hex: program.hex,
      elf: program.elf,
      wiring: { pins: unwired, bus, busId: I2C_BUS, vref: supplyV },
      rangers: rangersOf(net),
    });
    if (!made.ok) throw new Error('message' in made.error ? made.error.message : made.error.kind);
    running.engine = made.engine;
    return made.engine;
  }

  function rp2040Engine(net: SimNetlist): SimEngine {
    const board = boardOf(net);
    const boardId = boardIdOf(board?.descriptor ?? '');
    if (!rp2040) throw new Error('the RP2040 engine is not loaded');
    if (!board || boardId !== 'pico') throw new Error(`${boardId} does not run on the RP2040 engine (a Pico UF2)`);
    firmwareVolts = null;
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

  return createSimHandler({
    diag: false,
    wallMs: opts.wallMs,
    schedule: opts.schedule,
    prepareCompiled: loadCompiled,
    makeEngine: (program, net, runOpts) => {
      if (program.kind === 'hex') return avrEngine(program, net);
      if (program.kind === 'uf2') return rp2040Engine(net);
      const board = boardOf(net);
      const boardId = boardIdOf(board?.descriptor ?? '');
      const interp = createInterpEngine({
        id: board?.id ?? 'mcu',
        board: boardId,
        language: INTERP_LANGUAGE[program.language as keyof typeof INTERP_LANGUAGE] ?? 'arduino',
        seed: runOpts.seed,
        rangers: rangersOf(net),
        i2cDevices: board
          ? (nowNs) => wiredI2cDevices(net, board.id, getProfile(boardId), (part) => describe(part.descriptor), nowNs)
          : undefined,
      });
      interpEngines.add(interp);
      return interp;
    },
    makeDigital: createDigitalNets,
    analog: {
      create: () => createRunAnalog(parts, fidelityRegistry()),
      bind: (engine, live: LiveAnalog, net) => {
        const board = boardOf(net);
        if (!board) return;
        if (isInterp(engine)) bindAnalog(engine, live, board.id, getProfile(boardIdOf(board.descriptor)));
        else firmwareVolts = (pin) => live.pinVolts(pinElementId(board.id, pin));
      },
    },
    makeTap: (net, _engine, live) =>
      createProbeTap({
        analog: live ?? noSolver,
        registry: fidelityRegistry(),
        modelOf: (id) => [...modelIdsOf(net.parts.find((p) => p.id === id)?.descriptor ?? '')],
      }),
    mech: {
      prepare: async (doc, net, onState) => {
        let module: RapierModule;
        try {
          module = await physicsModule(onState);
        } catch (error) {
          const message = `the physics engine did not load: ${error instanceof Error ? error.message : String(error)}`;
          onState('failed', { reason: message });
          return fail({ code: 'load-failed' as const, message });
        }
        return prepareMech(doc, net, { loadEngine: noDownload, module, describe: latestPart, onState });
      },
      runIo: (net) => packRunIo(net, latestPart),
      report: (doc) => robotReport(doc, latestPart, buildSimNetlist(doc, parts).net),
    },
    faults: { describe, rules: defaultRules },
  });
}
