/**
 * The flat screen's code editor (desktop testing without a headset): a text area over the page with Save and Cancel.
 * Its keys stay in it, so the bench's Q and E and the Range's flight keys do not see the typing. A headset has no
 * editor (XR_DESIGN 7.2: no free typing in v1); the companion writes code there instead.
 */
import { MONO } from '../kit/face';

export interface FlatEditor {
  open(o: { title: string; text: string; save: string; cancel: string; onSave(text: string): void }): void;
  close(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

export function createFlatEditor(): FlatEditor {
  let root: HTMLDivElement | null = null;
  const close = () => {
    root?.remove();
    root = null;
  };
  return {
    get isOpen() {
      return root !== null;
    },
    open(o) {
      close();
      if (typeof document === 'undefined') return;
      const box = document.createElement('div');
      box.id = 'code-editor';
      box.style.cssText =
        'position:fixed;right:16px;top:64px;bottom:16px;width:min(560px,calc(100vw - 32px));z-index:30;display:flex;flex-direction:column;gap:8px;padding:12px;border:2px solid #231e16;border-radius:12px;background:#f2efe7;box-shadow:4px 4px 0 #41538f;font:600 15px system-ui,sans-serif;color:#231e16';
      const title = document.createElement('div');
      title.textContent = o.title;
      const area = document.createElement('textarea');
      area.value = o.text;
      area.spellcheck = false;
      area.style.cssText = `flex:1;min-height:0;resize:none;padding:10px;border:2px solid #231e16;border-radius:8px;background:#fbfbfa;color:#231e16;font:14px/1.45 ${MONO};tab-size:2;white-space:pre`;
      area.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') {
          e.preventDefault();
          const { selectionStart: s, selectionEnd: t } = area;
          area.setRangeText('  ', s, t, 'end');
        } else if (e.key === 'Escape') close();
        else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          o.onSave(area.value);
        }
      });
      area.addEventListener('keyup', (e) => e.stopPropagation());
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
      const button = (label: string, primary: boolean, fn: () => void) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = `min-height:40px;padding:6px 16px;border:2px solid #231e16;border-radius:10px;background:${primary ? '#e4694e' : '#f2efe7'};color:#231e16;font:inherit;cursor:pointer`;
        b.addEventListener('click', fn);
        row.append(b);
        return b;
      };
      button(o.cancel, false, close).id = 'code-editor-cancel';
      button(o.save, true, () => o.onSave(area.value)).id = 'code-editor-save';
      box.append(title, area, row);
      document.body.append(box);
      root = box;
      area.focus();
    },
    close,
    dispose: close,
  };
}
