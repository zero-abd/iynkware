/**
 * Adapter: the inked plate button and solids the bench's own controls draw with (shelf tabs and paging, the wire chip,
 * the rail's Undo and Redo). The look kit (`xr/src/look`) has no 3D buttons yet; the rail already shows the scale
 * pillar's plate (an inked paper slab with three bands, an ink hull, a flat blue shadow, a canvas face with a Phosphor
 * icon and an 18 dmm label, hover lift and press travel, `ui-hover` and `ui-press` feedback), so the bench reads it
 * through this one file and switches here when the look kit or the UI kit (#23) publishes one. Only re-exported.
 *
 *   const plate = benchPlate(app, { w: 0.048, d: 0.048 }, { icon: 'arrow-u-up-left', label: 'Undo' });
 *   app.bench.table.add(plate.group);
 *   const off = bindPlate(app, plate, 'bench/undo', () => app.project.undo());
 */
export { scalePlate as benchPlate, bindPlate, type Plate, type PlateLook, type PlateSize } from '../../scale/kit/plate';
export { inkShadow, inkSolid, OUTLINE_M, roundedQuad, roundedSlab, type InkSolid } from '../../run/kit/ink';
export { canvasFace, type Face } from '../../run/kit/face';
