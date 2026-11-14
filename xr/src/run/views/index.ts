/**
 * Part views: registers a view per part ref (and a fallback per readout kind). Each view is one file here, and each
 * drives the asset's channels or anchors, never the geometry.
 *
 *   led       led.ts      brightness and colour, one or several lamps (`led:` emissive)
 *   servo     servo.ts    the horn to the commanded angle at a real servo's slew (`servo:` rotate)
 *   motor     motor.ts    a DC motor's spin with spin-up and spin-down (`motor:` spin); a stepper's angle (`motor:` rotate)
 *   display   display.ts  one-bit pixel rows as a texture on the `screen:` anchor
 *   buzzer    buzzer.ts   a tone at the part, at its pitch
 *   reading   reading.ts  an inked chip above the part with its reading; a small chip on a part not simulated yet
 *   health    health.ts   the generic hot tint and burnt char, applied by the host
 *
 * Buttons, switches and pots (`press:` and `turn:`) belong to the inputs module: nothing here moves them.
 */
import type { FeatureModule } from '../../contracts/app';
import { buzzerView } from './buzzer';
import { displayView } from './display';
import { mountViewHost } from './host';
import { ledView } from './led';
import { motorView, stepperView } from './motor';
import { notModelledView, readingView } from './reading';
import { servoView } from './servo';

export const viewsModule: FeatureModule = {
  id: 'run/views',
  mount(app) {
    const register: typeof app.views.register = (key, factory) => app.views.register(key, factory);
    register({ ref: 'core.led-5mm' }, ledView);
    register({ ref: 'core.rgb-led' }, ledView);
    register({ kind: 'led' }, ledView);
    register({ ref: 'core.servo-sg90' }, servoView);
    register({ kind: 'servo' }, servoView);
    for (const ref of ['core.dc-motor', 'core.fan', 'core.tt-motor', 'core.tt-motor-encoder']) register({ ref }, motorView);
    register({ kind: 'motor' }, motorView);
    for (const ref of ['core.stepper-28byj48', 'core.nema17']) register({ ref }, stepperView);
    register({ kind: 'stepper' }, stepperView);
    register({ ref: 'core.ssd1306' }, displayView);
    register({ kind: 'display' }, displayView);
    register({ ref: 'core.buzzer-piezo' }, buzzerView(app));
    register({ kind: 'buzzer' }, buzzerView(app));
    register({ kind: 'reading' }, readingView(app));
    register({ kind: 'not-modelled' }, notModelledView(app));
    // After the registrations: the host builds a view per placed part from them.
    return mountViewHost(app);
  },
};
