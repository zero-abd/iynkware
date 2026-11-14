/**
 * Boot: create the IWSDK world (passthrough MR by default, the VR studio as fallback), build the app services around
 * the starting project, mount every pillar's module, and offer Enter.
 */
import { DirectionalLight, HemisphereLight, ReferenceSpaceType, SessionMode, VisibilityState, World } from '@iwsdk/core';
import { createApp } from './app';
import { FEATURES } from './features';
import { createTemplateSource } from './project/store';

/** The project the skeleton opens: iynk's Uno Blink template. `?project=<template id>` opens another. */
const START = new URLSearchParams(location.search).get('project') ?? 'prj_uno-r3-blink';

const statusEl = document.getElementById('status')!;
const enterEl = document.getElementById('enter') as HTMLButtonElement;
const say = (text: string) => {
  statusEl.textContent = text;
  console.info('[iynkware]', text);
};

async function main() {
  say('Loading the project');
  const doc = await createTemplateSource().load(START);

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

  // No scene JSON, so no image based light: two plain lights.
  world.scene.add(new HemisphereLight(0xfff6e8, 0x6b6150, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.6, 2, 1);
  world.scene.add(sun);

  const handle = createApp(world, doc);
  await handle.ready;
  await handle.mount(FEATURES);

  world.visibilityState.subscribe((v) => {
    const immersive = v !== VisibilityState.NonImmersive;
    document.getElementById('shell')!.style.display = immersive ? 'none' : 'flex';
    handle.setMode(immersive ? (world.session?.environmentBlendMode === 'opaque' ? 'vr' : 'mr') : 'flat');
    const s = world.session as (XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?(r: number): Promise<void> }) | undefined;
    const want = handle.app.settings.xr.value.refresh;
    if (immersive && s?.updateTargetFrameRate && Array.from(s.supportedFrameRates ?? []).includes(want)) void s.updateTargetFrameRate(want).catch(() => undefined);
    if (v === VisibilityState.VisibleBlurred && handle.app.sim.state === 'running') void handle.app.sim.pause();
  });

  (window as unknown as { iynkware: unknown }).iynkware = { world, ...handle };

  const ar = await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false);
  const vr = ar ? false : await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false);
  const wantVr = handle.app.settings.xr.value.space === 'vr';
  enterEl.disabled = !(ar || vr);
  enterEl.textContent = ar && !wantVr ? 'Enter MR' : 'Enter VR';
  enterEl.onclick = () => world.launchXR(ar && !wantVr ? {} : { sessionMode: SessionMode.ImmersiveVR });
  say(ar || vr ? 'Ready. Press Enter, then point at Run: trigger or pinch.' : 'Ready. This browser has no immersive mode; click Run to try the simulation.');
}

main().catch((err) => {
  say(`Failed: ${(err as Error).message}`);
  console.error(err);
});
