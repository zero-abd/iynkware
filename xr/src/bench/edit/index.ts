/**
 * Editing placed parts (design 3.2, 3.4): grab a part (a pinch, or a grip near, or the trigger on the ray) and carry it,
 * seat it at its ghost, pull it out of its holes, lay it on the mat or send it back; grab a board by its edge band (or
 * anywhere with a controller grip) and move it. Every move, add and remove of the bench is animated here. The shelf's
 * hand-over (`benchKit(app).carry`) carries a new part the same way.
 */
import type { FeatureModule } from '../../contracts/app';
import { benchKit, type Carry } from '../core/kit';
import { routerOf } from '../core/router';
import { benchInternals } from '../space';
import { createBoardHolder } from './board';
import { createCarryLoop, createHolder } from './carry';
import { installTransitions } from './motion';
import { mountMouseDrag } from './mouse';

export const editModule: FeatureModule = {
  id: 'bench/edit',
  mount(app) {
    const bi = benchInternals(app.bench);
    if (!bi) return () => undefined;
    const router = routerOf(app);
    const releaseRouter = router.retain();
    const transitions = installTransitions(app);
    const loop = createCarryLoop(app);
    const offMouse = mountMouseDrag(app, transitions);

    const offBody = router.on('body', (press) => {
      const item = bi.items.get(press.item);
      if (!item || item.role !== 'part' || !press.hand) return null;
      const holder = createHolder(
        { app, transitions, router },
        { id: item.id, ref: item.asset.ref, asset: item.asset, object: item.object, seated: item.seated },
        { hand: press.hand, near: press.near, source: press.source, hit: press.start.point },
      );
      if (!holder) return null;
      loop.add(holder);
      return { end: () => holder.end(), cancel: () => holder.cancel() };
    });

    const offEdge = router.on('edge', (press) => {
      const holder = createBoardHolder(app, transitions, press);
      if (!holder) return null;
      loop.add(holder);
      return { end: () => holder.end(), cancel: () => holder.cancel() };
    });

    // the shelf hands a new part over: it is carried, ghosted and seated like any other
    const offCarry = benchKit(app).carry.provide((req): Carry => {
      let holder: ReturnType<typeof createHolder> = null;
      let ended = false;
      let cancelled = false;
      void app.assets.get(req.ref, req.version).then(
        (asset) => {
          if (cancelled) return req.onReturn();
          const object = asset.instantiate();
          object.name = 'bench:carried';
          app.bench.root.add(object);
          const pointer = req.start.pointer;
          holder = createHolder(
            { app, transitions, router, onReturn: req.onReturn },
            { id: null, ref: req.ref, asset, object, seated: false },
            { hand: pointer.hand ?? 'right', near: pointer.mode === 'grab', source: pointer.source, hit: req.start.point, from: req.from },
          );
          if (!holder) {
            object.removeFromParent();
            return req.onReturn();
          }
          loop.add(holder);
          if (ended) holder.end();
        },
        () => req.onReturn(),
      );
      return {
        move: () => undefined,
        end: () => {
          ended = true;
          holder?.end();
        },
        cancel: () => {
          cancelled = true;
          if (holder) holder.cancel();
        },
      };
    });

    return () => {
      offMouse();
      offBody();
      offEdge();
      offCarry();
      loop.dispose();
      transitions.dispose();
      releaseRouter();
    };
  },
};
