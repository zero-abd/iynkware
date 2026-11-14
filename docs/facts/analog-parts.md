# Analog parts: fact sheet

Figures read from the maker sheets named below, for the descriptors of the analog wave (`src/parts/data/`). A figure
marked "own estimate" is not on a sheet: it is a typical value for the family, chosen by iynk, and the descriptor says so.

## 1. Sources

| Ref | Document | Read |
|---|---|---|
| [1] | Texas Instruments SLFS022K, "NA555, NE555, SA555, SE555 precision timers", rev. March 2026 | in full, sections 5.1 to 5.5 |
| [2] | Texas Instruments SLOS068, "LM158, LM258, LM358, LM2904 dual operational amplifiers" | sections 4, 5.1 and the LM358 electrical table |
| [3] | Vishay Semiconductors 85816, "1N4728A to 1N4761A Zener diodes", rev. 2.7, 07-Nov-2024 | absolute maximum ratings and the electrical table |

## 2. NE555 (DIP-8)  [1]

- Pins: 1 GND, 2 TRIG, 3 OUT, 4 RESET, 5 CONT, 6 THRES, 7 DISCH, 8 VCC.
- Supply 4.5 V to 16 V recommended (NE555); 18 V absolute maximum (5.1); output current 200 mA recommended, 225 mA absolute.
- Thresholds: THRES 10 V typ at 15 V, 3.3 V typ at 5 V; TRIG 5 V typ at 15 V, 1.67 V typ at 5 V. CONT open circuit 10 V at 15 V and 3.3 V at 5 V: the divider is two thirds and one third of the supply.
- Output high: 13.3 V typ at 15 V and 100 mA, 12.5 V at 200 mA; 3.3 V typ at 5 V and 100 mA. Output low: 0.1 V typ at 15 V and 10 mA, 0.4 V at 50 mA, 2 V at 100 mA; 0.1 V typ at 5 V and 5 mA.
- DISCH on-state voltage 0.15 V typ at 5 V and 8 mA (about 19 ohm).
- Supply current at 5 V no load: 3 mA typ output low, 2 mA typ output high; at 15 V: 10 mA low, 9 mA high.
- Model: out high = VCC - 0.7 V - I x 10 ohm, which fits 13.3 V at 15 V and 100 mA and 12.5 V at 200 mA to 0.2 V; out low = I x 10 ohm (the sheet's 2 V at 100 mA is higher: the model is optimistic under heavy load).
- Astable: f = 1.44 / ((RA + 2 RB) C); high 0.693 (RA + RB) C; low 0.693 RB C.

## 3. LM358 (DIP-8)  [2]

- Pins: 1 OUT1, 2 IN1-, 3 IN1+, 4 V-, 5 IN2+, 6 IN2-, 7 OUT2, 8 V+.
- Supply 3 V to 30 V (32 V absolute maximum for the LM358); differential input +-32 V; input voltage -0.3 V to 32 V.
- Open-loop gain 100 V/mV typ (25 min) at 15 V; gain-bandwidth 0.7 MHz; slew rate 0.3 V/us.
- Input common-mode range: V- to V+ minus 1.5 V. Output swing from the rail at 5 V and 2 kohm: up to 1.5 V from V+ (max); 5 mV to 20 mV from V- at 10 kohm.
- Output current: source 20 mA typ, short circuit 40 mA typ (60 mA max). Quiescent current 350 uA per amplifier typ (600 uA max).
- Input bias current 20 nA typ (250 nA max); input offset current 2 nA typ.
- Model: one headroom value is used for both rails (1.5 V, the high side). The low side really reaches within 20 mV of V-, so a single-supply circuit that works near ground reads about 1.5 V too high a floor in the model.
- Own estimate: output resistance 50 ohm.

## 4. Capacitors

Not read from one maker sheet; typical values of the common families, stated as such in the descriptors.

- Ceramic, radial multilayer X7R/X5R: 100 nF 50 V, 1 uF 25 V, 10 uF 16 V as the usual stock values. ESR about 0.02 ohm (own estimate). Marked with the three digit code: 104, 105, 106.
- Aluminium electrolytic, 105 degC general purpose: 10 uF to 1000 uF at 16 V, 25 V, 35 V or 50 V; polarised, the negative lead on the striped side. ESR 0.1 ohm to 1 ohm (own estimate, falling with size). Reverse voltage beyond about 1 V (or above the rated voltage) heats the cell and vents it.

## 5. Inductors

Axial moulded chokes, typical values (own estimate): 100 uH about 0.5 ohm DC resistance and 0.4 A rating; 10 mH about 30 ohm and 0.05 A. No maker sheet read.

## 6. 1N4733A Zener  [3]

- DO-41 (DO-204AL). VZ 5.1 V nominal (+-5 %) at IZT 49 mA; dynamic resistance ZZT 7 ohm typ at 49 mA (550 ohm at 1 mA, the knee); reverse leakage 10 uA max at 1 V.
- Ptot 1300 mW (leads 4 mm from the case at ambient); regulator current IZM 178 mA max; surge current 890 mA (10 ms); junction 175 degC.
- Forward voltage 1.2 V max at 200 mA.
- Model: a Shockley junction (Is 0.7 nA, n 1.5) with a reverse breakdown parameter of 4.06 V and a series resistance of 7 ohm (the dynamic resistance at IZT). The breakdown parameter is not the quoted 5.1 V: the junction curve is exponential, so it is chosen so the part holds 5.1 V at the 49 mA test current (4.06 V + 0.70 V of curve + 0.34 V across 7 ohm). At lower currents it sits lower: about 4.8 V at 14 mA, which the datasheet's rising ZZK (550 ohm at 1 mA) agrees with in direction.
- The 7 ohm resistance also acts in the forward direction, so the forward drop is about 0.35 V higher than a plain diode at 50 mA: a known gap.

## 7. Signal source

A bench function generator lead pair, not a purchased part: a sine, square, triangle or pulse source with a 50 ohm output resistance, as on a bench generator. Amplitude 0 V to 10 V peak, 0.1 Hz to 100 kHz; the model is the `VW` element of docs/SIM_ANALOG.md.
