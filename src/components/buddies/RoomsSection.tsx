"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/editorial/Editorial";
import { useTogetherT } from "@/components/realtime/messages";
import { ButtonLink, Skeleton } from "@/components/ui";
import { useLocale } from "@/i18n/client";
import { fetchConfig } from "@/server-client/probe";
import { resolveServerUrl } from "@/server-client/profile";
import { openStores } from "./BuddiesPage";
import { SelfHostPitch } from "./SelfHostPitch";

type Known = "checking" | "none" | "server";

/** The Rooms section of the Together page: what a room is, and whether this deployment has the server it needs. */
export function RoomsSection() {
  const t = useTogetherT();
  const locale = useLocale();
  const [known, setKnown] = useState<Known>("checking");

  useEffect(() => {
    let current = true;
    void (async () => {
      const config = await fetchConfig();
      const profile = await openStores().profile.read();
      const address = resolveServerUrl(config.ok ? config.config : null, profile);
      if (current) setKnown(address ? "server" : "none");
    })().catch(() => current && setKnown("none"));
    return () => {
      current = false;
    };
  }, []);

  if (!t) return null;
  return (
    <Section id="rooms" title={t("rooms.title")}>
      {known === "checking" ? <Skeleton className="h-40" /> : null}
      {known === "none" ? <SelfHostPitch /> : null}
      {known === "server" ? (
        <div className="flex max-w-prose flex-col items-start gap-4">
          <p className="text-base text-pretty text-muted">{t("rooms.ready.body")}</p>
          <ButtonLink variant="secondary" href={`/${locale}/studio`}>
            {t("rooms.ready.open")}
          </ButtonLink>
        </div>
      ) : null}
    </Section>
  );
}
