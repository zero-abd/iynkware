/**
 * Lab equipment on the bench: every item in the lab store drawn on `app.bench.table` at its pose, picked up and moved
 * by hand or controller, and worked by its controls. Every change goes through `LabStore.apply` or `LabStore.move`, so
 * the tutor and the runner see it.
 *
 *   grab    an invisible box over the item's foot, bound with grab 'both' (near grab or ray grab, hands, controllers,
 *           the mouse). IWSDK's grab handle moves the box; the drawn item follows it with damping (smooth, no jitter),
 *           tilting and turning with the hand like a real object. Let go, it falls straight down onto what is under
 *           it (the bench top, or the floor anywhere in the room) and stands upright there (`store.move`).
 *   select  each control is a hit box bound for ray and poke; a knob is two halves (down, up). Hover lights its label.
 *   look    `ItemVisualSource`: the converted glb when the asset index lists `lab/<kind>`, else primitives.
 *
 * While a lab is open the circuit bench (`bench.root`) is hidden and takes no pointers; leaving the lab shows it again
 * exactly as it was (the project is never touched).
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Euler, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import { restBelow } from '../../bench/core/rest';
import { inkKit, loadInk, type InkKit } from '../../look/ink';
import { ACCENT, INK, PAPER } from '../../look/palette';
import { onLookFrame } from '../../look/runner';
import { textLabel, type TextLabel } from '../../ui/text';
import { labOf, type LabContext } from '../context';
import { modelOf } from '../model/registry';
import type { PlacedItem } from '../model/store';
import { say } from '../text';
import { channelsOf, liveChannels } from './channels';
import { ACID_AT, actionOf, controlsOf, dishX, LOOP_REST, SALT_DISHES, type ControlSpec } from './controls';
import { chooseSource, createGltfSource } from './gltf';
import { CONTROL_LABELS } from './labels';
import { createPrimitiveSource } from './primitives';
import type { ItemVisual, ItemVisualSource } from './visual';

const DEG = Math.PI / 180;
/** Damping rate of the follow, per second: about 90 % of the way in 0.16 s. */
const FOLLOW = 14;
/** Free fall after a release, m/s² (table frame). */
const GRAVITY = 9.81;
const UP = new Vector3(0, 1, 0);
const upright = new Quaternion();
/** Controls win over the item's grab box when both are under the pointer. */
const CONTROL_ORDER = 2;
/** The loop's tip (its ring) in the loop group's frame, and where the flame is on the burner. */
const LOOP_TIP_X = -0.0585;
const FLAME_POINT = new Vector3(0.055, 0.19, 0);
const SAMPLE_POINT = new Vector3(0, 0.035, 0);
const GEN_OUTPUT = new Vector3(0.088, 0.065, 0.104);

interface Holder {
  readonly id: string;
  readonly kind: string;
  readonly group: Group;
  readonly proxy: Mesh;
  readonly half: number;
  visual: ItemVisual | null;
  grabbing: boolean;
  /** Falling speed after a release, m/s (table frame). */
  vy: number;
  readonly offs: Unsubscribe[];
  readonly labels: Array<{ label: TextLabel; key?: keyof typeof CONTROL_LABELS; symbol?: string }>;
  /** The per-frame channel setter, made once. */
  readonly live: (channel: string, value: number) => void;
}

/** Destroys the IWSDK entities `input.bind` gave a subtree, deepest first, then takes it out of the scene. */
function dropEntities(app: XrApp, root: Object3D): void {
  const list: Object3D[] = [];
  root.traverse((o) => void list.push(o));
  for (let i = list.length - 1; i >= 0; i--) {
    const idx = (list[i] as Object3D & { entityIdx?: number }).entityIdx;
    if (idx === undefined) continue;
    const e = app.world.entityManager.getEntityByIndex(idx);
    if (e && e.active && e.object3D === list[i]) e.destroy();
  }
  root.removeFromParent();
}

type PointerEvents = 'none' | 'auto' | 'listener';
type Pointerish = Object3D & { pointerEvents?: PointerEvents; pointerEventsOrder?: number };

