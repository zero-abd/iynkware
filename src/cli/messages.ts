import { isLocale, pickLocale, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/namespaces";
import { createTranslator, messageAt, type MessageKey, type Translate } from "@/i18n/translate";
import { describeInterop } from "@/components/studio/interopLoss";
import type { LossItem } from "@/export/loss";
import type { AssignmentT } from "@/components/studio/assignment/describe";
import type { Finding, FindingFix } from "@/sim/faults/types";

const CLI: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import("@/i18n/messages/en/cli.json"),
  de: () => import("@/i18n/messages/de/cli.json"),
  es: () => import("@/i18n/messages/es/cli.json"),
  fr: () => import("@/i18n/messages/fr/cli.json"),
  hi: () => import("@/i18n/messages/hi/cli.json"),
  zh: () => import("@/i18n/messages/zh/cli.json"),
};

const FAULTS: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import("@/i18n/messages/en/faults.json"),
  de: () => import("@/i18n/messages/de/faults.json"),
  es: () => import("@/i18n/messages/es/faults.json"),
  fr: () => import("@/i18n/messages/fr/faults.json"),
  hi: () => import("@/i18n/messages/hi/faults.json"),
  zh: () => import("@/i18n/messages/zh/faults.json"),
};

const ASSIGNMENT: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import("@/i18n/messages/en/assignment.json"),
  de: () => import("@/i18n/messages/de/assignment.json"),
  es: () => import("@/i18n/messages/es/assignment.json"),
  fr: () => import("@/i18n/messages/fr/assignment.json"),
  hi: () => import("@/i18n/messages/hi/assignment.json"),
  zh: () => import("@/i18n/messages/zh/assignment.json"),
};

const STUDIO: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import("@/i18n/messages/en/studio.json"),
  de: () => import("@/i18n/messages/de/studio.json"),
  es: () => import("@/i18n/messages/es/studio.json"),
  fr: () => import("@/i18n/messages/fr/studio.json"),
  hi: () => import("@/i18n/messages/hi/studio.json"),
  zh: () => import("@/i18n/messages/zh/studio.json"),
};

export interface Words {
  lang: Locale;
  t: Translate<Messages["cli"]>;
  /** What a graded assignment check says, in the language of the report. */
  assignment: AssignmentT;
  /** What an import loss item says. */
  loss(item: LossItem): string;
  /** What a finding says, in the language of the report. */
  finding(f: Finding): string;
  /** What a fix of a finding proposes. */
  fix(fix: FindingFix): string;
  /** A label that is plain text or one string per language. */
  label(label: string | Record<string, string | undefined>): string;
}

/** The language of the messages: `--lang`, then IYNK_LANG, then the shell's locale, then English. */
export function languageOf(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): Locale | null {
  if (flag !== undefined) return isLocale(flag) ? flag : null;
  const named = [env.IYNK_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG].filter((v): v is string => v !== undefined && v !== "");
  return pickLocale(named.map((v) => v.replace(/\..*$/, "")));
}

export async function loadWords(lang: Locale): Promise<Words> {
  const cli = (await CLI[lang]()).default as Messages["cli"];
  const faults = (await FAULTS[lang]()).default as Messages["faults"];
  const assignment = (await ASSIGNMENT[lang]()).default as Messages["assignment"];
  const studio = (await STUDIO[lang]()).default as Messages["studio"];
  const st = createTranslator(lang, studio, `${lang}/studio`);
  const ft = createTranslator(lang, faults, `${lang}/faults`);
  return {
    lang,
    t: createTranslator(lang, cli, `${lang}/cli`),
    assignment: createTranslator(lang, assignment, `${lang}/assignment`),
    finding(f) {
      const cause = `cause.${f.causeId}.title`;
      if (typeof messageAt(faults, cause) === "string") return ft(cause as MessageKey<Messages["faults"]>);
      return typeof messageAt(faults, f.messageKey) === "string" ? ft(f.messageKey as MessageKey<Messages["faults"]>, f.args) : f.ruleId;
    },
    loss: (item) => describeInterop(item, st) ?? item.message,
    fix: (fix) => ft(`fix.${fix.messageKey.slice("fix.".length)}` as MessageKey<Messages["faults"]>, fix.args),
    label: (label) => (typeof label === "string" ? label : (label[lang] ?? label.en ?? "")),
  };
}
