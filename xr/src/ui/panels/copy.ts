/** The words of movable panels, in the six languages (XR_DESIGN.md 9.5). Sentence case, no exclamation marks. */
import type { Lang, LocalizedText } from '../../contracts/common';

type Copy = Readonly<Record<Lang, string>> & LocalizedText;

export const PANELS_COPY: { readonly tidy: Copy } = {
  /** The menu row that puts every panel back in its default place. */
  tidy: {
    en: 'Tidy up',
    de: 'Aufräumen',
    es: 'Ordenar',
    fr: 'Ranger',
    hi: 'व्यवस्थित करें',
    zh: '整理',
  },
};
