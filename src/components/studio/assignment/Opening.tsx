"use client";

import { Callout, Skeleton, buttonClass } from "@/components/ui";
import type { Messages } from "@/i18n/namespaces";

type Props = { state: "opening" | "failed"; strings: Messages["assignment"]["open"] };

/** What the page shows while an assignment link is read, and when it cannot be. */
export function Opening({ state, strings }: Props) {
  if (state === "opening") {
    return (
      <div role="status" aria-busy="true" aria-label={strings.opening} className="mt-8">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  return (
    <div className="mt-8 flex max-w-xl flex-col items-start gap-4">
      <Callout tone="warn" live>
        {strings.failed}
      </Callout>
      <a href="#/" className={buttonClass("secondary")}>
        {strings.back}
      </a>
    </div>
  );
}
