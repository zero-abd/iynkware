/** Pillar 6, Shell: menus and settings in the headset. The 2D launcher lives in the Next app. */
import { composeModules } from '../compose';
import { menuModule } from './menu';

export const shellModule = composeModules('shell', [menuModule]);
