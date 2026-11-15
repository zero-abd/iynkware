/**
 * What the data panel can capture: the lab clock and every number the items on the bench report or are set to
 * (a pendulum's angle, period and length; a meter's reading; a generator's frequency …). Pure, tested headless.
 */
import type { Lang } from '../../contracts/common';
import { notesOf } from '../model/catalogue';
import type { PlacedItem } from '../model/store';
import type { Report } from '../model/types';
import { say } from '../text';

export interface Channel {
  /** `time`, or `<item id>:<key>`. */
  readonly id: string;
  readonly label: string;
}

export const TIME = 'time';

/** Labels for keys whose names do not say their unit. */
const UNITS: Readonly<Record<string, string>> = { length: 'mm', amplitude: '°', angleDeg: '°', tS: 's', periodS: 's', periodSmallS: 's', bobGrams: 'g' };
const NAMES: Readonly<Record<string, string>> = { angleDeg: 'angle', tS: 'time since release', periodS: 'period', periodSmallS: 'period (small angle)', bobGrams: 'bob mass' };

/** Every numeric channel now: the clock first, then each item's readings, then its settings. */
export function channelsOf(items: readonly PlacedItem[], report: (id: string) => Report | null, lang: Lang, timeLabel: string): Channel[] {
  const out: Channel[] = [{ id: TIME, label: timeLabel }];
  for (const it of items) {
    const name = it.label ?? say(notesOf(it.kind).name, lang);
    const seen = new Set<string>();
    const add = (key: string, v: unknown) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || seen.has(key) || /^r\d[LTA]$|^records$/.test(key)) return;
      seen.add(key);
      const unit = UNITS[key];
      out.push({ id: `${it.id}:${key}`, label: `${name} · ${NAMES[key] ?? key}${unit ? ` (${unit})` : ''}` });
    };
    for (const [k, v] of Object.entries(report(it.id) ?? {})) add(k, v);
    for (const [k, v] of Object.entries(it.state.p)) add(k, v);
  }
  return out;
}

/** A channel's value now, or null when it is gone or not a number. */
export function valueOf(id: string, nowMs: number, get: (itemId: string) => PlacedItem | undefined, report: (id: string) => Report | null): number | null {
  if (id === TIME) return nowMs / 1000;
  const at = id.indexOf(':');
  const itemId = id.slice(0, at);
  const key = id.slice(at + 1);
  const r = report(itemId)?.[key];
  if (typeof r === 'number') return r;
  const p = get(itemId)?.state.p[key];
  return typeof p === 'number' ? p : null;
}

/** The default Y: a live reading that moves (angle, a meter, a voltage), else the first item channel, else time. */
export function defaultY(channels: readonly Channel[]): string {
  const live = channels.find((c) => /:(angleDeg|volts|v|reading|value|ph|temp)/i.test(c.id));
  return (live ?? channels[1] ?? channels[0]!).id;
}

/** Nice axis bounds around values (a little margin, never zero span). */
export function boundsOf(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const m = (hi - lo) * 0.05;
  return [lo - m, hi + m];
}
