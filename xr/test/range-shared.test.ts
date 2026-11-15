/** Range's scaffold: what the open project is to Range, the place it offers, its strings, and the converted drone. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Project } from '@/project/generated/types';
import type { XrApp } from '../src/contracts/app';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import { createShellService } from '../src/shell/service';
import { activateModule, ACTIVATE_STRINGS, DRONE_TEMPLATE } from '../src/range/activate';
import { flightSceneOf } from '../src/range/flight/scene';
import { flightText, loadDrone, loadFlightText, rangeProjectOf, stringProblems, watchRangeProject } from '../src/range/shared';
import { repoRoot } from '../vite.aliases';

const robot = (id: string) => JSON.parse(readFileSync(`${repoRoot}content/projects/robots/${id}.project.json`, 'utf8')) as Project;
const templates = createTemplateSource();

describe('what the open project is to Range', () => {
  it('a drone craft flies, a robot with mechanics drives, Blink is not Range’s', async () => {
    expect(rangeProjectOf(await templates.load(DRONE_TEMPLATE))).toEqual({ kind: 'drone', contentId: 'quad5' });
    expect(rangeProjectOf(robot('drive-base'))).toEqual({ kind: 'robot' });
    expect(rangeProjectOf(await templates.load('prj_uno-r3-blink'))).toBeNull();
  });

  it('notifies only when the kind changes', async () => {
    const store = createProjectStore(await templates.load('prj_uno-r3-blink'));
    const seen: unknown[] = [];
    const w = watchRangeProject(store);
    w.subscribe((v) => seen.push(v));
    store.open(await templates.load(DRONE_TEMPLATE));
    store.open(await templates.load(DRONE_TEMPLATE));
    store.open(robot('drive-base'));
    expect(seen).toEqual([{ kind: 'drone', contentId: 'quad5' }, { kind: 'robot' }]);
    w.dispose();
  });

  it('offers the range place while a drone or robot is open, and adds the Drones tile', async () => {
    const shell = createShellService();
    const project = createProjectStore(await templates.load('prj_uno-r3-blink'));
    const app = { world: {}, project, shell, templates } as unknown as XrApp;
    const off = await activateModule.mount(app);
    expect(shell.offered.value).toEqual(['bench']);
    expect(shell.entries.value.map((e) => e.id)).toEqual(['range/drones']);
    project.open(await templates.load(DRONE_TEMPLATE));
    expect(shell.offered.value).toContain('range');
    expect(shell.go('range')).toBe(true);
    project.open(await templates.load('prj_uno-r3-blink'));
    expect(shell.offered.value).toEqual(['bench']);
    expect(shell.place.value).toBe('bench');
    shell.entries.value[0]!.open();
    await new Promise((r) => setTimeout(r, 50));
    expect(rangeProjectOf(project.doc)).toEqual({ kind: 'drone', contentId: 'quad5' });
    off();
    expect(shell.entries.value).toEqual([]);
    expect(flightSceneOf(app).value).toBeNull();
  });
});

describe('Range’s text', () => {
  it('the activation strings are complete in six languages', () => {
    expect(stringProblems(ACTIVATE_STRINGS.table)).toEqual([]);
  });

  it('reads iynk’s flight namespace', async () => {
    const en = await loadFlightText('en');
    expect(flightText(en, 'hit.tree')).toBe('Hit a tree');
    expect(flightText(en, 'no.such.key')).toBe('no.such.key');
    const de = await loadFlightText('de');
    expect(flightText(de, 'hit.tree')).not.toBe('Hit a tree');
  });
});

describe('the converted drone', () => {
  const read = async (path: string) => {
    const b = readFileSync(`${repoRoot}tools/xr-assets/samples/${path}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  it('loads quad5 with its parts, hides and shows them, spins a prop; a craft not converted is null', async () => {
    const drone = await loadDrone('quad5', read);
    expect(drone).not.toBeNull();
    expect(drone!.sidecar.parts.map((p) => p.id).slice(1)).toEqual(['FRAME', 'MOTORS', 'ESC', 'WIRES', 'FC', 'XT60', 'CAM', 'RX', 'VTX', 'TOP', 'BATT', 'PROPS']);
    drone!.setPartVisible('PROPS', false);
    expect(drone!.isPartVisible('PROPS')).toBe(false);
    drone!.setPartVisible('PROPS', true);
    expect(drone!.isPartVisible('PROPS')).toBe(true);
    expect(drone!.set('prop:M1', 9000)).toBe(true);
    expect(drone!.set('prop:M9', 9000)).toBe(false);
    expect(await loadDrone('not-a-craft', read)).toBeNull();
    drone!.dispose();
  });
});
