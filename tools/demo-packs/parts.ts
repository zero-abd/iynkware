/**
 * The demo part packs: what each imported variant is and which modelled core part it borrows behaviour from.
 * The manufacturers are invented demo brands, not real companies.
 */
import type { Descriptor } from "../../src/parts/descriptor.ts";

export const PACK_AUTHOR = "iynkware demo";
/** Fixed so the packs are byte-identical on every rebuild. */
export const PACK_CREATED = "2026-11-14T00:00:00.000Z";

export interface DemoPart {
  slug: string;
  /** The core part whose pins, behaviour and simulation the variant keeps. */
  base: string;
  manufacturer: string;
  model: string;
  description: string;
  /** Short text on the generic drawing. */
  label: string;
  /** Body colour of the generic drawing. */
  colour?: string;
  mpn?: string;
  tags?: string[];
  edit?: (d: Descriptor & Record<string, unknown>) => void;
}

export const DEMO_PARTS: readonly DemoPart[] = [
  {
    slug: "blue-led-10mm",
    label: "LED 10mm",
    colour: "#2f6fe0",
    base: "core.led-5mm",
    manufacturer: "Brightcell (demo brand)",
    model: "10 mm blue LED",
    description: "A 10 mm blue indicator LED from a demo vendor's part file. Needs a series resistor, like any LED.",
    tags: ["demo-import", "led", "blue"],
  },
  {
    slug: "photoresistor-module",
    label: "LDR",
    colour: "#b8862e",
    base: "core.ldr",
    manufacturer: "Lumen Labs (demo brand)",
    model: "Photoresistor light sensor",
    description: "A light-dependent resistor from a demo vendor's part file. Its resistance falls as light rises.",
    tags: ["demo-import", "light", "sensor"],
  },
  {
    slug: "piezo-buzzer",
    label: "Buzzer",
    colour: "#1f1f22",
    base: "core.buzzer-piezo",
    manufacturer: "Tonewell (demo brand)",
    model: "12 mm piezo buzzer",
    description: "A small piezo buzzer from a demo vendor's part file. Driven with a square wave, it beeps.",
    tags: ["demo-import", "sound"],
  },
  {
    slug: "bme280-breakout",
    label: "BME280",
    colour: "#1d7f6a",
    base: "core.bme280-module",
    manufacturer: "Sensorly (demo brand)",
    model: "BME280 environment breakout",
    description: "A temperature, humidity and pressure breakout on I2C from a demo vendor's part file.",
    mpn: "BME280",
    tags: ["demo-import", "i2c", "temperature", "humidity"],
  },
  {
    slug: "mpu6050-board",
    label: "MPU-6050",
    colour: "#2b4c9a",
    base: "core.gy521-mpu6050",
    manufacturer: "Motionworks (demo brand)",
    model: "MPU-6050 motion board",
    description: "A six-axis accelerometer and gyroscope board on I2C from a demo vendor's part file.",
    mpn: "MPU-6050",
    tags: ["demo-import", "i2c", "motion", "imu"],
  },
  {
    slug: "oled-096",
    label: "OLED 0.96",
    colour: "#123a6b",
    base: "core.ssd1306",
    manufacturer: "Pixelbay (demo brand)",
    model: "0.96 inch OLED display",
    description: "A 128 by 64 pixel monochrome OLED on I2C from a demo vendor's part file.",
    mpn: "SSD1306",
    tags: ["demo-import", "i2c", "display"],
  },
];
