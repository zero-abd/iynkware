/**
 * The fault lab's words in six languages. Cause names and their Why are iynk's own (`faults.json` `cause.<id>`), so the
 * headset and the 2D Break it say the same; the rest is new here.
 */
import de from '@/i18n/messages/de/faults.json';
import en from '@/i18n/messages/en/faults.json';
import es from '@/i18n/messages/es/faults.json';
import fr from '@/i18n/messages/fr/faults.json';
import hi from '@/i18n/messages/hi/faults.json';
import zh from '@/i18n/messages/zh/faults.json';
import type { Lang } from '../../contracts/common';
import { defineStrings } from '../kit/strings';

export const faultStrings = defineStrings({
  en: {
    title: 'Fault lab',
    kicker: 'BREAK IT',
    apply: 'Apply',
    reset: 'Reset faults',
    active: 'Broken now',
    takeBack: 'Take back',
    hint: 'Pick a fault, then Apply. Press Run to see the build react.',
    none: 'Nothing on this bench can be broken here.',
    more: 'More faults',
    dead: 'Dead part',
    short: 'Short',
    open: 'Open leg {pin}',
  },
  de: {
    title: 'Fehlerlabor',
    kicker: 'KAPUTT MACHEN',
    apply: 'Anwenden',
    reset: 'Fehler zurücksetzen',
    active: 'Gerade kaputt',
    takeBack: 'Zurücknehmen',
    hint: 'Wähle einen Fehler, dann Anwenden. Drücke Run und sieh, wie der Aufbau reagiert.',
    none: 'Auf diesem Tisch lässt sich hier nichts kaputt machen.',
    more: 'Weitere Fehler',
    dead: 'Bauteil tot',
    short: 'Kurzschluss',
    open: 'Bein {pin} offen',
  },
  es: {
    title: 'Laboratorio de fallos',
    kicker: 'ROMPERLO',
    apply: 'Aplicar',
    reset: 'Quitar fallos',
    active: 'Roto ahora',
    takeBack: 'Deshacer',
    hint: 'Elige un fallo y pulsa Aplicar. Pulsa Run para ver cómo reacciona el montaje.',
    none: 'Aquí no se puede romper nada de este banco.',
    more: 'Más fallos',
    dead: 'Pieza muerta',
    short: 'Cortocircuito',
    open: 'Pata {pin} abierta',
  },
  fr: {
    title: 'Labo de pannes',
    kicker: 'CASSE-LE',
    apply: 'Appliquer',
    reset: 'Effacer les pannes',
    active: 'En panne',
    takeBack: 'Annuler',
    hint: 'Choisis une panne, puis Appliquer. Appuie sur Run pour voir le montage réagir.',
    none: 'Rien sur cet établi ne peut être cassé ici.',
    more: 'Autres pannes',
    dead: 'Pièce morte',
    short: 'Court-circuit',
    open: 'Patte {pin} ouverte',
  },
  hi: {
    title: 'फ़ॉल्ट लैब',
    kicker: 'तोड़कर देखें',
    apply: 'लागू करें',
    reset: 'फ़ॉल्ट हटाएँ',
    active: 'अभी टूटा है',
    takeBack: 'वापस लें',
    hint: 'एक फ़ॉल्ट चुनें, फिर लागू करें। Run दबाकर देखें कि सर्किट कैसे बदलता है।',
    none: 'इस बेंच पर यहाँ कुछ भी तोड़ा नहीं जा सकता।',
    more: 'और फ़ॉल्ट',
    dead: 'पुर्ज़ा ख़राब',
    short: 'शॉर्ट',
    open: 'पिन {pin} खुला',
  },
  zh: {
    title: '故障实验室',
    kicker: '弄坏它',
    apply: '应用',
    reset: '清除故障',
    active: '当前故障',
    takeBack: '撤回',
    hint: '选一个故障，然后点应用。按 Run 看电路的反应。',
    none: '这个工作台上没有可以在这里弄坏的东西。',
    more: '更多故障',
    dead: '元件损坏',
    short: '短路',
    open: '引脚 {pin} 断开',
  },
});

const FAULTS = { en, de, es, fr, hi, zh } as const;
type CauseTexts = { title: string; why: string; fix: string };

/** iynk's words for a cause (title, why, fix), or null for a descriptor-local cause it has none for. */
export function causeText(lang: Lang, cause: string): CauseTexts | null {
  const table = (FAULTS[lang] ?? FAULTS.en).cause as Record<string, CauseTexts | undefined>;
  return table[cause] ?? (FAULTS.en.cause as Record<string, CauseTexts | undefined>)[cause] ?? null;
}
