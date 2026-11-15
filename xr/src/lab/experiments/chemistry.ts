/**
 * Chemistry experiments: the flame test (identify a seeded unknown salt by its flame colour) and the pH of a liquid
 * (calibrate, rinse, measure; the liquid is seeded).
 */
import { fill, l6 } from '../text';
import { FLAME_COLOUR, LIQUID_PH, SALTS, type Liquid } from '../model/items/chemistry';
import { FLAME_COLOUR_NAMES, NOTES, SALT_NAMES } from '../model/catalogue';
import { pickSeeded } from '../model/types';
import type { Experiment } from './types';

const unknownOf = (ctx: { item(kind: string): { state: { s: Record<string, unknown> } } | null }) =>
  (ctx.item('flame-test-kit')?.state.s.unknown as string | undefined) ?? 'Na';

export const FLAME_TEST: Experiment = {
  id: 'chemistry/flame-test',
  lab: 'chemistry',
  title: l6('Flame test', 'Flammenfärbung', 'Ensayo a la llama', 'Test de flamme', 'ज्वाला परीक्षण', '焰色反应'),
  goal: l6(
    'Find out which metal is in the unknown salt from the colour it gives a blue flame.',
    'Finde heraus, welches Metall im unbekannten Salz steckt, an der Farbe, die es einer blauen Flamme gibt.',
    'Averigua qué metal hay en la sal desconocida por el color que da a una llama azul.',
    'Trouve quel métal contient le sel inconnu d’après la couleur qu’il donne à une flamme bleue.',
    'अज्ञात लवण में कौन-सी धातु है, यह नीली लौ में उसके रंग से पता करो।',
    '根据未知盐给蓝色火焰带来的颜色，判断其中含有哪种金属。',
  ),
  kit: [
    { kind: 'bunsen-burner', x: 70, z: -90 },
    { kind: 'flame-test-kit', x: -170, z: 20 },
  ],
  steps: [
    {
      id: 'light',
      focus: 'bunsen-burner',
      text: l6(
        'Light the burner safely: air collar closed, gas tap on, then Light straight away.',
        'Zünde den Brenner sicher an: Luftregulierung zu, Gashahn auf, dann sofort Anzünden.',
        'Enciende el mechero con seguridad: anillo de aire cerrado, abre el gas y pulsa Encender enseguida.',
        'Allume le bec en sécurité : virole fermée, robinet de gaz ouvert, puis Allumer tout de suite.',
        'बर्नर सुरक्षित जलाओ: हवा का कॉलर बंद, गैस नल चालू, फिर तुरंत जलाओ।',
        '安全地点燃本生灯：关上空气调节环，打开燃气阀，然后立刻点火。',
      ),
      hint: l6(
        'The collar is the ring near the bottom of the barrel. Gas first, then press Light within two seconds.',
        'Die Luftregulierung ist der Ring unten am Brennerrohr. Erst Gas, dann innerhalb von zwei Sekunden Anzünden.',
        'El anillo de aire está abajo en el tubo. Primero el gas y después Encender antes de dos segundos.',
        'La virole est la bague en bas du tube. D’abord le gaz, puis Allumer dans les deux secondes.',
        'कॉलर नली के नीचे वाला छल्ला है। पहले गैस, फिर दो सेकंड के भीतर जलाओ दबाओ।',
        '调节环是灯管下部的圆环。先开燃气，两秒内按点火。',
      ),
      done: (c) => c.item('bunsen-burner')?.state.p.lit === true,
    },
    {
      id: 'blue',
      focus: 'bunsen-burner',
      text: l6('Open the air collar halfway for a blue flame.', 'Öffne die Luftregulierung halb für eine blaue Flamme.', 'Abre el anillo de aire a la mitad para tener una llama azul.', 'Ouvre la virole à moitié pour une flamme bleue.', 'नीली लौ के लिए हवा का कॉलर आधा खोलो।', '把空气调节环开一半，得到蓝色火焰。'),
      hint: l6('Press the collar once: closed, half open, open.', 'Drück einmal auf die Luftregulierung: zu, halb offen, offen.', 'Pulsa el anillo una vez: cerrado, medio abierto, abierto.', 'Appuie une fois sur la virole : fermée, à moitié, ouverte.', 'कॉलर को एक बार दबाओ: बंद, आधा खुला, खुला।', '按一次调节环：关、半开、全开。'),
      done: (c) => {
        const b = c.item('bunsen-burner')?.state.p;
        return !!b && b.lit === true && b.collar !== 'closed';
      },
    },
    {
      id: 'clean',
      focus: 'flame-test-kit',
      text: l6(
        'Clean the loop: dip it in the acid, then hold it in the blue flame until it gives no colour.',
        'Reinige die Öse: Tauch sie in die Säure und halt sie in die blaue Flamme, bis sie keine Farbe mehr gibt.',
        'Limpia el asa: mójala en el ácido y ponla en la llama azul hasta que no dé color.',
        'Nettoie la boucle : trempe-la dans l’acide, puis tiens-la dans la flamme bleue jusqu’à ce qu’elle ne colore plus.',
        'लूप साफ़ करो: उसे अम्ल में डुबोओ, फिर नीली लौ में तब तक रखो जब तक कोई रंग न आए।',
        '清洁丝环：蘸一下酸，再放进蓝色火焰，直到不再显色。',
      ),
      hint: l6('Press the acid dish, then press the loop to carry it to the flame, and wait a moment.', 'Drück auf die Säureschale, dann auf die Öse, um sie in die Flamme zu bringen, und warte kurz.', 'Pulsa el plato de ácido, luego el asa para llevarla a la llama, y espera un momento.', 'Appuie sur la coupelle d’acide, puis sur la boucle pour la porter à la flamme, et attends un instant.', 'अम्ल की कटोरी दबाओ, फिर लूप दबाकर उसे लौ में ले जाओ, और थोड़ा रुको।', '按酸碟，再按丝环把它送进火焰，稍等片刻。'),
      done: (c) => c.item('flame-test-kit')?.state.s.clean === true,
    },
    {
      id: 'dip',
      focus: 'flame-test-kit',
      text: l6('Dip the clean loop in the unknown salt (the dish marked ?).', 'Tauch die saubere Öse in das unbekannte Salz (die Schale mit ?).', 'Moja el asa limpia en la sal desconocida (el plato marcado con ?).', 'Trempe la boucle propre dans le sel inconnu (la coupelle marquée ?).', 'साफ़ लूप को अज्ञात लवण (? वाली कटोरी) में डुबोओ।', '把干净的丝环蘸上未知盐（标有 ? 的碟子）。'),
      hint: l6('The unknown is the last dish on the tray.', 'Das Unbekannte ist die letzte Schale auf dem Tablett.', 'La desconocida es el último plato de la bandeja.', 'L’inconnu est la dernière coupelle du plateau.', 'अज्ञात लवण ट्रे की आख़िरी कटोरी है।', '未知盐在托盘最后一个碟子里。'),
      done: (c) => c.item('flame-test-kit')?.state.s.from === 'unknown',
    },
    {
      id: 'flame',
      focus: 'bunsen-burner',
      text: l6('Hold the loop in the blue flame and watch its colour.', 'Halt die Öse in die blaue Flamme und beobachte die Farbe.', 'Pon el asa en la llama azul y observa el color.', 'Tiens la boucle dans la flamme bleue et observe la couleur.', 'लूप को नीली लौ में रखो और उसका रंग देखो।', '把丝环放进蓝色火焰，观察颜色。'),
      hint: l6('Press the loop to carry it into the flame.', 'Drück auf die Öse, um sie in die Flamme zu bringen.', 'Pulsa el asa para llevarla a la llama.', 'Appuie sur la boucle pour la porter dans la flamme.', 'लूप दबाकर उसे लौ में ले जाओ।', '按丝环把它送进火焰。'),
      done: (c) => c.item('flame-test-kit')?.state.s.seenUnknown === true,
    },
    {
      id: 'identify',
      text: l6('Which metal gives that colour?', 'Welches Metall gibt diese Farbe?', '¿Qué metal da ese color?', 'Quel métal donne cette couleur ?', 'यह रंग कौन-सी धातु देती है?', '哪种金属会产生这种颜色？'),
      hint: l6(
        'Crimson lithium, yellow-orange sodium, lilac potassium, orange-red calcium, blue-green copper, red strontium, pale green barium.',
        'Karminrot Lithium, gelborange Natrium, lila Kalium, orangerot Calcium, blaugrün Kupfer, rot Strontium, hellgrün Barium.',
        'Carmesí litio, amarillo anaranjado sodio, lila potasio, rojo anaranjado calcio, verde azulado cobre, rojo estroncio, verde pálido bario.',
        'Rouge carmin lithium, jaune orangé sodium, lilas potassium, rouge orangé calcium, bleu-vert cuivre, rouge strontium, vert pâle baryum.',
        'गहरा लाल लिथियम, पीला-नारंगी सोडियम, बैंगनी पोटैशियम, नारंगी-लाल कैल्शियम, नीला-हरा कॉपर, लाल स्ट्रॉन्शियम, हल्का हरा बेरियम।',
        '洋红色是锂，黄橙色是钠，淡紫色是钾，橙红色是钙，蓝绿色是铜，红色是锶，浅绿色是钡。',
      ),
      ask: { key: 'salt', choices: SALTS.map((s) => ({ value: s, label: SALT_NAMES[s]! })), correct: (c) => unknownOf(c) },
      done: (c) => c.answer('salt') !== undefined,
    },
    {
      id: 'shutdown',
      focus: 'bunsen-burner',
      text: l6('Put the loop back on the tray and turn the gas off at the tap.', 'Leg die Öse zurück aufs Tablett und dreh das Gas am Hahn ab.', 'Deja el asa en la bandeja y cierra el gas en la llave.', 'Repose la boucle sur le plateau et ferme le gaz au robinet.', 'लूप वापस ट्रे पर रखो और नल से गैस बंद करो।', '把丝环放回托盘，在燃气阀处关掉燃气。'),
      hint: l6('Press the loop once more to put it back, then press the gas tap.', 'Drück noch einmal auf die Öse, um sie zurückzulegen, dann auf den Gashahn.', 'Pulsa otra vez el asa para dejarla y luego la llave del gas.', 'Appuie encore sur la boucle pour la reposer, puis sur le robinet de gaz.', 'लूप को वापस रखने के लिए उसे फिर दबाओ, फिर गैस नल दबाओ।', '再按一次丝环放回去，然后按燃气阀。'),
      done: (c) => c.item('bunsen-burner')?.state.p.gasOn === false && c.item('flame-test-kit')?.state.p.held === 'rack',
    },
  ],
  checks: [
    {
      id: 'identified',
      label: l6('Named the right metal', 'Das richtige Metall genannt', 'Metal correcto', 'Le bon métal', 'सही धातु बताई', '金属判断正确'),
      pass: (c) => c.answer('salt') === unknownOf(c),
      detail: (c) => {
        const truth = unknownOf(c) as keyof typeof FLAME_COLOUR;
        const given = c.answer('salt');
        return fill(
          l6('You said {given}. The unknown was {truth}: {colour}.', 'Deine Antwort: {given}. Das Unbekannte war {truth}: {colour}.', 'Dijiste {given}. La desconocida era {truth}: {colour}.', 'Tu as dit {given}. L’inconnu était {truth} : {colour}.', 'तुमने {given} कहा। अज्ञात {truth} था: {colour}।', '你的答案：{given}。未知盐是 {truth}：{colour}。'),
          { given: given === undefined ? '—' : (SALT_NAMES[String(given)] ?? String(given)), truth: SALT_NAMES[truth]!, colour: FLAME_COLOUR_NAMES[FLAME_COLOUR[truth].name]! },
        );
      },
    },
    {
      id: 'safe-light',
      label: l6('Lit the burner safely', 'Brenner sicher angezündet', 'Mechero encendido con seguridad', 'Bec allumé en sécurité', 'बर्नर सुरक्षित जलाया', '安全点燃本生灯'),
      pass: (c) => !c.ever('gas-unlit') && !c.ever('light-collar-open'),
    },
    {
      id: 'clean-loop',
      label: l6('Cleaned the loop before the salt', 'Öse vor dem Salz gereinigt', 'Asa limpiada antes de la sal', 'Boucle nettoyée avant le sel', 'लवण से पहले लूप साफ़ किया', '蘸盐前清洁了丝环'),
      pass: (c) => !c.ever('dirty-loop'),
    },
    {
      id: 'blue-flame',
      label: l6('Used a blue flame', 'Blaue Flamme benutzt', 'Llama azul usada', 'Flamme bleue utilisée', 'नीली लौ इस्तेमाल की', '使用了蓝色火焰'),
      pass: (c) => !c.ever('luminous-flame') && !c.ever('loop-no-flame'),
    },
    {
      id: 'gas-off',
      label: l6('Gas off at the end', 'Gas am Ende aus', 'Gas cerrado al final', 'Gaz fermé à la fin', 'अंत में गैस बंद', '结束时关掉了燃气'),
      pass: (c) => c.item('bunsen-burner')?.state.p.gasOn === false,
    },
  ],
  hazards: [...NOTES['bunsen-burner']!.hazards.slice(0, 2), NOTES['flame-test-kit']!.hazards[0]!],
};

