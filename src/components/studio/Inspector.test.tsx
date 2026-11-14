import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALES, type Locale } from "@/i18n/config";
import en from "@/i18n/messages/en/studioInspect.json";
import studio from "@/i18n/messages/en/studio.json";
import models from "@/i18n/messages/en/studioModels.json";
import type { Project } from "@/project/generated/types";
import { createSession } from "@/project/session";
import { seededRandom, steppingClock } from "@/project/session.testing";
import { createSessionStore } from "@/studio/stores/session";
import { createUiStore } from "@/studio/stores/ui";
import type { Selectable } from "@/studio/stores/session";
import { blinkCircuit } from "@/studio/testing/blink-circuit";
import { createRecordingDoc } from "@/studio/testing/recording-doc";
import { registerCommand } from "@/studio/commands";
import { legRecipe } from "@/studio/rules/connect";
import { Inspector } from "./Inspector";

const VIEW = "vw_bb";
const part = (id: string): Selectable => ({ kind: "part", view: VIEW, id });

const ui = () => createUiStore("test", { getItem: () => null, setItem: () => {} });

afterEach(cleanup);

function setup(select: string[] = [], project?: Project) {
  const circuit = blinkCircuit();
  const doc = createRecordingDoc(createSession({ state: project ?? circuit.project, clock: steppingClock(), rnd: seededRandom() }));
  const session = createSessionStore(VIEW);
  session.setSelection(select.map(part));
  const view = render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
  return { circuit, doc, session, ...view };
}

const input = (name: string | RegExp) => screen.getByLabelText(name, { selector: "input" }) as HTMLInputElement;
const type = (name: string | RegExp, text: string) => {
  const field = input(name);
  fireEvent.change(field, { target: { value: text } });
  fireEvent.blur(field);
};

