"use client";

import { useId } from "react";
import { Button, Icon } from "@/components/ui";
import type { Messages } from "@/i18n/namespaces";
import { WIRE_TOKEN } from "@/studio/engine/constants";
import { withUnit } from "@/studio/overlays/flow/format";
import { RAMP_STEPS, rampColour } from "@/studio/overlays/flow/scale";
import type { FlowLens } from "@/studio/overlays/flow/lens";
import type { FlowReading } from "@/studio/overlays/flow/readout";
import type { RunStore } from "@/studio/stores/run";
import { useStoreSelector, type Store } from "@/studio/stores/select";
import type { SessionState } from "@/studio/stores/session";
import type { UiStore } from "@/studio/stores/ui";
import { useReducedMotion } from "./StudioSettings";

export interface FlowBarProps {
  lens: FlowLens;
  ui: UiStore;
  run: RunStore;
  session: Store<SessionState>;
  messages: Messages["studioRun"]["flow"];
}

const TOKENS = { warm: `var(${WIRE_TOKEN.red})`, cool: `var(${WIRE_TOKEN.blue})`, zero: `var(${WIRE_TOKEN.grey})` };
const STEPS = [-RAMP_STEPS, (-3 * RAMP_STEPS) / 4, -RAMP_STEPS / 2, -RAMP_STEPS / 4, 0, RAMP_STEPS / 4, RAMP_STEPS / 2, (3 * RAMP_STEPS) / 4, RAMP_STEPS];

/** A pin reads as its own name and numbers; the power and state belong to the whole part, so they are left to a hover on the body. */
function readingText(r: FlowReading, m: FlowBarProps["messages"]): string {
  const pin = r.kind === "part" ? r.pin : undefined;
  const parts = [pin ? m.readout.pin.replace("{part}", r.kind === "part" ? r.part : "").replace("{name}", pin.name) : r.kind === "part" ? m.readout.part.replace("{name}", r.part) : m.readout.net.replace("{name}", r.net)];
  const volts = r.kind === "part" ? (pin?.volts ?? r.volts) : r.volts;
  const amps = r.kind === "part" ? (pin?.amps ?? r.amps) : r.amps;
  if (volts !== undefined) parts.push(`${m.readout.volts} ${withUnit(volts, "V")}`);
  if (amps !== undefined) parts.push(`${m.readout.amps} ${withUnit(amps, "A")}`);
  if (r.kind === "part" && !pin && r.watts !== undefined) parts.push(`${m.readout.watts} ${withUnit(r.watts, "W")}`);
  if (r.kind === "part" && !pin && r.state !== undefined && r.state !== "ok") parts.push(m.state[r.state]);
  return parts.join(", ");
}

/** The switch for the flow lens, the volts its colours stand for, and what the pointer is over. It sits in a corner of the canvas. */
export function FlowBar({ lens, ui, run, session, messages }: FlowBarProps) {
  const on = useStoreSelector(ui, (s) => s.flowLens);
  const analog = useStoreSelector(run, (s) => s.analog);
  const hover = useStoreSelector(session, (s) => s.hover);
  const hintId = useId();
  const still = useReducedMotion();
  const hint = still ? messages.hintStill : messages.hint;
  const range = on && analog ? lens.range() : null;
  const reading = on && hover ? lens.reading() : null;
  return (
    <div className="pointer-events-none absolute start-2 bottom-2 flex max-w-[calc(100%-16px)] flex-col items-start gap-2">
      {reading ? (
        <p role="status" className="rounded-lg border border-rule bg-paper px-3 py-2 text-sm tabular-nums text-ink">
          {readingText(reading, messages)}
        </p>
      ) : null}
      <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 rounded-lg border border-rule bg-paper p-1">
        <Button size="sm" variant="ghost" aria-pressed={on} aria-describedby={hintId} title={hint} onClick={() => ui.set("flowLens", !on)}>
          <Icon name="bolt" size={16} />
          {messages.toggle}
        </Button>
        <span id={hintId} className="sr-only">
          {hint}
        </span>
        {range ? (
          <div className="flex items-center gap-2 pe-2 text-sm tabular-nums text-muted" aria-label={messages.legend}>
            <span>{withUnit(-range.max, "V")}</span>
            <span className="flex h-2 overflow-hidden rounded-md" aria-hidden="true">
              {STEPS.map((step) => (
                <span key={step} className="w-3" style={{ background: rampColour(step, TOKENS) }} />
              ))}
            </span>
            <span>{withUnit(range.max, "V")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
