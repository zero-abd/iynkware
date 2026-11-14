/**
 * The guide panel's words in the six languages. Where iynk's Studio already has the string (`studio.json`, mostly
 * under `lesson.*`), it is read from there, so both products say the same thing; the rest is the headset's own.
 */
import { checks as deChecks, layout as deLayout, lesson as deLesson, workspace as deWorkspace } from '@/i18n/messages/de/studio.json';
import { checks as enChecks, layout as enLayout, lesson as enLesson, workspace as enWorkspace } from '@/i18n/messages/en/studio.json';
import { checks as esChecks, layout as esLayout, lesson as esLesson, workspace as esWorkspace } from '@/i18n/messages/es/studio.json';
import { checks as frChecks, layout as frLayout, lesson as frLesson, workspace as frWorkspace } from '@/i18n/messages/fr/studio.json';
import { checks as hiChecks, layout as hiLayout, lesson as hiLesson, workspace as hiWorkspace } from '@/i18n/messages/hi/studio.json';
import { checks as zhChecks, layout as zhLayout, lesson as zhLesson, workspace as zhWorkspace } from '@/i18n/messages/zh/studio.json';
import { createText, type Strings } from '../../text';

interface Studio {
  readonly lesson: {
    readonly guide: { readonly stepOf: string; readonly step: { readonly state: { readonly done: string } } };
    readonly checks: {
      readonly title: string;
      readonly run: string;
      readonly again: string;
      readonly pending: string;
      readonly running: string;
      readonly allPass: string;
      readonly summary: string;
      readonly textCheck: string;
      readonly empty: string;
      readonly limit: string;
      readonly hiddenNote: string;
    };
    readonly assembly: { readonly showMe: string };
  };
  readonly checks: { readonly pass: string; readonly fail: string };
  readonly layout: { readonly tabs: { readonly code: string } };
  readonly workspace: { readonly keys: { readonly close: string } };
}

const studio = (s: Studio) => ({
  stepOf: s.lesson.guide.stepOf,
  done: s.lesson.guide.step.state.done,
  tabChecks: s.lesson.checks.title,
  tabCode: s.layout.tabs.code,
  runChecks: s.lesson.checks.run,
  checkAgain: s.lesson.checks.again,
  notRun: s.lesson.checks.pending,
  running: s.lesson.checks.running,
  passed: s.checks.pass,
  failed: s.checks.fail,
  allPass: s.lesson.checks.allPass,
  summary: s.lesson.checks.summary,
  textCheck: s.lesson.checks.textCheck,
  noChecks: s.lesson.checks.empty,
  limit: s.lesson.checks.limit,
  hiddenNote: s.lesson.checks.hiddenNote,
  showMe: s.lesson.assembly.showMe,
  close: s.workspace.keys.close,
});

const pack = (lesson: unknown, checks: unknown, layout: unknown, workspace: unknown) => studio({ lesson, checks, layout, workspace } as Studio);

const EN = {
  ...pack(enLesson, enChecks, enLayout, enWorkspace),
  tabSteps: 'Steps',
  back: 'Back',
  next: 'Next',
  lessonDone: 'Lesson done',
  stepDone: 'Step done',
  shownInEnglish: 'Shown in English',
  runAgain: 'Run again to apply',
  noCode: 'This lesson has no code.',
  pick: 'Pick a value',
  on: 'On',
  off: 'Off',
  'reason.needs-analog': 'Needs the analog solver',
  'reason.no-source': 'The board has no code',
  'reason.no-board': 'The project has no board',
  'reason.unsupported-language': 'This board’s language cannot be checked here',
};

