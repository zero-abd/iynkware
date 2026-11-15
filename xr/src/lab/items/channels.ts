/**
 * Model state to channel values, the one source for both looks. `channelsOf` runs when an item's state changes (it may
 * allocate); `liveChannels` runs every frame for what moves continuously (the swing, a pouring level, a swirl) and
 * allocates nothing. The degree mappings are the lab figures' (`extras.deg`, `degPerUnit`, `degAtZero`).
 */
import { FLAMES, LIQUID_COLOUR, FLAME_COLOUR, type Collar, type Liquid, type Salt } from '../model/items/chemistry';
import { angleAt } from '../model/items/physics';
import { traceOf } from '../model/items/signals';
import type { ItemState, LabEnv, Report } from '../model/types';
import type { ChannelValue } from './visual';

/** The beaker's liquid surface height (mm) for a volume (the figure's `levelMm`, linear between its marks). */
const BEAKER_LEVEL: readonly (readonly [number, number])[] = [[0, 2], [50, 16.2], [100, 30.4], [150, 44.5], [200, 58.7], [250, 72.9], [300, 87.1]];
const FLASK_LEVEL: readonly (readonly [number, number])[] = [[0, 2], [50, 11.5], [100, 21.8], [150, 33.7], [200, 48], [250, 66.4], [300, 94.5]];

export function levelMm(table: readonly (readonly [number, number])[], vol: number): number {
  if (vol <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [v1, h1] = table[i]!;
    if (vol <= v1) {
      const [v0, h0] = table[i - 1]!;
      return h0 + ((h1 - h0) * (vol - v0)) / (v1 - v0);
    }
  }
  return table[table.length - 1]![1];
}

const fmt = (v: number, d: number) => v.toFixed(d);
const hz = (f: number) => (f >= 1000 ? `${fmt(f / 1000, 2)} kHz` : `${fmt(f, 0)} Hz`);
const perDiv = (s: number) => (s >= 1e-3 ? `${fmt(s * 1000, s * 1000 < 1 ? 1 : 0)} ms` : `${fmt(s * 1e6, 0)} µs`);

