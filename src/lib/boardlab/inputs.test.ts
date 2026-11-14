import { describe, expect, it } from 'vitest';
import uno from '@/content/boards/uno-r3';
import { holdFrom } from './inputs';

const inputs = (id: string) => uno.lessons.find((l) => l.id === id)!.world.inputs;

describe('holdFrom', () => {
  it("holds the button's input while the part is down and lets go on release", () => {
    expect(holdFrom(inputs('button'), { id: 'BTN1', down: true })).toEqual({ id: 'button', value: 1 });
    expect(holdFrom(inputs('button'), { id: 'BTN1', down: false })).toEqual({ id: 'button', value: 0 });
  });

  it('ignores a part that is not a held input', () => {
    expect(holdFrom(inputs('button'), { id: 'LED1', down: true })).toBeNull();
    expect(holdFrom(inputs('knob'), { id: 'POT1', down: true })).toBeNull();
  });
});
