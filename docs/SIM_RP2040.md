# SIM_RP2040: real firmware on a Pico

Status: living. The `rp2040js` engine runs a `.uf2` file on the Raspberry Pi Pico in the sim worker. The interpreter stays
the default; Firmware mode in the run bar switches a Pico to this engine. Spike: `docs/MASTER_PLAN/08_RESEARCH_SPIKES/RS-06-rp2040js-micropython/REPORT.md`.

## What runs

- `rp2040js` 1.4.1 (MIT) is an engine of the manifest (`src/sim-host/engines/rp2040js.manifest.json`), bundled into `public/engines` by
  `scripts/build-engines.mjs` and fetched, hash-checked, the first time a UF2 file is loaded. The boot ROM (`src/sim/mcu/rp2040/bootrom.ts`)
  and the engine (`src/sim/mcu/rp2040/engine.ts`) are dynamic imports of the worker, so no page bundle grows.
- A UF2 file comes from the Arduino IDE (arduino-pico), the pico-sdk or MicroPython. It is stored as an asset of the project
  (`firmware/<name>.uf2`, role `binary`) and the runtime is `{ engine: "rp2040js", options: { image: <asset id> } }`, so
  `.iynk`/`.iynkz` files and share links carry it like an AVR hex.
- The program starts the way the boot ROM starts it: a second stage loader with a good CRC runs from flash; a file without one starts at the
  vector table at `0x10000100`.

## How it meets the circuit

| Part of the chip | What it does in the run |
|---|---|
| GPIO GP0 to GP29 | A driven pin is a `pin` event of level 0 or 1 on the net `GP<n>`; a released pin is `Z`. The solver's input thresholds come back as `pin` events. A pin nothing drives reads the pull resistor the pad has (every pad starts with a pull-down). |
| PWM | A pin on the PWM function is reported by its duty and frequency from the slice registers, not edge by edge. |
| ADC | At the start of every slice the voltage the solver finds on GP26 to GP28 is read into the converter; a loop of reads gives the solver a turn every 20 microseconds. Channel 4 is the temperature sensor at 27 degrees. |
| UART0, UART1 and USB serial | Bytes go to the Serial monitor. Text typed there goes to the USB serial when the firmware has enumerated it, else to UART0. |
| I2C0, I2C1 | Transfers go through the same bus models as the interpreter, on the pins the firmware gave the I2C function (`netlistBus`). |
| SPI0, SPI1 | The peripheral runs with rp2040js' own timing; the netlist has no SPI device models yet, so reads return 0. |

## Speed

Two changes make firmware run at or above real time:

1. **USB serial that NAKs.** rp2040js answers every read of the host's OUT endpoint with an empty packet, so the firmware re-arms it at once and
   the USB interrupt fires about 35,000 times a second. An idle MicroPython never slept; this was the 0.54x to 0.79x of RS-06. The engine's host
   side leaves a read with no data unanswered, as a real host's NAK does.
2. **Sleep and wait skipping.** WFI and WFE jump the clock to the next alarm (or the end of the slice). A wait that only reads the timer (`busy_wait_us`,
   `while (time_us_32() - t < n)`) runs exactly for its first half millisecond, then jumps in steps of at most 50 microseconds and one sixteenth of the wait so far, never past
   an alarm or the slice. The wait ends within 50 microseconds of where it would have. Any pin edge, serial byte, bus transfer or ADC read ends the skipping.

Measured on an Apple M4 Pro, Chromium 156 headless, the sim worker with the live solver and the Studio on the page (2026-11-11). "Max" is the speed
chosen as fast as possible; at 1x every case held 1.00 and the run bar showed no notice. The 4x and 6x columns divide by the throttle: the DevTools
CPU throttle does not reach a worker, so they are estimates, as in `e2e/analog-perf.spec.ts`.

| Firmware | Max | 4x estimate | 6x estimate |
|---|---|---|---|
| C blink, wait on the timer (clang, freestanding) | 68x | 17x | 11x |
| C blink, TIMER alarm and WFI (clang, freestanding) | 226x | 57x | 38x |
| C ADC read, print and a 10 ms wait (clang, freestanding) | 12x | 3.0x | 2.0x |
| MicroPython v1.29.0, blink with `sleep_ms(250)` | 231x | 58x | 39x |
| MicroPython v1.29.0, ADC read and print every 10 ms | 40x | 10x | 6.7x |
| C loop that only computes (no wait, no sleep) | 0.66x | 0.17x | 0.11x |

A program that only computes cannot keep up: rp2040js executes about 60 to 80 million instructions a second on this machine against the chip's 125 million
cycles. The run bar says "Running slower than real time" and the speed it reaches. No toolchain ran the pico-sdk or Arduino cores here: the C rows are
freestanding C with direct register access, built with clang for Thumb and placed in a UF2; the MicroPython rows are the stock UF2 from micropython.org,
which is not committed (over 600 KB).

## Not modelled

- PIO: rp2040js models it and its output pins are reported like GPIO outputs, but no test or measurement here runs a PIO program.
- UART, SPI and I2C lines do not toggle their pins, so an instrument on GP0 does not see serial bits.
- `I2C.scan()` of MicroPython bit-bangs the probe on the pins. The engine does not answer that; `readfrom`, `writeto` and register reads work.
- The flash is rebuilt from the UF2 file on every start, so a MicroPython file system does not survive a reset. The ROM's erase and program routines work.
- The second core, the RP2350 (Pico 2) and the Pico W radio.
- The boot ROM carries Raspberry Pi's floating point library, which is licensed for use on an RP2040 only; see the header of `bootrom.ts`.

## Tests

`src/sim/mcu/rp2040/*.test.ts` (UF2, GPIO, PWM, ADC, UART, I2C, flash routines, wait skipping), `src/sim-host/engines/rp2040-engine.test.ts` (the
handler with the solver), `src/components/studio/FirmwareMode.test.tsx`, `e2e/studio-rp2040.spec.ts`. The fixtures are Thumb programs assembled by
`src/sim/mcu/rp2040/programs.testing.ts`; `node scripts/gen-rp2040-fixtures.mjs` writes them and `--check` compares.
