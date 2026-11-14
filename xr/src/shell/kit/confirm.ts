/**
 * A confirm card (delete a project, reset progress): a small panel with a question, what it does, and two buttons,
 * the safe one first. Opens in front of the viewer at the given distance; closes itself on either answer.
 *
 *   confirmCard(app, { id: 'projects/delete', title, body, confirm: 'Delete', danger: true, onConfirm: () => remove(id) });
 */
import type { XrApp } from '../../contracts/app';
import { say } from '../copy';
import { dmm } from '../../look/type';
import { shellButton } from './button';
import { KIT } from './copy';
import { shellPanel, type ShellPanel } from './panel';
import { placeAhead } from './place';
import { shellText } from './text';

export interface ConfirmOptions {
  id: string;
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  distanceM?: number;
  onConfirm(): void;
  onCancel?(): void;
}

export function confirmCard(app: XrApp, o: ConfirmOptions): ShellPanel {
  const d = o.distanceM ?? 1.0;
  const w = dmm(420, d);
  const h = dmm(260, d);
  const lang = app.settings.lang.value;
  let panel: ShellPanel;
  const finish = (yes: boolean) => {
    panel.close(() => panel.dispose());
    if (yes) o.onConfirm();
    else o.onCancel?.();
  };
  panel = shellPanel(app, { id: o.id, w, h, distanceM: d, title: o.title, icon: o.danger ? 'warning' : 'question', onClose: () => finish(false) });
  const text = panel.add(shellText({ w: panel.inner, h: dmm(90, d), distanceM: d }), 0, panel.top - dmm(45, d));
  text.set(o.body, { maxLines: 3 });
  const bw = (panel.inner - dmm(16, d)) / 2;
  const bh = dmm(64, d);
  const y = -h / 2 + bh / 2 + dmm(26, d);
  panel.add(shellButton(app, { id: `${o.id}/cancel`, w: bw, h: bh, distanceM: d, poke: d < 0.6, onSelect: () => finish(false) }, { label: say(KIT, lang, 'cancel') }), -bw / 2 - dmm(8, d), y);
  panel.add(
    shellButton(app, { id: `${o.id}/confirm`, w: bw, h: bh, distanceM: d, poke: d < 0.6, onSelect: () => finish(true) }, { label: o.confirm, danger: o.danger, primary: !o.danger }),
    bw / 2 + dmm(8, d),
    y,
  );
  placeAhead(app.world, panel.group, { distance: d, belowDeg: 6 });
  panel.open();
  return panel;
}
