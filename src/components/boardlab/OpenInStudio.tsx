import { ButtonLink } from "@/components/ui/Button";
import type { Locale } from "@/i18n/config";
import { templateIdFor } from "@/studio/fork";

type Props = { lang: Locale; board: string; lesson?: string; label: string; note: string };

/** The way from a board page to the same lesson, or the board's tour, in Studio: a button in the lesson's title row. */
export function OpenInStudio({ lang, board, lesson, label, note }: Props) {
  return (
    <ButtonLink href={`/${lang}/studio#/t/${templateIdFor(board, lesson ?? "tour")}`} prefetch={false} variant="secondary" size="sm" title={note} className="shrink-0 whitespace-nowrap">
      {label}
    </ButtonLink>
  );
}
