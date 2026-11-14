/**
 * The empty bench a "Build it with me" run starts from: the target project with nothing on the bench. Its code,
 * checks, parameters and dependencies stay, and so do its boards and its breadboard as entities, unplaced (the code
 * runs on the board, and the breadboard view keeps its surface, so placing and unplacing them is one ordinary undoable
 * op each). Every other part, every net and everything drawn in the views goes. A fresh document at revision 0.
 */
import { chainStart } from '@/project/hash';
import type { Project } from '../contracts/project';

type Simulation = Project['simulation'];

export function emptyBench(target: Project): Project {
  const doc = JSON.parse(JSON.stringify(target)) as Project;
  const surfaces = new Set(doc.views.flatMap((v) => (v.surface ? [v.surface] : [])));
  doc.components = doc.components.filter((c) => surfaces.has(c.id));
  const kept = new Set([...doc.boards.map((b) => b.id), ...doc.components.map((c) => c.id)]);
  doc.nets = [];
  doc.views = doc.views.map((v) => {
    const { junctions: _j, groups: _g, labels: _l, ...rest } = v;
    return { ...rest, placements: [], wires: [] };
  });
  doc.simulation = strippedSimulation(doc.simulation, kept);
  doc.revision = 0;
  doc.history = { baseRevision: 0, baseChain: chainStart(doc.id), checkpoints: [], ops: [] };
  delete doc.exports;
  return doc;
}

/** World inputs on a part that went, and their script events, go too; an empty bench has no fault injected. */
function strippedSimulation(sim: Simulation, kept: ReadonlySet<string>): Simulation {
  const inputs = sim.world.inputs.filter((i) => kept.has(i.component));
  const inputIds = new Set(inputs.map((i) => i.id));
  const script = sim.world.script.filter((e) => inputIds.has(e.input));
  return { ...sim, world: { ...sim.world, inputs, script }, faults: [] };
}