export const PANEL_STRINGS: Strings<typeof EN> = {
  en: EN,
  de: {
    ...pack(deLesson, deChecks, deLayout, deWorkspace),
    tabSteps: 'Schritte',
    back: 'Zurück',
    next: 'Weiter',
    lessonDone: 'Lektion geschafft',
    stepDone: 'Schritt erledigt',
    shownInEnglish: 'Auf Englisch angezeigt',
    runAgain: 'Zum Übernehmen erneut ausführen',
    noCode: 'Diese Lektion hat keinen Code.',
    pick: 'Wert wählen',
    on: 'An',
    off: 'Aus',
    'reason.needs-analog': 'Braucht den Analog-Löser',
    'reason.no-source': 'Das Board hat keinen Code',
    'reason.no-board': 'Das Projekt hat kein Board',
    'reason.unsupported-language': 'Die Sprache dieses Boards lässt sich hier nicht prüfen',
  },
  es: {
    ...pack(esLesson, esChecks, esLayout, esWorkspace),
    tabSteps: 'Pasos',
    back: 'Atrás',
    next: 'Siguiente',
    lessonDone: 'Lección terminada',
    stepDone: 'Paso hecho',
    shownInEnglish: 'Se muestra en inglés',
    runAgain: 'Vuelve a ejecutar para aplicarlo',
    noCode: 'Esta lección no tiene código.',
    pick: 'Elige un valor',
    on: 'Activado',
    off: 'Desactivado',
    'reason.needs-analog': 'Necesita el solucionador analógico',
    'reason.no-source': 'La placa no tiene código',
    'reason.no-board': 'El proyecto no tiene placa',
    'reason.unsupported-language': 'El lenguaje de esta placa no se puede comprobar aquí',
  },
  fr: {
    ...pack(frLesson, frChecks, frLayout, frWorkspace),
    tabSteps: 'Étapes',
    back: 'Retour',
    next: 'Suivant',
    lessonDone: 'Leçon terminée',
    stepDone: 'Étape terminée',
    shownInEnglish: 'Affiché en anglais',
    runAgain: 'Relancez pour appliquer',
    noCode: 'Cette leçon n’a pas de code.',
    pick: 'Choisissez une valeur',
    on: 'Activé',
    off: 'Désactivé',
    'reason.needs-analog': 'Demande le solveur analogique',
    'reason.no-source': 'La carte n’a pas de code',
    'reason.no-board': 'Le projet n’a pas de carte',
    'reason.unsupported-language': 'Le langage de cette carte ne peut pas être vérifié ici',
  },
  hi: {
    ...pack(hiLesson, hiChecks, hiLayout, hiWorkspace),
    tabSteps: 'चरण',
    back: 'पीछे',
    next: 'आगे',
    lessonDone: 'पाठ पूरा हुआ',
    stepDone: 'चरण पूरा हुआ',
    shownInEnglish: 'अंग्रेज़ी में दिखाया गया',
    runAgain: 'लागू करने के लिए फिर से चलाएँ',
    noCode: 'इस पाठ में कोई कोड नहीं है।',
    pick: 'मान चुनें',
    on: 'चालू',
    off: 'बंद',
    'reason.needs-analog': 'एनालॉग सॉल्वर चाहिए',
    'reason.no-source': 'बोर्ड में कोई कोड नहीं है',
    'reason.no-board': 'प्रोजेक्ट में कोई बोर्ड नहीं है',
    'reason.unsupported-language': 'इस बोर्ड की भाषा यहाँ जाँची नहीं जा सकती',
  },
  zh: {
    ...pack(zhLesson, zhChecks, zhLayout, zhWorkspace),
    tabSteps: '步骤',
    back: '上一步',
    next: '下一步',
    lessonDone: '本课完成',
    stepDone: '这一步完成了',
    shownInEnglish: '以英文显示',
    runAgain: '再运行一次才会生效',
    noCode: '本课没有代码。',
    pick: '选择一个值',
    on: '开',
    off: '关',
    'reason.needs-analog': '需要模拟求解器',
    'reason.no-source': '开发板上没有代码',
    'reason.no-board': '项目里没有开发板',
    'reason.unsupported-language': '这块开发板的语言无法在这里检查',
  },
};

export const t = createText(PANEL_STRINGS);
export type PanelKey = keyof typeof EN & string;
