/**
 * Problems where they are (Pillar 2, issue 36). While editing, the worker's static rules run a moment after each change
 * and every finding is pinned to its part. At a pause or the end of a run, the run's findings are pinned the same way.
 * A part that overheats shows heat lines and sizzles; one that burns pops, puffs smoke once and pins its reason. A pin
 * opens a card with the finding's Why and Fix, and a fix with a plan applies as one undoable batch.
 *
 *   static.ts   target resolution, pins, severity, debounce (pure)      fix.ts    plans to ops, apply (iynk's fixes.ts)
 *   strings.ts  iynk's rule texts and the card's words, six languages    pins.ts   callouts on the parts
 *   card.ts     the paper card with Why, Fix, Fix it and Close           heat.ts   heat lines, smoke, sizzle, pop
 */
import { Group } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { PartHealth } from '../../contracts/part-view';
import type { Finding } from '../../contracts/sim';
import { createCard } from './card';
import { createHeat } from './heat';
import { createPins } from './pins';
import { burntPin, CHECK_DEBOUNCE_MS, createDebounce, mayCheck, mergePins, pinsOf, type PinSpec } from './static';

export const findingsModule: FeatureModule = {
  id: 'run/findings',
  mount(app) {
    return mountFindings(app);
  },
};

function mountFindings(app: XrApp): () => void {
  const root = new Group();
  root.name = 'findings';
  app.world.scene.add(root);

  let staticSpecs: PinSpec[] = [];
  let runSpecs: PinSpec[] = [];
  const burntSpecs = new Map<string, PinSpec>();
  const health = new Map<string, PartHealth>();
  let generation = 0;
  let disposed = false;

  const heat = createHeat(app);
  const card = createCard(app, root, { onFixed: () => undefined, onClosed: () => undefined });
  const pins = createPins(app, root, {
    onSelect(spec, at) {
      if (card.current?.id === spec.id) card.close();
      else card.open(spec, at);
    },
  });

  /** What a script or a test may read: the pins shown, the card, the effects. Always current. */
  const state = {
    hidden: 0,
    get pins(): string[] {
      return [...pins.ids];
    },
    get card(): string | null {
      return card.current?.id ?? null;
    },
    get drawCalls(): number {
      return pins.drawCalls + card.drawCalls + heat.drawCalls;
    },
  };
  root.userData.state = state;

  const exists = (id: string): boolean => app.project.doc.components.some((c) => c.id === id) || app.project.doc.boards.some((b) => b.id === id);

  /** Pins that show now: while running only a burnt part keeps its pin. */
  const refresh = () => {
    const running = app.sim.state === 'running';
    const live = (list: readonly PinSpec[]) => list.filter((s) => exists(s.place.part));
    const merged = mergePins(running ? [] : live(staticSpecs), running ? [] : live(runSpecs), live([...burntSpecs.values()]));
    state.hidden = merged.hidden;
    pins.set(merged.shown);
    if (running && card.current && card.current.origin !== 'burnt') card.close();
  };

  const check = async () => {
    if (disposed || !mayCheck(app.sim.state)) return;
    const gen = ++generation;
    const doc = app.project.doc;
    try {
      const { findings } = await app.sim.check(doc);
      if (disposed || gen !== generation || !mayCheck(app.sim.state)) return;
      staticSpecs = pinsOf(doc, findings, 'static');
      refresh();
    } catch (err) {
      if (!disposed) console.warn('[iynkware] static check', err);
    }
  };
  const debounced = createDebounce(() => void check(), CHECK_DEBOUNCE_MS);

  /** A run ended or a project loaded: everything that came from a run goes. */
  const forgetRun = () => {
    runSpecs = [];
    burntSpecs.clear();
    health.clear();
    heat.clear();
    if (card.current && card.current.origin !== 'static') card.close();
  };

  const setRunFindings = (findings: readonly Finding[]) => {
    runSpecs = pinsOf(app.project.doc, findings, 'run');
    refresh();
  };

  const offs = [
    app.project.subscribe((change) => {
      if (change.origin === 'load') {
        forgetRun();
        staticSpecs = [];
        card.close();
      }
      refresh();
      if (mayCheck(app.sim.state)) debounced.call();
      card.refresh();
    }),
    app.sim.onState((s) => {
      if (s === 'running') {
        debounced.cancel();
        generation++;
        heat.silence(false);
        runSpecs = [];
      } else {
        if (s === 'idle' || s === 'unloaded' || s === 'error') forgetRun();
        if (s === 'paused') heat.silence(true);
        debounced.call();
      }
      refresh();
    }),
    app.sim.onFindings(setRunFindings),
    app.sim.onFrame((frame) => {
      const parts = frame.analog?.parts;
      if (!parts) return;
      let changed = false;
      for (const id in parts) {
        const p = parts[id]!;
        const was = health.get(id);
        if (was === p.state) continue;
        health.set(id, p.state);
        if (p.state === 'burnt') {
          heat.burn(id);
          const spec = p.why ? burntPin(app.project.doc, id, p.why) : null;
          if (spec) {
            burntSpecs.set(id, spec);
            changed = true;
          }
        } else heat.hot(id, p.state === 'hot');
      }
      if (changed) refresh();
    }),
    app.bench.onLayout(() => {
      heat.relayout();
      pins.relayout();
      refresh();
    }),
    app.settings.lang.subscribe(() => {
      pins.retitle();
      card.refresh();
    }),
  ];

  if (mayCheck(app.sim.state)) debounced.call();
  refresh();

  return () => {
    disposed = true;
    debounced.cancel();
    for (const off of offs) off();
    pins.dispose();
    card.dispose();
    heat.dispose();
    root.removeFromParent();
  };
}