/** The liquids the pH experiment may hide in the beaker, and what each is. */
const PH_LIQUIDS: readonly Liquid[] = ['vinegar', 'soap', 'water', 'copper-sulfate'];
const nature = (ph: number) => (ph < 6.5 ? 'acidic' : ph > 7.5 ? 'alkaline' : 'neutral');
const liquidOf = (seed: number) => pickSeeded(PH_LIQUIDS, seed, 31);

export const PH_OF_A_LIQUID: Experiment = {
  id: 'chemistry/ph',
  lab: 'chemistry',
  title: l6('pH of a liquid', 'pH-Wert einer Flüssigkeit', 'pH de un líquido', 'pH d’un liquide', 'किसी द्रव का pH', '测液体的 pH'),
  goal: l6(
    'Calibrate the pH meter, measure the liquid in the beaker and say whether it is acidic, neutral or alkaline.',
    'Kalibriere das pH-Meter, miss die Flüssigkeit im Becherglas und sag, ob sie sauer, neutral oder basisch ist.',
    'Calibra el medidor de pH, mide el líquido del vaso y di si es ácido, neutro o básico.',
    'Étalonne le pH-mètre, mesure le liquide du bécher et dis s’il est acide, neutre ou basique.',
    'pH मीटर कैलिब्रेट करो, बीकर का द्रव नापो और बताओ कि वह अम्लीय, उदासीन या क्षारीय है।',
    '校准 pH 计，测量烧杯里的液体，判断它是酸性、中性还是碱性。',
  ),
  kit: [
    { kind: 'ph-meter', x: -150, z: 10 },
    { kind: 'beaker-250', x: 90, z: -40, params: (seed) => ({ liquid: liquidOf(seed), volume: 150 }) },
  ],
  steps: [
    {
      id: 'on',
      focus: 'ph-meter',
      text: l6('Switch the pH meter on.', 'Schalte das pH-Meter ein.', 'Enciende el medidor de pH.', 'Allume le pH-mètre.', 'pH मीटर चालू करो।', '打开 pH 计。'),
      hint: l6('Press On on the meter.', 'Drück am Gerät auf Ein.', 'Pulsa Encender en el medidor.', 'Appuie sur Marche sur l’appareil.', 'मीटर पर चालू दबाओ।', '按仪表上的“开”。'),
      done: (c) => c.item('ph-meter')?.state.p.on === true,
    },
    {
      id: 'buffer',
      focus: 'ph-meter',
      text: l6('Put the probe in the pH 7 buffer.', 'Steck die Elektrode in den pH-7-Puffer.', 'Pon la sonda en el tampón de pH 7.', 'Mets la sonde dans le tampon pH 7.', 'प्रोब को pH 7 बफ़र में रखो।', '把探头放进 pH 7 缓冲液。'),
      hint: l6('Press Buffer on the meter.', 'Drück am Gerät auf Puffer.', 'Pulsa Tampón en el medidor.', 'Appuie sur Tampon sur l’appareil.', 'मीटर पर बफ़र दबाओ।', '按仪表上的“缓冲液”。'),
      done: (c) => c.item('ph-meter')?.state.p.probe === 'buffer',
    },
    {
      id: 'calibrate',
      focus: 'ph-meter',
      text: l6('Press Calibrate.', 'Drück auf Kalibrieren.', 'Pulsa Calibrar.', 'Appuie sur Étalonner.', 'कैलिब्रेट दबाओ।', '按“校准”。'),
      hint: l6('The meter must read 7.0 in the buffer once calibrated.', 'Nach dem Kalibrieren muss das Gerät im Puffer 7,0 zeigen.', 'Una vez calibrado, el medidor debe marcar 7,0 en el tampón.', 'Une fois étalonné, l’appareil doit lire 7,0 dans le tampon.', 'कैलिब्रेट होने पर बफ़र में मीटर 7.0 दिखाना चाहिए।', '校准后，仪表在缓冲液中应显示 7.0。'),
      done: (c) => c.item('ph-meter')?.state.s.calibrated === true,
    },
    {
      id: 'rinse',
      focus: 'ph-meter',
      text: l6('Rinse the probe in the clean water.', 'Spül die Elektrode in sauberem Wasser.', 'Enjuaga la sonda en el agua limpia.', 'Rince la sonde dans l’eau propre.', 'प्रोब को साफ़ पानी में धोओ।', '在清水里冲洗探头。'),
      hint: l6('Press Rinse on the meter.', 'Drück am Gerät auf Spülen.', 'Pulsa Enjuagar en el medidor.', 'Appuie sur Rincer sur l’appareil.', 'मीटर पर धोओ दबाओ।', '按仪表上的“冲洗”。'),
      done: (c) => c.item('ph-meter')?.state.p.probe === 'rinse',
    },
    {
      id: 'sample',
      focus: 'beaker-250',
      text: l6('Dip the probe in the beaker and read the pH.', 'Tauch die Elektrode ins Becherglas und lies den pH-Wert ab.', 'Mete la sonda en el vaso y lee el pH.', 'Plonge la sonde dans le bécher et lis le pH.', 'प्रोब को बीकर में डुबोओ और pH पढ़ो।', '把探头伸进烧杯，读出 pH。'),
      hint: l6('Press Sample on the meter.', 'Drück am Gerät auf Probe.', 'Pulsa Muestra en el medidor.', 'Appuie sur Échantillon sur l’appareil.', 'मीटर पर नमूना दबाओ।', '按仪表上的“样品”。'),
      done: (c) => c.item('ph-meter')?.state.p.probe === 'sample',
    },
    {
      id: 'nature',
      text: l6('Is the liquid acidic, neutral or alkaline?', 'Ist die Flüssigkeit sauer, neutral oder basisch?', '¿El líquido es ácido, neutro o básico?', 'Le liquide est-il acide, neutre ou basique ?', 'द्रव अम्लीय, उदासीन या क्षारीय है?', '这种液体是酸性、中性还是碱性？'),
      hint: l6('Below 6.5 is acidic, above 7.5 alkaline.', 'Unter 6,5 ist sauer, über 7,5 basisch.', 'Por debajo de 6,5 es ácido; por encima de 7,5, básico.', 'Sous 6,5 c’est acide, au-dessus de 7,5 basique.', '6.5 से कम अम्लीय, 7.5 से ज़्यादा क्षारीय।', '低于 6.5 为酸性，高于 7.5 为碱性。'),
      ask: {
        key: 'nature',
        choices: [
          { value: 'acidic', label: l6('Acidic', 'Sauer', 'Ácido', 'Acide', 'अम्लीय', '酸性') },
          { value: 'neutral', label: l6('Neutral', 'Neutral', 'Neutro', 'Neutre', 'उदासीन', '中性') },
          { value: 'alkaline', label: l6('Alkaline', 'Basisch', 'Básico', 'Basique', 'क्षारीय', '碱性') },
        ],
        correct: (c) => nature(LIQUID_PH[liquidOf(c.seed)]),
      },
      done: (c) => c.answer('nature') !== undefined,
    },
    {
      id: 'store',
      focus: 'ph-meter',
      text: l6('Rinse the probe and put it back in its cap.', 'Spül die Elektrode und steck sie zurück in die Kappe.', 'Enjuaga la sonda y vuelve a ponerle el capuchón.', 'Rince la sonde et remets-la dans son capuchon.', 'प्रोब धोकर उसे वापस टोपी में रखो।', '冲洗探头，再放回保护帽里。'),
      hint: l6('Press Rinse, then Store.', 'Drück auf Spülen, dann auf Aufbewahren.', 'Pulsa Enjuagar y luego Guardar.', 'Appuie sur Rincer, puis Ranger.', 'धोओ दबाओ, फिर रखो।', '先按“冲洗”，再按“收好”。'),
      done: (c) => c.item('ph-meter')?.state.p.probe === 'stored',
    },
  ],
  checks: [
    {
      id: 'nature',
      label: l6('Named the liquid right', 'Flüssigkeit richtig eingeordnet', 'Líquido bien clasificado', 'Liquide bien classé', 'द्रव सही पहचाना', '液体判断正确'),
      pass: (c) => c.answer('nature') === nature(LIQUID_PH[liquidOf(c.seed)]),
      detail: (c) => fill(l6('Its pH is {ph}.', 'Sein pH-Wert ist {ph}.', 'Su pH es {ph}.', 'Son pH est {ph}.', 'इसका pH {ph} है।', '它的 pH 是 {ph}。'), { ph: LIQUID_PH[liquidOf(c.seed)].toFixed(1) }),
    },
    {
      id: 'calibrated',
      label: l6('Calibrated before measuring', 'Vor dem Messen kalibriert', 'Calibrado antes de medir', 'Étalonné avant de mesurer', 'मापने से पहले कैलिब्रेट किया', '测量前已校准'),
      pass: (c) => !c.ever('ph-not-calibrated'),
    },
    {
      id: 'rinsed',
      label: l6('Rinsed between solutions', 'Zwischen den Lösungen gespült', 'Enjuagado entre disoluciones', 'Rincé entre les solutions', 'घोलों के बीच धोया', '换溶液之间冲洗了'),
      pass: (c) => !c.ever('ph-not-rinsed'),
    },
    {
      id: 'stored',
      label: l6('Probe stored at the end', 'Elektrode am Ende verstaut', 'Sonda guardada al final', 'Sonde rangée à la fin', 'अंत में प्रोब रखा', '结束时收好了探头'),
      pass: (c) => c.item('ph-meter')?.state.p.probe === 'stored',
    },
  ],
  hazards: NOTES['ph-meter']!.hazards,
};
