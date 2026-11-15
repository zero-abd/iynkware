/**
 * Signals and systems: measure a waveform. The generator's frequency and amplitude are the teacher's (seeded, its
 * display hidden); the person sets the scope's timebase and volts per division until the wave is readable, measures,
 * and says its Vpp and f.
 */
import { fill, l6, same } from '../text';
import { NOTES } from '../model/catalogue';
import { MYSTERY_AMPS, MYSTERY_FREQS } from '../model/items/signals';
import type { Experiment, ExpCtx } from './types';

const gen = (c: ExpCtx) => c.item('function-generator')?.state.p ?? {};
const sc = (c: ExpCtx) => c.item('oscilloscope');
const hz = (f: number) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);

export const MEASURE_WAVE: Experiment = {
  id: 'signals/measure-wave',
  lab: 'signals',
  title: l6('Measure a waveform', 'Eine Signalform messen', 'Medir una forma de onda', 'Mesurer un signal', 'एक तरंग नापो', '测量波形'),
  goal: l6(
    'Show the generator’s signal on the scope so it is readable, then measure its peak-to-peak voltage and frequency.',
    'Bring das Signal des Generators gut ablesbar auf das Oszilloskop und miss Spitze-Spitze-Spannung und Frequenz.',
    'Muestra la señal del generador en el osciloscopio de forma legible y mide su tensión pico a pico y su frecuencia.',
    'Affiche le signal du générateur lisiblement sur l’oscilloscope, puis mesure sa tension crête à crête et sa fréquence.',
    'जनरेटर का सिग्नल स्कोप पर पढ़ने लायक दिखाओ, फिर उसका पीक-टू-पीक वोल्टेज और आवृत्ति नापो।',
    '把信号发生器的信号清楚地显示在示波器上，再测出峰峰值电压和频率。',
  ),
  kit: [
    { kind: 'function-generator', x: -200, z: -40, params: { mystery: true } },
    { kind: 'oscilloscope', x: 120, z: -80 },
  ],
  steps: [
    {
      id: 'gen-on',
      focus: 'function-generator',
      text: l6('Turn the function generator’s output on.', 'Schalte den Ausgang des Funktionsgenerators ein.', 'Enciende la salida del generador de funciones.', 'Active la sortie du générateur de fonctions.', 'फ़ंक्शन जनरेटर का आउटपुट चालू करो।', '打开信号发生器的输出。'),
      hint: l6('Output is the button at the right of the generator.', 'Ausgang ist die Taste rechts am Generator.', 'Salida es el botón a la derecha del generador.', 'Sortie est le bouton à droite du générateur.', 'आउटपुट जनरेटर के दाईं ओर वाला बटन है।', '“输出”是发生器右侧的按钮。'),
      done: (c) => gen(c).on === true,
    },
    {
      id: 'probe',
      focus: 'oscilloscope',
      text: l6('Clip the scope probe to the generator output.', 'Klemm den Tastkopf des Oszilloskops an den Generatorausgang.', 'Conecta la sonda del osciloscopio a la salida del generador.', 'Branche la sonde de l’oscilloscope sur la sortie du générateur.', 'स्कोप का प्रोब जनरेटर आउटपुट से जोड़ो।', '把示波器探头夹到发生器输出上。'),
      hint: l6('Press Probe on the scope.', 'Drück am Oszilloskop auf Tastkopf.', 'Pulsa Sonda en el osciloscopio.', 'Appuie sur Sonde sur l’oscilloscope.', 'स्कोप पर प्रोब दबाओ।', '按示波器上的“探头”。'),
      done: (c) => sc(c)?.state.p.probe === true,
    },
    {
      id: 'scope-on',
      focus: 'oscilloscope',
      text: l6('Switch the scope on.', 'Schalte das Oszilloskop ein.', 'Enciende el osciloscopio.', 'Allume l’oscilloscope.', 'स्कोप चालू करो।', '打开示波器。'),
      hint: l6('Press Power on the scope.', 'Drück am Oszilloskop auf Ein.', 'Pulsa Encender en el osciloscopio.', 'Appuie sur Marche sur l’oscilloscope.', 'स्कोप पर पावर दबाओ।', '按示波器上的“电源”。'),
      done: (c) => sc(c)?.state.p.on === true,
    },
    {
      id: 'timebase',
      focus: 'oscilloscope',
      text: l6('Turn the timebase until one to six cycles fill the screen.', 'Dreh die Zeitbasis, bis ein bis sechs Perioden den Schirm füllen.', 'Gira la base de tiempos hasta que de uno a seis ciclos llenen la pantalla.', 'Tourne la base de temps jusqu’à ce qu’un à six cycles remplissent l’écran.', 'टाइमबेस तब तक घुमाओ जब तक एक से छह चक्र स्क्रीन भर दें।', '调节时基，直到屏幕上显示一到六个周期。'),
      hint: l6('Fewer seconds per division spread the cycles out.', 'Weniger Sekunden pro Teil ziehen die Perioden auseinander.', 'Menos segundos por división separan los ciclos.', 'Moins de secondes par division étalent les cycles.', 'प्रति खाना कम सेकंड चक्रों को फैला देते हैं।', '每格秒数越少，周期越分散。'),
      done: (c) => {
        const r = sc(c)?.report;
        return !!r && r.signal === true && (r.periods as number) >= 1 && (r.periods as number) <= 6;
      },
    },
    {
      id: 'volts',
      focus: 'oscilloscope',
      text: l6('Turn the volts per division until the wave is two to eight divisions tall.', 'Dreh Volt pro Teil, bis die Kurve zwei bis acht Teile hoch ist.', 'Gira los voltios por división hasta que la onda mida de dos a ocho divisiones.', 'Tourne les volts par division jusqu’à ce que l’onde fasse deux à huit divisions.', 'वोल्ट प्रति खाना तब तक घुमाओ जब तक तरंग दो से आठ खाने ऊँची न हो।', '调节伏/格，直到波形高两到八格。'),
      hint: l6('Fewer volts per division make it taller.', 'Weniger Volt pro Teil machen sie höher.', 'Menos voltios por división la hacen más alta.', 'Moins de volts par division la rendent plus haute.', 'प्रति खाना कम वोल्ट उसे ऊँचा करते हैं।', '每格伏数越少，波形越高。'),
      done: (c) => sc(c)?.report.readable === true,
    },
    {
      id: 'measure',
      focus: 'oscilloscope',
      text: l6('Press Measure.', 'Drück auf Messen.', 'Pulsa Medir.', 'Appuie sur Mesurer.', 'मापो दबाओ।', '按“测量”。'),
      hint: l6('Measure reads right only on a readable trace.', 'Messen stimmt nur bei einer gut ablesbaren Kurve.', 'Medir solo acierta con una traza legible.', 'Mesurer n’est juste que sur une trace lisible.', 'मापो केवल पढ़ने लायक तरंग पर सही आता है।', '只有波形清楚时“测量”才准确。'),
      done: (c) => sc(c)?.report.measured === true && sc(c)?.report.mReadable === true,
    },
    {
      id: 'vpp',
      text: l6('What is its peak-to-peak voltage?', 'Wie groß ist die Spitze-Spitze-Spannung?', '¿Cuál es su tensión pico a pico?', 'Quelle est sa tension crête à crête ?', 'इसका पीक-टू-पीक वोल्टेज कितना है?', '它的峰峰值电压是多少？'),
      hint: l6('Vpp is the divisions from bottom to top times the volts per division.', 'Uss ist die Zahl der Teile von unten bis oben mal Volt pro Teil.', 'Vpp son las divisiones de abajo a arriba por los voltios por división.', 'Vcc, c’est le nombre de divisions de bas en haut fois les volts par division.', 'Vpp = नीचे से ऊपर तक खाने × वोल्ट प्रति खाना।', '峰峰值 = 从底到顶的格数 × 伏/格。'),
      ask: { key: 'vpp', choices: MYSTERY_AMPS.map((v) => ({ value: v, label: same(`${v} Vpp`) })), correct: (c) => gen(c).amp as number },
      done: (c) => c.answer('vpp') !== undefined,
    },
    {
      id: 'freq',
      text: l6('What is its frequency?', 'Wie groß ist die Frequenz?', '¿Cuál es su frecuencia?', 'Quelle est sa fréquence ?', 'इसकी आवृत्ति कितनी है?', '它的频率是多少？'),
      hint: l6('f = 1 / T, where T is the divisions per cycle times the seconds per division.', 'f = 1 / T, wobei T die Teile pro Periode mal Sekunden pro Teil ist.', 'f = 1 / T, donde T son las divisiones por ciclo por los segundos por división.', 'f = 1 / T, où T est le nombre de divisions par cycle fois les secondes par division.', 'f = 1 / T, जहाँ T = प्रति चक्र खाने × प्रति खाना सेकंड।', 'f = 1 / T，T = 每周期格数 × 每格秒数。'),
      ask: { key: 'freq', choices: MYSTERY_FREQS.map((f) => ({ value: f, label: same(hz(f)) })), correct: (c) => gen(c).freq as number },
      done: (c) => c.answer('freq') !== undefined,
    },
  ],
  checks: [
    {
      id: 'vpp',
      label: l6('Peak-to-peak voltage right', 'Spitze-Spitze-Spannung richtig', 'Tensión pico a pico correcta', 'Tension crête à crête juste', 'पीक-टू-पीक वोल्टेज सही', '峰峰值电压正确'),
      pass: (c) => c.answer('vpp') === gen(c).amp,
      detail: (c) => fill(same('{given} / {truth} Vpp'), { given: String(c.answer('vpp') ?? '—'), truth: String(gen(c).amp) }),
    },
    {
      id: 'freq',
      label: l6('Frequency right', 'Frequenz richtig', 'Frecuencia correcta', 'Fréquence juste', 'आवृत्ति सही', '频率正确'),
      pass: (c) => c.answer('freq') === gen(c).freq,
      detail: (c) => fill(same('{given} / {truth}'), { given: typeof c.answer('freq') === 'number' ? hz(c.answer('freq') as number) : '—', truth: hz(gen(c).freq as number) }),
    },
    {
      id: 'readable',
      label: l6('Measured a readable trace', 'Eine gut ablesbare Kurve gemessen', 'Midió una traza legible', 'A mesuré une trace lisible', 'पढ़ने लायक तरंग नापी', '在波形清楚时测量'),
      pass: (c) => sc(c)?.report.mReadable === true,
    },
  ],
  hazards: NOTES.oscilloscope!.hazards,
};
