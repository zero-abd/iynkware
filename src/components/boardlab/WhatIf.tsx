"use client";

import type { FigureHandle } from "@/components/figure/protocol";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import type { FailureMode } from "@/content/schema";
import type { BoardLabStore } from "@/lib/boardlab/store";
import { lessonFailures, repairFailure, triggerFailure } from "./FailurePanel";
import { useText } from "./text";
import { useLab } from "./useLab";

/**
 * Break it, one click from the figure: the lesson's own fault (or the board's first) happens for real, and
 * `onOpen` brings up the tab that says why. While a fault is on, the same spot repairs it.
 */
export function WhatIf({
  store,
  failures,
  figure,
  circuit,
  onOpen,
}: {
  store: BoardLabStore;
  failures: FailureMode[];
  figure: () => FigureHandle | null;
  circuit: string | null;
  onOpen: () => void;
}) {
  const { t, tc } = useText();
  const activeId = useLab(store, (s) => s.fault);
  const { mine, rest } = lessonFailures(failures, circuit);
  const pick = mine[0] ?? rest[0];
  if (!pick) return null;

  const active = activeId ? failures.find((f) => f.id === activeId) : undefined;
  if (active) {
    return (
      <Button size="sm" variant="danger" className="shrink-0 whitespace-nowrap" onClick={() => repairFailure(store, active)} data-testid="what-if">
        <Icon name="check" size={16} aria-hidden="true" />
        {t("whatIf.repair", { fault: tc(active.title) })}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      outline
      className="shrink-0 whitespace-nowrap"
      onClick={() => {
        triggerFailure(store, figure(), pick);
        onOpen();
      }}
      data-testid="what-if"
    >
      <Icon name="bolt" size={16} aria-hidden="true" />
      {t("whatIf.break", { fault: tc(pick.title) })}
    </Button>
  );
}
