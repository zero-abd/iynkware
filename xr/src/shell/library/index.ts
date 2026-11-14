/** Projects kept between sessions: the repository, autosave of the open project, `.iynk` files and `#project=` links. No UI; provides `ShellLibrary` (./types.ts) per app (stub). */
import type { FeatureModule } from '../../contracts/app';

export const libraryModule: FeatureModule = {
  id: 'shell/library',
  mount: () => () => undefined,
};
