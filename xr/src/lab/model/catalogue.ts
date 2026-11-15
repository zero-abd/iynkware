/**
 * The tutor's notes for every item kind, in six languages: its name, a summary, how to use it safely, its hazards and,
 * per mistake, what the tutor says and how serious it is. Also the words for refusals (why an action did nothing),
 * the labs, and the values an item reports (salts, flame colours, liquids). `notes-figures.ts` holds the six items
 * ported from the lab figures; the rest is here. A model-backed tutor gets these through `LabTutorFeed.snapshot()`.
 *
 *   severity  warn      said when the mistake starts, said again while it lasts (paced by the tutor)
 *             hazard    said as a hazard at once
 *             escalate  a warning first, a hazard when it is still there after `ESCALATE_MS`
 */
import { l6, same, type L6 } from '../text';
import { GENERIC_KIND } from './items/generic';
import { ELEMENT_KIND } from './items/element';
import { SUBSTANCE_KIND } from './items/substance';
import { SPATULA_KIND } from './items/spatula';
import { FIGURE_NOTES } from './notes-figures';
import type { LabId } from './types';

export type Severity = 'warn' | 'hazard' | 'escalate';

export interface MistakeNote {
  readonly severity: Severity;
  /** The condition, for a model (not shown). English. */
  readonly when: string;
  readonly say: L6;
}

export interface ItemNotes {
  readonly name: L6;
  readonly summary: L6;
  readonly safeUse: readonly L6[];
  readonly hazards: readonly L6[];
  readonly mistakes: Readonly<Record<string, MistakeNote>>;
}

