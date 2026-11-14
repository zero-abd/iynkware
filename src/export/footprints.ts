/** What KiCad calls a part: the symbol it is drawn as, the footprint it is built as, and which footprint pad each iynk pin is. */
export interface KicadPart {
  lib: string;
  symbol: string;
  description: string;
  footprint: string;
  /** iynk pin id to the pad number of the footprint (the symbol's pin number). */
  pads: Readonly<Record<string, string>>;
  /** How the part's `value` field reads: from a parameter in the unit given, or the fixed text. */
  value?: { param: string; unit: string } | string;
}

const TERMINAL_2 = "TerminalBlock:TerminalBlock_bornier-2_P5.08mm";
const header = (n: number) => `Connector_PinHeader_2.54mm:PinHeader_1x${String(n).padStart(2, "0")}_P2.54mm_Vertical`;
const numbered = (pins: readonly string[]): Record<string, string> => Object.fromEntries(pins.map((p, i) => [p, String(i + 1)]));

const DIP8 = "Package_DIP:DIP-8_W7.62mm";
const TO92 = "Package_TO_SOT_THT:TO-92_Inline";
const DO41 = "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal";

/**
 * The parts that have a footprint, from the stock KiCad 8 libraries. A part that is not here is exported without one and
 * named in the report; boards and modules are not here because KiCad draws them as a module with its own pad names.
 */
