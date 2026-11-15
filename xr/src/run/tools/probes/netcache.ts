/**
 * The net lookup for the run in the bridge: rebuilt when the run's netlist or the document changes, shared by the
 * meter and the scope so one build serves both.
 */
import type { XrApp } from '../../../contracts/app';
import type { SimNetlist } from '../../../contracts/sim';
import { netIndex, type NetIndex } from './nets';

export interface NetLookup {
  /** The lookup for the current run, or null before one is loaded. */
  current(): NetIndex | null;
  /** The loaded netlist, or null. */
  readonly netlist: SimNetlist | null;
  /** A name for a net (`D13`), when the document gave one. */
  nameOf(net: string): string | null;
}

export function createNetLookup(app: Pick<XrApp, 'sim' | 'project'>): NetLookup {
  let index: NetIndex | null = null;
  let builtFor: { nl: SimNetlist | null; revision: number } = { nl: null, revision: -1 };
  return {
    current() {
      const nl = app.sim.netlist;
      if (nl === null) {
        index = null;
        builtFor = { nl: null, revision: -1 };
        return null;
      }
      if (builtFor.nl !== nl || builtFor.revision !== app.project.revision) {
        index = netIndex(app.project.doc, nl);
        builtFor = { nl, revision: app.project.revision };
      }
      return index;
    },
    get netlist() {
      return app.sim.netlist;
    },
    nameOf(net) {
      return app.sim.netlist?.nets.find((n) => n.id === net)?.name ?? null;
    },
  };
}
