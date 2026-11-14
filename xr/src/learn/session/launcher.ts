/**
 * The lesson launcher behind `app.lessons` (`lessonSlot(app).attach`): opening forks the template as the Studio does,
 * puts the fork on the bench, loads it into the simulation and starts its session; closing ends the session and leaves
 * the project on the bench. A document already open when the module mounts that is a lesson template (or a fork of
 * one) gets its session too, so `?project=prj_uno-r3-blink` opens with its guide.
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { Project } from '../../contracts/project';
import { catalogue, forkLesson, loadTemplate, templateIdOf } from '../content';
import { lessonSlot } from '../launcher';
import type { LessonSession } from '../types';
import { createLessonSession } from './session';

/** How long a burst of edits settles before the stopped simulation takes the edited document. */
const RELOAD_DELAY_MS = 300;
const STOPPED = new Set(['idle', 'done', 'halted', 'limit']);

/**
 * While a lesson is open, a stopped simulation follows the document: the run controls load the document only when
 * nothing is loaded and reload it only while running, so Run after an edit made while stopped would run the old code.
 * Local adapter until the run controls reload on Run (reported to the run pillar).
 */
function keepSimCurrent(app: XrApp, projectId: string): Unsubscribe {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = app.project.subscribe((change) => {
    if (change.origin === 'load' || app.project.doc.id !== projectId) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (STOPPED.has(app.sim.state)) void app.sim.load(app.project.doc).catch(() => undefined);
    }, RELOAD_DELAY_MS);
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}

export function attachLessons(app: XrApp): Unsubscribe {
  const slot = lessonSlot(app);
  let current: { session: LessonSession; off: Unsubscribe } | null = null;
  let opening = 0;

  const close = () => {
    opening++;
    if (!current) return;
    current.off();
    current.session.dispose();
    current = null;
    slot.session.set(null);
    slot.guide.set(null);
  };

  const start = (templateId: string, template: Project) => {
    const session = createLessonSession(app, { templateId, template });
    current = { session, off: keepSimCurrent(app, app.project.doc.id) };
    slot.session.set(session);
    slot.guide.set(session.guide);
    slot.lastValue.set({ templateId, title: session.state.value.title });
  };

  /** Puts a fork on the bench and in the simulation. */
  const bench = async (fork: Project) => {
    app.project.open(fork);
    await app.sim.load(fork).catch(() => undefined);
  };

  const open = async (templateId: string, opts?: { build?: boolean }) => {
    // `opts.build`: build mode will reuse the assistant's "Build it with me" (xr/src/assistant) when it lands; a lesson
    // opens built until then.
    void opts;
    close();
    const mine = opening;
    await app.sim.stop().catch(() => undefined);
    const template = await loadTemplate(templateId);
    if (!template) throw new Error(`No lesson has the id ${templateId}`);
    if (mine !== opening) return;
    const fork = forkLesson(template);
    await bench(fork);
    if (mine !== opening) return;
    start(templateId, template);
  };

  const detach = slot.attach({ open, close });

  // The document already open: a lesson template is forked first; a fork of one keeps its own document.
  const doc = app.project.doc;
  const templateId = templateIdOf(doc);
  if (templateId && catalogue().item(templateId)) {
    const mine = opening;
    void (async () => {
      if (doc.id === templateId) {
        await app.sim.stop().catch(() => undefined);
        if (mine !== opening) return;
        await bench(forkLesson(doc));
        if (mine === opening) start(templateId, doc);
      } else {
        const template = await loadTemplate(templateId);
        if (template && mine === opening && app.project.doc.id === doc.id) start(templateId, template);
      }
    })().catch((err) => console.error('[iynkware] lesson', err));
  }

  return () => {
    detach();
    close();
  };
}
