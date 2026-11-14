import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en/fidelity.json";
import { createTranslator } from "@/i18n/translate";
import type { Op } from "@/project/generated/types";
import { buildUf2, FLASH_BASE } from "@/sim/mcu/rp2040/uf2";
import { FirmwareMode, type FirmwareModeProps, type RuntimeView, uf2Ops } from "./FirmwareMode";

const t = createTranslator("en", messages);
const pico: RuntimeView = { id: "rtm_main", board: "brd_main", boardRef: "core.pico", engine: "iynk-interp" };
const uf2 = buildUf2([{ address: FLASH_BASE + 0x100, data: Uint8Array.of(0, 0x20, 0x04, 0x20, 1, 1, 0, 0x10) }]);

function setup(over: Partial<FirmwareModeProps> = {}, runtime: RuntimeView = pico) {
  const props: FirmwareModeProps = {
    runtime,
    assets: [],
    onChange: vi.fn(),
    parse: vi.fn().mockResolvedValue({ ok: true, bytes: 1 }),
    parseUf2: vi.fn().mockResolvedValue({ ok: true, bytes: 8 }),
    store: { put: vi.fn().mockResolvedValue(undefined) },
    t,
    ...over,
  };
  render(<FirmwareMode {...props} />);
  return props;
}

const choose = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const fileOf = (name: string) => new File([uf2], name);

describe("FirmwareMode on a Pico", () => {
  it("offers the interpreter and the firmware, and the .uf2 import once Firmware is chosen", () => {
    setup();
    expect(screen.getByRole("radio", { name: "Interpreter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import a .uf2 file" })).toBeNull();
    choose("Firmware");
    expect(screen.getByRole("button", { name: "Import a .uf2 file" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import a .hex file" })).toBeNull();
    expect(screen.getByText("You can also drop a .uf2 file anywhere in the Studio.")).toBeTruthy();
  });

  it("stores a picked file, checks it in the worker and switches the runtime to the rp2040js engine in one batch", async () => {
    const props = setup();
    choose("Firmware");
    fireEvent.change(screen.getByLabelText("Import a .uf2 file"), { target: { files: [fileOf("blink.uf2")] } });
    await waitFor(() => expect(props.onChange).toHaveBeenCalledTimes(1));
    expect(props.parseUf2).toHaveBeenCalledWith(expect.any(Uint8Array));
    const ops = vi.mocked(props.onChange).mock.calls[0][0] as Op[];
    expect(ops.map((op) => op.k)).toEqual(["asset.add", "runtime.set"]);
    const added = ops[0] as Extract<Op, { k: "asset.add" }>;
    expect(added.asset).toMatchObject({ path: "firmware/blink.uf2", role: "binary", bytes: uf2.length });
    expect(ops[1]).toMatchObject({ k: "runtime.set", runtime: { engine: "rp2040js", options: { image: added.asset.id } } });
    expect(props.store.put).toHaveBeenCalledWith(added.asset.sha256, expect.any(Uint8Array));
  });

  it("says why a file cannot run and changes nothing", async () => {
    const parseUf2 = vi.fn().mockResolvedValue({ ok: false, error: { kind: "uf2-wrong-family", message: "x" } });
    const props = setup({ parseUf2 });
    choose("Firmware");
    fireEvent.change(screen.getByLabelText("Import a .uf2 file"), { target: { files: [fileOf("other.uf2")] } });
    expect(await screen.findByText("This UF2 file is for another chip, not the RP2040.")).toBeTruthy();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("takes a .uf2 file dropped anywhere in the window, and leaves other files to the browser", async () => {
    const props = setup();
    const drop = (file: File) => {
      const event = new Event("drop", { cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files: [file], types: ["Files"] } });
      act(() => void window.dispatchEvent(event));
      return event;
    };
    expect(drop(fileOf("notes.txt")).defaultPrevented).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
    expect(drop(fileOf("blink.uf2")).defaultPrevented).toBe(true);
    await waitFor(() => expect(props.onChange).toHaveBeenCalledTimes(1));
    expect(vi.mocked(props.onChange).mock.calls[0][0]).toContainEqual(expect.objectContaining({ k: "runtime.set", runtime: expect.objectContaining({ engine: "rp2040js" }) }));
  });

  it("shows the drop hint while a file is dragged over the window", () => {
    setup();
    choose("Firmware");
    const over = new Event("dragover", { cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"] } });
    act(() => void window.dispatchEvent(over));
    expect(screen.getByText("Drop the .uf2 file to run it on the Pico.")).toBeTruthy();
  });

  it("starts on Firmware when the runtime already runs on the rp2040js engine", () => {
    setup({ assets: [{ id: "ast_1", path: "firmware/a.uf2", bytes: 1024 }] }, { ...pico, engine: "rp2040js", options: { image: "ast_1" } });
    expect(screen.getByRole("radio", { name: "Firmware" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Loaded 1,024 bytes of firmware/)).toBeTruthy();
  });
});

describe("FirmwareMode on other boards", () => {
  it("names the boards firmware mode runs on when the board is none of them", () => {
    setup({}, { ...pico, boardRef: "core.esp32-devkitc" });
    expect(screen.getByText("Firmware mode runs the Uno, Nano and Pico boards only.")).toBeTruthy();
  });

  it("keeps the hex import for an Uno", () => {
    setup({}, { ...pico, boardRef: "core.uno-r3" });
    choose("Firmware");
    expect(screen.getByRole("button", { name: "Import a .hex file" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import a .uf2 file" })).toBeNull();
  });
});

describe("uf2Ops", () => {
  it("removes the image the runtime had before adding the new one", () => {
    const ops = uf2Ops({ ...pico, engine: "rp2040js", options: { image: "ast_old" } }, "next", uf2);
    expect(ops.map((op) => op.k)).toEqual(["asset.remove", "asset.add", "runtime.set"]);
    expect(ops[0]).toEqual({ k: "asset.remove", id: "ast_old" });
  });
});
