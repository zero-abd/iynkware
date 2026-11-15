/**
 * Binding an object to the input service makes IWSDK entities of it and of the plain objects above it (`input/service.ts`
 * `ensureEntity`), and IWSDK keeps an entity's object under its parent entity's, putting a loose one back under the
 * level root. So `removeFromParent` alone does not take a bound object out of the scene: its entities are destroyed
 * first, which does.
 */
import type { Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';

interface Destroyable {
  destroy(): void;
  active: boolean;
}

/** Destroys the entities of `object` and everything under it, then takes it out of its parent. */
export function removeBound(app: Pick<XrApp, 'world'>, object: Object3D): void {
  const found: Destroyable[] = [];
  object.traverse((o) => {
    const idx = (o as Object3D & { entityIdx?: number }).entityIdx;
    const e = idx === undefined ? undefined : (app.world.entityManager.getEntityByIndex(idx) as Destroyable | undefined);
    if (e) found.push(e);
  });
  for (const e of found) if (e.active) e.destroy();
  object.removeFromParent();
}
