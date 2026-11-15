/**
 * What a lesson step points at on the bench, read from the step's English text and the document: the exact anchors it
 * names. Pure, so every lesson's steps can be tested. Highlights are drawn by the guide panel and the callouts.
 *
 *  - board pins of the board's descriptor named as whole words (D13, GND, 5V, GPIO23, EN), and "pin 13";
 *  - refdes (LED1, RES1, U1);
 *  - part words ("LED", "resistor", "breadboard", "button", ...): the components of that kind;
 *  - "long leg" or "anode": the LED's anode, labelled "+"; "short leg" or "cathode": its cathode, "−";
 *  - an ohm value ("10 kΩ"): the resistors;
 *  - the template's `guide.pins` and `guide.callouts` when the step names their pin or part;
 *  - a step that says Run: the parts to watch (LEDs, buzzers, servos, motors, displays).
 */
import type { Descriptor, Project } from '../../contracts/project';
import type { BoardTarget } from '../../contracts/space';
import type { Highlight } from '../types';

export type Describe = (ref: string, version?: string) => Descriptor | undefined;

const LED = /^core\.(led-|rgb-led|traffic-light)/;
const RESISTOR = /^core\.resistor/;
/** Parts that show what a run does. */
const WATCH = /^core\.(led-|rgb-led|traffic-light|buzzer|servo|tt-motor|dc-motor|fan|ssd1306|lcd)/;

/** English words for part kinds and the definitions they stand for. `LED` is matched in capitals only. */
const PART_WORDS: ReadonlyArray<{ readonly word: RegExp; readonly ref: RegExp }> = [
  { word: /\bLEDs?\b/, ref: LED },
  { word: /\bresistors?\b/i, ref: RESISTOR },
  { word: /\bbreadboards?\b/i, ref: /^core\.breadboard/ },
  { word: /\b(push ?)?buttons?\b/i, ref: /^core\.push-button/ },
  { word: /\b(potentiometers?|pots?|knobs?)\b/i, ref: /^core\.potentiometer/ },
  { word: /\bbuzzers?\b/i, ref: /^core\.buzzer/ },
  { word: /\bservos?\b/i, ref: /^core\.servo/ },
  { word: /\bmotors?\b/i, ref: /^core\.(tt-motor|dc-motor|stepper|nema)/ },
  { word: /\bdiodes?\b/i, ref: /^core\.diode/ },
  { word: /\btransistors?\b/i, ref: /^core\.tip120/ },
  { word: /\b(multi)?meters?\b/i, ref: /^core\.multimeter/ },
  { word: /\b(batter(y|ies)|battery pack)\b/i, ref: /^core\.(lipo|aa-holder)/ },
  { word: /\b(LDR|photoresistors?|light sensors?)\b/i, ref: /^core\.ldr/ },
  { word: /\b(display|OLED|screen)s?\b/i, ref: /^core\.(ssd1306|lcd)/ },
];

const ANODE = /\b(long leg|longer leg|anode)\b/i;
const CATHODE = /\b(short leg|shorter leg|cathode)\b/i;
const OHMS = /\d\s*[kM]?\s*Ω|\bohms?\b/i;
const RUN = /\brun\b/i;
const PIN_NUMBER = /\bpin (\d{1,2})\b/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The name appears as a whole word, in this case (pin names and refdes are case-sensitive). */
const names = (text: string, name: string) => new RegExp(`(?<![A-Za-z0-9_~])${escape(name)}(?![A-Za-z0-9_])`).test(text);

/** A pin name worth matching: not a bare number ("13" on an ESP32 header) and not a single letter. */
const matchable = (name: string) => name.length >= 2 && !/^\d+$/.test(name);

/** "D8-D11" is D8, D9, D10 and D11; any other label is itself. */
function pinRange(label: string): string[] {
  const m = /^([A-Za-z_]+)(\d+)\s*[-–]\s*(?:\1)?(\d+)$/.exec(label);
  if (!m) return [label];
  const [from, to] = [Number(m[2]), Number(m[3])];
  if (!(to > from) || to - from > 40) return [label];
  return Array.from({ length: to - from + 1 }, (_, i) => `${m[1]}${from + i}`);
}

