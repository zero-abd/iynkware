/** Projects kept between sessions: the repository, autosave of the open project, `.iynk` files and `#project=` links. No UI; provides `ShellLibrary` (./types.ts) per app. */
import type { FeatureModule } from '../../contracts/app';
import { createShellLibrary } from './library';
import { provideLibrary } from './types';

export const libraryModule: FeatureModule = {
  id: 'shell/library',
  async mount(app) {
    const library = createShellLibrary(app);
    const unprovide = provideLibrary(app, library);
    await library.start();
    return () => {
      library.stop();
      unprovide();
    };
  },
};
