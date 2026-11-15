/** Six-language strings of the edit module: the reasons a release did not seat (design 3.4.8). Keys prefixed `edit.`. */
import type { Lang } from '../../contracts/common';
import type { ActionRefusal } from '../core/actions';
import { refusalText } from '../core/actions';
import { table, tr } from '../core/text';

export const editStrings = table({
  en: {
    'edit.hole-taken': '{hole} is taken by {holder}',
    'edit.off-grid': 'Pin {pin} would land on no hole',
    'edit.not-seated': 'Not seated here',
    'edit.removed': '{name} back on the shelf',
  },
  de: {
    'edit.hole-taken': '{hole} ist von {holder} belegt',
    'edit.off-grid': 'Pin {pin} landet in keinem Loch',
    'edit.not-seated': 'Hier nicht eingesetzt',
    'edit.removed': '{name} zurück ins Regal',
  },
  es: {
    'edit.hole-taken': '{hole} está ocupado por {holder}',
    'edit.off-grid': 'El pin {pin} no cae en ningún orificio',
    'edit.not-seated': 'No encaja aquí',
    'edit.removed': '{name} de vuelta en el estante',
  },
  fr: {
    'edit.hole-taken': '{hole} est occupé par {holder}',
    'edit.off-grid': 'La broche {pin} ne tombe dans aucun trou',
    'edit.not-seated': 'Ne se place pas ici',
    'edit.removed': "{name} remis sur l'étagère",
  },
  hi: {
    'edit.hole-taken': '{hole} पर {holder} पहले से लगा है',
    'edit.off-grid': 'पिन {pin} किसी छेद में नहीं बैठता',
    'edit.not-seated': 'यहाँ नहीं बैठता',
    'edit.removed': '{name} शेल्फ़ पर वापस',
  },
  zh: {
    'edit.hole-taken': '{hole} 已被 {holder} 占用',
    'edit.off-grid': '引脚 {pin} 没有对准任何孔',
    'edit.not-seated': '无法插在这里',
    'edit.removed': '{name} 放回了货架',
  },
});

/** The sentence for a refusal: iynk's own words where it has them, else this module's. */
export function reasonText(lang: Lang, refusal: Pick<ActionRefusal, 'reason' | 'args'>): string {
  const iynk = refusalText(lang, refusal);
  if (iynk !== null) return iynk;
  if (refusal.reason === 'hole-taken') return tr(editStrings, lang, 'edit.hole-taken', refusal.args);
  if (refusal.reason === 'off-grid') return tr(editStrings, lang, 'edit.off-grid', refusal.args);
  return tr(editStrings, lang, 'edit.not-seated');
}
