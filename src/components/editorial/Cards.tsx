import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

export type CardImage = { src: string; width: number; height: number };

type ProjectCardProps = {
  href: string;
  title: string;
  description: string;
  /** Small text on the title's right, such as a count. */
  meta?: string;
  image: CardImage;
  /** A palette colour for the dotted backdrop behind the picture. */
  tone?: string;
  priority?: boolean;
};

/** A card in a grid: a rounded picture, a title with a count, a line or two of grey. The title is the one link. */
export function ProjectCard({ href, title, description, meta, image, tone = "var(--color-cobalt)", priority }: ProjectCardProps) {
  return (
    <article className="group relative min-w-0">
      <div
        style={{ "--tone": tone } as CSSProperties}
        className="dotted relative grid aspect-[16/10] place-items-center overflow-hidden rounded-2xl border border-(--card-line) transition-[transform,box-shadow] duration-300 ease-(--ease-iynk) group-hover:-translate-y-0.5 group-hover:shadow-ink-lg motion-reduce:transition-none"
      >
        <Image
          src={image.src}
          alt=""
          width={image.width}
          height={image.height}
          sizes="(min-width: 760px) 360px, 90vw"
          priority={priority}
          className="h-[82%] w-[82%] object-contain transition-transform duration-500 ease-(--ease-iynk) group-hover:scale-[1.03] motion-reduce:transition-none"
        />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-medium leading-snug tracking-[-0.011em]">
          <Link href={href} className="no-underline after:absolute after:inset-0 after:rounded-2xl focus-visible:shadow-none focus-visible:outline-none">
            {title}
          </Link>
        </h3>
        {meta ? <span className="shrink-0 font-ui text-xs tabular-nums text-muted">{meta}</span> : null}
      </div>
      <p className="mt-1 text-[14px] leading-[1.55] text-muted">{description}</p>
    </article>
  );
}
