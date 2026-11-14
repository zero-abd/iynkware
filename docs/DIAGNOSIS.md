# Diagnosis and one click fixes

The Problems panel lists what the fault rules find in the open project and offers a fix for the common mistakes.

## Where findings come from

- Static rules (`src/sim/faults/static*.ts`, `code.ts`) run in the sim worker a moment after every edit, on any Studio project.
- Solved rules (`solved.ts`) run when a run pauses or ends. The worker hands them what the live solver said: the burnt and over current states of the parts, and the volts and amps of the last solve.

## Fixes

A rule puts a `plan` on each fix of its finding (`FixPlan` in `src/sim/faults/types.ts`). A plan names nets by the id the rules see and never touches the document. `src/studio/fixes.ts` turns a plan into project ops against the open document and checks them with the document's own rules (`checkBatch`), so a fix that the project would refuse is shown as advice without a Fix button.

- A fix is `safe` when it cannot change what the circuit is meant to do. Fix all safe applies only those, in one batch, so every new part gets its own refdes.
- Every fix shows a before and after preview made from the nets and code lines the ops change.
- Ops go in through the doc store (`doc.commit`), so one undo takes a fix back and the next check no longer finds the problem.
- On a breadboard the strips decide the nets, so a resistor stands across two strips and takes the wire that met the part along, and a two legged part is turned half way round.

| Mistake | Fix | Safe |
| --- | --- | --- |
| LED with no series resistor | a resistor of about 10 mA from the supply and the LED's drop, rounded up to E12 | yes |
| LED or electrolytic capacitor reversed | turn it round | yes |
| A supply pin not connected | join it to the rail it needs | when there is one choice |
| A ground pin not connected | join it to ground | yes |
| Supply shorted to ground | take the supply pin off the net | no |
| Input floating with a button | INPUT_PULLUP in the code, else a 10 kohm pull resistor | yes |
| Input floating with nothing | a 10 kohm pull down | no |
| Output pin over its rating | a resistor in series with the pin | no |
| I2C line without a pull up | 4.7 kohm to the supply | yes |
| Motor on a GPIO pin | an NPN, a base resistor and a flyback diode | no |
| Op amp input out of its common mode range | a divider in front of the input, or advice | no |
| pinMode missing or wrong, baud, I2C address, wrong pin in code | an edit of the code | when the answer is unique |
