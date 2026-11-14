/**
 * The 2D entry page's script (xr/index.html loads it). It stays light: the 3D engine (`../../main.ts`) is imported
 * only when the person presses Enter or Open on this screen. Enter loads the engine and starts headset mode at once
 * when the click's activation is still live; otherwise it turns into Enter now for a second press.
 */
import type { Lang } from '../../contracts/common';
import type { BootStage, Booted } from '../../main';
import { say } from '../copy';
import { initialLang } from '../settings';
import { ENTRY } from './copy';

const lang: Lang = initialLang();
document.documentElement.lang = lang;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const container = el<HTMLDivElement>('scene-container');
const shell = el<HTMLDivElement>('shell');
const enterBtn = el<HTMLButtonElement>('enter');
const flatBtn = el<HTMLButtonElement>('flat');
const status = el<HTMLDivElement>('status');

type Key = keyof (typeof ENTRY)['en'];
const show = (key: Key) => {
  status.textContent = say(ENTRY, lang, key);
};

enterBtn.textContent = say(ENTRY, lang, 'enter');
flatBtn.textContent = say(ENTRY, lang, 'flat');
show('start');

let booted: Booted | null = null;
let loading: Promise<Booted> | null = null;

function load(): Promise<Booted> {
  loading ??= import('../../main')
    .then(({ boot }) => boot({ container, onStage: (s: BootStage) => show(s) }))
    .then((b) => {
      booted = b;
      b.world.visibilityState.subscribe((v) => {
        shell.style.display = v === 'non-immersive' ? '' : 'none';
      });
      return b;
    });
  loading.catch((err) => {
    console.error('[iynkware] boot', err);
    loading = null;
    show('failed');
    enterBtn.disabled = false;
    flatBtn.disabled = false;
  });
  return loading;
}

async function enter(b: Booted) {
  enterBtn.textContent = say(ENTRY, lang, 'enter');
  show('entering');
  const ok = await b.enter();
  show(ok ? 'ready' : 'refused');
}

enterBtn.addEventListener('click', () => {
  if (booted) return void enter(booted);
  enterBtn.disabled = true;
  flatBtn.disabled = true;
  void load().then((b) => {
    enterBtn.disabled = false;
    if (navigator.userActivation?.isActive ?? true) return enter(b);
    enterBtn.textContent = say(ENTRY, lang, 'enterNow');
    show('again');
  });
});

flatBtn.addEventListener('click', () => {
  flatBtn.disabled = true;
  enterBtn.disabled = true;
  void load().then(() => {
    document.documentElement.classList.add('flat');
    flatBtn.hidden = true;
    enterBtn.disabled = !immersive;
    show('ready');
  });
});

let immersive = false;
void (async () => {
  const xr = navigator.xr;
  const ar = (await xr?.isSessionSupported('immersive-ar').catch(() => false)) ?? false;
  const vr = ar || ((await xr?.isSessionSupported('immersive-vr').catch(() => false)) ?? false);
  immersive = vr;
  if (!immersive) {
    enterBtn.hidden = true;
    show('noXr');
  }
})();
