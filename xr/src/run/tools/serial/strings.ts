/**
 * The serial panel's words in six languages. The title is iynk's own (`instruments.json`, "Serial monitor"), so the
 * headset and the 2D Studio say the same; the rest is new here and short, because it sits on 40 mm keys.
 */
import en from '@/i18n/messages/en/instruments.json';
import de from '@/i18n/messages/de/instruments.json';
import es from '@/i18n/messages/es/instruments.json';
import fr from '@/i18n/messages/fr/instruments.json';
import hi from '@/i18n/messages/hi/instruments.json';
import zh from '@/i18n/messages/zh/instruments.json';
import { defineStrings } from '../../kit/strings';

export const serialStrings = defineStrings({
  en: {
    title: en.kind.serialMonitor,
    plate: 'Serial',
    send: 'Send',
    clear: 'Clear',
    newest: 'Newest',
    empty: 'No output yet',
    older: '{n} newer lines below',
  },
  de: {
    title: de.kind.serialMonitor,
    plate: 'Seriell',
    send: 'Senden',
    clear: 'Leeren',
    newest: 'Neueste',
    empty: 'Noch keine Ausgabe',
    older: '{n} neuere Zeilen unten',
  },
  es: {
    title: es.kind.serialMonitor,
    plate: 'Serie',
    send: 'Enviar',
    clear: 'Borrar',
    newest: 'Último',
    empty: 'Aún sin salida',
    older: '{n} líneas más nuevas abajo',
  },
  fr: {
    title: fr.kind.serialMonitor,
    plate: 'Série',
    send: 'Envoyer',
    clear: 'Effacer',
    newest: 'Dernier',
    empty: 'Aucune sortie',
    older: '{n} lignes plus récentes en bas',
  },
  hi: {
    title: hi.kind.serialMonitor,
    plate: 'सीरियल',
    send: 'भेजें',
    clear: 'साफ़',
    newest: 'नवीनतम',
    empty: 'अभी कोई आउटपुट नहीं',
    older: 'नीचे {n} नई पंक्तियाँ',
  },
  zh: {
    title: zh.kind.serialMonitor,
    plate: '串口',
    send: '发送',
    clear: '清除',
    newest: '最新',
    empty: '暂无输出',
    older: '下方还有 {n} 行新内容',
  },
});
