/** The catalogue panel's words in the six languages. Level names come from iynk's Studio strings (`lesson.nav.level`). */
import { lesson as deLesson } from '@/i18n/messages/de/studio.json';
import { lesson as enLesson } from '@/i18n/messages/en/studio.json';
import { lesson as esLesson } from '@/i18n/messages/es/studio.json';
import { lesson as frLesson } from '@/i18n/messages/fr/studio.json';
import { lesson as hiLesson } from '@/i18n/messages/hi/studio.json';
import { lesson as zhLesson } from '@/i18n/messages/zh/studio.json';
import { createText, type Strings } from '../text';

interface Lesson {
  readonly nav: { readonly level: Readonly<Record<'intro' | 'io' | 'input' | 'analog' | 'protocol' | 'wireless' | 'project', string>> };
  readonly gallery: { readonly rung: { readonly tour: string } };
}

const studio = (l: unknown) => {
  const s = l as Lesson;
  return {
    'level.intro': s.nav.level.intro,
    'level.io': s.nav.level.io,
    'level.input': s.nav.level.input,
    'level.analog': s.nav.level.analog,
    'level.protocol': s.nav.level.protocol,
    'level.wireless': s.nav.level.wireless,
    'level.project': s.nav.level.project,
    tour: s.gallery.rung.tour,
  };
};

const EN = {
  ...studio(enLesson),
  title: 'Lessons',
  tabBoards: 'Boards',
  tabRobotics: 'Robotics',
  lessonsCount: '{done} of {total} lessons',
  tasksCount: '{done} of {total} tasks',
  steps: '{n} steps',
  bench: 'Bench',
  task: 'Task',
  previous: 'Previous',
  next: 'Next',
  pageOf: '{n} of {total}',
  close: 'Close',
  shownInEnglish: 'Shown in English',
};

export const CATALOGUE_STRINGS: Strings<typeof EN> = {
  en: EN,
  de: {
    ...studio(deLesson),
    title: 'Lektionen',
    tabBoards: 'Boards',
    tabRobotics: 'Robotik',
    lessonsCount: '{done} von {total} Lektionen',
    tasksCount: '{done} von {total} Aufgaben',
    steps: '{n} Schritte',
    bench: 'Werkbank',
    task: 'Aufgabe',
    previous: 'Zurück',
    next: 'Weiter',
    pageOf: '{n} von {total}',
    close: 'Schließen',
    shownInEnglish: 'Auf Englisch angezeigt',
  },
  es: {
    ...studio(esLesson),
    title: 'Lecciones',
    tabBoards: 'Placas',
    tabRobotics: 'Robótica',
    lessonsCount: '{done} de {total} lecciones',
    tasksCount: '{done} de {total} tareas',
    steps: '{n} pasos',
    bench: 'Banco',
    task: 'Tarea',
    previous: 'Anterior',
    next: 'Siguiente',
    pageOf: '{n} de {total}',
    close: 'Cerrar',
    shownInEnglish: 'Se muestra en inglés',
  },
  fr: {
    ...studio(frLesson),
    title: 'Leçons',
    tabBoards: 'Cartes',
    tabRobotics: 'Robotique',
    lessonsCount: '{done} sur {total} leçons',
    tasksCount: '{done} sur {total} tâches',
    steps: '{n} étapes',
    bench: 'Établi',
    task: 'Tâche',
    previous: 'Précédent',
    next: 'Suivant',
    pageOf: '{n} sur {total}',
    close: 'Fermer',
    shownInEnglish: 'Affiché en anglais',
  },
  hi: {
    ...studio(hiLesson),
    title: 'पाठ',
    tabBoards: 'बोर्ड',
    tabRobotics: 'रोबोटिक्स',
    lessonsCount: '{total} में से {done} पाठ',
    tasksCount: '{total} में से {done} कार्य',
    steps: '{n} चरण',
    bench: 'बेंच',
    task: 'कार्य',
    previous: 'पिछला',
    next: 'अगला',
    pageOf: '{total} में से {n}',
    close: 'बंद करें',
    shownInEnglish: 'अंग्रेज़ी में दिखाया गया',
  },
  zh: {
    ...studio(zhLesson),
    title: '课程',
    tabBoards: '开发板',
    tabRobotics: '机器人',
    lessonsCount: '已完成 {done}/{total} 节课',
    tasksCount: '已完成 {done}/{total} 项任务',
    steps: '{n} 步',
    bench: '工作台',
    task: '任务',
    previous: '上一页',
    next: '下一页',
    pageOf: '第 {n}/{total} 页',
    close: '关闭',
    shownInEnglish: '以英文显示',
  },
};

export const t = createText(CATALOGUE_STRINGS);
export type CatalogueKey = keyof typeof EN & string;
