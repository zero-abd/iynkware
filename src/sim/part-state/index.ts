import { ssd1306 } from "./display.ts";
import { ledLamps } from "./led.ts";
import { motorProvider } from "./motor.ts";
import { buckVolts, meterVolts, packVolts } from "./power.ts";
import { servoSg90 } from "./servo-sg90.ts";
import { driverOnly, nema17, stepper28byj48 } from "./stepper.ts";
import type { ProviderTable } from "./types.ts";

/** Add a part: write its provider in a file of its own here, import it above and list it below under its catalogue name. */
export const PROVIDERS: ProviderTable = {
  led: ledLamps(),
  "rgb-led": ledLamps(["R", "G", "B"]),
  "traffic-light": ledLamps(["R", "Y", "G"]),
  "servo-sg90": servoSg90,
  // motors and H-bridges
  "dc-motor": motorProvider("dc-motor"),
  "tt-motor": motorProvider("tt-motor"),
  "tt-motor-encoder": motorProvider("tt-motor"),
  fan: motorProvider("fan"),
  // steppers and the drivers a motor reads its inputs through
  "stepper-28byj48": stepper28byj48,
  nema17,
  uln2003: driverOnly,
  "l298n-module": driverOnly,
  "tb6612fng-module": driverOnly,
  "a4988-module": driverOnly,
  // power and instruments
  "aa-holder-4": packVolts,
  "lipo-2s": packVolts,
  "lm2596-module": buckVolts,
  multimeter: meterVolts,
  ssd1306,
};
