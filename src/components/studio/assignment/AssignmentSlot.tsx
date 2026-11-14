"use client";

import dynamic from "next/dynamic";
import type { Locale } from "@/i18n/config";
import type { StudioMessages } from "@/i18n/namespaces";
import { ASSIGNMENT_EXT } from "@/studio/assignment/types";
import type { DocStore } from "@/studio/stores/doc";
import { useStoreSelector } from "@/studio/stores/select";

// The classroom code loads when a project is an assignment or the person makes one, so the editor does not carry it otherwise.
const AssignmentBar = dynamic(() => import("./AssignmentBar").then((m) => m.AssignmentBar), { ssr: false });
const MakeAssignment = dynamic(() => import("./MakeAssignment").then((m) => m.MakeAssignment), { ssr: false });

type Props = { doc: DocStore; messages: StudioMessages; lang: Locale; making: boolean; onCloseMaking(): void };

export function AssignmentSlot({ doc, messages, lang, making, onCloseMaking }: Props) {
  const isAssignment = useStoreSelector(doc, (s) => s.state.ext !== undefined && ASSIGNMENT_EXT in s.state.ext);
  const readOnly = useStoreSelector(doc, (s) => s.readOnly);
  return (
    <>
      {isAssignment && !readOnly ? <AssignmentBar doc={doc} messages={messages} lang={lang} /> : null}
      {making ? <MakeAssignment open onClose={onCloseMaking} doc={doc} messages={messages} lang={lang} /> : null}
    </>
  );
}
