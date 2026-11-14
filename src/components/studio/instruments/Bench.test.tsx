import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import messages from "@/i18n/messages/en/instruments.json";
import { fgenSettings, psuSettings } from "@/studio/instruments/bench";
import { FunctionGenerator } from "./FunctionGenerator";
import { PowerSupply } from "./PowerSupply";

const common = { editable: true, messages, lang: "en" as const, returns: [{ value: "", label: "Ground" }, { value: "net_a", label: "A" }], returnValue: "", onReturn: vi.fn() };

describe("FunctionGenerator", () => {
  it("takes a frequency typed with a prefix when the field is left", () => {
    const onChange = vi.fn();
    render(<FunctionGenerator {...common} stepNs={10_000} status="on" settings={fgenSettings(undefined)} onChange={onChange} />);
    const field = screen.getByLabelText("Frequency (Hz)");
    expect((field as HTMLInputElement).value).toBe("1kHz");
    fireEvent.change(field, { target: { value: "2.5k" } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith({ hz: 2500 });
  });

  it("refuses a frequency outside the generator's range and says what range", () => {
    const onChange = vi.fn();
    render(<FunctionGenerator {...common} stepNs={10_000} status="on" settings={fgenSettings(undefined)} onChange={onChange} />);
    const field = screen.getByLabelText("Frequency (Hz)");
    fireEvent.change(field, { target: { value: "5M" } });
    fireEvent.blur(field);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Use a value from 100mHz to 1MHz.");
  });

  it("shows the rate the solver samples the wave at, with no warning while the wave is drawn from enough points", () => {
    render(<FunctionGenerator {...common} stepNs={10_000} status="on" settings={fgenSettings({ hz: 1000 })} onChange={vi.fn()} />);
    expect(screen.getByText("Sample rate 100kHz")).toBeTruthy();
    expect(screen.queryByText(/drawn from few points/)).toBeNull();
  });

  it("says above a tenth of the sample rate that the wave is drawn from few points", () => {
    render(<FunctionGenerator {...common} stepNs={10_000} status="on" settings={fgenSettings({ hz: 50_000 })} onChange={vi.fn()} />);
    expect(screen.getByText("Sample rate 100kHz")).toBeTruthy();
    expect(screen.getByText("Above 10kHz the wave is drawn from few points (2 per period at 50kHz).")).toBeTruthy();
  });

  it("follows a step the project names, and is coarse sooner at a coarser one", () => {
    render(<FunctionGenerator {...common} stepNs={1_000_000} status="on" settings={fgenSettings({ hz: 500 })} onChange={vi.fn()} />);
    expect(screen.getByText("Sample rate 50kHz")).toBeTruthy();
    expect(screen.queryByText(/drawn from few points/)).toBeNull();
  });

  it("shows the duty only for a pulse", () => {
    const { rerender } = render(<FunctionGenerator {...common} stepNs={10_000} status="on" settings={fgenSettings({ shape: "square" })} onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Duty (percent)")).toBeNull();
    rerender(<FunctionGenerator {...common} stepNs={10_000} status="on" settings={fgenSettings({ shape: "pulse" })} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Duty (percent)")).toBeTruthy();
  });

  it("switches the output and picks a return lead", () => {
    const onChange = vi.fn();
    render(<FunctionGenerator {...common} stepNs={10_000} status="on" settings={fgenSettings(undefined)} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Output" }));
    expect(onChange).toHaveBeenCalledWith({ on: false });
    fireEvent.change(screen.getByLabelText("Return lead"), { target: { value: "net_a" } });
    expect(common.onReturn).toHaveBeenCalledWith("net_a");
  });

  it("says why the solver is not driving the circuit", () => {
    render(<FunctionGenerator {...common} stepNs={10_000} status="not-modelled-yet" settings={fgenSettings(undefined)} onChange={vi.fn()} />);
    expect(screen.getByText(messages.bench.status.notModelled)).toBeTruthy();
  });

  it("cannot be changed by a viewer", () => {
    render(<FunctionGenerator {...common} stepNs={10_000} editable={false} status="idle" settings={fgenSettings(undefined)} onChange={vi.fn()} />);
    expect((screen.getByLabelText("Frequency (Hz)") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("switch", { name: "Output" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("PowerSupply", () => {
  it("shows constant voltage with the live volts and amps", () => {
    render(<PowerSupply {...common} status="on" settings={psuSettings(undefined)} reading={{ volts: 5, amps: 0.0123, limiting: false }} onChange={vi.fn()} />);
    expect(screen.getByTestId("psu-mode").textContent).toBe("CV");
    expect(screen.getByTestId("psu-readout").textContent).toContain("5V");
    expect(screen.getByTestId("psu-readout").textContent).toContain("12.3mA");
  });

  it("shows constant current while the supply holds its limit", () => {
    render(<PowerSupply {...common} status="on" settings={psuSettings({ limitAmps: 0.3 })} reading={{ volts: 3, amps: 0.3, limiting: true }} onChange={vi.fn()} />);
    const badge = screen.getByTestId("psu-mode");
    expect(badge.textContent).toBe("CC");
    expect(badge.getAttribute("title")).toBe("Constant current");
  });

  it("has no reading before the run reports one or with the output off", () => {
    const { rerender } = render(<PowerSupply {...common} status="on" settings={psuSettings(undefined)} reading={null} onChange={vi.fn()} />);
    expect(screen.getByText("No reading yet")).toBeTruthy();
    rerender(<PowerSupply {...common} status="off" settings={psuSettings({ on: false })} reading={{ volts: 5, amps: 0, limiting: false }} onChange={vi.fn()} />);
    expect(screen.getByText("No reading yet")).toBeTruthy();
  });

  it("sets the voltage and the current limit", () => {
    const onChange = vi.fn();
    render(<PowerSupply {...common} status="on" settings={psuSettings(undefined)} reading={null} onChange={onChange} />);
    const volts = screen.getByLabelText("Voltage (V)");
    fireEvent.change(volts, { target: { value: "3.3" } });
    fireEvent.blur(volts);
    expect(onChange).toHaveBeenCalledWith({ volts: 3.3 });
    const limit = screen.getByLabelText("Current limit (A)");
    fireEvent.change(limit, { target: { value: "250m" } });
    fireEvent.keyDown(limit, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ limitAmps: 0.25 });
  });
});
