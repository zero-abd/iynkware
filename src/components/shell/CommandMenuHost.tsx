"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OPEN_KEYS_EVENT } from "@/components/settings/KeysDialog";
import type { CommandGroup } from "@/components/ui/CommandMenu";
import type { IconName } from "@/components/ui/icons";
import { LANG_COOKIE, LOCALES, LOCALE_NAMES, localizedPath, type Locale } from "@/i18n/config";
import { setSetting, useSettings, type ThemeSetting } from "@/lib/settings";
import type { IndexEntry, IndexGroup } from "./command-index";
import { NAV, showNavEntry, type NavId } from "./nav";

export const OPEN_COMMAND_EVENT = "iynk:open-command";

export type CommandLabels = {
  title: string;
  placeholder: string;
  empty: string;
  groups: { pages: string; actions: string; theme: string; language: string; boards: string; lessons: string; robotics: string; drones: string; studio: string };
  nav: Record<NavId, string>;
  keys: string;
  sound: { on: string; off: string };
  motion: { on: string; off: string };
  theme: Record<ThemeSetting, string>;
};

const PAGE_ICONS: Record<NavId, IconName> = {
  dashboard: "house",
  studio: "code",
  boards: "board",
  robotics: "robot",
  drones: "drone",
  together: "people",
  about: "info",
};

const CommandMenu = dynamic(() => import("@/components/ui/CommandMenu").then((m) => m.CommandMenu));

const THEMES: readonly ThemeSetting[] = ["system", "light", "dark"];

const INDEX_GROUPS: readonly { id: IndexGroup; icon: IconName }[] = [
  { id: "boards", icon: "board" },
  { id: "lessons", icon: "book" },
  { id: "robotics", icon: "robot" },
  { id: "drones", icon: "drone" },
  { id: "studio", icon: "code" },
];

/** Rows one index group shows for a query; the rest appear as the query gets longer. */
const INDEX_GROUP_LIMIT = 5;

/** Ctrl+K deletes to the end of the line in CodeMirror on a Mac, so the shortcut leaves it alone there. */
function claimsShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return false;
  const inEditor = document.activeElement?.closest(".cm-editor");
  return !(inEditor && !event.metaKey && /Mac|iPhone|iPad/.test(navigator.platform));
}

/** Owns the command menu: opens on Ctrl+K or Cmd+K and on OPEN_COMMAND_EVENT, and builds the pages, actions, themes and languages it lists. */
export function CommandMenuHost({ lang, labels }: { lang: Locale; labels: CommandLabels }) {
  const router = useRouter();
  const pathname = usePathname() ?? `/${lang}`;
  const { sound, reduceMotion } = useSettings();
  const [open, setOpen] = useState(false);
  const [wasOpened, setWasOpened] = useState(false);
  const [index, setIndex] = useState<{ lang: Locale; entries: IndexEntry[] } | null>(null);
  if (open && !wasOpened) setWasOpened(true);

  // The boards, lessons, benches and examples are a chunk of their own, fetched the first time the menu opens.
  useEffect(() => {
    if (!wasOpened) return;
    let current = true;
    void import("./command-index").then((m) => current && setIndex({ lang, entries: m.buildCommandIndex(lang) }));
    return () => {
      current = false;
    };
  }, [wasOpened, lang]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!claimsShortcut(event)) return;
      event.preventDefault();
      setOpen((was) => !was);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  const pageGroups: CommandGroup[] = [
    {
      id: "pages",
      label: labels.groups.pages,
      items: NAV.filter((entry) => showNavEntry(entry, "sheet")).map((entry) => ({
        id: `page-${entry.id}`,
        label: labels.nav[entry.id],
        icon: PAGE_ICONS[entry.id],
        onSelect: () => router.push(`/${lang}${entry.href}`),
      })),
    },
    {
      id: "actions",
      label: labels.groups.actions,
      items: [
        {
          id: "keys",
          label: labels.keys,
          icon: "key",
          onSelect: () => window.dispatchEvent(new CustomEvent(OPEN_KEYS_EVENT)),
        },
        {
          id: "sound",
          label: sound ? labels.sound.off : labels.sound.on,
          icon: sound ? "sound-off" : "sound-on",
          onSelect: () => {
            setSetting("sound", !sound);
            // Choosing the item is the gesture the browser needs before it lets a page make sound.
            void import("@/lib/sound").then((audio) => (sound ? audio.silence() : audio.startSound()));
          },
        },
        {
          id: "motion",
          label: reduceMotion ? labels.motion.off : labels.motion.on,
          icon: "sliders",
          onSelect: () => setSetting("reduceMotion", !reduceMotion),
        },
      ],
    },
    {
      id: "theme",
      label: labels.groups.theme,
      items: THEMES.map((theme) => ({
        id: `theme-${theme}`,
        label: labels.theme[theme],
        icon: "settings",
        onSelect: () => setSetting("theme", theme),
      })),
    },
    {
      id: "language",
      label: labels.groups.language,
      items: LOCALES.map((code) => ({
        id: `language-${code}`,
        label: LOCALE_NAMES[code],
        icon: "globe",
        onSelect: () => {
          if (code === lang) return;
          document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
          router.push(`${localizedPath(pathname, code)}${window.location.search}${window.location.hash}`);
        },
      })),
    },
  ];

  const found = index?.lang === lang ? index.entries : [];
  const openEntry = (href: string) => {
    const hash = href.indexOf("#");
    // The Studio reads its hash, and a push to the same page with a new hash does not tell it.
    if (hash >= 0 && pathname === `/${lang}${href.slice(0, hash)}`) window.location.assign(href.slice(hash));
    else router.push(`/${lang}${href}`);
  };
  const indexGroups: CommandGroup[] = INDEX_GROUPS.map(({ id, icon }) => ({
    id,
    label: labels.groups[id],
    searchOnly: true,
    limit: INDEX_GROUP_LIMIT,
    items: found.filter((entry) => entry.group === id).map((entry) => ({ id: entry.id, label: entry.label, icon, onSelect: () => openEntry(entry.href) })),
  }));

  if (!wasOpened) return null;
  return <CommandMenu open={open} onClose={() => setOpen(false)} label={labels.title} placeholder={labels.placeholder} emptyLabel={labels.empty} groups={[...pageGroups, ...indexGroups]} />;
}
