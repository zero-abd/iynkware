/**
 * Adapter: the inked 3D pieces the scale pillar draws with. The look kit (`xr/src/look`, the Art lead) owns colour,
 * type, icons, painters and moves, but no 3D solids yet; the run pillar's kit has the inked slab (three bands, an ink
 * hull, a flat shadow plate), the canvas face, the rail layout and the UI feedback cues the rail already uses. The
 * pillar reads them through this one file so the rail looks like one product, and switches here when the look kit or
 * the UI kit (#23) publishes them. Nothing here is edited; it is only re-exported.
 */
export { inkShadow, inkSolid, OUTLINE_M, roundedQuad, roundedSlab, type InkSolid } from '../../run/kit/ink';
export { canvasFace, type Face } from '../../run/kit/face';
export { runLayout as benchLayout, type RunLayout as BenchLayout, type Spot } from '../../run/kit/layout';
export { runFeedback as uiFeedback } from '../../run/kit/feedback';
