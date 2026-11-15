/**
 * The scope's words in six languages. The title and Single are iynk's own (`instruments.json`), so the headset and the
 * 2D Studio say the same; the rest is new here and short, because it sits on 40 mm keys.
 */
import en from '@/i18n/messages/en/instruments.json';
import de from '@/i18n/messages/de/instruments.json';
import es from '@/i18n/messages/es/instruments.json';
import fr from '@/i18n/messages/fr/instruments.json';
import hi from '@/i18n/messages/hi/instruments.json';
import zh from '@/i18n/messages/zh/instruments.json';
import { defineStrings } from '../../kit/strings';

export const scopeStrings = defineStrings({
  en: {
    title: en.kind.oscilloscope,
    single: en.scope.modeSingle,
    time: 'Time',
    volts: 'Volts',
    perDiv: 'div',
    held: 'Held',
    free: 'Clip the probe on a pin',
    'not-loaded': 'Press Run',
    'no-net': 'Not wired',
    waiting: 'Waiting for samples',
  },
  de: {
    title: de.kind.oscilloscope,
    single: de.scope.modeSingle,
    time: 'Zeit',
    volts: 'Volt',
    perDiv: 'Teil.',
    held: 'Gehalten',
    free: 'Tastspitze an einen Pin klemmen',
    'not-loaded': 'Run drücken',
    'no-net': 'Nicht verdrahtet',
    waiting: 'Warte auf Messwerte',
  },
  es: {
    title: es.kind.oscilloscope,
    single: es.scope.modeSingle,
    time: 'Tiempo',
    volts: 'Voltios',
    perDiv: 'div.',
    held: 'Retenido',
    free: 'Conecta la punta a un pin',
    'not-loaded': 'Pulsa Run',
    'no-net': 'Sin cablear',
    waiting: 'Esperando muestras',
  },
  fr: {
    title: fr.kind.oscilloscope,
    single: fr.scope.modeSingle,
    time: 'Temps',
    volts: 'Volts',
    perDiv: 'div.',
    held: 'Figé',
    free: 'Pose la sonde sur une broche',
    'not-loaded': 'Appuie sur Run',
    'no-net': 'Non câblé',
    waiting: 'En attente de mesures',
  },
  hi: {
    title: hi.kind.oscilloscope,
    single: hi.scope.modeSingle,
    time: 'समय',
    volts: 'वोल्ट',
    perDiv: 'खाना',
    held: 'रुका',
    free: 'प्रोब को किसी पिन पर लगाएँ',
    'not-loaded': 'Run दबाएँ',
    'no-net': 'तार नहीं जुड़ा',
    waiting: 'नमूनों की प्रतीक्षा',
  },
  zh: {
    title: zh.kind.oscilloscope,
    single: zh.scope.modeSingle,
    time: '时间',
    volts: '电压',
    perDiv: '格',
    held: '已冻结',
    free: '把探头夹在引脚上',
    'not-loaded': '按 Run',
    'no-net': '未接线',
    waiting: '等待采样',
  },
});

export type ScopeReason = 'free' | 'not-loaded' | 'no-net';
