"use client";

import { Callout, Select } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import type { BenchStatus } from "@/studio/run/bench";

export interface ReturnOption {
  value: string;
  label: string;
}

export interface BenchProps {
  editable: boolean;
  status: BenchStatus | "no-ground" | "same-net";
  messages: Messages["instruments"];
  lang: Locale;
  /** The nets a return lead can go on; the first entry is ground. */
  returns: readonly ReturnOption[];
  returnValue: string;
  onReturn(value: string): void;
}

const KEY = {
  idle: "idle",
  on: "on",
  off: "off",
  "not-modelled-yet": "notModelled",
  "unknown-net": "unknownNet",
  "too-many": "tooMany",
  "no-ground": "noGround",
  "same-net": "sameNet",
} as const satisfies Record<BenchProps["status"], string>;

const WORKING: ReadonlySet<BenchProps["status"]> = new Set(["idle", "on", "off"]);

export function StatusLine({ status, messages, lang }: Pick<BenchProps, "messages" | "lang"> & { status: BenchProps["status"] }) {
  const t = createTranslator(lang, messages, `${lang}/instruments`);
  return WORKING.has(status) ? (
    <p role="status" className="text-sm text-muted">
      {t(`bench.status.${KEY[status]}`)}
    </p>
  ) : (
    <Callout tone="warn" live>
      {t(`bench.status.${KEY[status]}`)}
    </Callout>
  );
}

export function ReturnSelect({ returns, returnValue, onReturn, editable, messages, lang }: Pick<BenchProps, "returns" | "returnValue" | "onReturn" | "editable" | "messages" | "lang">) {
  const t = createTranslator(lang, messages, `${lang}/instruments`);
  return (
    <Select label={t("bench.returnLead")} value={returnValue} disabled={!editable} onChange={(e) => onReturn(e.target.value)}>
      {returns.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </Select>
  );
}
