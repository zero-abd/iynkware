# XR assets: the contract

iynk's hand-inked figures, turned into 3D assets for the headset. `tools/xr-assets` runs every figure headlessly,
captures the 3D drawing calls the figure makes, and writes per item a binary glTF (`.glb`) and a sidecar JSON. The glTF
holds the geometry; the sidecar holds everything a simulation needs to attach to it: named anchors for pins, holes,
LEDs, controls, motors and labels, the part hierarchy with explode offsets and see-through layers, and the channels
that move or light parts from runtime state.

This file is the contract between the converter and the headset app. The sidecar's shape is frozen as version 1 in
[xr-asset.ts](../tools/xr-assets/schema/xr-asset.ts) (TypeScript) and
[xr-asset.schema.json](../tools/xr-assets/schema/xr-asset.schema.json) (JSON schema, draft 2020-12). A change to either is
a `contract-change` PR of its own. New optional data goes in an `extras` object first; it becomes a field only by such
a PR.

## 1. Files

```text
tools/xr-assets/
  package.json        its own dependencies (three, jsdom); the Next app gains none
  build.mjs           the converter: node build.mjs [--out <dir>] [<dir>/<id> ...]
  capture/            the headless runner and the bench and drone adapters (no flight range adapter yet)
  gltf/               geometry builders, merging, the glb writer
  material/           the ink look for three.js, and loadXrAsset()
  schema/             xr-asset.ts, xr-asset.schema.json
  viewer/             a desktop page to look at any item
  samples/            the Blink scene's items and one drone, committed
  test/               node:test suites
  out/                build output, git-ignored
```

`npm run xr:assets` (from the repo root) builds every item into `tools/xr-assets/out/`:

```text
out/index.json                 every item: id, kind, name, files, triangles, draw calls, anchors, channels, warnings
out/<dir>/<id>.glb             the geometry
out/<dir>/<id>.json            the sidecar
```

`<dir>/<id>` is the figure's path under `figures/` without `.js`: `boards/uno-r3`, `parts/breadboard`,
`modules/l298n`, `robotics/l298n`, `drones/quad5`, `lab/beaker-250`. `<dir>` is one of `boards`, `parts`, `modules`,
`robotics`, `drones`, `flight`, `lab`; the sidecar's `kind` says the same in the singular (`robotics` is `bench`, `lab`
stays `lab`).

**Lab equipment** (`lab`) is glassware, burners, bench instruments and physics apparatus for the headset's training
labs. Its figures are drawn by the bench engine, so `source.engine` is `bench`, the frame is `board-mm` and the origin
rule is the bench items' one. What a voice tutor needs about an item (what it is, safe use, common mistakes, hazards)
rides in `extras.lab` until a later `contract-change` PR makes it a field.

Generated assets are built, not committed: `out/` is git-ignored and the app's build copies what it needs (pass
`--out <dir>` to write straight into the app's static folder). Only `samples/` is committed, so the app and the viewer
work without a build: the Blink scene (`boards/uno-r3`, `parts/breadboard`, `parts/led`, `parts/resistor`,
`parts/wire`) and `drones/quad5`. A test checks that the samples are byte-identical to a fresh build;
`node build.mjs --samples` rewrites them. An asset is stale when its
`source.pageSha256` differs from the figure page the current code builds; `build.mjs --check` reports that.

## 2. Coordinates

- Units are **metres**. Axes are glTF's: right-handed, **+Y up**, the item's **front faces +Z**. A person standing at
  +Z looking towards -Z sees the item's front; +X is on their right (the item's own left).
- **Origin.** Bench items (boards, parts, modules, benches, lab equipment): x and z at the centre of the geometry's
  bounds, y = 0 on the surface the item stands on (the top of the cutting mat in the figure; standoffs and feet rest on it). A part
  that plugs into a breadboard (an LED, a resistor, a jumper wire: every `parts/*` page that shows the part in a
  breadboard) has y = 0 on the breadboard's top face, where its legs enter, so its leg anchors sit at y = 0 and it
  seats by matching a leg anchor to a hole anchor. Its sidecar says so in `extras.bench.partPage`. Drones:
  x and z at the craft's own origin (the centre of its motors), y = 0 on the mat. The flight range: its own world
  origin.
- **The figure's frames.** Board data is in mm with x to the right, y towards the back and z up from the PCB's top
  surface (`board-mm`); a board's front is its y = 0 edge. Drone data is in mm with x forward, y left, z up, z = 0 on
  the mat (`flu-mm`, docs/FIGURES-DRONE.md section 2). Both are right-handed. The mapping into the asset is a
  rotation, a scale of 0.001 and a translation, stored as `frame.fromSource` (a column-major 4x4), so a position the
  simulation knows in board mm can be placed on the asset exactly:

  | Source | Asset X | Asset Y | Asset Z |
  |---|---|---|---|
  | `board-mm` (x right, y back, z up) | x | z | -y |
  | `flu-mm` (x forward, y left, z up) | y | z | x |

