import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import { version } from "./package.json";
import { buildCsp, buildFigureCsp, parseOrigins } from "./src/lib/csp";
import { PRESET_ORIGINS } from "./src/protocol/ai-presets";
import { DEFAULT_LOCALE, LANG_COOKIE, LOCALES, acceptLanguagePattern } from "./src/i18n/config";

// One id for three uses: Next's build id, the page's NEXT_PUBLIC_BUILD_ID and the service worker's ?v=. The config
// loads more than once (the build spawns children), so the result is written back to the environment.
function computeBuildId() {
  const fromHost = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12);
  if (fromHost) return fromHost;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}
const BUILD_ID = (process.env.IYNK_BUILD_ID ??= computeBuildId());

const rawOrigins = process.env.IYNK_CONNECT_ORIGINS ?? "";
const connectOrigins = [...new Set([...PRESET_ORIGINS, ...parseOrigins(rawOrigins)])];
if (parseOrigins(rawOrigins).length < rawOrigins.split(",").filter((origin) => origin.trim()).length) {
  console.warn("IYNK_CONNECT_ORIGINS: ignored entries that are not a bare http, https, ws or wss origin");
}

// Location (nearby search) and Web Serial are the only device features the app asks for; the rest are refused.
// Gamepad and fullscreen keep their same-origin default for the flight trainer.
const PERMISSIONS = [
  "camera=()",
  "microphone=()",
  "geolocation=(self)",
  "serial=(self)",
  "usb=()",
  "hid=()",
  "bluetooth=()",
  "midi=()",
  "payment=()",
  "display-capture=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "xr-spatial-tracking=()",
  "browsing-topics=()",
].join(", ");

// The opener policy cuts the tie to any window that opened this one or that this one opens; the resource policy
// keeps other sites from loading these files into their pages. X-Frame-Options repeats frame-ancestors for old browsers.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: buildCsp({ dev: process.env.NODE_ENV !== "production", connectOrigins }) },
];

// A path with no language ("/", "/boards/uno-r3" from a pitch or a shared link) goes to the saved language
// cookie's page, then the browser's languages, then English.
const inLanguage = (source: string, path: string) => [
  {
    source,
    has: [{ type: "cookie" as const, key: LANG_COOKIE, value: `(?<lang>${LOCALES.join("|")})` }],
    destination: `/:lang${path}`,
  },
  {
    source,
    has: [{ type: "header" as const, key: "accept-language", value: acceptLanguagePattern() }],
    destination: `/:lang${path}`,
  },
  { source, destination: `/${DEFAULT_LOCALE}${path}` },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  generateBuildId: async () => BUILD_ID,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID, NEXT_PUBLIC_APP_VERSION: version },
  cacheComponents: true,
  partialPrefetching: true,
  // Without this the localized 404 (app/[lang]/not-found.tsx) loses its layout, and a URL outside the language segment has no 404 of its own (app/global-not-found.tsx).
  experimental: { globalNotFound: true },
  // Agents build side by side with NEXT_DIST_DIR=.next-<label> (D12).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // While ~40 agents share one tree, IYNK_BUILD_SKIP_TYPECHECK=1 lets one of
  // them build its routes past another's half-written file; they type-check
  // with `npm run typecheck` instead. Unset it for a release build.
  typescript: { ignoreBuildErrors: process.env.IYNK_BUILD_SKIP_TYPECHECK === "1" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        // Figures are same-origin iframes: short cache, no framing by other sites.
        source: "/figures/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
          { key: "Content-Security-Policy", value: buildFigureCsp() },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        // Declared last so its CSP and Cache-Control replace the catch-all's. The browser must always see a new worker.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  async rewrites() {
    // [lang] is a dynamic root segment, so "/zzz" matches it and only fails inside the layout, which ends in Next's
    // default 404. Whatever the files, the API and the redirects did not claim, and whose first segment is not a
    // language, shows the 404 of the visitor's language. A rewrite to /_not-found answers 200 on Vercel, while the
    // prerendered /<lang>/not-found (app/[lang]/[...rest]) keeps its 404.
    return inLanguage(`/:first((?!(?:${LOCALES.join("|")})(?:/|$))[^/]+)/:rest*`, "/not-found");
  },
  async redirects() {
    // The query (a room link's ?room=) comes along.
    const toLanguage = (source: string, path: string) => inLanguage(source, path).map((rule) => ({ ...rule, permanent: false }));
    return [...toLanguage("/", ""), ...toLanguage("/:section(boards|robotics|drones|about|together)/:rest*", "/:section/:rest*")];
  },
};

export default nextConfig;
