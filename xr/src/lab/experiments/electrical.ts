/**
 * Electrical: Ohm's law. A bench supply drives a resistor whose value the seed hides; the person sets a current limit
 * and a voltage, reads V and I twice, works out R = V / I, then sees the supply go into constant current (CC) when the
 * limit is below what the load wants.
 */
import { fill, l6, same } from '../text';
import { NOTES } from '../model/catalogue';
import { UNKNOWN_OHMS } from '../model/items/electrical';
import type { Experiment, ExpCtx } from './types';

const ohmsOf = (c: ExpCtx) => (c.item('bench-power-supply')?.state.s.ohms as number | undefined) ?? 0;
const rep = (c: ExpCtx) => c.item('bench-power-supply')?.report ?? {};
const p = (c: ExpCtx) => c.item('bench-power-supply')?.state.p ?? {};
const ratio = (v: unknown, i: unknown) => (typeof v === 'number' && typeof i === 'number' && i > 0 ? v / i : 0);

export const OHMS_LAW: Experiment = {
  id: 'electrical/ohms-law',
  lab: 'electrical',
  title: l6('Ohm’s law', 'Ohmsches Gesetz', 'Ley de Ohm', 'Loi d’Ohm', 'ओम का नियम', '欧姆定律'),
  goal: l6(
    'Find the value of an unknown resistor from the voltage across it and the current through it, R = V / I.',
    'Bestimme den Wert eines unbekannten Widerstands aus der Spannung daran und dem Strom hindurch, R = U / I.',
    'Halla el valor de una resistencia desconocida a partir de la tensión en ella y la corriente que la atraviesa, R = V / I.',
    'Trouve la valeur d’une résistance inconnue à partir de la tension à ses bornes et du courant qui la traverse, R = U / I.',
    'एक अज्ञात रेज़िस्टर का मान उसके आर-पार वोल्टेज और उसमें बहते करंट से निकालो, R = V / I।',
    '根据电阻两端的电压和流过它的电流求出未知电阻的阻值，R = V / I。',
  ),
  kit: [{ kind: 'bench-power-supply', x: -40, z: -70, params: { load: 'unknown', vSet: 0, iSet: 0.1, on: false } }],
  steps: [
    {
      id: 'limit',
      focus: 'bench-power-supply',
      text: l6(
        'With the output off, set the current limit to 0.5 A.',
        'Stell bei ausgeschaltetem Ausgang die Strombegrenzung auf 0,5 A.',
        'Con la salida apagada, pon el límite de corriente en 0,5 A.',
        'Sortie coupée, règle la limite de courant sur 0,5 A.',
        'आउटपुट बंद रखते हुए करंट सीमा 0.5 A पर सेट करो।',
        '在输出关闭时，把限流设为 0.5 A。',
      ),
      hint: l6('The right knob is the current limit: press its right half to step it up.', 'Der rechte Knopf ist die Strombegrenzung: Drück seine rechte Hälfte, um eine Stufe höher zu gehen.', 'El mando derecho es el límite de corriente: pulsa su mitad derecha para subirlo un paso.', 'Le bouton de droite est la limite de courant : appuie sur sa moitié droite pour monter d’un cran.', 'दायाँ नॉब करंट सीमा है: एक कदम बढ़ाने के लिए उसका दायाँ आधा दबाओ।', '右边的旋钮是限流：按它的右半边升一档。'),
      done: (c) => p(c).iSet === 0.5,
    },
    {
      id: 'voltage',
      focus: 'bench-power-supply',
      text: l6('Set the voltage to 5 V.', 'Stell die Spannung auf 5 V.', 'Pon la tensión en 5 V.', 'Règle la tension sur 5 V.', 'वोल्टेज 5 V पर सेट करो।', '把电压设为 5 V。'),
      hint: l6('The left knob is the voltage.', 'Der linke Knopf ist die Spannung.', 'El mando izquierdo es la tensión.', 'Le bouton de gauche est la tension.', 'बायाँ नॉब वोल्टेज है।', '左边的旋钮是电压。'),
      done: (c) => p(c).vSet === 5,
    },
    {
      id: 'on',
      focus: 'bench-power-supply',
      text: l6('Turn the output on. The green CV lamp means it holds your voltage.', 'Schalte den Ausgang ein. Die grüne CV-Lampe heißt: Es hält deine Spannung.', 'Enciende la salida. La luz verde CV indica que mantiene tu tensión.', 'Active la sortie. Le voyant vert CV signifie qu’elle tient ta tension.', 'आउटपुट चालू करो। हरा CV लैंप बताता है कि यह तुम्हारा वोल्टेज बनाए रखता है।', '打开输出。绿色 CV 灯表示它保持你设定的电压。'),
      hint: l6('The power switch is at the bottom left of the front panel.', 'Der Schalter sitzt unten links auf der Frontplatte.', 'El interruptor está abajo a la izquierda del panel frontal.', 'L’interrupteur est en bas à gauche de la face avant.', 'पावर स्विच सामने के पैनल पर नीचे बाईं ओर है।', '电源开关在前面板左下角。'),
      done: (c) => p(c).on === true,
    },
    {
      id: 'read1',
      focus: 'bench-power-supply',
      text: l6('Read the volts and the amps, then press Record.', 'Lies Volt und Ampere ab und drück dann auf Notieren.', 'Lee los voltios y los amperios y pulsa Anotar.', 'Lis les volts et les ampères, puis appuie sur Noter.', 'वोल्ट और एम्पियर पढ़ो, फिर रिकॉर्ड दबाओ।', '读出电压和电流，然后按“记录”。'),
      hint: l6('Record is the button under the two displays.', 'Notieren ist die Taste unter den beiden Anzeigen.', 'Anotar es el botón bajo las dos pantallas.', 'Noter est le bouton sous les deux afficheurs.', 'रिकॉर्ड दोनों डिस्प्ले के नीचे वाला बटन है।', '“记录”是两个显示屏下方的按钮。'),
      done: (c) => (rep(c).readings as number) >= 1,
    },
    {
      id: 'read2',
      focus: 'bench-power-supply',
      text: l6('Set another voltage (try 9 V) and record a second reading.', 'Stell eine andere Spannung ein (etwa 9 V) und notiere einen zweiten Wert.', 'Pon otra tensión (prueba 9 V) y anota una segunda lectura.', 'Règle une autre tension (essaie 9 V) et note une deuxième mesure.', 'दूसरा वोल्टेज सेट करो (9 V आज़माओ) और दूसरी रीडिंग रिकॉर्ड करो।', '换一个电压（试试 9 V），再记录一次读数。'),
      hint: l6('If the red CC lamp lights, the limit holds the current: R = V / I still works.', 'Leuchtet die rote CC-Lampe, hält die Begrenzung den Strom: R = U / I gilt trotzdem.', 'Si se enciende la luz roja CC, el límite fija la corriente: R = V / I sigue valiendo.', 'Si le voyant rouge CC s’allume, la limite tient le courant : R = U / I reste vrai.', 'अगर लाल CC लैंप जले, तो सीमा करंट को थामे है: R = V / I फिर भी सही है।', '如果红色 CC 灯亮了，说明限流在起作用：R = V / I 依然成立。'),
      done: (c) => (rep(c).readings as number) >= 2,
    },
    {
      id: 'answer',
      text: l6('Work out R = V / I. Which resistor is it?', 'Rechne R = U / I. Welcher Widerstand ist es?', 'Calcula R = V / I. ¿Qué resistencia es?', 'Calcule R = U / I. Quelle résistance est-ce ?', 'R = V / I निकालो। यह कौन-सा रेज़िस्टर है?', '算出 R = V / I。是哪个电阻？'),
      hint: l6('Divide the volts by the amps of either reading.', 'Teile bei einer der Messungen die Volt durch die Ampere.', 'Divide los voltios entre los amperios de cualquiera de las lecturas.', 'Divise les volts par les ampères de l’une des mesures.', 'किसी भी रीडिंग के वोल्ट को एम्पियर से भाग दो।', '用任一次读数的电压除以电流。'),
      ask: { key: 'ohms', choices: UNKNOWN_OHMS.map((r) => ({ value: r, label: same(`${r} Ω`) })), correct: ohmsOf },
      done: (c) => c.answer('ohms') !== undefined,
    },
    {
      id: 'cc',
      focus: 'bench-power-supply',
      text: l6(
        'Turn the current limit down to 0.1 A, then the voltage up to 30 V, and watch the red CC lamp: the supply now holds the current and lowers the voltage.',
        'Dreh die Strombegrenzung auf 0,1 A herunter, dann die Spannung auf 30 V hoch, und beobachte die rote CC-Lampe: Das Gerät hält jetzt den Strom und senkt die Spannung.',
        'Baja el límite de corriente a 0,1 A, sube luego la tensión a 30 V y mira la luz roja CC: la fuente ahora mantiene la corriente y baja la tensión.',
        'Baisse la limite de courant à 0,1 A, monte ensuite la tension à 30 V et regarde le voyant rouge CC : l’alimentation tient maintenant le courant et baisse la tension.',
        'करंट सीमा 0.1 A तक घटाओ, फिर वोल्टेज 30 V तक बढ़ाओ और लाल CC लैंप देखो: सप्लाई अब करंट थामे रखती है और वोल्टेज घटा देती है।',
        '先把限流调到 0.1 A，再把电压调到 30 V，看红色 CC 灯：电源此时保持电流并降低电压。',
      ),
      hint: l6('The left half of a knob turns it down, the right half up.', 'Die linke Hälfte eines Knopfs dreht herunter, die rechte hoch.', 'La mitad izquierda de un mando lo baja y la derecha lo sube.', 'La moitié gauche d’un bouton baisse, la moitié droite monte.', 'नॉब का बायाँ आधा घटाता है, दायाँ आधा बढ़ाता है।', '旋钮左半边调低，右半边调高。'),
      done: (c) => rep(c).mode === 'CC',
    },
    {
      id: 'off',
      focus: 'bench-power-supply',
      text: l6('Turn the output off.', 'Schalte den Ausgang aus.', 'Apaga la salida.', 'Coupe la sortie.', 'आउटपुट बंद करो।', '关掉输出。'),
      hint: l6('Press the power switch again.', 'Drück noch einmal auf den Schalter.', 'Pulsa otra vez el interruptor.', 'Appuie encore sur l’interrupteur.', 'पावर स्विच फिर दबाओ।', '再按一次电源开关。'),
      done: (c) => p(c).on === false,
    },
  ],
  checks: [
    {
      id: 'resistance',
      label: l6('Found the right resistance', 'Den richtigen Widerstand gefunden', 'Resistencia correcta', 'Bonne résistance', 'सही प्रतिरोध निकाला', '求出的阻值正确'),
      pass: (c) => c.answer('ohms') === ohmsOf(c),
      detail: (c) => fill(l6('You said {given} Ω; it is {truth} Ω.', 'Deine Antwort: {given} Ω; richtig ist {truth} Ω.', 'Dijiste {given} Ω; es de {truth} Ω.', 'Tu as dit {given} Ω ; c’est {truth} Ω.', 'तुमने {given} Ω कहा; यह {truth} Ω है।', '你的答案是 {given} Ω；实际是 {truth} Ω。'), { given: String(c.answer('ohms') ?? '—'), truth: ohmsOf(c) }),
    },
    {
      id: 'two-readings',
      label: l6('Two readings that agree', 'Zwei übereinstimmende Messungen', 'Dos lecturas que coinciden', 'Deux mesures concordantes', 'दो मेल खाती रीडिंग', '两次读数一致'),
      pass: (c) => {
        const r = rep(c);
        const a = ratio(r.r1V, r.r1I);
        const b = ratio(r.r2V, r.r2I);
        return a > 0 && b > 0 && r.r1V !== r.r2V && Math.abs(a - b) / a < 0.03;
      },
      detail: (c) => {
        const r = rep(c);
        return fill(l6('R₁ = {a} Ω, R₂ = {b} Ω', 'R₁ = {a} Ω, R₂ = {b} Ω', 'R₁ = {a} Ω, R₂ = {b} Ω', 'R₁ = {a} Ω, R₂ = {b} Ω', 'R₁ = {a} Ω, R₂ = {b} Ω', 'R₁ = {a} Ω，R₂ = {b} Ω'), { a: ratio(r.r1V, r.r1I).toFixed(1), b: ratio(r.r2V, r.r2I).toFixed(1) });
      },
    },
    {
      id: 'saw-cc',
      label: l6('Saw the supply go into CC', 'CC-Betrieb gesehen', 'Vio la fuente pasar a CC', 'A vu l’alimentation passer en CC', 'सप्लाई को CC में जाते देखा', '看到电源进入 CC 模式'),
      pass: (c) => rep(c).sawCC === true,
    },
    {
      id: 'safe',
      label: l6('Nothing overloaded', 'Nichts überlastet', 'Nada sobrecargado', 'Rien de surchargé', 'कुछ भी ओवरलोड नहीं हुआ', '没有过载'),
      pass: (c) => !c.ever('resistor-overload') && !c.ever('short-high-limit') && !c.ever('limit-at-max'),
    },
    {
      id: 'off',
      label: l6('Output off at the end', 'Ausgang am Ende aus', 'Salida apagada al final', 'Sortie coupée à la fin', 'अंत में आउटपुट बंद', '结束时关掉了输出'),
      pass: (c) => p(c).on === false,
    },
  ],
  hazards: NOTES['bench-power-supply']!.hazards.slice(0, 2),
};
