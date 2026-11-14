"use client";

import { useCallback, useMemo } from "react";
import { Select } from "@/components/ui";
import { createTranslator } from "@/i18n/translate";
import type { CaptureFrame } from "@/sim/probe/capture";
import type { NetChoice } from "@/studio/instruments/placement";
import { annotate, type DecoderSettings, lineId, PROTOCOLS, ROLES } from "@/studio/instruments/decoders";
import { type ChannelInfo, CaptureView, type ScopeProps } from "./Scope";
import { ValueField } from "./ValueField";

interface LogicProps extends ScopeProps {
  instrumentId: string;
  decoder: DecoderSettings;
  /** The nets a decoder line can be put on. */
  choices: readonly NetChoice[];
  editable: boolean;
  onDecoder(patch: Partial<DecoderSettings>): void;
}

const MODES = [0, 1, 2, 3] as const;
const NO_ROLES: readonly string[] = [];

export function LogicAnalyser({ instrumentId, decoder, choices, editable, onDecoder, ...props }: LogicProps) {
  const t = useMemo(() => createTranslator(props.lang, props.messages, `${props.lang}/instruments`), [props.lang, props.messages]);
  const roles = decoder.protocol === "off" ? NO_ROLES : ROLES[decoder.protocol];
  const ids = useMemo(() => roles.map((_, role) => (role === 0 || decoder.lines[role - 1] !== undefined ? lineId(instrumentId, role) : "")), [roles, decoder.lines, instrumentId]);
  const channels = useMemo<ChannelInfo[]>(
    () => (roles.length === 0 ? props.channels : roles.flatMap((role, i) => (ids[i] === "" ? [] : [{ id: ids[i], kind: "digital" as const, label: role }]))),
    [roles, ids, props.channels],
  );
  const mark = useCallback((frame: CaptureFrame) => annotate(frame, ids, decoder), [ids, decoder]);

  const setLine = (role: number, net: string) => {
    const lines = [...decoder.lines];
    lines[role - 1] = net === "" ? undefined : net;
    onDecoder({ lines });
  };

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="logic-analyser">
      <div className="flex flex-wrap items-end gap-2">
        <Select label={t("decode.label")} value={decoder.protocol} disabled={!editable} onChange={(e) => onDecoder({ protocol: e.target.value as DecoderSettings["protocol"] })} data-testid="decoder-protocol">
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {t(`decode.${p}`)}
            </option>
          ))}
        </Select>
        {decoder.protocol === "uart" ? (
          <>
            <ValueField label={t("decode.baud")} unit="none" value={decoder.baud} min={50} max={3e6} disabled={!editable} messages={props.messages} lang={props.lang} onValue={(baud) => onDecoder({ baud })} />
            <Select label={t("decode.parityLabel")} value={decoder.parity} disabled={!editable} onChange={(e) => onDecoder({ parity: e.target.value as DecoderSettings["parity"] })}>
              {(["none", "even", "odd"] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`decode.parity${p === "none" ? "None" : p === "even" ? "Even" : "Odd"}`)}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        {decoder.protocol === "spi" ? (
          <Select label={t("decode.spiMode")} value={String(decoder.spiMode)} disabled={!editable} onChange={(e) => onDecoder({ spiMode: Number(e.target.value) as DecoderSettings["spiMode"] })}>
            {MODES.map((m) => (
              <option key={m} value={String(m)}>
                {t("decode.mode", { n: m })}
              </option>
            ))}
          </Select>
        ) : null}
        {roles.slice(1).map((role, i) => (
          <Select key={role} label={t("decode.pick", { role })} value={decoder.lines[i] ?? ""} disabled={!editable} onChange={(e) => setLine(i + 1, e.target.value)}>
            <option value="">{t("decode.noLine")}</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        ))}
      </div>
      <CaptureView {...props} channels={channels} annotate={decoder.protocol === "off" ? undefined : mark} vcd testId="logic" />
    </div>
  );
}
