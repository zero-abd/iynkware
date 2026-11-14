/* The iynkware XR asset contract, version 1: the sidecar JSON written next to each item's binary glTF by
   tools/xr-assets (docs/XR_ASSETS.md). The JSON schema in xr-asset.schema.json describes the same shape; a test keeps
   the two in step. Types only: nothing here runs.

   Conventions used by every field below:
   - Units are metres. Axes are glTF's: right-handed, +Y up, the item's front faces +Z, so a person standing at +Z
     looking towards -Z sees the item's front with its own right-hand side on their left (+X is the item's left).
   - Positions and directions are in the item's root frame (the glTF scene's root node) at rest: explode 0,
     see-through 0, every channel at its rest value.
   - A Vec3 is [x, y, z]; a direction is a unit vector. A Hex is a lowercase '#rrggbb' sRGB colour. */

export type Vec3 = [number, number, number];
export type Hex = string;

export const XR_ASSET_SCHEMA = 'iynkware.xr-asset/1';

/** What the item is, as figures/<dir>/<id>.js names it: boards, parts, modules, robotics (benches), drones, flight,
    lab (lab equipment: glassware, burners, instruments, physics apparatus; drawn by the bench engine). */
export type ItemKind = 'board' | 'part' | 'module' | 'bench' | 'drone' | 'flight' | 'lab';

export interface XrAsset {
  schema: typeof XR_ASSET_SCHEMA;
  /** '<dir>/<id>', the figure's path under figures/ without .js: 'boards/uno-r3', 'robotics/l298n', 'drones/quad5'. */
  id: string;
  kind: ItemKind;
  /** English display name from the figure (its title). Translations come from the app's i18n, keyed by id. */
  name: string;
  /** The binary glTF next to this file, relative to it: 'uno-r3.glb'. */
  glb: string;
  source: {
    /** 'figures/boards/uno-r3.js'. */
    figure: string;
    engine: 'bench' | 'drone' | 'flight';
    /** sha256 of the figure page the converter ran (cfbuild output), so a stale asset can be detected. */
    pageSha256: string;
    /** The component descriptor whose pin ids the pin anchors use, if one matched: 'uno-r3' for
        src/parts/data/uno-r3.component.json. */
    descriptor?: string;
  };
  generator: { tool: 'tools/xr-assets'; version: string };
  frame: Frame;
  /** Axis-aligned bounds of all geometry at rest (labels and anchors excluded). */
  bounds: { min: Vec3; max: Vec3 };
  stats: Stats;
  look: Look;
  parts: Part[];
  anchors: Anchor[];
  channels: Channel[];
  layers: Layer[];
  /** Printed text (silkscreen, chip markings, panel labels). Not in the glTF: the app draws it (no font is bundled). */
  texts: Text[];
  /** Everything the converter could not carry over or found odd, one sentence each. Empty when the item is clean. */
  warnings: string[];
  /** Engine-specific data that is not part of the contract yet. Never required by a consumer. */
  extras?: Record<string, unknown>;
}

/** Where the asset's origin is and how the figure's own coordinates map into it. */
export interface Frame {
  units: 'm';
  up: '+Y';
  front: '+Z';
  handedness: 'right';
  /** 'footprint-centre': x and z at the centre of the geometry's bounds, y = 0 on the surface the item stands on
      (bench items: the top of the cutting mat the figure draws). 'craft-centre': drones, x and z at the craft's own
      origin (its centre of motors), y = 0 on the mat. 'range-origin': the flight range's world origin. */
  origin: 'footprint-centre' | 'craft-centre' | 'range-origin';
  /** The figure's frame: 'board-mm' (bench items: the base board's mm, x right, y towards the back, z up from the
      PCB's top surface), 'flu-mm' (drones: x forward, y left, z up, z = 0 on the mat), 'range-m' (flight range). */
  source: 'board-mm' | 'flu-mm' | 'range-m';
  /** Column-major 4x4 (as THREE.Matrix4.fromArray takes it) from the source frame to the asset frame. Both frames
      are right-handed, so it is a rotation, a uniform scale (0.001 for mm) and a translation, never a mirror. */
  fromSource: number[];
}

export interface Stats {
  /** Triangles in the meshes drawn at rest (layer 'base' and 'cover'; 'xray' counted apart). */
  triangles: number;
  trianglesXray: number;
  /** glTF primitives drawn at rest: triangle and line primitives of every visible mesh node. The ink material's
      outline and shadow passes add up to two more per triangle primitive. */
  drawCalls: number;
  lineSegments: number;
  nodes: number;
  bytes: number;
}

