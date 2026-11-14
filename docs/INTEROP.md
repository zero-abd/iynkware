# INTEROP: Wokwi in, KiCad and SPICE out

Status: living. Code: `src/export/wokwi/` (import), `src/export/kicad.ts` and `src/export/footprints.ts` (KiCad netlist),
`src/sim/analog/spice.ts` (SPICE deck). The Studio entries are in the Project menu (`src/components/studio/InteropDialogs.tsx`,
loaded when one is used). Every loss the import or an export has comes back as a `LossItem` with a `code` and `args`, and the
review dialog says it in the person's language (`studio.interop.*`).

## 1. Wokwi import

`importWokwi(files, env)` takes `diagram.json`, the sketch (`.ino`, `.h`, `.cpp`, `.c`), `main.py` for a Pico, and
`libraries.txt`, loose or inside a zip. It returns a project and a loss list. Nothing is dropped without a line in the list.

How a diagram becomes a project:

- Each connection `[from, to, colour, hints]` joins two pins. Joined pins make one net; a net is named and classed from the board
  pins on it (`GND` ground, `5V` and `3V3` power, a board pin such as `D13` names a signal). The routing hints are ignored.
- The wire colour becomes the nearest of iynk's ten (`red black orange yellow green blue white purple brown grey`), by name or by
  hex. An empty colour (a hidden wire) gives a wire with no colour.
- Parts go on the Breadboard view at their `left` and `top`, one Wokwi pixel being 25.4 / 96 mm, with `rotate` when it is a multiple of 90.
- A breadboard is flattened: its strips join the nets that meet in them and no breadboard part is made.
- Attributes that iynk has a parameter for are carried over (see the table); the rest are dropped.

Pin and part names are from `docs.wokwi.com/parts/<type>`. The breadboard hole names (`12t.a`, `tp.5`) and the ESP32 DevKit v1
pin names (`D2`, `VP`, `RX0`) are from the Wokwi editor's own diagrams; the docs pages for those parts were not reachable.

