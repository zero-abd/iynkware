import { render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { registerServiceWorker } from "@/local/sw-register";
import { SwRegister } from "./SwRegister";

vi.mock("@/local/sw-register", () => ({ registerServiceWorker: vi.fn(async () => ({ registered: true })) }));

afterEach(() => vi.mocked(registerServiceWorker).mockClear());

test("registers at once when the page has already loaded", () => {
  render(<SwRegister />);
  expect(registerServiceWorker).toHaveBeenCalledTimes(1);
});

test("waits for the load event while the page is still loading", () => {
  const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  render(<SwRegister />);
  expect(registerServiceWorker).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("load"));
  expect(registerServiceWorker).toHaveBeenCalledTimes(1);
  state.mockRestore();
});

test("does not register after it is gone before the page loads", () => {
  const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  render(<SwRegister />).unmount();
  window.dispatchEvent(new Event("load"));
  expect(registerServiceWorker).not.toHaveBeenCalled();
  state.mockRestore();
});
