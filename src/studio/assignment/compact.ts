import { canonicalize } from "../../core/canonical.ts";
import { interfaceOf } from "../../parts/pins.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import type { ComponentDependency, Project } from "../../project/generated/types.ts";
import { chainStart } from "../../project/hash.ts";

type Parts = Pick<PartRegistry, "get">;

/**
 * A snapshot a reader can rebuild: the same pins with the same types and classes, the same groups. The snapshots that
 * came with the shipped starters are older than `interfaceOf` and lack its positions, so equality of text would never hold.
 */
function pinned(dep: ComponentDependency, parts: Parts): boolean {
  const part = parts.get(dep.ref, dep.version);
  if (dep.origin !== "builtin" || part === undefined) return false;
  const now = interfaceOf(part);
  const kept = dep.interface;
  return (
    kept.role === now.role &&
    kept.pins.length === now.pins.length &&
    kept.pins.every((p, i) => p.id === now.pins[i]!.id && p.type === now.pins[i]!.type && p.class === now.pins[i]!.class) &&
    canonicalize(kept.groups ?? []) === canonicalize(now.groups ?? [])
  );
}

/**
 * The project without what a reader can derive: the pinned interface of every shipped part (the bulk of a small project),
 * the history and the exports. A link and a submission carry this form.
 */
export function compactProject(project: Project, parts: Parts): Project {
  const meta = { ...project.meta };
  delete meta.thumbnail;
  const compact: Project = {
    ...project,
    meta,
    dependencies: { ...project.dependencies, components: project.dependencies.components.filter((dep) => !pinned(dep, parts)) },
    history: { baseRevision: project.revision, baseChain: chainStart(project.id), checkpoints: [], ops: [] },
  };
  delete compact.exports;
  return compact;
}

/** Puts back the interface of every shipped part the project uses and does not pin. A part this build does not ship stays missing. */
export function expandProject(project: Project, parts: Parts): Project {
  const have = new Set(project.dependencies.components.map((d) => `${d.ref}@${d.version}`));
  const added: ComponentDependency[] = [];
  for (const { definition } of [...project.boards, ...project.components]) {
    const key = `${definition.ref}@${definition.version}`;
    const part = have.has(key) ? undefined : parts.get(definition.ref, definition.version);
    if (!part) continue;
    have.add(key);
    added.push({ ref: definition.ref, version: definition.version, origin: "builtin", interface: interfaceOf(part) });
  }
  return added.length === 0 ? project : { ...project, dependencies: { ...project.dependencies, components: [...project.dependencies.components, ...added] } };
}
