import type { Locale } from "@/i18n/config";
import type { StudioMessages } from "@/i18n/namespaces";
import { createTranslator, type MessageParams } from "@/i18n/translate";
import type { StatusMessage } from "@/studio/stores/session";

export type StatusMessages = Pick<StudioMessages, "studio" | "studioEdit" | "studioInspect" | "studioWire">;

/** A status key is a message path in one Studio namespace, and its first word says which. */
const NAMESPACE_OF: Record<string, keyof StatusMessages> = {
  edit: "studioEdit",
  select: "studioInspect",
  wire: "studioWire",
  align: "studio",
  ops: "studio",
  selection: "studio",
};

type Say = (key: string, params?: MessageParams) => string;

/** The words for a status the tools set, or null for one that has none (a scene error has its own callout). */
export function createStatusText(lang: Locale, messages: StatusMessages): (status: StatusMessage | null) => string | null {
  const say = new Map<string, Say>();
  return (status) => {
    const namespace = status && NAMESPACE_OF[status.key.slice(0, status.key.indexOf("."))];
    if (!status || !namespace) return null;
    let t = say.get(namespace);
    if (!t) say.set(namespace, (t = createTranslator(lang, messages[namespace], `${lang}/${namespace}`) as Say));
    return t(status.key, status.params);
  };
}
