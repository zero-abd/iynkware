/** The library's strings: default titles and the notices it raises. Six languages; see `../copy.ts`. */
import { LANGS, type LocalizedText } from '../../contracts/common';
import { defineCopy, say } from '../copy';

export const LIBRARY = defineCopy({
  en: {
    untitled: 'Untitled project',
    copyOf: '{title} copy',
    shared: '{title} (shared)',
    savedNew: 'Saved as a new project',
    full: 'Storage is full. Your latest changes are not saved.',
    exportProject: 'Export project',
    unavailable: 'Saving is not available here. Your work is kept only for this session.',
    badLink: 'That link could not be opened.',
  },
  de: {
    untitled: 'Unbenanntes Projekt',
    copyOf: '{title} Kopie',
    shared: '{title} (geteilt)',
    savedNew: 'Als neues Projekt gespeichert',
    full: 'Der Speicher ist voll. Deine letzten Änderungen sind nicht gespeichert.',
    exportProject: 'Projekt exportieren',
    unavailable: 'Speichern ist hier nicht möglich. Deine Arbeit bleibt nur für diese Sitzung erhalten.',
    badLink: 'Dieser Link konnte nicht geöffnet werden.',
  },
  es: {
    untitled: 'Proyecto sin título',
    copyOf: '{title} copia',
    shared: '{title} (compartido)',
    savedNew: 'Guardado como proyecto nuevo',
    full: 'El almacenamiento está lleno. Tus últimos cambios no se han guardado.',
    exportProject: 'Exportar proyecto',
    unavailable: 'Aquí no se puede guardar. Tu trabajo solo se conserva durante esta sesión.',
    badLink: 'No se pudo abrir ese enlace.',
  },
  fr: {
    untitled: 'Projet sans titre',
    copyOf: '{title} copie',
    shared: '{title} (partagé)',
    savedNew: 'Enregistré comme nouveau projet',
    full: "Le stockage est plein. Tes derniers changements ne sont pas enregistrés.",
    exportProject: 'Exporter le projet',
    unavailable: "L'enregistrement n'est pas possible ici. Ton travail n'est conservé que pour cette session.",
    badLink: "Ce lien n'a pas pu être ouvert.",
  },
  hi: {
    untitled: 'बिना नाम का प्रोजेक्ट',
    copyOf: '{title} की कॉपी',
    shared: '{title} (साझा)',
    savedNew: 'नए प्रोजेक्ट के रूप में सहेजा गया',
    full: 'स्टोरेज भर गया है। आपके नवीनतम बदलाव सहेजे नहीं गए हैं।',
    exportProject: 'प्रोजेक्ट निर्यात करें',
    unavailable: 'यहाँ सहेजना संभव नहीं है। आपका काम केवल इस सत्र के लिए रखा गया है।',
    badLink: 'वह लिंक खोला नहीं जा सका।',
  },
  zh: {
    untitled: '未命名项目',
    copyOf: '{title} 副本',
    shared: '{title}(共享)',
    savedNew: '已另存为新项目',
    full: '存储空间已满,最新的更改未保存。',
    exportProject: '导出项目',
    unavailable: '此处无法保存,你的作品只在本次会话中保留。',
    badLink: '无法打开该链接。',
  },
});

export type LibraryKey = keyof (typeof LIBRARY)['en'];

/** The text in every language, for a notice. */
export const textOf = (key: LibraryKey): LocalizedText => Object.fromEntries(LANGS.map((l) => [l, say(LIBRARY, l, key)]));
