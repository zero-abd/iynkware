import type { Viewport } from "../../engine/types.ts";
import { drawFlow } from "./draw.ts";
import type { Ctx2D, FlowStyle, Hole } from "./draw.ts";
import type { FlowItem } from "./model.ts";
import type { RampTokens } from "./scale.ts";

const MAX_STEP_SECONDS = 0.1;

export interface FlowLayerDeps {
  viewport(): Viewport;
  reduceMotion(): boolean;
  /** True while the simulated clock advances: dots move only then. */
  running(): boolean;
  /** Called before each draw, so the owner can pick up a scene or a viewport that changed. */
  beforeDraw?(): void;
}

export interface FlowLayer {
  /** Puts the canvas over `host`, whose renderer has to be mounted already. */
  mount(host: HTMLElement): void;
  /** The colours of the canvas plate, or null before `mount`. */
  look(): { style: FlowStyle; ramp: RampTokens } | null;
  /** Shows `items`; null or an empty list clears the canvas and stops the loop. */
  set(items: readonly FlowItem[] | null): void;
  /** Draws again soon: the viewport moved, or the run started or paused. */
  invalidate(): void;
  dispose(): void;
}

/**
 * One canvas over the renderer holds every wire colour and every dot: no node per dot, and a loop that runs only
 * while something flows, the run is going and motion is allowed. Otherwise a frame is drawn when something changes.
 */
export function createFlowLayer(deps: FlowLayerDeps): FlowLayer {
  let host: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let look: { style: FlowStyle; ramp: RampTokens } | null = null;
  let items: readonly FlowItem[] = [];
  const phases = new Map<string, number>();
  let raf: number | null = null;
  let last: number | null = null;

  function resize(v: Viewport): void {
    const w = Math.round(v.w * v.dpr);
    const h = Math.round(v.h * v.dpr);
    if (canvas!.width !== w || canvas!.height !== h) {
      canvas!.width = w;
      canvas!.height = h;
    }
    ctx!.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  }

  // The renderer draws a paper card behind every run tag (svg-renderer.ts); the canvas sits over the renderer, so it
  // leaves those boxes empty and the tag reads over a coloured wire and its dots.
  function holes(): Hole[] {
    const box = host!.getBoundingClientRect();
    return [...host!.querySelectorAll("[data-iynk-renderer] g[data-legible] > rect")].map((card) => {
      const b = card.getBoundingClientRect();
      return { x: b.left - box.left, y: b.top - box.top, w: b.width, h: b.height };
    });
  }

  function frame(at: number): void {
    raf = null;
    if (!canvas || !ctx || !look) return;
    deps.beforeDraw?.();
    const v = deps.viewport();
    resize(v);
    const motion = !deps.reduceMotion() && deps.running();
    const dt = last === null ? 0 : Math.min(MAX_STEP_SECONDS, (at - last) / 1000);
    last = at;
    const { flowing } = drawFlow(ctx as Ctx2D, items, v, phases, motion ? dt : 0, { style: look.style, motion: !deps.reduceMotion(), holes: holes() });
    if (motion && flowing) raf = requestAnimationFrame(frame);
    else last = null;
  }

  function invalidate(): void {
    if (!canvas || raf !== null) return;
    raf = requestAnimationFrame(frame);
  }

  return {
    mount(el) {
      host = el;
      canvas = el.ownerDocument.createElement("canvas");
      canvas.setAttribute("data-flow-layer", "");
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
      el.append(canvas);
      ctx = canvas.getContext("2d");
      const plate = getComputedStyle(el.querySelector("[data-iynk-renderer]") ?? el);
      const token = (name: string) => plate.getPropertyValue(name).trim();
      look = {
        style: { paper: token("--studio-paper"), ink: token("--studio-ink") },
        ramp: { warm: token("--studio-wire-red"), cool: token("--studio-wire-blue"), zero: token("--studio-wire-grey") },
      };
    },
    look: () => look,
    set(next) {
      items = next ?? [];
      const keys = new Set(items.map((i) => i.key));
      for (const key of phases.keys()) if (!keys.has(key)) phases.delete(key);
      invalidate();
    },
    invalidate,
    dispose() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      canvas?.remove();
      canvas = null;
      host = null;
      ctx = null;
      look = null;
      items = [];
      phases.clear();
    },
  };
}
