# Lab equipment figures

Lab items are the equipment of a chemistry, physics or electronics-bench training lab: a beaker, a Bunsen burner, a
bench power supply. Each one is a hand-inked Colorfigures figure like every other 3D object in the repo, built into
`public/figures/lab/<id>.html` by `cfbuild.py` and checked by `cfshoot.py`, so the XR converter can capture it the
same way (`docs/XR_ASSETS.md`). A lab item also carries plain-English notes for the voice tutor: how to use it safely,
the mistakes people make with it, and how the figure reports one when it happens.

Read `docs/FIGURES.md` first (layout, build, shoot, bridge). This file covers what is different for lab items.

## 1. Files

```
figures/engine/lab.js          the lab layer: SL.lab.item(id, def), the page, glass and lathe helpers
figures/engine/lab.list        what a lab page loads: the bench engine (bench.js, bench-kinds.js, bench-bb.js) and lab.js
figures/engine/lab-catalogue.mjs   writes figures/lab/catalogue.json from the item files
figures/engine/lab.test.mjs    behaviour of every item, and the catalogue kept in step
figures/lab/<id>.js            one item
figures/prompts/<id>.md        its Colorfigures prompt
figures/lab/catalogue.json     generated: what the tutor and the converter read without running a page
public/figures/lab/<id>.html   build output; commit it
```

The items today: `beaker-250`, `erlenmeyer-250`, `bunsen-burner`, `bench-power-supply`, `pendulum-stand`,
`soldering-station`.

## 2. How an item registers

An item file is an IIFE with two directives and one call:

```js
// @cf title Bunsen burner
// @cf use engine/lab.list
(() => {
const LAB = SL.lab, T = LAB.T;
LAB.item('bunsen-burner', { name: 'Bunsen burner', fig: 'L3', foot: [205, 92, 260], params, actions, parts, draw, … });
})();
```

`SL.lab.item(id, def)` does three things:

1. It checks the definition and writes problems to `<html data-errors>` prefixed `lab:` (cfshoot fails on them).
2. It registers the drawing as a bench prop with the same name (`SL.bench.prop`, `docs/FIGURES-BENCH.md` §9.1), so a
   lesson circuit can stand the item on its mat: `props: [{ id: 'BKR', prop: 'beaker-250', at: [150, -30] }]`. The
   circuit's prop params are the item's params. A bench page that wants one adds `// @cf use engine/lab.js` and
   `// @cf use lab/<id>.js` after its bench list.
3. On its own page (`public/figures/lab/<id>.html`, or `?id=<id>`) it mounts the figure: the item alone on the
   cutting mat, a button per action, a picker per param, See-through and Labels, Exploded view when the item has one,
   pressable parts, the stats panel and the bridge.

Why not a bench part page: the bench engine mounts boards, and a part page is a board without a PCB running the
bench's state machine (power tree, build flow, modes, faults), whose `report` and `accept` keys are a board's. A lab
item has none of that. So the lab layer reuses the bench engine's registry, materials and drawing helpers
(`B.prop`, `B.M`, `B.aabb`, `B.slabW`) and mounts its own small figure. The bench engine is unchanged; a lab page sets
`SL.bench.started` so the bench does not try to mount anything itself.

Mind the reserved names (`docs/FIGURES.md`): `L` is the core's light vector, so the lab global is `LAB`, and a local
called `box`, `on`, `f` or `L` breaks the core helpers.

## 3. The item frame

Millimetres. x to the item's right, y away from its front, z up from the mat; the origin is the centre of `foot` on
the mat. This is the bench's board frame (`board-mm` in `docs/XR_ASSETS.md` §2), so the converter maps a lab item the
same way: asset X = x, Y = z, Z = -y. The front (the side with the controls and the printing) faces -y, as a
board's front is its y = 0 edge: on the page it is the face toward the viewer's lower right in the default view and
in Front view, and in the asset it faces +Z. A knob's `turn:` axis is +y (clockwise seen from the front is positive).

On the page, `ctx.W(x, y, z)` turns an item point into a world point for the core's drawing calls.

## 4. The definition

