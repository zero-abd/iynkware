/** Part view registry: by descriptor ref first, then by readout kind, then a no-op view. Contract: contracts/part-view.ts. */
import type { PartState, PartView, PartViewContext, PartViewFactory, PartViewRegistry } from '../../contracts/part-view';

const noop = (ctx: PartViewContext): PartView => ({
  partId: ctx.partId,
  update: () => undefined,
  reset: () => undefined,
  dispose: () => undefined,
});

export function createPartViewRegistry(): PartViewRegistry {
  const byRef = new Map<string, PartViewFactory>();
  const byKind = new Map<PartState['kind'], PartViewFactory>();
  return {
    register(key, factory) {
      if ('ref' in key) byRef.set(key.ref, factory);
      else byKind.set(key.kind, factory);
    },
    create(ctx, firstState) {
      const f = byRef.get(ctx.ref) ?? (firstState ? byKind.get(firstState.kind) : undefined) ?? noop;
      return f(ctx);
    },
  };
}
