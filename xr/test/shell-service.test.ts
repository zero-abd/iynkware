/** The shell service: places and offers, home, entries and menu rows by id, notices with and without a timeout. */
import { describe, expect, it, vi } from 'vitest';
import type { HomeEntry, MenuItem } from '../src/contracts/shell';
import { createShellService } from '../src/shell/service';
import { value } from '../src/ui/value';

describe('places', () => {
  it('starts on the bench, which is always offered', () => {
    const shell = createShellService();
    expect(shell.place.value).toBe('bench');
    expect(shell.offered.value).toEqual(['bench']);
    expect(shell.go('bench')).toBe(true);
  });

  it('refuses a place nobody offers and goes to an offered one, closing home', () => {
    const shell = createShellService();
    expect(shell.go('range')).toBe(false);
    expect(shell.place.value).toBe('bench');
    const off = shell.offer('range', 'range/flight');
    expect(shell.offered.value).toEqual(['bench', 'range']);
    shell.openHome();
    const seen: string[] = [];
    shell.place.subscribe((p) => seen.push(p));
    expect(shell.go('range')).toBe(true);
    expect(shell.place.value).toBe('range');
    expect(shell.homeOpen.value).toBe(false);
    expect(seen).toEqual(['range']);
    off();
    off();
    expect(shell.offered.value).toEqual(['bench']);
    expect(shell.place.value).toBe('bench');
  });

  it('keeps a place offered while any owner still offers it, in a fixed order', () => {
    const shell = createShellService();
    const a = shell.offer('range', 'a');
    shell.offer('room', 'scale');
    shell.offer('range', 'b');
    expect(shell.offered.value).toEqual(['bench', 'room', 'range']);
    a();
    expect(shell.offered.value).toEqual(['bench', 'room', 'range']);
  });
});

describe('entries and menu items', () => {
  const entry = (id: string, title: string): HomeEntry => ({ id, slot: 'lessons', title: { en: title }, open: () => undefined });

  it('replaces an entry with the same id in place; removing a replaced one is harmless', () => {
    const shell = createShellService();
    const first = shell.addEntry(entry('learn/lessons', 'Lessons'));
    shell.addEntry(entry('range/drones', 'Drones'));
    shell.addEntry(entry('learn/lessons', 'Lessons, 4 of 9'));
    expect(shell.entries.value.map((e) => e.title.en)).toEqual(['Lessons, 4 of 9', 'Drones']);
    first();
    expect(shell.entries.value).toHaveLength(2);
  });

  it('lists menu items and removes them', () => {
    const shell = createShellService();
    const on = value(false);
    const item: MenuItem = { id: 'scale/see-through', group: 'view', label: { en: 'See-through' }, toggle: on, run: () => on.set(!on.value) };
    const off = shell.addMenuItem(item);
    expect(shell.menuItems.value).toEqual([item]);
    off();
    expect(shell.menuItems.value).toEqual([]);
  });
});

describe('notices', () => {
  it('keeps one notice per id and drops a timed one after its time', () => {
    vi.useFakeTimers();
    try {
      const shell = createShellService();
      shell.notify({ id: 'update', tone: 'info', text: { en: 'Update ready' } });
      shell.notify({ id: 'update', tone: 'info', text: { en: 'Update ready, again' } });
      shell.notify({ id: 'hands', tone: 'warn', text: { en: 'Hands not seen' }, ms: 1000 });
      expect(shell.notices.value.map((n) => n.id)).toEqual(['update', 'hands']);
      expect(shell.notices.value[0]!.text.en).toBe('Update ready, again');
      vi.advanceTimersByTime(1001);
      expect(shell.notices.value.map((n) => n.id)).toEqual(['update']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a timed notice early and cancels its timer', () => {
    vi.useFakeTimers();
    try {
      const shell = createShellService();
      const off = shell.notify({ id: 'storage', tone: 'fail', text: { en: 'Storage is full' }, ms: 5000 });
      off();
      expect(shell.notices.value).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