describe("Inspector", () => {
  it("says so when nothing is selected, and still lists the nets", () => {
    setup();
    expect(screen.getByText(en.empty.title)).toBeTruthy();
    expect(screen.getByRole("heading", { name: en.sections.nets })).toBeTruthy();
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThan(0);
  });

  it("counts a multi-selection", () => {
    const { circuit } = setup();
    cleanup();
    setup([circuit.r1, circuit.led]);
    expect(screen.getByText("2 items selected")).toBeTruthy();
  });

  it("offers align, distribute and group from two selected parts, not from one, and runs the command", () => {
    const { circuit } = setup();
    cleanup();
    setup([circuit.led]);
    expect(screen.queryByRole("button", { name: studio.align.top })).toBeNull();
    cleanup();
    const run = vi.fn();
    const off = registerCommand({ id: "align.top", labelKey: "x", scope: "canvas", enabled: () => true, run });
    setup([circuit.r1, circuit.led]);
    fireEvent.click(screen.getByRole("button", { name: studio.align.top }));
    expect(run).toHaveBeenCalledTimes(1);
    for (const name of [studio.align.distributeH, studio.align.group, studio.align.ungroup]) expect(screen.getByRole("button", { name })).toBeTruthy();
    off();
  });

  it("shows the value fields, pin names and model level of the selected part from its descriptor", () => {
    const { circuit } = setup();
    cleanup();
    setup([circuit.led]);
    expect(screen.getByRole("heading", { name: en.sections.identity })).toBeTruthy();
    expect(screen.getByLabelText("Colour", { selector: "select" })).toBeTruthy();
    const pins = within(screen.getByRole("heading", { name: en.sections.pins }).parentElement!);
    expect(pins.getByText("Anode")).toBeTruthy();
    expect(pins.getByText("Cathode")).toBeTruthy();
    expect(pins.getAllByText(/^In net /).length).toBe(2);
    expect(screen.getByLabelText(`${models.chip}: ${models.tiers.T1.name}`)).toBeTruthy();
    expect(input(en.identity.refdes).value).toBe("D1");
    expect(input(en.position.x).value).not.toBe("");
  });

  it("says where a seated pin is when nothing else is joined to it", () => {
    const { circuit } = setup();
    cleanup();
    const bare: Project = { ...circuit.project, nets: [] };
    setup([circuit.led], bare);
    const pins = within(screen.getByRole("heading", { name: en.sections.pins }).parentElement!);
    expect(pins.queryAllByText("Not connected")).toHaveLength(0);
    expect(pins.getAllByText(/^In hole [a-j]\d+, nothing else joined yet$/)).toHaveLength(2);
  });

  it("shows the resistance in engineering units", () => {
    const { circuit } = setup();
    cleanup();
    setup([circuit.r1]);
    expect(input("Resistance").value).toBe("220Ω");
    expect(screen.getByText("Default: 220Ω")).toBeTruthy();
  });

  it("takes 4k7 as 4700 ohms (STU-14)", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.r1)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    type("Resistance", "4k7");
    expect(doc.commits.at(-1)!.batch).toEqual([{ k: "component.set", id: circuit.r1, params: { ohms: 4700 } }]);
    expect(doc.getState().state.components.find((c) => c.id === circuit.r1)!.params).toEqual({ ohms: 4700 });
    expect(input("Resistance").value).toBe("4.7kΩ");
  });

  it("refuses 0 and text with the limits shown, and writes nothing", () => {
    const { circuit, doc } = setup();
    cleanup();
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.r1)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    type("Resistance", "0");
    expect(screen.getByRole("alert").textContent).toBe("Use a value from 1mΩ to 1GΩ.");
    type("Resistance", "banana");
    expect(screen.getByRole("alert").textContent).toBe(en.value.nan);
    type("Resistance", "");
    expect(screen.getByRole("alert").textContent).toBe(en.value.empty);
    type("Resistance", "10uF");
    expect(screen.getByRole("alert").textContent).toBe("That unit does not fit here. This value is in ohms.");
    expect(doc.commits).toHaveLength(0);
    fireEvent.keyDown(input("Resistance"), { key: "Escape" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input("Resistance").value).toBe("220Ω");
  });

  it("changes an enum value from its list", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.led)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    fireEvent.change(screen.getByLabelText("Colour", { selector: "select" }), { target: { value: "green" } });
    expect(doc.commits.at(-1)!.batch).toEqual([{ k: "component.set", id: circuit.led, params: { color: "green" } }]);
  });

  it("renames the reference, and refuses a bad or a taken one", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.r1)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    type(en.identity.refdes, "1R");
    expect(screen.getByRole("alert").textContent).toBe(en.identity.refdesInvalid);
    type(en.identity.refdes, "D1");
    expect(screen.getByRole("alert").textContent).toBe("D1 is already used by another part.");
    expect(doc.commits).toHaveLength(0);
    type(en.identity.refdes, "R7");
    expect(doc.getState().state.components.find((c) => c.id === circuit.r1)!.refdes).toBe("R7");
  });

  it("sets and clears the label", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.r1)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    type(en.identity.label, "pull down");
    expect(doc.getState().state.components.find((c) => c.id === circuit.r1)!.label).toBe("pull down");
    type(en.identity.label, "  ");
    expect(doc.getState().state.components.find((c) => c.id === circuit.r1)!.label).toBeUndefined();
  });

  it("moves and turns the part with one view.place each", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.r1)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    type(en.position.x, "30.5");
    expect(doc.commits.at(-1)!.batch).toMatchObject([{ k: "view.place", placement: { c: circuit.r1, x_mm: 30.5 } }]);
    type(en.position.y, "x");
    expect(screen.getByRole("alert").textContent).toBe("Use a number from -1000000 to 1000000.");
  });

  it("turns a free part with one view.place", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.uno)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    fireEvent.change(screen.getByLabelText(en.position.rotation, { selector: "select" }), { target: { value: "90" } });
    expect(doc.commits.at(-1)!.batch).toMatchObject([{ k: "view.place", placement: { c: circuit.uno, rotation_deg: 90 } }]);
  });

  it("seats a part in holes again when it is turned, and says why not when the legs have no free holes", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    const led = circuit.project.views.find((v) => v.id === VIEW)!.placements.find((p) => p.c === circuit.led)!;
    const legs = { A: "e5", K: "e6" };
    session.setSelection([part(circuit.r1)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    const turn = screen.getByLabelText(en.position.rotation, { selector: "select" });

    fireEvent.change(turn, { target: { value: "270" } });
    expect(doc.getState().state.views.find((v) => v.id === VIEW)!.placements.find((p) => p.c === circuit.r1)).toMatchObject({ rotation_deg: 270, legs: { P1: "a5", P2: "e5" } });

    fireEvent.change(turn, { target: { value: "0" } });
    expect(doc.getState().state.views.find((v) => v.id === VIEW)!.placements.find((p) => p.c === circuit.r1)!.legs).toEqual({ P1: "a5", P2: "a9" });
    act(() => {
      doc.commit([{ k: "view.place", view: VIEW, placement: { ...led, legs } }, ...legRecipe(doc.getState().state, VIEW, circuit.led, legs, (prefix) => `${prefix}_i1`)], { label: "Move D1" });
    });
    const commits = doc.commits.length;
    fireEvent.change(turn, { target: { value: "270" } });
    expect(doc.commits).toHaveLength(commits);
    expect(screen.getByRole("alert").textContent).toBe(en.position.turnRefused);
  });

  it("changes the colour of a selected wire and the class of its net, each in one commit that undoes", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    const wire = circuit.project.views.find((v) => v.id === VIEW)!.wires[0]!;
    session.setSelection([{ kind: "wire", view: VIEW, id: wire.id }]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);

    fireEvent.click(screen.getByRole("radio", { name: en.wire.colors.blue }));
    expect(doc.commits.at(-1)!.batch).toEqual([{ k: "wire.set", view: VIEW, id: wire.id, color: "blue" }]);
    expect(doc.getState().state.views.find((v) => v.id === VIEW)!.wires.find((w) => w.id === wire.id)!.color).toBe("blue");

    fireEvent.change(screen.getByLabelText(en.wire.netClass, { selector: "select" }), { target: { value: "analog" } });
    expect(doc.commits.at(-1)!.batch).toEqual([{ k: "net.set", id: wire.net, class: "analog" }]);
    expect(doc.getState().state.nets.find((n) => n.id === wire.net)!.class).toBe("analog");
    fireEvent.change(screen.getByLabelText(en.wire.netClass, { selector: "select" }), { target: { value: "none" } });
    expect("class" in doc.getState().state.nets.find((n) => n.id === wire.net)!).toBe(false);
  });

  it("sets the focus net from a row of the Nets section and clears it on a second press", () => {
    const { circuit, session } = setup();
    const row = screen.getAllByRole("button", { pressed: false })[0]!;
    fireEvent.click(row);
    expect(session.getState().focusNet).toBe(circuit.project.nets[0]!.id);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { pressed: true })[0]!);
    expect(session.getState().focusNet).toBeNull();
  });

  it("shows a label or a net name with markup as plain text", () => {
    const circuit = blinkCircuit();
    const hostile = '<img src=x onerror="alert(1)">';
    const state: Project = {
      ...circuit.project,
      components: circuit.project.components.map((c) => (c.id === circuit.r1 ? { ...c, label: hostile } : c)),
      nets: circuit.project.nets.map((n, i) => (i === 0 ? { ...n, name: hostile } : n)),
    };
    const { container } = setup([circuit.r1], state);
    expect(container.querySelector("img")).toBeNull();
    expect(input(en.identity.label).value).toBe(hostile);
    expect(screen.getAllByText(hostile).length).toBeGreaterThan(0);
  });

  it("disables every field on a read-only document but keeps them visible", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    doc.setSaveChip("read-only");
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.r1)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    for (const field of [input("Resistance"), input(en.identity.refdes), input(en.identity.label), input(en.position.x)]) {
      expect(field.readOnly).toBe(true);
      expect(field.getAttribute("aria-disabled")).toBe("true");
    }
    expect((screen.getByLabelText(en.position.rotation, { selector: "select" }) as HTMLSelectElement).disabled).toBe(true);
    type("Resistance", "1k");
    expect(doc.commits).toHaveLength(0);
  });

  it("drops a selected part that undo removed, and says how many are left", () => {
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    session.setSelection([part(circuit.r1), part(circuit.led)]);
    render(<Inspector doc={doc} session={session} ui={ui()} messages={en} alignMessages={studio.align} modelMessages={models} lang="en" />);
    act(() => void doc.commit([{ k: "component.remove", id: circuit.led }], { label: "x" }));
    expect(session.getState().selection).toEqual([part(circuit.r1)]);
    expect(session.getState().status).toEqual({ key: "selection.pruned", params: { count: 1 } });
  });

  it.each(LOCALES)("renders in %s without a missing string", async (lang: Locale) => {
    const messages = (await import(`@/i18n/messages/${lang}/studioInspect.json`)).default;
    const modelMessages = (await import(`@/i18n/messages/${lang}/studioModels.json`)).default;
    const circuit = blinkCircuit();
    const doc = createRecordingDoc(createSession({ state: circuit.project, clock: steppingClock(), rnd: seededRandom() }));
    const session = createSessionStore(VIEW);
    for (const id of [circuit.r1, circuit.led, "brd_uno"]) {
      session.setSelection([part(id)]);
      const { unmount } = render(<Inspector doc={doc} session={session} ui={ui()} messages={messages} alignMessages={studio.align} modelMessages={modelMessages} lang={lang} />);
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(3);
      unmount();
    }
  });
});
