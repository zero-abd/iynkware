/**
 * The fault lab (docs/XR_DESIGN.md 6.5), smallest form: Menu, then Fault lab opens a panel with the fault deck for the
 * build on the bench (`deck.ts`). Pick a card (its part glows), Apply: one `fault.set`, one undo; the run cluster
 * reloads a live run with the broken circuit, since the bridge applies the document's faults. Broken faults are listed
 * with Take back (what if), each tagged at its part; Reset faults takes them all out in one batch, the circuit kept.
 *
 * Not yet: mystery mode, before and after compare, dropping a card on its part (parked on #37).
 */
import { getAppRegistry } from '@/parts/builtin';
import type { Project } from '@/project/generated/types';
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { LocalizedText, Unsubscribe } from '../../contracts/common';
import { LANGS } from '../../contracts/common';
import { shellButton, shellPanel, shellText, type ShellPanel } from '../../shell/kit';
import { placeInRing } from '../../ui/panels/ring';
import { dmm } from '../../look/type';
import { activeOf, deckOf, injectOps, resetOps, takeBackOps, type Card } from './deck';
import { causeText, faultStrings as S } from './strings';

const OWNER = 'run/faults';
const DISTANCE_M = 1.1;
const W = 0.62;
const H = 0.66;
/** Cards on one page, in two columns. */
const PAGE = 6;
const d = (v: number) => dmm(v, DISTANCE_M);

const partName = (doc: Project, part: string): string => {
  const c = doc.components.find((x) => x.id === part);
  return c?.refdes ?? c?.label ?? part;
};

/** The card's name in `lang`: iynk's cause title, or the lab's own word for a dead part, a short, an open leg. */
export function cardTitle(card: Pick<Card, 'kind' | 'causeId' | 'pin'>, lang: (typeof LANGS)[number]): string {
  if (card.kind === 'missing-part') return S.t(lang, 'dead');
  if (card.kind === 'short') return S.t(lang, 'short');
  const cause = causeText(lang, card.causeId);
  if (cause) return cause.title;
  if (card.kind === 'open-wire' && card.pin) return S.t(lang, 'open', { pin: card.pin });
  return card.kind;
}

const detailOf = (doc: Project, card: Card) => [partName(doc, card.part), card.pin && card.kind !== 'open-wire' ? card.pin : '', card.factor !== undefined ? `x${card.factor}` : ''].filter(Boolean).join('  ');

