import { useCallback, useRef, useSyncExternalStore } from "react";
import type { SimHost } from "@/sim-host/host";
import type { ProbeSpec, Reading, TraceChunk } from "@/sim/probe/tap";

interface Latest {
  reading: Reading | null;
  chunk: TraceChunk | null;
}

export function createProbeClient(host: Pick<SimHost, "probes">) {
  const latest = new Map<string, Latest>();
  const listeners = new Map<string, Set<() => void>>();
  const stops = new Map<string, () => void>();

  const notify = (id: string) => listeners.get(id)?.forEach((fn) => fn());

  const subscribeTo = (id: string) => (fn: () => void) => {
    const set = listeners.get(id) ?? new Set();
    listeners.set(id, set.add(fn));
    return () => void set.delete(fn);
  };

  const update = (id: string, next: Partial<Latest>) => {
    latest.set(id, { reading: null, chunk: null, ...latest.get(id), ...next });
    notify(id);
  };

  return {
    async add(spec: ProbeSpec): Promise<void> {
      // The first reading comes with the add, so the watch has to be there before it.
      const offReading = host.probes.watch(spec.id, (reading) => update(spec.id, { reading }));
      try {
        await host.probes.add(spec);
      } catch (err) {
        offReading();
        throw err;
      }
      const offChunks = host.probes.subscribe(spec.id, 0, (chunk) => update(spec.id, { chunk }));
      stops.set(spec.id, () => {
        offReading();
        offChunks();
      });
    },
    remove(id: string): void {
      stops.get(id)?.();
      stops.delete(id);
      latest.delete(id);
      host.probes.remove(id);
      notify(id);
    },
    useReading(id: string): Reading | null {
      return useSyncExternalStore(subscribeTo(id), () => latest.get(id)?.reading ?? null, () => null);
    },
    /** The newest chunk of each probe, in the order of `ids`; the same array comes back until one of them changes. */
    useChunkSet(ids: readonly string[]): readonly { id: string; chunk: TraceChunk | null }[] {
      const key = ids.join("\u0000");
      const last = useRef<readonly { id: string; chunk: TraceChunk | null }[]>([]);
      const subscribe = useCallback(
        (fn: () => void) => {
          const offs = key === "" ? [] : key.split("\u0000").map((id) => subscribeTo(id)(fn));
          return () => offs.forEach((off) => off());
        },
        [key],
      );
      const snapshot = () => {
        const next = key === "" ? [] : key.split("\u0000").map((id) => ({ id, chunk: latest.get(id)?.chunk ?? null }));
        if (next.length === last.current.length && next.every((x, i) => x.id === last.current[i].id && x.chunk === last.current[i].chunk)) return last.current;
        last.current = next;
        return next;
      };
      return useSyncExternalStore(subscribe, snapshot, () => last.current);
    },
  };
}
