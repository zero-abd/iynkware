/**
 * The agent's fixed strings in six languages, written with the lab's `l6` (xr/src/lab/text.ts) so the same
 * `l6Problems` test walks them. What a brain or a model says is shown as given and is not here.
 */
import { l6, type L6 } from '../lab/text';

export const AGENT_TEXT = {
  name: l6('Assistant', 'Assistent', 'Asistente', 'Assistant', 'सहायक', '助手'),
  menu: l6('Ask the assistant', 'Den Assistenten fragen', 'Preguntar al asistente', 'Demander à l’assistant', 'सहायक से पूछो', '问助手'),
  you: l6('You', 'Du', 'Tú', 'Toi', 'आप', '你'),
  close: l6('Close', 'Schließen', 'Cerrar', 'Fermer', 'बंद करो', '关闭'),
  askTitle: l6('Ask me something', 'Frag mich etwas', 'Pregúntame algo', 'Pose-moi une question', 'मुझसे कुछ पूछो', '问我点什么'),
  state: {
    connecting: l6('Connecting', 'Verbinde', 'Conectando', 'Connexion', 'जुड़ रहा है', '正在连接'),
    listening: l6('Listening', 'Ich höre zu', 'Escuchando', 'J’écoute', 'सुन रहा हूँ', '正在听'),
    thinking: l6('Thinking', 'Ich denke nach', 'Pensando', 'Je réfléchis', 'सोच रहा हूँ', '正在想'),
    speaking: l6('Speaking', 'Ich spreche', 'Hablando', 'Je parle', 'बोल रहा हूँ', '正在说'),
    idle: l6('Ready', 'Bereit', 'Listo', 'Prêt', 'तैयार', '就绪'),
  },
  /** The canned questions on the Ask panel (the scripted brain answers them). */
  questions: [
    l6('What should I do next?', 'Was soll ich als Nächstes tun?', '¿Qué hago ahora?', 'Que dois-je faire ensuite ?', 'आगे क्या करूँ?', '下一步做什么？'),
    l6('Where is the resistor?', 'Wo ist der Widerstand?', '¿Dónde está la resistencia?', 'Où est la résistance ?', 'रेज़िस्टर कहाँ है?', '电阻在哪里？'),
    l6('Help me build Blink', 'Hilf mir, Blink zu bauen', 'Ayúdame a construir Blink', 'Aide-moi à construire Blink', 'Blink बनाने में मदद करो', '帮我搭建 Blink'),
    l6('Open the chemistry lab', 'Öffne das Chemielabor', 'Abre el laboratorio de química', 'Ouvre le labo de chimie', 'रसायन प्रयोगशाला खोलो', '打开化学实验室'),
    l6('Where is the burner?', 'Wo ist der Brenner?', '¿Dónde está el mechero?', 'Où est le bec ?', 'बर्नर कहाँ है?', '本生灯在哪里？'),
    l6('Start the flame test', 'Starte die Flammenfärbung', 'Empieza el ensayo a la llama', 'Commence le test de flamme', 'ज्वाला परीक्षण शुरू करो', '开始焰色反应'),
  ],
  /** The scripted brain's replies. */
  reply: {
    noModel: l6(
      'Without the voice model I can only answer a few questions. Try one of these.',
      'Ohne das Sprachmodell kann ich nur wenige Fragen beantworten. Probier eine davon.',
      'Sin el modelo de voz solo puedo responder unas pocas preguntas. Prueba una de estas.',
      'Sans le modèle vocal, je ne réponds qu’à quelques questions. Essaie l’une de celles-ci.',
      'वॉइस मॉडल के बिना मैं कुछ ही सवालों के जवाब दे सकता हूँ। इनमें से कोई आज़माओ।',
      '没有语音模型时我只能回答几个问题。试试这些。',
    ),
    next: l6('Next: {step}', 'Als Nächstes: {step}', 'Ahora: {step}', 'Ensuite : {step}', 'अगला: {step}', '下一步：{step}'),
    nothingNext: l6(
      'Nothing is running. Open a lab or a lesson and I can guide you.',
      'Gerade läuft nichts. Öffne ein Labor oder eine Lektion, dann führe ich dich.',
      'No hay nada en marcha. Abre un laboratorio o una lección y te guío.',
      'Rien n’est en cours. Ouvre un labo ou une leçon et je te guide.',
      'अभी कुछ नहीं चल रहा। कोई प्रयोगशाला या पाठ खोलो, मैं राह दिखाऊँगा।',
      '现在没有进行中的内容。打开一个实验室或课程，我来带你。',
    ),
    here: l6('Here it is.', 'Hier ist es.', 'Aquí está.', 'Le voici.', 'यह रहा।', '在这里。'),
    useThis: l6('This one', 'Dieses hier', 'Este', 'Celui-ci', 'यह वाला', '就是这个'),
    notHere: l6('I cannot see that here.', 'Das sehe ich hier nicht.', 'No lo veo aquí.', 'Je ne le vois pas ici.', 'मुझे यह यहाँ नहीं दिख रहा।', '我在这里看不到它。'),
    proposed: l6('First step: {label}. Say yes to do it.', 'Erster Schritt: {label}. Sag ja, dann mache ich es.', 'Primer paso: {label}. Di sí para hacerlo.', 'Première étape : {label}. Dis oui pour la faire.', 'पहला कदम: {label}। करने के लिए हाँ कहो।', '第一步：{label}。说“好”我就做。'),
    cannotBuild: l6('I could not start that build.', 'Diesen Aufbau konnte ich nicht starten.', 'No pude empezar ese montaje.', 'Je n’ai pas pu lancer ce montage.', 'मैं यह निर्माण शुरू नहीं कर सका।', '我没能开始这个搭建。'),
    did: l6('Done: {label}.', 'Erledigt: {label}.', 'Hecho: {label}.', 'Fait : {label}.', 'हो गया: {label}।', '完成：{label}。'),
    nothingWaiting: l6('No step is waiting.', 'Es wartet kein Schritt.', 'No hay ningún paso esperando.', 'Aucune étape n’attend.', 'कोई कदम इंतज़ार में नहीं है।', '没有待处理的步骤。'),
    skipped: l6('Skipped.', 'Übersprungen.', 'Saltado.', 'Passé.', 'छोड़ दिया।', '已跳过。'),
    undone: l6('Taken back.', 'Rückgängig gemacht.', 'Deshecho.', 'Annulé.', 'वापस ले लिया।', '已撤销。'),
    opened: l6('{lab} is open.', '{lab} ist offen.', '{lab} está abierto.', '{lab} est ouvert.', '{lab} खुल गई।', '{lab}已打开。'),
    started: l6('Started. {step}', 'Gestartet. {step}', 'Empezado. {step}', 'C’est parti. {step}', 'शुरू हो गया। {step}', '已开始。{step}'),
    examNoHints: l6('This is an exam: no hints. You can do it.', 'Das ist eine Prüfung: keine Tipps. Du schaffst das.', 'Esto es un examen: sin pistas. Tú puedes.', 'C’est un examen : pas d’indice. Tu vas y arriver.', 'यह परीक्षा है: कोई संकेत नहीं। तुम कर सकते हो।', '这是考试：没有提示。你能行。'),
    finding: l6('A problem was found here. Stop the run and check this part.', 'Hier wurde ein Problem gefunden. Halte den Lauf an und prüfe dieses Teil.', 'Se encontró un problema aquí. Detén la ejecución y revisa esta pieza.', 'Un problème a été trouvé ici. Arrête l’exécution et vérifie cette pièce.', 'यहाँ एक समस्या मिली। रन रोको और यह हिस्सा जाँचो।', '这里发现了问题。停止运行并检查这个零件。'),
  },
} as const;

export type AgentText = typeof AGENT_TEXT;
export type { L6 };
