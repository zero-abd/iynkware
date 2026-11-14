/** The Settings panel: language, hand, posture, sound, haptics, reduced motion, room, work scale, reset progress, applied live (stub). */
import type { FeatureModule } from '../../contracts/app';

export const prefsModule: FeatureModule = {
  id: 'shell/prefs',
  mount: () => () => undefined,
};
