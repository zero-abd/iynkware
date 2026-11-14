import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "./seo";

describe("siteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns SITE_URL when set", () => {
    vi.stubEnv("SITE_URL", "https://iynk.example");
    expect(siteUrl().href).toBe("https://iynk.example/");
  });

  it("falls back to the local server", () => {
    vi.stubEnv("SITE_URL", "");
    expect(siteUrl().href).toBe("http://localhost:3000/");
  });

  it("uses the Vercel production domain when SITE_URL is unset", () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "iynk.tech");
    expect(siteUrl().href).toBe("https://iynk.tech/");
  });

  it("prefers SITE_URL over the Vercel domain", () => {
    vi.stubEnv("SITE_URL", "https://iynk.example");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "iynk.tech");
    expect(siteUrl().href).toBe("https://iynk.example/");
  });

  it("refuses a production deploy with no public address", () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => siteUrl()).toThrow(/SITE_URL/);
  });
});
