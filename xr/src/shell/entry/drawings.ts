/**
 * The entry page's small ink drawings, as inline SVG: iynk's figure language at icon size (flat colour bands, a heavy
 * ink line, a flat blue cast shadow). The Art lead may redraw any of them; each is one string.
 */
import type { RowState } from './device';

const INK = '#231e16';
const CAST = '#41538f';
const svg = (body: string, view = 72, hand = false) =>
  `<svg viewBox="0 0 ${view} ${view}" aria-hidden="true" focusable="false" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${hand ? `<g filter="url(#ink-hand)">${body}</g>` : body}</svg>`;

/**
 * The figures' hand: a slight wobble of the line and a paper grain in the fills (figures/vendor/colorfigures core.js
 * `filterFor`, at icon scale). The page puts it in once (`HAND_FILTER`); the strip drawings use it.
 */
export const HAND_FILTER = `<svg width="0" height="0" aria-hidden="true" style="position:absolute"><filter id="ink-hand" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="4" result="warp"/>
<feDisplacementMap in="SourceGraphic" in2="warp" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="wob"/>
<feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" seed="11" result="n1"/>
<feColorMatrix in="n1" type="matrix" values=".3 0 0 0 .84  .3 0 0 0 .84  .3 0 0 0 .84  0 0 0 0 1" result="grain"/>
<feBlend in="wob" in2="grain" mode="multiply" result="g1"/><feComposite in="g1" in2="wob" operator="in"/></filter></svg>`;

/** A row of breadboard holes from x0, `n` of them, `step` apart. */
const holes = (x0: number, y: number, n: number, step: number) =>
  Array.from({ length: n }, (_, i) => `<rect x="${x0 + i * step}" y="${y}" width="2.2" height="2.2" fill="#2b2825" stroke="none"/>`).join('');

