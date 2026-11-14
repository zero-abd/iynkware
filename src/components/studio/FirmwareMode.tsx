"use client";

import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent } from "react";
import { Button, Callout, SegmentedControl } from "@/components/ui";
import { newId } from "@/core/ids";
import { sha256Hex } from "@/core/sha256";
import { utf8Encode } from "@/core/canonical";
import type { ParseError } from "@/sim/mcu/hex";
import type { AssetBytes } from "@/local/asset-bytes";
import type { Asset, Op } from "@/project/generated/types";
import type { Messages } from "@/i18n/namespaces";
import type { ParseFirmwareReply } from "@/sim-host/protocol";
import type { MessageKey } from "@/i18n/translate";
import type { FidelityT } from "./TierChips";

/** What the control needs of a runtime: its board's definition tells whether an AVR engine can run it. */
export interface RuntimeView {
  id: string;
  board: string;
  boardRef: string;
  engine: string;
  options?: { image?: string; elf?: string };
}

export type AssetView = Pick<Asset, "id" | "path" | "bytes">;

type Mode = "interpreter" | "firmware";

const AVR_BOARDS: readonly string[] = ["core.uno-r3", "core.nano"];
const PICO_BOARD = "core.pico";
const OCTET_STREAM = "application/octet-stream";
const INTERPRETER = "iynk-interp";
const FIRMWARE = "avr8js";
const PICO_FIRMWARE = "rp2040js";

const asset = (name: string, ext: "hex" | "elf" | "uf2", bytes: Uint8Array): Asset => ({
  id: newId("ast"),
  path: `firmware/${name}.${ext}`,
  mediaType: OCTET_STREAM,
  bytes: bytes.length,
  sha256: sha256Hex(bytes),
  role: "binary",
});

/** One batch, so a single undo removes the assets and the engine change together. */
function imageBatch(rt: RuntimeView, engine: string, image: Asset, symbols?: Asset): Op[] {
  const old = [rt.options?.image, rt.options?.elf].filter((id): id is string => id !== undefined);
  return [
    ...old.map((id): Op => ({ k: "asset.remove", id })),
    { k: "asset.add", asset: image },
    ...(symbols ? [{ k: "asset.add", asset: symbols } satisfies Op] : []),
    { k: "runtime.set", runtime: { id: rt.id, board: rt.board, engine, options: { image: image.id, ...(symbols ? { elf: symbols.id } : {}) } } },
  ];
}

export function imageOps(rt: RuntimeView, name: string, hex: string, elf?: Uint8Array): Op[] {
  return imageBatch(rt, FIRMWARE, asset(name, "hex", utf8Encode(hex)), elf ? asset(name, "elf", elf) : undefined);
}

export function uf2Ops(rt: RuntimeView, name: string, bytes: Uint8Array): Op[] {
  return imageBatch(rt, PICO_FIRMWARE, asset(name, "uf2", bytes));
}

const baseName = (file: string): string => file.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "firmware";

export interface FirmwareModeProps {
  runtime: RuntimeView;
  assets: readonly AssetView[];
  onChange(ops: Op[]): void;
  /** Checks the files in the sim worker; nothing is parsed here. */
  parse(hex: string, elf?: Uint8Array): Promise<ParseFirmwareReply>;
  parseUf2(bytes: Uint8Array): Promise<ParseFirmwareReply>;
  store: Pick<AssetBytes, "put">;
  t: FidelityT;
}

