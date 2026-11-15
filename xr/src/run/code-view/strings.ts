/**
 * The Code window's words in six languages. The code itself is never translated, and neither are `delay`, `HIGH` and
 * `LOW` inside these lines: they are the sketch's own words. Step and Run match the run cluster's plates.
 */
import en from '@/i18n/messages/en/studioRun.json';
import de from '@/i18n/messages/de/studioRun.json';
import es from '@/i18n/messages/es/studioRun.json';
import fr from '@/i18n/messages/fr/studioRun.json';
import hi from '@/i18n/messages/hi/studioRun.json';
import zh from '@/i18n/messages/zh/studioRun.json';
import { defineStrings } from '../kit/strings';

export const codeStrings = defineStrings({
  en: {
    title: 'Code',
    ready: `Press Step or ${en.bar.run} to follow the code.`,
    delay: 'Waiting in delay: {elapsed} of {total} ms',
    wrote: 'Pin {pin} set {level}',
    untracked: 'Shown as written. The running line is marked for simple blink sketches only.',
    none: 'This project has no code.',
  },
  de: {
    title: 'Code',
    ready: `Drücke Schritt oder ${de.bar.run}, um dem Code zu folgen.`,
    delay: 'Wartet in delay: {elapsed} von {total} ms',
    wrote: 'Pin {pin} auf {level} gesetzt',
    untracked: 'So wie geschrieben. Die laufende Zeile wird nur bei einfachen Blink-Sketches markiert.',
    none: 'Dieses Projekt hat keinen Code.',
  },
  es: {
    title: 'Código',
    ready: `Pulsa Paso o ${es.bar.run} para seguir el código.`,
    delay: 'Esperando en delay: {elapsed} de {total} ms',
    wrote: 'Pin {pin} puesto en {level}',
    untracked: 'Tal como está escrito. La línea en ejecución solo se marca en sketches de parpadeo sencillos.',
    none: 'Este proyecto no tiene código.',
  },
  fr: {
    title: 'Code',
    ready: `Appuie sur Pas à pas ou ${fr.bar.run} pour suivre le code.`,
    delay: 'En attente dans delay : {elapsed} sur {total} ms',
    wrote: 'Broche {pin} mise à {level}',
    untracked: 'Tel qu’écrit. La ligne en cours n’est marquée que pour les croquis de clignotement simples.',
    none: 'Ce projet n’a pas de code.',
  },
  hi: {
    title: 'कोड',
    ready: `कोड के साथ चलने के लिए एक कदम या ${hi.bar.run} दबाएँ।`,
    delay: 'delay में रुका है: {total} में से {elapsed} ms',
    wrote: 'पिन {pin} को {level} किया',
    untracked: 'जैसा लिखा है वैसा। चल रही लाइन सिर्फ़ आसान ब्लिंक स्केच में दिखाई जाती है।',
    none: 'इस प्रोजेक्ट में कोई कोड नहीं है।',
  },
  zh: {
    title: '代码',
    ready: `按“单步”或“${zh.bar.run}”来跟着代码走。`,
    delay: '在 delay 中等待：{elapsed} / {total} 毫秒',
    wrote: '引脚 {pin} 设为 {level}',
    untracked: '按原样显示。只有简单的闪烁程序会标出正在运行的行。',
    none: '这个项目没有代码。',
  },
});

export type CodeKey = keyof typeof codeStrings.table.en;
