"use client";

import { IconButton } from "@/components/ui";
import type { Messages } from "@/i18n/namespaces";
import { runCommand, type CommandCtx } from "@/studio/commands";
import { useStoreSelector } from "@/studio/stores/select";

export interface TouchBarProps extends CommandCtx {
  messages: Messages["studio"]["canvas"]["touch"];
}

/**
 * Zoom, fit, turn and delete for a screen with no keyboard. They run the same commands the keys do, so a part
 * is turned, deleted and announced the same way. A mouse has the keys and the wheel, so the bar shows on touch only.
 */
export function TouchBar({ doc, session, ui, messages }: TouchBarProps) {
  const picked = useStoreSelector(session, (s) => s.selection.length > 0);
  const readOnly = useStoreSelector(doc, (s) => s.readOnly);
  const run = (id: string) => () => void runCommand(id, { doc, session, ui });
  const editing = picked && !readOnly;
  return (
    <div role="toolbar" aria-label={messages.label} className="pointer-events-auto absolute end-2 top-2 hidden flex-col gap-1 rounded-lg border border-rule bg-paper p-1 [@media(pointer:coarse)]:flex">
      <IconButton label={messages.zoomIn} icon="plus" tooltipSide="top" onClick={run("view.zoomIn")} />
      <IconButton label={messages.zoomOut} icon="minus" tooltipSide="top" onClick={run("view.zoomOut")} />
      <IconButton label={messages.fit} icon="expand" tooltipSide="top" onClick={run("view.fit")} />
      {editing ? (
        <>
          <IconButton label={messages.rotate} icon="rotate-right" tooltipSide="top" onClick={run("place.rotate")} />
          <IconButton label={messages.delete} icon="trash" tooltipSide="top" onClick={run("edit.delete")} />
        </>
      ) : null}
    </div>
  );
}
