/**
 * Colour tokens of design 9.3, bright and dim rooms, and the high-contrast option of 11.2 (`muted` becomes `ink`,
 * outlines 1.5x). Learn's thin adapter until the look kit (`xr/src/look/**`) and the UI kit (#23) land.
 *
 * Usage: const k = tokens({ room: 'dim', highContrast: false }); g.fillStyle = k.paper;
 */

export type Room = 'bright' | 'dim';

export interface Tokens {
  readonly paper: string;
  readonly ink: string;
  readonly muted: string;
  readonly rule: string;
  readonly shadow: string;
  readonly accent: string;
  readonly good: string;
  readonly bad: string;
  readonly warn: string;
  readonly info: string;
  /** Multiplier for every ink outline (1, or 1.5 in high contrast). */
  readonly outline: number;
}

const BRIGHT = { paper: '#f2efe7', muted: '#857d6e', rule: '#ddd6c8' };
const DIM = { paper: '#e4ddcf', muted: '#6a6357', rule: '#cbc2b1' };
const FIXED = { ink: '#231e16', shadow: '#41538f', accent: '#e4694e', good: '#1f6b4a', bad: '#a8402b', warn: '#7a5a00', info: '#1d4fd8' };

export function tokens(opts: { room?: Room; highContrast?: boolean } = {}): Tokens {
  const room = opts.room === 'dim' ? DIM : BRIGHT;
  const hc = opts.highContrast === true;
  return { ...FIXED, ...room, muted: hc ? FIXED.ink : room.muted, outline: hc ? 1.5 : 1 };
}

/** The tone of the overlay and the guide (`Tone`) as a token name (design 9.3). */
export function toneColour(k: Tokens, tone: 'info' | 'do' | 'warn' | 'pass' | 'fail'): string {
  return tone === 'do' ? k.accent : tone === 'pass' ? k.good : tone === 'fail' ? k.bad : tone === 'warn' ? k.warn : k.info;
}

/** Latin in Geist when the page has it, then the system and Noto stacks, so Devanagari and Chinese shape (design 9.2). */
export const SANS = 'Geist, system-ui, "Noto Sans", "Noto Sans Devanagari", "Noto Sans SC", sans-serif';
export const MONO = '"Geist Mono", ui-monospace, Menlo, Consolas, "Noto Sans Mono", monospace';
