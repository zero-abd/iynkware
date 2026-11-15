/**
 * The chemistry lab's Elements button and periodic table. A small floating button at the bench's front left opens a
 * panel with all 118 elements (symbol and atomic number, tinted by family); tapping one puts a labelled sample jar on
 * the bench (`element-sample`, through the lab store, so the tutor and the agent see it) and the table stays open
 * for the next. Only while the chemistry lab is laid out.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { INK, MUTED } from '../../look/palette';
import { TYPE } from '../../look/type';
import { labOf, type LabContext } from '../context';
import { createLabPanel } from '../kit/panel';
import { ELEMENT_KIND } from '../model/items/element';
import { l6, say } from '../text';
import { ELEMENTS, FAMILY_HEX, type Element } from './data';

export const ELEMENTS_TEXT = {
  button: l6('Elements', 'Elemente', 'Elementos', 'Éléments', 'तत्व', '元素'),
  title: l6('Periodic table', 'Periodensystem', 'Tabla periódica', 'Tableau périodique', 'आवर्त सारणी', '元素周期表'),
  hint: l6(
    'Tap an element to put a sample on the bench.',
    'Tippe ein Element an, um eine Probe auf die Werkbank zu stellen.',
    'Toca un elemento para poner una muestra en el banco.',
    'Touche un élément pour poser un échantillon sur l’établi.',
    'बेंच पर नमूना रखने के लिए किसी तत्व को छुओ।',
    '点一个元素，把样品放到工作台上。',
  ),
  close: l6('Close', 'Schließen', 'Cerrar', 'Fermer', 'बंद करो', '关闭'),
};

/** Table frame (metres). The button floats at the bench's front left; the table stands above the back of the bench. */
const BUTTON = { widthM: 0.17, heightM: 0.065, distanceM: 0.6 } as const;
const BUTTON_AT = { x: -0.34, y: 0.2, z: 0.1, yaw: 0.45 } as const;
const TABLE = { widthM: 0.95, heightM: 0.56, distanceM: 1.0 } as const;
const TABLE_AT = { x: 0, y: 0.3, z: -0.2, tilt: -0.35 } as const;

/** Where the next sample lands, millimetres in the table frame: a grid at the front left, filled in order. */
export function sampleSpot(n: number): { x: number; z: number; yaw: number } {
  const i = n % 15;
  return { x: -300 + (i % 5) * 65, z: 40 + Math.floor(i / 5) * 65, yaw: 0 };
}

export function mountElements(app: XrApp, lab: LabContext): Unsubscribe {
  const store = lab.store;
  const lang = () => app.settings.lang.value;
  let open = false;

  const button = createLabPanel(app, { id: 'lab-elements-button', ...BUTTON });
  button.group.name = 'lab:elements-button';
  button.group.position.set(BUTTON_AT.x, BUTTON_AT.y, BUTTON_AT.z);
  button.group.rotation.set(0, BUTTON_AT.yaw, 0);
  app.bench.table.add(button.group);

  const table = createLabPanel(app, { id: 'lab-elements', ...TABLE });
  table.group.name = 'lab:elements';
  table.group.position.set(TABLE_AT.x, TABLE_AT.y, TABLE_AT.z);
  table.group.rotation.set(TABLE_AT.tilt, 0, 0);
  app.bench.table.add(table.group);

  let placed = 0;
  const give = (e: Element) => {
    store.place(ELEMENT_KIND, sampleSpot(placed++), { params: { symbol: e.symbol }, label: e.symbol });
  };

  const redraw = () => {
    const chem = store.lab === 'chemistry';
    button.setVisible(chem);
    table.setVisible(chem && open);
    if (!chem) return;
    const l = lang();
    button.draw(`${l}|${open}`, (ui) => {
      const pad = 6 * ui.u;
      ui.button('toggle', pad, pad, ui.W - 2 * pad, ui.H - 2 * pad, say(open ? ELEMENTS_TEXT.close : ELEMENTS_TEXT.button, l), toggle, { primary: !open, selected: open });
    });
    if (!open) return;
    table.draw(`${l}`, (ui) => {
      const { u, W, H, g } = ui;
      const pad = 18 * u;
      ui.text(say(ELEMENTS_TEXT.title, l), pad, pad, W / 2, { role: TYPE.title, maxLines: 1 });
      ui.text(say(ELEMENTS_TEXT.hint, l), W / 2, pad + 8 * u, W / 2 - pad, { maxLines: 1, colour: MUTED });
      const top = pad + 46 * u;
      const gap = 3 * u;
      const tw = (W - 2 * pad - 17 * gap) / 18;
      // rows 1..7, a small break, then the lanthanide and actinide rows (9, 10)
      const th = (H - top - pad - 8 * u - 9 * gap) / 9.3;
      const yOf = (row: number) => top + (row <= 7 ? row - 1 : row - 1.7) * (th + gap);
      for (const e of ELEMENTS) {
        const x = pad + (e.col - 1) * (tw + gap);
        const y = yOf(e.row);
        ui.button(`el-${e.symbol}`, x, y, tw, th, '', () => give(e));
        // the family tint along the tile's top, the symbol (drawn here so a wide one never shortens) and the number
        g.fillStyle = FAMILY_HEX[e.family];
        g.fillRect(x + 2 * u, y + 2 * u, tw - 4 * u, 6 * u);
        g.fillStyle = INK;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `600 ${Math.round(Math.min(th * 0.42, tw * 0.42))}px sans-serif`;
        g.fillText(e.symbol, x + tw / 2, y + th * 0.5);
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        g.font = `${Math.round(9 * u)}px sans-serif`;
        g.fillText(String(e.z), x + 4 * u, y + th - 4 * u);
      }
    });
  };
  function toggle() {
    open = !open;
    redraw();
  }

  const offs = [
    store.subscribe((c) => {
      if (c.type === 'lab') {
        open = false;
        placed = 0;
        redraw();
      }
    }),
    app.settings.lang.subscribe(() => redraw()),
  ];
  redraw();
  return () => {
    for (const off of offs) off();
    button.dispose();
    table.dispose();
  };
}

export const elementsModule: FeatureModule = {
  id: 'lab/elements',
  mount(app) {
    const lab = labOf(app.world);
    return lab ? mountElements(app, lab) : () => undefined;
  },
};
