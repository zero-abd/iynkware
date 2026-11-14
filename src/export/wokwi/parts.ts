import type { ParamValue } from "../../project/generated/types.ts";

/** Why a Wokwi part, pin or attribute did not come across. Each code has a sentence in every language (`studio.wokwi.reason`). */
export type Reason =
  | "no-part"
  | "no-display"
  | "no-sensor"
  | "no-led-chain"
  | "no-board"
  | "module-expanded"
  | "pin-unused"
  | "pin-unknown"
  | "breadboard-size"
  | "breadboard-flattened"
  | "second-board"
  | "colour-nearest"
  | "attribute-dropped"
  | "drawn-only";

/** Where a Wokwi pin lands: a pin of the `part`-th iynk part this Wokwi part becomes. */
export interface Target {
  part: number;
  pin: string;
}

export interface MadePart {
  ref: string;
  params?: Record<string, ParamValue>;
}

export interface Made {
  parts: MadePart[];
  /** Pins of the made parts that are joined inside the Wokwi part (a module's own divider). */
  inside?: [Target, Target][];
  /** What was approximated, so the review can say so. */
  notes: { reason: Reason; detail: string }[];
}

export interface PartRule {
  kind: "board" | "part" | "surface";
  /** The board id iynk knows it by, for a board. */
  board?: string;
  /** What the Wokwi part becomes, from its attributes. */
  make(attrs: Record<string, unknown>): Made;
  /** A Wokwi pin name to its target, `null` for a pin iynk has no counterpart of, `undefined` for a name the part does not have. */
  pin(name: string): Target | null | undefined;
}

type Attrs = Record<string, unknown>;

const at = (pin: string, part = 0): Target => ({ part, pin });
const text = (attrs: Attrs, key: string): string | undefined => {
  const v = attrs[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
};
const onePart = (ref: string, params?: Record<string, ParamValue>): Made => ({ parts: [{ ref, ...(params && { params }) }], notes: [] });

const table = (pins: Record<string, string | null>) => (name: string): Target | null | undefined => {
  const hit = pins[name];
  return hit === undefined ? undefined : hit === null ? null : at(hit);
};

/** `4k7`, `220`, `1.5k`, `10M`, `2R2`: the ohms a Wokwi resistor value says, or undefined. */
export function ohmsOf(value: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kKmMrR]?)\s*(\d*)\s*(?:Ω|ohms?)?\s*$/.exec(value);
  if (!m) return undefined;
  const unit = m[2]!.toLowerCase();
  const scale = unit === "k" ? 1e3 : unit === "m" ? 1e6 : 1;
  const ohms = Number(m[3] ? `${m[1]}.${m[3]}` : m[1]) * scale;
  return Number.isFinite(ohms) && ohms > 0 ? ohms : undefined;
}

const LED_COLOURS = ["red", "yellow", "green", "blue", "white"] as const;
const LED_NEAREST: Record<string, (typeof LED_COLOURS)[number]> = {
  orange: "yellow",
  amber: "yellow",
  limegreen: "green",
  lime: "green",
  purple: "blue",
  cyan: "blue",
  magenta: "blue",
  pink: "red",
};

function led(attrs: Attrs): Made {
  const asked = (text(attrs, "color") ?? "red").toLowerCase();
  const exact = LED_COLOURS.find((c) => c === asked);
  const color = exact ?? LED_NEAREST[asked] ?? "red";
  const made = onePart("core.led-5mm", { color });
  if (!exact && asked !== "red") made.notes.push({ reason: "colour-nearest", detail: asked });
  return made;
}

function resistor(attrs: Attrs): Made {
  const raw = text(attrs, "value");
  const ohms = raw === undefined ? 1000 : ohmsOf(raw);
  const made = onePart("core.resistor", { ohms: ohms ?? 1000 });
  if (raw !== undefined && ohms === undefined) made.notes.push({ reason: "attribute-dropped", detail: `value ${raw}` });
  return made;
}

function potentiometer(attrs: Attrs): Made {
  const raw = Number(text(attrs, "value"));
  return onePart("core.potentiometer-10k", Number.isFinite(raw) ? { pos: Math.min(1, Math.max(0, raw / 1023)) } : undefined);
}

