/**
 * What Range draws with, so the bench, the flight volume, the crash card and the arena look like the rest of the app:
 * the look kit (`xr/src/look/**`: palette, type, paint, callouts, motion, light) and the app's inked plate buttons and
 * canvas labels. Never a plain box with a flat colour, never an unstyled text panel.
 *
 *   plateButton + bindPlate   an inked plate button (hover lift, press, badge, a filling ring), bound for hand and ray
 *   textLabel                 a paper plate with fitted, wrapped Geist text (one quad, one draw call)
 *   createCallout             an ink dot, leader and a cream tag or paper card (bench messages, the crash card)
 *   inkSolid, inkShadow       inked solids with outlines and the flat blue shadow (gates, pads, the arena)
 *
 * The plate, ink and face helpers are the run kit's (`xr/src/run/kit`), the app's buttons until the spatial UI kit
 * (#23) lands; Range imports them and never edits them.
 */
export { bindPlate, plateButton, type Plate, type PlateLook, type PlateSize } from '../../run/kit/plate';
export { inkShadow, inkSolid, paintBands, roundedQuad, roundedSlab, type InkSolid } from '../../run/kit/ink';
export { textLabel, type TextLabel, type TextLabelOptions } from '../../ui/text';
export { createCallout, type Callout, type CalloutOptions, type CalloutTone } from '../../look/callout';
export { onLookFrame, motionOf } from '../../look/runner';
export { ACCENT, BANDS, bandsOf, INK, MUTED, PAPER, RULE, SHADOW, STATE, TAG, hexNum } from '../../look/palette';
export { DURATION, easeIynk } from '../../look/motion';
export { dropIn, fadeIn, riseIn, panelOpen, panelClose, drawOn, hoverLift, pressTravel } from '../../look/moves';
