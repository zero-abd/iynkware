/** Strings for the flat-screen bar (bar.ts), in all six languages. */
import { l6 } from '../../lab/text';

export const HOME_TEXT = {
  home: l6('Home', 'Start', 'Inicio', 'Accueil', 'होम', '主页'),
  restart: l6('Restart', 'Neu starten', 'Reiniciar', 'Redémarrer', 'फिर से शुरू करें', '重新开始'),
  exit: l6('Exit', 'Beenden', 'Salir', 'Quitter', 'बाहर निकलें', '退出'),
} as const;
