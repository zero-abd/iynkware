import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  Cell,
  Container,
  FloatingControls,
  GlyphScene,
  Grid,
  PcbTraces,
  ProjectCard,
  SelectionBox,
  riseIndex,
} from "@/components/editorial";
import { Faq, FinalCta, HowItWorks, OpenSource, Proof, workbenchHref } from "@/components/home";
import { HeroActions } from "@/components/shell/dashboard/DashboardProgress";
import { BENEFIT_IDS } from "@/components/home/labs-data";
import { HomeSection } from "@/components/home/primitives";
import { loadLabs } from "@/components/shell/dashboard/data";
import { PageSkeleton } from "@/components/ui";
import { BOARD_IDS, DRONE_IDS, ROBOTICS_IDS } from "@/content/ids";
import { htmlLang, isLocale } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import { getMessages, getT } from "@/i18n/server";

type Props = PageProps<"/[lang]">;

const counts = { boards: BOARD_IDS.length, benches: ROBOTICS_IDS.length, drones: DRONE_IDS.length };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const [t, common] = await Promise.all([getT(lang, "home"), getT(lang, "common")]);
  const title = t("meta.title");
  const description = t("meta.description");
  return {
    title: { absolute: title },
    description,
    alternates: alternatesFor(lang, ""),
    // The layout's card names the site; the dashboard's own title and description are what a shared link shows.
    openGraph: { type: "website", siteName: common("site.name"), title, description, locale: htmlLang(lang) },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function HomePage({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton kind="list" />}>
      <Home params={params} />
    </Suspense>
  );
}

async function Home({ params }: Pick<Props, "params">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const [t, shell, shellMessages, labs] = await Promise.all([
    getT(lang, "home"),
    getT(lang, "shell"),
    getMessages(lang, "shell"),
    loadLabs(lang),
  ]);

  const labNames = { board: shell("nav.boards"), robotics: shell("nav.robotics"), drone: shell("nav.drones") };
  const progressMessages = { progress: shellMessages.ui.progress, progressLabel: shellMessages.ui.progressLabel };
  const benefits = BENEFIT_IDS.map((id) => ({ id, title: t(`benefits.${id}.title`), text: t(`benefits.${id}.text`) }));
  const steps = (["1", "2", "3"] as const).map((n) => ({ title: t(`how.${n}.title`), text: t(`how.${n}.text`) }));
  const items = labs.flatMap((lab) => lab.items);
  const startHref = workbenchHref(lang, labs[0].items.find((item) => item.id === "uno-r3"));
  const [lead, focus, tail] = t("hero.headline").split("*");

  return (
    <div className="relative pb-[clamp(32px,4vw,64px)]">
      <PcbTraces />
      <Container data-pill-home="" className="relative pt-[clamp(40px,6vw,96px)]">
        <Grid className="items-center gap-y-8">
          <Cell span={4} className="lg:py-10">
            <h1 style={riseIndex(0)} className="rise text-[clamp(17px,1.5vw,22px)] font-normal leading-[1.55] tracking-[-0.014em] text-muted text-pretty lang-air">
              {lead}
              <SelectionBox>{focus}</SelectionBox>
              {tail}
            </h1>
            <p style={riseIndex(1)} className="rise mt-6 text-pretty text-muted">
              {t("hero.lede")}
            </p>
            <div style={riseIndex(2)} className="rise mt-6">
              <HeroActions
                items={items}
                messages={shellMessages.dashboard.continue}
                progressMessages={progressMessages}
                labNames={labNames}
                overallLabel={shell("dashboard.overall")}
                start={{ href: startHref, label: t("hero.cta") }}
                browse={{ href: `/${lang}/boards`, label: t("hero.browse") }}
              />
              <p className="mt-4 text-sm text-muted">{t("hero.reassure")}</p>
              <p className="mt-2 text-sm text-muted tabular">{t("hero.proof", counts)}</p>
            </div>
          </Cell>
          <Cell span={8} start={5} className="lg:-me-[calc(var(--shell-pad)*0.6)]">
            <div style={riseIndex(3)} className="rise">
              <GlyphScene
                labels={{
                  scene: t("scene.alt"),
                  time: t("scene.time"),
                  dawn: t("scene.dawn"),
                  noon: t("scene.noon"),
                  dusk: t("scene.dusk"),
                  night: t("scene.night"),
                }}
              />
            </div>
          </Cell>
        </Grid>
      </Container>

      <HomeSection id="labs" n="01" motif="chip" tone="tomato" tilt={-4} title={t("labs.heading")}>
        <div className="mt-6 grid grid-cols-1 gap-x-[clamp(16px,2vw,32px)] gap-y-9 min-[480px]:grid-cols-2 lg:grid-cols-4">
          <ProjectCard
            href={`/${lang}/boards`}
            title={labNames.board}
            meta={`${counts.boards} ${t("labs.boards.unit")}`}
            description={t("labs.boards.text")}
            image={{ src: "/thumbs/boards/uno-r3.webp", width: 720, height: 449 }}
            tone="var(--color-tomato)"
          />
          <ProjectCard
            href={`/${lang}/robotics`}
            title={labNames.robotics}
            meta={`${counts.benches} ${t("labs.robotics.unit")}`}
            description={t("labs.robotics.text")}
            image={{ src: "/thumbs/robotics/tb6612fng.webp", width: 720, height: 524 }}
            tone="var(--color-mint-m)"
          />
          <ProjectCard
            href={`/${lang}/drones`}
            title={labNames.drone}
            meta={`${counts.drones} ${t("labs.drones.unit")}`}
            description={t("labs.drones.text")}
            image={{ src: "/thumbs/drones/quad5.webp", width: 720, height: 431 }}
            tone="var(--color-cobalt)"
          />
          <ProjectCard
            href={`/${lang}/drones/racer/fly`}
            title={t("labs.flight.title")}
            meta={t("labs.flight.meta")}
            description={t("labs.flight.text")}
            image={{ src: "/thumbs/drones/racer.webp", width: 720, height: 450 }}
            tone="var(--color-mustard)"
          />
        </div>
      </HomeSection>
      <HowItWorks benefitsTitle={t("benefits.title")} benefits={benefits} howTitle={t("how.title")} steps={steps} />
      <Proof t={t} />
      <Faq t={t} />
      <OpenSource lang={lang} />
      <FinalCta lang={lang} href={startHref} />

      <FloatingControls
        labels={{ font: t("controls.font"), theme: t("controls.theme"), light: t("controls.light"), dark: t("controls.dark") }}
      />
    </div>
  );
}
