/**
 * Every pin and hole on the bench with its world position, for a held probe to snap to. The list of anchors (from the
 * part assets) is cached; the positions are re-read through `app.bench.worldOf` only after the layout, the board
 * scale or the bench top changed and a probe next asks. The search itself allocates nothing.
 */
import type { XrApp } from '../../../contracts/app';
import type { Unsubscribe, Vec3 } from '../../../contracts/common';
import type { BoardTarget } from '../../../contracts/space';
import type { ClipTarget } from './nets';
import { nearestAnchor, SNAP_M } from './snap';

export interface AnchorIndex {
  /** Nearest anchor to a world point within `maxM`, or null. The result is one reused object: read it, do not keep it. */
  nearest(x: number, y: number, z: number, maxM?: number): { target: ClipTarget; world: Vec3 } | null;
  /** The bench's target for a clip target. */
  boardTarget(target: ClipTarget): BoardTarget;
  /** World position of a clip target now, or null when it is not on the bench. */
  worldOf(target: ClipTarget): Vec3 | null;
  /** Whether every part's assets have been read (so `nearest` can find something). */
  readonly ready: boolean;
  dispose(): void;
}

interface Entry {
  readonly target: ClipTarget;
  readonly isPin: 0 | 1;
}

const boardTargetOf = (t: ClipTarget): BoardTarget =>
  t.kind === 'pin' ? { kind: 'pin', part: t.part, pin: t.id } : { kind: 'hole', surface: t.part, hole: t.id };

export function createAnchorIndex(app: XrApp): AnchorIndex {
  let all: Entry[] = [];
  let shown: Entry[] = [];
  let xyz = new Float32Array(0);
  let flags = new Uint8Array(0);
  let stale = true;
  let ready = false;
  let generation = 0;
  const hit: { target: ClipTarget; world: [number, number, number] } = { target: { kind: 'pin', part: '', id: '' }, world: [0, 0, 0] };

  /** Reads which anchors exist, from the assets of the document's boards and components. */
  async function readAnchors(): Promise<void> {
    const gen = ++generation;
    const doc = app.project.doc;
    const next: Entry[] = [];
    for (const inst of [...doc.boards, ...doc.components]) {
      let asset;
      try {
        asset = await app.assets.get(inst.definition.ref, inst.definition.version);
      } catch {
        continue;
      }
      for (const anchor of asset.anchors.values()) {
        if (anchor.kind !== 'pin' && anchor.kind !== 'hole') continue;
        const target: ClipTarget = { kind: anchor.kind, part: inst.id, id: anchor.id };
        next.push({ target, isPin: anchor.kind === 'pin' ? 1 : 0 });
      }
    }
    if (gen !== generation) return;
    all = next;
    ready = true;
    stale = true;
  }

  /** Reads every position again, dropping anchors the bench does not show. */
  function place(): void {
    stale = false;
    const kept: Entry[] = [];
    const pos: number[] = [];
    for (const e of all) {
      const w = app.bench.worldOf(boardTargetOf(e.target));
      if (!w) continue;
      kept.push(e);
      pos.push(w[0], w[1], w[2]);
    }
    shown = kept;
    xyz = Float32Array.from(pos);
    flags = Uint8Array.from(kept, (e) => e.isPin);
  }

  void readAnchors();
  const offs: Unsubscribe[] = [
    app.project.subscribe(() => void readAnchors()),
    app.bench.onLayout(() => (stale = true)),
    app.bench.scale.subscribe(() => (stale = true)),
    app.bench.benchTop.subscribe(() => (stale = true)),
  ];

  return {
    get ready() {
      return ready;
    },
    nearest(x, y, z, maxM = SNAP_M) {
      if (stale) place();
      const i = nearestAnchor(xyz, flags, shown.length, x, y, z, maxM);
      if (i < 0) return null;
      hit.target = shown[i]!.target;
      hit.world[0] = xyz[i * 3]!;
      hit.world[1] = xyz[i * 3 + 1]!;
      hit.world[2] = xyz[i * 3 + 2]!;
      return hit;
    },
    boardTarget: boardTargetOf,
    worldOf: (target) => app.bench.worldOf(boardTargetOf(target)),
    dispose() {
      generation++;
      for (const off of offs) off();
    },
  };
}
