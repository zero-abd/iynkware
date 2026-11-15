/**
 * The data tab: a panel to the right of the bench while a lab is open. Pick what goes on the X axis and the Y axis
 * (the lab clock, or any number an item on the bench reports or is set to), record while the experiment runs, and
 * see Y plotted against X. Recording starts by itself when an experiment starts, and with Record.
 *
 *   X / Y      each button steps to the next channel; ‹ steps back
 *   Record     starts or stops capturing (a sample every 50 ms of lab time, at most 1200)
 *   Clear      empties the plot
 *
 * Sampling runs on the lab clock (`store.now`), so a paused lab records nothing new.
 */
import type { FeatureModule, XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import { ACCENT, INK, MUTED, RULE } from '../../look/palette';
import { onLookFrame } from '../../look/runner';
import { TYPE } from '../../look/type';
import { labOf, type LabContext } from '../context';
import { createLabPanel, type PanelUi } from '../kit/panel';
import { l6, say } from '../text';
import { boundsOf, channelsOf, defaultY, TIME, valueOf, type Channel } from './channels';

export const DATA_TEXT = {
  title: l6('Data', 'Daten', 'Datos', 'Données', 'डेटा', '数据'),
  time: l6('Time (s)', 'Zeit (s)', 'Tiempo (s)', 'Temps (s)', 'समय (s)', '时间 (s)'),
  x: l6('X', 'X', 'X', 'X', 'X', 'X'),
  y: l6('Y', 'Y', 'Y', 'Y', 'Y', 'Y'),
  record: l6('Record', 'Aufnehmen', 'Grabar', 'Enregistrer', 'रिकॉर्ड', '记录'),
  stop: l6('Stop', 'Stopp', 'Parar', 'Arrêter', 'रोको', '停止'),
  clear: l6('Clear', 'Löschen', 'Borrar', 'Effacer', 'साफ़ करो', '清除'),
  empty: l6(
    'Pick X and Y, then press Record or start an experiment.',
    'Wähle X und Y, dann drück Aufnehmen oder starte ein Experiment.',
    'Elige X e Y, luego pulsa Grabar o empieza un experimento.',
    'Choisis X et Y, puis appuie sur Enregistrer ou lance une expérience.',
    'X और Y चुनो, फिर रिकॉर्ड दबाओ या प्रयोग शुरू करो।',
    '选好 X 和 Y，然后按记录或开始实验。',
  ),
  points: l6('{n} points', '{n} Punkte', '{n} puntos', '{n} points', '{n} बिंदु', '{n} 个点'),
};

/** Table frame: past the lab panel's right edge, turned further toward the person. */
const PANEL = { widthM: 0.38, heightM: 0.36, distanceM: 0.7 } as const;
const AT = { x: 0.7, y: 0.14, z: 0.16, yaw: -0.85, tilt: -0.3 } as const;
const SAMPLE_MS = 50;
const MAX_POINTS = 1200;
/** Repaint at most this often while recording, ms of wall time. */
const PAINT_MS = 120;

export function mountData(app: XrApp, lab: LabContext): Unsubscribe {
  const store = lab.store;
  const lang = () => app.settings.lang.value;
  const panel = createLabPanel(app, { id: 'lab-data', ...PANEL });
  panel.group.name = 'lab:data';
  panel.group.position.set(AT.x, AT.y, AT.z);
  panel.group.rotation.set(AT.tilt, AT.yaw, 0, 'YXZ');
  panel.setVisible(false);
  app.bench.table.add(panel.group);

  let xId = TIME;
  let yId = '';
  /** The person picked Y: keep it; else Y follows the best default as equipment arrives. */
  let yChosen = false;
  let recording = false;
  let lastSample = -Infinity;
  let lastPaint = 0;
  let points: Array<[number, number]> = [];

  const channels = (): Channel[] => channelsOf(store.items(), (id) => store.report(id), lang(), say(DATA_TEXT.time, lang()));
  const ensure = (list: Channel[]) => {
    if (!list.some((c) => c.id === xId)) xId = TIME;
    if (!yChosen || !yId || !list.some((c) => c.id === yId)) yId = defaultY(list);
  };
  const clear = () => {
    points = [];
    lastSample = -Infinity;
  };
  const step = (axis: 'x' | 'y', by: 1 | -1) => {
    const list = channels();
    const cur = axis === 'x' ? xId : yId;
    const i = Math.max(0, list.findIndex((c) => c.id === cur));
    const next = list[(i + by + list.length) % list.length]!.id;
    if (axis === 'x') xId = next;
    else {
      yId = next;
      yChosen = true;
    }
    clear();
    redraw();
  };
  const toggle = () => {
    recording = !recording;
    if (recording) clear();
    redraw();
  };

  const paint = (ui: PanelUi) => {
    const { u, W, H, g } = ui;
    const l = lang();
    const pad = 20 * u;
    const list = channels();
    ensure(list);
    const label = (id: string) => list.find((c) => c.id === id)?.label ?? id;
    ui.text(say(DATA_TEXT.title, l), pad, pad, W - 2 * pad, { role: TYPE.title, maxLines: 1 });

    // axis pickers: ‹ [X: label]
    const bh = 38 * u;
    const small = 38 * u;
    const row = (axis: 'x' | 'y', y: number) => {
      ui.button(`${axis}-prev`, pad, y, small, bh, '‹', () => step(axis, -1));
      ui.button(`${axis}-next`, pad + small + 6 * u, y, W - 2 * pad - small - 6 * u, bh, `${say(DATA_TEXT[axis], l)}: ${label(axis === 'x' ? xId : yId)}`, () => step(axis, 1));
    };
    row('x', pad + 40 * u);
    row('y', pad + 40 * u + bh + 6 * u);

    // the plot
    const top = pad + 40 * u + 2 * (bh + 6 * u) + 8 * u;
    const foot = 44 * u;
    const px = pad + 52 * u;
    const pw = W - px - pad;
    const ph = H - top - foot - pad - 18 * u;
    g.save();
    g.strokeStyle = RULE;
    g.lineWidth = 2 * u;
    g.strokeRect(px, top, pw, ph);
    if (points.length === 0) {
      ui.text(say(DATA_TEXT.empty, l), px + 10 * u, top + ph / 2 - 20 * u, pw - 20 * u, { maxLines: 3, colour: MUTED });
    } else {
      const [x0, x1] = boundsOf(points.map((p) => p[0]));
      const [y0, y1] = boundsOf(points.map((p) => p[1]));
      const sx = (x: number) => px + ((x - x0) / (x1 - x0)) * pw;
      const sy = (y: number) => top + ph - ((y - y0) / (y1 - y0)) * ph;
      g.strokeStyle = ACCENT;
      g.lineWidth = 3 * u;
      g.lineJoin = 'round';
      g.beginPath();
      points.forEach(([x, y], i) => (i === 0 ? g.moveTo(sx(x), sy(y)) : g.lineTo(sx(x), sy(y))));
      g.stroke();
      g.fillStyle = INK;
      const last = points[points.length - 1]!;
      g.beginPath();
      g.arc(sx(last[0]), sy(last[1]), 4 * u, 0, Math.PI * 2);
      g.fill();
      const f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
      const tiny = { size: 13 * u, colour: MUTED, maxLines: 1 };
      ui.text(f(y1), pad, top, px - pad - 4 * u, tiny);
      ui.text(f(y0), pad, top + ph - 16 * u, px - pad - 4 * u, tiny);
      ui.text(f(x0), px, top + ph + 4 * u, pw / 2, tiny);
      ui.text(f(x1), px + pw - 60 * u, top + ph + 4 * u, 60 * u, tiny);
    }
    g.restore();

    // record, clear, count
    const fy = H - pad - foot + 6 * u;
    const fw = (W - 2 * pad - 12 * u) / 3;
    ui.button('record', pad, fy, fw, foot - 6 * u, say(recording ? DATA_TEXT.stop : DATA_TEXT.record, l), toggle, { primary: !recording, selected: recording });
    ui.button('clear', pad + fw + 6 * u, fy, fw, foot - 6 * u, say(DATA_TEXT.clear, l), () => (clear(), redraw()));
    ui.text(say(DATA_TEXT.points, l).replace('{n}', String(points.length)), pad + 2 * (fw + 6 * u) + 6 * u, fy + 10 * u, fw, { size: 15 * u, colour: MUTED, maxLines: 1 });
  };

  let version = 0;
  function redraw() {
    const show = store.lab !== null;
    panel.setVisible(show);
    if (!show) return;
    panel.draw(`${lang()}|${xId}|${yId}|${recording}|${++version}`, paint);
  }

  const offs: Unsubscribe[] = [
    store.subscribe((c) => {
      if (c.type === 'lab') {
        clear();
        recording = false;
        xId = TIME;
        yId = '';
        yChosen = false;
        redraw();
      } else if (c.type === 'place' || c.type === 'remove' || c.type === 'clear') redraw();
    }),
    // an experiment starting starts a fresh recording
    lab.runner.state.subscribe((st) => {
      if (st && !st.done && !recording) {
        recording = true;
        clear();
        redraw();
      }
    }),
    app.settings.lang.subscribe(() => redraw()),
    onLookFrame(app.world, () => {
      if (!recording || store.lab === null || store.now - lastSample < SAMPLE_MS) return;
      lastSample = store.now;
      const get = (id: string) => store.get(id);
      const rep = (id: string) => store.report(id);
      const x = valueOf(xId, store.now, get, rep);
      const y = valueOf(yId, store.now, get, rep);
      if (x === null || y === null) return;
      points.push([x, y]);
      if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
      const now = performance.now();
      if (now - lastPaint > PAINT_MS) {
        lastPaint = now;
        redraw();
      }
    }),
  ];
  redraw();
  return () => {
    for (const off of offs) off();
    panel.dispose();
  };
}

export const dataModule: FeatureModule = {
  id: 'lab/data',
  mount(app) {
    const lab = labOf(app.world);
    return lab ? mountData(app, lab) : () => undefined;
  },
};
