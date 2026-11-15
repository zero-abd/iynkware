import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createProjectStore } from '../src/project/store';
import { languagesFrom, programOf, writeProgramOps } from '../src/run/code/model';
import { CODE_STRINGS } from '../src/run/code/strings';
import { stringProblems } from '../src/run/kit/strings';
import { createAssistantService, instantPresence } from '../src/assistant/service';
import { createTemplateSource } from '../src/project/store';
import { createLabContext } from '../src/lab/context';
import { createCalloutList, createConversation } from '../src/agent/bubbles/model';
import { createCoach } from '../src/agent/coach/coach';
import { callTool, createTools, type ToolHost } from '../src/agent/tools/catalog';

const BLINK = `void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(100);\n  digitalWrite(13, LOW);\n  delay(100);\n}\n`;

async function blink() {
  const project = createProjectStore(await loadTemplate('prj_uno-r3-blink'));
  return { project, langs: languagesFrom((ref, v) => project.describe(ref, v)) };
}

describe('the bench program', () => {
  it('reads the board firmware entry', async () => {
    const { project, langs } = await blink();
    const p = programOf(project.doc, langs)!;
    expect(p).toMatchObject({ sourceId: 'src_sketch', path: 'sketch.ino', language: 'arduino-cpp' });
    expect(p.text).toContain('LED_PIN');
  });

  it('writes the whole file as one undoable change', async () => {
    const { project, langs } = await blink();
    const before = programOf(project.doc, langs)!.text;
    const ops = writeProgramOps(project.doc, BLINK, langs);
    expect(Array.isArray(ops) && ops.length).toBe(1);
    expect(project.apply(ops as never).ok).toBe(true);
    expect(programOf(project.doc, langs)!.text).toBe(BLINK);
    project.undo();
    expect(programOf(project.doc, langs)!.text).toBe(before);
  });

  it('gives a board without firmware a new sketch and makes it the entry', async () => {
    const { project, langs } = await blink();
    const doc = { ...project.doc, boards: project.doc.boards.map(({ firmware: _f, ...b }) => b), sources: [] };
    const p = programOf(doc, langs)!;
    expect(p).toMatchObject({ sourceId: null, language: 'arduino-cpp', path: 'sketch.ino' });
    const ops = writeProgramOps(doc, BLINK, langs, () => 'src_new') as Array<{ k: string }>;
    expect(ops.map((o) => o.k)).toEqual(['source.add', 'board.set']);
  });

  it('refuses when nothing changes or no board runs code', async () => {
    const { project, langs } = await blink();
    expect(writeProgramOps(project.doc, programOf(project.doc, langs)!.text, langs)).toBeTypeOf('string');
    expect(writeProgramOps({ ...project.doc, boards: [] }, BLINK, langs)).toBeTypeOf('string');
  });

  it('has its strings in six languages', () => {
    expect(stringProblems(CODE_STRINGS.table)).toEqual([]);
  });
});

describe('the companion code tools', () => {
  async function tools(mode: 'assist' | 'build') {
    const { project } = await blink();
    const host: ToolHost = {
      lang: () => 'en',
      assistant: createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence }),
      project,
      guide: () => null,
      lab: () => createLabContext(() => 'en'),
      callouts: createCalloutList(() => 0),
      conversation: createConversation(),
      observations: (n) => createCoach(() => 0).recent(n),
      bench: { project },
      mode: () => mode,
    };
    const all = createTools(host);
    return { project, call: (name: string, args: unknown = {}) => callTool(all, name, args) };
  }

  it('read_code returns the program and write_code replaces it', async () => {
    const { call } = await tools('build');
    expect(await call('read_code')).toMatchObject({ ok: true, file: 'sketch.ino', language: 'arduino-cpp' });
    expect(await call('write_code', { code: BLINK })).toMatchObject({ ok: true });
    expect(await call('read_code')).toMatchObject({ code: BLINK });
    expect(await call('undo')).toMatchObject({ ok: true });
    expect(((await call('read_code')) as unknown as { code: string }).code).not.toBe(BLINK);
  });

  it('write_code is refused in assist mode', async () => {
    const { call } = await tools('assist');
    expect(await call('write_code', { code: BLINK })).toMatchObject({ ok: false, mode: 'assist' });
  });
});
