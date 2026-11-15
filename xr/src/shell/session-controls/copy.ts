/** The session controls' words, in six languages. */
import { defineCopy } from '../copy';

export const SESSION = defineCopy({
  en: { recentre: 'Recentre', exit: 'Exit', hold: 'Hold' },
  de: { recentre: 'Neu zentrieren', exit: 'Beenden', hold: 'Halten' },
  es: { recentre: 'Recentrar', exit: 'Salir', hold: 'Mantén' },
  fr: { recentre: 'Recentrer', exit: 'Quitter', hold: 'Maintenir' },
  hi: { recentre: 'फिर केंद्र में', exit: 'बाहर निकलें', hold: 'दबाए रखें' },
  zh: { recentre: '重新居中', exit: '退出', hold: '按住' },
});
