# XR design: the interaction and experience spec

How iynkware looks, feels and responds on a Meta Quest 3S with controllers and hand tracking both on. Every headset
workstream builds to this file so that the bench, run and stress, learn, scale and insight, range and shell feel like
one product. This file says how things behave; [XR_ARCHITECTURE.md](XR_ARCHITECTURE.md) says where code goes and
fixes the contracts in `xr/src/contracts/`; assets and the ink look are [XR_ASSETS.md](XR_ASSETS.md). A change to a
decision here is its own PR.

Dated 2026-11-14. Written when only the foundation's skeleton existed: numbers are starting values to try on the
device, and section 12 is the bar the final polish pass is held to.

## 0. Conventions

- Units: metres (m), millimetres (mm), degrees, milliseconds (ms). **life** = the real hardware's size; **work** = as
  drawn on the bench at the current work scale `s` (section 3.4). A 2.54 mm pitch is 7.62 mm of work at `s` = 3.
- **dmm** is angular size: 1 dmm = 1 mm per metre of viewing distance (0.057 degrees; Meta's UI Set `dp` is the same
  idea). Text and UI are specified in dmm so they keep their angular size: 20 dmm at 0.6 m is 12 mm tall.
- **Body frame**, fixed when the bench is placed: origin on the floor under the eyes, +Y up, -Z the head's yaw, +X
  right. `E` = eye height. **D** = the dominant side (+X for right-handed; every layout here mirrors for left-handed).
- Markers: **[SDK]** IWSDK 1.1.0 gives it, reached only through the shared services (`app.input`, `app.bench`,
  `app.overlay`), never by a pillar adding IWSDK components (XR_ARCHITECTURE.md section 11); **[custom]** we build it;
  **[contract]** it needs a field or call the contracts lack, added in a `contract-change` PR first; **[device?]**
  assumed Quest Browser or device behaviour nobody has tried. Names in `code` are the ones code and tests use.

## 1. Principles

| # | Principle | What it rules out |
|---|---|---|
| 1 | **The bench is the interface.** You act on the part: seat it, wire it, probe it, break it. | Property sheets for anything a hand can do; build actions in menus; a global toolbar in your face. |
| 2 | **One grammar, two inputs.** Every verb works with hands and with controllers, near and far, with the same targets and feedback. | Controller-only or hands-only features; gestures beyond pinch, poke, grab and palm-facing; per-feature button maps. |
| 3 | **Show before commit.** What a pinch or trigger will do is visible before it happens: the targeted hole, the ghost, the wire end, the reading. | Placing on release without a preview; hidden snapping; an action that lands somewhere other than what was highlighted. |
| 4 | **Never wrong, always undoable.** An invalid placement cannot be made; every bench change is one undo. | Error dialogs after the fact; confirmation prompts for reversible actions; destructive actions without undo. |
| 5 | **Ink, not glow.** Three flat bands, ink outline, flat shadow, paper plates; state is colour plus icon plus word. | Bloom, gradients, glassy translucent panels, neon rays, colour-only status, any post-processing. |
| 6 | **Only the person moves the camera.** Scale, replay and flight change the content, never the viewpoint. | Forced camera moves, camera shake, roll, automatic teleports, full-view FPV. |

## 2. Space and ergonomics

### 2.1 The bench

| | Standing | Seated |
|---|---|---|
| Top height | `E - 0.47` m (just above elbow height), clamped 0.80 to 1.20 m | `E - 0.47` m, clamped 0.62 to 0.85 m |
| Front edge | 0.35 m ahead of the eyes where Recentre puts it (0.15 m was too close on a Quest, #363) | same |
| Shape | half-round (horseshoe): an annular sector about a point 0.30 m behind the eyes, inner radius 0.45 m, spanning 70 degrees either way, so its inner edge is the front edge ahead and comes back to beside the person | same |
| Depth (ring) | 0.60 m | 0.55 m |
| Mat (width x depth, on the centre, front edge at the rail) | 0.90 x 0.48 m | 0.86 x 0.44 m |
| Front rail | the mat's first 0.04 m of depth, raised 0.03 m, tilted 30 degrees up towards the user: about 0.47 m from the eyes | same |
| Work zone | the mat from the rail back 0.30 m, 0.60 m wide; its centre 0.34 m ahead | 0.54 m wide |
| Eye to work centre | about 0.58 m, 54 degrees below horizontal | same |

Posture is inferred at placement (`E` >= 1.40 m is standing) and shown as a chip on the rail ("Standing, change").
Placement writes `BenchSpace.setBenchTop` and `XrSettings` `posture` and `benchHeight`; the contract's defaults (0.74
m, centre 0.6 m ahead) serve only the flat page and the emulator. No point of the mat is closer than 0.5 m to the
eyes. The rail is, on purpose: it is touch UI, which Meta places at 0.42 to 0.46 m.

### 2.2 Reach zones

Reach is measured from the nearer shoulder: 0.18 m either side of the midline, at `E - 0.22` m, under the eyes.

| Zone | Where | Holds | Input |
|---|---|---|---|
| Z1 Work | the work zone; every point within 0.60 m of the nearer shoulder | boards, breadboards, live parts, wires | near first, far works |
| Z2 Reach | the rest of the bench within 0.65 m of the nearer shoulder | shelf, tools, rail | near first, far works |
| Z3 Point | further than that, behind the bench, or over 0.25 m above the mat | guide, code, serial, scope screen, home, catalogue | far (ray) |

Nothing a person must use sits above eye height, below the bench top or behind them. Meta gives seated reach as a
0.6 m radius from the torso; Z1 fits inside it and Z2 is a brief reach. The back strip of the mat, behind Z1, is where
catalogue items arrive and where loose things can be parked.

### 2.3 Where things live (top view, right-handed)

```text
        guide (-31)        scope, onboarding (0, low)    code (+30)
  side (-58)                                                    serial (+62)
                  .------------------------------------.
               .-'    back strip: deliveries, parking    '-.
   session   /   +------------------------------------+    \
   controls |    |  work zone (Z1): board, breadboard |     |
   (-86)    |    +------------------------------------+     |
    tools rack \  | Scale - 3x + | [RUN] | Undo Redo ticker |  / parts shelf
    (left wing) '-.______________ rail ______________.-'  (right wing)
                                    you
```

- **Table:** half-round, so everything has room and the wings come round to the person (`bench/core/geometry.ts`,
  `table`). The cutting mat lies on its centre; the shelf and the tools rack stand on the wings, turned to face the
  person, within 0.5 m of the nearer shoulder. In passthrough only the mat is drawn (it lies on the real table); the
  studio draws the round table on five legs.
- **Panel ring** (`bench/core/ring.ts`): every floating panel that belongs to the bench has a fixed slot just beyond
  the table's back edge, at its own design distance, facing the eyes and locked to the bench (angles towards D in the
  sketch; they mirror for a left-handed person). Neighbours leave about 3 degrees between them, so panels never stack.
  Dragging a panel keeps it where it was left; Tidy up puts it back in its slot. Panels opened from Home or the menu
  in front of the head (Home, the menu, projects, confirmations) are not in the ring.
- **Shelf** on the wing of side D, 56 degrees round the ring at 0.76 m from its centre, three tiers rising 0.04 m each towards the back. Twelve
  bins of small parts at 3x (LEDs, resistors, buttons, pots, sensors, modules). In a lesson it holds only that
  lesson's parts. Boards, breadboards, motors and batteries come from the catalogue (Z3) and are delivered to a free
  spot on the mat.
- **Tools rack** mirrored on the other wing: multimeter with probes, scope probe, torch and magnet (world inputs),
  and in the fault lab the fault deck.
- **Rail**: Scale on the other side, the run cluster in the centre (x -0.15 to +0.15 m), Undo and Redo at the D end, and the
  ticker: one line naming the last event ("Wire joined D13 to row 10"), 20 dmm, fading after 4 s. Panels in Z3 are
  locked to the bench and move with it (section 9).

### 2.4 Placing and re-placing the bench

