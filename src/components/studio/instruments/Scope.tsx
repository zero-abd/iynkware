"use client";

import { type KeyboardEvent, useMemo, useState } from "react";
import { Button, Select, TextInput } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator } from "@/i18n/translate";
import type { Annotation } from "@/sim/decode";
import { buildFrame, type CaptureFrame, type CaptureSpec, type ChannelKind, type CsvMeta, type FrameChannel, MAX_CHANNELS, tableRows, toCsv } from "@/sim/probe/capture";
import { valueAt } from "@/sim/probe/measure";
import { MAX_CAPACITY } from "@/sim/probe/ring";
import type { TraceChunk } from "@/sim/probe/tap";
import { toVcd } from "@/sim/probe/vcd";
import { coarseAboveHz, isCoarse, sampleRateHz } from "@/studio/instruments/sampling";
import { channelScale, DEFAULT_TIME_PER_DIV_S, H_DIVS, TIME_PER_DIV_S, V_DIVS, VOLTS_PER_DIV } from "@/studio/instruments/scope";
import { formatValue } from "@/studio/units";
import { DecodeLanes, DecodeTable, lanesOf, NOTE_LANE_H, type NoteWords } from "./DecodeLane";
import { Measurements } from "./Measurements";

export const MIN_CAPACITY = 1024;

export interface ChannelInfo {
  id: string;
  kind: ChannelKind;
  /** Shown instead of the numbered default. */
  label?: string;
}

export interface CaptureViewProps {
  channels: ChannelInfo[];
  chunks: Record<string, TraceChunk>;
  nowNs: number;
  paused: boolean;
  capacity: number;
  onCapacity: (capacity: number) => void;
  meta: CsvMeta;
  messages: Messages["instruments"];
  lang: Locale;
  /** Starting time per division, in seconds. */
  timePerDivS?: number;
  /** Told when the user picks another time per division, so the probes can be sampled for the window on screen. */
  onTimePerDiv?: (seconds: number) => void;
  /** Marks for the window on screen, drawn under the digital lanes. */
  annotate?: (frame: CaptureFrame) => Annotation[];
  /** Offers the digital lines as a Value Change Dump. */
  vcd?: boolean;
  /** The frequency of the fastest generator that is on, so a wave drawn from too few points can be said so. */
  sourceHz?: number;
  testId?: string;
}

const WIDTH = 600;
const PAD = { left: 56, right: 16, top: 8, bottom: 20 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const DIV_H = 20;
const ANALOG_H = V_DIVS * DIV_H;
const LANE_H = 24;
const LANE_GAP = 8;
const TABLE_ROWS = 200;
const NS_PER_S = 1e9;
const CURSOR_STEPS = 1000;
const MAX_ANALOG = 2;

/** Colour is a second cue only: every channel also has its own dash pattern and a label. */
const STYLES: readonly { stroke: string; dash: string | undefined }[] = [
  { stroke: "#8af0ae", dash: undefined },
  { stroke: "#f4b829", dash: "6 3" },
  { stroke: "#7cc4ff", dash: "2 2" },
  { stroke: "#ff8a7a", dash: "8 3 2 3" },
  { stroke: "#d6a8ff", dash: "12 4" },
  { stroke: "#f2e394", dash: "1 3" },
  { stroke: "#7ee8e0", dash: "10 3 2 3 2 3" },
  { stroke: "#e8e8e8", dash: "4 4" },
];

type Point = readonly [number, number];
type TriggerMode = "auto" | "normal" | "single";
type Edge = "rising" | "falling";

const ms = (tNs: number) => (tNs / 1e6).toFixed(3);
const num = (v: number | string) => (typeof v === "number" ? String(Number(v.toPrecision(6))) : v);
const volts = (v: number) => formatValue(Number(v.toPrecision(4)), "volt");
const clampCapacity = (n: number) => Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(n)));

