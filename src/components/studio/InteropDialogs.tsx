"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { version } from "@/lib/version";
import { Button, Callout, Dialog, Icon, TextArea } from "@/components/ui";
import { utf8Encode } from "@/core/canonical";
import { cryptoRandom, newProjectId } from "@/core/ids";
import { sha256Hex } from "@/core/sha256";
import { writeIynk } from "@/export/iynk";
import { lossCodes, type LossItem } from "@/export/loss";
import type { WokwiError, WokwiFile, WokwiImport } from "@/export/wokwi/import";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator, type MessageKey, type Translate } from "@/i18n/translate";
import { getAppRegistry } from "@/parts/builtin";
import { navigate } from "@/studio/router";
import type { DocStore } from "@/studio/stores/doc";
import { LOCAL_ACTOR } from "@/studio/templates";
import { download, fileStem } from "./download";
import { analyserFor } from "./inoAnalyser";
import { describeInterop } from "./interopLoss";
import { LossReport } from "./LossReport";
import type { Services } from "./wiring/services";

export type InteropRequest = "wokwi" | "kicad" | "spice";

type Studio = Messages["studio"];

type Props = {
  request: InteropRequest;
  doc: DocStore;
  services: Services;
  strings: Studio;
  lang: Locale;
  onClose(): void;
};

type Shared = {
  t: Translate<Studio>;
  strings: Studio;
  lang: Locale;
  describeItem: (item: LossItem) => string | undefined;
  onClose(): void;
};

const ACCEPT = ".json,.ino,.h,.hpp,.c,.cpp,.py,.txt,.zip";
const ERROR_KEY: Record<WokwiError["code"], string> = {
  "no-diagram": "noDiagram",
  "bad-zip": "badZip",
  "too-many-files": "tooMany",
  "too-big": "tooBig",
  "bad-json": "badJson",
  "not-a-diagram": "notDiagram",
  "too-many-parts": "tooManyParts",
  sketch: "sketch",
  project: "project",
};

const key = (path: string) => path as MessageKey<Studio>;

export default function InteropDialogs({ request, doc, services, strings, lang, onClose }: Props) {
  const t = useMemo(() => createTranslator(lang, strings, `${lang}/studio`), [lang, strings]);
  const shared: Shared = { t, strings, lang, describeItem: (item) => describeInterop(item, t), onClose };
  return request === "wokwi" ? <WokwiImportDialog {...shared} services={services} /> : <ExportDialog {...shared} kind={request} doc={doc} />;
}

