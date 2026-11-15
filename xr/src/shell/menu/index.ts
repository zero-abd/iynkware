/**
 * Menu: the one menu (XR_DESIGN.md 9.6). Three ways in: a round button that floats off the non-dominant palm when it
 * faces the head, the left thumbstick click, and `providePanel(app, 'menu')` for Home and other panels. The panel is
 * world-locked 1.0 m ahead, 10 degrees below eye level, and holds Home, Projects and Settings, the mode switch
 * (Bench, Room size, Drones), the project switch, the rows other pillars add through `app.shell.addMenuItem` (paged)
 * and Leave headset mode. It redraws while open when any of that changes, and closes after a switch or an action.
 * Layout and content: `panel.ts`, `layout.ts`; the palm maths: `palm.ts`; strings: `copy.ts`.
 */
import { Vector3 } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { onLookFrame } from '../../look/runner';
import { dmm } from '../../look/type';
import { say } from '../copy';
import { shellButton, placeAhead, type ShellButton, type ShellPanel } from '../kit';
import { libraryOf } from '../library/types';
import { providePanel, switching } from '../switch';
import { claimFocus, onFocusLost } from '../switch/focus';
import { MENU } from './copy';
import { createPanel, DISTANCE_M, fill, heightOf, snapshot, type Actions } from './panel';
import { otherHand, palmButtonAt, palmFacing } from './palm';

const PALM_DISTANCE_M = 0.45;
const PALM_BUTTON_DMM = 48;

function mountMenu(app: XrApp): Unsubscribe {
  let panel: ShellPanel | null = null;
  let shownH = 0;
  let isOpen = false;
  let page = 0;
  let watchers: Unsubscribe[] = [];
  let toggles: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const actions: Actions = {
    close: () => close(),
    setPage: (n) => {
      page = n;
      schedule();
    },
  };

  /** Fills `p` from the current state. */
  const populate = (p: ShellPanel) => {
    const snap = snapshot(app);
    p.clear();
    p.setTitle(say(MENU, snap.lang, 'title'), snap.busy ? say(MENU, snap.lang, 'opening') : 'IYNKWARE');
    fill(app, p, snap, page, actions);
    for (const off of toggles) off();
    toggles = snap.items.flatMap((i) => (i.toggle ? [i.toggle.subscribe(() => schedule())] : []));
  };

  const build = (): ShellPanel => {
    const snap = snapshot(app);
    const p = createPanel(app, snap, () => close());
    shownH = heightOf(snap);
    populate(p);
    return p;
  };

  /** Redraws on the next tick (never inside a button's own handler), and rebuilds the panel when its height changes. */
  const render = () => {
    timer = null;
    if (!isOpen || !panel) return;
    if (heightOf(snapshot(app)) === shownH) {
      populate(panel);
      return;
    }
    const old = panel;
    const next = build();
    next.group.position.copy(old.group.position);
    next.group.quaternion.copy(old.group.quaternion);
    panel = next;
    old.dispose();
    next.open();
  };
  const schedule = () => {
    if (isOpen && timer === null) timer = setTimeout(render, 0);
  };

  const open = () => {
    if (isOpen) return;
    // Home may finish its delayed first-session placement just as the person opens Menu. Panels are exclusive: do not
    // leave Home in front of Menu where its tiles can steal the first trigger.
    app.shell.closeHome();
    claimFocus(app, 'menu');
    isOpen = true;
    page = 0;
    panel = build();
    placeAhead(app.world, panel.group, { distance: DISTANCE_M, belowDeg: 10 });
    panel.open();
    const lib = libraryOf(app);
    watchers = [
      app.shell.menuItems.subscribe(schedule),
      app.shell.offered.subscribe(schedule),
      app.shell.place.subscribe(schedule),
      app.settings.lang.subscribe(schedule),
      switching(app).subscribe(schedule),
      ...(lib ? [lib.rows.subscribe(schedule), lib.current.subscribe(schedule)] : []),
    ];
  };

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    for (const off of [...watchers, ...toggles]) off();
    watchers = [];
    toggles = [];
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const p = panel;
    panel = null;
    p?.close(() => p.dispose());
  }

  const toggle = () => (isOpen ? close() : open());
  const unprovide = providePanel(app, 'menu', open);
  const unfocus = onFocusLost(app, 'menu', () => close());

  // The palm button: a small round Menu button 6 cm off the palm of the hand that is not the dominant one.
  const bd = dmm(PALM_BUTTON_DMM, PALM_DISTANCE_M);
  let palmShown = false;
  const palm: ShellButton = shellButton(
    app,
    { id: 'menu/palm', w: bd, h: bd, distanceM: PALM_DISTANCE_M, poke: true, onSelect: () => palmShown && toggle() },
    { label: '', icon: 'menu' },
  );
  palm.setOpacity(1);
  const hide = () => {
    palmShown = false;
    palm.group.visible = false;
    palm.group.position.set(0, -100, 0);
  };
  hide();
  const head = new Vector3();
  const grip = new Vector3();
  const offFrame = onLookFrame(app.world, () => {
    if (app.input.button('left', 'stick').down) toggle();
    const hand = otherHand(app.settings.xr.value.dominantHand);
    const pose = app.input.pose(hand);
    if (!pose || pose.source !== 'hand') {
      if (palmShown) hide();
      return;
    }
    app.world.camera.getWorldPosition(head);
    app.world.player.gripSpaces[hand].getWorldPosition(grip);
    const at: [number, number, number] = [grip.x, grip.y, grip.z];
    const facing = palmFacing({ normal: pose.normal, palm: at, head: [head.x, head.y, head.z], open: pose.open, was: palmShown });
    if (!facing) {
      if (palmShown) hide();
      return;
    }
    const p = palmButtonAt(at, pose.normal);
    palm.group.position.set(p[0], p[1], p[2]);
    palm.group.lookAt(head);
    palm.group.visible = true;
    palmShown = true;
  });

  return () => {
    offFrame();
    unprovide();
    unfocus();
    palm.dispose();
    isOpen = false;
    for (const off of [...watchers, ...toggles]) off();
    if (timer !== null) clearTimeout(timer);
    panel?.dispose();
    panel = null;
  };
}

export const menuModule: FeatureModule = {
  id: 'shell/menu',
  mount: mountMenu,
};
