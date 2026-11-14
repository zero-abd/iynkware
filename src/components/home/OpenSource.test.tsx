import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import home from "@/i18n/messages/en/home.json";
import { FinalCta } from "./FinalCta";
import { OpenSource } from "./OpenSource";

test("while the repository is private, the section on the code links to the self-hosting guide on this site", async () => {
  render(await OpenSource({ lang: "en" }));
  const section = screen.getByRole("region", { name: home.open.title });
  const links = within(section).getAllByRole("link");
  expect(links.map((a) => a.getAttribute("href"))).toEqual(["/en/self-hosting"]);
  expect(links[0].textContent).toBe(home.open.selfHost);
  expect(links[0].getAttribute("target")).toBeNull();
  expect(section.textContent).toContain(home.open.text);
});

test("the closing call repeats the single call to action to the given address", async () => {
  render(await FinalCta({ lang: "en", href: "/en/boards/uno-r3?lesson=1" }));
  const region = screen.getByRole("region", { name: "The bench is ready." });
  const links = within(region).getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0].textContent).toBe(home.hero.cta);
  expect(links[0].getAttribute("href")).toBe("/en/boards/uno-r3?lesson=1");
});
