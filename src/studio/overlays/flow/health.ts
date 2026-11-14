import type { Messages } from "../../../i18n/namespaces.ts";
import type { AnalogPartFrame } from "../../../sim-host/analog-protocol.ts";
import type { ArtElement, Overlay, Scene } from "../../engine/types.ts";

export type FlowLabels = Messages["studioRun"]["flow"];

const WARN = "var(--studio-warn)";
const PAPER = "var(--studio-paper)";
const SCORCH = "color-mix(in srgb, var(--studio-ink) 62%, transparent)";
const PAD_MM = 0.8;
const OUTLINE_SW = 0.5;
const CROSS_SW = 0.6;
const TAG_SIZE_MM = 2;
const TAG_GAP_MM = 1.2;

/**
 * What a part the solver has flagged looks like: a part that is `hot` or `reversed` gets a warning outline and its
 * word above it; a `burnt` part is covered in a dark scorch with a cross through it. The word is always there, so the
 * state never rests on colour. Parts the scene does not hold (off screen, or in another view) get nothing.
 */
export function healthOverlays(scene: Scene, parts: Readonly<Record<string, AnalogPartFrame>>, labels: FlowLabels): Overlay[] {
  const overlays: Overlay[] = [];
  for (const { hit, bbox } of scene.targets) {
    if (hit.kind !== "part") continue;
    const state = parts[hit.c]?.state;
    if (state === undefined || state === "ok") continue;
    const w = bbox.x1 - bbox.x0 + 2 * PAD_MM;
    const h = bbox.y1 - bbox.y0 + 2 * PAD_MM;
    const elements: ArtElement[] = [
      { t: "rect", x: -w / 2, y: -h / 2, w, h, rx: PAD_MM, fill: state === "burnt" ? SCORCH : "none", stroke: WARN, sw: OUTLINE_SW },
    ];
    if (state === "burnt") {
      elements.push({ t: "path", d: `M${-w / 2} ${-h / 2}L${w / 2} ${h / 2}M${w / 2} ${-h / 2}L${-w / 2} ${h / 2}`, stroke: PAPER, sw: CROSS_SW });
    }
    elements.push({ t: "text", x: 0, y: -h / 2 - TAG_GAP_MM, s: labels.state[state], size: TAG_SIZE_MM, anchor: "middle" });
    overlays.push({ id: `health:${hit.c}`, xMm: (bbox.x0 + bbox.x1) / 2, yMm: (bbox.y0 + bbox.y1) / 2, elements });
  }
  return overlays;
}
