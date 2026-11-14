import type { ReactNode } from "react";
import { Wrap } from "@/components/editorial/Editorial";
import { Stamp, type StampMotif, type StampTone } from "@/components/editorial/Stamp";
import type { DashItem } from "@/components/shell/dashboard/data";
import { Reveal } from "@/components/ui";
import type { Locale } from "@/i18n/config";
import { FIRST_RUN_LESSON, FIRST_RUN_PARAM } from "@/lib/boardlab/first-run";

export const WORKBENCH_HREF = "/boards/uno-r3";

/**
 * Where "Open the workbench" goes: the Uno R3's Blink lesson with its first-run tip, else the first lesson, else
 * the board page.
 */
export function workbenchHref(lang: Locale, uno?: DashItem): string {
  const lessons = uno?.entries.filter((entry) => entry.kind === "lesson") ?? [];
  const blink = lessons.find((entry) => entry.href.endsWith(`/${FIRST_RUN_LESSON}`));
  if (blink) return `${blink.href}?${FIRST_RUN_PARAM}=1`;
  return lessons[0]?.href ?? `/${lang}${WORKBENCH_HREF}`;
}

type HomeSectionProps = {
  id: string;
  title: ReactNode;
  /** The stamp's denomination, usually the section number. */
  n: string;
  motif: StampMotif;
  tone?: StampTone;
  tilt?: number;
  children: ReactNode;
};

/** A landing section: a postage stamp and a small heading, then the content a little way below. */
export function HomeSection({ id, title, n, motif, tone, tilt, children }: HomeSectionProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className="mt-[clamp(56px,7vw,104px)]">
      <Wrap>
        <Reveal>
          <header className="flex items-center gap-3.5">
            <Stamp motif={motif} tone={tone} value={n} tilt={tilt} size={46} />
            <h2 id={titleId} className="min-w-0 flex-1 text-[18px] font-medium leading-snug tracking-[-0.014em] lang-air">
              {title}
            </h2>
          </header>
        </Reveal>
        {children}
      </Wrap>
    </section>
  );
}
