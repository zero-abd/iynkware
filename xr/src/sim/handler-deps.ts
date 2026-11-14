/**
 * The XR app's sim handler: iynk's `createSimHandler` (imported, not copied) with the interpreter engine, the digital
 * nets, the circuit solver, the probe tap (for `meter.read`), the fault rules and robot physics (the sim host's
 * mechanical engine on rapier, loaded only when a robot project loads). Firmware engines (avr8js, rp2040js) are not
 * wired yet (see docs/XR_ARCHITECTURE.md, "Imported and ported").
 *
 * Pure: runs in the worker (sim.worker.ts) and inline in the headless test, so both see the same handler.
 */
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
import { packRunIo, prepareMech, rangersOf, robotReport } from '@/sim-host/mech';
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

/**
 * The physics module, bundled from npm (the compat build carries its wasm inline), so nothing is fetched at runtime.
 * Imported on the first robot load only: a board project never pays for it, and the build keeps it in its own chunk.
 */
let physics: Promise<RapierModule> | null = null;
const loadPhysics = (): Promise<RapierModule> => (physics ??= import('@dimforge/rapier3d-deterministic-compat'));
const offline = () => Promise.reject(new Error('the headset bundles its physics module; it never downloads one'));

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

export function createXrSimHandler(opts: XrHandlerOptions): WorkerHandler<SimReq, SimEv> {
  const parts = builtinRegistry();
  const describe = (id: string): Descriptor | undefined => {
    const [ref = '', version = ''] = id.split('@');
    return parts.get(ref, version);
  };
  /** The newest descriptor of a ref, as iynk's worker resolves robot parts (`latestPart`). */
  const latest = (ref: string): Descriptor | undefined => parts.latest(ref);
  let fidelity: Registry | null = null;
  const fidelityRegistry = (): Registry => (fidelity ??= loadRegistry());

  return createSimHandler({
    diag: false,
    wallMs: opts.wallMs,
    schedule: opts.schedule,
    // Only the interpreter is wired, so every engine here is an InterpEngine.
    makeEngine: (program, net, runOpts) => {
      if (program.kind !== 'source') throw new Error('compiled firmware does not run in the headset yet');
      const board = boardOf(net);
      const boardId = boardIdOf(board?.descriptor ?? '');
      return createInterpEngine({
        id: board?.id ?? 'mcu',
        board: boardId,
        language: INTERP_LANGUAGE[program.language as keyof typeof INTERP_LANGUAGE] ?? 'arduino',
        seed: runOpts.seed,
        rangers: rangersOf(net),
        i2cDevices: board
          ? (nowNs) => wiredI2cDevices(net, board.id, getProfile(boardId), (part) => describe(part.descriptor), nowNs)
          : undefined,
      });
    },
    makeDigital: createDigitalNets,
    analog: {
      create: () => createRunAnalog(parts, fidelityRegistry()),
      bind: (engine, live: LiveAnalog, net) => {
        const board = boardOf(net);
        if (board) bindAnalog(engine as InterpEngine, live, board.id, getProfile(boardIdOf(board.descriptor)));
      },
    },
    makeTap: (net, _engine, live) =>
      createProbeTap({
        analog: live ?? noSolver,
        registry: fidelityRegistry(),
        modelOf: (id) => [...modelIdsOf(net.parts.find((p) => p.id === id)?.descriptor ?? '')],
      }),
    mech: {
      prepare: async (doc, net, onState) =>
        prepareMech(doc, net, { loadEngine: offline, module: await loadPhysics(), describe: latest, onState }),
      runIo: (net) => packRunIo(net, latest),
      report: (doc) => robotReport(doc, latest, buildSimNetlist(doc, parts).net),
    },
    faults: { describe, rules: defaultRules },
  });
}
