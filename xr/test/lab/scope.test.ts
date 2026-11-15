/** Each workbench shows only its own things (src/lab/scope.ts). */
import { describe, expect, it } from 'vitest';
import { Group, Mesh } from '@iwsdk/core';
import { createBenchScope } from '../../src/lab/scope';

const named = (name: string) => Object.assign(new Group(), { name });

describe('bench scope', () => {
  it('hides the circuit bench furniture, holds it hidden while its owner toggles it, and restores it as it was', () => {
    const table = new Group();
    const shelf = named('bench:shelf');
    const leaf = new Mesh() as Mesh & { pointerEvents?: string };
    leaf.pointerEvents = 'auto';
    shelf.add(leaf);
    const code = named('shell-panel:run/code');
    code.visible = false;
    const mat = named('look:mat');
    const labPanel = named('lab-panel-group:lab');
    table.add(shelf, code, mat, labPanel);
    const scope = createBenchScope(() => [table]);

    scope.set(true);
    expect([shelf.visible, code.visible, mat.visible, labPanel.visible]).toEqual([false, false, true, true]);
    expect(leaf.pointerEvents).toBe('none');
    code.visible = true; // its owner opens it while the lab is up
    expect(code.visible).toBe(false);
    const late = named('run-cluster');
    table.add(late);
    scope.rescan();
    expect(late.visible).toBe(false);

    scope.set(false);
    expect([shelf.visible, code.visible, late.visible]).toEqual([true, true, true]);
    expect(leaf.pointerEvents).toBe('auto');
    shelf.visible = false;
    expect(shelf.visible).toBe(false); // a plain property again
  });
});
