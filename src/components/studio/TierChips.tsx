import type { Translate } from "@/i18n/translate";
import type { Messages } from "@/i18n/namespaces";
import type { ValidationRecord } from "@/sim/registry/types";

export type FidelityT = Translate<Messages["fidelity"]>;

/** The newest passing record a person can lean on: a bench run, an oracle or an analytic case. */
export function pickValidation(records: readonly ValidationRecord[]): ValidationRecord | undefined {
  return records
    .filter((r) => r.status === "pass" && (r.kind === "oracle" || r.kind === "analytic" || r.kind === "bench"))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function validationLine(v: ValidationRecord | undefined, t: FidelityT): string {
  if (!v) return t("validation.none");
  if (v.kind === "bench") return t("validation.bench", { n: v.result.n });
  return t("validation.oracle", { pct: v.result.worst, oracle: v.oracle?.name ?? v.dataset, n: v.result.n, date: v.date });
}
