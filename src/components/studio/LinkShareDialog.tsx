"use client";

import { useMemo, useState } from "react";
import { QrCode } from "@/components/realtime";
import { useTogetherT } from "@/components/realtime/messages";
import { Button, Callout, Dialog, IconButton, InlineStatus, TextInput, Toggle } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import type { Translate } from "@/i18n/translate";
import { getAppRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { scanSecrets } from "@/project/secret-scan";
import { noticeFor } from "@/studio/provenance-notice";
import { projectLink } from "@/studio/share-link";
import { UncheckedNotice } from "./UncheckedNotice";

type Rooms = Translate<Messages["studio"]["rooms"]>;

// A QR code holds about 2,900 bytes; past this the link is for copying only.
const QR_LIMIT = 2_000;

type Stage = { kind: "form" } | { kind: "notice"; count: number } | { kind: "making" } | { kind: "done"; link: string };

/**
 * Sharing on a copy of iynk with no server: the project goes inside the link. The dialog says what that means (nobody
 * stores it, so it can't be stopped), holds back a project that looks like it holds a key, and copies the link.
 */
export function LinkShareDialog({ open, onClose, doc, lang, t, studio }: { open: boolean; onClose(): void; doc: Project; lang: Locale; t: Rooms; studio: Messages["studio"] }) {
  const together = useTogetherT();
  const hits = useMemo(() => scanSecrets(doc), [doc]);
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");

  const close = () => {
    setStage({ kind: "form" });
    setChecked(false);
    setError(null);
    setCopy("idle");
    onClose();
  };

  const make = async () => {
    setStage({ kind: "making" });
    setError(null);
    const made = await projectLink(doc, getAppRegistry(), { origin: window.location.origin, lang });
    if (made.ok) return setStage({ kind: "done", link: made.link });
    setError(t(made.reason === "hasFiles" ? "share.linkHasFiles" : "share.tooLarge"));
    setStage({ kind: "form" });
  };

  const review = () => {
    const { show, count } = noticeFor(doc, "share-beyond-buddies");
    if (show) setStage({ kind: "notice", count });
    else void make();
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  };

  return (
    <Dialog open={open} onClose={close} title={t("share.title")} closeLabel={t("share.close")}>
      {stage.kind === "notice" ? (
        <UncheckedNotice
          count={stage.count}
          action="share-beyond-buddies"
          messages={studio}
          lang={lang}
          continueLabel={t("share.create")}
          onCancel={() => setStage({ kind: "form" })}
          onContinue={() => void make()}
        />
      ) : stage.kind === "done" ? (
        <div className="flex flex-col gap-3" data-testid="link-share-done">
          <InlineStatus tone="good" live>
            {t("share.done")}
          </InlineStatus>
          {together && stage.link.length <= QR_LIMIT ? <QrCode text={stage.link} label={t("share.linkQr")} t={together} /> : null}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <TextInput label={t("share.copy")} hideLabel readOnly value={stage.link} onFocus={(event) => event.currentTarget.select()} className="text-xs" />
            </div>
            <IconButton label={t("share.copy")} icon={copy === "done" ? "check" : "copy"} variant="solid" onClick={() => copyLink(stage.link)} />
          </div>
          <div className="min-h-6">
            {copy === "done" ? (
              <InlineStatus tone="good" live>
                {t("share.copied")}
              </InlineStatus>
            ) : copy === "failed" ? (
              <InlineStatus tone="bad" live>
                {t("share.copyFailed")}
              </InlineStatus>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Callout tone="note">{t("share.linkCarries")}</Callout>
          <Callout tone="warn">{t("share.linkWarning")}</Callout>
          {hits.length > 0 ? (
            <Callout tone="danger">
              <p>{t("share.secretWarning")}</p>
              <ul className="mt-2 list-disc ps-4">
                {hits.map((hit) => (
                  <li key={`${hit.field}:${hit.rule}`}>{t("share.secretField", { field: hit.field })}</li>
                ))}
              </ul>
              <Toggle className="mt-2" label={t("share.secretAck")} checked={checked} onChange={setChecked} />
            </Callout>
          ) : null}
          {error ? (
            <InlineStatus tone="bad" live>
              {error}
            </InlineStatus>
          ) : null}
          <Button variant="primary" disabled={(hits.length > 0 && !checked) || stage.kind === "making"} aria-busy={stage.kind === "making"} onClick={review}>
            {t("share.create")}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