/** The ink look's constants for this item (tools/xr-assets/material reads them). */
export interface Look {
  ink: Hex;          // '#231e16'
  paper: Hex;        // '#f2efe7'
  shadow: Hex;       // '#41538f'
  /** Direction towards the figure's sun (exterior bands, thresholds -0.15 and -0.45), in the root frame, chosen so
      the item at its default view gets the bands the 2D figure shows. */
  sun: Vec3;
  /** Direction towards the figure's fixed interior light (bands at 0.6 and 0.05). */
  fixedLight: Vec3;
  /** Direction from the item towards the 2D figure's default camera (the front-left-top isometric view). */
  defaultView: Vec3;
  /** Cast shadow length as a share of height (0.45 in the figures). */
  shadowLength: number;
}

/** One part of the item. parts[i].index is the value of the _PART vertex attribute for its geometry. */
export interface Part {
  /** Unique in the item. The figure's own part id ('ICSP', 'U1', 'MOTORS'); inside a bench, a mat item's parts are
      '<item>/<part>' ('NANO/ICSP'). The item itself is '' (the root). */
  id: string;
  index: number;
  /** English name from the figure ('ICSP header'). */
  name: string;
  /** Parent part id; '' for a top-level part. */
  parent: string;
  role: PartRole;
  /** The glTF nodes that carry the pieces of this part a channel moves or lights (an LED's lens, a servo's horn, a
      button's cap). The rest of the part is merged into the item's static meshes. Absent when nothing moves. */
  nodes?: string[];
  /** Bounds at rest, root frame. Absent for a part with no geometry. */
  bounds?: { min: Vec3; max: Vec3 };
  /** Where the part sits at explode = 1, as an offset from rest in the root frame (the _EXPLODE attribute holds the
      same per vertex). [0,0,0] for a part that does not move. */
  explode: Vec3;
  /** True for a cover: its geometry is in the 'cover' layer, which see-through fades (drone canopies, battery
      covers). */
  cover?: boolean;
  /** Bench build: 'smd' | 'low' | 'tall' | 'last' (the order parts go on); drone build: the part ids it waits for. */
  group?: string;
  after?: string[];
  extras?: Record<string, unknown>;
}

export type PartRole =
  | 'item'      // the item root
  | 'board'     // a PCB (the base board, or a board on a bench's mat)
  | 'module'    // a module on a bench's mat
  | 'part'      // anything else that is mounted
  | 'connector' // headers, sockets, jacks, terminals
  | 'led'
  | 'control'   // buttons, switches, knobs: something a hand presses or turns
  | 'motor'
  | 'prop'
  | 'wire'
  | 'frame'     // a drone frame or arm
  | 'cover';

export interface Anchor {
  /** Unique in the item. Connection points use the simulation's id: the component descriptor's pin id ('D13',
      'GND', 'ICSP_3' on the Uno; 'a1'...'j30' and 'RAIL_TP2' on the breadboard; 'A' and 'K' on an LED), else the
      figure's pin id ('J3.6'). Inside a bench the id is prefixed with the mat item: 'NANO/D8', 'BB/a1'. Every other
      anchor is '<kind>:<name>': 'led:L', 'control:RESET', 'motor:M1', 'prop:M1', 'label:U3', 'header:ICSP',
      'rail:RAIL_TP', 'strip:S12u', 'screen:OLED'. */
  id: string;
  kind: AnchorKind;
  /** The part it belongs to: it moves with that part's explode offset and node. */
  part: string;
  /** For a pin or hole: the point a wire end or probe tip touches (a male pin's tip, a socket's or hole's mouth).
      For a group (header, strip, rail): its centre. For a motor or prop: on its axis at the top of the hub. */
  position: Vec3;
  /** The direction a wire, probe or finger comes from (out of the surface); a motor's or prop's axis (up). */
  normal: Vec3;
  /** Other names the same point answers to: the net ('D13'), the silkscreen label ('~3'), the figure's pin id
      ('J3.6'), the figure's breadboard ref ('T+12'). Never another anchor's id. */
  aliases?: string[];
  /** How far a lead goes in along -normal (a female header's socket, a breadboard hole), metres. */
  depth?: number;
  /** Header, strip, rail, label group: the anchor ids it holds, in order (pin 1 first, column 1 first). */
  members?: string[];
  /** label: the English text; screen: the display's name. */
  text?: string;
  /** label: which way the text's top points; reading direction is cross(up, normal), never mirrored. */
  up?: Vec3;
  /** label: shown only in see-through (a callout) rather than at rest (a part tag). */
  layer?: 'base' | 'xray';
  /** screen: the display's corner at its top-left as seen by a user, its width and height vectors (metres) and
      pixel size, so the app can map a canvas onto it. */
  rect?: { origin: Vec3; u: Vec3; v: Vec3; pixels: [number, number] };
  /** motor and prop: spin direction seen from above ('CW' | 'CCW'), as the craft data says. */
  dir?: 'CW' | 'CCW';
  /** The channel that animates this anchor's part, when one does ('led:L', 'prop:M1'). */
  channel?: string;
  extras?: Record<string, unknown>;
}

