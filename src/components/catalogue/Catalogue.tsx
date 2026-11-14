import type { ReactNode } from "react";
import Link from "next/link";
import { FigureStill } from "@/components/figure";
import { enter, eyebrow, typeClass } from "@/components/editorial/Editorial";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/icons";

/*
  The one layout behind the three lab indexes (/boards, /robotics, /drones): an editorial head with the count as a
  big number, then the items as a grid of cells split by hairlines. Every card has the same six rows (meta, figure,
  title, specs, tags, progress) as a subgrid, so the rows line up across a whole row of cards.
*/

export { eyebrow };

export function CataloguePage({ children }: { children: ReactNode }) {
  return (
    <div
      data-catalogue
      className="mx-auto w-full max-w-(--shell-max) px-(--shell-pad) pb-16 pt-6 md:pb-24 md:pt-12 [--cat-pad:--spacing(4)] lg:[--cat-pad:--spacing(6)]"
    >
      {children}
    </div>
  );
}

/** The count's own words with the number taken out: "12 boards" → "boards". */
function countWords(text: string, count: number): string {
  return text.replace(String(count), "").trim() || text;
}

export function CatalogueHead({
  ordinal,
  kicker,
  title,
  titleId,
  lede,
  count,
  countText,
  numberLocale,
  filter,
}: {
  /** "01": the lab's place among the three. */
  ordinal: string;
  kicker: string;
  title: string;
  titleId?: string;
  lede: string;
  count: number;
  /** The translated count, "12 boards"; the number is drawn big and the words sit under it. */
  countText: string;
  numberLocale: string;
  /** A <CatalogueFilter> at the end of the head. */
  filter?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-12 lg:items-end">
      <div className={cx("lg:col-span-7 xl:col-span-5", enter)}>
        <p className={cx(eyebrow, "flex items-center gap-3")}>
          <span className="tabular text-ink">{ordinal}</span>
          <span aria-hidden="true" className="h-px w-8 bg-current opacity-40" />
          <span>{kicker}</span>
        </p>
        <h1 id={titleId} className={cx(typeClass.display, "mt-4 max-w-[18ch] text-5xl! lg:text-7xl! sm:mt-6")}>
          {title}
        </h1>
      </div>
      <p className={cx("max-w-[52ch] text-base text-pretty text-muted lg:col-span-5 xl:col-span-3", enter)}>{lede}</p>
      <div className={cx("flex items-end justify-between gap-6 lg:col-span-12 xl:col-span-4 xl:justify-end xl:gap-10", enter)}>
        <p className="flex shrink-0 items-end gap-3 xl:flex-col xl:items-end xl:gap-1">
          <span className="tabular text-5xl font-semibold leading-none tracking-tight xl:text-7xl">
            {new Intl.NumberFormat(numberLocale).format(count)}
          </span>
          <span className={eyebrow}>{countWords(countText, count)}</span>
        </p>
        {filter}
      </div>
    </header>
  );
}

/**
 * A section of the index under its own heading on the left (the robotics months). Without a heading the grid runs
 * the full width.
 */
