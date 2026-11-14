"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/IconButton";
import { FIRST_RUN_PARAM } from "@/lib/boardlab/first-run";
import type { BoardLabStore } from "@/lib/boardlab/store";
import { useText } from "./text";

const SEEN_KEY = "iynk:first-run:v1";

type Stage = "edit" | "done" | "closed";

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // private mode: the tip can come back next visit, which is harmless
  }
}

const invited = () => new URLSearchParams(window.location.search).get(FIRST_RUN_PARAM) === "1" && !seen();
const notInvited = () => false;
const still = () => () => {};

/**
 * The first visit's one nudge: change the blink timing and press Run. Once a run starts on edited code, the card
 * says so and points at Break it. It shows only when the landing page sent the visitor here, and only until it is
 * closed.
 */
export function FirstRunCoach({ store, onBreakIt }: { store: BoardLabStore; onBreakIt?: () => void }) {
  const { t } = useText();
  const show = useSyncExternalStore(still, invited, notInvited);
  const [stage, setStage] = useState<Stage>("edit");

  useEffect(() => {
    if (!show) return;
    // typing in the editor and moving the lesson's sliders both change the code, so either counts
    const start = store.getState().code;
    let last = store.getState().run.status;
    return store.subscribe(() => {
      const { run, code } = store.getState();
      if (run.status === "running" && last !== "running" && code !== start) setStage((s) => (s === "edit" ? "done" : s));
      last = run.status;
    });
  }, [store, show]);

  if (!show || stage === "closed") return null;
  const close = () => {
    markSeen();
    setStage("closed");
  };

  return (
    <div role="status" aria-live="polite" className="m-3 mb-0 flex items-start gap-3 rounded-xl border border-accent bg-surface p-3 shadow-sm" data-testid="first-run-coach">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken">
        <Icon name={stage === "done" ? "check" : "spark"} size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t(stage === "done" ? "tryIt.doneTitle" : "tryIt.title")}</p>
        <p className="mt-1 text-sm text-muted text-pretty">{t(stage === "done" ? "tryIt.done" : "tryIt.edit")}</p>
        {stage === "done" && onBreakIt ? (
          <Button
            size="sm"
            variant="primary"
            className="mt-3"
            onClick={() => {
              close();
              onBreakIt();
            }}
          >
            {t("tryIt.breakIt")}
          </Button>
        ) : null}
      </div>
      <IconButton icon="close" size="sm" label={t("tryIt.close")} onClick={close} />
    </div>
  );
}