export type AnchorKind =
  | 'pin'       // a board pin, a part's leg, a module's pin, a terminal
  | 'hole'      // a breadboard hole, a rail hole
  | 'header'    // a whole header or socket strip
  | 'strip'     // a breadboard five-hole strip
  | 'rail'      // a breadboard power rail
  | 'led'
  | 'control'
  | 'motor'
  | 'prop'
  | 'label'
  | 'screen'
  | 'port';     // USB, barrel jack, battery lead: where a cable plugs in

/** Something that moves or changes with runtime state. It drives a node's transform or its material, never the
    geometry. value is what the app sets; bind says where the simulation keeps it. */
export interface Channel {
  /** 'led:<part>', 'servo:<part>', 'prop:<motor>', 'motor:<part>', 'press:<part>', 'turn:<part>'. */
  id: string;
  kind: 'emissive' | 'rotate' | 'spin' | 'translate';
  part: string;
  /** The glTF node(s) it drives: for emissive the meshes whose ink material lights up, else the node it moves. */
  nodes: string[];
  value: {
    /** level: 0..1 brightness; rgb: three levels; deg: an angle; rpm: a speed; press: 0 up, 1 fully pressed. */
    unit: 'level' | 'rgb' | 'deg' | 'rpm' | 'press';
    min: number;
    max: number;
    rest: number;
  };
  /** emissive: the lit colour at full level (for 'rgb' the colour of each channel is red, green, blue). */
  color?: Hex;
  /** rotate, spin, translate: the axis (unit, root frame) and, for rotate and spin, a point on it. */
  axis?: Vec3;
  pivot?: Vec3;
  /** rotate: radians per unit of value away from rest, about axis by the right-hand rule.
      spin: +1 or -1, the sense about axis (CW seen from above is -1 about +Y); rad/s = scale * rpm * 2pi / 60.
      translate: metres per unit of value along axis. */
  scale?: number;
  /** Where the simulation keeps the value. net, rail, serial: the bench solver's LED drive ('D13', '5V', 'tx');
      param: a part parameter ('SRV1.angle'); press: a control's press by id; motor: a drone motor's speed by id. */
  bind?: { source: 'net' | 'rail' | 'serial' | 'param' | 'press' | 'motor' | 'pin'; key: string };
  extras?: Record<string, unknown>;
}

/** A set of meshes that see-through changes. base is always drawn; cover fades to coverOpacity; xray appears. */
export interface Layer {
  id: 'base' | 'cover' | 'xray';
  /** glTF mesh node names in this layer. */
  nodes: string[];
  /** Opacity at see-through 0 and at see-through 1 (base [1,1]; cover [1, 0.28]; xray [0, 1]). */
  opacity: [number, number];
}

export interface Text {
  part: string;
  text: string;
  /** Centre of the text's baseline. */
  position: Vec3;
  /** Out of the surface it is printed on. */
  normal: Vec3;
  /** Which way the top of the letters points. The reading direction is not stored: it is cross(up, normal), left to
      right for someone looking at the surface, so text can never come out mirrored. */
  up: Vec3;
  /** Cap height in metres. */
  size: number;
  color: Hex;
  weight: number;
  layer: 'base' | 'xray';
}

/** tools/xr-assets/out/index.json: every item the build wrote. */
export interface XrAssetIndex {
  schema: 'iynkware.xr-asset-index/1';
  generator: { tool: 'tools/xr-assets'; version: string };
  items: Array<{
    id: string;
    kind: ItemKind;
    name: string;
    glb: string;
    sidecar: string;
    triangles: number;
    drawCalls: number;
    anchors: number;
    channels: number;
    warnings: number;
  }>;
}
