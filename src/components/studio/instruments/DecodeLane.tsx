import type { Annotation } from "@/sim/decode";
import { formatValue } from "@/studio/units";

export const NOTE_LANE_H = 20;
const CHAR_PX = 6;
const MARK: Record<Annotation["kind"], string> = { start: "S", stop: "P", ack: "A", nack: "N", data: "", address: "" };

/** The words for a mark that carries no value, and for an error flag on one that does. */
export type NoteWords = Record<"start" | "stop" | "ack" | "nack" | "data" | "address" | "framing" | "parityError" | "write" | "read", string>;

export function noteText(a: Annotation, words: NoteWords): string {
  if (a.kind === "data") return a.error ? `${a.label} (${a.error === "framing" ? words.framing : words.parityError})` : a.label;
  if (a.kind === "address") return a.label.replace(/ [WR]$/, ` ${a.write ? words.write : words.read}`);
  return words[a.kind];
}

export const lanesOf = (notes: readonly Annotation[]): string[] => [...new Set(notes.map((a) => a.lane))];

interface LanesProps {
  notes: readonly Annotation[];
  top: number;
  x: (tNs: number) => number;
  left: number;
  words: NoteWords;
}

/** One row per lane, as shapes inside the capture's svg: boxes for bytes, small letters for starts, stops and acknowledges. */
export function DecodeLanes({ notes, top, x, left, words }: LanesProps) {
  const lanes = lanesOf(notes);
  return (
    <>
      {lanes.map((lane, row) => {
        const y = top + row * NOTE_LANE_H;
        return (
          <g key={lane}>
            <text x={left - 4} y={y + NOTE_LANE_H / 2 + 4} textAnchor="end" className="fill-console-muted font-sans text-xs">
              {lane}
            </text>
            {notes
              .filter((a) => a.lane === lane)
              .map((a, i) => {
                const x0 = x(a.startNs);
                const text = noteText(a, words);
                if (a.kind !== "data" && a.kind !== "address") {
                  return (
                    <text key={i} x={x0} y={y + NOTE_LANE_H / 2 + 4} textAnchor="middle" className="fill-console-accent font-mono text-xs">
                      {MARK[a.kind]}
                      <title>{text}</title>
                    </text>
                  );
                }
                const width = Math.max(2, x(a.endNs) - x0);
                const failed = a.kind === "data" && a.error !== undefined;
                const label = failed ? `! ${a.label}` : a.label;
                return (
                  <g key={i}>
                    <rect x={x0} y={y + 2} width={width} height={NOTE_LANE_H - 4} rx="3" fill="none" stroke={failed ? "#ff8a7a" : "#7cc4ff"} strokeDasharray={failed ? "3 2" : undefined} />
                    {width >= label.length * CHAR_PX + 4 ? (
                      <text x={x0 + width / 2} y={y + NOTE_LANE_H / 2 + 4} textAnchor="middle" className="fill-console-ink font-mono text-xs">
                        {label}
                      </text>
                    ) : null}
                    <title>{text}</title>
                  </g>
                );
              })}
          </g>
        );
      })}
    </>
  );
}

interface TableProps {
  notes: readonly Annotation[];
  words: NoteWords;
  heads: { time: string; lane: string; kind: string; value: string };
  /** Rows shown, newest last. */
  limit: number;
}

export function DecodeTable({ notes, words, heads, limit }: TableProps) {
  const shown = notes.slice(-limit);
  return (
    <div className="max-h-48 overflow-auto">
      <table className="w-full text-start font-mono text-xs tabular-nums">
        <thead>
          <tr>
            {[heads.time, heads.lane, heads.kind, heads.value].map((h) => (
              <th key={h} scope="col" className="px-2 py-1 text-start">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((a, i) => (
            <tr key={notes.length - shown.length + i}>
              <td className="px-2 py-1">{formatValue(a.startNs / 1e9, "second")}</td>
              <td className="px-2 py-1">{a.lane}</td>
              <td className="px-2 py-1">{words[a.kind]}</td>
              <td className="px-2 py-1">{a.kind === "data" || a.kind === "address" ? noteText(a, words) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
