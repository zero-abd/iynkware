"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LabDockProps } from "@/components/dock/types";
import { PanelSkeleton } from "@/components/search/PanelSkeleton";
import { Button, Icon, IconButton, Sheet, useIsClient } from "@/components/ui";
import { useCommonT } from "@/i18n/client";

// Phones, including 390×844. Matches the header's md breakpoint.
const PHONE_QUERY = "(max-width: 767px)";

const loadBody = () => import("@/components/dock/LabDockBody").then((m) => m.LabDockBody);
const LabDockBody = dynamic(loadBody, { loading: () => <PanelSkeleton /> });

/**
 * Build it for real on every lab page (Hardware when its
 * flag is on). Rendered where the page puts it (the
 * workspace bar) as a "Lab tools" button: on a desk it opens a drawer along
 * the right edge that leaves the figure in view, on a phone a bottom sheet.
 */
export function LabDock<S, A extends { type: string }>(props: LabDockProps<S, A>) {
  const t = useCommonT();
  const isClient = useIsClient();
  const drawerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  // Start on the desktop layout so the server HTML matches hydration. The real layout is applied on the next turn.
  const [phone, setPhone] = useState(false);

  const [isOpen, setOpen] = useState(false);
  // Once opened the body stays mounted, so the chosen tab and the panels already fetched survive a close.
  const [opened, setOpened] = useState(false);
  if (isOpen && !opened) setOpened(true);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    const apply = () => setPhone(mq.matches);
    const timer = window.setTimeout(apply, 0);
    mq.addEventListener("change", apply);
    return () => {
      window.clearTimeout(timer);
      mq.removeEventListener("change", apply);
    };
  }, []);

  const body = opened ? <LabDockBody {...props} open={isOpen} phone={phone} drawerRef={drawerRef} /> : null;

  const trigger = (
    <Button
      ref={triggerRef}
      data-testid="lab-dock-trigger"
      variant="secondary"
      size="sm"
      aria-label={t("dock.open")}
      aria-haspopup={phone ? "dialog" : undefined}
      aria-expanded={isOpen}
      aria-controls={phone ? undefined : drawerId}
      aria-pressed={!phone && isOpen ? true : undefined}
      onPointerEnter={() => void loadBody()}
      onFocus={() => void loadBody()}
      onClick={() => {
        if (isOpen && !phone) return close();
        setOpen(true);
      }}
      className="w-fit shrink-0 whitespace-nowrap max-sm:size-11 max-sm:px-0"
    >
      <Icon name="tools" size={20} />
      <span className="max-sm:sr-only">{t("dock.label")}</span>
    </Button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={isOpen} onClose={close} title={t("dock.label")} closeLabel={t("dock.close")} side="bottom" height="full">
          <div data-testid="lab-dock" data-ready="true" data-layout="phone">
            {body}
          </div>
        </Sheet>
      </>
    );
  }

  const onDrawerKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    close();
  };

  return (
    <>
      {trigger}
      {isClient
        ? createPortal(
            <aside
              ref={drawerRef}
              id={drawerId}
              aria-label={t("dock.label")}
              data-testid="lab-dock"
              data-ready="true"
              data-layout="desk"
              hidden={!isOpen}
              onKeyDown={onDrawerKey}
              className="fixed end-0 top-(--header-h) bottom-0 z-dock flex w-[min(var(--dock-w),calc(100vw-3rem))] flex-col rounded-s-2xl bg-raised shadow-lg animate-slide-in-end"
            >
              <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-rule ps-4 pe-2">
                <Icon name="tools" size={20} className="text-muted" />
                <h2 className="min-w-0 flex-1 text-lg font-semibold">{t("dock.label")}</h2>
                <IconButton icon="close" size="sm" label={t("dock.close")} onClick={close} />
              </div>
              <div className="min-h-0 flex-1">{body}</div>
            </aside>,
            document.body,
          )
        : null}
    </>
  );
}
