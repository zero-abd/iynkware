/**
 * Placeholder assets: a part drawn from its iynk descriptor alone, until the asset pipeline converts its figure. Each
 * one comes with a sidecar in the pipeline's shape (tools/xr-assets/schema/xr-asset.ts), so the bench, the part views
 * and the overlays read a placeholder exactly as they will read a converted item.
 *
 * Frame (the sidecar's, contracts/assets.ts): metres, real size, +Y up, front +Z, origin at the centre of the geometry's
 * bounds in x and z with y = 0 on the surface. A descriptor stores millimetres from its front left corner with +y
 * towards the back (`board-mm`), so a descriptor point (x, y) lands at x / 1000 + ox, z = (H - y) / 1000 + oz, where
 * H is the layout depth (`dimensions.body.h`, else `dimensions.board.h`, else the generic layout's, as the Studio does)
 * and (ox, oz) moves the bounds' centre to the origin. `frame.fromSource` holds that mapping; `footprint` the layout
 * rectangle.
 *
 * Four shapes:
 *   surface  a part with breadboard strips: a body box and its holes as one InstancedMesh (`holes`), hole anchors
 *            (`a1`, `RAIL_TP2`) on the top surface.
 *   board    `identity.kind` board: a PCB slab and its pins as one InstancedMesh (`pins`), header pins 8.5 mm tall, pads
 *            flush; pin anchors (`D13`) on top of the header or pad.
 *   leaded   a part that seats in holes on its own legs (span under 30 columns, no module PCB): the body centred over its
 *            legs on a short standoff, leg boxes down to the surface, pin anchors (`A`, `K`) at the leg tips (y = 0). An
 *            LED's epoxy is its own mesh (`light`), part `LED`, with a `led:LED` anchor on top and a `led:LED` channel.
 *   generic  everything else: a box of the body size over the layout rectangle, pin anchors at y = 0.
 * A pin without a position gets no anchor and no geometry.
 */
import {
  Box3,
  BoxGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  Vector3,
} from '@iwsdk/core';
import type { BufferGeometry, Material, Object3D } from '@iwsdk/core';
import type { Descriptor } from '@/parts/descriptor';
import { fallbackSpec } from '@/parts/fallback';
import type { Anchor, AnchorKind, AssetPart, Channel, Footprint, PartAsset, XrAsset } from '../contracts/assets';
import { box, cylinderAlongX, cylinderUp, dome, mergeSolids } from './geometry';
import type { Mm3, Solid } from './geometry';

/**
 * Child mesh names inside an instance. Everything is shared between instances except the `light` mesh's material,
 * which is the instance's own clone: a part view may change it, and whoever removes the placement may dispose it.
 */
export const MESH = { body: 'body', light: 'light', holes: 'holes', pins: 'pins' } as const;

/** An LED's lens: its part id in the sidecar, and the id of its anchor and of its emissive channel. */
export const LED_PART = 'LED';
export const LIGHT_ANCHOR = `led:${LED_PART}`;

export type PlaceholderShape = 'surface' | 'board' | 'leaded' | 'generic';

/** Sizes in millimetres. */
const MM = {
  /** Height of a part whose descriptor gives none. */
  height: 5,
  pcb: 1.6,
  header: 8.5,
  headerSide: 2.2,
  pad: 0.1,
  padSide: 1.6,
  hole: 0.1,
  holeSide: 1.2,
  /** How far a lead goes into a breadboard hole. */
  holeDepth: 5,
  leg: 0.5,
  /** Gap between the surface and a leaded body, so its legs show. */
  standoff: 1.5,
  /** The rim at the base of an LED. */
  flange: 1,
  /** Legs further apart than the body is long by this much make an axial part (resistor, diode). */
  axialSlack: 1,
  /** A two-lead body whose footprint sides differ by at most this much is drawn round. */
  roundSlack: 0.5,
} as const;

