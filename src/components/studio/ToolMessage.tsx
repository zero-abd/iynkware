"use client";

import { useEffect, useMemo, useState } from "react";
import type { Locale } from "@/i18n/config";
import { useStoreSelector } from "@/studio/stores/select";
import type { SessionState, StatusMessage } from "@/studio/stores/session";
import type { Store } from "@/studio/stores/select";
import { createStatusText, type StatusMessages } from "./statusText";

export interface ToolMessageProps {
  session: Store<SessionState>;
  messages: StatusMessages;
  lang: Locale;
}

const SHOWN_MS = 4000;

/** What the last tool did or refused, in words, on the canvas where the person is looking. It lets go after a while. */
export function ToolMessage({ session, messages, lang }: ToolMessageProps) {
  const reported = useStoreSelector(session, (s) => s.status);
  const [expired, setExpired] = useState<StatusMessage | null>(null);
  const text = useMemo(() => createStatusText(lang, messages), [lang, messages]);

  useEffect(() => {
    if (!reported) return;
    const timer = setTimeout(() => setExpired(reported), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [reported]);

  return (
    <p
      role="status"
      className="pointer-events-none absolute start-1/2 top-2 max-w-[90%] -translate-x-1/2 rounded-lg border border-rule bg-paper px-3 py-2 text-sm text-ink text-pretty empty:hidden"
    >
      {reported === expired ? null : text(reported)}
    </p>
  );
}