function WokwiImportDialog({ t, strings, lang, describeItem, onClose, services }: Shared & { services: Services }) {
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [diagram, setDiagram] = useState("");
  const [sketch, setSketch] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [review, setReview] = useState<WokwiImport | null>(null);

  async function read(files: WokwiFile[]) {
    setBusy(true);
    setProblem(null);
    try {
      const { importWokwi } = await import("@/export/wokwi/import");
      const result = importWokwi(files, {
        id: newProjectId(Date.now(), cryptoRandom),
        now: new Date().toISOString(),
        locale: lang,
        actor: LOCAL_ACTOR,
        registry: getAppRegistry(),
        title: t("interop.wokwi.projectTitle"),
        analyse: analyserFor(),
      });
      if (result.ok) setReview(result.value);
      else setProblem(t(key(`interop.wokwi.errors.${ERROR_KEY[result.error.code]}`)));
    } catch {
      setProblem(t("interop.wokwi.errors.readFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function pickFiles(list: FileList | File[]) {
    const picked = [...list];
    if (picked.length === 0) return;
    try {
      await read(await Promise.all(picked.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))));
    } catch {
      setProblem(t("interop.wokwi.errors.readFailed"));
    }
  }

  async function create() {
    if (!review || busy) return;
    setBusy(true);
    try {
      const outcome = await services.files.importBytes(writeIynk(review.project), `${review.project.meta.title}.iynk`);
      if (!outcome.ok) throw new Error(outcome.error.message);
      onClose();
      navigate({ kind: "project", id: outcome.id, autorun: false });
    } catch {
      setProblem(strings.row.failed);
      setBusy(false);
    }
  }

  const failure = problem ? (
    <Callout tone="danger" live>
      {problem}
    </Callout>
  ) : null;

  return (
    <Dialog open onClose={onClose} title={t("interop.wokwi.title")} closeLabel={strings.layout.close} size="lg">
      {review ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-pretty">{t("interop.wokwi.summary", { imported: review.imported, skipped: review.notImported })}</p>
          {failure}
          <LossReport strings={strings} lang={lang} loss={review.loss} describeItem={describeItem} onConfirm={() => void create()} onCancel={() => setReview(null)} confirmLabel={t("interop.wokwi.confirm")} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-pretty text-muted">{t("interop.wokwi.lede")}</p>
          <section
            aria-label={t("interop.wokwi.drop")}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void pickFiles(event.dataTransfer.files);
            }}
            className={`flex flex-wrap items-center gap-3 rounded-2xl border border-dashed p-4 motion-fade ${dragging ? "border-ink bg-hover" : "border-rule"}`}
          >
            <input
              ref={picker}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="wokwi-files"
              onChange={(event) => {
                void pickFiles(event.target.files ?? []);
                event.target.value = "";
              }}
            />
            <Button variant="secondary" busy={busy} onClick={() => picker.current?.click()}>
              <Icon name="arrow-right" size={16} aria-hidden="true" />
              {t("interop.wokwi.choose")}
            </Button>
            <p className="text-sm text-muted">{t("interop.wokwi.drop")}</p>
          </section>
          <TextArea label={t("interop.wokwi.pasteDiagram")} rows={6} spellCheck={false} className="font-mono tabular text-sm" value={diagram} onChange={(event) => setDiagram(event.target.value)} />
          <TextArea label={t("interop.wokwi.pasteSketch")} rows={4} spellCheck={false} className="font-mono tabular text-sm" value={sketch} onChange={(event) => setSketch(event.target.value)} />
          {failure}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("ino.cancel")}
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={diagram.trim() === ""}
              onClick={() => void read([{ name: "diagram.json", bytes: utf8Encode(diagram) }, ...(sketch.trim() === "" ? [] : [{ name: "sketch.ino", bytes: utf8Encode(sketch) }])])}
            >
              {t("interop.wokwi.read")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

type Made = { name: string; bytes: Uint8Array; loss: LossItem[] };

function ExportDialog({ kind, t, strings, lang, doc, describeItem, onClose }: Shared & { kind: "kicad" | "spice"; doc: DocStore }) {
  const [made, setMade] = useState<Made | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const build = async (): Promise<Made> => {
      const state = doc.getState().state;
      const options = { exportedAt: new Date().toISOString(), appVersion: version };
      const stem = fileStem(state.meta.title);
      if (kind === "kicad") {
        const { exportKicadNetlist } = await import("@/export/kicad");
        const out = exportKicadNetlist(state, getAppRegistry(), options);
        return { name: `${stem}.net`, bytes: utf8Encode(out.text), loss: out.loss };
      }
      const { exportSpice } = await import("@/sim/analog/spice");
      const out = exportSpice(state, getAppRegistry(), options);
      return { name: `${stem}.cir`, bytes: utf8Encode(out.text), loss: out.loss };
    };
    build().then(
      (result) => live && setMade(result),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [kind, doc]);

  function save() {
    if (!made) return;
    download(made.bytes, made.name, "text/plain");
    doc.session.recordExport({
      format: kind === "kicad" ? "kicad-netlist" : "spice-netlist",
      at: new Date().toISOString(),
      appVersion: version,
      sha256: sha256Hex(made.bytes),
      revision: doc.getState().revision,
      loss: lossCodes(made.loss),
    });
    onClose();
  }

  const empty = made?.loss.some((item) => item.severity === "error") === true;
  return (
    <Dialog open onClose={onClose} title={t(kind === "kicad" ? "interop.export.kicadTitle" : "interop.export.spiceTitle")} closeLabel={strings.layout.close} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-pretty text-muted">{t(kind === "kicad" ? "interop.export.kicadLede" : "interop.export.spiceLede")}</p>
        {failed ? (
          <Callout tone="danger" live>
            {t("interop.export.failed")}
          </Callout>
        ) : null}
        {made ? (
          <LossReport
            strings={strings}
            lang={lang}
            loss={made.loss}
            describeItem={describeItem}
            onConfirm={empty ? onClose : save}
            onCancel={onClose}
            confirmLabel={empty ? strings.layout.close : t("interop.export.download")}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