/** Every channel of `kind` for this state: [id, value] pairs. */
export function channelsOf(kind: string, st: Readonly<ItemState>, report: Report, env: LabEnv): Array<[string, ChannelValue]> {
  const p = st.p;
  switch (kind) {
    case 'bunsen-burner': {
      const flame = FLAMES[p.collar as Collar];
      // A salt on the loop in the flame colours it (the kit says which), unless the flame is the yellow one.
      const kit = env.stateOf('flame-test-kit');
      const seen = kit && kit.p.held === 'flame' ? (kit.s.seen as string) : 'off';
      const tint = seen === 'mixed' ? FLAME_COLOUR.Na.hex : seen in FLAME_COLOUR ? FLAME_COLOUR[seen as Salt].hex : flame.colour;
      return [
        ['turn:COLLAR', { closed: 0, half: 45, open: 90 }[p.collar as Collar]],
        ['turn:TAP', p.gasOn ? 0 : 90],
        ['flame:BURNER', p.lit ? 1 : 0],
        ['tint:FLAME', tint],
        ['height:FLAME', flame.heightMm],
      ];
    }
    case 'bench-power-supply':
      return [
        ['turn:VSET', -150 + 10 * (p.vSet as number)],
        ['turn:ISET', -150 + 60 * (p.iSet as number)],
        ['led:CV', report.mode === 'CV' ? 1 : 0],
        ['led:CC', report.mode === 'CC' ? 1 : 0],
        ['press:POWER', p.on ? -12 : 12],
        ['text:VOUT', p.on ? fmt(report.vOut as number, 2) : '----'],
        ['text:IOUT', p.on ? fmt(report.iOut as number, 3) : '----'],
        ['text:SET', `${fmt(p.vSet as number, 1)} V  ${fmt(p.iSet as number, 1)} A`],
        ['load:LOAD', `${p.load}${report.loadHot ? ':hot' : ''}`],
      ];
    case 'soldering-station':
      return [
        ['turn:DIAL', -135 + 0.9642857142857143 * ((p.tempSet as number) - 200)],
        ['led:POWER', p.on ? 1 : 0],
        ['led:HEAT', report.heating ? 1 : 0],
        ['pose:IRON', p.inHolder ? 0 : 1],
        ['text:TIP', `${report.tipC} °C`],
        ['tint:SPONGE', p.sponge === 'dry' ? '#e9d48a' : '#c9a83a'],
      ];
    case 'pendulum-stand':
      return [
        ['length:STRING', p.length as number],
        ['text:READ', `L ${p.length} mm  θ ${p.amplitude}°  n ${report.swings}`],
      ];
    case 'beaker-250':
      return [['tint:LIQUID', LIQUID_COLOUR[p.liquid as Liquid] ?? LIQUID_COLOUR.water], ['led:HEAT', p.heat ? 1 : 0], ['text:TEMP', `${report.tempC} °C`]];
    case 'erlenmeyer-250':
      return [['tint:LIQUID', LIQUID_COLOUR[p.liquid as Liquid] ?? LIQUID_COLOUR.water]];
    case 'flame-test-kit': {
      const seen = st.s.seen as string;
      const inFlame = p.held === 'flame' && seen !== 'off';
      return [['tint:LOOP', inFlame ? (seen === 'mixed' ? FLAME_COLOUR.Na.hex : seen in FLAME_COLOUR ? FLAME_COLOUR[seen as Salt].hex : '#ff7a2a') : '#8a8f94']];
    }
    case 'ph-meter':
      return [
        ['led:POWER', p.on ? 1 : 0],
        ['text:PH', !p.on ? '' : report.reading === null ? '--.-' : `pH ${fmt(report.reading as number, 1)}`],
        ['text:CAL', p.on ? (report.calibrated ? 'CAL ✓' : 'CAL ?') : ''],
      ];
    case 'function-generator':
      return [
        ['led:OUT', p.on ? 1 : 0],
        ['text:DISPLAY', p.mystery ? `${p.wave}  ???` : `${p.wave}  ${hz(p.freq as number)}  ${fmt(p.amp as number, 1)} Vpp`],
      ];
    case 'oscilloscope': {
      const t = traceOf(st, env);
      const g = env.stateOf('function-generator');
      const head = `${perDiv(p.timeDiv as number)}/div  ${fmt(p.voltsDiv as number, p.voltsDiv as number < 1 ? 1 : 0)} V/div`;
      const meas = report.measured ? `Vpp ${fmt(report.mVpp as number, 2)}  f ${(report.mF as number) > 0 ? hz(report.mF as number) : '?'}` : '';
      return [
        ['led:POWER', p.on ? 1 : 0],
        // The screen redraws from this key only when it changes.
        ['screen:TRACE', p.on ? [t.present ? 1 : 0, t.periods.toFixed(3), t.divs.toFixed(3), t.wave, head, meas].join('|') : 'off'],
        ['probe:LINK', p.probe && g ? 1 : 0],
      ];
    }
    default:
      return [];
  }
}

/** Every frame: what moves on its own. `set` must not allocate. */
export function liveChannels(kind: string, st: Readonly<ItemState>, set: (channel: string, value: number) => void): void {
  switch (kind) {
    case 'pendulum-stand':
      set('swing:BOB', angleAt(st.p, st.s.swingT as number));
      break;
    case 'beaker-250':
      set('level:LIQUID', levelMm(BEAKER_LEVEL, st.s.vol as number));
      break;
    case 'erlenmeyer-250':
      set('level:LIQUID', levelMm(FLASK_LEVEL, st.s.vol as number));
      set('swirl:FLASK', st.s.swirlT as number);
      break;
    default:
      break;
  }
}
