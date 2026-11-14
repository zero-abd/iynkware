import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TogetherStrings } from "@/components/realtime/messages";
import { I18nProvider } from "@/i18n/client";
import common from "@/i18n/messages/en/common.json";
import together from "@/i18n/messages/en/together.json";
import { emptyProfile, memoryProfileStore } from "@/server-client/profile";
import { RoomsSection } from "./RoomsSection";

const shared = vi.hoisted(() => ({ profile: null as unknown }));

vi.mock("@/server-client/profile", async (original) => ({
  ...(await original<typeof import("@/server-client/profile")>()),
  idbProfileStore: () => shared.profile,
}));

const r = together.rooms;

beforeEach(() => {
  shared.profile = memoryProfileStore();
  vi.stubGlobal("indexedDB", {});
});
afterEach(() => vi.unstubAllGlobals());

function renderSection(config: { server: string } | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (config ? Response.json({ ...config, protocol: 1 }) : new Response("", { status: 404 }))),
  );
  return render(
    <I18nProvider locale="en" messages={common.client}>
      <TogetherStrings locale="en" messages={together}>
        <RoomsSection />
      </TogetherStrings>
    </I18nProvider>,
  );
}

test("with no server it says what a room gives on your own copy and links the guide on this site", async () => {
  renderSection(null);
  expect(await screen.findByText(r.selfHost.title)).toBeTruthy();
  for (const point of Object.values(r.selfHost.points)) expect(screen.getByText(point)).toBeTruthy();
  expect(screen.getByRole("link", { name: r.selfHost.guide }).getAttribute("href")).toBe("/en/self-hosting");
  expect(screen.queryByRole("link", { name: r.ready.open })).toBeNull();
});

test("with a server it says where a room starts and links the Studio", async () => {
  renderSection({ server: "https://srv.example" });
  expect(await screen.findByText(r.ready.body)).toBeTruthy();
  expect(screen.getByRole("link", { name: r.ready.open }).getAttribute("href")).toBe("/en/studio");
  expect(screen.queryByText(r.selfHost.title)).toBeNull();
});

test("a server the person saved counts even when the deployment names none", async () => {
  await (shared.profile as ReturnType<typeof memoryProfileStore>).write({ ...emptyProfile(), url: "https://mine.example" });
  renderSection(null);
  expect(await screen.findByText(r.ready.body)).toBeTruthy();
});
