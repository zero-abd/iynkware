/** Zoom strings, six languages. */
import type { Strings } from '../kit/text';

export const ZOOM_STRINGS = {
  en: { smaller: 'Smaller', scale: 'Scale', larger: 'Larger', step: '{x}×' },
  de: { smaller: 'Kleiner', scale: 'Maßstab', larger: 'Größer', step: '{x}×' },
  es: { smaller: 'Menor', scale: 'Escala', larger: 'Mayor', step: '{x}×' },
  fr: { smaller: 'Plus petit', scale: 'Échelle', larger: 'Plus grand', step: '{x}×' },
  hi: { smaller: 'छोटा', scale: 'पैमाना', larger: 'बड़ा', step: '{x}×' },
  zh: { smaller: '缩小', scale: '比例', larger: '放大', step: '{x}×' },
} satisfies Strings<'smaller' | 'scale' | 'larger' | 'step'>;
