import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PcbTraces } from "./PcbTraces";

describe("PcbTraces", () => {
  it("runs each side's two pulses as transform animations shown through the trace outline", () => {
    const html = renderToStaticMarkup(<PcbTraces />);
    expect(html.match(/class="trace-pulse /g)).toHaveLength(4);
    expect(html.match(/mask-image:url\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain("stroke-dasharray");
  });
});
