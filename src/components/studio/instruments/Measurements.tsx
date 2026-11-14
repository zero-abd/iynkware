import { measure, type Trace } from "@/sim/probe/measure";
import { formatValue } from "@/studio/units";

export interface MeasureLabels {
  title: string;
  freq: string;
  vpp: string;
  vrms: string;
  duty: string;
  noValue: string;
}

interface Row {
  id: string;
  name: string;
  trace: Trace;
}

const dash = "-";

/** Four significant figures: a reading taken from sampled edges is not good to more. */
const show = (value: number, unit: "hertz" | "volt"): string => formatValue(Number(value.toPrecision(4)), unit);

/** Frequency, peak to peak, RMS and duty of each analog channel over the window on screen. */
export function Measurements({ rows, labels, testId }: { rows: readonly Row[]; labels: MeasureLabels; testId: string }) {
  return (
    <div className="overflow-x-auto" data-testid={`${testId}-measure`}>
      <table className="w-full text-start text-sm tabular-nums">
        <caption className="sr-only">{labels.title}</caption>
        <thead>
          <tr>
            <td />
            {[labels.freq, labels.vpp, labels.vrms, labels.duty].map((h) => (
              <th key={h} scope="col" className="px-2 py-1 text-start font-medium text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, name, trace }, n) => {
            const m = measure(trace);
            return (
              <tr key={id}>
                <th scope="row" className="px-2 py-1 text-start font-medium">
                  {name}
                </th>
                {m === null ? (
                  <td colSpan={4} className="px-2 py-1 text-muted">
                    {labels.noValue}
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-1 font-mono" data-testid={`${testId}-freq-${n}`}>
                      {m.freqHz === null ? dash : show(m.freqHz, "hertz")}
                    </td>
                    <td className="px-2 py-1 font-mono">{show(m.vppVolts, "volt")}</td>
                    <td className="px-2 py-1 font-mono">{show(m.vrmsVolts, "volt")}</td>
                    <td className="px-2 py-1 font-mono">{m.dutyPercent === null ? dash : `${m.dutyPercent.toFixed(1)} %`}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
