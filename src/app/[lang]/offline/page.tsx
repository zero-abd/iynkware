import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHead, page } from "@/components/editorial/Editorial";
import { ButtonLink } from "@/components/ui/Button";
import { PageSkeleton } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { isLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[lang]/offline">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const t = await getT(lang, "shell");
  return { title: t("offline.metaTitle"), robots: { index: false, follow: false } };
}

// The service worker sends a page it has not saved here when the network is gone (public/sw.js).
export default function OfflinePage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className={page}>
          <PageSkeleton kind="article" />
        </div>
      }
    >
      <Offline params={params} />
    </Suspense>
  );
}

async function Offline({ params }: Pick<Props, "params">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = await getT(lang, "shell");

  return (
    <div className={cx(page, "pb-16 md:pb-24")}>
      <PageHead
        title={t("offline.title")}
        lede={
          <>
            <p>{t("offline.lede")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink variant="primary" href={`/${lang}`}>
                {t("offline.home")}
              </ButtonLink>
              <ButtonLink variant="secondary" href={`/${lang}/studio`}>
                {t("offline.studio")}
              </ButtonLink>
            </div>
          </>
        }
      />
    </div>
  );
}