const NEW_NOTES: Readonly<Record<string, ItemNotes>> = {
  'flame-test-kit': {
    name: l6('Flame test kit', 'Flammenfärbungs-Set', 'Kit de ensayo a la llama', 'Kit de test de flamme', 'ज्वाला परीक्षण किट', '焰色反应套件'),
    summary: l6(
      'A nichrome loop, a dish of dilute hydrochloric acid and dishes of metal salts. A clean loop dipped in a salt and held in a blue flame colours it: lithium crimson, sodium yellow-orange, potassium lilac, calcium orange-red, copper blue-green, strontium red, barium pale green.',
      'Eine Nickelchrom-Öse, eine Schale verdünnte Salzsäure und Schalen mit Metallsalzen. Eine saubere Öse, in ein Salz getaucht und in die blaue Flamme gehalten, färbt sie: Lithium karminrot, Natrium gelborange, Kalium lila, Calcium orangerot, Kupfer blaugrün, Strontium rot, Barium hellgrün.',
      'Un asa de nicromo, un plato con ácido clorhídrico diluido y platos con sales metálicas. Un asa limpia mojada en una sal y puesta en una llama azul la colorea: litio carmesí, sodio amarillo anaranjado, potasio lila, calcio rojo anaranjado, cobre verde azulado, estroncio rojo, bario verde pálido.',
      'Une boucle en nichrome, une coupelle d’acide chlorhydrique dilué et des coupelles de sels métalliques. Une boucle propre trempée dans un sel et tenue dans une flamme bleue la colore : lithium rouge carmin, sodium jaune orangé, potassium lilas, calcium rouge orangé, cuivre bleu-vert, strontium rouge, baryum vert pâle.',
      'एक नाइक्रोम लूप, तनु हाइड्रोक्लोरिक अम्ल की कटोरी और धातु लवणों की कटोरियाँ। साफ़ लूप को लवण में डुबोकर नीली लौ में रखने से लौ रंगीन होती है: लिथियम गहरा लाल, सोडियम पीला-नारंगी, पोटैशियम बैंगनी, कैल्शियम नारंगी-लाल, कॉपर नीला-हरा, स्ट्रॉन्शियम लाल, बेरियम हल्का हरा।',
      '一根镍铬丝环、一碟稀盐酸和几碟金属盐。把干净的丝环蘸上盐放进蓝色火焰，火焰会变色：锂洋红色，钠黄橙色，钾淡紫色，钙橙红色，铜蓝绿色，锶红色，钡浅绿色。',
    ),
    safeUse: [
      l6('Wear goggles: the acid and some salts are harmful.', 'Trag eine Schutzbrille: Die Säure und manche Salze sind gesundheitsschädlich.', 'Usa gafas: el ácido y algunas sales son nocivos.', 'Porte des lunettes : l’acide et certains sels sont nocifs.', 'चश्मा पहनो: अम्ल और कुछ लवण हानिकारक हैं।', '戴好护目镜：酸和某些盐有害。'),
      l6('Clean the loop first: dip it in the acid, then hold it in the flame until the flame shows no colour.', 'Reinige zuerst die Öse: Tauch sie in die Säure und halt sie in die Flamme, bis die Flamme keine Farbe mehr zeigt.', 'Limpia antes el asa: mójala en el ácido y ponla en la llama hasta que la llama no muestre color.', 'Nettoie d’abord la boucle : trempe-la dans l’acide, puis tiens-la dans la flamme jusqu’à ce qu’elle ne colore plus la flamme.', 'पहले लूप साफ़ करो: उसे अम्ल में डुबोओ, फिर लौ में तब तक रखो जब तक लौ में कोई रंग न दिखे।', '先清洁丝环：蘸一下酸，再放进火焰，直到火焰不再显色。'),
      l6('Use a blue flame (collar half open): the yellow flame hides the colours.', 'Nimm eine blaue Flamme (Luftregulierung halb offen): Die gelbe Flamme überdeckt die Farben.', 'Usa una llama azul (anillo medio abierto): la llama amarilla oculta los colores.', 'Utilise une flamme bleue (virole à moitié ouverte) : la flamme jaune cache les couleurs.', 'नीली लौ लो (कॉलर आधा खुला): पीली लौ रंगों को छिपा देती है।', '用蓝色火焰（调节环半开）：黄色火焰会遮住颜色。'),
      l6('Clean the loop again between salts, or the last salt shows too.', 'Reinige die Öse zwischen zwei Salzen erneut, sonst zeigt sich das letzte Salz mit.', 'Vuelve a limpiar el asa entre sales, o también se verá la sal anterior.', 'Renettoie la boucle entre deux sels, sinon le sel précédent se voit aussi.', 'हर लवण के बीच लूप फिर साफ़ करो, वरना पिछला लवण भी दिखेगा।', '换一种盐之前再清洁丝环，否则上一种盐的颜色也会出现。'),
    ],
    hazards: [
      l6('Hydrochloric acid burns skin and eyes.', 'Salzsäure verätzt Haut und Augen.', 'El ácido clorhídrico quema la piel y los ojos.', 'L’acide chlorhydrique brûle la peau et les yeux.', 'हाइड्रोक्लोरिक अम्ल त्वचा और आँखों को जला देता है।', '盐酸会灼伤皮肤和眼睛。'),
      l6('Barium and copper salts are toxic: do not touch your mouth.', 'Barium- und Kupfersalze sind giftig: Fass dir nicht an den Mund.', 'Las sales de bario y de cobre son tóxicas: no te toques la boca.', 'Les sels de baryum et de cuivre sont toxiques : ne touche pas ta bouche.', 'बेरियम और कॉपर के लवण ज़हरीले हैं: मुँह को मत छुओ।', '钡盐和铜盐有毒：不要碰嘴。'),
      l6('The loop stays hot after it leaves the flame.', 'Die Öse bleibt heiß, nachdem sie aus der Flamme kommt.', 'El asa sigue caliente al salir de la llama.', 'La boucle reste chaude après la flamme.', 'लौ से निकालने के बाद भी लूप गरम रहता है।', '丝环离开火焰后仍然很烫。'),
    ],
    mistakes: {
      'loop-no-flame': {
        severity: 'warn',
        when: 'The loop is held where the flame should be but the burner is not lit.',
        say: l6(
          'There is no flame there. Light the burner first, then hold the loop in it.',
          'Da ist keine Flamme. Zünde zuerst den Brenner an, dann halt die Öse hinein.',
          'Ahí no hay llama. Enciende primero el mechero y luego mete el asa.',
          'Il n’y a pas de flamme. Allume d’abord le bec, puis tiens la boucle dedans.',
          'वहाँ कोई लौ नहीं है। पहले बर्नर जलाओ, फिर लूप उसमें रखो।',
          '那里没有火焰。先点燃本生灯，再把丝环放进去。',
        ),
      },
      'luminous-flame': {
        severity: 'warn',
        when: 'The loop is in a yellow (collar closed) flame.',
        say: l6(
          'The yellow flame hides the colour. Open the air collar halfway for a blue flame.',
          'Die gelbe Flamme überdeckt die Farbe. Öffne die Luftregulierung halb für eine blaue Flamme.',
          'La llama amarilla oculta el color. Abre el anillo de aire a la mitad para tener una llama azul.',
          'La flamme jaune cache la couleur. Ouvre la virole à moitié pour une flamme bleue.',
          'पीली लौ रंग को छिपा देती है। नीली लौ के लिए हवा का कॉलर आधा खोलो।',
          '黄色火焰会遮住颜色。把空气调节环开一半，换成蓝色火焰。',
        ),
      },
      'dirty-loop': {
        severity: 'warn',
        when: 'The loop was dipped in a salt without being cleaned in acid and flame first.',
        say: l6(
          'That loop was not cleaned, so the result will be mixed. Dip it in the acid and hold it in the flame until no colour shows.',
          'Die Öse war nicht gereinigt, also wird das Ergebnis gemischt. Tauch sie in die Säure und halt sie in die Flamme, bis keine Farbe mehr kommt.',
          'El asa no estaba limpia, así que el resultado saldrá mezclado. Mójala en el ácido y ponla en la llama hasta que no salga color.',
          'La boucle n’était pas propre, le résultat sera donc mélangé. Trempe-la dans l’acide et tiens-la dans la flamme jusqu’à ce qu’aucune couleur n’apparaisse.',
          'लूप साफ़ नहीं था, इसलिए नतीजा मिला-जुला आएगा। उसे अम्ल में डुबोकर लौ में तब तक रखो जब तक कोई रंग न दिखे।',
          '丝环没有清洁，结果会混在一起。蘸一下酸，放进火焰，直到不再显色。',
        ),
      },
    },
  },

  'ph-meter': {
    name: l6('pH meter', 'pH-Meter', 'Medidor de pH', 'pH-mètre', 'pH मीटर', 'pH 计'),
    summary: l6(
      'A pH meter with a glass probe. It reads the pH of the liquid the probe is in: below 7 is acidic, 7 neutral, above 7 alkaline. Calibrate it in a pH 7 buffer first and rinse the probe between solutions.',
      'Ein pH-Meter mit Glaselektrode. Es zeigt den pH-Wert der Flüssigkeit, in der die Elektrode steckt: unter 7 sauer, 7 neutral, über 7 basisch. Kalibriere es zuerst in einem pH-7-Puffer und spül die Elektrode zwischen den Lösungen.',
      'Un medidor de pH con sonda de vidrio. Lee el pH del líquido en que está la sonda: menos de 7 es ácido, 7 neutro y más de 7 básico. Calíbralo primero en un tampón de pH 7 y enjuaga la sonda entre disoluciones.',
      'Un pH-mètre à sonde de verre. Il lit le pH du liquide où trempe la sonde : sous 7 c’est acide, 7 neutre, au-dessus de 7 basique. Étalonne-le d’abord dans un tampon pH 7 et rince la sonde entre deux solutions.',
      'काँच के प्रोब वाला pH मीटर। प्रोब जिस द्रव में है उसका pH पढ़ता है: 7 से कम अम्लीय, 7 उदासीन, 7 से ज़्यादा क्षारीय। पहले इसे pH 7 बफ़र में कैलिब्रेट करो और हर घोल के बीच प्रोब धोओ।',
      '带玻璃探头的 pH 计。它读出探头所在液体的 pH：小于 7 为酸性，7 为中性，大于 7 为碱性。先在 pH 7 缓冲液中校准，并在换溶液之间冲洗探头。',
    ),
    safeUse: [
      l6('Calibrate in the pH 7 buffer before you measure.', 'Kalibriere im pH-7-Puffer, bevor du misst.', 'Calibra en el tampón de pH 7 antes de medir.', 'Étalonne dans le tampon pH 7 avant de mesurer.', 'मापने से पहले pH 7 बफ़र में कैलिब्रेट करो।', '测量前先在 pH 7 缓冲液中校准。'),
      l6('Rinse the probe in clean water between solutions.', 'Spül die Elektrode zwischen den Lösungen in sauberem Wasser.', 'Enjuaga la sonda en agua limpia entre disoluciones.', 'Rince la sonde à l’eau propre entre deux solutions.', 'हर घोल के बीच प्रोब को साफ़ पानी में धोओ।', '换溶液之间用清水冲洗探头。'),
      l6('The glass bulb is thin: never stir with it or knock it.', 'Die Glaskugel ist dünn: Rühr nie damit und stoß nirgends an.', 'El bulbo de vidrio es fino: nunca remuevas con él ni lo golpees.', 'Le bulbe de verre est fin : ne remue jamais avec et ne le cogne pas.', 'काँच का बल्ब पतला है: इससे कभी मत चलाओ और इसे टकराओ मत।', '玻璃泡很薄：不要用它搅拌，也不要磕碰。'),
      l6('Put it back in its storage cap when you finish.', 'Steck sie nach der Arbeit wieder in die Schutzkappe.', 'Vuelve a ponerla en su capuchón al terminar.', 'Remets-la dans son capuchon quand tu as fini.', 'काम ख़त्म होने पर इसे वापस इसकी टोपी में रखो।', '用完后放回保护帽里。'),
    ],
    hazards: [
      l6('Acids and alkalis burn skin and eyes: wear goggles.', 'Säuren und Laugen verätzen Haut und Augen: Trag eine Schutzbrille.', 'Los ácidos y las bases queman la piel y los ojos: usa gafas.', 'Les acides et les bases brûlent la peau et les yeux : porte des lunettes.', 'अम्ल और क्षार त्वचा व आँखें जलाते हैं: चश्मा पहनो।', '酸和碱会灼伤皮肤和眼睛：戴好护目镜。'),
      l6('A broken probe has sharp glass.', 'Eine zerbrochene Elektrode hat scharfes Glas.', 'Una sonda rota tiene vidrio cortante.', 'Une sonde cassée a du verre coupant.', 'टूटे प्रोब में धारदार काँच होता है।', '破损的探头有锋利的玻璃。'),
    ],
    mistakes: {
      'ph-not-rinsed': {
        severity: 'warn',
        when: 'The probe went straight from one solution into the sample without a rinse.',
        say: l6(
          'Rinse the probe first: it carries the last solution into this one and the reading drifts.',
          'Spül zuerst die Elektrode: Sie schleppt die letzte Lösung in diese ein und der Messwert verfälscht sich.',
          'Enjuaga antes la sonda: arrastra la disolución anterior a esta y la lectura se desvía.',
          'Rince d’abord la sonde : elle apporte la solution précédente dans celle-ci et la mesure dérive.',
          'पहले प्रोब धोओ: यह पिछला घोल इसमें ले आता है और पाठ्यांक भटक जाता है।',
          '先冲洗探头：它把上一种溶液带进来，读数会偏。',
        ),
      },
      'ph-not-calibrated': {
        severity: 'warn',
        when: 'The probe is in the sample and the meter has not been calibrated.',
        say: l6(
          'The meter is not calibrated, so this reading is off. Put the probe in the pH 7 buffer and press Calibrate first.',
          'Das Gerät ist nicht kalibriert, der Wert stimmt also nicht. Steck die Elektrode in den pH-7-Puffer und drück zuerst Kalibrieren.',
          'El medidor no está calibrado, así que la lectura no es fiable. Pon la sonda en el tampón de pH 7 y pulsa primero Calibrar.',
          'Le pH-mètre n’est pas étalonné, la mesure est donc fausse. Mets la sonde dans le tampon pH 7 et appuie d’abord sur Étalonner.',
          'मीटर कैलिब्रेट नहीं है, इसलिए यह पाठ्यांक ग़लत है। पहले प्रोब को pH 7 बफ़र में रखकर कैलिब्रेट दबाओ।',
          '仪表没有校准，这个读数不准。先把探头放进 pH 7 缓冲液，按“校准”。',
        ),
      },
    },
  },

  'function-generator': {
    name: l6('Function generator', 'Funktionsgenerator', 'Generador de funciones', 'Générateur de fonctions', 'फ़ंक्शन जनरेटर', '函数信号发生器'),
    summary: l6(
      'A signal source: it makes a sine, square or triangle wave at the frequency and peak-to-peak voltage you set.',
      'Eine Signalquelle: Sie erzeugt eine Sinus-, Rechteck- oder Dreieckspannung mit der eingestellten Frequenz und Spitze-Spitze-Spannung.',
      'Una fuente de señal: genera una onda senoidal, cuadrada o triangular con la frecuencia y la tensión pico a pico que fijes.',
      'Une source de signal : elle produit un sinus, un carré ou un triangle à la fréquence et à la tension crête à crête réglées.',
      'एक सिग्नल स्रोत: यह तुम्हारी सेट की गई आवृत्ति और पीक-टू-पीक वोल्टेज पर साइन, स्क्वेयर या त्रिकोण तरंग बनाता है।',
      '一种信号源：按你设定的频率和峰峰值电压输出正弦波、方波或三角波。',
    ),
    safeUse: [
      l6('Turn the output off before you connect or move the probe.', 'Schalte den Ausgang aus, bevor du den Tastkopf anschließt oder umsteckst.', 'Apaga la salida antes de conectar o mover la sonda.', 'Coupe la sortie avant de brancher ou de déplacer la sonde.', 'प्रोब जोड़ने या हटाने से पहले आउटपुट बंद करो।', '接上或挪动探头前先关掉输出。'),
      l6('Start with a small amplitude and turn it up.', 'Fang mit kleiner Amplitude an und dreh dann hoch.', 'Empieza con una amplitud pequeña y súbela después.', 'Commence avec une petite amplitude, puis augmente.', 'छोटे आयाम से शुरू करो और फिर बढ़ाओ।', '先从小幅度开始，再慢慢调大。'),
    ],
    hazards: [l6('Low voltage here, but never connect it to mains circuits.', 'Hier nur Kleinspannung, aber schließ ihn nie an Netzstromkreise an.', 'Aquí la tensión es baja, pero nunca lo conectes a circuitos de red.', 'Ici la tension est faible, mais ne le branche jamais sur le secteur.', 'यहाँ वोल्टेज कम है, पर इसे कभी मेन्स सर्किट से मत जोड़ो।', '这里电压很低，但绝不能接到市电电路上。')],
    mistakes: {},
  },

  oscilloscope: {
    name: l6('Oscilloscope', 'Oszilloskop', 'Osciloscopio', 'Oscilloscope', 'ऑसिलोस्कोप', '示波器'),
    summary: l6(
      'It draws a voltage against time on a grid 10 divisions wide and 8 tall. The timebase sets the seconds per division across, the volts per division sets the height. A readable trace shows one to six periods and fills two to eight divisions.',
      'Es zeichnet eine Spannung über der Zeit auf einem Raster von 10 Teilen Breite und 8 Teilen Höhe. Die Zeitbasis stellt die Sekunden pro Teil quer ein, Volt pro Teil die Höhe. Gut ablesbar sind ein bis sechs Perioden über zwei bis acht Teile Höhe.',
      'Dibuja una tensión frente al tiempo en una cuadrícula de 10 divisiones de ancho y 8 de alto. La base de tiempos fija los segundos por división en horizontal; los voltios por división, la altura. Una traza legible muestra de uno a seis periodos y ocupa de dos a ocho divisiones.',
      'Il trace une tension en fonction du temps sur une grille de 10 divisions de large et 8 de haut. La base de temps règle les secondes par division en largeur, les volts par division la hauteur. Une trace lisible montre une à six périodes sur deux à huit divisions.',
      'यह 10 खाने चौड़े और 8 खाने ऊँचे ग्रिड पर समय के साथ वोल्टेज खींचता है। टाइमबेस आड़े में प्रति खाना सेकंड तय करता है, वोल्ट प्रति खाना ऊँचाई। पढ़ने लायक तरंग में एक से छह आवर्त और दो से आठ खाने की ऊँचाई होती है।',
      '它在宽 10 格、高 8 格的网格上画出电压随时间的变化。时基设定横向每格的秒数，伏/格设定高度。易读的波形显示一到六个周期，高度占两到八格。',
    ),
    safeUse: [
      l6('Clip the probe ground to the signal ground first.', 'Klemm zuerst die Masse des Tastkopfs an die Signalmasse.', 'Conecta primero la masa de la sonda a la masa de la señal.', 'Branche d’abord la masse de la sonde sur la masse du signal.', 'पहले प्रोब का ग्राउंड सिग्नल के ग्राउंड से जोड़ो।', '先把探头的地线夹到信号地上。'),
      l6('Start at a large volts per division and come down until the trace fills the screen.', 'Fang mit großem Volt pro Teil an und geh herunter, bis die Kurve den Schirm füllt.', 'Empieza con muchos voltios por división y baja hasta que la traza llene la pantalla.', 'Commence avec beaucoup de volts par division et descends jusqu’à ce que la trace remplisse l’écran.', 'बड़े वोल्ट प्रति खाना से शुरू करो और तब तक घटाओ जब तक तरंग स्क्रीन भर दे।', '先用较大的伏/格，再逐步调小，直到波形占满屏幕。'),
    ],
    hazards: [l6('Never probe mains with a bench scope: the probe ground is earthed.', 'Miss nie Netzspannung mit einem Tischoszilloskop: Die Tastkopfmasse ist geerdet.', 'Nunca midas la red con un osciloscopio de banco: la masa de la sonda va a tierra.', 'Ne mesure jamais le secteur avec un oscilloscope de table : la masse de la sonde est à la terre.', 'बेंच स्कोप से कभी मेन्स मत नापो: प्रोब का ग्राउंड अर्थ से जुड़ा होता है।', '绝不要用台式示波器测市电：探头地线是接大地的。')],
    mistakes: {
      'scope-clipped': {
        severity: 'warn',
        when: 'The trace is taller than the 8 divisions of the screen.',
        say: l6(
          'The wave runs off the screen, so its peaks cannot be read. Turn the volts per division up.',
          'Die Kurve läuft über den Schirm hinaus, ihre Spitzen sind nicht ablesbar. Dreh Volt pro Teil hoch.',
          'La onda se sale de la pantalla y no se pueden leer sus picos. Sube los voltios por división.',
          'L’onde sort de l’écran, ses crêtes sont illisibles. Augmente les volts par division.',
          'तरंग स्क्रीन से बाहर जा रही है, इसलिए उसके शिखर नहीं पढ़े जा सकते। वोल्ट प्रति खाना बढ़ाओ।',
          '波形超出屏幕，看不到波峰。把伏/格调大。',
        ),
      },
      'timebase-too-fast': {
        severity: 'warn',
        when: 'Less than half a period fits on the screen.',
        say: l6(
          'You see less than one cycle. Turn the timebase to more time per division.',
          'Du siehst weniger als eine Periode. Stell die Zeitbasis auf mehr Zeit pro Teil.',
          'Ves menos de un ciclo. Pon la base de tiempos en más tiempo por división.',
          'Tu vois moins d’un cycle. Règle la base de temps sur plus de temps par division.',
          'तुम्हें एक चक्र से कम दिख रहा है। टाइमबेस को प्रति खाना ज़्यादा समय पर करो।',
          '你看到的不到一个周期。把时基调到每格更多时间。',
        ),
      },
      'timebase-too-slow': {
        severity: 'warn',
        when: 'More than 20 periods are squeezed onto the screen.',
        say: l6(
          'The cycles are squashed together. Turn the timebase to less time per division.',
          'Die Perioden sind zusammengequetscht. Stell die Zeitbasis auf weniger Zeit pro Teil.',
          'Los ciclos están apretados. Pon la base de tiempos en menos tiempo por división.',
          'Les cycles sont tassés. Règle la base de temps sur moins de temps par division.',
          'चक्र आपस में दबे हुए हैं। टाइमबेस को प्रति खाना कम समय पर करो।',
          '周期挤在一起了。把时基调到每格更少时间。',
        ),
      },
    },
  },

  [SUBSTANCE_KIND]: {
    name: l6('Stock substance', 'Vorratschemikalie', 'Sustancia de reserva', 'Produit du stock', 'भंडार का पदार्थ', '库存试剂'),
    summary: l6(
      'A substance from the school stockroom: a solution in a beaker or a solid in a dish, its formula on the tag. Wear goggles and gloves; many are corrosive or toxic.',
      'Eine Chemikalie aus der Schulsammlung: eine Lösung im Becherglas oder ein Feststoff in einer Schale, die Formel auf dem Etikett. Schutzbrille und Handschuhe tragen; viele sind ätzend oder giftig.',
      'Una sustancia del almacén escolar: una disolución en un vaso o un sólido en una cápsula, con su fórmula en la etiqueta. Usa gafas y guantes; muchas son corrosivas o tóxicas.',
      'Un produit de la réserve de l’école : une solution dans un bécher ou un solide dans une coupelle, sa formule sur l’étiquette. Porte lunettes et gants ; beaucoup sont corrosifs ou toxiques.',
      'स्कूल भंडार का पदार्थ: बीकर में घोल या प्याली में ठोस, लेबल पर उसका सूत्र। चश्मा और दस्ताने पहनो; कई संक्षारक या विषैले होते हैं।',
      '学校库房的试剂：烧杯里的溶液或皿里的固体，标签上写着化学式。戴好护目镜和手套；许多试剂有腐蚀性或毒性。',
    ),
    safeUse: [],
    hazards: [],
    mistakes: {},
  },
  [ELEMENT_KIND]: {
    name: l6('Element sample', 'Elementprobe', 'Muestra de elemento', 'Échantillon d’élément', 'तत्व का नमूना', '元素样品'),
    summary: l6(
      'A small labelled jar of one element, taken from the periodic table. Many elements are reactive or toxic: in a real lab, check its safety sheet first.',
      'Ein kleines beschriftetes Glas mit einem Element aus dem Periodensystem. Viele Elemente sind reaktiv oder giftig: Im echten Labor zuerst das Sicherheitsdatenblatt prüfen.',
      'Un frasco pequeño con etiqueta de un elemento, tomado de la tabla periódica. Muchos elementos son reactivos o tóxicos: en un laboratorio real, consulta primero su ficha de seguridad.',
      'Un petit flacon étiqueté d’un élément, pris dans le tableau périodique. Beaucoup d’éléments sont réactifs ou toxiques : dans un vrai labo, consulte d’abord sa fiche de sécurité.',
      'आवर्त सारणी से लिए गए एक तत्व का छोटा लेबल लगा जार। कई तत्व क्रियाशील या विषैले होते हैं: असली लैब में पहले उसकी सुरक्षा शीट देखो।',
      '从元素周期表取出的一个元素的小标签瓶。许多元素活泼或有毒：在真实实验室里请先查看安全说明书。',
    ),
    safeUse: [],
    hazards: [],
    mistakes: {},
  },
  [SPATULA_KIND]: {
    name: l6('Spatula', 'Spatel', 'Espátula', 'Spatule', 'स्पैचुला', '药匙'),
    summary: l6(
      'A steel spatula for solids. Dip its blade into a dish or jar to take a scoop, then tip it over a beaker or flask to add it. Use a clean spatula for each solid.',
      'Ein Stahlspatel für Feststoffe. Tauch die Klinge in eine Schale oder ein Glas, um etwas aufzunehmen, und kipp es über einem Becherglas oder Kolben hinein. Für jeden Feststoff einen sauberen Spatel nehmen.',
      'Una espátula de acero para sólidos. Mete la hoja en una cápsula o un frasco para tomar un poco y vuélcalo sobre un vaso o un matraz para añadirlo. Usa una espátula limpia para cada sólido.',
      'Une spatule en acier pour les solides. Plonge la lame dans une coupelle ou un flacon pour prendre une pointe, puis renverse-la au-dessus d’un bécher ou d’un flacon pour l’ajouter. Une spatule propre pour chaque solide.',
      'ठोस पदार्थों के लिए स्टील का स्पैचुला। थोड़ा लेने के लिए उसकी पत्ती प्याली या जार में डुबाओ, फिर बीकर या फ्लास्क के ऊपर पलटकर डालो। हर ठोस के लिए साफ़ स्पैचुला लो।',
      '用于取固体的钢制药匙。把匙头伸进皿或瓶里取一点，再在烧杯或锥形瓶上方倒进去。每种固体用一把干净的药匙。',
    ),
    safeUse: [],
    hazards: [],
    mistakes: {},
  },
  [GENERIC_KIND]: {
    name: l6('Stand-in item', 'Platzhalter', 'Objeto provisional', 'Objet provisoire', 'अस्थायी वस्तु', '替代物品'),
    summary: l6(
      'A labelled box standing in for equipment the lab does not have a model of yet. It does nothing.',
      'Eine beschriftete Kiste als Platzhalter für Geräte, für die das Labor noch kein Modell hat. Sie tut nichts.',
      'Una caja con etiqueta que sustituye a un equipo del que el laboratorio aún no tiene modelo. No hace nada.',
      'Une boîte étiquetée qui remplace un appareil dont le labo n’a pas encore de modèle. Elle ne fait rien.',
      'एक लेबल लगा डिब्बा, उस उपकरण की जगह जिसका मॉडल लैब में अभी नहीं है। यह कुछ नहीं करता।',
      '一个贴了标签的盒子，代替实验室还没有模型的器材。它没有任何功能。',
    ),
    safeUse: [],
    hazards: [],
    mistakes: {},
  },
};

