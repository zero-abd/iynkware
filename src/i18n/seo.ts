import type { Metadata } from "next";
import { DEFAULT_LOCALE, LOCALES, htmlLang, type Locale } from "./config";

/**
 * The absolute base for canonical and hreflang links: SITE_URL when set, else the domain Vercel gives the project
 * (VERCEL_PROJECT_PRODUCTION_URL, a bare host), else the local server. A production deploy that has neither
 * fails the build, so a localhost address never reaches a page, the sitemap or robots.txt.
 */
export function siteUrl(): URL {
  if (process.env.SITE_URL) return new URL(process.env.SITE_URL);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (process.env.VERCEL_ENV === "production") throw new Error("Set SITE_URL: this production deploy has no public address for canonical links.");
  return new URL("http://localhost:3000");
}

/**
 * Canonical plus one hreflang link per language and x-default, for every
 * page's generateMetadata. `path` is what follows the language: "" for the
 * dashboard, "/boards/uno-r3" for a board.
 */
export function alternatesFor(locale: Locale, path: string): NonNullable<Metadata["alternates"]> {
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[htmlLang(l)] = `/${l}${path}`;
  languages["x-default"] = `/${DEFAULT_LOCALE}${path}`;
  return { canonical: `/${locale}${path}`, languages };
}
