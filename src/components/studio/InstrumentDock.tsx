"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Callout, EmptyState, Icon, Menu, Select, TextInput, type MenuItem } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import type { Instrument, Project } from "@/project/generated/types";
import { meterSettings } from "@/sim/probe/meter";
import type { ToleranceMode } from "@/sim/analog/tolerance";
import type { CsvMeta } from "@/sim/probe/capture";
import type { Reading } from "@/sim/probe/tap";
import type { SimHost } from "@/sim-host/host";
import { I2cScan } from "./instruments/I2cScan";
import { PointOptions } from "./instruments/PointOptions";
import { decoderSettings, lineId, MAX_LINES } from "@/studio/instruments/decoders";
import { listProbePoints, makeInstrumentOp, netChoices, nodeIdOf, MAX_INSTRUMENTS, removeInstrumentOp, setToleranceOp, type InstrumentKind, type NetChoice, type NodeLookup, type ProbePoint } from "@/studio/instruments/placement";
import { fgenSettings, withSettings } from "@/studio/instruments/bench";
import { createPlotStore, type PlotStore } from "@/studio/run/plot";
import { createProbeClient } from "@/studio/run/probes";
import { DEFAULT_TIME_PER_DIV_S, sampleIntervalNs } from "@/studio/instruments/scope";
import { DEFAULT_CAPACITY, useProbes, useTraces } from "@/studio/run/traces";
import type { DocStore } from "@/studio/stores/doc";
import type { RunStore } from "@/studio/stores/run";
import { useStoreSelector } from "@/studio/stores/select";
import type { UiStore } from "@/studio/stores/ui";

const Multimeter = dynamic(() => import("./instruments/Multimeter").then((m) => m.Multimeter), { ssr: false });
const Scope = dynamic(() => import("./instruments/Scope").then((m) => m.Scope), { ssr: false });
const LogicAnalyser = dynamic(() => import("./instruments/LogicAnalyser").then((m) => m.LogicAnalyser), { ssr: false });
const Plotter = dynamic(() => import("./instruments/Plotter").then((m) => m.Plotter), { ssr: false });
const BenchPanel = dynamic(() => import("./instruments/BenchPanel").then((m) => m.BenchPanel), { ssr: false });

type ProbeClient = ReturnType<typeof createProbeClient>;
type KindKey = keyof Messages["instruments"]["kind"];

export interface InstrumentDockProps {
  doc: DocStore;
  run: RunStore;
  ui: UiStore;
  sim: SimHost;
  messages: Messages["instruments"];
  fidelity: Messages["fidelity"];
  /** The strings of the I2C scan; the scan is left out without them. */
  faults?: Messages["faults"];
  lang: Locale;
  /** True while a shared run in a room is running or paused; changing the tolerance would halt it. */
  sharedRunActive?: boolean;
}

const KINDS: readonly { kind: InstrumentKind; key: KindKey; settings?: Record<string, unknown> }[] = [
  { kind: "multimeter", key: "multimeter" },
  { kind: "voltmeter", key: "voltmeter", settings: { mode: "dc-volts" } },
  { kind: "ammeter", key: "ammeter", settings: { mode: "dc-amps" } },
  { kind: "oscilloscope", key: "oscilloscope" },
  { kind: "logic-analyzer", key: "logicAnalyser" },
  { kind: "serial-plotter", key: "serialPlotter" },
  { kind: "serial-monitor", key: "serialMonitor" },
  { kind: "function-generator", key: "functionGenerator" },
  { kind: "power-supply", key: "powerSupply" },
];

/** The kinds that put a source on the circuit; they are added on the point they drive. */
const SOURCES: ReadonlySet<InstrumentKind> = new Set(["function-generator", "power-supply"]);

/** The kinds that draw a plot, which needs more of the dock than a reading does. */
const PLOTTING: ReadonlySet<InstrumentKind> = new Set(["oscilloscope", "logic-analyzer"]);
/** The dock height a plot is added at, unless the user already made it taller. */
const PLOT_DOCK_PX = 400;

const KIND_KEY = Object.fromEntries(KINDS.map(({ kind, key }) => [kind, key])) as Record<InstrumentKind, KindKey>;
const TOLERANCE_MODES: readonly Exclude<ToleranceMode, "corners">[] = ["nominal", "seeded"];
/** A list this long gets a search box above it. */
const SEARCH_FROM = 12;
const WINDOW_ROWS = 1000;
const NS_PER_S = 1e9;

