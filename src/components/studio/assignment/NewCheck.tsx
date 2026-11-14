"use client";

import { useState } from "react";
import { Button, Select } from "@/components/ui";
import type { Project } from "@/project/generated/types";
import { ANALOG_KINDS, type AnalogKind, type AssignmentCheck } from "@/studio/assignment/types";
import type { AssignmentT } from "./describe";
import { NumberInput, numberOf } from "./NumberInput";

type Props = { project: Project; ids: ReadonlySet<string>; t: AssignmentT; onAdd(check: AssignmentCheck): void };

type Form = { kind: AnalogKind; part: string; pin: string; from: string; to: string; atMs: string; windowMs: string };

const DEFAULTS: Record<AnalogKind, Pick<Form, "from" | "to" | "atMs" | "windowMs">> = {
  "pin-volts": { from: "0", to: "5", atMs: "1000", windowMs: "1000" },
  "part-amps": { from: "0.001", to: "0.02", atMs: "1000", windowMs: "1000" },
  "pin-frequency": { from: "1", to: "1000", atMs: "3000", windowMs: "2000" },
  "no-errors": { from: "0", to: "0", atMs: "0", windowMs: "0" },
};

const NEEDS_PIN: readonly AnalogKind[] = ["pin-volts", "pin-frequency"];
const NEEDS_RANGE: readonly AnalogKind[] = ["pin-volts", "part-amps", "pin-frequency"];

const parts = (project: Project) => [...project.boards, ...project.components];

/** The pins a part offers a check: the ones its pinned interface lists, without the mechanical ones. */
function pinsOf(project: Project, part: string): string[] {
  const def = parts(project).find((p) => p.id === part)?.definition;
  const dep = def && project.dependencies.components.find((d) => d.ref === def.ref && d.version === def.version);
  return (dep?.interface.pins ?? []).filter((p) => p.type !== "mechanical").map((p) => p.id);
}

const nextId = (ids: ReadonlySet<string>): string => {
  let n = 1;
  while (ids.has(`a${n}`)) n++;
  return `a${n}`;
};

/** The form for the checks that read the circuit: a part, a pin and a range. The project's own kinds are made in its Checks tab. */
export function NewCheck({ project, ids, t, onAdd }: Props) {
  const first = parts(project)[0]?.id ?? "";
  const [form, setForm] = useState<Form>({ kind: "pin-volts", part: first, pin: pinsOf(project, first)[0] ?? "", ...DEFAULTS["pin-volts"] });
  const [invalid, setInvalid] = useState(false);
  const pins = pinsOf(project, form.part);
  const set = (change: Partial<Form>) => {
    setInvalid(false);
    setForm((now) => ({ ...now, ...change }));
  };

  function add() {
    const { kind } = form;
    const base = { id: nextId(ids) };
    if (kind === "no-errors") return onAdd({ ...base, kind });
    const lo = numberOf(form.from);
    const hi = numberOf(form.to);
    const atMs = numberOf(form.atMs);
    const windowMs = numberOf(form.windowMs);
    const chosen = parts(project).find((p) => p.id === form.part);
    const partOk = chosen !== undefined;
    const pinOk = !NEEDS_PIN.includes(kind) || pins.includes(form.pin);
    if (!partOk || !pinOk || lo === null || hi === null || lo > hi || atMs === null || !Number.isInteger(atMs) || atMs < 0) return setInvalid(true);
    const part = { part: chosen.id, refdes: chosen.refdes, ref: chosen.definition.ref };
    if (kind === "pin-volts") return onAdd({ ...base, kind, ...part, pin: form.pin, volts: [lo, hi], atMs });
    if (kind === "part-amps") return onAdd({ ...base, kind, ...part, amps: [lo, hi], atMs });
    if (windowMs === null || !Number.isInteger(windowMs) || windowMs <= 0 || windowMs > atMs || lo < 0) return setInvalid(true);
    onAdd({ ...base, kind, ...part, pin: form.pin, hz: [lo, hi], atMs, windowMs });
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-rule p-3">
      <legend className="px-1 text-sm font-semibold">{t("make.add")}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label={t("make.kindField")} value={form.kind} onChange={(e) => set({ kind: e.target.value as AnalogKind, ...DEFAULTS[e.target.value as AnalogKind] })}>
          {ANALOG_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </Select>
        {form.kind === "no-errors" ? null : (
          <Select label={t("make.partField")} value={form.part} onChange={(e) => set({ part: e.target.value, pin: pinsOf(project, e.target.value)[0] ?? "" })}>
            {parts(project).map((p) => (
              <option key={p.id} value={p.id}>
                {p.refdes}
              </option>
            ))}
          </Select>
        )}
        {NEEDS_PIN.includes(form.kind) ? (
          <Select label={t("make.pinField")} value={form.pin} onChange={(e) => set({ pin: e.target.value })}>
            {pins.map((pin) => (
              <option key={pin} value={pin}>
                {pin}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      {NEEDS_RANGE.includes(form.kind) ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberInput label={t("make.fromField")} value={form.from} onChange={(from) => set({ from })} />
          <NumberInput label={t("make.toField")} value={form.to} onChange={(to) => set({ to })} />
          <NumberInput label={t("make.atField")} value={form.atMs} onChange={(atMs) => set({ atMs })} />
          {form.kind === "pin-frequency" ? <NumberInput label={t("make.windowField")} value={form.windowMs} onChange={(windowMs) => set({ windowMs })} /> : null}
        </div>
      ) : null}
      {invalid ? (
        <p role="alert" className="text-sm text-bad">
          {t("make.invalid")}
        </p>
      ) : null}
      <div>
        <Button variant="secondary" size="sm" onClick={add}>
          {t("make.addButton")}
        </Button>
      </div>
    </fieldset>
  );
}
