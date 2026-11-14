import type { PartStateProvider } from "./types.ts";

/** An SSD1306 shows what the program drew on it; with no display driver in the program it shows nothing. */
export const ssd1306: PartStateProvider = (ctx) => {
  const view = ctx.display();
  return view ? { kind: "display", ...view } : null;
};
