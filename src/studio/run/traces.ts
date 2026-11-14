import { useEffect, useRef, useState } from "react";
import type { TraceChunk } from "@/sim/probe/tap";
import type { createProbeClient } from "./probes";

type ProbeClient = ReturnType<typeof createProbeClient>;

export const DEFAULT_CAPACITY = 4096;

export interface ProbeWant {
  id: string;
  /** The simulator's node; nothing is probed while it is undefined. */
  net: string | undefined;
  /** The least time between two samples in a stepped run; absent, every step. */
  sampleNs?: number;
}

/** Probes on nets for the length of the panel's life; a new run clears all probes, so the panel is remounted and adds them again. */
export function useProbes(client: ProbeClient, wants: readonly ProbeWant[]): void {
  const key = JSON.stringify(wants);
  useEffect(() => {
    const live = (JSON.parse(key) as ProbeWant[]).filter((w): w is ProbeWant & { net: string } => w.net !== undefined);
    for (const { id, net, sampleNs } of live) client.add({ id, kind: "voltage", target: net, capacity: DEFAULT_CAPACITY, envelope: false, ...(sampleNs !== undefined && { sampleNs }) }).catch(() => undefined);
    return () => live.forEach(({ id }) => client.remove(id));
  }, [client, key]);
}

export function appendChunk(prev: TraceChunk | null, next: TraceChunk, capacity: number): TraceChunk {
  if (!prev) return next;
  const keep = Math.max(0, Math.min(prev.t.length, capacity - next.t.length));
  const join = (a: Float64Array, b: Float64Array) => {
    const out = new Float64Array(keep + b.length);
    out.set(a.subarray(a.length - keep));
    out.set(b, keep);
    return out;
  };
  return { ...next, from: prev.from, t: join(prev.t, next.t), v: join(prev.v, next.v), dropped: prev.dropped + next.dropped + Math.max(0, prev.t.length - keep) };
}

/** The samples each probe has sent, kept up to `capacity` per probe. */
export function useTraces(client: ProbeClient, ids: readonly string[], capacity: number): Record<string, TraceChunk> {
  const chunks = client.useChunkSet(ids);
  const [traces, setTraces] = useState<Record<string, TraceChunk>>({});
  const seen = useRef(new Map<string, TraceChunk>());
  useEffect(() => {
    for (const { id, chunk } of chunks) {
      if (!chunk || seen.current.get(id) === chunk) continue;
      seen.current.set(id, chunk);
      setTraces((prev) => ({ ...prev, [id]: appendChunk(prev[id] ?? null, chunk, capacity) }));
    }
  }, [chunks, capacity]);
  return traces;
}
