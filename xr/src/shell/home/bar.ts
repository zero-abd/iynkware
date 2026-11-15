/**
 * The flat-screen bar (desktop testing without a headset): Home, Restart and Exit at the top left, shown only on a flat
 * screen. Home opens the shell's Home panel; Restart and Exit are `./actions.ts`.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import { pickText, type Unsubscribe } from '../../contracts/common';
import { exitApp, restartApp } from './actions';
import { HOME_TEXT } from './text';

function mountBar(app: XrApp): Unsubscribe {
  if (typeof document === 'undefined') return () => undefined;
  const bar = document.createElement('nav');
  bar.id = 'shell-bar';
  bar.style.cssText = 'position:fixed;left:12px;top:12px;z-index:25;display:flex;gap:6px;font:600 15px system-ui,sans-serif';
  const make = (id: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.style.cssText = 'min-height:40px;padding:6px 14px;border:2px solid #231e16;border-radius:10px;background:#f2efe7;color:#231e16;font:inherit;cursor:pointer;box-shadow:3px 3px 0 #41538f';
    b.addEventListener('click', onClick);
    bar.append(b);
    return b;
  };
  const home = make('shell-home-btn', () => (app.shell.homeOpen.value ? app.shell.closeHome() : app.shell.openHome()));
  const restart = make('shell-restart-btn', () => void restartApp(app));
  const exit = make('shell-exit-btn', () => void exitApp(app));
  document.body.append(bar);
  const paint = () => {
    const lang = app.settings.lang.value;
    home.textContent = pickText(HOME_TEXT.home, lang);
    restart.textContent = pickText(HOME_TEXT.restart, lang);
    exit.textContent = pickText(HOME_TEXT.exit, lang);
    bar.style.display = app.mode.value === 'flat' ? 'flex' : 'none';
  };
  const offs = [app.settings.lang.subscribe(paint), app.mode.subscribe(paint)];
  paint();
  return () => {
    for (const off of offs) off();
    bar.remove();
  };
}

export const homeBarModule: FeatureModule = { id: 'shell/home-bar', mount: (app) => mountBar(app) };
