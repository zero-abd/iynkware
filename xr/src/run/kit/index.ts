/**
 * The run pillar's kit: what every run sub-module draws and plays with, so the cluster, the part chips, the tools,
 * the findings and the fault lab look, move and sound alike. Not a feature module.
 *
 *   strings   six-language tables per sub-module (`defineStrings`, `stringProblems` for tests)
 *   tokens    colours, bands, dmm sizes                    layout   the run pillar's spots on the bench
 *   ink       inked solids, outlines, flat shadows          face     canvas faces, fitted text
 *   plate     plate buttons and `bindPlate`                 chip     text chips and `faceViewer`
 *   feedback  cues, loops, tones, pop rings                 motion   durations, ease, `animated`
 *   ticker    `onTick(world, fn)`                           icons    line icons
 *
 * Each file is a thin adapter over a service another lead is building (`app.text` #19, `app.feedback` #18 and #21,
 * the spatial UI kit #23, the look kit in `xr/src/look`); swap the inside when those land, keep the call sites.
 */
export * from './strings';
export * from './tokens';
export * from './layout';
export * from './cues';
export * from './ink';
export * from './face';
export * from './icons';
export * from './plate';
export * from './chip';
export * from './motion';
export * from './ticker';
export { runFeedback, playAt, type RunFeedback, type LoopHandle, type ToneHandle } from './feedback';
