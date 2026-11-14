// Which interpreter language each content language runs on. Kept apart from headless.ts so the page can ask
// whether a language runs without loading the interpreters.

import type { Language as ContentLanguage } from '@/content/schema';
import type { Language } from '../../sim/boards/profiles';

export const INTERP_LANGUAGE: Record<ContentLanguage, Language> = {
  'arduino-cpp': 'arduino',
  micropython: 'python',
  python: 'python',
  verilog: 'verilog',
};

/** Every language the Board Lab teaches runs in this build. */
export function canRun(language: ContentLanguage): boolean {
  return language in INTERP_LANGUAGE;
}
