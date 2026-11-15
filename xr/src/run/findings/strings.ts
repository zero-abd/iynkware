/**
 * The findings' words. The rule texts (a finding's title, its Why and Fix, a fix's sentence, a burnt part's reason) are
 * iynk's own, read from its `faults` and `fidelity` message files so the headset and the 2D Studio say the same in
 * six languages. The few words of the card itself (Why, Fix, Fix it, Close) are this table.
 */
import faultsEn from '@/i18n/messages/en/faults.json';
import faultsDe from '@/i18n/messages/de/faults.json';
import faultsEs from '@/i18n/messages/es/faults.json';
import faultsFr from '@/i18n/messages/fr/faults.json';
import faultsHi from '@/i18n/messages/hi/faults.json';
import faultsZh from '@/i18n/messages/zh/faults.json';
import fidelityEn from '@/i18n/messages/en/fidelity.json';
import fidelityDe from '@/i18n/messages/de/fidelity.json';
import fidelityEs from '@/i18n/messages/es/fidelity.json';
import fidelityFr from '@/i18n/messages/fr/fidelity.json';
import fidelityHi from '@/i18n/messages/hi/fidelity.json';
import fidelityZh from '@/i18n/messages/zh/fidelity.json';
import type { Lang } from '../../contracts/common';
import { defineStrings, fill } from '../kit/strings';

export const findingStrings = defineStrings({
  en: {
    why: 'Why',
    fix: 'Fix',
    'fix-it': 'Fix it',
    close: 'Close',
    'from-run': 'From the run',
    'run-tag': 'Run',
    'while-editing': 'Check',
    error: 'Error',
    warning: 'Warning',
    note: 'Note',
    burnt: '{name} burnt out',
    fixed: 'Fixed. Undo takes it back.',
    'fix-failed': 'The fix did not apply.',
    'by-hand': 'No automatic fix. Change this by hand.',
    more: '{count} more',
  },
  de: {
    why: 'Warum',
    fix: 'Lösung',
    'fix-it': 'Beheben',
    close: 'Schließen',
    'from-run': 'Aus dem Lauf',
    'run-tag': 'Lauf',
    'while-editing': 'Prüfung',
    error: 'Fehler',
    warning: 'Warnung',
    note: 'Hinweis',
    burnt: '{name} durchgebrannt',
    fixed: 'Behoben. Mit Rückgängig machst du es rückgängig.',
    'fix-failed': 'Die Lösung wurde nicht angewendet.',
    'by-hand': 'Keine automatische Lösung. Ändere das von Hand.',
    more: '{count} weitere',
  },
  es: {
    why: 'Por qué',
    fix: 'Arreglo',
    'fix-it': 'Arreglar',
    close: 'Cerrar',
    'from-run': 'De la ejecución',
    'run-tag': 'Ejec.',
    'while-editing': 'Revisión',
    error: 'Error',
    warning: 'Aviso',
    note: 'Nota',
    burnt: '{name} se quemó',
    fixed: 'Arreglado. Deshacer lo revierte.',
    'fix-failed': 'El arreglo no se aplicó.',
    'by-hand': 'Sin arreglo automático. Cámbialo a mano.',
    more: '{count} más',
  },
  fr: {
    why: 'Pourquoi',
    fix: 'Correction',
    'fix-it': 'Corriger',
    close: 'Fermer',
    'from-run': 'De l’exécution',
    'run-tag': 'Exéc.',
    'while-editing': 'Contrôle',
    error: 'Erreur',
    warning: 'Alerte',
    note: 'Note',
    burnt: '{name} a grillé',
    fixed: 'Corrigé. Annuler revient en arrière.',
    'fix-failed': 'La correction n’a pas été appliquée.',
    'by-hand': 'Pas de correction automatique. Modifie-le à la main.',
    more: '{count} de plus',
  },
  hi: {
    why: 'क्यों',
    fix: 'सुधार',
    'fix-it': 'ठीक करें',
    close: 'बंद करें',
    'from-run': 'रन से',
    'run-tag': 'रन',
    'while-editing': 'जाँच',
    error: 'त्रुटि',
    warning: 'चेतावनी',
    note: 'नोट',
    burnt: '{name} जल गया',
    fixed: 'ठीक हो गया। पूर्ववत करने से वापस आ जाएगा।',
    'fix-failed': 'सुधार लागू नहीं हुआ।',
    'by-hand': 'कोई अपने आप होने वाला सुधार नहीं है। इसे हाथ से बदलें।',
    more: '{count} और',
  },
  zh: {
    why: '原因',
    fix: '修复',
    'fix-it': '修复',
    close: '关闭',
    'from-run': '来自运行',
    'run-tag': '运行',
    'while-editing': '检查',
    error: '错误',
    warning: '警告',
    note: '提示',
    burnt: '{name} 烧毁了',
    fixed: '已修复。撤销可以还原。',
    'fix-failed': '修复没有生效。',
    'by-hand': '没有自动修复。请手动修改。',
    more: '还有 {count} 个',
  },
});

