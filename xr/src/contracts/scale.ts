/**
 * Scale and insight (pillar 4): the work scale, Room size, see-through and explode, current flow and node voltages,
 * the part inspector, and which room surrounds the bench. State plus intents: the pillar's own rail controls, the
 * shell's View menu and the guide's "Look inside" card all drive the same values, and the pillar's sub-modules
 * (`xr/src/scale/*`) realise them. Contract file: changes only in its own PR (label `contract-change`).
 *
 * Implementation: `xr/src/scale/service.ts` (`createScaleService`). Behaviour: docs/XR_DESIGN.md 3.4, 8.1, 8.2, 2.5.
 */
import type { Object3D } from '@iwsdk/core';
import type { ReadonlyValue } from './common';

/** Where the board is drawn now. */
export interface ScaleStage {
  /** `bench`: `BenchSpace.root` at the work scale. `room`: the pillar's own copy at Room size on the floor. */
  readonly kind: 'bench' | 'room';
  /**
   * Its `matrixWorld` maps the board frame (docs/XR_ARCHITECTURE.md section 5) to the world. Overlays that must follow
   * the board copy it each frame; they never add children to it (the bench clears its root on every layout).
   */
  readonly root: Object3D;
}

/** A see-through or explode amount, for one placed part or the whole build. */
export interface LensSetting {
  /** 0..1. 0 is off. */
  readonly amount: number;
  /** Entity id (`cmp_led1`, `brd_uno`), or null for every part on the bench. */
  readonly part: string | null;
}

/** The real room seen through the cameras, or the paper room (an opaque dome drawn inside the same session). */
export type RoomKind = 'passthrough' | 'paper';

export interface ScaleService {
  /** The bench's work-scale steps, ascending (design 3.4): 1, 2, 3, 4, 6. Room size is not a step. */
  readonly steps: readonly number[];
  /** The step the bench is at, or going to. Starts at the step nearest `XrSettings.benchScale`. */
  readonly workScale: ReadonlyValue<number>;
  /** Goes to the step nearest `scale`. */
  setWorkScale(scale: number): void;
  /** One step up or down; stays at the ends. */
  stepWorkScale(delta: 1 | -1): void;

  /**
   * `room` while the shell's place is `room` (Room size), else `bench`. It changes by a fade only, never by growth;
   * the scale pillar offers the `room` place and fades on `ShellService.place`.
   */
  readonly view: ReadonlyValue<'bench' | 'room'>;
  /** True while the view or the room is fading from one to the other; view requests made meanwhile are ignored. */
  readonly fading: ReadonlyValue<boolean>;
  /** The stage the board is drawn on now. */
  readonly stage: ReadonlyValue<ScaleStage>;
  /** `shell.go('room')`: Room size, by a fade. Ignored while fading, or while nothing offers the room place. */
  enterRoom(): void;
  /** Back to the bench (`shell.go('bench')`) from Room size, by a fade. */
  leaveRoom(): void;

  /** See-through (design 8.1): `cover` layers fade to 0.28 and `xray` layers fade in, as the asset sidecars give. */
  readonly seeThrough: ReadonlyValue<LensSetting>;
  setSeeThrough(amount: number, part?: string | null): void;
  /** Explode (design 3.2 "take apart"): each part moves by `amount` x its sidecar explode offset. */
  readonly explode: ReadonlyValue<LensSetting>;
  setExplode(amount: number, part?: string | null): void;

  /** Current flow on wires and traces, and node voltages, from the running simulation's analog readouts. */
  readonly flow: ReadonlyValue<boolean>;
  setFlow(on: boolean): void;

  /** The part whose inspector card is open (name, pins, ratings, live readings), or null. */
  readonly inspected: ReadonlyValue<string | null>;
  inspect(part: string | null): void;

  /** The room around the bench. Persisted as `XrSettings.space` (`mr` passthrough, `vr` paper room). */
  readonly room: ReadonlyValue<RoomKind>;
  /** False in the `immersive-vr` fallback (no passthrough), where the paper room is the only room. */
  readonly roomSwitchable: ReadonlyValue<boolean>;
  setRoom(room: RoomKind): void;
}
