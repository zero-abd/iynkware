# Demo part packs

Part packs (`.iynkpack`) for demonstrating "import your own component". Each is a re-badged variant of a modelled core
part under the `demo.` namespace, built with `buildPack` and read back through `readPack` with the parts library's own
import context. The brands are invented.

```bash
node --experimental-strip-types tools/demo-packs/build.ts           # write public/demo-packs/*.iynkpack
node --experimental-strip-types tools/demo-packs/build.ts --check   # fail if a pack is out of date or refused
```

Import one in the 2D Studio: Palette, Import, pick the file.

## What works after import, and why

The I2C bus binds devices by their behaviour ref (`src/sim/mcu/i2c-bind.ts`), so `demo.bme280-breakout` and
`demo.mpu6050-board` answer on the bus exactly like the core parts.

The live solver (`SPECS` in `src/sim/analog/live.ts`), sensor inputs (`src/sim/sensors/inputs.ts`) and part-state
providers (`src/sim/part-state/`) key on the catalogue name derived from the descriptor id. A `demo.` id has no entry,
so the LED, photoresistor, buzzer and OLED packs import cleanly but are not yet simulated. Making them work means
resolving the solver entry from the descriptor's behaviour (its analog `element` or protocol `ref`) when the id is not
a core one. That is a change to shared simulator code and needs its own issue.

Each variant normalises fault ids the import check rejects (some core files spell `led-dark` as `led.dark`) and drops
`visual.breadboard`: imported parts may not ship executable figure pages, so they draw with the generic fallback.