- **First entry:** the bench is placed by the table above from the head pose (yaw only) and fades in over 400 ms
  while rising 0.03 m; it never pops in. Placement does not persist across sessions in v1 (anchors are later work).
- **On a real table** [custom] [device?]: if plane detection is granted and a horizontal plane of at least
  0.6 x 0.4 m lies 0.6 to 1.1 m high within 0.9 m, a dashed ghost bench appears on it with a "Use this table" button.
  Accepting puts the mat on the plane (+0.01 m) with its front edge on the table's nearest edge. Without planes the
  bench stands on drawn legs down to the floor (`local-floor` y = 0).
- **Move:** two handles, bars 0.12 m long sticking out 0.04 m from each end of the bench. One hand on a handle moves
  the bench in x, y and z and yaws it about the far handle; two hands set position and yaw. Pitch and roll stay level.
  Height is clamped to 0.55 to 1.25 m. On a detected table it snaps to the plane within 0.03 m.
- **Bring here:** Menu, then Bench, then "Bring the bench here" places it again from the current head pose (fade out
  150 ms, fade in 250 ms); the system recenter (`reset` on the reference space) does the same [device?]. The same menu
  has height minus and plus in 0.02 m steps.

### 2.5 Passthrough and the paper room

The VR studio (`XrSettings.space` and `XrMode` `vr`) is called the **paper room** in the product, so it is never
confused with iynk's Studio (your own projects).

| | Passthrough (default) | Paper room |
|---|---|---|
| Background | the room | a paper dome (`paper`, or `paper-dim` in a dim room) with an ink horizon ring at 25 m, level at eye height |
| Floor | real floor | disc of 6 m radius, ink grid every 0.5 m at 12 % |
| Your hands | your real hands; no visible hand mesh, only the pinch cursor and the ray; the hand mesh is drawn depth-only so virtual parts hide behind your fingers [custom] | ink hands: outline plus paper fill |
| Controllers | real ones in passthrough; tooltips anchored to the grip pose; no model | ink controller models from self-hosted input profiles [custom] |
| Shadows | items on the mat cast flat shadows onto the mat only | the bench casts onto the floor as well |
| Switch | Menu, then View, then Passthrough or Paper room: the dome crossfades in 500 ms; never a cut | same |

Both run in the same `immersive-ar` session; the paper room is an opaque dome drawn over passthrough, so switching
never restarts the session [custom]. Only where `immersive-ar` is refused does the paper room run as the
architecture's `immersive-vr` fallback, and View hides the switch. The mat is the figures' sage cutting mat in both
rooms (9.3); in passthrough it lies on the real table with no slab or backdrop under it.

### 2.6 Minimum sizes

| Thing | Minimum |
|---|---|
| Poke target (touch range, <= 0.6 m) | visual 36 mm, hit 48 mm, 12 mm between hit areas |
| Ray target (Z3) | visual 40 dmm, hit 56 dmm (3.2 degrees), 12 dmm apart |
| Primary control (Run, Next, Start, Arm) | hit 64 dmm, or 60 mm in touch range |
| Grab collider | 30 mm across for hands, 20 mm for controllers, extended past the mesh of small parts |
| Pin or hole target | the hole's whole cell: the grid is tiled, with no dead space between holes (section 3.4) |
| Readable text | 18 dmm font size; body 22 dmm (section 9) |
| Icon; status badge on a part | 24 dmm (32 standard); badge 30 dmm |

## 3. One interaction grammar

### 3.1 Pointers

