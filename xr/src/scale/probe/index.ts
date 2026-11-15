/**
 * Probe: the part inspector (design 6.4). While the Inspect lens is on, a select on a placed part, or a single-part
 * selection, opens a card at the part with its name, designator, pins (live node volts and pin current), ratings
 * (iynk's own labels) and live readings. The card is one canvas texture, faces the viewer, keeps its angular size and
 * follows the part through the scale stage, so it works at Room size too. `app.scale.inspected` is the one truth.
 */
import { Matrix4, Vector3 } from '@iwsdk/core';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { Hand } from '../../contracts/input';
import type { RunState } from '../../contracts/sim';
import { analogFeed } from '../kit/analog';
import { scaleControls } from '../kit/controls';
import { onFrame } from '../kit/frame';
import { tr } from '../kit/text';
import { createCard, stagePoint, type Card } from './card';
import { buildCard, modelKey, redrawDue, REDRAW_MS, type CardInput } from './rows';
import { PROBE } from './strings';

const LIVE: readonly RunState[] = ['idle', 'running', 'paused'];
const OWNER = 'scale/probe';
/** A grab that ends within this long, with the pointer hardly moved, is a tap on the part, not a carry. */
const TAP_MS = 1500;
const TAP_MOVE_M = 0.03;
const TAP_TURN_RAD = 0.05;

interface Grab {
  target: string;
  at: number;
  origin: number[];
  dir: number[];
}

/** True when a grab that began as `g` and ends with this pointer pose was a tap. */
export function isTap(g: Grab, origin: readonly number[], dir: readonly number[], now: number): boolean {
  if (now - g.at > TAP_MS) return false;
  const moved = Math.hypot(origin[0]! - g.origin[0]!, origin[1]! - g.origin[1]!, origin[2]! - g.origin[2]!);
  const dot = dir[0]! * g.dir[0]! + dir[1]! * g.dir[1]! + dir[2]! * g.dir[2]!;
  return moved <= TAP_MOVE_M && Math.acos(Math.min(1, Math.max(-1, dot))) <= TAP_TURN_RAD;
}

const inv = new Matrix4();
const board = new Vector3();
const anchor = new Vector3();

