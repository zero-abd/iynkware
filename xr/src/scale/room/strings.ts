/** Room size strings, six languages. */
import type { Strings } from '../kit/text';

export const ROOM_STRINGS = {
  en: { title: 'Room size', back: 'Back to bench' },
  de: { title: 'Raumgröße', back: 'Zurück zur Werkbank' },
  es: { title: 'Tamaño sala', back: 'Volver al banco' },
  fr: { title: 'Taille pièce', back: 'Retour à l’établi' },
  hi: { title: 'कमरे का आकार', back: 'बेंच पर वापस' },
  zh: { title: '房间尺寸', back: '返回工作台' },
} satisfies Strings<'title' | 'back'>;