/** What you can do: one drawing per line of the strip. */
export const DRAWINGS = {
  // a jumper wire going into a breadboard hole
  build: svg(`
    <path d="M13 58h50l-4 7H9z" fill="${CAST}" stroke="none"/>
    <path d="M8 44h50v12H8z" fill="#fbf8ef"/>
    <path d="M8 56h50v4H8z" fill="#e7e2d3"/>
    ${holes(13, 47.5, 9, 5)}${holes(13, 52, 9, 5)}
    <path d="M60 6C54 22 30 12 26 31" stroke="${INK}" stroke-width="6.4"/>
    <path d="M60 6C54 22 30 12 26 31" stroke="#f08a2b" stroke-width="3.6"/>
    <path d="M21.5 30h9v8h-9z" fill="#403c38"/>
    <path d="M26 38v7.5" stroke-width="2.8"/>
    <path d="M15 33v5M37 33v5" stroke-width="2"/>`, 72, true),
  // an LED lit on the board
  run: svg(`
    <circle cx="36" cy="27" r="19" fill="#f8d4c9" stroke="none"/>
    <path d="M36 3v5M14 12l4 4M58 12l-4 4M8 30h5M59 30h5" stroke-width="2.2"/>
    <path d="M17 60h44l-3 6H14z" fill="${CAST}" stroke="none"/>
    <path d="M14 52h44v8H14z" fill="#fbf8ef"/>
    ${holes(19, 55, 7, 5.6)}
    <path d="M31 41v12M41 41v4l3 3v5" stroke="#8f989b" stroke-width="3.4"/>
    <path d="M31 41v12M41 41v4l3 3v5" stroke="#eef0f0" stroke-width="1.4"/>
    <path d="M27 40V27a9 9 0 0 1 18 0v13z" fill="#ef6a4c"/>
    <path d="M25 38.5h22v4H25z" fill="#cf5038"/>
    <ellipse cx="32.5" cy="27" rx="2.6" ry="4.5" fill="#fffbe8" stroke="none"/>`, 72, true),
  // a resistor burnt through, smoking
  break: svg(`
    <ellipse cx="38" cy="60" rx="21" ry="4" fill="${CAST}" stroke="none"/>
    <path d="M30 30c-5-4 4-8-1-13s2-8 0-12M40 31c-4-3 3-6-1-10s2-6 0-9" stroke="#857d6e" stroke-width="2.2"/>
    <path d="M52 15l2 5 5 1-5 2-2 5-2-5-5-2 5-1z" fill="#f4b829" stroke-width="1.8"/>
    <path d="M4 45h64" stroke="${INK}" stroke-width="5"/>
    <path d="M4 45h64" stroke="#bcc3c5" stroke-width="2.4"/>
    <rect x="19" y="36" width="34" height="18" rx="9" fill="#c9a874"/>
    <path d="M25 36.5v17M46 36.5v17" stroke="#8a5a34" stroke-width="3"/>
    <path d="M30 37c3 2 6-1 9 1s5 0 6 2l-1 6c1 3-2 5-5 6s-6-1-9 1c-2-2-1-5-2-8s0-5 2-8z" fill="#3d3935" stroke="none"/>
    <rect x="19" y="36" width="34" height="18" rx="9"/>`, 72, true),
  // a chip at room size, with a person beside it
  inside: svg(`
    <path d="M30 58h36l-5 7H25z" fill="${CAST}" stroke="none"/>
    <ellipse cx="12" cy="62.5" rx="6" ry="1.8" fill="${CAST}" stroke="none"/>
    <path d="M27 21h37v27H27z" fill="#55504a"/>
    <path d="M27 48h37v6H27z" fill="#2a2725"/>
    <path d="M41 21a4.5 4.5 0 0 0 9 0" fill="#403c38"/>
    <circle cx="32.5" cy="27" r="2.2" fill="#857d6e" stroke="none"/>
    ${[30, 37, 44, 51, 58].map((x) => `<path d="M${x} 54h4v7h-4z" fill="#c6ccce" stroke-width="1.8"/>`).join('')}
    <circle cx="12" cy="37" r="3.6" fill="#f2efe7"/>
    <path d="M12 41v11M12 52l-3.5 9M12 52l3.5 9M12 44.5l-4 5.5M12 44.5l7-3" stroke-width="2.2"/>`, 72, true),
  // a quadcopter in the air, its shadow on the ground
  fly: svg(`
    <ellipse cx="36" cy="64" rx="22" ry="3.6" fill="${CAST}" stroke="none"/>
    <path d="M16 13l40 37M56 13L16 50" stroke="${INK}" stroke-width="6"/>
    <path d="M16 13l40 37M56 13L16 50" stroke="#55504a" stroke-width="2.6"/>
    ${[[16, 13], [56, 13], [16, 50], [56, 50]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9.5" fill="#e4f2f4"/><path d="M${x! - 7} ${y! + 2}l14-4" stroke-width="2"/>`).join('')}
    <rect x="27" y="24" width="18" height="15" rx="4.5" fill="#76a0e2"/>
    <circle cx="36" cy="31.5" r="2.4" fill="#e4694e" stroke-width="1.6"/>`, 72, true),
} as const;

export type DrawingId = keyof typeof DRAWINGS;

/** The state icons of the device check: a filled disc in the state colour with a paper glyph, ink outlined. */
const disc = (fill: string, glyph: string) =>
  svg(`<circle cx="12" cy="12" r="10" fill="${fill}" stroke-width="1.6"/><g stroke="#f2efe7" stroke-width="2.4">${glyph}</g>`, 24);

export const STATE_ICONS: Readonly<Record<RowState, string>> = {
  ok: disc('#1f6b4a', '<path d="M7.5 12.5l3 3 6-7"/>'),
  no: disc('#a8402b', '<path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>'),
  warn: svg('<path d="M12 2.5L22.5 21h-21z" fill="#7a5a00" stroke-width="1.6"/><path d="M12 9v5.5M12 18v.2" stroke="#f2efe7" stroke-width="2.4"/>', 24),
  later: disc('#1d4fd8', '<path d="M12 11v6M12 7.5v.2"/>'),
  checking: disc('#1d4fd8', '<path d="M7.5 12h.2M12 12h.2M16.5 12h.2" stroke-width="2.8"/>'),
  off: svg('<circle cx="12" cy="12" r="9.5" stroke="#857d6e" stroke-width="2"/><path d="M8 12h8" stroke="#857d6e" stroke-width="2.4"/>', 24),
};

/** Banner icons: the same discs, by tone. */
export const NOTICE_ICONS = { bad: STATE_ICONS.no, warn: STATE_ICONS.warn, info: STATE_ICONS.later, good: STATE_ICONS.ok } as const;