/** A `span` reaching this many columns is a flying lead (battery, motor): the body does not sit over its legs. */
const FLYING_LEAD_SPAN = 30;
const ROUGHNESS = 0.85;
const COLOUR = { body: '#8a8f98', dark: '#1f1d1b', lead: '#b4b8bd' } as const;
const HEADER_KINDS: ReadonlySet<string> = new Set(['header', 'jumper']);
const MODULE_RENDERERS: ReadonlySet<string> = new Set(['generic-header-module', 'generic-terminal-module']);
type V3 = [number, number, number];
const UP: Readonly<V3> = [0, 1, 0];
const DOWN: Readonly<V3> = [0, -1, 0];
/** The figures' ink look, as docs/XR_ASSETS.md gives it; placeholders draw with plain materials but carry the values. */
const LOOK: XrAsset['look'] = {
  ink: '#231e16',
  paper: '#f2efe7',
  shadow: '#41538f',
  sun: [0.41, 0.82, 0.41],
  fixedLight: [0, 1, 0],
  defaultView: [0.577, 0.577, 0.577],
  shadowLength: 0.45,
};

/** Controls the person works, for the parts that have one. The converted asset's sidecar replaces this. */
const CONTROL_OF: Readonly<Record<string, string>> = {
  'core.push-button-6mm': 'button',
  'core.slide-switch': 'lever',
  'core.potentiometer-10k': 'knob',
};

/** Which of the four placeholder shapes a descriptor gets. */
export function placeholderShape(d: Descriptor): PlaceholderShape {
  if (d.groups?.some((g) => g.kind === 'strip')) return 'surface';
  if (d.identity.kind === 'board') return 'board';
  const span = d.visual.breadboard?.span;
  const ownLegs =
    span !== undefined &&
    Math.max(...span) < FLYING_LEAD_SPAN &&
    d.dimensions?.board === undefined &&
    !MODULE_RENDERERS.has(d.visual.fallback.renderer) &&
    d.pins.some((p) => p.position);
  return ownLegs ? 'leaded' : 'generic';
}

/** Whether the part gives off light the bench should show (an LED element or an optical output). */
function emitsLight(d: Descriptor): boolean {
  if (d.physical_outputs?.some((o) => o.world_channel?.startsWith('optical.'))) return true;
  return d.behaviour.layers.some(({ model }) =>
    model.kind === 'element'
      ? model.element === 'led'
      : model.kind === 'subcircuit' && model.instances.some((i) => i.element === 'led'),
  );
}

/** The layout rectangle (w along x, h along the descriptor's y) and the height off the bench, millimetres. */
export function layoutOf(d: Descriptor): { w: number; h: number; height: number } {
  const dims = d.dimensions?.body ?? d.dimensions?.board;
  const generated = dims ? undefined : fallbackSpec(d).body_mm;
  return {
    w: dims?.w ?? generated!.w,
    h: dims?.h ?? generated!.h,
    height: d.dimensions?.body?.d ?? d.dimensions?.height_total ?? MM.height,
  };
}

const round2 = (mm: number): number => Math.round(mm * 100) / 100;
const metres = (mm: number): number => round2(mm) / 1000;
/** Metres to 0.01 mm. */
const round5 = (m: number): number => Math.round(m * 1e5) / 1e5;
const _p = new Vector3();
/** A frame point in millimetres (x, up, z): what the geometry helpers take. */
const v = (x: number, up: number, z: number): Mm3 => [x, up, z];

interface InstanceSet {
  name: string;
  anchors: string[];
  /** Frame millimetres: base centre and size of each instance box. */
  boxes: { x: number; up: number; z: number; side: number; tall: number }[];
}