/** The line of a channel. A held trace steps to the next sample; a waveform joins its samples. Past two points per pixel column it keeps each column's lowest and highest value. */
export function tracePoints(c: FrameChannel, x: (tNs: number) => number, y: (v: number) => number, xEnd: number): Point[] {
  const maxPoints = PLOT_W * 2;
  if (c.t.length === 0) return [];
  if (c.t.length <= maxPoints / 2) {
    if (!c.zoh) return Array.from(c.t, (t, i): Point => [x(t), y(c.v[i])]);
    const out: Point[] = [];
    for (let i = 0; i < c.t.length; i++) {
      if (i > 0) out.push([x(c.t[i]), y(c.v[i - 1])]);
      out.push([x(c.t[i]), y(c.v[i])]);
    }
    out.push([xEnd, y(c.v[c.v.length - 1])]);
    return out;
  }
  const out: Point[] = [];
  let column = Math.floor(x(c.t[0]));
  let low = c.v[0];
  let high = c.v[0];
  const flush = () => out.push([column, y(low)], [column, y(high)]);
  for (let i = 0; i < c.t.length; i++) {
    const col = Math.floor(x(c.t[i]));
    if (col !== column) {
      flush();
      column = col;
      low = high = c.v[i];
    } else {
      low = Math.min(low, c.v[i]);
      high = Math.max(high, c.v[i]);
    }
  }
  flush();
  return out;
}

const points = (list: Point[]) => list.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");

/** Keeps the inputs as they were when the run paused, so the picture and its table stop together. */
function useHeld<T>(live: T, paused: boolean): T {
  const [held, setHeld] = useState(live);
  if (!paused && held !== live) setHeld(live);
  return paused ? held : live;
}

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

interface CursorProps {
  label: string;
  position: number;
  text: string;
  onMove: (position: number) => void;
}

function CursorSlider({ label, position, text, onMove }: CursorProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, number> = { ArrowRight: position + step, ArrowUp: position + step, ArrowLeft: position - step, ArrowDown: position - step, Home: 0, End: CURSOR_STEPS };
    if (!(event.key in moves)) return;
    event.preventDefault();
    onMove(Math.min(CURSOR_STEPS, Math.max(0, moves[event.key])));
  }
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={CURSOR_STEPS}
      aria-valuenow={position}
      aria-valuetext={text}
      onKeyDown={onKeyDown}
      className="rounded-lg bg-sunken px-3 py-2 text-sm font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {label} <span className="font-mono tabular-nums">{text}</span>
    </div>
  );
}

/** `choice` is a step of the ladder, or "auto" to let the channel scale itself. */
function withDiv(prev: Record<string, number>, id: string, choice: string): Record<string, number> {
  const rest = Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id));
  return choice === "auto" ? rest : { ...rest, [id]: Number(choice) };
}

const asTrace = (c: FrameChannel) => ({ t: c.t, v: c.v, zoh: c.zoh });

