// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PROFILES } from "../../../sim/boards/profiles";
import { defaultPorts, portMap } from "./ports";

describe("defaultPorts", () => {
  it("matches the Basys 3 ports to the catalogue pin names", () => {
    const pins = ["CLK", "SW0", "SW1", "LD0", "LD1", "BTNC", "CA", "CB", "DP", "AN0", "JA1", "JA2"];
    const map = defaultPorts(PROFILES.basys3, pins);
    expect(map.sw?.slice(0, 3)).toEqual(["SW0", "SW1", ""]);
    expect(map.led?.slice(0, 3)).toEqual(["LD0", "LD1", ""]);
    expect(map.btnC).toEqual(["BTNC"]);
    expect(map.seg?.slice(0, 3)).toEqual(["CA", "CB", ""]);
    expect(map.dp).toEqual(["DP"]);
    expect(map.an?.[0]).toBe("AN0");
    expect(map.JA?.slice(0, 3)).toEqual(["JA1", "JA2", ""]);
    expect(map.clk).toBeUndefined();
    expect(map.btnU).toBeUndefined();
  });

  it("matches the board's own port-bit pins", () => {
    const map = defaultPorts(PROFILES.basys3, ["sw0", "led0"]);
    expect([map.sw?.[0], map.sw?.[1], map.led?.[0]]).toEqual(["sw0", "", "led0"]);
  });

  it("matches the DE10-Lite switches, keys and hex digits", () => {
    const map = defaultPorts(PROFILES["de10-lite"], ["SW0", "KEY1", "LEDR9", "DIG0_A", "DIG5_DP"]);
    expect(map.SW?.[0]).toBe("SW0");
    expect(map.KEY).toEqual(["", "KEY1"]);
    expect(map.SW).toHaveLength(10);
    expect(map.LEDR?.[9]).toBe("LEDR9");
    expect(map.HEX0?.[0]).toBe("DIG0_A");
    expect(map.HEX5?.[7]).toBe("DIG5_DP");
  });
});

describe("portMap", () => {
  it("lets the project's names win and fills the other ports", () => {
    const map = portMap(PROFILES.basys3, ["SW0", "LD0", "LD7"], { led: ["LD7"], sw: undefined });
    expect(map.led).toEqual(["LD7"]);
    expect(map.sw?.[0]).toBe("SW0");
  });
});
