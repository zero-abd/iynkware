"use client";

import { useMemo } from "react";
import { getAppRegistry } from "@/parts/builtin";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import type { Instrument, Project } from "@/project/generated/types";
import type { SimHost } from "@/sim-host/host";
import { MAX_STEP_NS } from "@/sim/analog/step";
import { analogOptions, groundOf } from "@/sim/netlist";
import { fgenSettings, fgenSource, psuSettings, psuSource, withSettings } from "@/studio/instruments/bench";
import type { NetChoice, NodeLookup } from "@/studio/instruments/placement";
import { useBenchSource, useInstrumentReading } from "@/studio/run/bench";
import type { DocStore } from "@/studio/stores/doc";
import type { RunStore } from "@/studio/stores/run";
import type { ReturnOption } from "./BenchShared";
import { FunctionGenerator } from "./FunctionGenerator";
import { PowerSupply } from "./PowerSupply";

interface BenchPanelProps {
  instrument: Instrument;
  state: Project;
  doc: DocStore;
  run: RunStore;
  sim: SimHost;
  nets: readonly NetChoice[];
  /** The simulator's node for a net of the document, or for the point the instrument is on. */
  nodeOf: NodeLookup["ofNet"];
  nodeOfTarget: NodeLookup["ofTarget"];
  editable: boolean;
  messages: Messages["instruments"];
  lang: Locale;
}

const GROUND = "";

/** A function generator or a bench supply between the point it was added on and a return lead, which is ground unless another net is chosen. */
export function BenchPanel({ instrument, state, doc, run, sim, nets, nodeOf, nodeOfTarget, editable, messages, lang }: BenchPanelProps) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/instruments`), [lang, messages]);
  const generator = instrument.kind === "function-generator";
  const fgen = fgenSettings(instrument.settings);
  const psu = psuSettings(instrument.settings);
  const settings = generator ? fgen : psu;

  const ground = useMemo(() => groundOf(state, getAppRegistry()).ground, [state]);
  const pos = nodeOfTarget(instrument.target);
  const neg = settings.neg === undefined ? (ground === "" ? undefined : ground) : nodeOf(settings.neg);
  const wired = pos !== undefined && neg !== undefined && pos !== neg;
  const source = wired ? (generator ? fgenSource(fgen, pos, neg) : psuSource(psu, pos, neg)) : null;
  const missing = pos === undefined ? ("unknown-net" as const) : neg === undefined ? ("no-ground" as const) : pos === neg ? ("same-net" as const) : null;
  const status = useBenchSource(sim, run, instrument.id, source);
  const reading = useInstrumentReading(sim, instrument.id);

  const returns = useMemo<ReturnOption[]>(() => [{ value: GROUND, label: t("bench.ground") }, ...nets], [nets, t]);

  const change = (patch: Record<string, unknown>) => doc.commit([{ k: "instrument.set", instrument: withSettings(instrument, patch) }], { label: "Change instrument" });
  const common = {
    editable,
    status: missing ?? status,
    messages,
    lang,
    returns,
    returnValue: settings.neg ?? GROUND,
    onReturn: (value: string) => change({ neg: value === GROUND ? undefined : value }),
  };
  return generator ? <FunctionGenerator {...common} settings={fgen} stepNs={analogOptions(state).stepNs ?? MAX_STEP_NS} onChange={change} /> : <PowerSupply {...common} settings={psu} reading={reading} onChange={change} />;
}
