/**
 * What the part views say: the chip over a part that reads out a value, and the one over a part the simulator does not
 * model yet. Units (`V`, `cm`, `rpm`) are the same in every language and pass through as the simulator reports them;
 * the labels the simulator gives a reading (`out`, `dist`) are translated when this table knows them.
 */
import { defineStrings } from '../kit/strings';

export const viewStrings = defineStrings({
  en: {
    notSimulated: 'Not simulated yet',
    out: 'out',
    dist: 'dist',
    angle: 'angle',
    temp: 'temp',
    light: 'light',
  },
  de: {
    notSimulated: 'Noch nicht simuliert',
    out: 'Ausgang',
    dist: 'Abstand',
    angle: 'Winkel',
    temp: 'Temp.',
    light: 'Licht',
  },
  es: {
    notSimulated: 'Aún sin simular',
    out: 'salida',
    dist: 'dist.',
    angle: 'ángulo',
    temp: 'temp.',
    light: 'luz',
  },
  fr: {
    notSimulated: 'Pas encore simulé',
    out: 'sortie',
    dist: 'dist.',
    angle: 'angle',
    temp: 'temp.',
    light: 'lumière',
  },
  hi: {
    notSimulated: 'अभी सिमुलेट नहीं हुआ',
    out: 'आउटपुट',
    dist: 'दूरी',
    angle: 'कोण',
    temp: 'तापमान',
    light: 'रोशनी',
  },
  zh: {
    notSimulated: '尚未模拟',
    out: '输出',
    dist: '距离',
    angle: '角度',
    temp: '温度',
    light: '光照',
  },
});

type Key = keyof typeof viewStrings.table.en;
const KNOWN = new Set<string>(Object.keys(viewStrings.table.en));

/** A reading's label in `lang` when the table has it (`out`, `dist`), else the label as the simulator gave it. */
export function labelText(label: string, lang: Parameters<typeof viewStrings.t>[0]): string {
  const key = label.trim().toLowerCase();
  if (key === 'notsimulated' || !KNOWN.has(key)) return label.trim();
  return viewStrings.t(lang, key as Key);
}