export const probeModule: FeatureModule = {
  id: 'scale/probe',
  mount(app: XrApp): Unsubscribe {
    const feed = analogFeed(app);
    let card: Card | null = null;
    let openId: string | null = null;
    let offWant: Unsubscribe | null = null;
    let hasAnchor = false;
    let lastAt = -1;
    let lastKey = '';
    let nextHand: Hand | null = null;
    const grabs = new Map<number, Grab>();

    const isPart = (id: string): boolean => app.project.doc.components.some((c) => c.id === id);

    /** Reads the part, the run and the feed into the card's rows; false when the part is gone. */
    const refresh = (force: boolean): boolean => {
      if (!card || !openId) return false;
      const comp = app.project.doc.components.find((c) => c.id === openId);
      if (!comp) return false;
      const lang = app.settings.lang.value;
      const view = feed.view;
      const nets = app.sim.netlist?.parts.find((p) => p.id === openId)?.pins;
      const input: CardInput = {
        lang,
        refdes: comp.refdes,
        ...(comp.label ? { label: comp.label } : {}),
        descriptor: app.project.describe(comp.definition.ref, comp.definition.version),
        nets,
        volts: view?.volts,
        pinAmps: view?.pinAmps[openId],
        health: view?.parts[openId],
        state: app.sim.lastFrame?.parts.get(openId),
        live: LIVE.includes(app.sim.state),
      };
      const model = buildCard(input);
      const key = modelKey(lang, model);
      if (force || key !== lastKey) {
        lastKey = key;
        card.draw(model, lang);
      }
      // Where the part is in the board frame, found again now and then (it can be moved or re-laid out).
      const at = app.bench.worldOf({ kind: 'part', part: openId });
      hasAnchor = at !== null;
      if (at) {
        app.bench.root.updateWorldMatrix(true, false);
        inv.copy(app.bench.root.matrixWorld).invert();
        board.set(at[0], at[1], at[2]).applyMatrix4(inv);
      }
      card.show(hasAnchor);
      return true;
    };

    // The card is built once and kept: the input service gives every ancestor of a bound object an IWSDK entity that
    // is never destroyed, which puts a removed object back, so a closed card is hidden, not taken out.
    const close = () => {
      offWant?.();
      offWant = null;
      card?.show(false);
      openId = null;
      hasAnchor = false;
      lastKey = '';
      lastAt = -1;
    };

    const open = (id: string) => {
      close();
      if (!isPart(id)) return;
      openId = id;
      if (!card) {
        card = createCard(app, () => app.scale.inspect(null));
        app.world.scene.add(card.group, card.leader);
      }
      offWant = feed.want(OWNER, { volts: 'all', amps: [], pinAmps: true, waves: [] });
      refresh(true);
      lastAt = performance.now();
      const hand = nextHand ?? app.settings.xr.value.dominantHand;
      nextHand = null;
      app.input.pulse(hand, 0.3, 15);
    };

    const sync = () => {
      const id = app.scale.inspected.value;
      if (id === openId) return;
      if (id) open(id);
      else close();
    };

    /** While the lens is on, a single selected part is the one inspected. */
    const fromSelection = () => {
      if (!app.scale.inspecting.value) return;
      const ids = app.project.selection.ids;
      const only = ids.length === 1 ? ids[0] : undefined;
      if (only && isPart(only) && only !== app.scale.inspected.value) app.scale.inspect(only);
    };

    const offs: Unsubscribe[] = [
      scaleControls(app).add({
        id: 'probe/inspect',
        host: 'panel',
        order: 3,
        icon: 'info',
        label: (lang) => tr(PROBE, lang, 'inspect'),
        latched: () => app.scale.inspecting.value,
        watch: [app.scale.inspecting],
        run: () => {
          app.scale.setInspecting(!app.scale.inspecting.value);
        },
      }),
      app.scale.inspected.subscribe(sync),
      app.scale.inspecting.subscribe((on) => {
        if (on) fromSelection();
        else if (app.scale.inspected.value !== null) app.scale.inspect(null);
      }),
      app.project.selection.subscribe(fromSelection),
      // Selecting a part (a completed select) while the lens is on. The event names its target by the bound id, which
      // is the part's id on the bench and in the Room size copy.
      // A part is bound for grabbing, so a trigger or a pinch on it arrives as a grab; a quick one (a tap, not a carry)
      // counts as the select.
      app.input.onAny((e) => {
        if (!app.scale.inspecting.value || !isPart(e.target)) return;
        if (e.type === 'grab-start') {
          grabs.set(e.pointer.id, { target: e.target, at: performance.now(), origin: [...e.pointer.origin], dir: [...e.pointer.direction] });
          return;
        }
        let hit = e.type === 'select';
        if (e.type === 'grab-end') {
          const g = grabs.get(e.pointer.id);
          grabs.delete(e.pointer.id);
          hit = g !== undefined && g.target === e.target && isTap(g, e.pointer.origin, e.pointer.direction, performance.now());
        }
        if (!hit) return;
        nextHand = e.pointer.hand;
        app.scale.inspect(e.target);
      }),
      // A part deleted while its card is open closes the card.
      app.project.subscribe(() => {
        if (openId && !isPart(openId)) app.scale.inspect(null);
      }),
      app.settings.lang.subscribe(() => {
        if (card && openId) refresh(true);
      }),
      onFrame(app.world, () => {
        if (!card || !openId) return;
        const now = performance.now();
        if (redrawDue(now, lastAt, REDRAW_MS)) {
          lastAt = now;
          if (!refresh(false)) {
            app.scale.inspect(null);
            return;
          }
        }
        if (hasAnchor) {
          stagePoint(anchor, board, app.scale.stage.value.root);
          card.place(anchor, app.world.camera);
        }
      }),
    ];
    sync();

    return () => {
      for (const off of offs) off();
      close();
      card?.dispose();
      card = null;
    };
  },
};
