/**
 * The shell's panel kit, built on the look kit (`xr/src/look`: palette, type, painters, moves). Not a sub-module.
 *
 *   face.ts     canvasFace: one quad, one canvas texture, two texels per dmm, repaints on change
 *   button.ts   shellButton: plate, icon, label, detail, switch; hover lifts, press sinks; ray, pinch, poke, mouse
 *   panel.ts    shellPanel: paper plate, outline, flat shadow, title bar, Close, a body for controls, open and close
 *   text.ts     shellText: wrapped text in a type role, with a kicker
 *   confirm.ts  confirmCard: a question with Cancel and the action
 *   place.ts    placeAhead: in front of the viewer along their yaw, then world-locked
 *   entity.ts   ownEntity, dropEntities: why every kit root has its own entity, and how it is removed
 *   copy.ts     KIT: Close, Cancel, On, Off, Back in six languages
 *
 * Sizes are metres in the scene; `dmm(d, distance)` from the look kit turns the design's dmm into metres.
 */
export { canvasFace, faceSize, type Face } from './face';
export { buttonColours, shellButton, type ButtonLook, type ShellButton } from './button';
export { shellPanel, TITLE_BAR_DMM, type Fading, type ShellPanel } from './panel';
export { shellText, type ShellText } from './text';
export { confirmCard } from './confirm';
export { placeAhead, placementFrom } from './place';
export { KIT } from './copy';
export { dropEntities, ownEntity } from './entity';