function slideSwitch(attrs: Attrs): Made {
  return onePart("core.slide-switch", { closed: text(attrs, "value") === "1" ? 1 : 0 });
}

function rgb(attrs: Attrs): Made {
  return onePart("core.rgb-led", { common: text(attrs, "common") === "cathode" ? "cathode" : "anode" });
}

function photoresistor(attrs: Attrs): Made {
  const lux = Number(text(attrs, "lux"));
  return {
    parts: [{ ref: "core.ldr", ...(Number.isFinite(lux) ? { params: { lux } } : {}) }, { ref: "core.resistor", params: { ohms: 10000 } }],
    inside: [[at("P2"), at("P1", 1)]],
    notes: [{ reason: "module-expanded", detail: "LDR + 10 kΩ" }],
  };
}

const SUPPLY_PINS = { "5V": "P5V", "3V3": "P3V3", "3.3V": "P3V3", VIN: "VIN" };

function arduinoPins(analog: number): (name: string) => Target | null | undefined {
  return (name) => {
    if (/^\d{1,2}$/.test(name)) return Number(name) <= 13 ? at(`D${name}`) : undefined;
    const a = /^A(\d)$/.exec(name);
    if (a) return Number(a[1]) < analog ? at(name) : undefined;
    if (/^GND(\.\d)?$/.test(name)) return at("GND");
    if (/^RESET(\.\d)?$/.test(name)) return at("RESET");
    if (name === "SDA" || name === "SCL" || name === "AREF" || name === "IOREF") return at(name);
    const supply = SUPPLY_PINS[name as keyof typeof SUPPLY_PINS];
    return supply ? at(supply) : undefined;
  };
}

function picoPins(name: string): Target | null | undefined {
  if (/^GP\d{1,2}$/.test(name)) return ["GP23", "GP24", "GP25", "GP29"].includes(name) ? undefined : at(name);
  if (/^GND(\.\d)?$/.test(name)) return at("GND");
  if (name === "3V3") return at("P3V3");
  if (name === "VBUS" || name === "VSYS" || name === "RUN" || name === "3V3_EN" || name === "ADC_VREF") return at(name);
  if (name === "TP4" || name === "TP5") return null;
  return undefined;
}

const ESP32_NAMED: Record<string, string> = { VP: "GPIO36", VN: "GPIO39", RX0: "GPIO3", TX0: "GPIO1", RX2: "GPIO16", TX2: "GPIO17", "3V3": "P3V3", "5V": "P5V", VIN: "P5V", EN: "EN" };

function esp32Pins(name: string): Target | null | undefined {
  if (/^GND(\.\d)?$/.test(name)) return at("GND");
  const named = ESP32_NAMED[name];
  if (named) return at(named);
  const gpio = /^(?:D|GPIO)?(\d{1,2})$/.exec(name);
  return gpio ? at(`GPIO${gpio[1]}`) : undefined;
}

/** The half and mini breadboards name a hole `<column><t|b>.<row>` and a rail hole `<tp|tn|bp|bn>.<n>`. */
function breadboardPin(name: string): Target | null | undefined {
  const hole = /^(\d{1,2})([tb])\.([a-j])$/.exec(name);
  if (hole) {
    const column = Number(hole[1]);
    const top = "abcde".includes(hole[3]!);
    if (column < 1 || column > 30 || top !== (hole[2] === "t")) return undefined;
    return at(`${hole[3]}${column}`);
  }
  const rail = /^([tb])([pn])\.(\d{1,2})$/.exec(name);
  if (!rail) return undefined;
  const n = Number(rail[3]);
  if (n < 1 || n > 25) return undefined;
  return at(`RAIL_${rail[1]!.toUpperCase()}${rail[2]!.toUpperCase()}${n + 1 + Math.floor((n - 1) / 5)}`);
}

const breadboard: PartRule = { kind: "surface", make: () => onePart("core.breadboard-half"), pin: breadboardPin };