export function FirmwareMode({ runtime, assets, onChange, parse, parseUf2, store, t }: FirmwareModeProps) {
  const pico = runtime.boardRef === PICO_BOARD;
  const firmwareEngine = pico ? PICO_FIRMWARE : FIRMWARE;
  const [wanted, setWanted] = useState<Mode>(runtime.engine === firmwareEngine ? "firmware" : "interpreter");
  const [error, setError] = useState<ParseError | null>(null);
  const [staged, setStaged] = useState<{ name: string; hex: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fewCores] = useState(() => navigator.hardwareConcurrency <= 4);
  const hexInput = useRef<HTMLInputElement>(null);
  const elfInput = useRef<HTMLInputElement>(null);
  const uf2Input = useRef<HTMLInputElement>(null);
  const avr = AVR_BOARDS.includes(runtime.boardRef);
  const image = assets.find((a) => a.id === runtime.options?.image);
  const mode: Mode = avr || pico ? wanted : "interpreter";

  function choose(next: Mode) {
    if (!avr && !pico) return;
    setError(null);
    setWanted(next);
    if (next === "interpreter" && runtime.engine !== INTERPRETER) {
      onChange([{ k: "runtime.set", runtime: { id: runtime.id, board: runtime.board, engine: INTERPRETER, options: runtime.options } }]);
    } else if (next === "firmware" && image && runtime.engine !== firmwareEngine) {
      onChange([{ k: "runtime.set", runtime: { id: runtime.id, board: runtime.board, engine: firmwareEngine, options: runtime.options } }]);
    }
  }

  async function importUf2(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = await parseUf2(bytes);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    const ops = uf2Ops(runtime, baseName(file.name), bytes);
    const added = ops.find((op): op is Extract<Op, { k: "asset.add" }> => op.k === "asset.add");
    try {
      if (added) await store.put(added.asset.sha256, bytes);
    } catch {
      setError({ kind: "store-failed", message: "the file could not be stored" });
      return;
    }
    setError(null);
    setWanted("firmware");
    onChange(ops);
  }

  const takeDrop = useEffectEvent((file: File) => void importUf2(file));
  useEffect(() => {
    if (!pico) return;
    const files = (e: DragEvent) => e.dataTransfer?.types.includes("Files") === true;
    const over = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      setDragging(false);
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => f.name.toLowerCase().endsWith(".uf2"));
      if (!file) return;
      e.preventDefault();
      takeDrop(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [pico]);

  async function commit(name: string, hex: string, elf?: Uint8Array) {
    const checked = await parse(hex, elf);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    const ops = imageOps(runtime, name, hex, elf);
    const files = [utf8Encode(hex), ...(elf ? [elf] : [])];
    const added = ops.filter((op): op is Extract<Op, { k: "asset.add" }> => op.k === "asset.add");
    try {
      await Promise.all(added.map((op, i) => store.put(op.asset.sha256, files[i])));
    } catch {
      setError({ kind: "store-failed", message: "the file could not be stored" });
      return;
    }
    setError(null);
    setStaged({ name, hex });
    onChange(ops);
  }

  async function pickHex(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await commit(baseName(file.name), await file.text());
  }

  async function pickUf2(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await importUf2(file);
  }

  async function pickElf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file && staged) await commit(staged.name, staged.hex, new Uint8Array(await file.arrayBuffer()));
  }

  return (
    <section aria-label={t("firmware.mode")} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={t("firmware.mode")}
          size="sm"
          options={[
            { value: "interpreter", label: t("firmware.interpreter") },
            { value: "firmware", label: t("firmware.firmware") },
          ]}
          value={mode}
          onChange={choose}
        />
        {mode === "firmware" && pico ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => uf2Input.current?.click()}>
              {t("firmware.importUf2")}
            </Button>
            <input ref={uf2Input} type="file" accept=".uf2" tabIndex={-1} className="sr-only" aria-label={t("firmware.importUf2")} onChange={(e) => void pickUf2(e)} />
          </>
        ) : null}
        {mode === "firmware" && avr ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => hexInput.current?.click()}>
              {t("firmware.importHex")}
            </Button>
            <Button variant="ghost" size="sm" disabled={!staged} onClick={() => elfInput.current?.click()}>
              {t("firmware.importElf")}
            </Button>
            <input ref={hexInput} type="file" accept=".hex" tabIndex={-1} className="sr-only" aria-label={t("firmware.importHex")} onChange={(e) => void pickHex(e)} />
            <input ref={elfInput} type="file" accept=".elf" tabIndex={-1} className="sr-only" aria-label={t("firmware.importElf")} onChange={(e) => void pickElf(e)} />
          </>
        ) : null}
      </div>
      {!avr && !pico ? <p className="text-sm text-muted">{t("firmware.onlyFirmwareBoards")}</p> : null}
      {mode === "firmware" && pico ? (
        <p className={dragging ? "text-sm font-semibold text-ink" : "text-sm text-muted"}>{t(dragging ? "firmware.dropNow" : "firmware.dropUf2")}</p>
      ) : null}
      {mode === "firmware" && !error ? (
        <p className="text-sm text-muted tabular-nums" role="status">
          {image ? `T3 · ${t("firmware.tier")} · ${t("firmware.imageLoaded", { bytes: image.bytes })}` : t("firmware.noImage")}
        </p>
      ) : null}
      {mode === "firmware" && fewCores ? <p className="text-sm text-muted">{t("firmware.desktopNote")}</p> : null}
      {error ? (
        <Callout tone="danger" live>
          {t(`import.error.${error.kind}` as MessageKey<Messages["fidelity"]>)}
        </Callout>
      ) : null}
    </section>
  );
}