/** Builds the placeholder asset for one descriptor. Geometry and materials are made once here and shared by every instance. */
export function buildPlaceholder(d: Descriptor): PartAsset {
  const shape = placeholderShape(d);
  const L = layoutOf(d);
  const H = L.h;
  const bodyColour = new Color(d.visual.fallback.body_colour ?? COLOUR.body);
  const leadColour = new Color(COLOUR.lead);

  const solids: Solid[] = [];
  const lightSolids: Solid[] = [];
  /** Anchors in the top-left frame (metres) until the end, where they move to the footprint-centre frame. */
  const anchors = new Map<string, Anchor>();
  let instanced: InstanceSet | undefined;

  /** An anchor at a descriptor point (x, y) mm, `up` mm above the bench. */
  const anchor = (id: string, kind: AnchorKind, x: number, up: number, y: number, normal: Readonly<V3>, extra?: Partial<Anchor>): void => {
    if (anchors.has(id)) return;
    anchors.set(id, { id, kind, part: '', position: [metres(x), metres(up), metres(H - y)], normal: [...normal], ...extra });
  };
  /** An anchor at a frame point (x, up, z) mm. */
  const anchorAt = (id: string, kind: AnchorKind, x: number, up: number, z: number, extra?: Partial<Anchor>): void =>
    anchor(id, kind, x, up, H - z, UP, extra);
  const addInstance = (set: InstanceSet, name: string, x: number, up: number, y: number, side: number, tall: number): void => {
    set.anchors.push(name);
    set.boxes.push({ x, up, z: H - y, side, tall });
  };

  const positioned = d.pins.flatMap((p) => (p.position ? [{ id: p.id, x: p.position.x, y: p.position.y }] : []));
  /** Frame millimetres of the top of the body, where a control anchor goes. */
  let control: Mm3 | undefined;

  if (shape === 'surface') {
    const top = L.height;
    solids.push({ geometry: box(v(0, 0, 0), v(L.w, top, H)), colour: bodyColour });
    const inStrip = new Set(d.groups?.flatMap((g) => (g.kind === 'strip' ? g.pins : [])));
    instanced = { name: MESH.holes, anchors: [], boxes: [] };
    for (const p of positioned) {
      if (inStrip.has(p.id)) {
        anchor(p.id, 'hole', p.x, top, p.y, UP, { depth: MM.holeDepth / 1000 });
        addInstance(instanced, p.id, p.x, top, p.y, MM.holeSide, MM.hole);
      } else {
        anchor(p.id, 'pin', p.x, top, p.y, UP);
      }
    }
  } else if (shape === 'board') {
    const board = d.dimensions?.board;
    const t = board?.thickness ?? MM.pcb;
    const bw = board?.w ?? L.w;
    const bh = board?.h ?? H;
    solids.push({ geometry: box(v(0, 0, H - bh), v(bw, t, H)), colour: bodyColour });
    const connectorKind = new Map<string, string>();
    for (const c of d.connectors ?? []) for (const id of c.pins) connectorKind.set(id, c.kind);
    for (const p of d.pins) {
      const kind = p.connector === undefined ? undefined : d.connectors?.find((c) => c.id === p.connector)?.kind;
      if (kind !== undefined && !connectorKind.has(p.id)) connectorKind.set(p.id, kind);
    }
    instanced = { name: MESH.pins, anchors: [], boxes: [] };
    for (const p of positioned) {
      const header = HEADER_KINDS.has(connectorKind.get(p.id) ?? '');
      const tall = header ? MM.header : MM.pad;
      anchor(p.id, 'pin', p.x, t + tall, p.y, UP);
      addInstance(instanced, p.id, p.x, t, p.y, header ? MM.headerSide : MM.padSide, tall);
    }
  } else if (shape === 'leaded') {
    const xs = positioned.map((p) => p.x);
    const zs = positioned.map((p) => H - p.y);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const lit = emitsLight(d);
    const axial = !lit && positioned.length === 2 && maxZ - minZ < 0.01 && maxX - minX > L.w + MM.axialSlack;
    const round = lit || (d.visual.fallback.renderer === 'generic-two-lead' && Math.abs(L.w - L.h) <= MM.roundSlack);
    const half = MM.leg / 2;
    let legTop = MM.standoff + MM.leg;
    let bodyTop: number;
    if (axial) {
      const r = Math.min(L.h, L.height) / 2;
      const cy = MM.standoff + r;
      solids.push({ geometry: cylinderAlongX(v(cx, cy, cz), r, L.w), colour: bodyColour });
      solids.push({ geometry: box(v(minX - half, cy - half, cz - half), v(maxX + half, cy + half, cz + half)), colour: leadColour });
      legTop = cy + half;
      bodyTop = cy + r;
    } else if (lit) {
      const rim = Math.min(L.w, L.h) / 2;
      const r = rim * 0.86;
      const flange = Math.min(MM.flange, L.height);
      const barrel = Math.max(L.height - flange - r, 0);
      lightSolids.push({ geometry: cylinderUp(v(cx, MM.standoff, cz), rim, flange) });
      if (barrel > 0) lightSolids.push({ geometry: cylinderUp(v(cx, MM.standoff + flange, cz), r, barrel) });
      lightSolids.push({ geometry: dome(v(cx, MM.standoff + flange + barrel, cz), r) });
      bodyTop = MM.standoff + flange + barrel + r;
      anchorAt(LIGHT_ANCHOR, 'led', cx, bodyTop, cz, { part: LED_PART, channel: LIGHT_ANCHOR });
    } else if (round) {
      solids.push({ geometry: cylinderUp(v(cx, MM.standoff, cz), Math.min(L.w, L.h) / 2, L.height), colour: bodyColour });
      bodyTop = MM.standoff + L.height;
    } else {
      solids.push({
        geometry: box(v(cx - L.w / 2, MM.standoff, cz - H / 2), v(cx + L.w / 2, MM.standoff + L.height, cz + H / 2)),
        colour: bodyColour,
      });
      bodyTop = MM.standoff + L.height;
    }
    for (const p of positioned) {
      const z = H - p.y;
      solids.push({ geometry: box(v(p.x - half, 0, z - half), v(p.x + half, legTop, z + half)), colour: leadColour });
      anchor(p.id, 'pin', p.x, 0, p.y, DOWN);
    }
    control = [cx, bodyTop, cz];
  } else {
    solids.push({ geometry: box(v(0, 0, 0), v(L.w, L.height, H)), colour: bodyColour });
    for (const p of positioned) anchor(p.id, 'pin', p.x, 0, p.y, DOWN);
    control = [L.w / 2, L.height, H / 2];
  }

  const controlName = CONTROL_OF[d.id] ?? (d.visual.schematic?.symbol === 'switch' ? 'switch' : undefined);
  if (controlName && control) anchorAt(`control:${controlName}`, 'control', control[0], control[1], control[2]);

  // Shared GPU-side data: built once per descriptor, handed to every instance. Built in the top-left frame, then moved
  // so the bounds' centre is the origin (footprint-centre).
  const bounds = new Box3();
  const body = solids.length > 0 ? mergeSolids(solids) : undefined;
  const light = lightSolids.length > 0 ? mergeSolids(lightSolids) : undefined;
  if (body?.boundingBox) bounds.union(body.boundingBox);
  if (light?.boundingBox) bounds.union(light.boundingBox);
  const preSets = instanced && instanced.boxes.length > 0 ? [instanced] : [];
  for (const set of preSets) for (const b of set.boxes) {
    const h = b.side / 2000;
    bounds.expandByPoint(_p.set(b.x / 1000 - h, b.up / 1000, b.z / 1000 - h));
    bounds.expandByPoint(_p.set(b.x / 1000 + h, (b.up + b.tall) / 1000, b.z / 1000 + h));
  }
  const ox = bounds.isEmpty() ? -L.w / 2000 : -(bounds.min.x + bounds.max.x) / 2;
  const oz = bounds.isEmpty() ? -H / 2000 : -(bounds.min.z + bounds.max.z) / 2;
  body?.translate(ox, 0, oz);
  light?.translate(ox, 0, oz);
  if (!bounds.isEmpty()) bounds.translate(_p.set(ox, 0, oz));
  for (const a of anchors.values()) {
    a.position[0] = round5(a.position[0] + ox);
    a.position[2] = round5(a.position[2] + oz);
  }

  const tag = `${d.id}@${d.version}`;
  const solidMaterial = named(new MeshStandardMaterial({ vertexColors: true, roughness: ROUGHNESS, metalness: 0 }), `${tag}:solid`);
  const lightMaterial = light && named(new MeshStandardMaterial({ color: bodyColour, roughness: ROUGHNESS, metalness: 0 }), `${tag}:light`);
  const sets = preSets.map((set) => instanceData(set, `${tag}:dark`, ox, oz));

  const instancedList = sets.map((s) => Object.freeze({ meshName: s.name, anchors: Object.freeze([...s.anchors]) }));
  const footprint: Footprint = Object.freeze({ x: round5(ox), z: round5(oz), w: metres(L.w), d: metres(H) });
  const meshNames = [...(body ? [MESH.body] : []), ...(light ? [MESH.light] : []), ...sets.map((s) => s.name)];
  const triangles =
    (body ? (body.index?.count ?? 0) / 3 : 0) +
    (light ? (light.index?.count ?? 0) / 3 : 0) +
    sets.reduce((n, s) => n + s.anchors.length * 12, 0);
  const parts: AssetPart[] = [{ id: '', index: 0, name: d.identity.model, parent: '', role: 'item', explode: [0, 0, 0] }];
  const channels: Channel[] = [];
  if (light) {
    parts.push({ id: LED_PART, index: 1, name: 'LED', parent: '', role: 'led', nodes: [MESH.light], explode: [0, 0, 0] });
    channels.push({
      id: LIGHT_ANCHOR,
      kind: 'emissive',
      part: LED_PART,
      nodes: [MESH.light],
      value: { unit: 'level', min: 0, max: 1, rest: 0 },
      color: `#${bodyColour.getHexString()}`,
    });
  }
  const box3 = (b: Box3): XrAsset['bounds'] =>
    b.isEmpty()
      ? { min: [0, 0, 0], max: [0, 0, 0] }
      : { min: [round5(b.min.x), round5(b.min.y), round5(b.min.z)], max: [round5(b.max.x), round5(b.max.y), round5(b.max.z)] };
  const sidecar: XrAsset = {
    schema: 'iynkware.xr-asset/1',
    id: `placeholder/${d.id}`,
    kind: d.identity.kind === 'board' ? 'board' : d.identity.kind === 'module' ? 'module' : 'part',
    name: d.identity.model,
    glb: '',
    source: { figure: '', engine: 'bench', pageSha256: '', descriptor: d.id },
    generator: { tool: 'tools/xr-assets', version: 'xr-placeholder/1' },
    frame: {
      units: 'm',
      up: '+Y',
      front: '+Z',
      handedness: 'right',
      origin: 'footprint-centre',
      source: 'board-mm',
      // board-mm (x right, y back, z up) to asset: X = x/1000 + ox, Y = z/1000, Z = (H - y)/1000 + oz.
      fromSource: [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, round5(ox), 0, round5(H / 1000 + oz), 1],
    },
    bounds: box3(bounds),
    stats: { triangles, trianglesXray: 0, drawCalls: meshNames.length, lineSegments: 0, nodes: meshNames.length + 1, bytes: 0 },
    look: LOOK,
    parts,
    anchors: [...anchors.values()],
    channels,
    layers: [{ id: 'base', nodes: meshNames, opacity: [1, 1] }],
    texts: [],
    warnings: ['Placeholder drawn from the part descriptor: the figure is not converted yet.'],
  };

  return Object.freeze({
    ref: d.id,
    version: d.version,
    source: 'placeholder' as const,
    sidecar,
    footprint,
    anchors,
    ...(instancedList.length > 0 ? { instanced: Object.freeze(instancedList) } : {}),
    instantiate(): Object3D {
      const root = new Group();
      root.name = tag;
      root.userData = { ref: d.id, version: d.version, source: 'placeholder' };
      if (body) root.add(named(new Mesh(body, solidMaterial), MESH.body));
      // The one material an instance owns: a part view may make it glow without touching other placements.
      if (light && lightMaterial) root.add(named(new Mesh(light, lightMaterial.clone()), MESH.light));
      for (const s of sets) {
        const mesh = new InstancedMesh(s.geometry, s.material, 0);
        mesh.instanceMatrix = s.matrices;
        mesh.count = s.anchors.length;
        mesh.boundingBox = s.box.clone();
        mesh.boundingSphere = s.sphere.clone();
        root.add(named(mesh, s.name));
      }
      return root;
    },
  });
}

