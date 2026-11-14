import type { Element } from './types.ts';

export interface ElementLayerContract {
  element: Element['kind'];
  // descriptor terminal name -> the node field of the element it feeds
  terminals: Readonly<Record<string, string>>;
  // descriptor param key -> the element field it sets, as a dotted path
  params: Readonly<Record<string, string>>;
}

// How a part descriptor's `element` layer maps onto the elements the solver takes. These are the layer kinds the
// component schema added for the analog work; a solver that has no stamp for the element reports the part as not
// modelled yet, so naming one is safe before the solver lands.
export const ANALOG_LAYERS = {
  capacitor: {
    element: 'C',
    terminals: { a: 'a', b: 'b' },
    params: { farads: 'farads', esr_ohms: 'esrOhms', v0_volts: 'v0', polarized: 'polarized', rated_volts: 'ratedVolts' },
  },
  inductor: {
    element: 'L',
    terminals: { a: 'a', b: 'b' },
    params: { henries: 'henries', dcr_ohms: 'dcrOhms', i0_amps: 'i0', rated_amps: 'ratedAmps' },
  },
  waveform_source: {
    element: 'VW',
    terminals: { pos: 'a', neg: 'b' },
    params: {
      shape: 'shape', amplitude_v: 'amplitudeV', offset_v: 'offsetV', hz: 'hz', duty: 'duty', phase_deg: 'phaseDeg',
      r_series_ohms: 'rSeriesOhms', limit_amps: 'limit.amps',
    },
  },
  zener: {
    element: 'D',
    terminals: { anode: 'a', cathode: 'b' },
    params: {
      vz_volts: 'junction.vbrVolts', is_amps: 'junction.isAmps', n: 'junction.n', rs_ohms: 'junction.rzOhms',
      imax_amps: 'maxAmps', pmax_watts: 'rating.pmaxWatts',
    },
  },
  opamp: {
    element: 'OA',
    terminals: { inp: 'inP', inn: 'inN', out: 'out', vcc: 'vcc', vee: 'vee' },
    params: {
      open_loop_gain: 'openLoopGain', gbw_hz: 'gbwHz', slew_v_per_us: 'slewVPerUs', r_out_ohms: 'rOutOhms', headroom_volts: 'headroomVolts', headroom_low_volts: 'headroomLowVolts',
      supply_max_volts: 'rating.vabsVolts', output_max_amps: 'rating.icmaxAmps',
    },
  },
  timer_555: {
    element: 'TMR',
    terminals: { gnd: 'gnd', trig: 'trig', out: 'out', reset: 'reset', ctrl: 'ctrl', thr: 'thr', dis: 'dis', vcc: 'vcc' },
    params: {
      r_out_ohms: 'rOutOhms', high_drop_volts: 'highDropVolts', dis_on_ohms: 'disOnOhms', quiescent_amps: 'quiescentAmps',
      supply_max_volts: 'rating.vabsVolts', output_max_amps: 'rating.icmaxAmps',
    },
  },
} as const satisfies Record<string, ElementLayerContract>;
