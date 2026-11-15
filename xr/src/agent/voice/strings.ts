/**
 * Voice strings in six languages. The consent and disclosure are the voice demo's (deploy/cloudflare-xr/voice/demo.js),
 * shown before the microphone starts.
 */
import { l6 } from '../../lab/text';

export const VOICE_TEXT = {
  menu: l6('Voice', 'Sprache', 'Voz', 'Voix', 'वॉइस', '语音'),
  coachMenu: l6('Voice tips', 'Sprachtipps', 'Consejos por voz', 'Conseils vocaux', 'वॉइस सुझाव', '语音提示'),
  title: l6('Gemini voice guide', 'Gemini-Sprachhilfe', 'Guía de voz Gemini', 'Guide vocal Gemini', 'Gemini वॉइस गाइड', 'Gemini 语音向导'),
  disclosure: l6(
    'Adult hackathon prototype. While you hold Talk, microphone audio goes directly to Google Gemini. iynkware does not intentionally store audio, transcripts, or conversation history.',
    'Hackathon-Prototyp nur für Erwachsene. Beim Halten von Sprechen wird Mikrofon-Audio direkt an Google Gemini gesendet. iynkware speichert es nicht absichtlich.',
    'Prototipo solo para adultos. Al mantener Hablar, el audio va directamente a Google Gemini. iynkware no lo almacena intencionalmente.',
    'Prototype réservé aux adultes. En maintenant Parler, le son va directement à Google Gemini. iynkware ne le stocke pas volontairement.',
    'केवल वयस्कों के लिए प्रोटोटाइप। दबाने पर ऑडियो सीधे Google Gemini को जाता है। iynkware इसे जानबूझकर संग्रहीत नहीं करता।',
    '仅限成人的原型。按住说话时，音频会直接发送给 Google Gemini。iynkware 不会有意存储。',
  ),
  consent: l6(
    'I am 18 or older and agree to send microphone audio to Google for this demo.',
    'Ich bin mindestens 18 Jahre alt und stimme dem Senden meines Mikrofon-Audios an Google zu.',
    'Tengo al menos 18 años y acepto enviar mi audio a Google.',
    'J’ai au moins 18 ans et j’accepte d’envoyer mon son à Google.',
    'मेरी आयु 18 वर्ष या अधिक है और मैं ऑडियो भेजने की सहमति देता/देती हूँ।',
    '我已年满 18 岁，并同意将麦克风音频发送给 Google。',
  ),
  enable: l6('Enable voice', 'Sprache aktivieren', 'Activar voz', 'Activer la voix', 'वॉइस चालू करें', '启用语音'),
  disable: l6('Disable voice', 'Sprache deaktivieren', 'Desactivar voz', 'Désactiver la voix', 'वॉइस बंद करें', '停用语音'),
  talk: l6('Hold to talk', 'Zum Sprechen halten', 'Mantén para hablar', 'Maintenir pour parler', 'बोलने के लिए दबाएँ', '按住说话'),
  cancel: l6('Cancel', 'Abbrechen', 'Cancelar', 'Annuler', 'रद्द करें', '取消'),
  status: {
    off: l6('Voice is off.', 'Sprache ist aus.', 'La voz está apagada.', 'La voix est désactivée.', 'वॉइस बंद है।', '语音已关闭。'),
    starting: l6('Waiting for microphone permission…', 'Warte auf Mikrofonberechtigung…', 'Esperando permiso del micrófono…', 'En attente de l’autorisation du microphone…', 'माइक्रोफ़ोन अनुमति की प्रतीक्षा…', '正在等待麦克风权限…'),
    connecting: l6('Connecting…', 'Verbindung…', 'Conectando…', 'Connexion…', 'जुड़ रहा है…', '正在连接…'),
    ready: l6(
      'Voice on. Hold the right thumbstick to talk.',
      'Sprache an. Halte den rechten Stick gedrückt, um zu sprechen.',
      'Voz activada. Mantén pulsado el joystick derecho para hablar.',
      'Voix activée. Maintiens le joystick droit enfoncé pour parler.',
      'वॉइस चालू। बोलने के लिए दायाँ थंबस्टिक दबाए रखें।',
      '语音已开启。按住右摇杆说话。',
    ),
    micMuted: l6('Microphone muted by the system.', 'Mikrofon vom System stummgeschaltet.', 'Micrófono silenciado por el sistema.', 'Micro coupé par le système.', 'सिस्टम ने माइक्रोफ़ोन म्यूट किया है।', '麦克风被系统静音。'),
    micEnded: l6('Microphone stopped: select Voice again.', 'Mikrofon gestoppt: Wähle erneut Sprache.', 'Micrófono detenido: elige Voz otra vez.', 'Micro arrêté : choisis à nouveau Voix.', 'माइक्रोफ़ोन बंद हुआ: फिर से वॉइस चुनें।', '麦克风已停止：请再次选择语音。'),
    suspended: l6('Audio suspended: select Voice again.', 'Audio angehalten: Wähle erneut Sprache.', 'Audio en pausa: elige Voz otra vez.', 'Audio suspendu : choisis à nouveau Voix.', 'ऑडियो रुका है: फिर से वॉइस चुनें।', '音频已暂停：请再次选择语音。'),
    blocked: l6(
      'Microphone access is blocked. Allow Microphone in this site’s Quest Browser permissions, reload, then enable voice again.',
      'Der Mikrofonzugriff ist blockiert. Erlaube das Mikrofon in den Website-Berechtigungen des Quest Browsers und lade neu.',
      'El acceso al micrófono está bloqueado. Permite el micrófono en los permisos del sitio de Quest Browser y recarga.',
      'L’accès au microphone est bloqué. Autorisez-le dans les permissions du site de Quest Browser, puis rechargez.',
      'माइक्रोफ़ोन अनुमति अवरुद्ध है। Quest Browser की साइट अनुमतियों में माइक्रोफ़ोन चालू करके पेज फिर लोड करें।',
      '麦克风权限被阻止。请在 Quest Browser 的网站权限中允许麦克风，然后重新加载。',
    ),
    quota: l6('Daily demo limit reached.', 'Tageslimit erreicht.', 'Límite diario alcanzado.', 'Limite quotidienne atteinte.', 'दैनिक सीमा पूरी हुई।', '已达到每日上限。'),
    failed: l6('Voice failed. Try again.', 'Sprachfehler. Erneut versuchen.', 'Error de voz. Inténtalo de nuevo.', 'Échec vocal. Réessayez.', 'वॉइस विफल। फिर प्रयास करें।', '语音失败。请重试。'),
    unavailable: l6('Voice is not set up on this server.', 'Sprache ist auf diesem Server nicht eingerichtet.', 'La voz no está configurada en este servidor.', 'La voix n’est pas configurée sur ce serveur.', 'इस सर्वर पर वॉइस सेट नहीं है।', '此服务器未配置语音。'),
  },
} as const;

export type VoiceStatusKey = keyof typeof VOICE_TEXT.status;
