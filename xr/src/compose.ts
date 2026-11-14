/**
 * One pillar module made of sub-modules, each in its own folder with its own owner (an issue). Mounted in order,
 * torn down in reverse. Shared file: changes only in its own PR.
 */
import type { FeatureModule } from './contracts/app';
import type { Unsubscribe } from './contracts/common';

export function composeModules(id: string, modules: readonly FeatureModule[]): FeatureModule {
  return {
    id,
    async mount(app) {
      const offs: Unsubscribe[] = [];
      for (const m of modules) offs.push(await m.mount(app));
      return () => {
        for (const off of offs.reverse()) off();
      };
    },
  };
}
