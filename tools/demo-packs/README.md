# Demo part packs

Part packs (`.iynkpack`) for demonstrating "import your own component". Each is a re-badged variant of a modelled core
part under the `demo.` namespace, built with `buildPack` and read back through `readPack` with the parts library's own
import context. The brands are invented.

```bash
node --experimental-strip-types tools/demo-packs/build.ts           # write the packs and index.json, both copies
node --experimental-strip-types tools/demo-packs/build.ts --check   # fail if a pack is out of date or refused
```

The build writes the same bytes to `public/demo-packs/` (the 2D site) and `xr/public/demo-packs/` (the headset), with an
`index.json` naming each pack's part.

Import one in the 2D Studio: Palette, Import, pick the file. On the headset page: Open on this screen, then Import a part
(choose a file or press a demo part), then Enter; or from a script, `iynkware.parts.importDemo('blue-led-10mm.iynkpack')`.

## How an imported part runs

Every pack is a re-badge: its pins and behaviour equal a core part's byte for byte. `buildSimNetlist` hands such a part
to the simulator as that core part (`src/sim/import-twin.ts`), because the solver specs, sensor inputs and part-state
providers key on the core catalogue name and the run worker resolves only built-in descriptors. A part that differs in
pins or behaviour gets no twin and is treated exactly as before.

The twin is found only when the caller passes a registry that holds the imported part (`get`, `list`, `originOf`). The
headset passes the app's shared registry (#215, #216). The 2D Studio workspace still builds from `builtinRegistry()`.

Each variant normalises fault ids the import check rejects (some core files spell `led-dark` as `led.dark`) and drops
`visual.breadboard`: imported parts may not ship executable figure pages, so they draw with the generic fallback.