export const NOTES: Readonly<Record<string, ItemNotes>> = { ...FIGURE_NOTES, ...NEW_NOTES };

export const notesOf = (kind: string): ItemNotes => NOTES[kind] ?? NOTES[GENERIC_KIND]!;

/** Why an action did nothing, by the model's refusal reason. */
export const REFUSALS: Readonly<Record<string, L6>> = {
  'beaker-full': l6('The beaker is full to the brim', 'Das Becherglas ist randvoll', 'El vaso está lleno hasta el borde', 'Le bécher est plein à ras bord', 'बीकर किनारे तक भरा है', '烧杯已经满到杯口'),
  'flask-full': l6('The flask is full to the neck', 'Der Kolben ist bis zum Hals voll', 'El matraz está lleno hasta el cuello', 'Le flacon est plein jusqu’au col', 'फ्लास्क गर्दन तक भरा है', '锥形瓶已经满到瓶颈'),
  'flask-empty': l6('There is nothing in the flask to swirl', 'Im Kolben ist nichts zum Schwenken', 'No hay nada en el matraz que agitar', 'Il n’y a rien à agiter dans le flacon', 'फ्लास्क में घुमाने को कुछ नहीं है', '瓶里没有可摇的东西'),
  'no-gas': l6('No gas: open the gas tap first', 'Kein Gas: Öffne zuerst den Gashahn', 'No hay gas: abre primero la llave del gas', 'Pas de gaz : ouvre d’abord le robinet', 'गैस नहीं: पहले गैस नल खोलो', '没有燃气：先打开燃气阀'),
  'already-lit': l6('It is already lit', 'Er brennt schon', 'Ya está encendido', 'Il est déjà allumé', 'यह पहले से जल रहा है', '已经点着了'),
  'unknown-param': l6('That setting does not exist on this item', 'Diese Einstellung gibt es an diesem Gerät nicht', 'Ese ajuste no existe en este equipo', 'Ce réglage n’existe pas sur cet appareil', 'इस उपकरण पर यह सेटिंग नहीं है', '这件器材没有这个设置'),
  'bad-value': l6('That value is out of range', 'Dieser Wert liegt außerhalb des Bereichs', 'Ese valor está fuera de rango', 'Cette valeur est hors plage', 'यह मान सीमा से बाहर है', '这个数值超出范围'),
  'unknown-action': l6('This item cannot do that', 'Das kann dieses Gerät nicht', 'Este equipo no puede hacer eso', 'Cet appareil ne peut pas faire ça', 'यह उपकरण ऐसा नहीं कर सकता', '这件器材做不到'),
  'no-item': l6('That item is not on the bench', 'Dieses Gerät steht nicht auf dem Tisch', 'Ese equipo no está en la mesa', 'Cet appareil n’est pas sur la paillasse', 'यह उपकरण मेज़ पर नहीं है', '桌上没有这件器材'),
  'no-burner': l6('There is no burner on the bench', 'Auf dem Tisch steht kein Brenner', 'No hay mechero en la mesa', 'Il n’y a pas de bec sur la paillasse', 'मेज़ पर कोई बर्नर नहीं है', '桌上没有本生灯'),
  'meter-off': l6('Switch the meter on first', 'Schalte zuerst das Messgerät ein', 'Enciende primero el medidor', 'Allume d’abord l’appareil', 'पहले मीटर चालू करो', '先打开仪表'),
  'calibrate-in-buffer': l6('Put the probe in the pH 7 buffer to calibrate', 'Steck die Elektrode zum Kalibrieren in den pH-7-Puffer', 'Pon la sonda en el tampón de pH 7 para calibrar', 'Mets la sonde dans le tampon pH 7 pour étalonner', 'कैलिब्रेट करने के लिए प्रोब को pH 7 बफ़र में रखो', '把探头放进 pH 7 缓冲液再校准'),
  'no-sample': l6('There is no liquid in the beaker to measure', 'Im Becherglas ist keine Flüssigkeit zum Messen', 'No hay líquido en el vaso para medir', 'Il n’y a pas de liquide à mesurer dans le bécher', 'बीकर में मापने को कोई द्रव नहीं है', '烧杯里没有可测的液体'),
  'output-off': l6('Turn the output on to read the meters', 'Schalte den Ausgang ein, um die Anzeigen abzulesen', 'Enciende la salida para leer los medidores', 'Active la sortie pour lire les afficheurs', 'मीटर पढ़ने के लिए आउटपुट चालू करो', '打开输出才能读数'),
  'no-current': l6('No current flows: nothing is connected', 'Es fließt kein Strom: Nichts ist angeschlossen', 'No circula corriente: no hay nada conectado', 'Aucun courant ne passe : rien n’est branché', 'करंट नहीं बह रहा: कुछ भी जुड़ा नहीं है', '没有电流：什么都没接'),
  'stop-first': l6('Stop the pendulum first', 'Halt zuerst das Pendel an', 'Para primero el péndulo', 'Arrête d’abord le pendule', 'पहले लोलक रोको', '先让单摆停下'),
  'too-few-swings': l6('Let it make at least 10 swings before you record', 'Lass es mindestens 10 Schwingungen machen, bevor du notierst', 'Deja que haga al menos 10 oscilaciones antes de anotar', 'Laisse-le faire au moins 10 oscillations avant de noter', 'लिखने से पहले कम से कम 10 झूले होने दो', '至少摆 10 次再记录'),
  'mystery-locked': l6('This signal is set by your teacher: measure it on the scope', 'Dieses Signal hat deine Lehrkraft eingestellt: Miss es am Oszilloskop', 'Esta señal la fijó tu profesor: mídela en el osciloscopio', 'Ce signal est réglé par ton professeur : mesure-le à l’oscilloscope', 'यह सिग्नल शिक्षक ने सेट किया है: इसे स्कोप पर नापो', '这个信号由老师设定：用示波器去测'),
  'scope-off': l6('Switch the scope on first', 'Schalte zuerst das Oszilloskop ein', 'Enciende primero el osciloscopio', 'Allume d’abord l’oscilloscope', 'पहले स्कोप चालू करो', '先打开示波器'),
  'no-signal': l6('No signal: connect the probe and turn the generator on', 'Kein Signal: Schließ den Tastkopf an und schalte den Generator ein', 'Sin señal: conecta la sonda y enciende el generador', 'Pas de signal : branche la sonde et allume le générateur', 'कोई सिग्नल नहीं: प्रोब जोड़ो और जनरेटर चालू करो', '没有信号：接上探头并打开信号发生器'),
  'no-generator': l6('There is no generator on the bench', 'Auf dem Tisch steht kein Generator', 'No hay generador en la mesa', 'Il n’y a pas de générateur sur la paillasse', 'मेज़ पर कोई जनरेटर नहीं है', '桌上没有信号发生器'),
};

