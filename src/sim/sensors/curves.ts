/** How each analog sensor turns its physical input into the resistance or the volts the solver stamps. */

const LDR_R10_OHMS = 15_000;
const LDR_GAMMA = 0.6;
const LDR_DARK_OHMS = 1e6;

/** GL5528 maker curve: 15 kohm at 10 lux, gamma 0.6, clamped at the dark resistance. */
export function ldrOhms(lux: number): number {
  return lux <= 0 ? LDR_DARK_OHMS : Math.min(LDR_DARK_OHMS, LDR_R10_OHMS * Math.pow(lux / 10, -LDR_GAMMA));
}

/** FSR 402: force in newtons against resistance, read off the maker's log-log chart. */
const FSR_TABLE: readonly (readonly [newtons: number, ohms: number])[] = [
  [0.2, 30_000],
  [1, 6_000],
  [10, 1_000],
  [100, 250],
];
const FSR_OPEN_OHMS = 1e7;

/** Open (10 megohm) below the 0.2 N actuation force; flat above 100 N. */
export function fsrOhms(newtons: number): number {
  const [firstN] = FSR_TABLE[0]!;
  if (!(newtons >= firstN)) return FSR_OPEN_OHMS;
  for (let i = 1; i < FSR_TABLE.length; i++) {
    const [f0, r0] = FSR_TABLE[i - 1]!;
    const [f1, r1] = FSR_TABLE[i]!;
    if (newtons <= f1) return Math.exp(Math.log(r0) + (Math.log(newtons / f0) / Math.log(f1 / f0)) * Math.log(r1 / r0));
  }
  return FSR_TABLE[FSR_TABLE.length - 1]![1];
}

/** TMP36: 0.5 V at 0 degrees C and 10 mV per degree. */
export const tmp36Volts = (celsius: number): number => 0.5 + 0.01 * celsius;
export const tmp36Celsius = (volts: number): number => (volts - 0.5) / 0.01;

const SOIL_AIR_VOLTS = 2.6;
const SOIL_WATER_VOLTS = 1.4;

/** Capacitive soil probe: AOUT falls from the dry-air level to the in-water level as the soil gets wetter. */
export const soilVolts = (percent: number): number => SOIL_AIR_VOLTS - (SOIL_AIR_VOLTS - SOIL_WATER_VOLTS) * (Math.min(100, Math.max(0, percent)) / 100);
export const soilPercent = (volts: number): number => Math.min(100, Math.max(0, ((SOIL_AIR_VOLTS - volts) / (SOIL_AIR_VOLTS - SOIL_WATER_VOLTS)) * 100));

/** QTR-8RC: how dark each of the eight sensors sees a line under sensor `position` (0 to 7), from the lesson world. */
export const QTR_SENSORS = 8;
export function qtrDarkness(position: number): number[] {
  return Array.from({ length: QTR_SENSORS }, (_, i) => Math.exp(-((i - position) ** 2) / (2 * 0.55 ** 2)));
}

/** The volts on a QTR output: a dark surface keeps the RC node charged, which the sketch libraries read as a high level. */
export const qtrVolts = (position: number): number[] => qtrDarkness(position).map((dark) => Math.round(dark * QTR_LOGIC_VOLTS * 1000) / 1000);
const QTR_LOGIC_VOLTS = 5;