export function CatalogueGroup({ id, kicker, title, aside, children }: { id: string; kicker: string | null; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} data-catalogue-group className="[&+&]:mt-8 md:[&+&]:mt-16">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 pb-4">
        <h2 id={id} className="text-xl font-semibold tracking-tight text-balance lg:text-2xl">
          {kicker ? <span className={cx(eyebrow, "mb-2 block")}>{kicker}</span> : null}
          {title}
        </h2>
        {aside ? <div className="w-full sm:w-56">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** The hairline grid. Its top rule starts at the page gutter, like the head above it. */
export function CatalogueGrid({
  wide = true,
  count,
  labelledBy,
  testId,
  children,
}: {
  wide?: boolean;
  /** How many cards the grid holds. A grid with fewer cards than columns uses only as many columns as it has cards. */
  count?: number;
  labelledBy?: string;
  testId?: string;
  children: ReactNode;
}) {
  const alone = count === 1;
  return (
    <div className="overflow-hidden">
      <ul
        aria-labelledby={labelledBy}
        data-testid={testId}
        className={cx(
          "-me-px grid grid-cols-1 border-t border-rule",
          alone ? "[&_.cat-figure]:lg:aspect-[3/1]" : "sm:grid-cols-2",
          !alone && wide && "lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
          !alone && !wide && count !== 2 && "xl:grid-cols-3 2xl:grid-cols-4",
        )}
      >
        {children}
      </ul>
    </div>
  );
}

type CardProps = {
  /** Spread on the article: data-board, data-bench, data-craft. */
  data: Record<`data-${string}`, string>;
  item: Parameters<typeof FigureStill>[0]["item"];
  /** "Fig. 01" */
  fig: string;
  /** The maker or firmware, top right. */
  meta?: ReactNode;
  heading: "h2" | "h3";
  titleId?: string;
  name: string;
  /** No href: the item is not written yet and the card links nowhere. */
  href?: string;
  /** The link's accessible name when it should say more than the name. */
  openLabel?: string;
  sub?: ReactNode;
  specs?: ReactNode;
  tags?: ReactNode;
  progress?: ReactNode;
  /** What the search matches; the name, the line under it and the meta by default. */
  search?: string;
};

const slot = "min-w-0";

export function CatalogueCard({ data, item, fig, meta, heading: Heading, titleId, name, href, openLabel, sub, specs, tags, progress, search: searchText }: CardProps) {
  const search = searchText ?? [name, typeof sub === "string" ? sub : "", typeof meta === "string" ? meta : ""].join(" ");
  return (
    <li data-catalogue-item data-search={search} className="row-span-6 grid grid-rows-subgrid border-b border-e border-rule">
      <article
        {...data}
        aria-labelledby={titleId}
        className={cx(
          "group relative row-span-6 grid grid-rows-subgrid gap-y-0 p-(--cat-pad)",
          enter,
          "motion-fade has-[a:hover]:bg-surface",
          "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-(--focus)",
        )}
      >
        <div className={cx(slot, eyebrow, "flex items-baseline justify-between gap-4")}>
          <span className="tabular shrink-0 text-ink">{fig}</span>
          {meta ? <span className="truncate text-end">{meta}</span> : null}
        </div>

        <div className="cat-figure relative my-4 aspect-[2/1] min-h-0 sm:my-6 sm:aspect-[5/4]">
          <FigureStill item={item} className="absolute inset-0 aspect-auto! h-full w-full" />
        </div>

        <div className={slot}>
          <Heading id={titleId} className="flex items-start justify-between gap-3 text-xl font-semibold tracking-tight text-balance">
            {href ? (
              <Link
                href={href}
                aria-label={openLabel}
                className="no-underline decoration-1 underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline hover:decoration-1 focus-visible:shadow-none focus-visible:outline-none"
              >
                {name}
              </Link>
            ) : (
              <span>{name}</span>
            )}
            {href ? <Arrow /> : null}
          </Heading>
          {sub ? <div className="mt-2 text-sm leading-[1.5] text-muted">{sub}</div> : null}
        </div>

        <div className={cx(slot, "pt-4")}>{specs}</div>
        <div className={cx(slot, "pt-3")}>{tags}</div>
        <div className={cx(slot, "relative mt-4 self-end border-t border-rule pt-3")}>{progress}</div>
      </article>
    </li>
  );
}

function Arrow() {
  return (
    <Icon
      name="arrow-right"
      size={16}
      className="mt-1 shrink-0 text-muted motion-move group-has-[a:hover]:translate-x-1 group-has-[a:hover]:text-ink"
    />
  );
}

/** One mono line of specs, joined by dots that never start a line. */
export function SpecLine({ items, label }: { items: string[]; label?: string }) {
  return (
    <div className="overflow-hidden">
      <ul aria-label={label} className="tabular -ms-4 flex flex-wrap font-ui text-xs text-ink">
        {items.map((spec, i) => (
          <li key={i} className="whitespace-nowrap before:inline-block before:w-4 before:text-center before:text-muted before:content-['·']">
            {spec}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tags as small uppercase mono words; `strong` ones (a board's languages) in ink, the rest muted. */
export function TagLine({ label, strong = [], items }: { label: string; strong?: string[]; items: string[] }) {
  return (
    <ul aria-label={label} className={cx(eyebrow, "flex flex-wrap gap-x-3 gap-y-1")}>
      {strong.map((tag) => (
        <li key={`s-${tag}`} className="text-ink">
          {tag}
        </li>
      ))}
      {items.map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
    </ul>
  );
}