type Tree = { readonly [k: string]: string | Tree };

const FAULTS: Readonly<Record<Lang, Tree>> = { en: faultsEn, de: faultsDe, es: faultsEs, fr: faultsFr, hi: faultsHi, zh: faultsZh };
const FIDELITY: Readonly<Record<Lang, Tree>> = { en: fidelityEn, de: fidelityDe, es: fidelityEs, fr: fidelityFr, hi: fidelityHi, zh: fidelityZh };

/** The text at a dotted path, or undefined. */
export function textAt(tree: Tree, path: string): string | undefined {
  let at: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (at === undefined || typeof at === 'string') return undefined;
    at = at[part];
  }
  return typeof at === 'string' ? at : undefined;
}

type Args = Readonly<Record<string, string | number>>;

/** `path` in the language, else in English, with `{name}` filled from `args`; undefined when neither has it. */
function message(trees: Readonly<Record<Lang, Tree>>, lang: Lang, path: string, args?: Args): string | undefined {
  const text = textAt(trees[lang], path) ?? textAt(trees.en, path);
  return text === undefined ? undefined : fill(text, args);
}

/** The fields of a finding the texts need. */
export interface FindingLike {
  readonly ruleId: string;
  readonly causeId: string;
  readonly messageKey: string;
  readonly args: Args;
}

/** A finding's title: iynk's cause title, else its own message, else the rule's id. */
export function findingTitle(lang: Lang, f: FindingLike): string {
  return message(FAULTS, lang, `cause.${f.causeId}.title`) ?? message(FAULTS, lang, f.messageKey, f.args) ?? f.ruleId;
}

/** Why it happens, or an empty string when the cause has no text. */
export function findingWhy(lang: Lang, f: FindingLike): string {
  return message(FAULTS, lang, `cause.${f.causeId}.why`) ?? '';
}

/** The cause's general advice (what to do, without the numbers of this circuit), or an empty string. */
export function findingAdvice(lang: Lang, f: FindingLike): string {
  return message(FAULTS, lang, `cause.${f.causeId}.fix`) ?? '';
}

/** A fix's sentence: `fix.led-series` with its arguments (a part reads as its refdes, ohms as a value). */
export function fixText(lang: Lang, messageKey: string, args: Args): string {
  const path = messageKey.startsWith('fix.') ? messageKey : `fix.${messageKey}`;
  return message(FAULTS, lang, path, args) ?? '';
}

/** A burnt part's reason: `why.key` is `fidelity.states.led`, its args name the part and the numbers. */
export function burntReason(lang: Lang, why: { key: string; args: Args }): string {
  const path = why.key.startsWith('fidelity.') ? why.key.slice('fidelity.'.length) : why.key;
  return message(FIDELITY, lang, path, why.args) ?? '';
}