export function mountLabItems(app: XrApp, lab: LabContext): Unsubscribe {
  const { store } = lab;
  const table = app.bench.table;
  const root = new Group();
  root.name = 'lab-items';
  table.add(root);
  let kit: InkKit | null = null;
  const inkReady = loadInk().then((ink) => {
    if (ink) kit = inkKit(ink, table);
  });
  const source: ItemVisualSource = chooseSource(createGltfSource(), createPrimitiveSource(() => kit));
  const holders = new Map<string, Holder>();
  let list: Holder[] = [];
  const hit = new MeshBasicMaterial({ visible: false });
  const lang = () => app.settings.lang.value;

  // ---- the circuit bench, hidden while a lab is open ----
  const saved = new Map<Pointerish, PointerEvents | undefined>();
  const hideBench = (hide: boolean) => {
    const benchRoot = app.bench.root as Pointerish;
    if (hide && saved.size === 0) {
      benchRoot.traverse((o) => {
        const p = o as Pointerish;
        saved.set(p, p.pointerEvents);
        p.pointerEvents = 'none';
      });
      benchRoot.visible = false;
    } else if (!hide && saved.size > 0) {
      for (const [o, v] of saved) o.pointerEvents = v;
      saved.clear();
      benchRoot.visible = true;
    }
  };

  const placeProxy = (h: Holder, item: PlacedItem) => {
    h.proxy.position.set(item.pose.x / 1000, (item.pose.y ?? 0) / 1000 + h.half, item.pose.z / 1000);
    h.proxy.rotation.set(0, item.pose.yaw * DEG, 0);
  };

  const sync = (h: Holder) => {
    const item = store.get(h.id);
    if (!item || !h.visual) return;
    const report = store.report(h.id)!;
    for (const [ch, v] of channelsOf(h.kind, item.state, report, store)) h.visual.set(ch, v);
  };
  const syncAll = () => {
    for (const h of list) sync(h);
  };

  const labelText = (l: Holder['labels'][number]) => (l.key ? say(CONTROL_LABELS[l.key], lang()) : (l.symbol ?? ''));

  const addControl = (h: Holder, spec: ControlSpec, parent: Object3D) => {
    const halves: ReadonlyArray<-1 | 1 | undefined> = spec.knob ? [-1, 1] : [undefined];
    let label: TextLabel | null = null;
    if (spec.label || spec.symbol) {
      const w = Math.max(0.036, spec.size[0] + 0.012);
      label = textLabel(w, 0.012, { px: 7000, role: 'caption', bg: PAPER, fg: INK });
      label.mesh.raycast = () => undefined;
      const off = spec.labelAt ?? [0, spec.size[1] / 2 + 0.009, 0];
      label.mesh.position.set(spec.at[0] + off[0], spec.at[1] + off[1], spec.at[2] + off[2] + spec.size[2] / 2 + 0.001);
      // On the bench top a label lies back, facing up and towards the person; on a panel it faces out.
      if (spec.at[1] < 0.012) label.mesh.rotation.x = -70 * DEG;
      parent.add(label.mesh);
      const entry = { label, key: spec.label, symbol: spec.symbol };
      h.labels.push(entry);
      label.set(labelText(entry));
    }
    for (const half of halves) {
      const w = spec.knob ? spec.size[0] / 2 : spec.size[0];
      const box = new Mesh(new BoxGeometry(w, spec.size[1], spec.size[2]), hit);
      box.name = `lab-control:${h.id}:${spec.id}${half ? (half < 0 ? '-' : '+') : ''}`;
      box.position.set(spec.at[0] + (half ? (half * w) / 2 : 0), spec.at[1], spec.at[2]);
      (box as Pointerish).pointerEventsOrder = CONTROL_ORDER;
      parent.add(box);
      if (half) {
        const sign = textLabel(0.01, 0.01, { px: 7000, role: 'caption', bg: PAPER, fg: INK });
        sign.mesh.raycast = () => undefined;
        sign.set(half < 0 ? '−' : '+');
        sign.mesh.position.set(box.position.x + (half * w) / 2, spec.at[1] + spec.size[1] / 2 + 0.003, spec.at[2] + spec.size[2] / 2 + 0.001);
        parent.add(sign.mesh);
        h.labels.push({ label: sign, symbol: half < 0 ? '−' : '+' });
      }
      const off = app.input.bind(box, { id: box.name, ray: true, poke: true }, (e: InteractionEvent) => {
        if (e.type === 'hover-start' && label) label.set(labelText({ label, key: spec.label, symbol: spec.symbol }), { bg: ACCENT });
        if (e.type === 'hover-end' && label) label.set(labelText({ label, key: spec.label, symbol: spec.symbol }), { bg: PAPER });
        if (e.type !== 'select') return;
        const item = store.get(h.id);
        if (!item) return;
        const action = actionOf(spec, item.state, half);
        if (!action) return;
        const res = store.apply(h.id, action);
        if (e.pointer.hand) app.input.pulse(e.pointer.hand, res.ok ? 0.35 : 0.6, res.ok ? 12 : 30);
      });
      h.offs.push(off);
    }
  };

  const create = (item: PlacedItem) => {
    const model = modelOf(item.kind);
    const [w, d, ht] = model.foot;
    const group = new Group();
    group.name = `lab-item:${item.id}`;
    group.position.set(item.pose.x / 1000, (item.pose.y ?? 0) / 1000, item.pose.z / 1000);
    group.rotation.y = item.pose.yaw * DEG;
    root.add(group);
    const proxy = new Mesh(new BoxGeometry((w / 1000) * 0.96, ht / 1000, (d / 1000) * 0.96), hit);
    proxy.name = `lab-grab:${item.id}`;
    root.add(proxy);
    const h: Holder = {
      id: item.id,
      kind: item.kind,
      group,
      proxy,
      half: ht / 2000,
      visual: null,
      grabbing: false,
      vy: 0,
      offs: [],
      labels: [],
      live: (ch, v) => h.visual?.set(ch, v),
    };
    placeProxy(h, item);
    h.offs.push(
      app.input.bind(proxy, { id: proxy.name, ray: true, grab: 'both' }, (e) => {
        if (e.type === 'grab-start') {
          h.grabbing = true;
          h.vy = 0;
        }
        if (e.type !== 'grab-end') return;
        h.grabbing = false;
        // straight down from where it was let go, onto the bench top or the floor
        root.updateWorldMatrix(true, false);
        const foot = root.localToWorld(_rel.set(proxy.position.x, proxy.position.y - h.half, proxy.position.z));
        const rest = restBelow(app, foot);
        foot.y = rest.y;
        root.worldToLocal(foot);
        yaw.setFromQuaternion(proxy.quaternion, 'YXZ');
        store.move(h.id, { x: proxy.position.x * 1000, z: proxy.position.z * 1000, yaw: yaw.y / DEG, y: rest.onBench ? 0 : foot.y * 1000 });
      }),
    );
    // Controls on the item itself go on the group now; those on a moving node wait for the visual.
    for (const spec of controlsOf(item.kind)) if (!spec.node) addControl(h, spec, group);
    holders.set(item.id, h);
    list = [...holders.values()];
    void inkReady
      .then(() => source.create(item.kind, { label: item.label }))
      .then((visual) => {
        if (holders.get(item.id) !== h) return visual.dispose();
        h.visual = visual;
        group.add(visual.object);
        for (const spec of controlsOf(item.kind)) {
          if (!spec.node) continue;
          const node = visual.node(spec.node);
          if (node) addControl(h, { ...spec, at: spec.node === 'LOOP' ? [0, 0, 0] : spec.at }, node);
        }
        sync(h);
      })
      .catch((err: unknown) => console.warn(`[lab] ${item.kind} could not be drawn`, err));
  };

  const destroy = (h: Holder) => {
    for (const off of h.offs.splice(0)) off();
    for (const l of h.labels.splice(0)) l.label.dispose();
    dropEntities(app, h.proxy);
    h.proxy.geometry.dispose();
    h.visual?.dispose();
    h.group.traverse((o) => {
      if ((o as Mesh).isMesh && (o as Mesh).material === hit) (o as Mesh).geometry.dispose();
    });
    dropEntities(app, h.group);
    holders.delete(h.id);
    list = [...holders.values()];
  };

  const yaw = new Euler();
  const _rel = new Vector3();
  const offStore = store.subscribe((c) => {
    switch (c.type) {
      case 'place': {
        const item = store.get(c.id);
        if (item) create(item);
        break;
      }
      case 'remove': {
        const h = holders.get(c.id);
        if (h) destroy(h);
        break;
      }
      case 'clear':
        for (const h of [...holders.values()]) destroy(h);
        break;
      case 'move': {
        const h = holders.get(c.id);
        const item = store.get(c.id);
        if (h && item) placeProxy(h, item);
        break;
      }
      case 'lab':
        hideBench(store.lab !== null);
        break;
      default:
        break;
    }
    if (c.type !== 'clear' && c.type !== 'remove') syncAll();
  });
  const offLang = app.settings.lang.subscribe(() => {
    for (const h of list) for (const l of h.labels) l.label.set(labelText(l));
  });

  // ---- the scope probe's cable to the generator ----
  const cablePos = new Float32Array(6);
  const cableGeo = new BufferGeometry();
  cableGeo.setAttribute('position', new BufferAttribute(cablePos, 3));
  const cable = new Line(cableGeo, new LineBasicMaterial({ color: '#2b2825' }));
  cable.visible = false;
  cable.frustumCulled = false;
  cable.raycast = () => undefined;
  root.add(cable);

  // ---- every frame: follow, live channels, the loop and the probe, the cable ----
  const target = new Vector3();
  const w = new Vector3();
  const loopTarget = new Vector3();
  const find = (kind: string): Holder | undefined => {
    for (let i = 0; i < list.length; i++) if (list[i]!.kind === kind) return list[i];
    return undefined;
  };
  /** `point` in `from`'s frame, written into `out` in `to`'s frame. */
  const between = (from: Object3D, point: Vector3, to: Object3D, out: Vector3) => {
    from.localToWorld(out.copy(point));
    return to.worldToLocal(out);
  };
  const offFrame = onLookFrame(app.world, (dt) => {
    if (list.length === 0) return;
    const k = 1 - Math.exp(-FOLLOW * Math.min(dt, 0.1));
    for (let i = 0; i < list.length; i++) {
      const h = list[i]!;
      const g = h.group;
      const item = store.get(h.id);
      if (h.grabbing) {
        // in the hand: the foot hangs below the grab box's centre, tilted and turned as the hand holds it
        target.set(0, -h.half, 0).applyQuaternion(h.proxy.quaternion).add(h.proxy.position);
        g.position.lerp(target, k);
        g.quaternion.slerp(h.proxy.quaternion, k);
      } else {
        // let go: upright again, and falling onto the surface under it
        const floorY = item ? (item.pose.y ?? 0) / 1000 : 0;
        target.set(h.proxy.position.x, floorY, h.proxy.position.z);
        g.position.x += (target.x - g.position.x) * k;
        g.position.z += (target.z - g.position.z) * k;
        if (g.position.y > floorY + 1e-4) {
          h.vy += GRAVITY * Math.min(dt, 0.05);
          g.position.y = Math.max(floorY, g.position.y - h.vy * Math.min(dt, 0.05));
          if (g.position.y === floorY) h.vy = 0;
        } else {
          h.vy = 0;
          g.position.y += (floorY - g.position.y) * k;
        }
        yaw.setFromQuaternion(h.proxy.quaternion, 'YXZ');
        upright.setFromAxisAngle(UP, yaw.y);
        g.quaternion.slerp(upright, k);
      }
      if (!item || !h.visual) continue;
      liveChannels(h.kind, item.state, h.live);
      h.visual.update(dt);
    }
    // The nichrome loop goes to the acid, a dish or the burner's flame.
    const kitH = find('flame-test-kit');
    const loop = kitH?.visual?.node('LOOP');
    if (kitH && loop) {
      const st = store.get(kitH.id)!.state;
      const held = st.p.held;
      if (held === 'acid') loopTarget.set(ACID_AT[0], 0.03, ACID_AT[2]);
      else if (held === 'salt') loopTarget.set(dishX(Math.max(0, SALT_DISHES.indexOf(st.p.dish as (typeof SALT_DISHES)[number]))), 0.032, -0.025);
      else if (held === 'flame') {
        const b = find('bunsen-burner');
        if (b) between(b.group, FLAME_POINT, kitH.group, loopTarget);
        else loopTarget.set(LOOP_REST[0] + LOOP_TIP_X, LOOP_REST[1], LOOP_REST[2]);
      } else loopTarget.set(LOOP_REST[0] + LOOP_TIP_X, LOOP_REST[1], LOOP_REST[2]);
      loopTarget.x -= LOOP_TIP_X;
      loop.position.lerp(loopTarget, k);
    }
    // The pH probe goes to its cap, the rinse water, the buffer or the beaker.
    const phH = find('ph-meter');
    const probe = phH?.visual?.node('PROBE');
    if (phH && probe) {
      const at = store.get(phH.id)!.state.p.probe;
      const beaker = find('beaker-250');
      if (at === 'sample' && beaker) between(beaker.group, SAMPLE_POINT, phH.group, loopTarget);
      else if (at === 'rinse') loopTarget.set(0.045, 0.012, 0.045);
      else if (at === 'buffer') loopTarget.set(0.045, 0.02, 0.0);
      else loopTarget.set(0.045, 0.03, -0.05);
      probe.position.lerp(loopTarget, k);
    }
    // The scope's probe clipped to the generator's output.
    const scopeH = find('oscilloscope');
    const genH = find('function-generator');
    const linked = !!(scopeH && genH && store.get(scopeH.id)!.state.p.probe);
    cable.visible = linked;
    if (linked) {
      const socket = scopeH!.visual?.node('PROBE');
      if (socket) {
        between(socket, w.set(0, 0, 0), root, target);
        cablePos[0] = target.x;
        cablePos[1] = target.y;
        cablePos[2] = target.z;
      }
      between(genH!.group, GEN_OUTPUT, root, target);
      cablePos[3] = target.x;
      cablePos[4] = target.y;
      cablePos[5] = target.z;
      (cableGeo.attributes.position as BufferAttribute).needsUpdate = true;
    }
  });

  // Items already in the store (a lab opened before this module mounted).
  for (const item of store.items()) create(item);
  hideBench(store.lab !== null);

  return () => {
    offFrame();
    offStore();
    offLang();
    for (const h of [...holders.values()]) destroy(h);
    hideBench(false);
    cableGeo.dispose();
    (cable.material as LineBasicMaterial).dispose();
    hit.dispose();
    root.removeFromParent();
  };
}

export const itemsModule: FeatureModule = {
  id: 'lab/items',
  mount(app) {
    const lab = labOf(app.world);
    if (!lab) return () => undefined;
    return mountLabItems(app, lab);
  },
};