export const refusalText = (reason: string): L6 => REFUSALS[reason] ?? REFUSALS['unknown-action']!;

export const LAB_NAMES: Readonly<Record<LabId, L6>> = {
  chemistry: l6('Chemistry lab', 'Chemielabor', 'Laboratorio de química', 'Labo de chimie', 'रसायन प्रयोगशाला', '化学实验室'),
  physics: l6('Physics lab', 'Physiklabor', 'Laboratorio de física', 'Labo de physique', 'भौतिकी प्रयोगशाला', '物理实验室'),
  electrical: l6('Electrical lab', 'Elektrolabor', 'Laboratorio de electricidad', 'Labo d’électricité', 'विद्युत प्रयोगशाला', '电学实验室'),
  signals: l6('Signals and systems lab', 'Labor Signale und Systeme', 'Laboratorio de señales y sistemas', 'Labo signaux et systèmes', 'सिग्नल और सिस्टम प्रयोगशाला', '信号与系统实验室'),
};

export const SALT_NAMES: Readonly<Record<string, L6>> = {
  Li: l6('Lithium chloride', 'Lithiumchlorid', 'Cloruro de litio', 'Chlorure de lithium', 'लिथियम क्लोराइड', '氯化锂'),
  Na: l6('Sodium chloride', 'Natriumchlorid', 'Cloruro de sodio', 'Chlorure de sodium', 'सोडियम क्लोराइड', '氯化钠'),
  K: l6('Potassium chloride', 'Kaliumchlorid', 'Cloruro de potasio', 'Chlorure de potassium', 'पोटैशियम क्लोराइड', '氯化钾'),
  Ca: l6('Calcium chloride', 'Calciumchlorid', 'Cloruro de calcio', 'Chlorure de calcium', 'कैल्शियम क्लोराइड', '氯化钙'),
  Cu: l6('Copper(II) chloride', 'Kupfer(II)-chlorid', 'Cloruro de cobre(II)', 'Chlorure de cuivre(II)', 'कॉपर(II) क्लोराइड', '氯化铜'),
  Sr: l6('Strontium chloride', 'Strontiumchlorid', 'Cloruro de estroncio', 'Chlorure de strontium', 'स्ट्रॉन्शियम क्लोराइड', '氯化锶'),
  Ba: l6('Barium chloride', 'Bariumchlorid', 'Cloruro de bario', 'Chlorure de baryum', 'बेरियम क्लोराइड', '氯化钡'),
  unknown: l6('Unknown salt', 'Unbekanntes Salz', 'Sal desconocida', 'Sel inconnu', 'अज्ञात लवण', '未知盐'),
};

