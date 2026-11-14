/**
 * Callouts: while a lesson is open, the viewed step's highlights on the bench (`highlights.ts`); otherwise the
 * project's own `guide.callouts` as readable tags on their parts, in the person's language. Show me on the guide panel
 * replays the step's highlights (`bus.ts`).
 */
import { Vector3 } from '@iwsdk/core';
import type { FeatureModule } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { calloutTargets } from '../guide';
import { onFrame } from '../kit/frame';
import { prefs } from '../kit/prefs';
import { tokens } from '../kit/tokens';
import { lessonSlot } from '../launcher';
import { pick } from '../text';
import type { LessonSession } from '../types';
import { onReplay } from './bus';
import { createHighlights } from './highlights';

export const calloutsModule: FeatureModule = {
  id: 'learn/callouts',
  mount(app) {
    const slot = lessonSlot(app);
    const hl = createHighlights(app);
    let session: LessonSession | null = null;
    let offState: Unsubscribe | null = null;
    let shownKey = '';
    let shownStep = '';

    const look = () => {
      const p = prefs(app);
      hl.setLook(tokens(p), app.settings.lang.value, p.textScale, p.reducedMotion);
    };
    const draw = (force = false) => {
      const lang = app.settings.lang.value;
      if (session) {
        const s = session.state.value;
        const step = s.steps[s.viewIndex];
        const key = `step|${lang}|${step?.id ?? ''}|${JSON.stringify(step?.targets ?? [])}`;
        if (!force && key === shownKey) return;
        const fresh = (step?.id ?? '') !== shownStep;
        shownKey = key;
        shownStep = step?.id ?? '';
        hl.showStep(step?.targets ?? [], step?.kind === 'wire', fresh);
        return;
      }
      const key = `callouts|${lang}|${app.project.revision}`;
      if (!force && key === shownKey) return;
      shownKey = key;
      shownStep = '';
      hl.showCallouts(calloutTargets(app.project.doc).map((c) => ({ target: c.target, text: pick(c.text, lang).text })));
    };
    const follow = (next: LessonSession | null) => {
      if (next === session) return;
      offState?.();
      offState = null;
      session = next;
      if (next) offState = next.state.subscribe(() => draw());
      draw(true);
    };
    const restyle = () => {
      look();
      draw(true);
    };
    const head = new Vector3();
    const offs: Unsubscribe[] = [
      slot.session.subscribe(follow),
      app.bench.onLayout(() => {
        if (!session) draw();
        hl.layout();
      }),
      app.bench.scale.subscribe(() => hl.layout()),
      app.settings.lang.subscribe(restyle),
      app.settings.shared.subscribe(restyle),
      app.settings.xr.subscribe(restyle),
      onReplay(app, () => hl.pulse()),
      onFrame(app.world, (dt) => {
        app.world.camera.getWorldPosition(head);
        hl.tick(dt, head);
      }),
    ];
    look();
    follow(slot.session.value);
    if (!session) draw(true);
    return () => {
      offs.forEach((off) => off());
      offState?.();
      hl.dispose();
      app.overlay.clear('guide');
    };
  },
};
