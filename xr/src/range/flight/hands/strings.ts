/** The hand flight plates' six-language strings. */
import { defineStrings } from '../../shared';

export const HANDS_STRINGS = defineStrings({
  en: { arm: 'Arm', armHold: 'Hold to arm', disarm: 'Hold to disarm', rings: 'Rings', guide: 'Guide' },
  de: { arm: 'Scharf', armHold: 'Halten zum Scharfmachen', disarm: 'Halten zum Entschärfen', rings: 'Ringe', guide: 'Führen' },
  es: { arm: 'Armar', armHold: 'Mantén para armar', disarm: 'Mantén para desarmar', rings: 'Anillos', guide: 'Guía' },
  fr: { arm: 'Armer', armHold: 'Maintenir pour armer', disarm: 'Maintenir pour désarmer', rings: 'Anneaux', guide: 'Guidage' },
  hi: { arm: 'आर्म करो', armHold: 'आर्म के लिए दबाए रखो', disarm: 'डिसआर्म के लिए दबाए रखो', rings: 'रिंग', guide: 'गाइड' },
  zh: { arm: '解锁', armHold: '按住解锁', disarm: '按住上锁', rings: '环', guide: '引导' },
});
