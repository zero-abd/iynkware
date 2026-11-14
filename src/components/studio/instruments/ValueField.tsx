"use client";

import { useState } from "react";
import { TextInput } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import { formatValue, parseValue, type Quantity } from "@/studio/units";

interface ValueFieldProps {
  label: string;
  value: number;
  unit: Quantity;
  min: number;
  max: number;
  disabled?: boolean;
  messages: Messages["instruments"];
  lang: Locale;
  onValue(value: number): void;
}

/** A value typed with a prefix (`1k`, `500m`) that is taken on Enter or when the field is left, or refused with the range. */
export function ValueField({ label, value, unit, min, max, disabled, messages, lang, onValue }: ValueFieldProps) {
  const t = createTranslator(lang, messages, `${lang}/instruments`);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const shown = formatValue(value, unit);

  function settle() {
    if (draft === null) return;
    const parsed = draft === shown ? ({ ok: true, value } as const) : parseValue(draft, unit, { min, max });
    if (parsed.ok) {
      setError(undefined);
      setDraft(null);
      if (parsed.value !== value) onValue(parsed.value);
      return;
    }
    setError(parsed.reason === "range" ? t("value.range", { min: formatValue(min, unit), max: formatValue(max, unit) }) : t(`value.${parsed.reason}`));
  }

  return (
    <TextInput
      label={label}
      error={error}
      inputMode="decimal"
      className="font-mono tabular-nums"
      value={draft ?? shown}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === "Enter") settle();
        if (e.key === "Escape") {
          setDraft(null);
          setError(undefined);
        }
      }}
    />
  );
}
