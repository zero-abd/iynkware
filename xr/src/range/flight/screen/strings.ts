/** The screen's six-language strings: the view names, the View plate, the screen's kicker. */
import { defineStrings } from '../../shared';

export const SCREEN_STRINGS = defineStrings({
  en: { view: 'View', los: 'Line of sight', chase: 'Chase', fpv: 'FPV', kicker: 'CRAFT CAMERA' },
  de: { view: 'Ansicht', los: 'Sichtlinie', chase: 'Verfolger', fpv: 'FPV', kicker: 'FLUGKAMERA' },
  es: { view: 'Vista', los: 'Línea de vista', chase: 'Seguimiento', fpv: 'FPV', kicker: 'CÁMARA DEL DRON' },
  fr: { view: 'Vue', los: 'À vue', chase: 'Poursuite', fpv: 'FPV', kicker: 'CAMÉRA DU DRONE' },
  hi: { view: 'दृश्य', los: 'सीधी नज़र', chase: 'पीछा', fpv: 'FPV', kicker: 'ड्रोन कैमरा' },
  zh: { view: '视角', los: '目视', chase: '跟随', fpv: '第一人称', kicker: '飞行摄像头' },
});