export const RULES: Readonly<Record<string, PartRule>> = {
  "wokwi-arduino-uno": { kind: "board", board: "uno-r3", make: () => onePart("core.uno-r3"), pin: arduinoPins(6) },
  "wokwi-arduino-nano": { kind: "board", board: "nano", make: () => onePart("core.nano"), pin: arduinoPins(8) },
  "wokwi-pi-pico": { kind: "board", board: "pico", make: () => onePart("core.pico"), pin: picoPins },
  "wokwi-esp32-devkit-v1": { kind: "board", board: "esp32-devkitc", make: () => onePart("core.esp32-devkitc"), pin: esp32Pins },
  "board-esp32-s3-devkitc-1": { kind: "board", board: "esp32-s3-devkitc-1", make: () => onePart("core.esp32-s3-devkitc-1"), pin: esp32Pins },
  "board-esp32-devkit-c-v4": { kind: "board", board: "esp32-devkitc", make: () => onePart("core.esp32-devkitc"), pin: esp32Pins },
  "wokwi-breadboard-half": breadboard,
  "wokwi-breadboard-mini": breadboard,
  "wokwi-led": { kind: "part", make: led, pin: table({ A: "A", C: "K" }) },
  "wokwi-resistor": { kind: "part", make: resistor, pin: table({ "1": "P1", "2": "P2" }) },
  "wokwi-pushbutton": { kind: "part", make: () => onePart("core.push-button-6mm"), pin: table({ "1.l": "P1", "1.r": "P2", "2.l": "P3", "2.r": "P4" }) },
  "wokwi-pushbutton-6mm": { kind: "part", make: () => onePart("core.push-button-6mm"), pin: table({ "1.l": "P1", "1.r": "P2", "2.l": "P3", "2.r": "P4" }) },
  "wokwi-potentiometer": { kind: "part", make: potentiometer, pin: table({ GND: "P1", SIG: "W", VCC: "P3" }) },
  "wokwi-servo": { kind: "part", make: () => ({ ...onePart("core.servo-sg90"), notes: [{ reason: "drawn-only", detail: "" }] }), pin: table({ GND: "GND", "V+": "VPLUS", PWM: "SIG" }) },
  "wokwi-buzzer": { kind: "part", make: () => onePart("core.buzzer-piezo"), pin: table({ "1": "MINUS", "2": "PLUS" }) },
  "wokwi-hc-sr04": { kind: "part", make: () => onePart("core.hc-sr04"), pin: table({ VCC: "VCC", TRIG: "TRIG", ECHO: "ECHO", GND: "GND" }) },
  "wokwi-ssd1306": {
    kind: "part",
    make: () => onePart("core.ssd1306"),
    pin: table({ GND: "GND", VIN: "VCC", "3V3": "VCC", VCC: "VCC", DATA: "SDA", SDA: "SDA", CLK: "SCL", SCL: "SCL", DC: null, RST: null, CS: null }),
  },
  "wokwi-slide-switch": { kind: "part", make: slideSwitch, pin: table({ "1": "A", "2": "COM", "3": "B" }) },
  "wokwi-rgb-led": { kind: "part", make: rgb, pin: table({ R: "R", G: "G", B: "B", COM: "COM" }) },
  "wokwi-mpu6050": {
    kind: "part",
    make: () => onePart("core.gy521-mpu6050"),
    pin: table({ VCC: "VCC", GND: "GND", SCL: "SCL", SDA: "SDA", XDA: "XDA", XCL: "XCL", AD0: "AD0", INT: "INT" }),
  },
  "wokwi-photoresistor-sensor": {
    kind: "part",
    make: photoresistor,
    pin: (name) => ({ VCC: at("P1"), AO: at("P2"), GND: at("P2", 1), DO: null })[name],
  },
};

/** Wokwi parts that have no iynk counterpart, with the reason. Any other type gets `no-part`. */
export const UNSUPPORTED: Readonly<Record<string, Reason>> = {
  "wokwi-lcd1602": "no-display",
  "wokwi-lcd2004": "no-display",
  "wokwi-ili9341": "no-display",
  "wokwi-7segment": "no-display",
  "wokwi-neopixel": "no-led-chain",
  "wokwi-neopixel-matrix": "no-led-chain",
  "wokwi-led-ring": "no-led-chain",
  "wokwi-dht22": "no-sensor",
  "wokwi-ntc-temperature-sensor": "no-sensor",
  "wokwi-ds1307": "no-sensor",
  "wokwi-arduino-mega": "no-board",
  "board-pi-pico-w": "no-board",
  "wokwi-breadboard": "breadboard-size",
};