const pointKey = (p: { c: string; p: string }): string => `${p.c}.${p.p}`;

function metersOf(client: ProbeClient, instrument: Instrument, black: string | undefined): Reading | null {
  const red = client.useReading(`${instrument.id}:red`);
  const other = client.useReading(`${instrument.id}:black`);
  const mode = (instrument.settings as { mode?: string } | undefined)?.mode ?? "dc-volts";
  if (mode !== "dc-volts" || !red || typeof red.value !== "number") return null;
  if (!black) return red;
  if (!other || typeof other.value !== "number") return null;
  return { ...red, value: red.value - other.value };
}

/** Resistance, continuity, an ammeter and a loaded voltmeter each cost a solve, so the worker makes them when asked, twice a second. */
const METER_POLL_MS = 500;

function useMeterReading(sim: SimHost, run: RunStore, instrument: Instrument, nodeOf: NodeLookup["ofTarget"], black: string | undefined, enabled: boolean): Reading | null {
  const live = useStoreSelector(run, (s) => s.phase === "running" || s.phase === "paused" || s.phase === "done");
  const [reading, setReading] = useState<Reading | null>(null);
  const red = nodeOf(instrument.target);
  const element = instrument.target?.component;
  const { settings } = instrument;
  useEffect(() => {
    if (!enabled || !live || !red) return;
    let stale = false;
    const read = () =>
      sim.meter(instrument.id, (settings ?? {}) as Record<string, unknown>, { red, black: black ?? null, element: element ?? null }).then(
        (r) => !stale && setReading(r),
        () => !stale && setReading(null),
      );
    void read();
    const timer = setInterval(read, METER_POLL_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [sim, enabled, live, red, black, element, instrument.id, settings]);
  return enabled && live && red ? reading : null;
}

interface PanelProps {
  instrument: Instrument;
  doc: DocStore;
  sim: SimHost;
  run: RunStore;
  client: ProbeClient;
  points: ProbePoint[];
  /** The simulator's node for a net of the document, or for the point an instrument is put on. */
  nodeOf: NodeLookup["ofNet"];
  nodeOfTarget: NodeLookup["ofTarget"];
  /** The nets of the document a line or a lead can go on. */
  nets: readonly NetChoice[];
  editable: boolean;
  messages: Messages["instruments"];
  fidelity: Messages["fidelity"];
  lang: Locale;
}

const needsSolve = (instrument: Instrument): boolean => {
  const s = meterSettings(instrument);
  return s.mode !== "dc-volts" || s.loading;
};

/** An ohmmeter or a continuity test on a two pin part with no black lead chosen reads the part: its other pin is the lead. */
function otherLead(points: readonly ProbePoint[], target: Instrument["target"]): ProbePoint | undefined {
  if (!target?.pin) return undefined;
  const pins = points.filter((p) => p.target.pin && p.target.component === target.component);
  return pins.length === 2 ? pins.find((p) => pointKey(p.target.pin!) !== pointKey(target.pin!)) : undefined;
}

function MeterPanel({ instrument, doc, sim, run, client, points, nodeOfTarget, editable, messages, fidelity, lang }: PanelProps) {
  const settings = (instrument.settings ?? {}) as { blackPin?: string };
  const chosen = points.find((p) => p.target.pin && pointKey(p.target.pin) === settings.blackPin);
  const blackPoint = chosen ?? (meterSettings(instrument).mode === "dc-volts" ? undefined : otherLead(points, instrument.target));
  const black = nodeOfTarget(blackPoint?.target);
  useProbes(client, [
    { id: `${instrument.id}:red`, net: nodeOfTarget(instrument.target) },
    { id: `${instrument.id}:black`, net: black },
  ]);
  const metered = useMeterReading(sim, run, instrument, nodeOfTarget, black, needsSolve(instrument));
  const probed = metersOf(client, instrument, black);
  const reading = needsSolve(instrument) ? metered : probed;
  const meterPoints = useMemo(
    () => points.flatMap((p) => (p.target.pin ? [{ pin: p.target.pin, label: p.label, part: p.part, net: p.target.net ?? "", element: p.target.component }] : [])),
    [points],
  );
  return (
    <Multimeter
      instrument={instrument}
      points={meterPoints}
      reading={reading}
      editable={editable}
      onChange={(next) => doc.commit([{ k: "instrument.set", instrument: { ...instrument, ...next } }], { label: "Change instrument" })}
      messages={messages}
      fidelity={fidelity}
      lang={lang}
    />
  );
}

/** A probe sampled for one time base is another probe from one sampled for the next, so the samples kept for one never mix with the other's. */
const probeIdOf = (channel: string, sampleNs: number): string => `${channel}@${sampleNs}`;

function CapturePanel({ instrument, doc, run, client, nodeOf, nodeOfTarget, nets, editable, messages, lang }: PanelProps) {
  const id = instrument.id;
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/instruments`), [lang, messages]);
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const logic = instrument.kind === "logic-analyzer";
  const decoder = decoderSettings(instrument.settings);
  const second = (instrument.settings as { ch2?: string } | undefined)?.ch2;
  const change = (patch: Record<string, unknown>) => doc.commit([{ k: "instrument.set", instrument: withSettings(instrument, patch) }], { label: "Change instrument" });

  const generatorHz = useStoreSelector(doc, (s) =>
    Math.max(0, ...(s.state.simulation.instruments ?? []).filter((i) => i.kind === "function-generator").map((i) => fgenSettings(i.settings)).filter((g) => g.on).map((g) => g.hz)),
  );
  const [perDiv, setPerDiv] = useState(DEFAULT_TIME_PER_DIV_S);
  const sampleNs = sampleIntervalNs(perDiv);

  const wants = [
    { id, net: nodeOfTarget(instrument.target) },
    ...(logic
      ? Array.from({ length: MAX_LINES - 1 }, (_, i) => ({ id: lineId(id, i + 1), net: decoder.protocol === "off" ? undefined : nodeOf(decoder.lines[i]) }))
      : [{ id: lineId(id, 1), net: nodeOf(second) }]),
  ];
  useProbes(client, wants.map((w) => ({ ...w, id: probeIdOf(w.id, sampleNs), sampleNs })));
  const traces = useTraces(client, wants.map((w) => probeIdOf(w.id, sampleNs)), capacity);
  const channelKey = wants.map((w) => w.id).join("\u0000");
  const chunks = useMemo(
    () => Object.fromEntries(channelKey.split("\u0000").flatMap((channel) => (traces[probeIdOf(channel, sampleNs)] ? [[channel, traces[probeIdOf(channel, sampleNs)]]] : []))),
    [traces, channelKey, sampleNs],
  );
  const runNs = useStoreSelector(run, (s) => s.tNs);
  // The run's clock moves ahead of the samples that reach the page, so a window ending at the clock is short of data now and then.
  const newestNs = useMemo(() => Math.max(0, ...Object.values(chunks).map((c) => (c.t.length > 0 ? c.t[c.t.length - 1] : 0))), [chunks]);
  const nowNs = logic || newestNs === 0 ? runNs : newestNs;
  const paused = useStoreSelector(run, (s) => s.phase === "paused");
  const revision = useStoreSelector(doc, (s) => s.revision);
  const seed = useStoreSelector(doc, (s) => s.state.simulation.seed);
  const meta = useMemo<CsvMeta>(() => ({ docHash: `r${revision}`, seed, versions: {}, provenance: {} }), [revision, seed]);
  const props = { chunks, nowNs, paused, capacity, onCapacity: setCapacity, timePerDivS: perDiv, onTimePerDiv: setPerDiv, meta, messages, lang };
  const digital = useMemo(() => [{ id, kind: "digital" as const }], [id]);
  const analog = useMemo(() => [{ id, kind: "analog" as const }, ...(second ? [{ id: lineId(id, 1), kind: "analog" as const }] : [])], [id, second]);

  if (logic) {
    return (
      <LogicAnalyser
        {...props}
        instrumentId={id}
        channels={digital}
        decoder={decoder}
        choices={nets}
        editable={editable}
        onDecoder={(patch) => change({ ...patch, ...(patch.lines && { lines: patch.lines.map((n) => n ?? "") }) })}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Scope {...props} channels={analog} {...(generatorHz > 0 && { sourceHz: generatorHz })} />
      <Select label={t("scope.channel2")} value={second ?? ""} disabled={!editable} onChange={(e) => change({ ch2: e.target.value === "" ? undefined : e.target.value })} data-testid="scope-channel2">
        <option value="">{t("scope.none")}</option>
        {nets.map((n) => (
          <option key={n.value} value={n.value}>
            {n.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

function PlotterPanel({ run, messages, lang }: PanelProps) {
  const [store] = useState<PlotStore>(createPlotStore);
  const serial = useStoreSelector(run, (s) => s.serial);
  const paused = useStoreSelector(run, (s) => s.phase === "paused");
  const fed = useRef(-1);
  useEffect(() => {
    for (const entry of serial) {
      if (entry.id <= fed.current) continue;
      fed.current = entry.id;
      if (entry.kind === "out") store.push(entry.tNs, entry.text);
    }
  }, [serial, store]);
  return <Plotter store={store} paused={paused} windowRows={WINDOW_ROWS} messages={messages} lang={lang} />;
}

function SerialMonitorPanel({ ui, messages, lang }: { ui: UiStore; messages: Messages["instruments"]; lang: Locale }) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/instruments`), [lang, messages]);
  return (
    <Button size="sm" onClick={() => ui.set("dock", "serial")}>
      {t("kind.serialMonitor")}
    </Button>
  );
}

