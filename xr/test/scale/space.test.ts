/** Space: the Paper room row per state, hand and controller materials per room, restore, strings. */
import { describe, expect, it } from 'vitest';
import { BackSide, BoxGeometry, FrontSide, Group, Mesh, MeshBasicMaterial, ShaderMaterial } from '@iwsdk/core';
import { value } from '../../src/ui/value';
import type { RoomKind } from '../../src/contracts/scale';
import { tableProblems } from '../../src/scale/kit/text';
import { SPACE_STRINGS } from '../../src/scale/space/strings';
import { mountHandSkin, OCCLUDER_ORDER, type HandVisual } from '../../src/scale/space/hands';
import { paperRoomControl } from '../../src/scale/space';

function fakeHand(): { model: Group; fill: Mesh; outline: Mesh; fillMat: ShaderMaterial; outlineMat: ShaderMaterial } {
  const model = new Group();
  const fillMat = new ShaderMaterial({ side: FrontSide, transparent: true });
  const outlineMat = new ShaderMaterial({ side: BackSide, transparent: true });
  const fill = new Mesh(new BoxGeometry(), fillMat);
  const outline = new Mesh(new BoxGeometry(), outlineMat);
  outline.renderOrder = 999;
  model.add(fill, outline);
  return { model, fill, outline, fillMat, outlineMat };
}

function setup(initial: RoomKind) {
  const room = value<RoomKind>(initial);
  const visuals: HandVisual[] = [];
  let frame: () => void = () => undefined;
  const skin = mountHandSkin({
    visuals: () => visuals,
    room,
    onFrame: (fn) => {
      frame = fn;
      return () => (frame = () => undefined);
    },
  });
  return { room, visuals, skin, tick: () => frame() };
}

describe('hand materials', () => {
  it('draws depth only in passthrough, hides the outline, and restores', () => {
    const t = setup('passthrough');
    const h = fakeHand();
    t.visuals.push({ kind: 'hand', model: h.model });
    t.tick();
    const m = h.fill.material as MeshBasicMaterial;
    expect(m.colorWrite).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(h.fill.renderOrder).toBe(OCCLUDER_ORDER);
    expect(h.outline.visible).toBe(false);
    t.skin.dispose();
    expect(h.fill.material).toBe(h.fillMat);
    expect(h.outline.material).toBe(h.outlineMat);
    expect(h.outline.visible).toBe(true);
    expect(h.fill.renderOrder).toBe(0);
    expect(h.outline.renderOrder).toBe(999);
  });

  it('draws paper fill and ink hull in the paper room, and follows the room both ways', () => {
    const t = setup('paper');
    const h = fakeHand();
    t.visuals.push({ kind: 'hand', model: h.model });
    t.tick();
    const fill = h.fill.material as MeshBasicMaterial;
    const hull = h.outline.material as MeshBasicMaterial;
    expect(fill.colorWrite).toBe(true);
    expect(fill.color.getHexString()).toBe('f2efe7');
    expect(hull.side).toBe(BackSide);
    expect(hull.color.getHexString()).toBe('231e16');
    expect(h.outline.visible).toBe(true);
    t.room.set('passthrough');
    expect((h.fill.material as MeshBasicMaterial).colorWrite).toBe(false);
    expect(h.outline.visible).toBe(false);
    t.room.set('paper');
    expect(h.fill.material).toBe(fill);
    expect(h.outline.visible).toBe(true);
    t.skin.dispose();
    expect(h.fill.material).toBe(h.fillMat);
  });

  it('picks up a model that appears later and hides controllers in both rooms', () => {
    const t = setup('passthrough');
    t.tick();
    const c = new Group();
    const body = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    c.add(body);
    t.visuals.push({ kind: 'controller', model: c });
    expect(body.visible).toBe(true);
    t.tick();
    expect(body.visible).toBe(false);
    t.room.set('paper');
    expect(body.visible).toBe(false);
    t.skin.dispose();
    expect(body.visible).toBe(true);
  });
});

describe('Paper room row', () => {
  it('is latched in the paper room, hidden when the room cannot switch, and toggles the room', () => {
    const room = value<RoomKind>('passthrough');
    const roomSwitchable = value(true);
    const calls: RoomKind[] = [];
    const scale = {
      room,
      roomSwitchable,
      setRoom: (k: RoomKind) => {
        calls.push(k);
        room.set(k);
      },
    };
    const row = paperRoomControl(scale as never);
    expect(row.host).toBe('panel');
    expect(row.latched()).toBe(false);
    expect(row.hidden()).toBe(false);
    row.run();
    expect(calls).toEqual(['paper']);
    expect(row.latched()).toBe(true);
    row.run();
    expect(calls).toEqual(['paper','passthrough']);
    roomSwitchable.set(false);
    expect(row.hidden()).toBe(true);
    expect(row.label('de')).toBe('Papierraum');
  });
});

describe('strings', () => {
  it('has every language', () => {
    expect(tableProblems(SPACE_STRINGS)).toEqual([]);
  });
});
