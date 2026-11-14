/**
 * Pillar 6, Shell: everything around the bench that makes it a product. The 2D entry page is `./entry` (loaded by
 * xr/index.html before the engine); the service behind `app.shell` is `./service.ts`, made by app.ts. These
 * sub-modules draw it in the headset, mounted in this order: the library first, so home finds the projects.
 */
import { composeModules } from '../compose';
import { libraryModule } from './library';
import { pwaModule } from './pwa';
import { homeModule } from './home';
import { menuModule } from './menu';
import { projectsModule } from './projects';
import { prefsModule } from './prefs';
import { noticesModule } from './notices';

export const shellModule = composeModules('shell', [libraryModule, pwaModule, homeModule, menuModule, projectsModule, prefsModule, noticesModule]);
