"use client";

import { useMemo } from "react";
import { Icon } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator, type MessageKey } from "@/i18n/translate";
import { FIDELITY_PREFIX, type Problem } from "@/studio/problems";

export interface BurntNoticeProps {
  /** The problems of the parts that burnt, from `isBurnt`. */
  problems: readonly Problem[];
  messages: Messages["fidelity"];
  lang: Locale;
}

/** Says above the canvas, on one line a part, which part burnt and on what number; the Problems list holds the whole text. */
export function BurntNotice({ problems, messages, lang }: BurntNoticeProps) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/fidelity`), [lang, messages]);
  if (problems.length === 0) return null;
  return (
    <div role="status" className="flex shrink-0 items-start gap-2 bg-bad-bg px-3 py-1 text-sm">
      <Icon name="danger" size={16} className="mt-1 shrink-0 text-bad" />
      <ul className="flex min-w-0 flex-1 flex-col" data-testid="burnt-notice">
        {problems.map((p) => {
          const text = t(p.titleKey.slice(FIDELITY_PREFIX.length) as MessageKey<Messages["fidelity"]>, p.args);
          return (
            <li key={p.id} title={text} className="truncate">
              {text}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
