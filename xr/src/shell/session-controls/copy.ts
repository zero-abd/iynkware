/** The session controls' words, in six languages. */
import { defineCopy } from '../copy';

export const SESSION = defineCopy({
  en: { home: 'Home', reset: 'Reset', recentre: 'Recentre', exit: 'Exit', hold: 'Hold' },
  de: { home: 'Start', reset: 'Zurücksetzen', recentre: 'Neu zentrieren', exit: 'Beenden', hold: 'Halten' },
  es: { home: 'Inicio', reset: 'Reiniciar', recentre: 'Recentrar', exit: 'Salir', hold: 'Mantén' },
  fr: { home: 'Accueil', reset: 'Réinitialiser', recentre: 'Recentrer', exit: 'Quitter', hold: 'Maintenir' },
  hi: { home: 'होम', reset: 'रीसेट', recentre: 'फिर केंद्र में', exit: 'बाहर निकलें', hold: 'दबाए रखें' },
  zh: { home: '主页', reset: '重置', recentre: '重新居中', exit: '退出', hold: '按住' },
});