- **Handedness.** The Colorfigures camera is mirrored: its right, up and towards-viewer vectors satisfy R x U = -V
  (`figures/vendor/colorfigures/core.js`, `camBasis`). The bench engine cancels that with a reflection in its board to
  world mapping (`BP` in `figures/engine/bench.js`), so a 2D board figure shows the board as it is. The drone engine
  maps craft coordinates with a pure translation (`W` in `figures/engine/drone-geo.js`), so **a 2D drone figure is the
  mirror image of the craft data**: motor M1 of a Betaflight quad sits rear-right in the data and reads as rear-left
  in the 2D figure. The converter undoes each engine's own mapping and writes the data's true geometry: Uno pin D13
  is on the digital header to the left of D12 seen from the front, and M1 is rear-right (-X, -Z) on every Betaflight
  quad. Tests check both (section 8). The 2D figures are left as they are, so **a drone asset looks like the mirror of
  its 2D figure** (the nose camera, the XT60 lead and a tricopter's tail servo swap sides). That is correct, not a
  bug. The figure's motor-test arrow is mirrored too: on screen, a CW motor's arrow turns counter-clockwise. The asset
  follows the data.

## 3. glTF

One `.glb` per item, glTF 2.0, no extensions required, no textures, no Draco or meshopt compression (nothing needs a
decoder worker). Indices are 16-bit when a primitive has fewer than 65,536 vertices.

**Nodes.** The scene has one root node named after the item id. Under it:

| Node | What | Layer |
|---|---|---|
| `static` | every piece that never moves on its own, merged | base |
| `static.cover` | cover parts (drone canopies), merged | cover |
| `static.xray` | what only see-through shows (dies, bond wires, inner flows), merged | xray |
| `<channel id>` | the piece a channel moves or lights (`led:L`, `prop:M1`, `press:RESET`), with its rest transform | base |

Inside a mesh node, geometry is merged by material, so a mesh has at most one triangle primitive per shading class and
one line primitive. Each channel node has its own glTF materials, so lighting one LED never lights another.

**Names.** three.js's GLTFLoader sanitises node names (it strips `.`, `:`, `/`, `[` and `]`, so `static.cover`
arrives as `staticcover` and `led:L` as `ledL`) and keeps the glTF name in `userData.name`. Look nodes up by
`userData.name`, never by `getObjectByName` with a sidecar id.

**Materials** are named for their shading class and carry it in `extras.iynkInk.shade`:

| Material | Shading | Use |
|---|---|---|
| `ink.sun` | three bands against the sun: light above -0.15, dark below -0.45 | outer bodies (`tone` in the core) |
| `ink.fixed` | three bands against the fixed light: light above 0.6, dark below 0.05 | small parts, interiors (`toneI`) |
| `ink.flat` | the light band only, double-sided | silkscreen, pads, printed areas, flat fills |
| `ink.line` | lines (`mode` 1), vertex colour | face edges, traces, bond wires |

Every material is `pbrMetallicRoughness` with metallic 0, roughness 1 and base colour white, and every triangle
material is double-sided, so a plain glTF viewer shows the light band from the vertex colours. The ink material
(section 6) reads the extra attributes below and draws the real look.

