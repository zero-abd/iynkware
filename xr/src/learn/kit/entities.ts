/**
 * Binding an object through `app.input.bind` gives it (and its plain ancestors) IWSDK entities, which the input service
 * keeps after unbinding. A panel that goes away destroys them, deepest first, after its unbinds; otherwise IWSDK puts
 * the removed objects back under the level root.
 *
 * Usage: offs.forEach((off) => off()); releaseEntities(app.world, panel.group); panel.group.removeFromParent();
 */
import type { Object3D, World } from '@iwsdk/core';

export function releaseEntities(world: World, root: Object3D): void {
  const list: Object3D[] = [];
  root.traverse((o) => void list.push(o));
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i]!;
    const idx = (o as Object3D & { entityIdx?: number }).entityIdx;
    if (idx === undefined) continue;
    const e = world.entityManager.getEntityByIndex(idx);
    if (e && e.active && e.object3D === o) e.destroy();
  }
}
