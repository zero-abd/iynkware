/**
 * The app context every feature module receives, and the module shape. Each pillar exports one `FeatureModule` from
 * its own folder; `xr/src/features.ts` lists them once and never changes per feature. Contract file: changes only in
 * its own PR (label `contract-change`).
 */
import type { World } from '@iwsdk/core';
import type { AssetRegistry } from './assets';
import type { ReadonlyValue, Unsubscribe } from './common';
import type { InputService } from './input';
import type { LessonGuide, ProgressStore } from './lesson';
import type { OverlayLayer } from './overlay';
import type { PartViewRegistry } from './part-view';
import type { ProjectStore, TemplateSource } from './project';
import type { ScaleService } from './scale';
import type { SettingsStore } from './settings';
import type { ShellService } from './shell';
import type { SimBridge } from './sim';
import type { BenchSpace } from './space';

/** Where the person is: the 2D page before entering, passthrough MR, or the VR studio. */
export type XrMode = 'flat' | 'mr' | 'vr';

export interface XrApp {
  readonly world: World;
  readonly mode: ReadonlyValue<XrMode>;
  readonly project: ProjectStore;
  readonly templates: TemplateSource;
  readonly sim: SimBridge;
  readonly assets: AssetRegistry;
  readonly input: InputService;
  readonly bench: BenchSpace;
  readonly views: PartViewRegistry;
  readonly overlay: OverlayLayer;
  readonly settings: SettingsStore;
  /** Where the person is (bench, room size, range), the home panel, the one menu and app-level notices. */
  readonly shell: ShellService;
  readonly progress: ProgressStore;
  /** Set while a lesson is open. */
  readonly guide: ReadonlyValue<LessonGuide | null>;
  /** Work scale, Room size, see-through, explode, current flow, the part inspector and the room (pillar 4). */
  readonly scale: ScaleService;
  /**
   * Seam for the AI lab partner with voice (after the seven pillars; nothing is built). It will observe `project`,
   * `sim`, `guide` and `input.onAny`, and propose ops through `project.apply` with an `ai` author. Stays null.
   */
  readonly partner: null;
}

export interface FeatureModule {
  /** `bench`, `run`, `learn`, `scale`, `range`, `shell`. */
  readonly id: string;
  /** Called once after the world and the services exist. Returns its teardown. */
  mount(app: XrApp): Unsubscribe | Promise<Unsubscribe>;
}
