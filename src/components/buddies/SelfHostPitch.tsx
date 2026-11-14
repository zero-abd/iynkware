"use client";

import Link from "next/link";
import { useTogetherT } from "@/components/realtime/messages";
import { Icon, type IconName } from "@/components/ui/icons";
import { useLocale } from "@/i18n/client";

const POINTS: { key: "bench" | "keyboard" | "code"; icon: IconName }[] = [
  { key: "bench", icon: "people" },
  { key: "keyboard", icon: "keyboard" },
  { key: "code", icon: "key" },
];

/** What rooms give you, on a deployment with no server: the way to them is a copy of iynk you or a friend runs. */
export function SelfHostPitch() {
  const t = useTogetherT()!;
  const locale = useLocale();
  return (
    <div className="flex max-w-prose flex-col items-start gap-4 rounded-2xl border border-rule bg-surface p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-balance">{t("rooms.selfHost.title")}</h3>
        <p className="text-base text-muted text-pretty">{t("rooms.selfHost.body")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {POINTS.map(({ key, icon }) => (
          <li key={key} className="flex items-center gap-3 text-sm font-medium">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sunken">
              <Icon name={icon} size={16} aria-hidden="true" />
            </span>
            {t(`rooms.selfHost.points.${key}`)}
          </li>
        ))}
      </ul>
      <Link href={`/${locale}/self-hosting`} prefetch={false} className="inline-flex items-center gap-2 text-sm font-semibold text-ink underline underline-offset-4">
        {t("rooms.selfHost.guide")}
        <Icon name="arrow-right" size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}