function named<T extends Object3D | Material>(thing: T, name: string): T {
  thing.name = name;
  return thing;
}

/**
 * The shared half of an InstancedMesh: a unit box standing on y = 0, one matrix per instance (scale to the box, then
 * place it), its bounds, and its dark material. Instances never write the matrices.
 */
function instanceData(set: InstanceSet, materialName: string, ox: number, oz: number) {
  const geometry: BufferGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  geometry.computeBoundingBox();
  const matrices = new InstancedBufferAttribute(new Float32Array(set.boxes.length * 16), 16);
  const m = new Matrix4();
  set.boxes.forEach((b, i) => {
    m.makeScale(b.side / 1000, b.tall / 1000, b.side / 1000).setPosition(b.x / 1000 + ox, b.up / 1000, b.z / 1000 + oz);
    m.toArray(matrices.array, i * 16);
  });
  const material = named(new MeshStandardMaterial({ color: COLOUR.dark, roughness: ROUGHNESS, metalness: 0 }), materialName);
  const probe = new InstancedMesh(geometry, material, 0);
  probe.instanceMatrix = matrices;
  probe.count = set.boxes.length;
  probe.computeBoundingBox();
  probe.computeBoundingSphere();
  return {
    name: set.name,
    anchors: set.anchors,
    geometry,
    material,
    matrices,
    box: probe.boundingBox ?? new Box3(),
    sphere: probe.boundingSphere ?? new Sphere(),
  };
}
