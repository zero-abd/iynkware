// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toVcd } from "./vcd.ts";

const meta = { docHash: "r7", seed: 3 };

describe("toVcd", () => {
  it("writes the header, the variables and each change once", () => {
    const text = toVcd(
      [
        { name: "SCL", t: [0, 1000, 3000], v: [0, 3.3, 0] },
        { name: "SDA line", t: [0, 2000], v: [3.3, 0] },
      ],
      meta,
    );
    expect(text).toBe(
      [
        "$comment project r7, seed 3. Edge times follow the simulator's clock. $end",
        "$version iynk $end",
        "$timescale 1 ns $end",
        "$scope module iynk $end",
        "$var wire 1 ! SCL $end",
        '$var wire 1 " SDA_line $end',
        "$upscope $end",
        "$enddefinitions $end",
        "#0",
        "$dumpvars",
        '0!',
        '1"',
        "$end",
        "#1000",
        "1!",
        "#2000",
        '0"',
        "#3000",
        "0!",
        "",
      ].join("\n"),
    );
  });

  it("skips samples that do not change a level and rounds to whole nanoseconds", () => {
    const text = toVcd([{ name: "a", t: [0, 10.4, 20.6], v: [0, 0.1, 5] }], meta);
    expect(text).toContain("#0\n$dumpvars\n0!\n$end\n#21\n1!\n");
  });

  it("gives more than 94 variables distinct identifiers", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `n${i}`, t: [0], v: [0] }));
    const ids = toVcd(many, meta)
      .split("\n")
      .filter((l) => l.startsWith("$var"))
      .map((l) => l.split(" ")[3]);
    expect(new Set(ids).size).toBe(100);
    expect(ids[94]).toHaveLength(2);
  });
});
