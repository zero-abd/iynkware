/** Builds the services every feature module receives (contracts/app.ts) around one IWSDK world and one project. */
import { builtinRegistry } from '@/parts/builtin';
import type { World } from '@iwsdk/core';
import { createAssistantService, instantPresence } from './assistant/service';
import { createAssetRegistry, describeFrom } from './assets/registry';
import { createBenchSpace } from './bench/space';
import type { FeatureModule, XrApp, XrMode } from './contracts/app';
import type { Project } from './contracts/project';
import { createInputService } from './input';
import { createLessonSlot } from './learn/launcher';
import { createProgressStore } from './learn/progress';
import { createProjectStore, createTemplateSource } from './project/store';
import { createPartViewRegistry } from './run/views/registry';
import { createShellService } from './shell/service';
import { createScaleService } from './scale/service';
import { createSettingsStore } from './shell/settings';
import { createSimBridge } from './sim/bridge';
import { createOverlay } from './ui/overlay';
import { value } from './ui/value';

export interface AppHandle {
  readonly app: XrApp;
  readonly ready: Promise<void>;
  setMode(mode: XrMode): void;
  mount(features: readonly FeatureModule[]): Promise<void>;
  dispose(): Promise<void>;
}

export function createApp(world: World, doc: Project): AppHandle {
  const parts = builtinRegistry();
  const settings = createSettingsStore();
  const project = createProjectStore(doc, parts);
  const assets = createAssetRegistry({ describe: describeFrom(parts) });
  const { benchHeight, benchScale } = settings.xr.value;
  const bench = createBenchSpace({ project, assets, scale: benchScale, benchTop: { position: [0, benchHeight, -0.6], yawRad: 0 } });
  world.createTransformEntity(bench.table);
  world.createTransformEntity(bench.root);
  const overlay = createOverlay(bench, bench.table);
  const mode = value<XrMode>('flat');
  const lessons = createLessonSlot();
  const shell = createShellService();
  const templates = createTemplateSource();
  const sim = createSimBridge();
  const assistant = createAssistantService({ project, templates, sim, lang: () => settings.lang.value, guide: () => lessons.guide.value?.state ?? null, presence: instantPresence });
  const app: XrApp = {
    world,
    mode,
    project,
    templates,
    sim,
    assets,
    input: createInputService(world),
    bench,
    views: createPartViewRegistry(),
    overlay,
    settings,
    shell,
    progress: createProgressStore(),
    guide: lessons.guide,
    lessons,
    scale: createScaleService({ bench, settings, mode, shell }),
    assistant,
  };
  const teardowns: Array<() => void> = [];
  return {
    app,
    ready: bench.ready,
    setMode: (m) => mode.set(m),
    async mount(features) {
      for (const f of features) teardowns.push(await f.mount(app));
    },
    async dispose() {
      for (const t of teardowns.reverse()) t();
      assistant.dispose();
      overlay.dispose();
      bench.dispose();
      await app.sim.dispose();
    },
  };
}
