/**
 * Materials the pillar may change. Placements share their geometry and materials (contracts/assets.ts), and the shelf
 * shows the same assets, so a fade or a lens on one placement must never write a shared material. `ownMaterials`
 * gives every mesh under a root its own clone (one clone per original under that root) and puts the originals back on
 * `restore`. `setOpacity` fades any material, including a ShaderMaterial with an `opacity` uniform.
 */
import type { Material, Mesh, Object3D } from '@iwsdk/core';

export interface OwnedMaterials {
  /** Original to clone. */
  readonly clones: ReadonlyMap<Material, Material>;
  /** Puts the original materials back and disposes the clones. Harmless twice. */
  restore(): void;
}

const isMesh = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;

/**
 * Clones the material of every mesh under `root` (that `filter` accepts) and assigns the clones. A mesh already
 * holding a clone made by an earlier, unrestored call keeps it, so nested owners compose.
 */
export function ownMaterials(root: Object3D, filter: (mesh: Mesh) => boolean = () => true): OwnedMaterials {
  const clones = new Map<Material, Material>();
  const swapped: Array<{ mesh: Mesh; original: Material | Material[] }> = [];
  const own = (m: Material): Material => {
    if (m.userData.scaleOwned === true) return m;
    let c = clones.get(m);
    if (!c) {
      c = m.clone();
      c.userData = { ...m.userData, scaleOwned: true };
      clones.set(m, c);
    }
    return c;
  };
  root.traverse((o) => {
    if (!isMesh(o) || !filter(o)) return;
    const original = o.material;
    const owned = (m: Material) => m.userData.scaleOwned === true;
    if (Array.isArray(original) ? original.every(owned) : owned(original)) return;
    swapped.push({ mesh: o, original });
    o.material = Array.isArray(original) ? original.map(own) : own(original);
  });
  let done = false;
  return {
    clones,
    restore() {
      if (done) return;
      done = true;
      for (const { mesh, original } of swapped) mesh.material = original;
      for (const c of clones.values()) c.dispose();
    },
  };
}

interface Fadeable {
  opacity: number;
  transparent: boolean;
  needsUpdate: boolean;
  userData: Record<string, unknown>;
  uniforms?: Record<string, { value: unknown }>;
}

/**
 * Sets a material's opacity (0..1). Below 1 it is drawn transparent; back at 1 it returns to how it was. Changing
 * `transparent` changes the shader program, so `needsUpdate` is set only when that flips.
 */
export function setOpacity(material: Material, opacity: number): void {
  const m = material as unknown as Fadeable;
  const a = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  if (m.userData.scaleRest === undefined) m.userData.scaleRest = { opacity: m.opacity, transparent: m.transparent };
  const rest = m.userData.scaleRest as { opacity: number; transparent: boolean };
  const transparent = a < 1 ? true : rest.transparent;
  m.opacity = a < 1 ? a * rest.opacity : rest.opacity;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.needsUpdate = true;
  }
  const u = m.uniforms?.opacity;
  if (u && typeof u.value === 'number') u.value = m.opacity;
}

/** `setOpacity` on every material of every mesh under `root`. Use on owned materials only. */
export function fadeTree(root: Object3D, opacity: number): void {
  root.traverse((o) => {
    if (!isMesh(o)) return;
    const m = o.material;
    if (Array.isArray(m)) for (const x of m) setOpacity(x, opacity);
    else setOpacity(m, opacity);
  });
}
