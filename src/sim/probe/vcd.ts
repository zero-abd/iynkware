import { type Wire, toEdges } from "../decode/edges.ts";

export interface VcdChannel extends Wire {
  name: string;
}

const FIRST_ID = 33;
const ID_RADIX = 94;

/** The printable-ASCII identifier of the n-th variable, as the VCD format wants: `!` to `~`, then two characters. */
function idOf(n: number): string {
  let id = "";
  let rest = n;
  do {
    id = String.fromCharCode(FIRST_ID + (rest % ID_RADIX)) + id;
    rest = Math.floor(rest / ID_RADIX) - 1;
  } while (rest >= 0);
  return id;
}

const safe = (name: string): string => name.replace(/\s+/g, "_") || "ch";

/**
 * A Value Change Dump of digital lines, readable by GTKWave and PulseView. Times are whole nanoseconds. Each line is
 * cut to 0 and 1 at the middle of its own swing; only changes are written.
 */
export function toVcd(channels: readonly VcdChannel[], meta: { docHash: string; seed: number }): string {
  const edges = channels.map((c) => toEdges(c));
  const ids = channels.map((_, i) => idOf(i));
  const changes = new Map<number, string[]>();
  edges.forEach((e, i) =>
    e.t.forEach((t, k) => {
      const at = Math.round(t);
      changes.set(at, [...(changes.get(at) ?? []), `${e.level[k]}${ids[i]}`]);
    }),
  );
  const lines = [
    `$comment project ${meta.docHash.replace(/\s+/g, " ")}, seed ${meta.seed}. Edge times follow the simulator's clock. $end`,
    "$version iynk $end",
    "$timescale 1 ns $end",
    "$scope module iynk $end",
    ...channels.map((c, i) => `$var wire 1 ${ids[i]} ${safe(c.name)} $end`),
    "$upscope $end",
    "$enddefinitions $end",
  ];
  [...changes.keys()]
    .sort((a, b) => a - b)
    .forEach((at, index) => {
      lines.push(`#${at}`);
      if (index === 0) lines.push("$dumpvars");
      lines.push(...changes.get(at)!);
      if (index === 0) lines.push("$end");
    });
  return `${lines.join("\n")}\n`;
}