export const faultsModule: FeatureModule = {
  id: 'run/faults',
  mount(app: XrApp): Unsubscribe {
    const lang = () => app.settings.lang.value;
    const label: LocalizedText = Object.fromEntries(LANGS.map((l) => [l, S.t(l, 'title')])) ;
    let panel: ShellPanel | null = null;
    let selected: string | null = null;
    let page = 0;
    let tags: Unsubscribe[] = [];
    let glow: Unsubscribe | null = null;
    /** The deck for the document it was built from; rebuilt only when the document changes. */
    let deck: { doc: Project; cards: Card[] } | null = null;
    const cards = () => {
      const doc = app.project.doc;
      if (deck?.doc !== doc) deck = { doc, cards: deckOf(doc, getAppRegistry()) };
      return deck.cards;
    };

    const apply = (ops: ReturnType<typeof resetOps> | null, key: 'apply' | 'reset' | 'takeBack') => {
      if (!ops || ops.length === 0) return;
      app.project.apply(ops, { label: S.t(lang(), key) });
    };

    /** Tags at the broken parts (they show while the lab is open), and the glow on the selected card's part. */
    const mark = () => {
      for (const off of tags) off();
      tags = [];
      glow?.();
      glow = null;
      if (!panel?.isOpen) return;
      const doc = app.project.doc;
      for (const f of activeOf(doc)) {
        const part = f.target.component;
        if (!part) continue;
        const kind = f.kind;
        tags.push(app.overlay.show({ owner: OWNER, target: { kind: 'part', part }, tone: 'fail', style: 'label', text: cardTitle({ kind, causeId: f.cause_id, pin: f.target.pin }, lang()) }));
      }
      const card = cards().find((c) => c.id === selected);
      if (card?.part) glow = app.overlay.show({ owner: OWNER, target: { kind: 'part', part: card.part }, tone: 'warn', style: 'glow' });
    };

    const fill = () => {
      if (!panel) return;
      const p = panel;
      const l = lang();
      const doc = app.project.doc;
      p.clear();
      p.setTitle(S.t(l, 'title'), S.t(l, 'kicker'));
      const deckNow = cards();
      if (selected && !deckNow.some((c) => c.id === selected)) selected = null;
      const pages = Math.max(1, Math.ceil(deckNow.length / PAGE));
      page = Math.min(page, pages - 1);
      const inner = p.inner;
      const gap = d(10);
      let y = p.top - d(8);
      const row = (h: number) => {
        const c = y - h / 2;
        y -= h + gap;
        return c;
      };

      const hint = p.add(shellText({ w: inner, h: d(50), distanceM: DISTANCE_M }), 0, row(d(50)));
      const chosen = deckNow.find((c) => c.id === selected);
      const why = chosen ? causeText(l, chosen.causeId)?.why : undefined;
      hint.set(deckNow.length === 0 ? S.t(l, 'none') : (why ?? S.t(l, 'hint')), { role: 'body', maxLines: 2 });

      // The deck, two columns.
      const cw = (inner - gap) / 2;
      const ch = d(64);
      const shown = deckNow.slice(page * PAGE, page * PAGE + PAGE);
      for (let r = 0; r * 2 < shown.length; r++) {
        const cy = row(ch);
        for (let c = 0; c < 2 && r * 2 + c < shown.length; c++) {
          const card = shown[r * 2 + c]!;
          const x = -inner / 2 + cw / 2 + c * (cw + gap);
          p.add(
            shellButton(
              app,
              { id: `faults/card-${page * PAGE + r * 2 + c}`, w: cw, h: ch, distanceM: DISTANCE_M, poke: true, onSelect: () => select(card.id === selected ? null : card.id) },
              { label: cardTitle(card, l), detail: detailOf(doc, card), icon: 'warning', layout: 'row', selected: card.id === selected },
            ),
            x,
            cy,
          );
        }
      }

      // Apply, and More when the deck has pages.
      const ah = d(56);
      const ay = row(ah);
      const aw = pages > 1 ? (inner - gap) / 2 : inner;
      p.add(
        shellButton(
          app,
          { id: 'faults/apply', w: aw, h: ah, distanceM: DISTANCE_M, poke: true, onSelect: () => chosen && (apply(injectOps(app.project.doc, chosen), 'apply'), (selected = null)) },
          { label: S.t(l, 'apply'), icon: 'warning', primary: true, disabled: !chosen },
        ),
        pages > 1 ? -inner / 2 + aw / 2 : 0,
        ay,
      );
      if (pages > 1) {
        p.add(
          shellButton(
            app,
            { id: 'faults/more', w: aw, h: ah, distanceM: DISTANCE_M, poke: true, onSelect: () => ((page = (page + 1) % pages), fill()) },
            { label: S.t(l, 'more'), detail: `${page + 1} / ${pages}`, icon: 'dots', layout: 'row' },
          ),
          inner / 2 - aw / 2,
          ay,
        );
      }

      // What is broken now: Take back each, Reset faults.
      const active = activeOf(doc);
      if (active.length > 0) {
        const head = p.add(shellText({ w: inner, h: d(30), distanceM: DISTANCE_M }), 0, row(d(30)));
        head.set(S.t(l, 'active'), { role: 'kicker', maxLines: 1 });
        const bh = d(52);
        for (const [i, f] of active.slice(0, 3).entries()) {
          const name = cardTitle({ kind: f.kind, causeId: f.cause_id, pin: f.target.pin }, l);
          p.add(
            shellButton(
              app,
              { id: `faults/back-${i}`, w: inner, h: bh, distanceM: DISTANCE_M, poke: true, onSelect: () => apply(takeBackOps(app.project.doc, f.id), 'takeBack') },
              { label: `${S.t(l, 'takeBack')}: ${name}`, detail: f.target.component ? partName(doc, f.target.component) : undefined, icon: 'undo', layout: 'row' },
            ),
            0,
            row(bh),
          );
        }
        p.add(
          shellButton(
            app,
            { id: 'faults/reset', w: inner, h: bh, distanceM: DISTANCE_M, poke: true, onSelect: () => apply(resetOps(app.project.doc), 'reset') },
            { label: S.t(l, 'reset'), icon: 'reset', danger: true },
          ),
          0,
          row(bh),
        );
      }
      // For scripts and tests: what the lab shows.
      p.group.userData.faults = { open: p.isOpen, deck: deckNow.map((c) => ({ id: c.id, kind: c.kind, part: c.part })), page, selected, active: active.map((f) => f.id) };
      mark();
    };

    const select = (id: string | null) => {
      selected = id;
      fill();
    };

    const close = () => {
      panel?.close(() => mark());
      mark();
    };

    const open = () => {
      panel ??= shellPanel(app, { id: 'run/fault-lab', w: d(W * 1000), h: d(H * 1000), distanceM: DISTANCE_M, title: S.t(lang(), 'title'), kicker: S.t(lang(), 'kicker'), icon: 'warning', onClose: close });
      // The lab is the task now: home steps aside so the two panels never overlap.
      if (app.shell.homeOpen.value) app.shell.closeHome();
      placeInRing(app, panel.group, 'side');
      panel.open();
      fill();
    };

    const offs: Unsubscribe[] = [
      app.shell.addMenuItem({ id: 'run/fault-lab', group: 'tools', label, run: open }),
      app.project.subscribe(() => panel?.isOpen && fill()),
      app.settings.lang.subscribe(() => panel?.isOpen && fill()),
    ];
    return () => {
      for (const off of offs) off();
      for (const off of tags) off();
      glow?.();
      app.overlay.clear(OWNER);
      panel?.dispose();
    };
  },
};
