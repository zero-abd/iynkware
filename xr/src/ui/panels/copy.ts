/** The words of movable panels and the calm layout's menu rows, in the six languages (XR_DESIGN.md 9.5). Sentence case, no exclamation marks. */
import type { Lang, LocalizedText } from '../../contracts/common';

type Copy = Readonly<Record<Lang, string>> & LocalizedText;

export const PANELS_COPY: { readonly tidy: Copy; readonly droneDesign: Copy } = {
  /** The menu row that puts every panel back in its default place. */
  tidy: {
    en: 'Tidy up',
    de: 'Aufräumen',
    es: 'Ordenar',
    fr: 'Ranger',
    hi: 'व्यवस्थित करें',
    zh: '整理',
  },
  /** The menu switch for the drone's design panel at the bench. */
  droneDesign: {
    en: 'Drone design',
    de: 'Drohnen-Entwurf',
    es: 'Diseño del dron',
    fr: 'Conception du drone',
    hi: 'ड्रोन डिज़ाइन',
    zh: '无人机设计',
  },
};
