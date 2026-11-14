"use client";

import dynamic from "next/dynamic";
import { createContext, useContext } from "react";
import { Container } from "@/components/editorial/Layout";
import type { Locale } from "@/i18n/config";
import type { StudioMessages } from "@/i18n/namespaces";

export interface StudioLoaderProps {
  messages: StudioMessages;
  lang: Locale;
}

// next/dynamic hands its loading component no props, so the translated text travels by context.
const LoadingText = createContext("");

function StudioLoading() {
  return (
    <Container role="status" aria-busy="true" className="min-h-64 pt-8 text-base text-muted">
      {useContext(LoadingText)}
    </Container>
  );
}

const StudioEntry = dynamic(() => import("./StudioEntry").then((m) => m.StudioEntry), {
  ssr: false,
  loading: () => <StudioLoading />,
});

export function StudioLoader({ messages, lang }: StudioLoaderProps) {
  return (
    <LoadingText.Provider value={messages.studio.route.loading}>
      <StudioEntry messages={messages} lang={lang} />
      <noscript>
        <Container className="pt-8">{messages.studio.route.noscript}</Container>
      </noscript>
    </LoadingText.Provider>
  );
}