export const FLAME_COLOUR_NAMES: Readonly<Record<string, L6>> = {
  crimson: l6('crimson', 'karminrot', 'carmesí', 'rouge carmin', 'गहरा लाल', '洋红色'),
  'yellow-orange': l6('yellow-orange', 'gelborange', 'amarillo anaranjado', 'jaune orangé', 'पीला-नारंगी', '黄橙色'),
  lilac: l6('lilac', 'lila', 'lila', 'lilas', 'बैंगनी', '淡紫色'),
  'orange-red': l6('orange-red', 'orangerot', 'rojo anaranjado', 'rouge orangé', 'नारंगी-लाल', '橙红色'),
  'blue-green': l6('blue-green', 'blaugrün', 'verde azulado', 'bleu-vert', 'नीला-हरा', '蓝绿色'),
  red: l6('red', 'rot', 'rojo', 'rouge', 'लाल', '红色'),
  'pale-green': l6('pale green', 'hellgrün', 'verde pálido', 'vert pâle', 'हल्का हरा', '浅绿色'),
  none: l6('no colour', 'keine Farbe', 'sin color', 'aucune couleur', 'कोई रंग नहीं', '无颜色'),
  masked: l6('hidden by the yellow flame', 'von der gelben Flamme überdeckt', 'oculto por la llama amarilla', 'caché par la flamme jaune', 'पीली लौ में छिपा', '被黄色火焰遮住'),
  off: l6('no flame', 'keine Flamme', 'sin llama', 'pas de flamme', 'कोई लौ नहीं', '没有火焰'),
};

/** Units and symbols, the same in every language. */
export const UNIT = { ohm: same('Ω'), volt: same('V'), amp: same('A'), hz: same('Hz'), s: same('s') } as const;
