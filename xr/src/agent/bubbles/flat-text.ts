/** Strings for the flat-screen conversation card (flat.ts), in all six languages. */
import { l6 } from '../../lab/text';

export const FLAT_TEXT = {
  title: l6('Companion', 'Begleiter', 'Compañero', 'Compagnon', 'साथी', '助手'),
  empty: l6(
    'Ask anything below, or enable voice and hold Talk.',
    'Frag unten etwas oder aktiviere Sprache und halte Sprechen.',
    'Pregunta algo abajo, o activa la voz y mantén Hablar.',
    'Pose une question ci-dessous, ou active la voix et maintiens Parler.',
    'नीचे कुछ भी पूछें, या वॉइस चालू करके बोलें दबाए रखें।',
    '在下方提问，或启用语音并按住说话。',
  ),
  placeholder: l6('Type a question…', 'Frage eingeben…', 'Escribe una pregunta…', 'Écris une question…', 'प्रश्न लिखें…', '输入问题…'),
  send: l6('Send', 'Senden', 'Enviar', 'Envoyer', 'भेजें', '发送'),
  hide: l6('Hide conversation', 'Gespräch ausblenden', 'Ocultar conversación', 'Masquer la conversation', 'बातचीत छिपाएँ', '隐藏对话'),
  show: l6('Show conversation', 'Gespräch anzeigen', 'Mostrar conversación', 'Afficher la conversation', 'बातचीत दिखाएँ', '显示对话'),
  state: {
    connecting: l6('connecting', 'verbindet', 'conectando', 'connexion', 'जुड़ रहा है', '连接中'),
    listening: l6('listening', 'hört zu', 'escuchando', 'écoute', 'सुन रहा है', '聆听中'),
    thinking: l6('thinking', 'denkt nach', 'pensando', 'réfléchit', 'सोच रहा है', '思考中'),
    speaking: l6('speaking', 'spricht', 'hablando', 'parle', 'बोल रहा है', '说话中'),
    idle: l6('ready', 'bereit', 'listo', 'prêt', 'तैयार', '就绪'),
  },
} as const;