export function CaptureView({ channels, chunks, nowNs, paused, capacity, onCapacity, meta, messages, lang, timePerDivS = DEFAULT_TIME_PER_DIV_S, onTimePerDiv, annotate, vcd = false, sourceHz, testId = "scope" }: CaptureViewProps) {
  const t = useMemo(() => createTranslator(lang, messages, `${lang}/instruments`), [lang, messages]);
  const [perDiv, setPerDiv] = useState(timePerDivS);
  const [mode, setMode] = useState<TriggerMode>("auto");
  const [edge, setEdge] = useState<Edge>("rising");
  const [triggerId, setTriggerId] = useState("");
  const [level, setLevel] = useState("");
  const [vdivs, setVdivs] = useState<Record<string, number>>({});
  const [cursors, setCursors] = useState<[number, number]>([250, 750]);
  const [held, setHeld] = useState<CaptureFrame | null>(null);
  const [armed, setArmed] = useState(true);

  const used = useMemo(() => channels.slice(0, MAX_CHANNELS), [channels]);
  const live = useMemo(() => ({ chunks, nowNs }), [chunks, nowNs]);
  const input = useHeld(live, paused);
  const timeBaseNs = perDiv * H_DIVS * NS_PER_S;
  const trigger = used.find((c) => c.id === triggerId) ?? used[0];

  const autoLevel = useMemo(() => {
    const chunk = trigger ? input.chunks[trigger.id] : undefined;
    if (!chunk || chunk.v.length === 0 || trigger?.kind !== "analog") return 0;
    return (chunk.v.reduce((a, b) => Math.min(a, b), Infinity) + chunk.v.reduce((a, b) => Math.max(a, b), -Infinity)) / 2;
  }, [input, trigger]);

  const fresh: CaptureFrame = useMemo(() => {
    const spec: CaptureSpec = {
      channels: used.map(({ id, kind }) => ({ id, kind })),
      timeBaseNs: Math.max(1, timeBaseNs),
      ...(trigger ? { trigger: { channel: trigger.id, edge, ...(trigger.kind === "analog" ? { level: level.trim() === "" ? autoLevel : Number(level) || 0 } : {}) } } : {}),
    };
    return buildFrame(input.chunks, spec, input.nowNs);
  }, [used, timeBaseNs, edge, trigger, level, autoLevel, input]);

  const catches = fresh.triggeredAt !== undefined && (mode === "normal" || (mode === "single" && armed));
  const sameCapture = held !== null && held.startNs === fresh.startNs && held.endNs === fresh.endNs && held.channels.length === fresh.channels.length;
  if (catches && !sameCapture) {
    setHeld(fresh);
    if (mode === "single") setArmed(false);
  }
  const frame = mode === "auto" ? fresh : catches ? fresh : held;
  const waiting = mode !== "auto" && !catches && (mode === "normal" || armed);
  const shown = frame ?? fresh;

  const rows = useMemo(() => (frame ? tableRows(frame) : []), [frame]);
  const names = used.map((c, i) => c.label ?? t("channel", { n: i + 1 }));
  const nameOf = (id: string) => names[used.findIndex((c) => c.id === id)];
  const analog = shown.channels.flatMap((c, i) => (c.kind === "analog" && frame ? [{ c, i }] : [])).slice(0, MAX_ANALOG);
  const digital = shown.channels.flatMap((c, i) => (c.kind === "digital" && frame ? [{ c, i }] : []));
  const notes = useMemo(() => (frame && annotate ? annotate(frame) : []), [frame, annotate]);
  const noteLanes = lanesOf(notes);

  const scales = analog.map(({ c }) => {
    let low = Infinity;
    let high = -Infinity;
    for (const v of c.v) {
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    return Number.isFinite(low) ? channelScale(low, high, vdivs[c.id]) : { mid: 0, div: vdivs[c.id] ?? 1 };
  });

  const span = Math.max(1, shown.endNs - shown.startNs);
  const x = (tNs: number) => PAD.left + Math.min(1, Math.max(0, (tNs - shown.startNs) / span)) * PLOT_W;
  const analogH = analog.length > 0 ? ANALOG_H : 0;
  const yOf = (k: number) => (v: number) => Math.min(PAD.top + analogH, Math.max(PAD.top, PAD.top + analogH / 2 - ((v - scales[k].mid) / scales[k].div) * DIV_H));
  const laneTop = (k: number) => PAD.top + analogH + (analogH > 0 ? LANE_GAP : 0) + k * (LANE_H + LANE_GAP);
  const lanesBottom = PAD.top + analogH + (analogH > 0 && digital.length > 0 ? LANE_GAP : 0) + digital.length * (LANE_H + LANE_GAP);
  const plotBottom = lanesBottom + noteLanes.length * NOTE_LANE_H;
  const height = plotBottom + PAD.bottom;

  const cursorNs = cursors.map((p) => shown.startNs + (p / CURSOR_STEPS) * span);
  const first = analog[0];
  const cursorText = (k: number) => {
    const v = first ? valueAt(asTrace(first.c), cursorNs[k]) : null;
    return `${ms(cursorNs[k])} ms${v === null ? "" : `, ${volts(v)}`}`;
  };
  const dtNs = Math.abs(cursorNs[1] - cursorNs[0]);
  const v0 = first ? valueAt(asTrace(first.c), cursorNs[0]) : null;
  const v1 = first ? valueAt(asTrace(first.c), cursorNs[1]) : null;

  const kept = Math.max(0, ...used.map((c) => chunks[c.id]?.t.length ?? 0));
  const rateHz = analog[0] ? sampleRateHz(analog[0].c.t) : null;
  const lost = used.reduce((sum, c) => sum + (shown.dropped[c.id] ?? 0), 0);
  const last = rows[rows.length - 1];
  const summary = t("scope.summary", { n: rows.length, t: last ? ms(last.tNs) : "0.000" });
  const pwm = Object.entries(shown.pwm ?? {});
  const tableCapped = rows.slice(-TABLE_ROWS);
  const tableStart = rows.length - tableCapped.length;
  const words: NoteWords = {
    start: t("decode.start"), stop: t("decode.stop"), ack: t("decode.ack"), nack: t("decode.nack"), data: t("decode.data"), address: t("decode.address"),
    framing: t("decode.framing"), parityError: t("decode.parityError"), write: t("decode.write"), read: t("decode.read"),
  };

  return (
    <section className="flex min-h-0 flex-col gap-2" data-testid={testId}>
      <ul aria-label={names.join(", ")} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {used.map((c, i) => {
          const k = analog.findIndex((a) => a.c.id === c.id);
          return (
            <li key={c.id} className="flex items-center gap-2">
              <svg width="24" height="8" aria-hidden="true" focusable="false">
                <line x1="0" y1="4" x2="24" y2="4" stroke={STYLES[i].stroke} strokeWidth="2" strokeDasharray={STYLES[i].dash} />
              </svg>
              <span className="font-medium">{names[i]}</span>
              {k >= 0 ? <span className="font-mono tabular-nums text-muted">{formatValue(scales[k].div, "volt")}/div</span> : null}
              {shown.pwm?.[c.id] ? (
                <span className="font-mono tabular-nums text-muted">
                  {t("scope.pwm", { duty: (shown.pwm[c.id].duty * 100).toFixed(1), hz: shown.pwm[c.id].hz.toFixed(1) })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {rows.length > 0 ? (
        <svg viewBox={`0 0 ${WIDTH} ${height}`} className="max-h-64 w-full rounded-xl border border-rule bg-console" aria-hidden="true" focusable="false">
          {analog.length > 0 ? (
            <g stroke="#313131" strokeWidth="1">
              {Array.from({ length: H_DIVS + 1 }, (_, k) => (
                <line key={`v${k}`} x1={PAD.left + (k * PLOT_W) / H_DIVS} x2={PAD.left + (k * PLOT_W) / H_DIVS} y1={PAD.top} y2={PAD.top + analogH} />
              ))}
              {Array.from({ length: V_DIVS + 1 }, (_, k) => (
                <line key={`h${k}`} x1={PAD.left} x2={PAD.left + PLOT_W} y1={PAD.top + k * DIV_H} y2={PAD.top + k * DIV_H} stroke={k === V_DIVS / 2 ? "#4a4a4a" : undefined} />
              ))}
            </g>
          ) : null}
          {first ? (
            <g className="fill-console-muted font-mono text-xs tabular-nums" aria-hidden="true">
              {Array.from({ length: V_DIVS / 2 + 1 }, (_, k) => (
                <text key={k} x={PAD.left - 4} y={PAD.top + k * 2 * DIV_H + 4} textAnchor="end">
                  {volts(scales[0].mid + (V_DIVS / 2 - k * 2) * scales[0].div)}
                </text>
              ))}
            </g>
          ) : null}
          <g className="fill-console-muted font-mono text-xs tabular-nums">
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={plotBottom} y2={plotBottom} stroke="#313131" />
            <text x={PAD.left} y={height - 4}>{ms(shown.startNs)} ms</text>
            <text x={PAD.left + PLOT_W} y={height - 4} textAnchor="end">{ms(shown.endNs)} ms</text>
          </g>
          {analog.map(({ c, i }, k) => (
            <polyline key={c.id} points={points(tracePoints(c, x, yOf(k), x(shown.endNs)))} fill="none" stroke={STYLES[i].stroke} strokeDasharray={STYLES[i].dash} strokeWidth="1.5" />
          ))}
          {digital.map(({ c, i }, k) => {
            const top = laneTop(k);
            const yDigital = (v: number) => (v >= 0.5 ? top : top + LANE_H);
            return (
              <g key={c.id}>
                <polyline points={points(tracePoints(c, x, yDigital, x(shown.endNs)))} fill="none" stroke={STYLES[i].stroke} strokeDasharray={STYLES[i].dash} strokeWidth="1.5" />
                <text x={PAD.left - 4} y={top + LANE_H / 2 + 4} textAnchor="end" className="fill-console-muted font-sans text-xs">{names[i]}</text>
              </g>
            );
          })}
          <DecodeLanes notes={notes} top={lanesBottom} x={x} left={PAD.left} words={words} />
          {cursorNs.map((tNs, k) => (
            <line key={k} x1={x(tNs)} x2={x(tNs)} y1={PAD.top} y2={plotBottom} stroke="#e8e8e8" strokeDasharray={k === 0 ? "2 2" : "6 2"} />
          ))}
        </svg>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Select label={t("scope.timePerDiv")} value={String(perDiv)} onChange={(e) => {
            setPerDiv(Number(e.target.value));
            onTimePerDiv?.(Number(e.target.value));
          }}
          data-testid={`${testId}-timebase`}>
          {(TIME_PER_DIV_S.includes(perDiv) ? TIME_PER_DIV_S : [...TIME_PER_DIV_S, perDiv].sort((a, b) => a - b)).map((s) => (
            <option key={s} value={String(s)}>
              {formatValue(s, "second")}
            </option>
          ))}
        </Select>
        {analog.map(({ c }, k) => (
          <Select key={c.id} label={`${t("scope.voltsPerDiv")}: ${nameOf(c.id)}`} value={vdivs[c.id] === undefined ? "auto" : String(vdivs[c.id])} onChange={(e) => setVdivs((prev) => withDiv(prev, c.id, e.target.value))}>
            <option value="auto">{`${t("scope.auto")} (${formatValue(scales[k].div, "volt")})`}</option>
            {VOLTS_PER_DIV.map((v) => (
              <option key={v} value={String(v)}>
                {formatValue(v, "volt")}
              </option>
            ))}
          </Select>
        ))}
        <Select label={t("scope.mode")} value={mode} onChange={(e) => setMode(e.target.value as TriggerMode)} data-testid={`${testId}-mode`}>
          <option value="auto">{t("scope.modeAuto")}</option>
          <option value="normal">{t("scope.modeNormal")}</option>
          <option value="single">{t("scope.modeSingle")}</option>
        </Select>
        {used.length > 1 ? (
          <Select label={t("scope.trigger")} value={trigger?.id ?? ""} onChange={(e) => setTriggerId(e.target.value)}>
            {used.map((c, i) => (
              <option key={c.id} value={c.id}>{names[i]}</option>
            ))}
          </Select>
        ) : null}
        <Select label={t("scope.edge")} value={edge} onChange={(e) => setEdge(e.target.value as Edge)}>
          <option value="rising">{t("scope.rising")}</option>
          <option value="falling">{t("scope.falling")}</option>
        </Select>
        {trigger?.kind === "analog" ? (
          <TextInput label={t("scope.level")} type="number" step="any" inputMode="decimal" placeholder={`${t("scope.auto")} (${volts(autoLevel)})`} value={level} onChange={(e) => setLevel(e.target.value)} className="w-32 tabular-nums" />
        ) : null}
        {mode === "single" ? (
          <Button size="sm" variant="secondary" disabled={armed} onClick={() => setArmed(true)}>
            {t("scope.arm")}
          </Button>
        ) : null}
        <TextInput
          label={t("capSet")}
          type="number"
          min={MIN_CAPACITY}
          max={MAX_CAPACITY}
          step={1}
          value={capacity}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onCapacity(clampCapacity(n));
          }}
          className="w-32 tabular-nums"
        />
        <Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => frame && download(toCsv(frame, meta), "capture.csv", "text/csv")}>
          {t("scope.export")}
        </Button>
        {vcd && digital.length > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() => download(toVcd(digital.map(({ c, i }) => ({ name: names[i], t: c.t, v: c.v })), { docHash: meta.docHash, seed: meta.seed }), "capture.vcd", "text/plain")}
          >
            {t("logic.export")}
          </Button>
        ) : null}
      </div>

      <p className="text-sm tabular-nums text-muted" data-testid={`${testId}-summary`}>{summary}</p>
      <p className="text-sm tabular-nums text-muted" data-testid={`${testId}-cap`}>{t("cap", { kept, dropped: lost })}</p>
      {mode !== "auto" ? (
        <p role="status" className="text-sm text-muted" data-testid={`${testId}-armed`}>
          {waiting ? t("scope.waiting") : mode === "single" ? t("scope.held") : ""}
        </p>
      ) : null}
      {shown.notes.includes("staircase") ? <p className="text-sm text-muted">{t("staircase")}</p> : null}
      {shown.notes.includes("cost-model") ? <p className="text-sm text-muted">{t("costModel")}</p> : null}

      {sourceHz !== undefined && rateHz !== null && isCoarse(sourceHz, rateHz) ? (
        <p role="status" className="text-sm text-pretty text-muted" data-testid={`${testId}-few-points`}>
          {t("scope.fewPoints", { hz: formatValue(Number(sourceHz.toPrecision(3)), "hertz"), rate: formatValue(Number(rateHz.toPrecision(3)), "hertz"), limit: formatValue(Number(coarseAboveHz(rateHz).toPrecision(3)), "hertz") })}
        </p>
      ) : null}

      {analog.length > 0 ? (
        <Measurements
          testId={testId}
          rows={analog.map(({ c }) => ({ id: c.id, name: nameOf(c.id), trace: asTrace(c) }))}
          labels={{ title: t("scope.measure"), freq: t("scope.freq"), vpp: t("scope.vpp"), vrms: t("scope.vrms"), duty: t("scope.duty"), noValue: t("scope.noValue") }}
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <CursorSlider label={`${t("scope.cursor")} 1`} position={cursors[0]} text={cursorText(0)} onMove={(p) => setCursors([p, cursors[1]])} />
          <CursorSlider label={`${t("scope.cursor")} 2`} position={cursors[1]} text={cursorText(1)} onMove={(p) => setCursors([cursors[0], p])} />
          <span className="font-mono text-sm tabular-nums" data-testid={`${testId}-delta`}>
            {t("scope.delta", { dt: ms(dtNs) })}
            {dtNs > 0 ? `, ${formatValue(Number((NS_PER_S / dtNs).toPrecision(4)), "hertz")}` : ""}
            {v0 !== null && v1 !== null ? `, ${t("scope.deltaV", { dv: volts(Math.abs(v1 - v0)) })}` : ""}
          </span>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t("decode.table")}</summary>
          <DecodeTable notes={notes} words={words} limit={TABLE_ROWS} heads={{ time: t("column.time"), lane: t("decode.lane"), kind: t("decode.kind"), value: t("decode.value") }} />
        </details>
      ) : annotate ? (
        <p className="text-sm text-muted">{t("decode.empty")}</p>
      ) : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium">{t("scope.table")}</summary>
        <div className="max-h-48 overflow-auto">
          <table className="w-full text-start font-mono text-xs tabular-nums">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-1 text-start">{t("column.time")}</th>
                {names.map((name, i) => (
                  <th key={used[i].id} scope="col" className="px-2 py-1 text-start">{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableCapped.map((row, i) => (
                <tr key={tableStart + i}>
                  <td className="px-2 py-1">{ms(row.tNs)}</td>
                  {row.values.map((v, c) => (
                    <td key={used[c].id} className="px-2 py-1">{num(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {pwm.length > 0 ? <span className="sr-only" aria-live="polite">{pwm.map(([id, p]) => `${nameOf(id)}: ${t("scope.pwm", { duty: (p.duty * 100).toFixed(1), hz: p.hz.toFixed(1) })}`).join(". ")}</span> : null}
    </section>
  );
}

export type ScopeProps = Omit<CaptureViewProps, "testId" | "annotate" | "vcd">;

export function Scope(props: ScopeProps) {
  return <CaptureView {...props} testId="scope" />;
}
