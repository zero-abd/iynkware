/** Insight strings, six languages. */
import type { Strings } from '../kit/text';

export const INSIGHT_STRINGS = {
  en: { seeThrough: 'See-through', takeApart: 'Take apart', all: 'All', labelled: '{what}: {target}' },
  de: { seeThrough: 'Durchsichtig', takeApart: 'Zerlegen', all: 'Alles', labelled: '{what}: {target}' },
  es: { seeThrough: 'Transparente', takeApart: 'Desmontar', all: 'Todo', labelled: '{what}: {target}' },
  fr: { seeThrough: 'Transparence', takeApart: 'Démonter', all: 'Tout', labelled: '{what} : {target}' },
  hi: { seeThrough: 'आर-पार', takeApart: 'खोलकर देखें', all: 'सब', labelled: '{what}: {target}' },
  zh: { seeThrough: '透视', takeApart: '拆开', all: '全部', labelled: '{what}：{target}' },
} satisfies Strings<'seeThrough' | 'takeApart' | 'all' | 'labelled'>;
