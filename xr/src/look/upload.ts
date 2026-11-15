/**
 * GPU uploads and shader warm-up outside the render pass. On Quest the renderer draws both eyes in one multiview pass,
 * and inside it super-three defers texture uploads: a texture the GPU has never seen (new, or re-made after
 * `dispose()`) binds nothing and samples black for that frame, and a shader seen for the first time compiles
 * synchronously mid-frame. Desktop IWER has no multiview, so neither shows there.
 *
 *   const tex = new CanvasTexture(canvas);  draw(canvas);  tex.needsUpdate = true;  uploadNow(tex);
 *   warmUp(app.world);   // after a scene is built: starts compiling its programs before they first draw
 *
 * The look module binds the world's renderer when it mounts; until then (and in tests) both are no-ops.
 */
import type { Camera, Object3D, Texture, WebGLRenderer, World } from '@iwsdk/core';

type Renderer = Pick<WebGLRenderer, 'initTexture' | 'compile'>;

let renderer: Renderer | null = null;

/** Binds the renderer uploads go through; returns the unbinding. */
export function bindUploads(r: Renderer | null | undefined): () => void {
  renderer = r ?? null;
  return () => {
    if (renderer === r) renderer = null;
  };
}

/**
 * Uploads `tex` now if it changed since its last upload (`needsUpdate` was set), so the next frame samples it instead
 * of black. Outside the render pass only; inside it the upload is queued as before.
 */
export function uploadNow(tex: Texture): void {
  if (!renderer || tex.version === 0) return;
  try {
    renderer.initTexture(tex);
  } catch (err) {
    console.warn('[look] texture upload', err);
  }
}

/**
 * Starts compiling every program `root` (default the whole scene) needs, so its first frame does not stall: the
 * driver compiles in the background (in parallel with KHR_parallel_shader_compile) and three only waits on a program
 * when it first draws with it. Inside an immersive session the multiview target is current, so the multiview
 * variants are the ones compiled. `compile`, not `compileAsync`: the latter's polling throws when a material is
 * disposed before its program is ready.
 */
export function warmUp(world: Pick<World, 'scene' | 'camera'>, root: Object3D = world.scene): void {
  if (!renderer) return;
  try {
    renderer.compile(root, world.camera as Camera, world.scene);
  } catch {
    // a material the renderer cannot prepare yet: it compiles on first use as before
  }
}