export const KICAD_PARTS: Readonly<Record<string, KicadPart>> = {
  "core.resistor": { lib: "Device", symbol: "R", description: "Resistor", footprint: "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal", pads: numbered(["P1", "P2"]), value: { param: "ohms", unit: "" } },
  "core.capacitor-ceramic": { lib: "Device", symbol: "C", description: "Unpolarized capacitor", footprint: "Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm", pads: numbered(["P1", "P2"]), value: { param: "farads", unit: "F" } },
  "core.capacitor-electrolytic": { lib: "Device", symbol: "CP", description: "Polarized capacitor", footprint: "Capacitor_THT:CP_Radial_D5.0mm_P2.00mm", pads: numbered(["PLUS", "MINUS"]), value: { param: "farads", unit: "F" } },
  "core.inductor": { lib: "Device", symbol: "L", description: "Inductor", footprint: "Inductor_THT:L_Axial_L5.3mm_D2.2mm_P10.16mm_Horizontal", pads: numbered(["P1", "P2"]), value: { param: "henries", unit: "H" } },
  "core.led-5mm": { lib: "Device", symbol: "LED", description: "Light emitting diode", footprint: "LED_THT:LED_D5.0mm", pads: { K: "1", A: "2" }, value: "LED" },
  "core.rgb-led": { lib: "Device", symbol: "LED_RGBC", description: "RGB LED, common cathode", footprint: "LED_THT:LED_D5.0mm-4_RGB", pads: numbered(["R", "COM", "G", "B"]), value: "LED_RGBC" },
  "core.diode-1n4007": { lib: "Diode", symbol: "1N4007", description: "1000V 1A general purpose diode", footprint: DO41, pads: { K: "1", A: "2" }, value: "1N4007" },
  "core.zener-1n4733a": { lib: "Diode", symbol: "1N4733A", description: "5.1V 1W Zener diode", footprint: DO41, pads: { K: "1", A: "2" }, value: "1N4733A" },
  "core.potentiometer-10k": { lib: "Device", symbol: "R_Potentiometer", description: "Potentiometer", footprint: "Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical", pads: { P1: "1", W: "2", P3: "3" }, value: { param: "ohms", unit: "" } },
  "core.push-button-6mm": { lib: "Switch", symbol: "SW_Push_Dual", description: "Push button, four legs", footprint: "Button_Switch_THT:SW_PUSH_6mm", pads: numbered(["P1", "P2", "P3", "P4"]), value: "SW_Push" },
  "core.slide-switch": { lib: "Switch", symbol: "SW_SPDT", description: "Switch, single pole double throw", footprint: "Button_Switch_THT:SW_Slide_1P2T_CK_OS102011MS2Q", pads: numbered(["A", "COM", "B"]), value: "SW_SPDT" },
  "core.buzzer-piezo": { lib: "Device", symbol: "Buzzer", description: "Buzzer", footprint: "Buzzer_Beeper:Buzzer_12x9.5RM7.6", pads: numbered(["PLUS", "MINUS"]), value: "Buzzer" },
  "core.ne555": { lib: "Timer", symbol: "NE555P", description: "Precision timers, 555 compatible", footprint: DIP8, pads: numbered(["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"]), value: "NE555P" },
  "core.lm358": { lib: "Amplifier_Operational", symbol: "LM358", description: "Dual op amp", footprint: DIP8, pads: numbered(["OUT1", "IN1N", "IN1P", "VEE", "IN2P", "IN2N", "OUT2", "VCC"]), value: "LM358" },
  "core.npn-2n2222": { lib: "Transistor_BJT", symbol: "2N2222", description: "NPN transistor", footprint: TO92, pads: numbered(["E", "B", "C"]), value: "2N2222" },
  "core.tip120": { lib: "Transistor_Darlington", symbol: "TIP120", description: "NPN Darlington transistor", footprint: "Package_TO_SOT_THT:TO-220-3_Vertical", pads: numbered(["B", "C", "E"]), value: "TIP120" },
  "core.tmp36": { lib: "Sensor_Temperature", symbol: "TMP36xT9", description: "Analog temperature sensor", footprint: TO92, pads: numbered(["PLUS_VS", "VOUT", "GND"]), value: "TMP36" },
  "core.ldr": { lib: "Device", symbol: "R_Photo", description: "Photoresistor", footprint: "OptoDevice:R_LDR_5.1x4.3mm_P3.4mm_Vertical", pads: numbered(["P1", "P2"]), value: "LDR" },
  "core.hc-sr04": { lib: "Connector", symbol: "Conn_01x04_Pin", description: "HC-SR04 ultrasonic module on a 1x4 header", footprint: header(4), pads: numbered(["VCC", "TRIG", "ECHO", "GND"]), value: "HC-SR04" },
  "core.servo-sg90": { lib: "Connector", symbol: "Conn_01x03_Pin", description: "Servo on a 1x3 header", footprint: header(3), pads: numbered(["GND", "VPLUS", "SIG"]), value: "SG90" },
  "core.ssd1306": { lib: "Connector", symbol: "Conn_01x04_Pin", description: "SSD1306 OLED module on a 1x4 header", footprint: header(4), pads: numbered(["GND", "VCC", "SCL", "SDA"]), value: "SSD1306" },
  "core.gy521-mpu6050": { lib: "Connector", symbol: "Conn_01x08_Pin", description: "GY-521 module on a 1x8 header", footprint: header(8), pads: numbered(["VCC", "GND", "SCL", "SDA", "XDA", "XCL", "AD0", "INT"]), value: "GY-521" },
  "core.bme280-module": { lib: "Connector", symbol: "Conn_01x06_Pin", description: "BME280 module on a 1x6 header", footprint: header(6), pads: numbered(["VCC", "GND", "SCL", "SDA", "CSB", "SDO"]), value: "BME280" },
  "core.dc-motor": { lib: "Motor", symbol: "Motor_DC", description: "DC motor", footprint: TERMINAL_2, pads: numbered(["PLUS", "MINUS"]), value: "Motor" },
  "core.tt-motor": { lib: "Motor", symbol: "Motor_DC", description: "DC motor", footprint: TERMINAL_2, pads: numbered(["PLUS", "MINUS"]), value: "Motor" },
  "core.fan": { lib: "Motor", symbol: "Fan", description: "Fan", footprint: TERMINAL_2, pads: numbered(["PLUS", "MINUS"]), value: "Fan" },
  "core.lipo-2s": { lib: "Device", symbol: "Battery", description: "Battery", footprint: TERMINAL_2, pads: numbered(["PLUS", "MINUS"]), value: "LiPo 2S" },
  "core.aa-holder-4": { lib: "Device", symbol: "Battery", description: "Battery", footprint: TERMINAL_2, pads: numbered(["PLUS", "MINUS"]), value: "4xAA" },
};