| Field | What |
|---|---|
| `name` | English name (a `CF_T` key), the page title |
| `fig` | figure number, `L1`, `L2`… |
| `foot` | `[w, d, h]` mm: the item's drawn box at rest, centred on the origin. The page is framed on it as a bench part page is: the frame is `foot` plus 10 mm, the mat `foot` plus 16 mm, and shadows stop at the mat's edge |
| `params` | `{ key: { label, values, range?, unit?, names?, show?, picker? } }`: the item's whole state the host may set. `values` are the picker's choices (the first is the default unless `defaults` says), `range: [lo, hi]` lets the host set any number between, `names` or `show(v)` give a choice's English label, `picker: false` keeps a param off the buttons (a state an action toggles: `gasOn`, `on`, `swinging`) |
| `defaults` | `{ key: value }` |
| `actions` | `[{ id, label, run(st, api) }]`: a button each. `id` is stable (`fill`, `light`, `heat`, `swing`, `power`); `api.set(key, v)` changes a param, `api.say(text)` shows a note, `api.sfx(name)` asks the host for a sound |
| `parts` | `{ ID: { name, role?, layer?, explode?, press?(st, api) } }`: the pieces. `name` is the `data-label`; `press` runs when the part is pressed (a knob steps its setting, the bob is released) |
| `draw(ctx)` | the drawing (§5) |
| `init(st)`, `onLoad(st)`, `onParam(st, key, value, old)`, `step(st, dt, api)`, `live(st)` | the item's own state in `st.s`; `step` runs on the figure's virtual clock while `live(st)` is true |
| `refuse(next, patch)` | a reason string when a host patch would leave an impossible combination (`lit` without `gasOn`) |
| `stats(st)` | `[{ label, value, small? }]`, label and words already through `T()` |
| `report(st)`, `reportKeys` | extra discrete state for the host (§7), and the list of its keys |
| `mistake(st)` | the id of the mistake that holds now, or `null` (§6) |
| `explode` | `true` when the item has an exploded view (parts move by `ctx.lift(offset)`) |
| `xrCaption` | the see-through caption |
| `xr` | `{ anchors, channels, extras }` for the converter (§8) |
| `lab` | the tutor notes (§6) |

## 5. Drawing

