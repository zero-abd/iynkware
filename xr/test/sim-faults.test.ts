/**
 * The document's faults reach the run: the bridge applies `doc.simulation.faults` at load (iynk's `applyFaults`), so an
 * injected open wire, a reversed LED or a wrong pin in the sketch changes what the Blink template does, and taking the
 * fault out (or switching it off) gives the blinking LED back. Inline handler, stepped by hand.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { getAppRegistry } from '@/parts/builtin';
import type { Fault, Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import { listCandidates } from '@/sim/faults/generate';
import { buildNetView } from '@/sim/faults/netlist-view';
import { buildSimNetlist } from '@/sim/netlist';
import type { SimBridge } from '../src/contracts/sim';
import { createSimBridge, inlinePort } from '../src/sim/bridge';
import { describeWith, faultCtxOf, withFaults } from '../src/sim/faults';

let doc: Project;

beforeAll(async () => {
  const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
  if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
  doc = report.doc;
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const bridgeOf = () => createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
const lit = (b: SimBridge) => {
  const s = b.lastFrame?.parts.get('cmp_led1');
  return s?.kind === 'led' ? s.lit : undefined;
};

/** The generators' fault of `kind` on `part`, as the fault lab offers it. */
function candidate(kind: Fault['kind'], part: string): Fault {
  const { net } = buildSimNetlist(doc, getAppRegistry());
  const view = buildNetView(net, describeWith(getAppRegistry()));
  const sources = Object.fromEntries(doc.sources.map((s) => [s.path, s.content]));
  const found = listCandidates(doc, view, sources).filter((c) => c.fault.kind === kind && c.label.part === part);
  if (found.length === 0) throw new Error(`no ${kind} candidate on ${part}`);
  return found.sort((a, b) => (a.fault.id < b.fault.id ? -1 : 1))[0]!.fault;
}

const withFault = (fault: Fault, enabled = true): Project => ({
  ...doc,
  simulation: { ...doc.simulation, faults: [...doc.simulation.faults, { ...fault, enabled }] },
});

/** LED lit at 100, 600, 1100 and 1600 ms of the run: Blink is on, off, on, off. */
async function litPattern(d: Project): Promise<Array<boolean | undefined>> {
  const b = bridgeOf();
  const r = await b.load(d);
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  const out: Array<boolean | undefined> = [];
  await b.step(100);
  out.push(lit(b));
  for (let i = 0; i < 3; i++) {
    await b.step(500);
    out.push(lit(b));
  }
  await b.dispose();
  await settle();
  return out;
}

describe('faults in the run', () => {
  it('runs Blink unchanged with no faults', async () => {
    expect(await litPattern(doc)).toEqual([true, false, true, false]);
  });

  it('an open wire on the LED keeps it dark', async () => {
    expect(await litPattern(withFault(candidate('open-wire', 'cmp_led1')))).toEqual([false, false, false, false]);
  });

  it('a reversed LED stays dark', async () => {
    expect(await litPattern(withFault(candidate('reversed-part', 'cmp_led1')))).toEqual([false, false, false, false]);
  });

  it('a wrong pin in the sketch leaves the LED dark', async () => {
    expect(await litPattern(withFault(candidate('config', 'brd_main')))).toEqual([false, false, false, false]);
  });

  it('a switched-off fault does nothing', async () => {
    expect(await litPattern(withFault(candidate('open-wire', 'cmp_led1'), false))).toEqual([true, false, true, false]);
  });

  it('the netlist the run exposes is the broken one', async () => {
    const fault = candidate('open-wire', 'cmp_led1');
    const b = bridgeOf();
    await b.load(withFault(fault));
    const base = buildSimNetlist(doc, getAppRegistry()).net;
    const pinsNow = b.netlist!.parts.find((p) => p.id === 'cmp_led1')!.pins;
    const pinsBefore = base.parts.find((p) => p.id === 'cmp_led1')!.pins;
    expect(pinsNow).not.toEqual(pinsBefore);
    await b.dispose();
  });

  it('a fault that no longer fits the circuit is left out with a warning, and the run still loads', async () => {
    const stale: Fault = { ...candidate('open-wire', 'cmp_led1'), id: 'flt_stale', target: { component: 'cmp_gone', pin: 'A' } };
    const b = bridgeOf();
    const r = await b.load(withFault(stale));
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.id === 'fault-not-applied' && d.severity === 'warning')).toBe(true);
    await b.dispose();
  });

  it('withFaults leaves the circuit alone without faults and reports what it applied', () => {
    const registry = getAppRegistry();
    const { net } = buildSimNetlist(doc, registry);
    const sources = Object.fromEntries(doc.sources.map((s) => [s.path, s.content]));
    expect(withFaults(doc, net, sources, registry)).toEqual({ net, sources, applied: [], diagnostics: [] });
    const fault = candidate('open-wire', 'cmp_led1');
    expect(withFaults(withFault(fault), net, sources, registry).applied).toEqual([fault.id]);
    const ctx = faultCtxOf(buildNetView(net, describeWith(registry)), registry, doc);
    expect(ctx.ids.resistor.startsWith('core.resistor@')).toBe(true);
  });
});
