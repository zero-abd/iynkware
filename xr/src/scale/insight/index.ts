/** Insight: see-through and take apart for one part or the whole build, on the Look inside panel. */
import type { FeatureModule } from '../../contracts/app';
import type { Lang, ReadonlyValue } from '../../contracts/common';
import type { LensSetting } from '../../contracts/scale';
import { benchInternals } from '../../bench/space';
import { scaleControls } from '../kit/controls';
import { tr } from '../kit/text';
import { mountInsight } from './apply';
import { targetOf } from './lens';
import { INSIGHT_STRINGS as S } from './strings';

export const insightModule: FeatureModule = {
  id: 'scale/insight',
  mount(app) {
    const { scale, project, bench } = app;
    const insight = mountInsight(app);
    const ctl = scaleControls(app);

    const selection: ReadonlyValue<readonly string[]> = {
      get value() {
        return project.selection.ids;
      },
      subscribe: (fn) => project.selection.subscribe(fn),
    };
    const target = (): string | null => targetOf(project.selection.ids, (id) => bench.objectOf(id) !== undefined);
    /** The part's designator, else the asset's name, else its id. */
    const nameOf = (id: string): string => {
      const c = project.doc.components.find((x) => x.id === id);
      if (c?.refdes) return c.refdes;
      return benchInternals(bench)?.items.get(id)?.asset.sidecar.name ?? id;
    };
    const row = (key: 'seeThrough' | 'takeApart', get: () => LensSetting, set: (amount: number, part: string | null) => void, order: number, icon: 'eye' | 'cube') => {
      const on = () => get().amount > 0 && get().part === target();
      return ctl.add({
        id: `insight/${key}`,
        host: 'panel',
        order,
        icon,
        label: (lang: Lang) => {
          const t = target();
          return tr(S, lang, 'labelled', { what: tr(S, lang, key), target: t === null ? tr(S, lang, 'all') : nameOf(t) });
        },
        latched: on,
        watch: [scale.seeThrough, scale.explode, selection],
        run: () => set(on() ? 0 : 1, target()),
      });
    };

    const offs = [
      row('seeThrough', () => scale.seeThrough.value, (a, p) => scale.setSeeThrough(a, p), 0, 'eye'),
      row('takeApart', () => scale.explode.value, (a, p) => scale.setExplode(a, p), 1, 'cube'),
    ];

    return () => {
      for (const off of offs) off();
      insight.dispose();
    };
  },
};
