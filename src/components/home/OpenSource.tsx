import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/Reveal";
import type { Locale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { HomeSection } from "./primitives";

export async function OpenSource({ lang }: { lang: Locale }) {
  const t = await getT(lang, "home");
  return (
    <HomeSection id="open-source" n="06" motif="gear" tone="cobalt" tilt={-2} title={t("open.title")}>
      <Reveal>
        <p className="mt-4 max-w-prose text-base text-muted">{t("open.text")}</p>
        <ButtonLink variant="secondary" size="sm" href={`/${lang}/self-hosting`} prefetch={false} className="mt-8">
          <Icon name="book" size={16} aria-hidden />
          {t("open.selfHost")}
        </ButtonLink>
      </Reveal>
    </HomeSection>
  );
}
