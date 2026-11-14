/**
 * The 2D entry page's script (xr/index.html loads it; the markup and styles are there and in ./entry.css). It stays
 * light: the 3D engine (`../../main.ts`) is imported only when the person presses Enter or Open on this screen. Logic
 * lives in pure modules: the device check (./device.ts), the state machine (./state.ts) and the hands memory
 * (./hands.ts); this file reads the browser, feeds them and draws the result.
 */
import { LANGS, type Lang } from '../../contracts/common';
import type { BootStage, Booted } from '../../main';
import { say } from '../copy';
import { initialLang, writeLangCookie } from '../settings';
import { ENTRY, type EntryKey } from './copy';
import { canEnter, deviceRows, type Capabilities } from './device';
import { DRAWINGS, HAND_FILTER, NOTICE_ICONS, STATE_ICONS, type DrawingId } from './drawings';
import { readHands, rememberHands } from './hands';
import { takeLeaveAsked } from './leave';
import { INITIAL, step, type EntryEvent, type EntryState } from './state';

const root = document.documentElement;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const container = el<HTMLDivElement>('scene-container');
const enterBtn = el<HTMLButtonElement>('enter');
const flatBtn = el<HTMLButtonElement>('flat');
const backBtn = el<HTMLButtonElement>('back');
const statusEl = el<HTMLDivElement>('status');
const noticeEl = el<HTMLDivElement>('notice');
const rowsEl = el<HTMLUListElement>('device-rows');
const noImmersiveEl = el<HTMLParagraphElement>('no-immersive');
const langEl = el<HTMLSelectElement>('lang');
const progressEl = document.querySelector<HTMLDivElement>('.progress')!;

let lang: Lang = initialLang();
let state: EntryState = INITIAL;
let booted: Booted | null = null;
let caps: Capabilities = {
  secure: globalThis.isSecureContext !== false,
  xr: !!navigator.xr,
  ar: null,
  vr: null,
  hands: readHands(),
};
/** A `#project=` link: the library opens it on the bench; the fragment stays where it is. */
const shared = /(?:^#|&)project=/.test(location.hash);

const t = (key: EntryKey) => say(ENTRY, lang, key);

// ---------- events in ----------

function dispatch(ev: EntryEvent): void {
  const next = step(state, ev);
  state = next.state;
  // `enter` runs here, synchronously, so the session request stays inside the press's user activation.
  if (next.effect === 'enter' && booted) void booted.enter().then((ok) => dispatch({ type: 'settled', ok }));
  else if (next.effect === 'load') load();
  else if (next.effect === 'reload') location.reload();
  render();
}

function load(): void {
  import('../../main')
    .then(({ boot }) => boot({ container, onStage: (stage: BootStage) => dispatch({ type: 'stage', stage }) }))
    .then((b) => {
      booted = b;
      watchSession(b);
      dispatch({ type: 'ready', active: navigator.userActivation?.isActive ?? false });
    })
    .catch((err: unknown) => {
      console.error('[iynkware] the bench did not load', err);
      dispatch({ type: 'loadFailed', offline: navigator.onLine === false });
    });
}

function watchSession(b: Booted): void {
  let inSession = false;
  b.world.visibilityState.subscribe((v) => {
    const now = v !== 'non-immersive';
    if (now === inSession) return;
    inSession = now;
    if (now) {
      const features = (b.world.session as (XRSession & { enabledFeatures?: readonly string[] }) | undefined)?.enabledFeatures;
      caps = { ...caps, hands: rememberHands(features) ?? caps.hands };
      dispatch({ type: 'sessionStart' });
    } else {
      dispatch({ type: 'sessionEnd', asked: takeLeaveAsked() });
    }
  });
}

enterBtn.addEventListener('click', () => dispatch({ type: 'enter' }));
flatBtn.addEventListener('click', () => dispatch({ type: 'flat' }));
backBtn.addEventListener('click', () => dispatch({ type: 'back' }));

langEl.addEventListener('change', () => {
  const next = langEl.value as Lang;
  if (!(LANGS as readonly string[]).includes(next)) return;
  lang = next;
  writeLangCookie(next);
  // `?lang=` wins over the cookie on the next load, so it follows the choice; the fragment stays.
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', next);
    history.replaceState(history.state, '', url);
  }
  booted?.handle.app.settings.setLang(next);
  render();
});

