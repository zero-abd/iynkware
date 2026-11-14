import type { Locale } from "@/i18n/config";
import { LAB_TEMPLATES, TEMPLATES } from "../../../content/projects";

export type IndexGroup = "boards" | "lessons" | "robotics" | "drones" | "studio";

export type IndexEntry = {
  id: string;
  group: IndexGroup;
  label: string;
  /** Path under the language: a page, or the Studio with the example to open in its hash. */
  href: string;
};

type Titled = { title: Record<string, string> };
const titleOf = (entry: Titled, lang: Locale) => entry.title[lang] ?? entry.title.en;

/**
 * Everything the command menu can open besides its own pages: the boards, their lessons, the robotics benches,
 * the drones and the Studio examples, named in the page's language. It reads the template index the Studio
 * already uses, so a new board or bench is found with no second list to keep.
 */
export function buildCommandIndex(lang: Locale): IndexEntry[] {
  const boardTitle = new Map(TEMPLATES.filter((t) => t.kind === "tour").map((t) => [t.catalogue.id, titleOf(t, lang)]));
  const benchTitle = new Map(LAB_TEMPLATES.filter((t) => t.kind === "bench").map((t) => [t.catalogue.id, titleOf(t, lang)]));

  const fromBoards = TEMPLATES.map((t): IndexEntry => {
    const { id, child } = t.catalogue;
    if (t.kind === "tour") return { id: t.id, group: "boards", label: titleOf(t, lang), href: `/boards/${id}` };
    return { id: t.id, group: "lessons", label: `${titleOf(t, lang)} · ${boardTitle.get(id) ?? id}`, href: `/boards/${id}/${child}` };
  });
  const fromLabs = LAB_TEMPLATES.map((t): IndexEntry => {
    const { id } = t.catalogue;
    if (t.kind === "bench") return { id: t.id, group: "robotics", label: titleOf(t, lang), href: `/robotics/${id}` };
    if (t.kind === "craft") return { id: t.id, group: "drones", label: titleOf(t, lang), href: `/drones/${id}` };
    return { id: t.id, group: "studio", label: `${titleOf(t, lang)} · ${benchTitle.get(t.bench ?? "") ?? t.bench}`, href: `/studio#/t/${t.id}` };
  });
  return [...fromBoards, ...fromLabs];
}
