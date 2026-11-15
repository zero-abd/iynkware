/** The session controls' words, in six languages. */
import { defineCopy } from '../copy';

export const SESSION = defineCopy({
  en: { home: 'Home', recentre: 'Recentre', exit: 'Exit', hold: 'Hold' },
  de: { home: 'Start', recentre: 'Neu zentrieren', exit: 'Beenden', hold: 'Halten' },
  es: { home: 'Inicio', recentre: 'Recentrar', exit: 'Salir', hold: 'Mantén' },
  fr: { home: 'Accueil', recentre: 'Recentrer', exit: 'Quitter', hold: 'Maintenir' },
  hi: { home: 'होम', recentre: 'फिर केंद्र में', exit: 'बाहर निकलें', hold: 'दबाए रखें' },
  zh: { home: '主页', recentre: '重新居中', exit: '退出', hold: '按住' },
});
