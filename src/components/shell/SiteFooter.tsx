import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { Icon } from "@/components/ui/icons";
import { FooterLanguages } from "./FooterLanguages";
import { Logo } from "./Logo";
import { NAV } from "./nav";

const COLORFIGURES_URL = "https://april-zhu.com/colorfigures";

const link = "inline-flex min-h-9 items-center gap-1 text-sm text-muted no-underline motion-fade hover:text-ink [@media(pointer:coarse)]:min-h-11";
const row = "flex flex-wrap gap-x-6 gap-y-2";

export async function SiteFooter({ lang }: { lang: Locale }) {
  const [t, common] = await Promise.all([getT(lang, "shell"), getT(lang, "common")]);
  const pages = NAV.filter((entry) => entry.id !== "dashboard");
  return (
    <footer className="site-footer border-t border-rule">
      <div className="shell-frame grid grid-cols-1 gap-x-6 gap-y-10 pb-8 pt-[clamp(40px,5vw,72px)] lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
          <Logo height={21} className="w-auto self-start text-ink" />
          <p className="max-w-[28ch] text-[15px] font-medium leading-snug tracking-[-0.014em] text-balance text-ink">{common("site.tagline")}</p>
          <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted">{common("site.description")}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7 lg:col-start-6">
          <nav aria-label={t("footer.pages")}>
            <ul className={row}>
              {pages.map((entry) => (
                <li key={entry.id}>
                  <Link href={`/${lang}${entry.href}`} prefetch={entry.heavy ? false : undefined} className={link}>
                    {t(`nav.${entry.id}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <ul className={row}>
            <li>
              <Link href={`/${lang}/privacy`} prefetch={false} className={link}>
                {t("footer.privacyLink")}
              </Link>
            </li>
            <li>
              <Link href={`/${lang}/about#about-licence-${lang}`} prefetch={false} className={link}>
                {t("footer.licenceLink")}
              </Link>
            </li>
            <li>
              <Link href={`/${lang}/self-hosting`} prefetch={false} className={link}>
                {t("footer.selfHostLink")}
              </Link>
            </li>
            <li>
              <a href={COLORFIGURES_URL} target="_blank" rel="noopener noreferrer" className={link}>
                {t("footer.figures")}
                <Icon name="external" size={16} />
              </a>
            </li>
          </ul>
          <FooterLanguages lang={lang} label={t("language.label")} />
        </div>
        <div className="flex max-w-prose flex-col gap-2 border-t border-rule pt-4 text-[13px] text-muted lg:col-span-12 lg:max-w-none lg:flex-row lg:gap-8">
          <p>{t("footer.privacy")}</p>
          <p>{t("footer.licence")}</p>
        </div>
      </div>
    </footer>
  );
}
