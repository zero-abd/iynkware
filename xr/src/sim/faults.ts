/**
 * The document's faults as the run sees them. `SimBridge.load` builds the netlist from the document as drawn and then
 * applies `doc.simulation.faults` with iynk's `applyFaults` (src/sim/faults/apply.ts): structural faults (open, short,
 * swap, value, polarity) change the netlist, a `code-pin` fault edits the sketch. The document is never touched.
 *
 * `faultCtxOf` is the context iynk's fault ops need about a circuit; the fault lab (xr/src/run/faults) uses the same one
 * to list the faults it can inject, so what the lab offers is exactly what the run applies.
 */
import type { Descriptor } from '@/parts/descriptor';
import type { PartRegistry } from '@/parts/registry';
import type { Project } from '@/project/generated/types';
import { simDiag } from '@/sim/core/diagnostic';
import type { SimDiagnostic, SimNetlist } from '@/sim/engine';
import { applyFaults, type ApplyCtx } from '@/sim/faults/apply';
import { buildNetView } from '@/sim/faults/netlist-view';
import type { NetView } from '@/sim/faults/types';

/** A descriptor id as the netlist holds it (`core.led-5mm@1.0.0`) to its descriptor. */
export function describeWith(registry: Pick<PartRegistry, 'get'>): (id: string) => Descriptor | undefined {
  return (id) => {
    const [ref = '', version = ''] = id.split('@');
    return registry.get(ref, version);
  };
}

/** The netlist keeps a setting that points at a project parameter (`{ param }`); fault ops want its number. */
function paramNumber(doc: Pick<Project, 'parameters'>, v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (v !== null && typeof v === 'object' && 'param' in v) {
    const found = doc.parameters.find((p) => p.id === (v as { param: string }).param)?.value;
    return typeof found === 'number' ? found : undefined;
  }
  return undefined;
}

/** What iynk's `faultToOps` and `applyFaults` need to know about the circuit `view` describes. */
export function faultCtxOf(view: NetView, registry: Pick<PartRegistry, 'latest'>, doc: Pick<Project, 'parameters'>): ApplyCtx {
  const polePins = (part: string) => (view.descriptor(part)?.pins ?? []).filter((p) => p.polarity);
  return {
    partPins: (part) => (view.descriptor(part)?.pins ?? []).map((p) => ({ part, pin: p.id })),
    pinNet: (p) => view.pin(p.part, p.pin)?.net ?? null,
    boardPinsOn: (net) =>
      view
        .pinsOn(net)
        .filter((p) => view.isBoard(p.part))
        .map(({ part, pin }) => ({ part, pin })),
    isPolarised: (part) => polePins(part).length > 0,
    paramValue: (part, param) => paramNumber(doc, view.param(part, param)),
    supplyParam: () => undefined,
    secondsToNs: (s) => Math.round(s * 1e9),
    ids: {
      resistor: `core.resistor@${registry.latest('core.resistor')?.version ?? ''}`,
      resistanceParam: 'ohms',
      polarPins: (part) => {
        const [a, b] = polePins(part);
        return a && b ? [a.id, b.id] : undefined;
      },
    },
  };
}

export interface FaultedSetup {
  net: SimNetlist;
  /** Source path to text, with any `code-pin` fault's edit in. */
  sources: Record<string, string>;
  /** Ids of the faults that are in the run. */
  applied: string[];
  /** One warning per enabled fault that could not be applied (it is left out; the rest still apply). */
  diagnostics: SimDiagnostic[];
}

/**
 * The circuit and sources of a run of `doc` with its enabled faults in, in document order. A fault that does not apply
 * (its part was removed, a pin it names has no net) is left out with a warning instead of refusing the run.
 */
export function withFaults(
  doc: Project,
  net: SimNetlist,
  sources: Record<string, string>,
  registry: Pick<PartRegistry, 'get' | 'latest'>,
): FaultedSetup {
  const enabled = doc.simulation.faults.filter((f) => f.enabled);
  if (enabled.length === 0) return { net, sources, applied: [], diagnostics: [] };
  let setup = { net, sources };
  const applied: string[] = [];
  const diagnostics: SimDiagnostic[] = [];
  for (const fault of enabled) {
    // The context follows the circuit as each fault changes it, so a later fault sees the earlier ones.
    const ctx = faultCtxOf(buildNetView(setup.net, describeWith(registry)), registry, doc);
    const r = applyFaults(setup, [fault], ctx, 0);
    if (r.ok) {
      setup = { net: r.value.net, sources: r.value.sources };
      applied.push(fault.id);
    } else {
      diagnostics.push(simDiag('fault-not-applied', 'warning', {}, { message: `fault ${fault.id} was left out: ${r.error.message}` }));
    }
  }
  return { ...setup, applied, diagnostics };
}
