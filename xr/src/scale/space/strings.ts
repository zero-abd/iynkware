/** Space strings, six languages. */
import type { Strings } from '../kit/text';

export const SPACE_STRINGS = {
  en: { paperRoom: 'Paper room' },
  de: { paperRoom: 'Papierraum' },
  es: { paperRoom: 'Sala de papel' },
  fr: { paperRoom: 'Salle de papier' },
  hi: { paperRoom: 'कागज़ का कमरा' },
  zh: { paperRoom: '纸房间' },
} satisfies Strings<'paperRoom'>;