| Wokwi type | iynk part | Pins (Wokwi to iynk) | Attributes carried |
|---|---|---|---|
| `wokwi-arduino-uno` | `core.uno-r3` | `0`..`13` to `D0`..`D13`, `A0`..`A5`, `5V` to `P5V`, `3.3V` to `P3V3`, `GND.1`..`GND.3` to `GND`, `VIN`, `IOREF`, `AREF`, `RESET`, `SDA`, `SCL` | none |
| `wokwi-arduino-nano` | `core.nano` | as the Uno, with `A6` and `A7` | none |
| `wokwi-pi-pico` | `core.pico` | `GP0`..`GP22`, `GP26`..`GP28`, `GND.n` to `GND`, `3V3` to `P3V3`, `VBUS`, `VSYS`, `TP4` and `TP5` (no counterpart) | none |
| `wokwi-esp32-devkit-v1`, `board-esp32-devkit-c-v4` | `core.esp32-devkitc` | `D2` or `2` to `GPIO2`, `VP` to `GPIO36`, `VN` to `GPIO39`, `RX0` and `TX0` to `GPIO3` and `GPIO1`, `RX2` and `TX2` to `GPIO16` and `GPIO17`, `3V3`, `VIN`, `EN`, `GND.n` | none |
| `board-esp32-s3-devkitc-1` | `core.esp32-s3-devkitc-1` | as the ESP32 | none |
| `wokwi-breadboard-half`, `wokwi-breadboard-mini` | none (flattened) | `<col>t.a`..`e` and `<col>b.f`..`j` to holes; `tp.n`, `tn.n`, `bp.n`, `bn.n` to rails | none |
| `wokwi-led` | `core.led-5mm` | `A` to `A`, `C` to `K` | `color`: red, yellow, green, blue, white; orange and amber go to yellow, lime to green, purple, cyan and magenta to blue, pink to red (each reported) |
| `wokwi-resistor` | `core.resistor` | `1`, `2` to `P1`, `P2` | `value` in ohms, `4k7`, `1.5k`, `10M` |
| `wokwi-pushbutton`, `wokwi-pushbutton-6mm` | `core.push-button-6mm` | `1.l`, `1.r`, `2.l`, `2.r` to `P1`..`P4` | none |
| `wokwi-potentiometer` | `core.potentiometer-10k` | `GND` to `P1`, `SIG` to `W`, `VCC` to `P3` | `value` 0..1023 to `pos` |
| `wokwi-servo` | `core.servo-sg90` | `GND`, `V+` to `VPLUS`, `PWM` to `SIG` | none |
| `wokwi-buzzer` | `core.buzzer-piezo` | `1` to `MINUS`, `2` to `PLUS` | none |
| `wokwi-hc-sr04` | `core.hc-sr04` | `VCC`, `TRIG`, `ECHO`, `GND` | none (`distance` is a world input in iynk) |
| `wokwi-ssd1306` | `core.ssd1306` | `GND`, `VIN` and `3V3` to `VCC`, `DATA` to `SDA`, `CLK` to `SCL`; `DC`, `RST`, `CS` have no counterpart | none |
| `wokwi-slide-switch` | `core.slide-switch` | `1`, `2`, `3` to `A`, `COM`, `B` | `value` `"1"` to `closed` |
| `wokwi-rgb-led` | `core.rgb-led` | `R`, `G`, `B`, `COM` | `common` |
| `wokwi-mpu6050` | `core.gy521-mpu6050` | same names | none |
| `wokwi-photoresistor-sensor` | `core.ldr` and a 10 kohm `core.resistor` (the module's divider) | `VCC` to the LDR, `AO` to the node between them, `GND` to the resistor; `DO` has no counterpart | `lux` |

Not imported, each listed with its id, type, reason and the number of wires it took with it: `wokwi-lcd1602`, `wokwi-lcd2004`,
`wokwi-ili9341`, `wokwi-7segment` (no display part), `wokwi-neopixel`, `wokwi-neopixel-matrix`, `wokwi-led-ring` (no addressable LED),
`wokwi-dht22`, `wokwi-ntc-temperature-sensor`, `wokwi-ds1307` (no model), `wokwi-arduino-mega`, `board-pi-pico-w` (no board),
`wokwi-breadboard` (the full size is wider than iynk's half), a second board, and any other type. `$serialMonitor` wires are left out
with a note, since iynk has its own monitor. A pin name the part does not have is listed as `pin-unknown`.

## 2. SPICE deck

`exportSpice(project, registry, opts)` builds the elements the live solver builds (`buildElements`, the same function the run
uses) and writes each one as a card:

- `R`, `POT` (two resistors), `C` and `L` (with `IC=` and the series ESR or DCR), `V` and `VW` (a source behind its series resistance;
  `SIN`, `PULSE` or `PWL`).
- `D`, an LED and a Zener included, as a `.model D(IS N RS)` with the same Shockley figures the Newton solver takes (`forNewton`);
  a Zener adds `BV`, `IBV`, `NBV`.
- The LM358 as `.subckt IYNK_OPAMP` (gain, one pole at gbw over gain, a tanh clamp inside the rails) and the NE555 as `.subckt IYNK_555`
  (the 5 k and 10 k divider, two switches charging a capacitor as the latch, an output stage and the discharge switch). Each is written
  once, however many are placed.
- A `.tran` card from the project's run length, `uic`, so the capacitors start at their `v0`.

Left out and reported: board pins that firmware drives (open in the deck), a source's current limit, the op amp slew limit, the start
phase of a square, pulse or triangle source, bench instruments, and any element the solver builds that has no card.

Proof: `src/sim/analog/spice.test.ts` writes the deck of each analog starter, runs it in ngspice (`eecircuit-engine` 1.9.0) and
compares every net with the live solver at the sample times below. The tolerance is 2 percent, or 20 mV for a node near zero.

| Starter | Samples (s) | Worst difference measured |
|---|---|---|
| `rc-led` | 0.1, 0.47, 1, 2, 3 | 1 mV, 0.03 percent |
| `opamp-amplifier` | 0.01, 0.03, 0.05 | under 1 mV |
| `zener-regulator` | 0.25 to 2 | under 1 mV, 0.01 percent |
| `rectifier` | 0.101 to 0.4205 | under 1 mV, 0.01 percent |
| `blinker-555` | 0.05 to 1.5 | 3 mV, 0.08 percent |

## 3. KiCad

`exportKicadNetlist` writes a KiCad 8 netlist (`(export (version "E") ...)`): `design`, `components` (reference, value, footprint, a
stable tstamp), `libparts`, `libraries` and `nets` (named from the project's net name, `GND`, `+5V`, `+3V3`, `/D13`, or
`Net-(R1-Pad2)`). Pcbnew reads it with File, Import, Netlist. `footprints.ts` holds the table: the symbol, the stock KiCad 8
footprint and the pad number of each iynk pin, for 28 parts. A part without a row is written with an empty footprint and its iynk pin names as pad
numbers, and is named in the report. Boards have no row: KiCad draws a module with its own pad names.

The pad numbers were checked against the pin order of each KiCad symbol and footprint from memory of the stock libraries; KiCad is
not installed here, so no netlist has been opened in it. The unit test reads the file back as an s-expression and checks the
structure, that every row of the table covers every pin of its part once, and the DIP-8 numbering of the 555.

A schematic (`.kicad_sch`) is not written. It needs a symbol definition embedded for every part, drawn pin positions and wires that
KiCad accepts without an ERC cascade, and there is no KiCad here to open one. A file that has not been opened in KiCad 8 is not
promised to open in it, so the netlist is the export.