`draw(ctx)` gets `ctx.p` (the params), `ctx.s` (the item's own state), `ctx.t` (seconds on the virtual clock),
`ctx.k` (see-through 0..1), `ctx.ex` (exploded 0..1), `ctx.sel` (the selected part) and:

- `ctx.put(box, svg, part?)`: one drawn piece in its item-frame box `[[x0, y0, z0], [x1, y1, z1]]`; the pieces are
  depth-sorted by their boxes. With `part`, the piece is pressable (`data-act="part"`, `data-id`, `data-label`) and
  glows while selected. Cut long things (hoses, strings, leads) into short boxed pieces so they sort.
- `ctx.shadow(points)`: a cast shadow of world points on the mat (`ctx.ring` and `ctx.W` give them).
- `ctx.label(at, text, on)`: a see-through callout on an item point; laid out in two columns by the core.
- `ctx.ring(cx, cy, z, r, n)`: a horizontal ring of world points; `r` may be a function of the angle.
- `ctx.lift([dx, dy, dz])`: the same context moved by that offset times the exploded ease.

Helpers on `SL.lab`:

- `LAB.lathe(W, cx, cy, profile, material, shade, w, n)`: a body of revolution from `[[r, z], …]`.
- `LAB.glass(W, { outer, inner, level, liquid, marks, markAt, lip, k, n, surface, swirlAt })`: clear glassware with
  its liquid: the far wall faint, the liquid (its own `data-part="LIQUID"` group), the near wall as a light tint, a
  highlight streak, white printed marks, an inked rim. Glass is `CLEAR`, never opaque.
- `LAB.volumeTo(inner, h)` and `LAB.levelFor(inner, mL)`: the volume under a height and the height of a volume in a
  lathe's inside, so the liquid stands on the right graduation.
- `LAB.LIQUIDS` and `LAB.liquidParam()`: the shared liquids picker.
- `LAB.textOn(point, U, V, text, size, colour)`: printing on any plane, hidden when the plane faces away.

Budget: lab equipment is 20,000 triangles and 16 draw calls after conversion (`docs/XR_ASSETS.md` §8, from the lab
kind's contract PR). Keep rings at
12 to 28 segments, and draw a flame or a liquid as a few lofted rings, not a fine mesh. Text printed on the item
(VOLTAGE, 250 mL) is printing and is not translated.

## 6. Tutor notes and mistakes

Every item carries, in plain English, short sentences:

```js
lab: {
  lab: 'chemistry',                  // 'chemistry' | 'physics' | 'electronics'
  summary: 'A gas burner. The air collar sets the flame: …',
  safeUse: ['Close the air collar before you light it.', …],
  mistakes: [
    { id: 'gas-unlit', when: 'The gas tap has been on for more than 2 seconds with no flame.',
      say: 'Gas is on but not lit. Turn the gas tap off now, then light it the right way.' },
  ],
  hazards: ['Unburnt gas can build up and explode.', …],
},
mistake: st => st.p.gasOn && !st.p.lit && st.s.gasT > 2 ? 'gas-unlit' : null,
```

- `when` describes the condition for the tutor (it is not shown); `say` is what the tutor or the figure says. The
  figure shows `say` as a note when the mistake starts, so `say` is a `CF_T` key and needs its translations; the
  other tutor fields are for the voice tutor, which speaks the learner's language itself.
- `mistake(st)` returns the first id that holds, most specific first. It must be a pure function of the state: the
  page checks it after every action, patch and clock step, and `report` carries it as `mistake`.
- A mistake that depends on time (gas left on for 2 s) keeps the item `live` so the clock runs.

## 7. The bridge

`report(st)` sends `{ id, lab, exploded, selected, …every param, …def.report(st), mistake }`, all discrete: round
anything that changes every frame (`tipC` to 10 °C, `swings` as a count). The tutor reads it from the `state` event.

`accept` takes a patch of params by their keys, plus `exploded` and `select`. Every key is checked before any is
applied, so a bad value changes nothing and comes back as `error`: an unknown key, a value outside `values` and
`range`, or a `refuse` reason. `press` with an action id or a picker id works as for every figure.

The current items report:

| Item | Buttons | Report keys | Mistakes |
|---|---|---|---|
| `beaker-250` | `fill`, `empty`, `heat`, `liquid`, `volume` | `liquid`, `volume`, `heat`, `tempC`, `boiling` | `heating-empty`, `heating-too-full`, `overfilled` |
| `erlenmeyer-250` | `fill`, `empty`, `swirl`, `liquid`, `volume` | `liquid`, `volume`, `swirling` | `swirl-too-full`, `overfilled` |
| `bunsen-burner` | `gas`, `light`, `collar`, `exploded` | `collar`, `gasOn`, `lit`, `flame`, `gasUnlitS` | `gas-unlit`, `light-collar-open`, `blue-flame-idle` |
| `bench-power-supply` | `power`, `vSet`, `iSet`, `load`, `exploded` | `vSet`, `iSet`, `load`, `on`, `vOut`, `iOut`, `mode`, `pLoadW`, `loadHot` | `short-high-limit`, `resistor-overload`, `limit-at-max` |
| `pendulum-stand` | `swing`, `length`, `amplitude`, `bob` | `length`, `amplitude`, `bob`, `swinging`, `swings`, `periodS`, `periodSmallS`, `bobGrams` | `large-angle` |
| `soldering-station` | `power`, `iron`, `tempSet`, `sponge` | `tempSet`, `sponge`, `on`, `inHolder`, `tipC`, `heating` | `iron-left-out`, `too-hot`, `dry-sponge` |

## 8. XR: anchors and channels

The converter captures the drawing calls as for any figure. What it cannot see in them, the item declares in `xr`,
in item-frame mm (the catalogue repeats it):

- **Anchors** follow `docs/XR_ASSETS.md` §5. A terminal is a `pin` with the id the simulation uses (`+`, `-`, `GND`
  on the bench supply, with `aliases`); everything else is `<kind>:<name>`: `control:COLLAR`, `led:CV`, `screen:VOUT`,
  `port:SPOUT`, `label:FLAME`. `part` names one of `parts`; `normal` points out of the surface; `channel` names the
  channel that moves it (`SL.lab.item` notes an unknown one). A `screen` gives its `rect` (`origin` its top-left
  corner seen from the front, `u` and `v` its width and height, mm, and `pixels`).
- **Channels** follow §7, with its four kinds only (`emissive`, `rotate`, `spin`, `translate`): `turn:<part>` for a
  knob or collar (`rotate`, `deg`, `axis` and `pivot` in the item frame), `led:<part>` for a lamp (`emissive`),
  `press:<part>` for a switch (the supply's rocker is a `rotate`: it tips), and two lab ids whose kinds are still
  standard: `flame:<item>` (`emissive`, a flame's light) and `swing:<part>` (`rotate` about the pivot, a pendulum). `bind: { source: 'param', key }` names the param that
  drives it; when the param is not a number (`collar: 'half'`), `extras` gives the mapping (`deg: { closed: 0,
  half: 45, open: 90 }`); a lamp driven by reported state says so in `extras.on` (`report.mode === "CV"`).
- **Liquids** change geometry, which a channel cannot do: `xr.extras.liquid` gives the liquid's part, its `bind`, the
  inner profile and `levelMm` (the surface height for each picker volume), so the app can rebuild or scale it.
- **Parts**: `role` (`body`, `control`, `pin`, `light`, `liquid`, `wire`, `cover`), `layer: 'xray'` for what only
  see-through shows (a gas jet, the supply's insides) and `explode` offsets in mm for the exploded view.

The sidecar's `ItemKind` gains `lab` in its own contract PR (`tools/xr-assets/schema`, branch
`naeemexe/10-lab-kind-contract`): `source.engine` is `bench`, the frame `board-mm`, and the tutor notes ride in the
sidecar's `extras.lab` until a later contract change makes them a field. Until that lands the catalogue says
`kind: 'lab'` and nothing else depends on it.

## 9. The catalogue

`figures/lab/catalogue.json` lists every item: `id`, `name`, `page`, `lab`, `summary`, `safeUse`, `mistakes`
(`id`, `when`, `say`), `hazards`, `foot`, `params`, `defaults`, `actions`, `report` (every key the page sends),
`exploded`, `parts`, `anchors`, `channels` and `extras`. It is generated, never edited:

```bash
node figures/engine/lab-catalogue.mjs            # rewrite it
node figures/engine/lab-catalogue.mjs --check    # exit 1 when it is out of date
```

`figures/engine/lab.test.mjs` fails when it is out of step with the item files, or when a page reports a key the
catalogue does not list.

## 10. Recipe: a new lab item

1. **Facts.** Find the real object's size (a standard or a maker's drawing) and how it behaves, and note the source
   in the file's leading comment. Decide its params (the whole state the host may set), its actions, its parts, and
   two or three mistakes a learner really makes with it, each one a condition on that state.
2. **Prompt.** Write `figures/prompts/<id>.md` like the others: what it shows with its sizes, what each button does,
   what the tutor hears, the look.
3. **Figure.** Write `figures/lab/<id>.js` (copy the closest item). Draw in the item frame with the core's primitives;
   give every piece a part id, a box and, if it moves, a channel; fill in `lab`, `mistake`, `report`, `xr`.
4. **Build.** `python3 -I figures/tools/cfbuild.py lab/<id>`: `built …` and no warning.
5. **Shoot.** `python3 -I figures/tools/cfshoot.py lab/<id> --press "<button>@300" --at 1200`: exit 0, then look at
   `contact.png` (§11).
6. **Catalogue.** `node figures/engine/lab-catalogue.mjs`, and add the item's behaviour to `lab.test.mjs`.
7. **Words.** Every new string the page shows needs keys in `src/i18n/figures/{de,es,fr,hi,zh}.json` (English is the
   key) and in `src/i18n/figure-keys.json`, which `node scripts/figure-strings.mjs` regenerates from the built
   pages (`--static` checks the sources quickly). Translate them properly.
8. **Checks.** `npx vitest run figures/engine/lab.test.mjs src/i18n scripts/figures-first-party.test.mjs`.

## 11. Checklist

- [ ] Sizes come from a named source; nothing is placed by eye.
- [ ] `cfbuild` prints `built …` with no warning; `cfshoot` exits 0 (no `data-errors`, no NaN, no overlapping or
  off-frame labels, no page errors, the bridge check passes).
- [ ] `angle-*`: it reads right from every side, nothing floats or sinks into the mat, glass is see-through and the
  liquid sits on the right mark.
- [ ] `xr-*`: see-through shows the insides and the callouts stay inside the frame; `exploded-*` (when it has one)
  moves the parts apart along their real assembly direction.
- [ ] `press-*`: every action ends in the state it says; a refused action says why.
- [ ] Every mistake is reachable from the page's own buttons and from a host patch, and `report.mistake` names it.
- [ ] `catalogue.json` is regenerated and `lab.test.mjs` passes.
- [ ] Every string is in the six languages.
