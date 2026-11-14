/** One thing a person can change on a sensor while the run is going: the part's own setting of that name. */
export interface SensorInput {
  param: string;
  min: number;
  max: number;
  /** Where it starts when the part's setting does not carry it. */
  default: number;
  unit: string;
  /** Said before the value when the unit alone does not say what it is. */
  label?: string;
}

/** The run-time input of each sensor, by descriptor ref without the version. */
const SENSOR_INPUTS: Readonly<Record<string, SensorInput>> = {
  "core.ldr": { param: "lux", min: 0, max: 1000, default: 300, unit: "lux" },
  "core.fsr402": { param: "force", min: 0, max: 20, default: 0, unit: "N" },
  "core.soil-moisture": { param: "moisture", min: 0, max: 100, default: 40, unit: "%" },
  "core.tmp36": { param: "temp_c", min: -40, max: 125, default: 22, unit: "°C" },
  "core.hc-sr04": { param: "distance", min: 2, max: 400, default: 25, unit: "cm" },
  "core.qtr-8rc": { param: "line", min: 0, max: 7, default: 3.5, unit: "", label: "line under" },
};

export const sensorInputOf = (ref: string): SensorInput | null => SENSOR_INPUTS[ref.replace(/@.*$/, "")] ?? null;
