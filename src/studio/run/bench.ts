import { useEffect, useState } from "react";
import type { InstrumentReading, InstrumentSource } from "@/sim/analog/types";
import type { SimHost } from "@/sim-host/host";
import type { RunStore } from "@/studio/stores/run";
import { useStoreSelector } from "@/studio/stores/select";

/** What the run said about a source: `idle` before there is a run, `off` once the output is switched off. */
export type BenchStatus = "idle" | "off" | "on" | "not-modelled-yet" | "unknown-net" | "too-many";

type BenchHost = Pick<SimHost, "setInstrument" | "clearInstrument">;

/**
 * Keeps one bench source in step with the run: it is put in when the run is going and whenever the source changes, taken
 * out when the output is off or the panel goes away. A new run forgets every source, so the panel is remounted per run.
 */
export function useBenchSource(host: BenchHost, run: RunStore, id: string, source: InstrumentSource | null): BenchStatus {
  const going = useStoreSelector(run, (s) => s.phase === "running" || s.phase === "paused");
  const key = JSON.stringify(source);
  const [reply, setReply] = useState<{ key: string; status: BenchStatus } | null>(null);

  useEffect(() => {
    if (!going) return;
    let current = true;
    const wanted = JSON.parse(key) as InstrumentSource | null;
    if (wanted === null) host.clearInstrument(id).catch(() => undefined);
    else {
      host
        .setInstrument(id, wanted)
        .then((r) => current && setReply({ key, status: r.ok ? "on" : r.reason }))
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [host, id, going, key]);

  useEffect(() => () => void host.clearInstrument(id).catch(() => undefined), [host, id]);

  if (!going) return "idle";
  if (source === null) return "off";
  return reply?.key === key ? reply.status : "idle";
}

/** The latest reading of a source the run reports on; null until the first. */
export function useInstrumentReading(host: Pick<SimHost, "onEvent">, id: string): InstrumentReading | null {
  const [reading, setReading] = useState<InstrumentReading | null>(null);
  useEffect(
    () =>
      host.onEvent((e) => {
        const next = e.t === "frame" ? e.analog?.instruments?.[id] : undefined;
        if (next) setReading(next);
      }),
    [host, id],
  );
  return reading;
}
