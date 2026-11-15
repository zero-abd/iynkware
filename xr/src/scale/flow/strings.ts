/** Current flow strings, six languages. */
import type { Strings } from '../kit/text';

export const FLOW_STRINGS = {
  en: { row: 'Current flow', chip: 'conventional current' },
  de: { row: 'Stromfluss', chip: 'technische Stromrichtung' },
  es: { row: 'Flujo de corriente', chip: 'corriente convencional' },
  fr: { row: 'Flux de courant', chip: 'courant conventionnel' },
  hi: { row: 'धारा प्रवाह', chip: 'परंपरागत धारा' },
  zh: { row: '电流流动', chip: '常规电流方向' },
} satisfies Strings<'row' | 'chip'>;