- Each hand or controller has one pointer at a time: **near** when its pinch point (hands) or tip (controllers: the
  target ray's origin) is within 0.04 m of a grabbable's collider or 0.02 m of a poke surface, else **far** (the ray).
  It enters near at those distances and leaves at 0.06 and 0.04 m, so it never flickers at the edge [SDK pointers;
  the hysteresis is input service work].
- The ray is an ink line 1.5 mm wide, ending in a reticle ring of 10 dmm at the hit. It is shown only while the pointer
  is far and points at something interactive or the hand is raised to aim; it hides while near.
- One hover target per pointer. Ray hover changes target only when the ray has left the current target's hit area by
  8 dmm for two frames [custom].
- Hand pinch and select come from the system's select events [SDK]. A **tap** is a pinch released within 300 ms having
  moved under 10 mm; anything longer is a **hold**.
- Target priority under a pointer: (1) a pin or hole cell (only within 0.015 m work above its mouth), (2) a
  component control (button cap, knob), (3) a wire end bead, (4) a part body, (5) a board or breadboard edge band
  (0.02 m work wide, outside the hole grid), (6) panels. The hover state always shows which one it is (section 4).
  Today a near hand pinch only grabs and a select travels along the ray; a select at the pinch point on a cell, and
  this priority, are input service work [custom] [contract: a near-select kind in `BindOptions`].

### 3.2 Verbs

H = hands, C = controllers. "1-hand" is the path that needs one hand only, where the normal path needs two.

| Verb | H near | H far | C near | C far | Notes and 1-hand |
|---|---|---|---|---|---|
| hover | pinch point or index tip within reach | aim ray on target | tip within reach | ray on target | highlight per section 4 |
| select | index poke (UI) or pinch tap (part, wire, pin) | pinch tap on the ray | tip poke, or trigger tap | trigger tap | selecting a part or wire opens its chip; select the mat to clear |
| grab | pinch hold on a body | pinch hold on the ray: part flies to the hand in 250 ms [SDK MoveTowardsTarget; the input service moves every distance grab by MoveFromTarget today: contract] | grip | trigger hold on the ray, as the far pinch | boards and breadboards: by their edge band (H) or anywhere (C grip) |
| move | move the hand | (held in hand by then) | move | (in hand) | panels and the bench move at a distance [SDK MoveFromTarget] |
| rotate | turn the wrist; near the board the ghost yaws in 90 degree steps with 15 degrees of hysteresis | same once in hand | turn the controller, or thumbstick flick left or right: 90 degrees | same | 1-hand: wrist or flick |
| release | open the pinch | same | let go of grip | same | seats, lies on the mat or goes back (3.4) |
| seat a part | release while the ghost is valid | same | same | same | one batch, one undo |
| pull a part | grab a seated part and lift it 1 pitch (work); below that it stays put and a tether line shows | far grab, then lift | grip and lift | same | wires on holes stay; pin-to-pin wires follow the part |
| take apart | both hands hold one item and pull apart: explode follows the spread, 0.10 m = fully exploded | item chip, Take apart slider | both grips | chip | 1-hand: the chip slider |
| start a wire | pinch hold on a pin or hole cell | pinch hold with the ray on a pin or hole | trigger hold with the tip on a cell | ray plus trigger hold | a wire never starts from a body |
| end a wire | release over the targeted pin or hole | release with the ray on one | release trigger | same | the end lands on the highlighted cell only |
| cancel | release over no target | same | B or Y | same | the part goes back, the pending wire is dropped, the top panel closes |
| press a component button | index poke on the cap, pressed past 3 mm (work) of travel and held as long as the finger stays in | pinch hold on the cap | tip poke, or trigger hold on the cap | ray plus trigger hold | 1-hand latch: part chip, "Hold down" |
| turn a pot | pinch the knob, twist the wrist 1:1 around the knob axis | pinch on the ray and drag sideways: 0.15 m = full range | grip or trigger on the knob and twist | ray hover plus thumbstick x: full range in 2 s | clamped to the part's range |
| probe | hold a probe; its tip snaps to a cell within 1 pitch (work) once within 0.01 m | not offered | same with grip | not offered | 1-hand: select a pin, then "Measure" gives the volts to ground |
| scale the world | pinch both hands on empty space within 400 ms of each other and spread or close | none | both grips on empty space | none | 1-hand: rail Scale minus and plus |
| summon a menu | turn the non-dominant palm to the face (palm normal within 40 degrees of the eyes, hand 0.25 to 0.55 m away, still, fingers open) for 250 ms: a 56 mm Menu button appears 0.06 m above the palm and stays put; poke it with the other index | rail Menu | thumbstick click on the non-dominant controller | rail Menu | 1-hand: rail Menu. Palm pinch is the system's and is never used |
| undo | rail Undo (poke) | rail Undo (ray) | A or X, either controller | same | redo: rail Redo only |

Delete is not its own gesture: put a part back on any shelf bin (it leaves the project), or use Remove in its chip.
Releasing a part in the air away from the bench never deletes it.

### 3.3 Controller map

| Control | Bench | Range (section 8) |
|---|---|---|
| Trigger | select, press, start and end a wire, hold a component button; held on the ray, far grab | select on UI only |
| Grip | near grab and hold; both grips on empty space scale | grab the craft while disarmed |
| Thumbstick x while holding | flick: rotate the held part 90 degrees | flight sticks |
| Thumbstick, not holding | D side y flick: one scale step | flight sticks |
| Thumbstick click, non-dominant | Menu | Menu |
| A, X (lower face) | Undo | A arm and disarm, X replay the last crash |
| B, Y (upper face) | Cancel or back | B reset to the pad, Y next view |
| Menu button, Meta button | not used: assumed not exposed to WebXR or reserved by the system [device?] | same |

Face buttons are the only contextual controls; the first time a mode is entered, tooltips name them on the controller
for 6 s.

### 3.4 Precision at 2.54 mm

The hard problem: hand-tracking jitter is several millimetres and a breadboard pitch is 2.54. The answer is scale,
cells, preview and hysteresis, never a loupe (a second camera pass costs too much and puts detail too close).

1. **Work scale.** Everything on the mat is drawn at `s` = 3 by default: pitch 7.62 mm, half breadboard 0.25 x 0.17 m,
   Uno R3 0.21 x 0.16 m. At 3x the start project (a Uno beside a half breadboard) fits the seated work zone with 0.08
   m to spare; at 4x the pair needs 0.60 m of its 0.54. `DEFAULT_XR_SETTINGS.benchScale` is 3.
   Steps: 1x (true size), 2x, 3x, 4x, 6x, then Room size (8.1). Building works at every step; below 3x with hands, a
   ghost changing target more than 3 times a second makes the ticker suggest scaling up. Bins always show parts at
   3x; a part taken off the shelf takes the bench's `s` over 150 ms as it enters the mat.
2. **Cells, not meshes.** A pin or hole is targeted through its cell: the area of the board's top plane nearer to it
   than to any other anchor (Voronoi), up to 0.75 pitch away, and from 0 to 0.015 m (work) above the mouth. There is
   always exactly one targeted cell, shown by its ring before anything commits [custom].
3. **When the ghost appears.** While a part is held, its leg tips are projected along the board's normal. When the
   lowest tip is within 0.025 m (work) of the top face and the anchor leg (the first non-mechanical pin, as in the 2D
   `seatOnSurface`) projects inside the grid plus the snap reach, the ghost shows the seat.
4. **Snap reach and priority.** As the 2D Studio: the nearest fit within 1.5 pitches of the anchor leg, or within 4
   pitches for a chip that has to straddle the centre channel. A fit is valid when every leg lands on a free hole and
   no two legs of the part share a strip (unless the part is meant to). Ties go to (a) the current fit, then (b) a
   board's header socket over a breadboard hole. The ghost moves to a new fit only when that fit is nearer by 0.35
   pitch (hysteresis) [custom].
5. **Ghost.** A copy of the part in the seat, ink outline at full strength and bands at 45 % opacity, with a ring on
   every target hole: accent dot = free; bad-coloured cross = taken (with the hole's name); warn triangle across a
   strip = two legs on one strip ("same row"). A dashed ink tether joins the held part to its ghost. The ghost jumps
   from fit to fit with no tween. The held part stays in the hand, 1:1.
6. **Steadying.** While a ghost is shown, the hand's pinch pose passes through a one-euro filter (start: min cutoff
   1.5 Hz, beta 0.01) before the projection; off otherwise, so carrying stays direct [custom].
7. **Seating, leg by leg.** v1 seats every part rigidly by its footprint, all legs together, exactly the rule of the
   2D `seatOnSurface` (one code path for both apps). Legs are checked in pin order and the first failing leg is the one
   marked. On release the legs sink 1 mm (life) one after another, 20 ms apart, as a visual only; the document gets
   one batch. Two-lead parts with bendable leads (resistor, diode, film cap) stretching to a span of their own is v2:
   it needs a `contract-change` if the project rules refuse a span the footprint does not have.
8. **Invalid placement.** Release with no valid ghost over a board: the part slides in 200 ms to the nearest free spot
   on the mat beside it, lies loose (a valid state with a "not connected" tag) and the ghost's reason shows for 1.5 s
   ("a10 is taken"). Released off the mat: back to where it came from (its seat, its mat spot or its bin) in 300 ms.
   A part never floats, falls to the floor or ends inside another part.
9. **Boards** do not seat; they lie on the mat and yaw in 15 degree steps. Modules with male headers seat like parts.

### 3.5 Pointer states and tracking loss

States: `idle`, `hover`, `press` (UI or component held), `hold` (part in hand, no ghost), `place` (ghost shown),
`wire` (pending wire end), `probe`, `turn` (knob), `scale`, `explode`, `move-bench`, `move-panel`. Each pointer is in
one state; `scale`, `explode` and two-handed `move-bench` own both. Hands lose pinches when tracking drops;
controllers keep reporting. Rules [custom]:

| State | On loss | After |
|---|---|---|
| `hold`, `place` | the part freezes where it was | 500 ms without tracking: back to its last valid spot in 300 ms, never seated |
| `wire` | the pending end stays | 1000 ms: the pending wire is dropped |
| `press` | released | |
| `turn`, `scale` | stay where they are; scale snaps to the nearest step | |
| flight sticks | centre (the craft holds altitude) | |

## 4. Feedback

Hands have no haptics. For hands every committed event plays its sound and a **pop ring** at the contact point: an
ink ring growing from 12 to 24 mm while fading out over 180 ms [custom]. With sound off, the pop ring and the ticker
carry it. Under reduced motion the ring keeps one size and fades within 150 ms. Haptics go through `app.input.pulse(hand, intensity, ms)` (one buzz; a two-part pattern is two calls)
[device?]. Sounds are short, positional at the event [SDK `AudioSource`], and each event has its own. Rings, glows,
badges and labels on board targets go through `app.overlay` with the pillar as owner (`glow`, `pin`, `label`).

| Event | Visual | Audio | Controller haptic | Timing |
|---|---|---|---|---|
| hover, grabbable | silhouette outline 1.6x wider and accent | none | 0.08 for 8 ms on enter | on within one frame, off over 80 ms |
| hover, UI | plate lifts 3 dmm, edge turns accent | none | 0.08 for 8 ms | same |
| hover, cell | ink ring 1 pitch across, 2 dmm stroke, pin name at 18 dmm | none | none | same |
| snap (ghost finds or changes a fit) | ghost and rings appear | soft tick, at most 12 a second | 0.25 for 12 ms | accent ring grows and fades out over 120 ms |
| seat | part travels to the seat (ease out), legs sink, outline flashes accent | click | 0.6 for 30 ms, then 0.3 for 15 ms at +50 ms | travel 90 ms, flash 150 ms |
| pull out | legs rise 1 mm | pluck | 0.4 for 20 ms | 80 ms |
| wire connected | end snaps; every hole and pin of the net gets an accent ring; end label "D13 to row 10" | plug | 0.5 for 25 ms | snap 60 ms, net glow 400 ms, label 1.5 s |
| short | the net's wires and pins turn `bad`, a lightning badge sits at the net's middle, the run pauses if the model says so; the finding is pinned | zap, once | 0.9 for 120 ms, once | stays until fixed; nothing flashes |
| part warm | temperature chip "72 °C" | none | none | while warm |
| part hot | bands tint 50 % towards `warn`, three wavy heat lines rise above it in a 1.2 s loop, chip | sizzle loop at 20 % while hot | 0.15 for 10 ms every 500 ms while held or probed | while hot |
| part burnt | bands turn char `#2b2620` (outline stays), three flat smoke puffs rise 0.06 m and fade, then a small static wisp; finding pinned ("R1 burnt: 180 mA through a 0.25 W resistor") | pop | 0.8 for 150 ms | smoke 1500 ms, once |
| check passed | tick in the check row; a tick badge on the part or pin it concerns | two rising notes | 0.4 for 25 ms, then 0.6 for 35 ms at +100 ms | badge 2 s, sound 350 ms |
| check failed | cross in the row; finding pinned at the part or pin | two falling notes | 0.5 for 60 ms | finding stays until the next run |
| run start | Run turns into Pause; a dashed accent ring around each running board crawls at 20 mm/s; the clock starts | start | 0.3 for 20 ms | 150 ms sound |
| run pause or stop | the ring turns ink and stops (paused) or goes (stopped); the clock freezes | stop | 0.3 for 20 ms | 150 ms |
| undo, redo | the changed thing flashes accent; ticker "Undid: place R1" | reverse whoosh | 0.3 for 15 ms | 200 ms |
| invalid release | reason note at the ghost; part slides to the mat | low thud | 0.5 for 40 ms | note 1.5 s |
| UI press | plate sinks 3 dmm, fill accent | tap | 0.35 for 12 ms | 60 ms |

Grabbing and UI selection sound different, so the two kinds of target are learnt by ear as well (Meta's guidance).
Frequent events (hover, snap) are the quietest; rare ones (short, burnt) the strongest.

## 5. Wiring

- **Start:** pinch or trigger on a pin or hole cell (3.2). A pending wire runs from that anchor to the pinch point, or
  to the ray's hit on the board plane. Breadboard tops are all cells, so a breadboard is moved by its edge band (hands)
  or the grip (controllers); hovering the edge band shows a move icon.
- **End:** release over a targeted cell. A wire exists only with both ends on anchors. The end lands on the cell that
  was ringed, never the nearest one at the instant of release.
- **Colour:** as the 2D Studio (`wireRecipe`): a net with a ground pin is black, with a supply pin red, otherwise the
  next of blue, green, yellow, orange, purple, brown. Select a wire to recolour it: its chip shows the ten project
  colours (two rows of five, 48 dmm each, each with its name), Straighten and Remove.
- **Route:** a wire is a smooth curve. Hovering a wire shows a bead at its middle; pulling a bead or any point of the
  wire adds a bend (at most four, stored as the wire's `route_mm` waypoints). Drag a bend back within 5 mm (life) of
  the straight line to remove it, or use Straighten.
- **Edit and remove:** grab an end bead and drop it on another cell to move that end. Drop it off any cell and the
  wire comes out, like pulling a jumper; one undo puts it back.
- **How wires hang:** jumpers rise along each end's anchor normal and arch over: rise `clamp(0.3 x span, 3, 18)` mm
  (life), apex 2 mm above that. Wires between two items (board to breadboard) use `clamp(0.25 x span, 6, 30)` mm. An
  arch that would cut through a part goes over its top plus 2 mm [custom]. Wires are 1.4 mm (life) tubes with ink
  outlines and a 2.5 x 6 mm (life) black Dupont tip at each end; all wires share one merged geometry with vertex
  colours [custom].
- **Crowded boards:** a wire whose plan path crosses an earlier one rises 2 mm (life) above it, so crossings never
  touch. Hovering a wire or pin dims every other wire to 30 % and rings every member of its net [custom shader flag].
  End labels show on hover and selection only; above 40 wires, so do end beads. "Lift wires" (Menu, then View)
  arches every wire up 12 mm (life) to show the parts beneath.

## 6. Run, tools and faults

### 6.1 Run cluster and states

The rail centre, left to right: **Reset**, **Step**, **Run/Pause** (primary, accent, 60 mm), **Speed**. Above it, the
clock in mono at 22 dmm: `t 12.34 s  x1/4`. Each has its label under the icon at 18 dmm.

| State | `SimBridge.state` | Run button | Enters by |
|---|---|---|---|
| `stopped` | `unloaded`, `idle`, `done` | Run | Reset, or start |
| `compiling` | (while `load` runs) | ring filling, "Compiling" | Run from `stopped` (at least 600 ms, as the lesson runner) |
| `uploading` | (after `load`) | ring filling, "Uploading" | after compiling (600 ms) |
| `running` | `running` | Pause | after uploading, or Run from `paused` |
| `paused` | `paused` | Run | Pause; Step; leaving the session's focus |
| `faulted` | `halted`, `limit`, `error` | Run, with the reason badge | the model halts (a short it stops on, a brownout loop), a limit, a refused load |

- **Away:** when the system shows an overlay (`visible-blurred`), a running sim goes to `paused` with the reason
  `away` and sound mutes. It stays paused until the person presses Run.
- **Edits while running:** wiring and part changes apply live (the solver re-solves). A code change needs a new run:
  the Run button gets a "Restart to apply" badge.
- **Speed:** 1/10, 1/4, 1/2, 1, 2. Everything on the bench shows sim time, so at 1/10 a servo turns at a tenth of its
  speed. **Step:** 10 ms of sim time (`step(10)`; a step by statement is [contract]); in flight one 0.01 s physics step.

### 6.2 World inputs as gestures

Inputs are measured in room units, whatever the work scale: your hand is a person-sized thing in the sensor's world.
Every input also has a slider in the part's chip (the 1-hand and seated path). Inputs go to `app.sim.input` as
`WorldInput`s (`lux`, `distance` in m, `temp_c`).

| Input | Gesture |
|---|---|
| light (`environment.light`; LDR, photodiode) | hold a flat hand over the sensor: ambient at 0.25 m, falling to 2 % at 0.02 m; or point the torch from the tools rack at it to raise it |
| temperature (`environment.temperature`; thermistor, DHT) | pinch and hold the sensor: it warms 0.5 °C a second up to 34 °C; let go and it cools back 0.2 °C a second |
| distance (`environment.distance`; ultrasonic, IR) | put a hand in front of the sensor: the reading is the hand's distance along the sensor axis |
| tilt, acceleration | pick up the board or module and tilt it |
| magnetic (hall) | bring the magnet from the tools rack within 0.10 m |
| sound (mic module) | poke the mat within 0.15 m of it: one 100 ms impulse |
| buttons, switches, pots | as section 3.2 |
| humidity, pressure | chip slider only |

### 6.3 Tools

Tools keep one size and do not follow the work scale. States: `racked`, `held`, `parked` (lying on the mat, turned
to face you in 200 ms), `clipped` (a probe left on an anchor).

- **Multimeter:** body 0.12 x 0.20 m. Dial: Off, V DC, mA, ohm, continuity; pinch and twist, or poke a position label
  (40 mm hit). Display: four mono digits at 44 dmm with the unit, updated at 4 Hz from `src/sim/probe/meter.ts`.
  Probes are red and black pens 0.12 m long on leads curving to the meter (0.9 m; further pulls the meter along). A
  tip within 0.01 m snaps to the nearest cell within 1 pitch (work) and names it; releasing there clips it on. The
  reading also floats in a chip 0.03 m above the red tip, so your eyes stay on the work; continuity beeps from the
  meter. One hand: release the black probe anywhere on the mat and it clips to the nearest ground (ghost first).
- **Scope:** a yellow probe (and a cyan second channel) clips on like a meter probe. Its screen is a panel behind the
  board (section 9) with the trace from `src/sim/probe/capture.ts`, redrawn at most 30 times a second; time per
  division and volts per division have minus and plus buttons; Single freezes one sweep.
- **Serial:** the panel opens by itself on the first serial output, beside the code panel, and a thin ink leader runs
  from it to the board's USB port when there is more than one board. Mono 20 dmm, 14 lines, follows the newest line
  until scrolled (index swipe near, pinch drag far). Sending: the lesson's preset lines as buttons; free text through
  the paired editor (7.2) [custom].

### 6.4 Readouts and findings at the part

- **Readout chip:** a paper plate with an ink outline, one or two mono lines (`2.03 V  14.6 mA`, `135°`,
  `3200 rpm`, `dist 23.4 cm`: the part state kinds of [PART_STATE.md](PART_STATE.md)). It sits 0.015 m out from the
  part's `label:` anchor, turns to face you (yaw, and pitch within 30 degrees) and keeps its angular size from 0.4 to
  2.0 m. During a run it shows for the hovered or selected part, the parts the lesson names, and parts in a warn or bad
  state: at most 6 at once; Menu, then View, then All readouts raises that to 16.
- **Finding:** a 30 dmm badge with the state icon at the offending part or pin. Selecting it opens a card (300 dmm
  wide, title 22 dmm, body 20 dmm, at most four lines) with a 1.5 dmm leader to the exact pin, and Why and Fix. Fix
  shows the change as a ghost first, then applies the rule's plan in one batch ([DIAGNOSIS.md](DIAGNOSIS.md)). At most
  two cards open; opening a third closes the oldest. Every finding is also a row in the guide's Problems tab with
  Show.

### 6.5 Fault lab

- **Enter** from a lesson's Break it, or Menu, then Fault lab. The tools rack holds the fault deck: one card
  (0.07 x 0.10 m, icon and name) per failure mode of the item (brownout, cold joint, reversed LED, wrong resistor).
- **Inject:** grab a card and drop it on the part it breaks (or on the board for board-wide faults); valid targets
  ring while a card is held. 1-hand: select a card, then Apply. The card stays on the part as a tag.
- **Modes:** `explained`: the tag shows and a finding says what changes and what to measure. `mystery`: the fault is
  hidden; the person measures, then names it from three choices; the answer pins the explanation at the part.
- **Heat stages** (names fixed, thresholds per part model; these are the defaults): `normal` under 60 °C, `warm` 60 to
  90 (chip), `hot` 90 to 150 (tint, heat lines, sizzle), `burning` over 150 for 0.5 s of sim time (smoke starts),
  `burnt` (dead for the rest of the run). Section 4 has the looks.
- **Repair:** Replace on the burnt part's card puts a fresh one in the same holes (one undo); Reset clears the faults
  and keeps the circuit (`fault/clear`).

## 7. Learning guide

### 7.1 Steps and highlights

The guide panel (section 9) has a header (lesson title 30 dmm, step dots "3 of 7"), the step text (22 dmm, at most
six lines), an optional figure, and Back, Show me and Next (Next primary). Tabs: Steps, Code, Checks, Problems.

- On entering a step its target is highlighted on the bench: for a build step, the target ghost (accent dashed
  outline) in its holes and the part's bin pulsing (accent outline, 1.2 s period, three times, then steady); for a
  wire step, accent rings with names on both anchors and a dashed accent arc between them; for a test step, a ring
  around the part to watch. Show me repeats it. Targets come from `GuideStep.highlights`, drawn by owner `guide`.
- A target outside the view gets an arrow on the guide's nearest border and one positional ping from the target.
- Steps advance on bench state (the lesson's `done` conditions): a tick for 400 ms, then the next step, never sooner
  than 800 ms after the last change. Targets are suggestions: a part that works somewhere else is accepted and later
  targets follow where it actually is [custom].

### 7.2 Code

- **Viewing:** mono at 20 dmm, about 18 lines, coloured like the 2D `CodeBlock`, the current line marked while
  stepping. Scroll by index swipe (near) or pinch drag (far); no scroll bars.
- **Editing in the headset (realistic):** the lesson's parameter slots (`{{p:...}}`) are inline accent chips; select
  one for its picker (choices, or a stepper with sensible steps such as 100, 250, 500, 1000, 2000 ms). Lines can be
  switched on and off (commented). No free typing in the code panel in v1. A virtual keyboard [custom] is only for
  short text (a serial line, a project name); the system keyboard is assumed unavailable inside a session
  [device?]. If a Bluetooth keyboard's keys reach the page during a session [device?], the code panel takes typing.
- **Paired editor:** Code tab, then "Edit on another screen" shows a short address and a six-character code. A
  desktop or phone opens the 2D app's editor on the same project; edits arrive in the headset live and show "Restart
  to apply" [custom; uses the collaboration server, which is optional, so the button hides when no server is set].

### 7.3 Checks and progress

- The Checks tab lists the lesson's checks: `idle` (empty circle; `pass` null), `running` (ring of dots, static under
  reduced motion), `passed` (tick in a `good` circle), `failed` (cross in a `bad` circle), each with its label. A
  failed row has Show, which pins the finding at the part.
- A lesson is done when its checks pass with no fault, as in the 2D app (`LessonGuideState.done`, stored by
  `app.progress` under the 2D keys); the header dots fill and Home shows "4 of 9 lessons" per board.

## 8. Scale and insight, and Range

### 8.1 Scale

- **Steps** on the bench: 1x, 2x, 3x (default), 4x, 6x, about the bench top centre (`BenchSpace.setScale`).
  The two-handed gesture follows the hands' spread 1:1 and snaps to a step within 10 % on release. It stops at 6x with
  a tick, and the Room size button lights; Room size is a button, never the end of a gesture.
- **Room size:** the item's largest horizontal side becomes 3.0 m, or 0.8 x the shorter side of the guardian bounds
  (`bounded-floor`) if smaller, and never under 1.5 m. It works in passthrough (you see your furniture) and in the
  paper room.
- **Into Room size:** bench, shelf, tools and panels fade out (250 ms); the bench-size item fades out while the
  room-size item fades in (400 ms) on the floor, nearest edge 1.0 m in front of you, centred on your view. Nothing
  grows towards you. **Back to bench** sits on a small panel 1.2 m away, 30 degrees below eye level, that follows when
  you turn more than 40 degrees [SDK `Follower`].
- **At Room size:** walk around it. Teleport is off by default; if switched on: thumbstick forward (C) or a 400 ms
  pinch hold with the ray on the floor (H), a target ring, then a 100 ms fade out, the move, a 100 ms fade in
  [custom]. No smooth movement, no turning by stick.
- **See-through:** a slider from 0 to 1 (`cover` fades to 0.28, `xray` fades in, as the asset contract).
- **Current flow:** dots on wires and traces, one instanced draw call: spacing 0.04 m at Room size (4 mm x `s` on the
  bench), speed `0.05 + 0.25 x log10(1 + I / 1 mA)` m/s capped at 0.6, conventional direction, with a chip saying
  "conventional current". Under reduced motion: static arrowheads every 0.15 m. Node voltages are labels, not only
  colours.

### 8.2 Comfort limits for scale and range

- The viewpoint moves only by the person's body, or by a teleport they asked for, behind a fade.
- No scale animates while the person is inside the item's bounds or its growth path; Room size enters by fade only.
- World up never changes: no roll, room-size items stand level on the floor, the paper room's horizon is level.
- Vignette only for continuous camera motion, which v1 has none of; if added, it narrows the view 30 % above 0.5 m/s.
- Geometry within 0.35 m of the eyes fades to 30 % [custom], so a walk through a room-size board never puts a
  capacitor in your eye.

### 8.3 Range: drones and robots

- The course is fitted into the room at one uniform scale, not 1:1 (courses are 9 to 300 m fields): the flight volume
  is a 3 x 3 m square in front of where you stood at entry, inside the guardian bounds inset 0.3 m, from 0.1 to 2.2 m
  high, and k = min(1, side / field, height / ceiling). quad5's 40 m field flies at about 1:13 (k 0.075). The craft is
  drawn at the same scale, but never under 8 cm across; physics stays in course metres. A net (ink grid every 0.5 m at 10 %) shows on a face of that volume only while the craft is within 0.5 m of it;
  touching it is a crash. The pad is on the floor 1.5 m ahead of where you stood at entry.
- **Views:** `los` (line of sight, default), `chase` and `fpv`. Chase and FPV are a screen (0.48 x 0.27 m at 1.2 m,
  world-locked, rendered at 15 Hz [custom]), never your eyes. Y (C) or the view button cycles them.
- **Controllers, mode 2:** left y = climb rate (centre holds altitude: the climb mode of `readSticks`, since Quest
  sticks spring back), left x = yaw, right y = pitch, right x = roll. A arms and disarms (arming only with sticks
  centred and the craft level), Y resets to the pad, X replays the last crash. Mode 1 in settings. Rates come from
  the craft.
- **Hands, virtual sticks** (`app.input.stick`; the ring is [custom]): pinch in the air in front of the chest, off
  any target: an ink gimbal ring appears at the pinch point and the hand's offset from it is the stick: 60 mm is full
  and the first 15 % (9 mm) is dead. Left hand: up
  and down climb, left and right yaw. Right hand: away and back pitch, left and right roll. Letting go centres the
  stick, so a lost hand means a hover. Arm with a 64 dmm Arm button on a small plate 0.45 m ahead at chest height,
  held 600 ms (a ring fills) so it cannot be hit by accident.
- **One hand, Guide flight** [custom]: the craft holds position and follows an ink target ring you pinch and drag, at
  most 1.5 m/s.
- **Crash:** the sim freezes at impact for 300 ms (craft in place, an ink impact ring 0.3 m across), then a card 0.4 m
  above the crash: "Crashed: hit the net at 3.1 m/s" with Replay, Reset and Why.
- **Replay:** re-simulated from 2 s before to 1 s after the crash, played in place at 1/3 speed, with a dotted ink
  trail. A 0.40 m timeline under the card has a playhead (pinch drag to scrub), Play and Pause, and marks for events
  (stick spikes, motors saturated, battery sag) with labels. The camera does not move.
- **Robots on the floor:** at 1:1 on the real floor, starting 1.0 m ahead, inside the guardian inset 0.3 m.
  Controllers: left stick arcade drive (y speed, x turn), A stop, Y reset. Hands: one virtual stick on the dominant
  hand, same numbers. A dashed ink trail shows the last 5 s of path. Obstacles are virtual, placed by the lesson.

## 9. Spatial UI kit

### 9.1 Panels

| Panel | Size | Distance | Placement |
|---|---|---|---|
| Guide | 0.52 x 0.40 m | 1.10 m | panel ring `guide`: 10 degrees below eye level, 31 degrees away from D |
| Code | 0.54 m wide | 0.90 m | panel ring `code`: 10 degrees below, 30 degrees towards D |
| Serial | 0.52 m wide | 1.10 m | panel ring `serial`: 12 degrees below, 62 degrees towards D |
| Scope screen | 0.42 m wide | 0.95 m | panel ring `scope`: behind the board, 20 degrees below |
| Fault panel, Look inside, lab panel | 0.62 / 0.25 / 0.63 m wide | 1.10 m | panel ring `side`: 12 degrees below, 58 degrees away from D |
| Getting started (first run) | 0.49 x 0.31 m | 0.95 m | panel ring `scope`, 22 degrees below: beyond the board, under the horizon; hidden outside the bench |
| Home, catalogue | 0.80 x 0.50 m, curved (radius = distance) | 1.30 m | 8 degrees below, straight ahead |
| Menu, summoned by palm | 0.30 x 0.36 m | 0.45 m (touch) | where summoned, world-locked |
| Menu, from rail or controller | sizes in dmm, as below | 1.00 m (ray) | straight ahead, 10 degrees below |
| Chips, finding cards, crash card | fit content, 300 to 360 dmm wide | at their anchor | facing you |

- **Anatomy:** an opaque paper plate (`paper`), ink outline 2.5 dmm, corners 12 dmm, padding 16 dmm, and a flat
  shadow plate in `shadow` offset 6 dmm right, 6 dmm down and 5 mm behind. No translucency: it keeps text legible over
  any room and needs no sorting. A 40 dmm title bar is the move handle (three ink dots); Close is a 48 dmm hit at top
  right.
- **Moving** (owner, 2026-11-14): every floating panel has a grip bar under its lower edge (an inked paper pill with
  the three dots, `xr/src/ui/panels`; over the upper edge for a panel standing on the bench). Pinch it (near or along
  the hand ray), or trigger or grip on it with a controller, and drag; the title bar moves the panel too where it has
  one. The panel follows the hand, keeps turned towards your head in yaw and pitch, never rolled, stays 0.3 to 2.0 m
  from the eyes and never goes under the bench top. It stays where it is let go, relative to the bench (so Recentre
  takes it along), for the session and after a reload; reopening it puts it back there. Menu, Tidy up puts every
  panel back in its default place. The Home, Recentre and Exit cluster is fixed in the room (owner, 2026-11-14): put
  once when the session starts on the person's left, 48 degrees off the heading (owner, 2026-11-15), 0.85 m from the
  eyes and 3 degrees above eye level, just over the companion, facing them; it never follows the head. It has the same grip bar and Tidy up, and Recentre brings
  it back to that place beside the person. The bench itself
  has the same grip bar standing on the centre of the table's far edge, beyond the mat, where a ray from either hand
  reaches it (`xr/src/bench/pose`; on the front edge it was level with the hands and could not be taken, #363): drag it and the whole bench, with
  everything on it, follows in all three directions, level and keeping its turn, never under 0.1 m above the floor.
  Parts, pins and wires win over it. Its place is kept after a reload; Recentre and Tidy up put it back.
- **Budget:** at most six panels visible; opening a seventh closes the oldest that is not the guide. No head-locked UI.

### 9.2 Type

| Role | Font size | Weight |
|---|---|---|
| Display (meter digits, clock) | 44 dmm | 600, mono |
| Title | 30 dmm | 600 |
| Body | 22 dmm | 400 |
| Label (buttons, chips) | 20 dmm | 500 |
| Code, serial | 20 dmm | 400, mono |
| Caption (pin names, tags, rail labels) | 18 dmm, the minimum | 500 |

- Latin in Geist and Geist Mono as in the 2D app, self-hosted (the CSP allows fonts from `'self'` only). Devanagari
  and Chinese from the browser's own fonts (XR_ARCHITECTURE.md section 7); if Quest Browser lacks them [device?],
  self-hosted Noto Sans Devanagari and a Noto Sans SC subset of the headset's strings. No italics, no weight under 400.
- Devanagari and Chinese set at 1.15x the Latin size for the same role. Line height: 1.35 Latin, 1.45 Chinese, 1.55
  Devanagari. The text size setting (100, 125 or 150 %) applies to every role.
- **Rendering:** all text is drawn with Canvas 2D into textures (`xr/src/ui`, as the architecture sets), because the
  browser shapes Devanagari; the SDK's UIKit MSDF text is Latin only and is not used. Two texels per dmm, mipmaps on.
  A texture is redrawn only when its content changes; live values (clock, meter, scope) live in small textures of
  their own, redrawn at most 10 times a second (scope 30). Chips share one atlas. An `XRQuadLayer` [SDK] for the code
  panel is a later option for sharper text.

### 9.3 Colour and materials

| Token | Bright room | Dim room | Use |
|---|---|---|---|
| `paper` | `#f2efe7` | `#e4ddcf` | panels, chips |
| `ink` | `#231e16` | same | all text that must be read, outlines |
| `muted` | `#857d6e` | `#6a6357` | units and decoration only (3.5:1 on paper) |
| `rule` | `#ddd6c8` | `#cbc2b1` | dividers |
| `shadow` | `#41538f` | same | flat shadows |
| `accent` | `#e4694e` | same | hover, targets, primary fill; never as text colour |
| `good`, `bad`, `warn`, `info` | `#1f6b4a`, `#a8402b`, `#7a5a00`, `#1d4fd8` | same | states (5.3 to 5.7:1 on paper) |

- Ink on paper is 14:1; ink on an accent fill is 5:1, so primary buttons are accent with ink labels.
- The overlay's and the guide's `Tone`: `do` is `accent`, `pass` is `good`, `fail` is `bad`, `warn` and `info` as named.
- Parts use the ink material of the asset contract; UI is flat unlit colour. No PBR, no environment maps.
  Transparency only for ghosts, fades, the ray and smoke.
- **The bench in the figures' look** (`xr/src/look/bench.ts`, `mat.ts`, `wires.ts`), all in the ink material:
  - the work mat is the bench figures' cutting mat: bands `#dfe3d2`, `#c6cbb6`, `#9da38c`, 4 mm thick, 18 mm corners,
    the heavy ink silhouette, a `#a9b096` grid at the figures' 10 mm times the default work scale (40 mm), and ruler ticks
    every 10 mm along the back and left edges, numbered every 100 mm;
  - the front rail is a mustard wedge (bands `#f4b829`, `#d49c1f`, `#4e4a18`) under the run cluster, outlined, casting
    its flat shadow on the mat;
  - jumper wires are round, banded in their colour, outlined (2.2 ink units) and cast a flat shadow on the mat;
  - a lit LED's halo (the pipeline's `createGlow`) is drawn 1.8 times the figure's size, so it reads at arm's length;
  - callout labels stand at least 0.06 m above what they name, so they never cover it or a halo, and overlapping labels
    climb as seen from about 38 degrees above;
  - motion: when the bench arrives, items drop 0.05 m in turn (surface, boards, parts; 70 ms apart), squash 6 % and
    settle, then the wires draw themselves on (400 ms each); a part added later drops in, a moved one eases there
    in 300 ms, a removed one lifts and shrinks away in 200 ms. Reduced motion jumps.
- **Rooms:** Menu, then Settings, then "Room light: bright or dim". Dim lowers `paper` and `rule` as the 2D figures do
  on a dark page; ink stays. The 2D dark theme starts XR in dim. There is no camera access, so no automatic switch.
- **States** always pair colour with an icon and a word: passed tick, failed cross, warning triangle, hot flame,
  burnt smoke, short lightning, info circle.

### 9.4 Icons and labels

Phosphor regular, as the 2D app, at 24, 32 or 48 dmm, rasterised into the canvas textures. Every icon has a visible
label (on the rail, under it at 18 dmm); Close (an x) is the only bare icon, with a tooltip after 400 ms of hover.
Labels are sentence case with no exclamation marks, as `docs/UI.md`.

### 9.5 Six languages

- Every string comes from the i18n messages in all six languages in the same PR (a new namespace for the headset).
- English is laid out to fill at most 70 % of its slot; de, es and fr run about 30 % longer.
- Fitting order: wrap where the slot allows lines; else shrink by up to 15 % (never under 18 dmm); else cut with an
  ellipsis and show the whole text on hover. Buttons never wrap. Chips grow to 360 dmm, then wrap.
- Numbers and units are formatted as the 2D app formats them; unit symbols (V, mA, ohm sign, °C) stay.
- Changing language redraws every text texture in place. A page reload ends the XR session (device recipe), so the
  language never changes by navigation.

### 9.6 Home, menu and settings

- **Home** (the curved panel): Continue (the last lesson or project, primary), then Boards, Robotics, Drones and
  Studio tiles with progress, then Settings and the language. Opening a lab fades Home out (200 ms) as the bench fills.
- **Menu**: Home; Bench (Bring the bench here, height, standing or seated); View (Passthrough or Paper room,
  See-through, All readouts, Lift wires); Fault lab; Help (plays the input coach again); Settings; Leave headset mode
  (ends the session; the page offers Start again).
- **Settings**: language, dominant hand, standing or seated, room light, text size, high contrast, reduced motion,
  sound volumes and mono, toggle grab, flight mode 1 or 2, teleport at Room size. Each applies at once, in the session.
  All but language, hand and posture are new `XrSettings` fields [contract]; the 2D `sound` and `reduceMotion` are
  read only, so they are only starting values for the headset's own.

## 10. Onboarding: the first three minutes

From pressing Start on the page to an LED the person wired blinking. t = 0 at Start.

| Time | What happens |
|---|---|
| before | The headset page has one primary button, Start, at least 48 px, and a language picker. Start asks for `immersive-ar` with hand tracking. A Meta consent dialog may appear on a device's first entry; the bench waits for it. |
| 0:00 to 0:05 | Passthrough. The bench fades in (400 ms). The Uno sits at the left of the work zone, its USB cable over the bench edge; a half breadboard on the right. The shelf has two bins: a red LED and a 220 ohm resistor. The posture chip reads "Standing, change". |
| 0:05 to 0:15 | The guide: "Build a blinking light. Use your hands or your controllers." Coach for the input in use: hands get an ink ghost hand above the LED bin doing pinch and lift on a 1.5 s loop ("Pinch the LED to pick it up"); controllers get tooltips (grip "Grab", trigger "Wire and select"). Switching input switches the coach. |
| 0:15 to 0:45 | Step 1: the LED. Target ghost in its holes with the long leg marked "+". The person's ghost snaps; matching turns the target into a tick; seat clicks. Reversed: the guide says "Turn it round: the long leg goes to row 10" before it moves on. |
| 0:45 to 1:15 | Step 2: the resistor, from the LED's short-leg row to the ground rail (holes from the lesson's layout). |
| 1:15 to 2:05 | Steps 3 and 4: two wires, D13 to the long-leg row, GND to the ground rail. First wire coach: "Pinch the D13 socket, then let go on row 10", with a dashed arc. |
| 2:05 to 2:30 | Step 5: Run pulses (accent ring, 1.2 s, three times). Press: compiling, uploading, running. The LED blinks at 1 Hz; the `pin-toggles` check on D13 passes: chime, tick, "It blinks. You wired that." |
| 2:30 to 3:00 | Three cards: Make it blink faster (a parameter chip), Break it (fault lab), Look inside (scale up, see-through). Skip intro on the header goes straight to Home. |

No progress for 20 s: the coach plays again. 45 s: Show me (a ghost hand does exactly this step) and Do it for me
(does it; onboarding completes, the lesson does not count). A mistake gets the finding that names it ("The wire is
on row 11; the LED's long leg is in row 10") with Fix.

## 11. Guard rails

### 11.1 Comfort

- 90 Hz: `updateTargetFrameRate(90)` after the session starts (Quest Browser starts at 72). Drop to 72 Hz when the
  95th percentile frame time stays over 10.5 ms for 5 s [custom].
- Nothing moves the viewpoint but the person; no shake, no roll, no head-locked content. Nothing is viewed for long
  closer than 0.5 m; touch UI sits at 0.42 to 0.48 m.
- No element larger than 5 degrees flashes faster than 3 Hz (a burnt part, a short and a brownout never strobe).
- After 30 minutes in the session, a quiet chip on the rail suggests a break; it never pauses a run.

### 11.2 Access

- **Seated:** the whole app works seated: Z1 and Z2 in reach; Room size and floor robots are optional modes.
- **One hand:** every verb has a 1-hand path (3.2); nothing needs two hands.
- **Left hand:** "Dominant hand" in settings mirrors shelf, tools, panels, palm menu and rail ends. Default right;
  after five grabs, if four were left-handed, the ticker offers to switch [custom].
- **Reduced motion** (starts from the 2D `reduceMotion`): fades of at most 150 ms replace moves; seats jump into
  place with their click; crawling run rings, flowing current, heat lines, smoke and pulses become static marks.
- **Colour is never the only signal** (9.3); wires say their colour's name on hover.
- **Sustained input:** a toggle grab option (pinch or grip once to take, again to let go) [custom]; component buttons
  can latch (3.2).
- **Sound:** four volumes (interface, bench, simulation, alerts), a mono option, and a visual for every sound.
  Sound is on by default in the headset (unlike the 2D app), because it is the hands' confirmation channel.
- **Text:** size setting (9.2) and a high-contrast option (outlines 1.5x, `muted` becomes `ink`).

### 11.3 Performance (Quest 3S)

- 11.1 ms a frame at 90 Hz. The simulation runs in its worker; render-thread work (targeting, layout, part views,
  text) at most 3 ms a frame.
- Draw calls (`renderer.info.render.calls`) under 100 with a full bench in view (XR_ARCHITECTURE.md section 7); at
  most 350,000 triangles. Per-item budgets are XR_ASSETS.md section 8; the outline and shadow passes count.
- No post-processing, no shadow maps, no lights beyond the ink look's fixed light; at most one ghost at a time.
  Wires, current dots and rings are merged or instanced; chips share one atlas. Textures at most 2048 square, 64 MB
  in all. Multiview and fixed foveation at medium when Quest Browser offers them [device?].
- The mat shows at once and parts appear as they load; a bench is ready within 3 s of Start on a warm cache, and no
  spinner blocks the view for more than 1 s. Targeting and snapping allocate nothing per frame.

## 12. Definition of polished

Tick each in the IWER emulator (E) or on a Quest 3S (Q), with hands (H) and controllers (C) where both apply.

- [ ] P1 (Q) The bench fades in at a comfortable height for a standing and a seated person; nothing pops in.
- [ ] P2 (Q) No part of the mat is closer than 0.5 m to the eyes; the rail is reachable without leaning.
- [ ] P3 (E, Q) Moving the bench by one handle and by two keeps it level; Bring the bench here works.
- [ ] P4 (Q, H and C) Every interactive thing shows hover before commit; grabbables and UI hover differently.
- [ ] P5 (Q, H) Exactly one hole is ringed under a pinch over a breadboard, and the wire or part lands on it.
- [ ] P6 (Q, H) At 3x, an LED and a resistor each seat in a chosen hole at the first try, three times out of three.
- [ ] P7 (E, Q) The ghost shows taken holes and same-row legs, and an invalid release never seats, floats or deletes.
- [ ] P8 (E, Q) Seating, wiring, pulling and removing are each one undo, and redo restores them.
- [ ] P9 (Q, H and C) A wire can be started, ended, rerouted with a bend, recoloured and pulled out with each input.
- [ ] P10 (Q) Wires arch over parts and never pass through one; crossings never touch.
- [ ] P11 (E) Hovering a wire dims the others and rings its whole net.
- [ ] P12 (Q, C) Each event in section 4 has its haptic; hover pulses are barely felt, a short is unmistakable.
- [ ] P13 (Q, H) Each committed event shows a pop ring and plays its sound; with sound off, ring and ticker remain.
- [ ] P14 (E, Q) Run, pause, step, the five speeds and reset behave as 6.1; the clock shows sim time and speed.
- [ ] P15 (Q) The session's system menu pauses a running sim with the reason "away"; it stays paused after.
- [ ] P16 (Q, H) A breadboard button presses by poke and releases as the finger leaves; a pot turns 1:1 with the wrist.
- [ ] P17 (Q) Light, temperature and distance sensors respond to the gestures in 6.2.
- [ ] P18 (Q) The meter reads at the red tip and on its display; a probe released on a pin stays clipped there.
- [ ] P19 (E, Q) A hot part tints and shows heat lines; a burnt part chars, smokes once and gets a pinned finding.
- [ ] P20 (E) A finding's card points at the exact pin; Fix previews before it applies.
- [ ] P21 (Q) Dropping a fault card on a part breaks that part; mystery mode hides the card.
- [ ] P22 (E, Q) A lesson step highlights its target on the bench; an off-view target gets an edge arrow.
- [ ] P23 (E) Parameter chips in the code change the program after a restart.
- [ ] P24 (E, Q) The checks list moves through idle, running, passed or failed with icon, word and colour.
- [ ] P25 (Q) Scale steps follow the two-handed spread and snap; one-handed rail buttons give the same steps.
- [ ] P26 (Q) Entering Room size fades; nothing grows towards the viewer; Back to bench is always reachable.
- [ ] P27 (Q) At Room size, geometry near the eyes fades; the floor and horizon stay level.
- [ ] P28 (Q, C) Mode 2 flight feels like a transmitter; letting go of the sticks holds altitude.
- [ ] P29 (Q, H) Virtual sticks fly the craft; dropping both hands makes it hover.
- [ ] P30 (Q) A crash freezes, offers Replay, and the replay plays in place at 1/3 speed with a scrubbable timeline.
- [ ] P31 (Q) FPV and chase show on a screen; the viewpoint never moves with the craft.
- [ ] P32 (E) All six languages fit every panel, button and chip with no overflow and no clipped Devanagari.
- [ ] P33 (E) Switching language and left-handedness happens live, without leaving the session.
- [ ] P34 (Q) Text is readable at its distance in a bright and a dim room; dim mode lowers the paper.
- [ ] P35 (E, Q) Reduced motion removes every crawling, flowing, rising and pulsing animation.
- [ ] P36 (Q) Every verb in 3.2 can be done with one hand only, seated.
- [ ] P37 (Q) The onboarding gets a first-time person to a blinking LED they wired within three minutes.
- [ ] P38 (Q) 90 fps holds with a lesson bench, a run, three chips and the guide open; draw calls stay under 100.

## 13. Custom work beyond the SDK

| Work | Why | Pillar |
|---|---|---|
| Cell targeting, snapping, ghost, hysteresis, one-euro steadying, leg checks | the SDK's grabbables move freely with min and max bounds; no snapping | Bench |
| Wire creation, routing, arches, crossings, net dimming | nothing in the SDK | Bench |
| Bench placement, handles, table snap with plane detection, recenter | planes and recenter are untried on the device | Bench, Shell |
| Near and far hysteresis, ray stickiness, target priority, near select on a cell, fly-to-hand far grab | the SDK picks by mesh hit; `BindOptions` has no near select and one distance mode | Input service [contract] |
| Haptic patterns over `app.input.pulse` | the SDK has no haptics; `pulse` is one buzz | all |
| Pop rings, ticker, finding cards, readout chips, chip atlas | UI the SDK does not have | Run, Learn |
| Six-language fitting, text size, the chip atlas, on the canvas text of `xr/src/ui` | UIKit's MSDF text is Latin only | Shell |
| Palm-facing menu button | the system owns palm pinch | Shell |
| Paper room dome and crossfade; depth-only hand occluders | not in the SDK | Shell, Scale |
| Scale steps about a pivot, Room size fade, near-eye fade, teleport behind a fade | the AR template turns the SDK's locomotion off | Scale |
| Gimbal ring for the virtual sticks, Guide flight, drone screen at 15 Hz, crash replay timeline | nothing in the SDK | Range |
| Tracking-loss rules, toggle grab, handedness detection | not in the SDK | Input service |
| The new `XrSettings` fields (9.6), a 3x default scale, the 90 to 72 Hz fallback | not in the contracts; the SDK sets no frame rate policy | Shell [contract] |
| Paired editor, virtual keyboard | no system keyboard in a session [device?] | Learn |

The SDK gives, behind `app.input`: ray and poke interactables, hand pinch as grab, `OneHandGrabbable`,
`DistanceGrabbable`, live hands and controllers switching (`input.sources`, for coaching); and `Follower`, positional
`AudioSource` and `XRQuadLayer`. The emulator check walks a hand pinch; on the device, hand pinch, poke and every grab
path are untried: check them first.

## 14. Sources

- The device spike's recipe (Quest 3S, Quest Browser 154, IWSDK 1.1.0; outside the repo), a read-only reconnaissance
  of the iynk flows, and Meta guidance from `metavr skills` (`hz-immersive-designer`, `hz-iwsdk-webxr`) and `metavr
  docs` (hands, hit targets, typography, touch, grab, rays, haptics, passthrough, comfort), fetched 2026-11-14.
- In this repo: XR_ARCHITECTURE.md, `xr/src/contracts/` and the input service (PR #12), XR_ASSETS.md, UI.md,
  [PART_STATE.md](PART_STATE.md), [DIAGNOSIS.md](DIAGNOSIS.md) and the 2D code named in the text.
