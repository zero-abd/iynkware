/** The tutor's own words, in six languages. */
import { l6 } from '../text';

export const TUTOR = {
  stepDone: l6('Good, that is done.', 'Gut, das ist erledigt.', 'Bien, hecho.', 'Bien, c’est fait.', 'बढ़िया, यह हो गया।', '很好，这一步完成了。'),
  finished: l6('Experiment complete. Score: {score}.', 'Versuch abgeschlossen. Punkte: {score}.', 'Experimento terminado. Puntuación: {score}.', 'Expérience terminée. Score : {score}.', 'प्रयोग पूरा हुआ। अंक: {score}।', '实验完成。得分：{score}。'),
  examFinished: l6('Exam finished. Score: {score}.', 'Prüfung beendet. Punkte: {score}.', 'Examen terminado. Puntuación: {score}.', 'Examen terminé. Score : {score}.', 'परीक्षा ख़त्म। अंक: {score}।', '考试结束。得分：{score}。'),
  safeNow: l6('Good, that is safe now.', 'Gut, jetzt ist es sicher.', 'Bien, ahora es seguro.', 'Bien, c’est sans danger maintenant.', 'बढ़िया, अब यह सुरक्षित है।', '很好，现在安全了。'),
  stillThere: l6('Still not fixed: {say}', 'Immer noch nicht behoben: {say}', 'Sigue sin arreglarse: {say}', 'Toujours pas réglé : {say}', 'अब भी ठीक नहीं हुआ: {say}', '仍未解决：{say}'),
  examStart: l6('Exam: no hints and no tutor until you finish. Safety warnings still show.', 'Prüfung: keine Hinweise und kein Tutor bis zum Ende. Sicherheitswarnungen erscheinen trotzdem.', 'Examen: sin pistas ni tutor hasta que termines. Los avisos de seguridad siguen apareciendo.', 'Examen : ni indices ni tuteur jusqu’à la fin. Les alertes de sécurité restent affichées.', 'परीक्षा: ख़त्म होने तक कोई संकेत या ट्यूटर नहीं। सुरक्षा चेतावनियाँ फिर भी दिखेंगी।', '考试：完成前没有提示，也没有辅导。安全警告仍会显示。'),
  placeholder: l6(
    'I do not have a {name} model yet, so here is a stand-in.',
    'Ich habe noch kein Modell von {name}, hier ist ein Platzhalter.',
    'Aún no tengo un modelo de {name}; aquí tienes uno provisional.',
    'Je n’ai pas encore de modèle de {name} ; voici un objet provisoire.',
    'मेरे पास अभी {name} का मॉडल नहीं है, इसलिए यह एक अस्थायी वस्तु है।',
    '我还没有{name}的模型，先用一个替代物。',
  ),
} as const;
