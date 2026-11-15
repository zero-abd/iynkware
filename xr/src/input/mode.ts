/**
 * The quick input switch: B on the right controller toggles hands off (controllers only, hands are ignored even when
 * tracked) and on (hand tracking drives the app, idle controllers are ignored). Until the first press both drive it
 * (`auto`, the headset decides per side), so the first press turns hands off. Pure: the service reads the button and
 * applies `blocks` to each side's pointers every frame.
 */
import type { Lang } from '../contracts/common';
import type { PointerSource } from '../contracts/input';

export type InputMode = 'auto' | 'hands' | 'controllers';

/** True when `mode` ignores a side whose primary source is `primary`: hands under `controllers`, and the reverse. */
export function blocks(mode: InputMode, primary: PointerSource | null): boolean {
  if (mode === 'controllers') return primary === 'hand';
  if (mode === 'hands') return primary === 'controller';
  return false;
}

/** The mode a press of B moves to: hands off from `auto` or `hands`, hands on from `controllers`. */
export function toggled(mode: InputMode): Exclude<InputMode, 'auto'> {
  return mode === 'controllers' ? 'hands' : 'controllers';
}

export const MODE_LINES: Readonly<Record<Exclude<InputMode, 'auto'>, Readonly<Record<Lang, string>>>> = {
  hands: {
    en: 'Hands on: put the controllers down',
    de: 'Hände an: Controller ablegen',
    es: 'Manos activadas: deja los mandos',
    fr: 'Mains activées : posez les manettes',
    hi: 'हाथ चालू: कंट्रोलर नीचे रखें',
    zh: '手势已开启：放下手柄',
  },
  controllers: {
    en: 'Controllers only: hands are ignored',
    de: 'Nur Controller: Hände werden ignoriert',
    es: 'Solo mandos: se ignoran las manos',
    fr: 'Manettes seules : les mains sont ignorées',
    hi: 'केवल कंट्रोलर: हाथ अनदेखे',
    zh: '仅手柄：忽略手势',
  },
};

/** The ticker line for a switch to `mode`, in `lang` (English when the language is missing). */
export function modeLine(mode: Exclude<InputMode, 'auto'>, lang: Lang): string {
  return MODE_LINES[mode][lang] ?? MODE_LINES[mode].en;
}
