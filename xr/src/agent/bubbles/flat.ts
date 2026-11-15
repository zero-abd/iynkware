/**
 * The conversation on a flat screen. The world speech bubble (speech.ts) sits to the left of where a head faces, which
 * on a 60° monitor view is just off screen, so in flat mode the same conversation is drawn here as a DOM card at the
 * bottom left: the state, the voice note, the recent turns (the person's transcript too), reply chips and a box to
 * type a question (it goes through the bridge, so it works without a voice key on the scripted fallback brain).
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { say } from '../../lab/text';
import { FLAT_TEXT } from './flat-text';
import type { Conversation } from './model';

export function mountFlatConversation(app: XrApp, conv: Conversation, send: (text: string) => void): Unsubscribe {
  if (typeof document === 'undefined') return () => undefined;
  const lang = () => app.settings.lang.value;
  const root = document.createElement('section');
  root.id = 'agent-conversation';
  root.setAttribute('aria-live', 'polite');
  root.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:20;width:min(380px,calc(100vw - 24px));max-height:min(55vh,460px);display:flex;flex-direction:column;gap:8px;padding:12px;border:2px solid #231e16;border-radius:12px;background:#f2efe7;color:#231e16;font:14px system-ui,sans-serif;box-shadow:4px 4px 0 #41538f';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:700';
  const dot = document.createElement('span');
  dot.style.cssText = 'width:10px;height:10px;border-radius:50%;flex:none';
  const title = document.createElement('span');
  const state = document.createElement('span');
  state.style.cssText = 'margin-left:auto;font-weight:400;opacity:.7';
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.style.cssText = 'border:0;background:none;font:inherit;cursor:pointer;padding:0 4px';
  head.append(dot, title, state, hide);
  const note = document.createElement('div');
  note.style.cssText = 'font-size:13px';
  const log = document.createElement('div');
  log.style.cssText = 'overflow:auto;display:flex;flex-direction:column;gap:6px;min-height:0';
  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  const form = document.createElement('form');
  form.style.cssText = 'display:flex;gap:6px';
  const input = document.createElement('input');
  input.type = 'text';
  input.style.cssText = 'flex:1;min-width:0;min-height:36px;padding:4px 10px;border:2px solid #231e16;border-radius:8px;background:#fffaf0;color:#231e16;font:inherit';
  const go = document.createElement('button');
  go.type = 'submit';
  go.style.cssText = 'min-height:36px;padding:4px 12px;border:2px solid #231e16;border-radius:8px;background:#e4694e;color:#231e16;font:600 14px system-ui,sans-serif;cursor:pointer';
  form.append(input, go);
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-height:0';
  body.append(note, log, chips, form);
  root.append(head, body);
  document.body.append(root);

  let collapsed = false;
  const COLOURS: Record<string, string> = { connecting: '#8a8170', listening: '#3c8d4f', thinking: '#c98a1a', speaking: '#41538f', idle: '#8a8170' };

  const paint = () => {
    const l = lang();
    title.textContent = say(FLAT_TEXT.title, l);
    state.textContent = say(FLAT_TEXT.state[conv.state], l);
    dot.style.background = COLOURS[conv.state] ?? '#8a8170';
    hide.textContent = collapsed ? '▴' : '▾';
    hide.setAttribute('aria-label', say(collapsed ? FLAT_TEXT.show : FLAT_TEXT.hide, l));
    body.style.display = collapsed ? 'none' : 'flex';
    note.textContent = conv.note;
    note.style.display = conv.note ? '' : 'none';
    note.style.color = conv.noteWarn ? '#b0392b' : 'inherit';
    log.replaceChildren();
    if (!conv.turns.length) {
      const empty = document.createElement('div');
      empty.textContent = say(FLAT_TEXT.empty, l);
      empty.style.opacity = '.7';
      log.append(empty);
    }
    for (const turn of conv.turns) {
      const p = document.createElement('div');
      const mine = turn.who === 'user';
      p.style.cssText = `align-self:${mine ? 'flex-end' : 'flex-start'};max-width:90%;padding:6px 10px;border-radius:10px;background:${mine ? '#dfe6f7' : '#fffaf0'};border:1px solid #231e1633;white-space:pre-wrap;${turn.final ? '' : 'opacity:.75'}`;
      p.textContent = turn.text || '…';
      log.append(p);
    }
    log.scrollTop = log.scrollHeight;
    chips.replaceChildren();
    for (const s of conv.suggestions) {
      const c = document.createElement('button');
      c.type = 'button';
      c.textContent = s;
      c.style.cssText = 'min-height:32px;padding:2px 10px;border:2px solid #231e16;border-radius:16px;background:#fffaf0;color:#231e16;font:inherit;cursor:pointer';
      c.addEventListener('click', () => send(s));
      chips.append(c);
    }
    input.placeholder = say(FLAT_TEXT.placeholder, l);
    go.textContent = say(FLAT_TEXT.send, l);
    root.style.display = app.mode.value === 'flat' ? 'flex' : 'none';
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  // Typing must not reach the bench's keyboard shortcuts.
  input.addEventListener('keydown', (e) => e.stopPropagation());
  hide.addEventListener('click', () => {
    collapsed = !collapsed;
    paint();
  });

  const offs = [conv.subscribe(paint), app.mode.subscribe(paint), app.settings.lang.subscribe(paint)];
  paint();
  return () => {
    for (const off of offs) off();
    root.remove();
  };
}
