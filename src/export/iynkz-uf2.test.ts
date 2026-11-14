// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { uf2Ops } from "../components/studio/FirmwareMode";
import { cryptoRandom } from "../core/ids.ts";
import { createSession } from "../project/session.ts";
import type { Project } from "../project/generated/types.ts";
import pico from "../studio/starters/pico.project.json";
import { readIynkz, writeIynkz } from "./iynkz.ts";

const clock = () => Date.UTC(2026, 10, 10);
const uf2 = new Uint8Array(readFileSync(join(process.cwd(), "src/sim/mcu/rp2040/fixtures/blink-poll.uf2")));

describe("a project with a UF2 file", () => {
  it("keeps the file and the engine choice through a save to a container and back", async () => {
    const start = pico as unknown as Project;
    const runtime = start.simulation.runtimes[0];
    const session = createSession({ state: start, clock, rnd: cryptoRandom });
    const done = session.apply(uf2Ops({ id: runtime.id, board: runtime.board, boardRef: "core.pico", engine: runtime.engine }, "blink-poll", uf2), { actor: start.access.owners[0]!, kind: "user" });
    if (!done.ok) throw new Error(done.message);
    const state = session.state;
    const asset = state.assets.find((a) => a.path === "firmware/blink-poll.uf2")!;
    expect(asset).toMatchObject({ bytes: uf2.length, role: "binary" });
    expect(state.simulation.runtimes[0]).toMatchObject({ engine: "rp2040js", options: { image: asset.id } });

    const report = await readIynkz(writeIynkz(state, [{ sha256: asset.sha256, bytes: uf2 }]), clock);
    if (!report.ok) throw new Error(report.error.message);
    const back = report.project;
    expect(back.simulation.runtimes[0]).toMatchObject({ engine: "rp2040js", options: { image: asset.id } });
    expect(back.assets.find((a) => a.id === asset.id)?.sha256).toBe(asset.sha256);
    expect(report.hashMatches).toBe(true);
    expect(report.assets?.map((a) => [a.sha256, Array.from(a.bytes)])).toEqual([[asset.sha256, Array.from(uf2)]]);
  });
});
