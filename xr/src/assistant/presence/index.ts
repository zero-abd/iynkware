/**
 * The co-builder on the bench (session.ts `StepPresence`): the companion, the ghost of the step it proposes at the
 * step's real anchors, and the step performed where the person can watch it. A part is fetched from the shelf and
 * carried along an eased arc to the pose the bench will give it; a wire is drawn on from its first end to its second
 * with the companion travelling along it; a connection is a tap on its pin. The step's ops are committed the moment
 * the companion arrives, so the real part or wire replaces the carried one in place. The anchors glow through the
 * shared overlay (owner `assistant`).
 *
 * Frames: the companion lives on `bench.table` (metres, unscaled); ghosts and carried parts in `bench.root` (the board
 * frame, scaled with the work), so they are exactly the size and place of the real thing at any work scale.
 */
import { Group, Vector3, type Object3D } from '@iwsdk/core';
import type { PlanStep } from '../../contracts/assistant';
import type { XrApp } from '../../contracts/app';
import type { PartAsset } from '../../contracts/assets';
import type { Unsubscribe, Vec3 } from '../../contracts/common';
import type { Project } from '../../contracts/project';
import type { BoardTarget } from '../../contracts/space';
import { fadeIn } from '../../look/moves';
import { DURATION } from '../../look/motion';
import { motionOf } from '../../look/runner';
import { tryOps } from '../planner';
import type { StepPresence } from '../session';
import { benchView } from '../snapshot';
import { BODY_R, createCompanion, type Companion } from './companion';
import { carriedPart, ghostPart, wireTube, type PartGhost, type WireGhost } from './ghost';
import { cornerPose, seatedPose, type Pose } from './pose';
import { spotsOf } from './spots';

export type PresenceHost = Pick<XrApp, 'world' | 'bench' | 'assets' | 'overlay' | 'settings'>;

export interface BenchPresence extends StepPresence {
  readonly companion: Companion;
  dispose(): void;
}

/** The overlay owner of the assistant's glows. */
export const OVERLAY_OWNER = 'assistant';

type View = NonNullable<ReturnType<typeof benchView>>;
type Wire = NonNullable<View['wires']>[number];

