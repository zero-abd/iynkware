/**
 * The XR app's sim handler: iynk's `createSimHandler` (imported, not copied) with the interpreter engine, the digital
 * nets, the circuit solver, the probe tap (for `meter.read`), the fault rules and robot physics (rapier). Firmware
 * engines (avr8js, rp2040js) are not wired yet (see docs/XR_ARCHITECTURE.md, "Imported and ported").
 *
 * Pure: runs in the worker (sim.worker.ts) and inline in the headless test, so both see the same handler.
 */
import { fail } from '@/core/result';
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

/** Never called: `prepareMech` is always handed the module, so it has nothing to download. */
const noDownload: MechDeps['loadEngine'] = () => Promise.reject(new Error('the headset loads physics from its own bundle'));

export function createXrSimHandler(opts: XrHandlerOptions): WorkerHandler<SimReq, SimEv> {
  const parts = builtinRegistry();
  const describe = (id: string): Descriptor | undefined => {
    const [ref = '', version = ''] = id.split('@');
    return parts.get(ref, version);
  };
  let fidelity: Registry | null = null;
  const fidelityRegistry = (): Registry => (fidelity ??= loadRegistry());
  const latestPart = (ref: string): Descriptor | undefined => parts.latest(ref);

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
