/**
 * Projects on the bench. A blank project (New project on Home or the menu) holds its Uno in the document but not in the
 * breadboard view, so a freshly opened one is laid out here: the board goes on the mat, where the person builds. Only a
 * load does it (an undo never puts it back), and only a document with nothing placed.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import { placeBoards } from '../core/actions';

export const projectModule: FeatureModule = {
  id: 'bench/project',
  mount(app: XrApp) {
    const lay = () => {
      const r = placeBoards(app.project.doc);
      if (r.ok) app.project.apply(r.ops, { label: r.label });
    };
    const off = app.project.subscribe((change) => {
      if (change.origin === 'load') lay();
    });
    lay();
    return off;
  },
};
