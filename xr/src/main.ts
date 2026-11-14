/**
 * Boot: create the IWSDK world with the session the app uses (passthrough MR by default, the VR studio as fallback) and
 * offer Enter. The walking skeleton builds the app services (`app.ts`) and mounts the pillar modules here.
 */
import { ReferenceSpaceType, SessionMode, World } from '@iwsdk/core';

const statusEl = document.getElementById('status')!;
const enterEl = document.getElementById('enter') as HTMLButtonElement;

async function main() {
  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      referenceSpace: ReferenceSpaceType.LocalFloor,
      features: { handTracking: true, layers: true },
      offer: 'always',
    },
    input: { canvasPointerEvents: true },
    render: { fov: 60, near: 0.01, far: 50, camera: { position: [0, 1.2, 0.3], lookAt: [0, 0.74, -0.6] } },
    features: { grabbing: { useHandPinchForGrab: true }, locomotion: false, physics: false, spatialUI: false },
  });
  (window as unknown as { iynkware: unknown }).iynkware = { world };

  const ar = await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false);
  const vr = ar ? false : await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false);
  enterEl.disabled = !(ar || vr);
  enterEl.textContent = ar ? 'Enter MR' : 'Enter VR';
  enterEl.onclick = () => world.launchXR(ar ? {} : { sessionMode: SessionMode.ImmersiveVR });
  statusEl.textContent = ar || vr ? 'Ready.' : 'This browser has no immersive mode.';
}

main().catch((err) => {
  statusEl.textContent = `Failed: ${(err as Error).message}`;
  console.error(err);
});
