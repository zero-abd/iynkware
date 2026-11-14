"use client";

import { TextInput } from "@/components/ui";

type Props = { label: string; value: string; onChange(text: string): void; error?: string };

/** A number kept as the text the person typed, so a half typed value is not rewritten under them. Reading it is the caller's job. */
export function NumberInput({ label, value, onChange, error }: Props) {
  return <TextInput label={label} inputMode="decimal" className="font-mono tabular-nums" value={value} error={error} onChange={(e) => onChange(e.target.value)} />;
}

export const numberOf = (text: string): number | null => {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
};
