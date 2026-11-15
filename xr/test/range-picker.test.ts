import { describe, expect, it } from 'vitest';
import { LAB_TEMPLATES } from '@content/projects';
import { courseChoiceOf, courseTitle, craftRows, DEFAULT_CRAFT, lastCraftOf, pickCourse, pickerOpenOf, pickerPendingOf } from '../src/range/flight/picker/model';
import { PICKER_STRINGS } from '../src/range/flight/picker/strings';
import { ROOM_STRINGS } from '../src/range/flight/room/strings';
import { stringProblems } from '../src/range/shared';

describe('the craft list', () => {
  it('lists only converted drone crafts, in template order, with their template titles', () => {
    const rows = craftRows(['quad5', 'racer', 'whoop'], LAB_TEMPLATES);
    expect(rows.map((r) => r.contentId)).toEqual(['quad5', 'whoop', 'racer']);
    expect(rows[0]!.templateId).toBe('prj_drone-quad5');
    expect(rows[0]!.title.en).toBeTruthy();
  });
  it('skips what is not converted, not a drone or not a craft', () => {
    expect(craftRows([], LAB_TEMPLATES)).toEqual([]);
    expect(craftRows(['not-a-craft'], LAB_TEMPLATES)).toEqual([]);
    const rows = craftRows(['quad5'], [
      { id: 'prj_drone-quad5', title: { en: 'Quad' }, lab: 'robotics', kind: 'craft' },
      { id: 'prj_drone-quad5', title: { en: 'Quad' }, lab: 'drone', kind: 'task' },
    ]);
    expect(rows).toEqual([]);
  });
});

describe('which course flies', () => {
  const courses = [
    { id: 'range', kind: 'checkpoints' as const },
    { id: 'race', kind: 'gates' as const },
    { id: 'night', kind: 'gates' as const },
  ];
  it('the chosen course, else the first gates course, else the first', () => {
    expect(pickCourse(courses, 'night')?.id).toBe('night');
    expect(pickCourse(courses, null)?.id).toBe('race');
    expect(pickCourse(courses, 'gone')?.id).toBe('race');
    expect(pickCourse([courses[0]!], null)?.id).toBe('range');
    expect(pickCourse([], 'x')).toBeUndefined();
  });
  it('titles a course by its key when the text has it, else by its id', () => {
    expect(courseTitle({ id: 'race', title: 'courses.race' }, () => 'Race')).toBe('Race');
    expect(courseTitle({ id: 'race', title: 'courses.race' }, (k) => k)).toBe('race');
  });
});

describe('the slots', () => {
  it('are per app and start as the picker expects', () => {
    const a = { world: {} } as never, b = { world: {} } as never;
    expect(courseChoiceOf(a).value).toBeNull();
    expect(lastCraftOf(a).value).toBe(DEFAULT_CRAFT);
    expect(pickerOpenOf(a).value).toBe(false);
    expect(pickerPendingOf(a).value).toBe(false);
    courseChoiceOf(a).set('race');
    expect(courseChoiceOf(a).value).toBe('race');
    expect(courseChoiceOf(b).value).toBeNull();
  });
});

describe('the strings', () => {
  it('are complete in six languages', () => {
    expect(stringProblems(PICKER_STRINGS.table)).toEqual([]);
    expect(stringProblems(ROOM_STRINGS.table)).toEqual([]);
  });
});
