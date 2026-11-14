import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/Reveal";

// Shared page grammar for the pages outside the labs: a head, then numbered sections split by hairlines.

export const typeClass = {
  display: "text-5xl md:text-6xl lg:text-7xl font-semibold tracking-tight text-balance lang-air",
  eyebrow: "kicker",
};

/** Enter motion: opacity and a rise on first paint, none under reduced motion. */
export const enter = "animate-rise-in";

/** The page's outer frame: the whole screen, with the fluid shell gutter. */
export const page = "mx-auto w-full max-w-(--shell-max) px-(--shell-pad)";

export function Wrap({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cx(page, className)} {...rest} />;
}

/** Small label above a title or a number. The kicker class keeps the Devanagari and Han override. */
export const eyebrow = typeClass.eyebrow;

const display = cx(typeClass.display, "[overflow-wrap:anywhere]");

/** The one solid action on a screen. */
export function CtaLink({ className, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <ButtonLink variant="primary" className={className} {...rest}>
      <span>{children}</span>
      <Icon name="arrow-right" size={16} className="shrink-0" />
    </ButtonLink>
  );
}

/** A quiet action: words, a hairline underline and an arrow that nudges on hover. */
export function ArrowLink({ className, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cx(
        "group/arrow inline-flex min-h-11 max-w-full items-center gap-2 text-base font-semibold leading-tight text-ink no-underline",
        className,
      )}
      {...rest}
    >
      <span className="underline decoration-rule decoration-1 underline-offset-4 motion-fade group-hover/arrow:decoration-ink">{children}</span>
      <Icon name="arrow-right" size={16} className="shrink-0 motion-move group-hover/arrow:translate-x-0.5" />
    </Link>
  );
}

export function PageHead({
  label,
  title,
  lede,
  aside,
  className,
}: {
  label?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("grid grid-cols-1 items-end gap-x-6 gap-y-10 pt-10 md:pt-16 lg:grid-cols-12", className)}>
      <div className={cx("min-w-0", aside ? "lg:col-span-7" : "lg:col-span-10", enter)}>
        {label ? <p className={eyebrow}>{label}</p> : null}
        <h1 className={cx(display, "mt-4 max-w-[680px]")}>{title}</h1>
        {lede ? <div className="mt-6 max-w-prose text-base text-muted md:text-lg">{lede}</div> : null}
      </div>
      {aside ? <div className={cx("min-w-0 lg:col-span-5", enter, "[animation-delay:100ms]")}>{aside}</div> : null}
    </header>
  );
}

/**
 * A numbered section: the index, title and lede on the left four columns, the content on the right eight.
 * `wide` puts the content under the head across all twelve.
 */
export function Section({
  id,
  index,
  title,
  lede,
  wide,
  children,
  className,
}: {
  id: string;
  index?: string;
  title: ReactNode;
  lede?: ReactNode;
  wide?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cx("mt-16 md:mt-24 border-t border-rule pt-6 sm:pt-8", className)}>
      <Reveal className="grid grid-cols-1 gap-x-6 gap-y-8 lg:grid-cols-12">
        <div className={cx("min-w-0", wide ? "lg:col-span-12" : "lg:col-span-4")}>
          {index ? (
            <p className={cx(eyebrow, "tabular")} aria-hidden="true">
              {index}
            </p>
          ) : null}
          <h2 id={id} className={cx("text-2xl md:text-3xl font-semibold tracking-tight text-balance lang-air", Boolean(index) && "mt-4")}>
            {title}
          </h2>
          {lede ? <div className="mt-4 max-w-prose text-base text-muted">{lede}</div> : null}
        </div>
        <div className={cx("min-w-0", wide ? "lg:col-span-12" : "lg:col-span-8")}>{children}</div>
      </Reveal>
    </section>
  );
}