function targetMissing(state: Project, instrument: Instrument): boolean {
  const target = instrument.target;
  if (!target) return false;
  const parts = [...state.boards, ...state.components];
  if (target.pin) return !parts.some((p) => p.id === target.pin!.c);
  return (
    (target.net !== undefined && !state.nets.some((n) => n.id === target.net)) ||
    (target.component !== undefined && !parts.some((p) => p.id === target.component))
  );
}

function InstrumentRow(props: PanelProps & { ui: UiStore; sim: SimHost; state: Project; startedAtMs: number | null; onRemove(): void }) {
  const { instrument, state, editable, messages, lang, ui, startedAtMs, onRemove } = props;
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/instruments`), [lang, messages]);
  const [open, setOpen] = useState(true);
  const panelId = `instrument-${instrument.id}`;
  const missing = targetMissing(state, instrument);
  const name = t(`kind.${KIND_KEY[instrument.kind]}`);
  const key = `${instrument.id}:${startedAtMs ?? "idle"}`;

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg bg-sunken p-2" data-testid="instrument">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} aria-hidden="true" />
          <span className="truncate">{name}</span>
          {missing ? <span className="font-normal text-warn">{t("dock.targetMissing")}</span> : null}
        </button>
        <Button size="sm" variant="ghost" disabled={!editable} title={editable ? undefined : t("dock.viewerOnly")} aria-label={`${t("dock.remove")}: ${name}`} onClick={onRemove}>
          {t("dock.remove")}
        </Button>
      </div>
      <div id={panelId} hidden={!open} className="min-w-0 px-2 pb-2">
        {open && !missing ? (
          instrument.kind === "multimeter" || instrument.kind === "voltmeter" || instrument.kind === "ammeter" ? (
            <MeterPanel key={key} {...props} />
          ) : instrument.kind === "oscilloscope" || instrument.kind === "logic-analyzer" ? (
            <CapturePanel key={key} {...props} />
          ) : instrument.kind === "function-generator" || instrument.kind === "power-supply" ? (
            <BenchPanel key={key} instrument={instrument} state={state} doc={props.doc} run={props.run} sim={props.sim} nets={props.nets} nodeOf={props.nodeOf} nodeOfTarget={props.nodeOfTarget} editable={editable} messages={messages} lang={lang} />
          ) : instrument.kind === "serial-plotter" ? (
            <PlotterPanel key={key} {...props} />
          ) : (
            <SerialMonitorPanel ui={ui} messages={messages} lang={lang} />
          )
        ) : null}
      </div>
    </li>
  );
}

function AddInstrument({ points, disabled, reason, messages, lang, onAdd }: { points: ProbePoint[]; disabled: boolean; reason?: string; messages: Messages["instruments"]; lang: Locale; onAdd(kind: (typeof KINDS)[number], point: ProbePoint): void }) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/instruments`), [lang, messages]);
  const [kind, setKind] = useState<(typeof KINDS)[number] | null>(null);
  const [pointId, setPointId] = useState("");
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);

  const items: MenuItem[] = KINDS.map((k) => ({ id: k.kind, label: t(`kind.${k.key}`), onSelect: () => setKind(k) }));
  const point = points.find((p) => p.id === pointId);
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const shown = points.filter((p) => p.id === pointId || words.every((w) => `${p.part ?? ""} ${p.label}`.toLocaleLowerCase().includes(w)));
  const done = () => {
    setKind(null);
    setPointId("");
    setQuery("");
    requestAnimationFrame(() => trigger.current?.focus());
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Menu
        label={t("dock.pickKind")}
        items={items}
        align="start"
        trigger={
          <Button ref={trigger} size="sm" variant="primary" disabled={disabled} title={reason}>
            <Icon name="sliders" size={16} />
            {t("dock.add")}
          </Button>
        }
      />
      {kind ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!point) return;
            onAdd(kind, point);
            done();
          }}
          onKeyDown={(e) => e.key === "Escape" && done()}
        >
          {points.length >= SEARCH_FROM ? <TextInput label={t("dock.searchPoints")} type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus /> : null}
          <Select label={`${t(`kind.${kind.key}`)}: ${t(SOURCES.has(kind.kind) ? "dock.pickOutput" : "dock.pickPoint")}`} value={pointId} onChange={(e) => setPointId(e.target.value)} autoFocus={points.length < SEARCH_FROM}>
            <option value="">{shown.length === 0 ? t("dock.noPoint") : t("dock.pickPoint")}</option>
            <PointOptions options={shown.map((p) => ({ value: p.id, label: p.label, part: p.part }))} netsLabel={t("dock.groupNets")} />
          </Select>
          <Button type="submit" size="sm" variant="primary" disabled={!point}>
            {t("dock.add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function InstrumentDock({ doc, run, ui, sim, messages, fidelity, faults, lang, sharedRunActive = false }: InstrumentDockProps) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/instruments`), [lang, messages]);
  const state = useStoreSelector(doc, (s) => s.state);
  const readOnly = useStoreSelector(doc, (s) => s.readOnly);
  const startedAtMs = useStoreSelector(run, (s) => s.startedAtMs);
  const hasRun = useStoreSelector(run, (s) => s.phase !== "idle" && s.phase !== "starting");
  const client = useMemo(() => createProbeClient(sim), [sim]);
  const points = useMemo(() => listProbePoints(state), [state]);
  const nodes = useMemo(() => nodeIdOf(state), [state]);
  const nets = useMemo(() => netChoices(points), [points]);
  const [failure, setFailure] = useState<string | null>(null);
  const instruments = state.simulation.instruments ?? [];
  const editable = !readOnly;

  const commit = useCallback(
    (op: Parameters<DocStore["commit"]>[0][number], label: string) => {
      const result = doc.commit([op], { label });
      setFailure(result.ok ? null : result.message);
    },
    [doc],
  );

  const mode = ((state.simulation.solver.options ?? {}) as { toleranceMode?: ToleranceMode }).toleranceMode ?? "nominal";
  const toleranceLocked = !editable || sharedRunActive;
  const full = instruments.length >= MAX_INSTRUMENTS;

  return (
    <section aria-label={t("dock.title")} className="flex min-w-0 flex-col gap-2" data-testid="instrument-dock">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <AddInstrument
          points={points}
          disabled={!editable || full}
          reason={editable ? undefined : t("dock.viewerOnly")}
          messages={messages}
          lang={lang}
          onAdd={(kind, point) => {
            commit(makeInstrumentOp(kind.kind, point.target, kind.settings), "Add instrument");
            if (PLOTTING.has(kind.kind)) ui.set("dockHeightPx", Math.max(ui.getState().dockHeightPx, PLOT_DOCK_PX));
          }}
        />
        <Select
          label={t("tolerance.label")}
          value={mode}
          disabled={toleranceLocked}
          hint={sharedRunActive ? t("tolerance.runActive") : readOnly ? t("dock.viewerOnly") : undefined}
          onChange={(e) => commit(setToleranceOp(state, e.target.value as ToleranceMode), "Change part tolerance")}
        >
          {TOLERANCE_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`tolerance.${m}`)}
            </option>
          ))}
        </Select>
      </div>
      {failure ? (
        <Callout tone="danger" live>
          {failure}
        </Callout>
      ) : null}
      {instruments.length === 0 ? (
        <EmptyState icon="empty" title={t("dock.empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {instruments.map((instrument) => (
            <InstrumentRow
              key={instrument.id}
              instrument={instrument}
              doc={doc}
              sim={sim}
              run={run}
              ui={ui}
              state={state}
              client={client}
              points={points}
              nodeOf={nodes.ofNet}
              nodeOfTarget={nodes.ofTarget}
              nets={nets}
              editable={editable}
              startedAtMs={startedAtMs}
              messages={messages}
              fidelity={fidelity}
              lang={lang}
              onRemove={() => commit(removeInstrumentOp(instrument.id), "Remove instrument")}
            />
          ))}
        </ul>
      )}
      {faults ? <I2cScan scan={() => sim.i2cScan()} disabled={!hasRun} messages={faults} lang={lang} /> : null}
    </section>
  );
}
