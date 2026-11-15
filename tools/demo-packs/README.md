# Demo part packs

Part packs (`.iynkpack`) for demonstrating "import your own component". Each is a re-badged variant of a modelled core
part under the `demo.` namespace, built with `buildPack` and read back through `readPack` with the parts library's own
import context. The brands are invented.

```bash
node --experimental-strip-types tools/demo-packs/build.ts           # write public/demo-packs/*.iynkpack
node --experimental-strip-types tools/demo-packs/build.ts --check   # fail if a pack is out of date or refused
```

Import one in the 2D Studio: Palette, Import, pick the file.

## How an imported part runs

Every pack is a re-badge: its pins and behaviour equal a core part's byte for byte. `buildSimNetlist` hands such a part
to the simulator as that core part (`src/sim/import-twin.ts`), because the solver specs, sensor inputs and part-state
providers key on the core catalogue name and the run worker resolves only built-in descriptors. A part that differs in
pins or behaviour gets no twin and is treated exactly as before.

The twin is found only when the caller passes a registry that holds the imported part (`get`, `list`, `originOf`). The
2D Studio workspace and the headset project store build from `builtinRegistry()` today; giving them the person's
library is the next step (#213 follow-up).

Each variant normalises fault ids the import check rejects (some core files spell `led-dark` as `led.dark`) and drops
`visual.breadboard`: imported parts may not ship executable figure pages, so they draw with the generic fallback.