/** What a previewed step shows, once its assets are in. */
type Shown =
  | { kind: 'part'; asset: PartAsset; pose: Pose; ghost: PartGhost }
  | { kind: 'wire'; a: Vector3; b: Vector3; color?: string; ghost: WireGhost }
  | { kind: 'point'; target: BoardTarget };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createBenchPresence(app: PresenceHost): BenchPresence {
  const { bench } = app;
  const motion = motionOf(app.world);
  let sp = spotsOf(app.settings.xr.value);
  const spots = () => sp;
  const layer = new Group();
  layer.name = 'assistant:ghosts';
  bench.root.add(layer);
  const companion = createCompanion(app.world, { home: spots().home, top: () => spots().top });
  bench.table.add(companion.group);

  let token = 0;
  let shown: Shown | null = null;
  let ready: Promise<void> = Promise.resolve();
  let carried: { object: Object3D; dispose(): void } | null = null;
  let drawn: WireGhost | null = null;
  /** What the companion points at, re-read after a layout or a scale change. */
  let pointing: (() => Vector3 | null) | null = null;
  const offs: Unsubscribe[] = [];

  const _w = new Vector3();
  /** World to table frame. */
  const tableOf = (p: Vec3 | Vector3, out = new Vector3()): Vector3 => {
    out.set(p instanceof Vector3 ? p.x : p[0], p instanceof Vector3 ? p.y : p[1], p instanceof Vector3 ? p.z : p[2]);
    bench.table.updateWorldMatrix(true, false);
    return bench.table.worldToLocal(out);
  };
  /** World to board frame. */
  const boardOf = (p: Vec3 | Vector3, out = new Vector3()): Vector3 => {
    out.set(p instanceof Vector3 ? p.x : p[0], p instanceof Vector3 ? p.y : p[1], p instanceof Vector3 ? p.z : p[2]);
    bench.root.updateWorldMatrix(true, false);
    return bench.root.worldToLocal(out);
  };
  /** Board to world frame. */
  const worldOfBoard = (p: Vector3, out = new Vector3()): Vector3 => {
    bench.root.updateWorldMatrix(true, false);
    return bench.root.localToWorld(out.copy(p));
  };
  const scale = () => bench.scale.value;
  /** World height of a part above its origin. */
  const heightOf = (asset: PartAsset) => Math.max(0.004, asset.sidecar.bounds.max[1]) * scale();
  /** A table-frame point `up` metres above a board-frame point. */
  const above = (board: Vector3, up: number, out = new Vector3()) => {
    worldOfBoard(board, out);
    out.y += up;
    return tableOf(out, out);
  };

  const refreshPoint = () => companion.point(pointing?.() ?? null);
  offs.push(
    bench.onLayout(refreshPoint),
    bench.scale.subscribe(refreshPoint),
    // Handedness or posture changed: the shelf and the home move; go home if resting.
    app.settings.xr.subscribe((xr) => {
      sp = spotsOf(xr);
      if (!shown && !carried && !drawn) void companion.flyTo(sp.home);
    }),
  );

  function clearStep() {
    app.overlay.clear(OVERLAY_OWNER);
    pointing = null;
    companion.point(null);
    if (shown && shown.kind !== 'point') shown.ghost.dispose();
    shown = null;
    carried?.dispose();
    carried = null;
    drawn?.dispose();
    drawn = null;
  }

  const entityOf = (doc: Project, id: string) => doc.boards.find((b) => b.id === id) ?? doc.components.find((c) => c.id === id);

  async function prepare(step: PlanStep, doc: Project, t: number): Promise<void> {
    const after = step.kind === 'place' || step.kind === 'wire' ? tryOps(doc, step.ops) : null;
    if (after && !after.ok) return;
    const view = after?.ok ? benchView(after.state) : undefined;

    if (step.kind === 'place' && step.part && view && after?.ok) {
      const p = view.placements?.find((x) => x.c === step.part);
      const e = entityOf(after.state, step.part);
      if (!p || !e) return;
      const asset = await app.assets.get(e.definition.ref, e.definition.version);
      if (t !== token) return;
      const legs = Object.entries(p.legs ?? {}).filter((x): x is [string, string] => typeof x[1] === 'string');
      const surface = view.surface;
      const pose =
        legs.length > 0
          ? seatedPose(
              legs,
              (leg) => asset.anchors.get(leg)?.position,
              (hole) => {
                const w = surface ? bench.worldOf({ kind: 'hole', surface, hole }) : null;
                return w ? boardOf(w) : null;
              },
            )
          : cornerPose(asset.footprint, p.x_mm, p.y_mm, p.rotation_deg ?? 0);
      if (!pose) return;
      const ghost = ghostPart(asset, pose);
      layer.add(ghost.object);
      fadeIn(app.world, ghost.setOpacity, { ms: DURATION.fade, key: ghost.object });
      shown = { kind: 'part', asset, pose, ghost };
      const top = new Vector3();
      pointing = () => above(pose.position, heightOf(asset) + 0.004, top);
      refreshPoint();
      return;
    }

    if (step.kind === 'wire' && view) {
      const before = new Set((benchView(doc)?.wires ?? []).map((w) => w.id));
      const wire: Wire | undefined = (view.wires ?? []).find((w) => !before.has(w.id));
      const [ta, tb] = step.anchors;
      const wa = ta && bench.worldOf(ta);
      const wb = tb && bench.worldOf(tb);
      if (!wa || !wb) return;
      const a = boardOf(wa);
      const b = boardOf(wb);
      const ghost = wireTube(a, b, wire?.color);
      layer.add(ghost.mesh);
      fadeIn(app.world, ghost.setOpacity, { ms: DURATION.fade, key: ghost.mesh });
      shown = { kind: 'wire', a, b, color: wire?.color, ghost };
      const at = new Vector3();
      pointing = () => above(a, 0.002, at);
      refreshPoint();
      return;
    }

    const target = step.anchors[0];
    if (!target) return;
    shown = { kind: 'point', target };
    const at = new Vector3();
    pointing = () => {
      const w = bench.worldOf(target);
      return w ? tableOf(w, at) : null;
    };
    refreshPoint();
  }

  /** The part comes off the shelf in the companion's hold and is carried to its pose. */
  async function carry(s: Extract<Shown, { kind: 'part' }>, t: number, commit: () => boolean) {
    const hold = BODY_R * 1.1;
    const h = heightOf(s.asset);
    const shelf = spots().shelf;
    companion.point(null);
    await companion.flyTo(new Vector3(shelf.x, shelf.y + h + hold + 0.01, shelf.z));
    if (t !== token) return;
    const c = carriedPart(s.asset, s.pose);
    carried = c;
    layer.add(c.object);
    const follow = (k: number) => {
      // The part hangs under the companion, turned to its final yaw already.
      bench.table.updateWorldMatrix(true, false);
      bench.table.localToWorld(_w.copy(companion.position));
      _w.y -= hold + h;
      boardOf(_w, c.object.position);
      if (k >= 1) c.object.position.copy(s.pose.position);
    };
    follow(0);
    // A short pick-up: the part grows into the hold, then they fly.
    if (!motion.reducedMotion) {
      await new Promise<void>((r) => motion.tween({ ms: 160, onUpdate: (k) => c.object.scale.setScalar(0.7 + 0.3 * k), onDone: r }));
      if (t !== token) return;
    }
    await companion.flyTo(above(s.pose.position, h + hold), { onUpdate: follow });
    if (t !== token) return;
    follow(1);
    commit();
    c.dispose();
    carried = null;
    s.ghost.dispose();
    shown = null;
    await companion.flyTo(above(s.pose.position, h + hold + 0.035), { ms: 260 });
  }

  /** The companion takes the wire's first end and draws the tube on to its second, travelling along it. */
  async function draw(s: Extract<Shown, { kind: 'wire' }>, t: number, commit: () => boolean) {
    const lift = BODY_R * 1.3;
    companion.point(null);
    await companion.flyTo(above(s.a, lift));
    if (t !== token) return;
    const tube = wireTube(s.a, s.b, s.color, true);
    drawn = tube;
    tube.drawTo(0);
    layer.add(tube.mesh);
    const p = new Vector3();
    await companion.travel(
      (k, out) => {
        tube.curve.getPoint(k, p);
        above(p, lift, out);
      },
      { ms: Math.max(700, DURATION.drawOn * 2), onUpdate: (k) => tube.drawTo(k) },
    );
    if (t !== token) return;
    tube.drawTo(1);
    commit();
    tube.dispose();
    drawn = null;
    s.ghost.dispose();
    shown = null;
  }

  /** A tap of the nib on the anchor. */
  async function tap(s: Extract<Shown, { kind: 'point' }>, t: number, commit: () => boolean) {
    const w = bench.worldOf(s.target);
    if (w) {
      const at = tableOf(w);
      companion.point(null);
      await companion.flyTo(new Vector3(at.x, at.y + BODY_R * 2.2, at.z));
      if (t !== token) return;
      await companion.flyTo(new Vector3(at.x, at.y + BODY_R * 1.2, at.z), { ms: 140, lift: 0 });
      if (t !== token) return;
    }
    commit();
    if (w) await sleep(120);
  }

  return {
    companion,
    preview(step, doc) {
      const t = ++token;
      clearStep();
      for (const target of step.anchors) app.overlay.show({ owner: OVERLAY_OWNER, target, tone: 'do', style: 'glow' });
      companion.mood('idle');
      void companion.flyTo(spots().home);
      ready = prepare(step, doc, t).catch((err) => console.warn('[assistant] preview', err));
    },
    async perform(step, commit) {
      const t = token;
      await ready;
      if (t !== token) return;
      companion.mood('busy');
      app.overlay.clear(OVERLAY_OWNER);
      const s = shown;
      try {
        if (s?.kind === 'part') await carry(s, t, commit);
        else if (s?.kind === 'wire') await draw(s, t, commit);
        else if (s?.kind === 'point') await tap(s, t, commit);
        else commit();
      } catch (err) {
        console.warn('[assistant] perform', err);
      }
    },
    rest(mood) {
      ++token;
      clearStep();
      companion.mood(mood);
      void companion.flyTo(spots().home);
    },
    dispose() {
      ++token;
      clearStep();
      for (const off of offs.splice(0)) off();
      companion.dispose();
      layer.removeFromParent();
    },
  };
}
