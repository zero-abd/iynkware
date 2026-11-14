"use client";

import { cx } from "@/components/ui";
import type { Bin } from "@/sim/analog/spread";

export type BarTone = "plain" | "inside" | "mixed" | "outside";

export interface HistogramProps {
  label: string;
  bins: readonly Bin[];
  /** The text of the lowest and highest end of the axis. */
  ends: { low: string; high: string };
  tone(bin: Bin): BarTone;
  /** The accessible name of a bar, which says how many builds it holds and from where to where. */
  barLabel(bin: Bin): string;
  onOpen(bin: Bin): void;
  disabled?: boolean;
}

const FILL: Record<BarTone, string> = { plain: "bg-accent", inside: "bg-good", mixed: "bg-warn", outside: "bg-muted" };

/** Bars of how many builds read in each band of values. A bar is a button: it opens one of its builds. */
export function Histogram({ label, bins, ends, tone, barLabel, onOpen, disabled }: HistogramProps) {
  const most = Math.max(1, ...bins.map((b) => b.builds.length));
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <div className="flex h-32 items-end gap-1 border-b border-rule">
        {bins.map((bin) => {
          const share = (bin.builds.length / most) * 100;
          if (bin.builds.length === 0) return <span key={bin.lo} aria-hidden="true" className="h-full min-w-0 flex-1" />;
          return (
            <button
              key={bin.lo}
              type="button"
              disabled={disabled}
              aria-label={barLabel(bin)}
              title={barLabel(bin)}
              data-testid="build-bar"
              onClick={() => onOpen(bin)}
              className="group flex h-full min-w-0 flex-1 items-end rounded-t-md outline-none focus-visible:outline-2 focus-visible:outline-(--focus) disabled:cursor-not-allowed"
            >
              <span className={cx("block w-full rounded-t-md motion-fade group-hover:opacity-80", FILL[tone(bin)])} style={{ height: `${share}%` }} />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>{ends.low}</span>
        <span>{ends.high}</span>
      </div>
    </div>
  );
}
