// The calm layout's switches (ui/panels/open.ts): a thing that starts closed, opens from its menu row, closes from its
// own Close, and keeps one state per app and id however many pillars ask for it.
import { describe, expect, it } from 'vitest';
import type { XrApp } from '../src/contracts/app';
import { LANGS } from '../src/contracts/common';
import type { MenuItem } from '../src/contracts/shell';
import { openable, openState, PANELS_COPY } from '../src/ui/panels';
import { value } from '../src/ui/value';

function fakeShell() {
  const rows: MenuItem[] = [];
  const shell = {
    addMenuItem(item: MenuItem) {
      const i = rows.findIndex((r) => r.id === item.id);
      if (i >= 0) rows.splice(i, 1);
      rows.push(item);
      return () => {
        const j = rows.indexOf(item);
        if (j >= 0) rows.splice(j, 1);
      };
    },
  };
  return { app: { shell } as unknown as Pick<XrApp, 'shell'>, rows };
}

const label = { en: 'Look inside' };

describe('openable', () => {
  it('starts closed with a switch row in View, which the row flips', () => {
    const { app, rows } = fakeShell();
    const look = openable(app, { id: 'scale/look-inside', label });
    expect(look.open.value).toBe(false);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.group).toBe('view');
    expect(row.toggle?.value).toBe(false);
    row.run();
    expect(look.open.value).toBe(true);
    expect(row.toggle?.value).toBe(true);
    row.run();
    expect(look.open.value).toBe(false);
  });

  it("the panel's own Close turns the same switch off", () => {
    const { app, rows } = fakeShell();
    const look = openable(app, { id: 'x', label, group: 'tools' });
    expect(rows[0]!.group).toBe('tools');
    const seen: boolean[] = [];
    look.open.subscribe((on) => seen.push(on));
    rows[0]!.run();
    look.set(false);
    expect(seen).toEqual([true, false]);
    expect(rows[0]!.toggle?.value).toBe(false);
  });

  it('one state and one row per app and id; the row goes with the last user', () => {
    const { app, rows } = fakeShell();
    const a = openable(app, { id: 'run/test-tools', label });
    const b = openable(app, { id: 'run/test-tools', label });
    expect(rows).toHaveLength(1);
    a.set(true);
    expect(b.open.value).toBe(true);
    expect(openState(app, 'run/test-tools').value).toBe(true);
    a.dispose();
    a.dispose();
    expect(rows).toHaveLength(1);
    b.dispose();
    expect(rows).toHaveLength(0);
    // Another app has its own.
    const other = fakeShell();
    expect(openState(other.app, 'run/test-tools').value).toBe(false);
  });

  it('shows the row only while available, and closes when it stops being available', () => {
    const { app, rows } = fakeShell();
    const here = value(false);
    const design = openable(app, { id: 'range/design', label, available: here });
    expect(rows).toHaveLength(0);
    here.set(true);
    expect(rows).toHaveLength(1);
    rows[0]!.run();
    expect(design.open.value).toBe(true);
    here.set(false);
    expect(rows).toHaveLength(0);
    expect(design.open.value).toBe(false);
    here.set(true);
    expect(rows).toHaveLength(1);
    expect(design.open.value).toBe(false);
    design.dispose();
    expect(rows).toHaveLength(0);
    here.set(true);
    expect(rows).toHaveLength(0);
  });

  it("the calm layout's row labels are in all six languages", () => {
    for (const key of ['tidy', 'droneDesign'] as const) {
      for (const l of LANGS) expect(PANELS_COPY[key][l]?.trim().length ?? 0, `${key} ${l}`).toBeGreaterThan(0);
    }
  });
});
