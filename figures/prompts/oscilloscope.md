# Fig. L8 — Oscilloscope (Colorfigures prompt)

Make a colourful, hand-inked isometric figure of a **2-channel 100 MHz benchtop digital oscilloscope** (310 mm wide,
150 mm tall, 110 mm deep) on the pale green cutting mat with a flat blue cast shadow: a light grey case with vents on
top and a dark front panel. On the left a 7-inch screen with the 10 × 8 division graticule (dotted centre lines), the
yellow CH1 trace, a cyan CH2 line when it is on, an orange trigger-level arrow on the right edge, the settings along
the top (RUN or STOP, time/div, trigger) and the measurements along the bottom (CH1 V/div, probe ×, Vpp, f). On the
right: VOLTS/DIV knobs for CH1 and CH2 with lit yellow and cyan channel buttons under them, the TIME/DIV knob and the
trigger LEVEL knob, a RUN/STOP key (green when running, red when stopped), two BNC inputs labelled CH1 and CH2, and
the probe-compensation lug with its ground tab ("1kHz 3V"). A grey ×1/×10 probe lies on the mat, its cable running
to CH1, its hook and black ground clip on the lug (or off toward a circuit).

What it does (how a real scope behaves):

- **Power on/off**, **Run/Stop**, **CH1 on/off**, **CH2 on/off**, **Probe on ▾** (the CAL lug's 1 kHz 3 V square, or a
  demo circuit signal set by **Signal wave ▾**, **Signal frequency ▾** and the host's `vpp` and `offset`),
  **Time/div ▾**, **CH1 volts/div ▾**, **Trigger level ▾**, **Probe switch ▾** and **CH1 probe setting ▾**; pressing a
  knob steps it, pressing the probe flips its switch.
- The trace is the signal in divisions, trigger point at the centre; it stands still when the trigger level lies
  inside the signal and rolls when it does not. Past 40 cycles it smears into a band.
- The tutor hears every setting plus `vppShown`, `freqShown`, `cycles`, `divs`, `triggered`, `clipped` and `mistake`:
  `probe-mismatch`, `clipped`, `too-small`, `timebase-off` (not 1 to 5 cycles across).

Look: Colorfigures ink and paper, flat bands, a glowing dark screen with crisp coloured traces.
