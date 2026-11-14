/** Onboarding: the first three minutes, from entering to a blinking LED the person wired (stub). */
import type { FeatureModule } from '../../contracts/app';

export const onboardingModule: FeatureModule = {
  id: 'learn/onboarding',
  mount: () => () => undefined,
};