async function askBrowser(): Promise<void> {
  const xr = navigator.xr;
  if (!xr || !caps.secure) return;
  const ar = await xr.isSessionSupported('immersive-ar').catch(() => false);
  const vr = ar ? null : await xr.isSessionSupported('immersive-vr').catch(() => false);
  caps = { ...caps, ar, vr };
  render();
}

// ---------- drawing ----------

const STAGE_KEY: Record<BootStage, EntryKey> = { project: 'stageProject', world: 'stageWorld', bench: 'stageBench', ready: 'stageReady' };
const STAGE_N: Record<BootStage, number> = { project: 1, world: 2, bench: 3, ready: 4 };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function words(): void {
  root.lang = lang;
  document.title = t('docTitle');
  langEl.value = lang;
  for (const node of document.querySelectorAll<HTMLElement>('[data-k]')) node.textContent = t(node.dataset.k as EntryKey);
  for (const node of document.querySelectorAll<HTMLImageElement>('[data-k-alt]')) node.alt = t(node.dataset.kAlt as EntryKey);
}

function notice(): { tone: keyof typeof NOTICE_ICONS; title: EntryKey; body: EntryKey } | null {
  const p = state.phase;
  if (p.k === 'refused') return { tone: 'bad', title: 'refusedTitle', body: 'refusedBody' };
  if (p.k === 'ended') return { tone: 'info', title: p.asked ? 'leftTitle' : 'endedTitle', body: 'endedBody' };
  if (p.k === 'failed') return p.offline ? { tone: 'warn', title: 'offlineTitle', body: 'offlineBody' } : { tone: 'bad', title: 'failedTitle', body: 'failedBody' };
  if (shared && (p.k === 'start' || p.k === 'loading' || p.k === 'armed')) return { tone: 'info', title: 'sharedTitle', body: 'sharedBody' };
  return null;
}

function render(): void {
  const p = state.phase;
  const can = canEnter(caps);
  words();

  root.classList.toggle('is-flat', p.k === 'flat');
  root.classList.toggle('is-immersive', p.k === 'immersive');

  // Enter shows unless the browser said no; Open on this screen is then the one primary action.
  const enterShown = can !== false;
  enterBtn.hidden = !enterShown;
  flatBtn.classList.toggle('primary', !enterShown);
  flatBtn.hidden = p.k === 'flat' || (p.k === 'failed' && enterShown);
  backBtn.hidden = p.k !== 'flat';
  noImmersiveEl.hidden = can !== false;
  const enterLabel = enterBtn.querySelector('span')!;
  enterLabel.textContent = t(p.k === 'armed' ? 'enterNow' : p.k === 'failed' ? 'reload' : 'enter');
  if (p.k === 'failed' && !enterShown) flatBtn.querySelector('span')!.textContent = t('reload');
  enterBtn.disabled = p.k === 'entering' || (p.k === 'loading' && p.then === 'enter');
  flatBtn.disabled = p.k === 'entering' || (p.k === 'loading' && p.then === 'flat');

  // Status line and progress.
  progressEl.hidden = p.k !== 'loading';
  if (p.k === 'loading') {
    statusEl.innerHTML = `<strong>${esc(t('loading'))}</strong>${esc(t(STAGE_KEY[p.stage]))}`;
    progressEl.querySelectorAll('i').forEach((i, n) => i.classList.toggle('on', n < STAGE_N[p.stage]));
  } else if (p.k === 'armed') statusEl.textContent = t('armed');
  else if (p.k === 'entering') statusEl.textContent = t('entering');
  else statusEl.textContent = '';

  const n = notice();
  noticeEl.hidden = !n;
  if (n) noticeEl.innerHTML = `${NOTICE_ICONS[n.tone]}<strong>${esc(t(n.title))}</strong><p>${esc(t(n.body))}</p>`;

  rowsEl.innerHTML = deviceRows(caps)
    .map(
      (r) =>
        `<li class="s-${r.state}">${STATE_ICONS[r.state]}<span class="row-label">${esc(t(r.label))}</span><span class="row-word">${esc(t(r.word))}</span><span class="row-detail">${esc(t(r.detail))}</span></li>`,
    )
    .join('');
}

document.body.insertAdjacentHTML('afterbegin', HAND_FILTER);
for (const li of document.querySelectorAll<HTMLLIElement>('[data-draw]')) li.insertAdjacentHTML('afterbegin', DRAWINGS[li.dataset.draw as DrawingId]);
render();
void askBrowser();