**Vertex attributes** (three.js's GLTFLoader lowercases custom names: `_INK_MID` arrives as `_ink_mid`):

| Attribute | Type | Meaning |
|---|---|---|
| `POSITION` | float vec3 | metres, the node's local frame |
| `NORMAL` | float vec3 | the face normal, outward; faces do not share vertices, so shading is flat |
| `COLOR_0` | unsigned short normalized vec3 | the light band, linear |
| `_INK_MID`, `_INK_DARK` | unsigned short normalized vec3 | the mid and dark bands, linear |
| `_PART` | unsigned short scalar | index into the sidecar's `parts` |
| `_EXPLODE` | float vec3 | the part's offset at explode = 1, metres (static meshes only) |
| `_OUTLINE_NORMAL` | byte normalized vec4 | the normal averaged over coincident vertices of one part, for the outline |
| `_LINE_WIDTH` | float scalar | on line primitives: the figure's stroke width in its own units (0.5 to 2.8) |

A band colour is the figure's own: a material is `{ l, m, d }`, usually `m` 16 % and `d` 42 % of the way to black
from `l` (`matOf` in the core), and some materials (metal, gold, the board) pick all three by hand.

**Paint order.** A figure paints in order, so a face drawn over another in the same plane (a wheel's spoke gaps on
its hub, a mounting hole's ring on the board) wins there. In 3D the two would share their depth and z-fight, so the
converter lifts each such face 0.1 mm along its normal per face it covers (at most 4 layers;
`tools/xr-assets/gltf/coplanar.mjs`). Planes within 0.05 mm count as one, which takes in the figure's own decal
offsets of a few hundredths of a millimetre. Within one mesh node only.

## 4. The sidecar

The full type is in [xr-asset.ts](../tools/xr-assets/schema/xr-asset.ts). In short:

| Field | What |
|---|---|
| `schema` | `iynkware.xr-asset/1` |
| `id`, `kind`, `name` | `boards/uno-r3`, `board`, `Arduino Uno R3` |
| `glb` | the `.glb` file next to it |
| `source` | the figure file, the engine, the page's sha256, the component descriptor its pin ids come from |
| `frame` | units, axes, origin, the source frame and `fromSource` |
| `bounds`, `stats` | bounds at rest; triangles, draw calls, line segments, nodes, bytes |
| `look` | ink, paper and shadow colours; the sun, fixed light and default view directions in the root frame |
| `parts` | the hierarchy: id, `_PART` index, name, parent, role, nodes, bounds, explode offset, cover, build group |
| `anchors` | named points with position and normal (section 5) |
| `channels` | what moves or lights with runtime state (section 7) |
| `layers` | `base`, `cover`, `xray`: their mesh nodes and opacity at see-through 0 and 1 |
| `texts` | printed text with position, normal, up, size and colour; the app draws it |
| `warnings` | what the converter could not carry over, one sentence each |

Everything is at rest: explode 0, see-through 0, every channel at its rest value. A part's anchors, nodes and
`_EXPLODE` vertices all move by `explode x part.explode`.

**Explode** is one number from 0 to 1 for the whole item. Bench parts rise by their build group (smd 4 mm, low 9,
tall 14, last 19, as the figure); drone parts rise by their own `z` times the craft's explode factor.

**See-through** is one number from 0 to 1. `base` stays, `cover` fades from 1 to 0.28 (the drone figure's 72 %
fade), `xray` fades in from 0.

## 5. Anchors and the id scheme

An anchor is `{ id, kind, part, position, normal }` plus what its kind needs. Ids are unique in an item and are the
ids the simulation already uses, so a wire or probe attaches by id:

| Kind | Id | Position, normal |
|---|---|---|
| `pin` | the component descriptor's pin id: `D13`, `GND`, `ICSP_3` (Uno), `A`, `K` (LED), `VCC` (a module); else the figure's pin id `J3.6` | a male pin's tip or a socket's mouth; out of it |
| `hole` | `a1` ... `j30`, rail holes `RAIL_TP2`, `RAIL_TN2`, `RAIL_BP2`, `RAIL_BN2` (as `src/project/holes.ts`) | the hole's mouth on the top face; +Y, with `depth` |
| `header` | `header:<part>`, `members` its pins in order | its centre; up |
| `strip` | `strip:S12u` (column 12, rows a to e), `strip:S12l` | centre; up |
| `rail` | `rail:RAIL_TP`, `members` its holes | centre; up |
| `led` | `led:<part>` | the lens's top; up |
| `control` | `control:<part>` | where a finger presses; out of it |
| `motor`, `prop` | `motor:M1`, `prop:M1`, with `dir` CW or CCW | on the axis at the hub's top; the axis |
| `label` | `label:<part>` (a part's tag), `label:<part>.<n>` (a see-through callout, `layer` xray) | the point the leader line touches; out of the surface, `up` |
| `screen` | `screen:<part>` | its centre; out of the glass, with `rect` |
| `port` | `port:<part>` | where a cable plugs in; the plug's direction |

Inside a bench the ids of a mat item's anchors are prefixed with its id and a slash: `NANO/D8`, `BB/a1`,
`led:NANO/L`. The base board's anchors have no prefix. `aliases` lists the other names one point answers to: its net
(`D13`), its silkscreen label (`~3`), the figure's pin id (`J3.6`) and breadboard ref (`T+12`); an alias is never another
anchor's id. A net with several pins (the Uno's `GND`) lists each pin under its own id; the simulation's descriptor
says which is which.

## 6. The ink look

`tools/xr-assets/material/` is plain three.js with no other dependency. It ports the Colorfigures shading (MIT, April
Zhu; the notice is kept in the file):

- **Bands**: a `ShaderMaterial` that picks light, mid or dark per face from the normal against the sun or the fixed
  light with the figure's thresholds and its 0.18 soft step, from the vertex band colours. The light is fixed in the
  world (the figure's light stays fixed to the viewer; in a headset that would swim). `look.sun` gives the direction
  that makes the item's default view match its figure.
- **Face edges**: the line primitives, in ink `#231e16`, or their own colour for traces and wires. Fat lines (the
  default) draw a segment that repeats an earlier one's points (a prop's highlight stroked over its ink edge) one
  depth push nearer per repeat, so the later stroke wins as it does in the figure.
- **Silhouette**: an inverted hull, pushed out along `_OUTLINE_NORMAL` by a constant screen width. No
  post-processing.
- **Shadow**: the static meshes drawn again flattened onto y = 0 along the sun, in `#41538f`, with a polygon offset.

Target: 72 to 90 fps on a Quest 3S with a bench of several items in view.

## 7. Channels

A channel is a transform or a material parameter driven by one value. It never changes geometry.

| Kind | Value | Effect |
|---|---|---|
| `emissive` | `level` 0..1, or `rgb` [r, g, b] | the node's ink bands blend towards `color` by `level`; for `rgb` (an RGB LED, no `color`) each of r, g, b is 0..1 for one die, the bands blend towards (r, g, b) scaled so its largest component is 1, by that largest component |
| `rotate` | `deg` | the node turns `scale x (value - rest)` radians about `axis` through `pivot` |
| `spin` | `rpm` | the node turns continuously at `scale x rpm x 2pi / 60` rad/s about `axis` through `pivot`; `scale` is +1 or -1 |
| `translate` | `press` 0..1 | the node moves `scale x value` metres along `axis` |

Ids: `led:<part>`, `servo:<part>`, `turn:<part>` (a knob), `press:<part>` (a button), `motor:<part>` (a DC motor's
shaft, a fan), `prop:<motor>` (a drone prop). `bind` says where the simulation keeps the value: `net`, `rail` or
`serial` for a bench LED (`D13`, `5V`, `tx`), `param` for a part parameter (`SRV1.angle`), `press` for a control,
`motor` for a drone motor. Spin direction follows the craft data: CW seen from above is `scale` -1 about +Y.

Loading an item and driving it, with the helper from `tools/xr-assets/material/`:

```js
import { loadXrAsset } from './tools/xr-assets/material/xr-asset.js';
const uno = await loadXrAsset('/xr-assets/boards/uno-r3.json');  // sidecar + glb, ink look applied
scene.add(uno.object);                       // a THREE.Group in metres, +Y up, front towards +Z
uno.set('led:L', 1);                         // the L LED fully lit
uno.set('press:RESET', 1);                   // RESET held down
uno.explode(0.5); uno.seeThrough(1);         // both 0..1
const d13 = uno.anchor('D13');               // { id, kind, position: THREE.Vector3 (world), normal, ... }
renderer.setAnimationLoop((t) => { uno.update(clock.getDelta()); renderer.render(scene, camera); });
```

Without the helper, a channel is a node by its glTF name (`userData.name`, section 3) and a uniform or a transform:

```js
const gltf = await new GLTFLoader().loadAsync('/xr-assets/drones/quad5.glb');
const side = await (await fetch('/xr-assets/drones/quad5.json')).json();
const ch = side.channels.find((c) => c.id === 'prop:M1');
let prop; gltf.scene.traverse((o) => { if (o.userData.name === ch.nodes[0]) prop = o; });
const axis = new THREE.Vector3(...ch.axis), q = new THREE.Quaternion();
let angle = 0;                                    // each frame:
angle += ch.scale * rpm * 2 * Math.PI / 60 * dt;  // the pivot is the node's own origin at rest
prop.quaternion.copy(q.setFromAxisAngle(axis, angle));
```

A channel node is a direct child of the root with no rest rotation or scale; its translation is its pivot (for
`rotate` and `spin`) or its part's centre, so a `rotate` or `spin` is a rotation of that node alone and explode adds
`explode x part.explode` to its translation.

## 8. Budgets and checks

Budgets are per item at rest, base and cover layers, before the outline and shadow passes. The converter warns when
an item is over; the build table shows every item's numbers. A draw call here is one glTF primitive. The ink material
adds one silhouette per mesh node (its triangle primitives merged) and one shadow per static node and per moving
channel node, so on screen a mesh node costs its primitives plus up to two.

| Item | Triangles | Draw calls |
|---|---|---|
| part | 12,000 | 12 |
| lab equipment | 20,000 | 16 |
| board, module | 40,000 | 32 |
| bench | 150,000 | 96 |
| drone | 80,000 | 64 |
| flight range | 60,000 | 24 |

`npm run xr:assets` prints a table of every item (triangles, draw calls, anchors, channels, warnings).
`npm --prefix tools/xr-assets test` runs the geometry builder tests and the anchor tests: the Uno R3's header pin order
and positions against `src/parts/data/uno-r3.component.json`, the half breadboard's 400 holes against
`src/parts/data/breadboard.component.json`, a bench's wire ends, and a drone's motor numbering and spin directions
against its craft data.
