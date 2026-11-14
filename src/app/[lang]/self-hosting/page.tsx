import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHead, Section, page } from "@/components/editorial/Editorial";
import { Callout, PageSkeleton } from "@/components/ui";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/icons";
import { isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[lang]/self-hosting">;

const ADDS: { key: "rooms" | "buddies" | "ai"; icon: IconName }[] = [
  { key: "rooms", icon: "people" },
  { key: "buddies", icon: "key" },
  { key: "ai", icon: "spark" },
];

// The Docker kit in deploy/, as docs/SELF_HOSTING.md runs it.
const COMPOSE = "docker compose -f deploy/compose.yaml";
const STEPS = [
  { key: "settings", code: "cp deploy/.env.example deploy/.env" },
  { key: "start", code: `${COMPOSE} up -d --build` },
  { key: "init", code: `${COMPOSE} exec server node server/bin/iynk-server.ts init` },
  { key: "friend", code: `${COMPOSE} exec server node server/bin/iynk-server.ts enrol --name Sam` },
] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const t = await getT(lang, "shell");
  return { title: t("selfHost.metaTitle"), description: t("selfHost.metaDescription"), alternates: alternatesFor(lang, "/self-hosting") };
}

export default function SelfHostingPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className={page}>
          <PageSkeleton kind="article" />
        </div>
      }
    >
      <SelfHosting params={params} />
    </Suspense>
  );
}

async function SelfHosting({ params }: Pick<Props, "params">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = await getT(lang, "shell");

  return (
    <div className={cx(page, "pb-16 md:pb-24")}>
      <PageHead label={t("selfHost.eyebrow")} title={t("selfHost.title")} lede={<p>{t("selfHost.lede")}</p>} />
      <Callout tone="note" title={t("selfHost.private.title")} className="mt-10 max-w-3xl">
        {t("selfHost.private.text")}
      </Callout>

      <Section id={`self-host-adds-${lang}`} title={t("selfHost.adds.title")}>
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {ADDS.map(({ key, icon }) => (
            <li key={key} className="flex flex-col gap-2">
              <span className="flex size-10 items-center justify-center rounded-lg bg-sunken">
                <Icon name={icon} />
              </span>
              <h3 className="text-base font-semibold">{t(`selfHost.adds.${key}.title`)}</h3>
              <p className="text-sm text-muted text-pretty">{t(`selfHost.adds.${key}.text`)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id={`self-host-need-${lang}`} title={t("selfHost.need.title")}>
        <p className="max-w-prose text-base">{t("selfHost.need.text")}</p>
      </Section>

      <Section id={`self-host-steps-${lang}`} title={t("selfHost.steps.title")}>
        <ol className="flex flex-col gap-6">
          {STEPS.map(({ key, code }, i) => (
            <li key={key} className="flex flex-col gap-3">
              <p className="flex gap-3 text-base">
                <span className="tabular font-semibold">{i + 1}.</span>
                <span className="text-pretty">{t(`selfHost.steps.${key}`)}</span>
              </p>
              <CodeBlock
                code={code}
                lang="text"
                label={t("selfHost.steps.label", { n: i + 1 })}
                copyLabel={t("selfHost.steps.copy")}
                copiedLabel={t("selfHost.steps.copied")}
              />
            </li>
          ))}
        </ol>
      </Section>

      <Section id={`self-host-join-${lang}`} title={t("selfHost.join.title")}>
        <p className="max-w-prose text-base">{t("selfHost.join.text")}</p>
      </Section>
    </div>
  );
}
