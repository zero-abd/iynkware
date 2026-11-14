/**
 * Entities for kit objects. IWSDK keeps an entity's object directly under its parent entity's object: an entity added
 * to a plain Group (no entity) is moved to the level root on the next frame, and `input.bind` gives a parentless
 * object's root an entity there. So every kit root (a panel, its body, a button) gets its own persistent entity when it
 * is made, controls are only added to objects that have one, and disposing destroys the entities deepest first (a
 * destroyed parent would send its children to the level root).
 */
import type { Object3D, World } from '@iwsdk/core';

type Indexed = Object3D & { entityIdx?: number };

/** The entity of `o` if it has one. */
function entityOf(world: World, o: Object3D) {
  const idx = (o as Indexed).entityIdx;
  if (idx === undefined) return undefined;
  const e = world.entityManager.getEntityByIndex(idx);
  return e && e.active && e.object3D === o ? e : undefined;
}

/**
 * Gives `o` a persistent entity (it survives level changes), under `parent`'s entity when given (which must have one)
 * or under the scene. A parentless `o` is added to the scene by this; keep it invisible until it is placed.
 */
export function ownEntity(world: World, o: Object3D, parent?: Object3D): void {
  if (entityOf(world, o)) return;
  const pe = parent ? entityOf(world, parent) : undefined;
  if (parent && !pe) throw new Error(`[shell/kit] ${o.name || 'object'}: parent ${parent.name || 'object'} has no entity`);
  if (pe) world.createTransformEntity(o, { parent: pe, persistent: true });
  else world.createTransformEntity(o, { persistent: true });
}

/** Destroys every entity in `root`'s subtree, deepest first, and takes `root` out of the scene. */
export function dropEntities(world: World, root: Object3D): void {
  const found: Array<{ o: Object3D; depth: number }> = [];
  const walk = (o: Object3D, depth: number) => {
    if (entityOf(world, o)) found.push({ o, depth });
    for (const c of o.children) walk(c, depth + 1);
  };
  walk(root, 0);
  found.sort((a, b) => b.depth - a.depth);
  for (const { o } of found) entityOf(world, o)?.destroy();
  root.removeFromParent();
}