/**
 * The names a board's pins go by in prose: the pin id, the printed designator, and the labels the board's own silkscreen
 * and Arduino header use (basys3 `sw0` is printed SW0, `led0` is LD0; the DE10-Lite's `ARDUINO_IO3` is D3). The first
 * to claim a name keeps it.
 */
function pinNames(pins: ReadonlyArray<{ id: string; designator?: string }>): Map<string, string> {
  const byName = new Map<string, string>();
  const claim = (name: string, pin: string) => {
    if (matchable(name) && !byName.has(name)) byName.set(name, pin);
  };
  for (const p of pins) claim(p.id, p.id);
  for (const p of pins) claim(p.designator?.replace(/^~/, '') ?? '', p.id);
  for (const p of pins) {
    const led = /^led(\d+)$/.exec(p.id);
    if (led) claim(`LD${led[1]}`, p.id);
    else if (/^[a-z]+\d+$/.test(p.id)) claim(p.id.toUpperCase(), p.id);
    const io = /^ARDUINO_IO(\d+)$/.exec(p.id);
    if (io) claim(`D${io[1]}`, p.id);
  }
  return byName;
}

export function stepTargets(doc: Project, text: string, describe: Describe): Highlight[] {
  const out = new Map<string, Highlight>();
  const add = (target: BoardTarget, label?: string) => {
    const key = JSON.stringify(target);
    if (!out.has(key)) out.set(key, label === undefined ? { target, tone: 'do' } : { target, tone: 'do', label });
  };
  const ofKind = (ref: RegExp) => doc.components.filter((c) => ref.test(c.definition.ref));

  // Board pins: a pin's own id first, then its printed name; one pin per name (the first GND, not all three).
  for (const board of doc.boards) {
    const pins = (describe(board.definition.ref, board.definition.version)?.pins ?? []).filter((p) => p.class !== 'nc');
    const byName = pinNames(pins);
    for (const [name, pin] of byName) if (names(text, name)) add({ kind: 'pin', part: board.id, pin }, name);
    for (const m of text.matchAll(PIN_NUMBER)) {
      const pin = [`D${m[1]}`, `GPIO${m[1]}`, `GP${m[1]}`].find((id) => pins.some((p) => p.id === id));
      if (pin) add({ kind: 'pin', part: board.id, pin }, pin);
    }
    // The template's pin notes: only a pin the board has (a note may name a header range or a vendor label).
    for (const p of doc.guide?.pins ?? []) {
      for (const label of pinRange(p.pin)) {
        const pin = byName.get(label);
        if (pin && names(text, label)) add({ kind: 'pin', part: board.id, pin }, label);
      }
    }
  }

  // Parts by refdes, by the callouts that name them, and by kind.
  const byRefdes = new Map<string, string>();
  for (const x of [...doc.boards, ...doc.components]) byRefdes.set(x.refdes, x.id);
  for (const [refdes, part] of byRefdes) if (matchable(refdes) && names(text, refdes)) add({ kind: 'part', part }, refdes);
  for (const c of doc.guide?.callouts ?? []) {
    const part = byRefdes.get(c.target);
    if (part && names(text, c.target)) add({ kind: 'part', part }, c.target);
  }
  for (const { word, ref } of PART_WORDS) if (word.test(text)) for (const c of ofKind(ref)) add({ kind: 'part', part: c.id });
  if (OHMS.test(text)) for (const c of ofKind(RESISTOR)) add({ kind: 'part', part: c.id });

  // The LED's legs.
  const leds = ofKind(/^core\.led-/);
  if (ANODE.test(text)) for (const c of leds) add({ kind: 'pin', part: c.id, pin: 'A' }, '+');
  if (CATHODE.test(text)) for (const c of leds) add({ kind: 'pin', part: c.id, pin: 'K' }, '−');

  // A test step: the part to watch.
  if (RUN.test(text)) for (const c of ofKind(WATCH)) add({ kind: 'part', part: c.id });

  return [...out.values()];
}
