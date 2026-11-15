/**
 * Boot, on demand: the 2D entry page (`xr/src/shell/entry/`) imports this module only when the person presses Enter or
 * Open on this screen, so the page stays light. `boot` creates the IWSDK world (passthrough MR by default; the paper
 * room is drawn inside the same AR session), builds the app services around the starting project, mounts every
 * pillar's module and hands back `enter()`. Nothing runs on import. The page owns every word and every DOM change;
 * this module reports stages only.
 */
import { DirectionalLight, HemisphereLight, ReferenceSpaceType, SessionMode, VisibilityState, World } from '@iwsdk/core';
import { createApp, type AppHandle } from './app';
import type { Project } from './contracts/project';
import { FEATURES } from './features';
import { onLookFrame } from './look/runner';
import { warmUp } from './look/upload';
import { createTemplateSource } from './project/store';

export type BootStage = 'project' | 'world' | 'bench' | 'ready';

export interface BootOptions {
  /** Where the canvas goes (`#scene-container`). */
  container: HTMLElement;
  /** Called as each stage starts; `ready` when the bench is mounted and `enter()` may be called. */
  onStage?(stage: BootStage): void;
  /** The project to open; without it, the template named by `?project=` (default Uno Blink). */
  doc?: Project;
}

export interface Booted {
  readonly world: World;
  readonly handle: AppHandle;
  /**
   * Asks for an immersive session: `immersive-ar` when the browser offers it (passthrough, and the paper room inside
   * it), else `immersive-vr`. Call it from a click handler: the request is made synchronously, inside the click's user
   * activation. Resolves true once the session runs, false when it was refused or failed.
   */
  enter(): Promise<boolean>;
}

/** The project the bench opens: iynk's Uno Blink template. `?project=<template id>` opens another. */
const startProject = () => new URLSearchParams(globalThis.location?.search ?? '').get('project') ?? 'prj_uno-r3-blink';

type FrameRateSession = XRSession & { supportedFrameRates?: Float32Array; updateTargetFrameRate?(rate: number): Promise<void> };

/** Resolves when the world's session request settles: true with a session, false without one. */
function settled(world: World): Promise<boolean> {
  return new Promise((resolve) => {
    const poll = () => {
      if (world.session) resolve(true);
      else if (!world.sessionRequestPending) resolve(false);
      else setTimeout(poll, 50);
    };
    poll();
  });
}

export async function boot(opts: BootOptions): Promise<Booted> {
  const stage = (s: BootStage) => opts.onStage?.(s);

  stage('project');
  const doc = opts.doc ?? (await createTemplateSource().load(startProject()));
  // Asked once here, so `enter()` has no await before its session request.
  const arSupported = (await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false)) ?? false;

  stage('world');
  const world = await World.create(opts.container as HTMLDivElement, {
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

  // The shader error check waits on each new program's link status when it first draws: a stall a build can skip.
  if (!import.meta.env.DEV) world.renderer.debug.checkShaderErrors = false;

  // No scene JSON, so no image based light: two plain lights.
  world.scene.add(new HemisphereLight(0xfff6e8, 0x6b6150, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.6, 2, 1);
  world.scene.add(sun);

  stage('bench');
  const handle = createApp(world, doc);
  await handle.ready;
  await handle.mount(FEATURES);
  // Start compiling what the bench draws before it first draws; again in the session, whose multiview programs differ.
  warmUp(world);

  world.visibilityState.subscribe((v) => {
    const immersive = v !== VisibilityState.NonImmersive;
    handle.setMode(immersive ? (world.session?.environmentBlendMode === 'opaque' ? 'vr' : 'mr') : 'flat');
    const s = world.session as FrameRateSession | undefined;
    const want = handle.app.settings.xr.value.refresh;
    if (immersive && s?.updateTargetFrameRate && Array.from(s.supportedFrameRates ?? []).includes(want)) void s.updateTargetFrameRate(want).catch(() => undefined);
    if (immersive) {
      // inside a session frame, where the multiview target is current
      const off = onLookFrame(world, () => {
        off();
        warmUp(world);
      });
    }
    if (v === VisibilityState.VisibleBlurred && handle.app.sim.state === 'running') void handle.app.sim.pause();
  });

  (window as unknown as { iynkware: unknown }).iynkware = { world, ...handle };

  const enter = (): Promise<boolean> => {
    if (world.session) return Promise.resolve(true);
    try {
      world.launchXR({ sessionMode: arSupported ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR });
    } catch (err) {
      console.error('[iynkware] enter', err);
      return Promise.resolve(false);
    }
    return settled(world);
  };

  stage('ready');
  return { world, handle, enter };
}
