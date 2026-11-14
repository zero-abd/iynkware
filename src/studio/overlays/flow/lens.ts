import type { PartRegistry } from "../../../parts/registry.ts";
import type { Project } from "../../../project/generated/types.ts";
import type { AnalogWatch } from "../../../sim-host/analog-protocol.ts";
import { registerOverlayProvider } from "../../engine/controller.ts";
import type { EditorEngine } from "../../engine/engine.ts";
import type { Scene } from "../../engine/types.ts";
import type { AnalogView } from "../../run/analog.ts";
import type { RunView } from "../../stores/run.ts";
import type { Store } from "../../stores/select.ts";
import type { SessionStore } from "../../stores/session.ts";
import type { UiStore } from "../../stores/ui.ts";
import type { DocStore } from "../../stores/doc.ts";
import { healthOverlays } from "./health.ts";
import type { FlowLabels } from "./health.ts";
import { pinSpotsOf, strokesOf } from "./geometry.ts";
import { createFlowLayer } from "./layer.ts";
import type { FlowLayer } from "./layer.ts";
import { flowItems } from "./model.ts";
import { breadboardPlan, schematicPlan } from "./plan.ts";
import type { FlowPlan } from "./plan.ts";
import { readingFor } from "./readout.ts";
import type { FlowReading } from "./readout.ts";
import { rangeOf } from "./scale.ts";
import type { VoltRange } from "./scale.ts";

/** What the lens asks the run to report: every net voltage, every pin current and the health of every part. */
const WATCH: AnalogWatch = { volts: "all", amps: [], pinAmps: true, waves: [] };
const STOP: AnalogWatch = { volts: [], amps: [], pinAmps: false, waves: [] };

export interface FlowLensDeps {
  doc: DocStore;
  session: SessionStore;
  run: Store<RunView>;
  ui: UiStore;
  engine: EditorEngine;
  registry: PartRegistry;
  host: { watchAnalog(watch: AnalogWatch): Promise<void> };
  labels: FlowLabels;
  reduceMotion(): boolean;
}

export interface FlowLens {
  /** Draws over `host`, where the engine is mounted already. Returns the function that takes the lens off again. */
  mount(host: HTMLElement): () => void;
  /** The voltages the colours stand for, or null while the run has reported none. */
  range(): VoltRange | null;
  /** What the thing under the pointer reads, or null. */
  reading(): FlowReading | null;
}

const isLive = (phase: RunView["phase"]): boolean => phase === "running" || phase === "paused";

/**
 * The flow lens of a circuit view: each wire takes the colour of its net's voltage and carries dots that move with the
 * current, and a part the solver flags is outlined and named. It reads the frames the run store already holds and asks
 * for them with `analog.watch` while it is on and a run is going.
 */
export function createFlowLens(deps: FlowLensDeps): FlowLens {
  const { doc, session, run, ui, engine } = deps;

  const memo: { project: Project | null; viewId: string; plan: FlowPlan | null } = { project: null, viewId: "", plan: null };
  function plan(): FlowPlan | null {
    const state = doc.getState().state;
    const viewId = session.getState().viewId;
    if (memo.project === state && memo.viewId === viewId) return memo.plan;
    const kind = state.views.find((v) => v.id === viewId)?.kind;
    memo.project = state;
    memo.viewId = viewId;
    memo.plan = kind === "breadboard" ? breadboardPlan(state, viewId) : kind === "schematic" ? schematicPlan(state, viewId, deps.registry) : null;
    return memo.plan;
  }

  const analogOf = (): AnalogView | null => (ui.getState().flowLens ? run.getState().analog : null);

  function sceneOf(): Scene | null {
    try {
      return engine.scene();
    } catch {
      return null;
    }
  }

  return {
    range: () => {
      const analog = analogOf();
      return analog && Object.keys(analog.volts).length > 0 ? rangeOf(analog.volts) : null;
    },

    reading: () => {
      const analog = analogOf();
      return analog ? readingFor(doc.getState().state, analog, plan(), session.getState().hover) : null;
    },

    mount(host) {
      const layer: FlowLayer = createFlowLayer({ viewport: () => engine.viewport(), reduceMotion: deps.reduceMotion, running: () => run.getState().phase === "running" });
      layer.mount(host);
      let frame: number | null = null;
      let asked = false;
      let drawn: { scene: Scene | null; analog: AnalogView | null; plan: FlowPlan | null } | null = null;

      function syncWatch(): void {
        const want = ui.getState().flowLens && isLive(run.getState().phase);
        if (want === asked) return;
        asked = want;
        void deps.host.watchAnalog(want ? WATCH : STOP).catch(() => undefined);
      }

      function draw(): void {
        frame = null;
        const analog = analogOf();
        const scene = sceneOf();
        const current = plan();
        if (drawn && drawn.scene === scene && drawn.analog === analog && drawn.plan === current) {
          layer.invalidate();
          return;
        }
        drawn = { scene, analog, plan: current };
        const look = layer.look();
        if (!analog || !scene || !current || !look) {
          layer.set(null);
          return;
        }
        const { max } = rangeOf(analog.volts);
        layer.set(flowItems(current, strokesOf(scene, current), pinSpotsOf(scene), analog, max, look.ramp));
      }

      function schedule(): void {
        syncWatch();
        if (frame === null) frame = requestAnimationFrame(draw);
      }

      const offProvider = registerOverlayProvider(
        () => {
          const analog = analogOf();
          const scene = sceneOf();
          return analog && scene ? healthOverlays(scene, analog.parts, deps.labels) : [];
        },
        (fn) => {
          const offs = [run.subscribe(fn), ui.subscribe(fn)];
          return () => offs.forEach((off) => off());
        },
      );
      const offs = [run.subscribe(schedule), ui.subscribe(schedule), session.subscribe(schedule), doc.onChange(schedule), offProvider];
      schedule();

      return () => {
        for (const off of offs) off();
        if (frame !== null) cancelAnimationFrame(frame);
        if (asked) void deps.host.watchAnalog(STOP).catch(() => undefined);
        layer.dispose();
      };
    },
  };
}
