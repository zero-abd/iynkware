/**
 * Tutor notes for the six items ported from the lab figures, in six languages. English is the figures' own
 * (figures/lab/catalogue.json); the names and the say-texts reuse the figures' translations (src/i18n/figures/*.json on
 * the lab-equipment branch) word for word; summaries, safe use and hazards are translated here. `when` is the
 * condition, for a model-backed tutor; it is not shown, so it stays English.
 */
import { l6 } from '../text';
import type { ItemNotes } from './catalogue';

export const FIGURE_NOTES: Readonly<Record<string, ItemNotes>> = {
  'beaker-250': {
    name: l6('250 mL beaker', '250-mL-Becherglas', 'Vaso de precipitados de 250 mL', 'Bécher de 250 mL', '250 mL बीकर', '250 毫升烧杯'),
    summary: l6(
      'A 250 mL glass beaker for holding, mixing and heating liquids. Its marks are only approximate.',
      'Ein 250-mL-Becherglas zum Aufbewahren, Mischen und Erhitzen von Flüssigkeiten. Seine Markierungen sind nur ungefähr.',
      'Un vaso de vidrio de 250 mL para contener, mezclar y calentar líquidos. Sus marcas son solo aproximadas.',
      'Un bécher en verre de 250 mL pour contenir, mélanger et chauffer des liquides. Ses graduations ne sont qu’approximatives.',
      'तरल रखने, मिलाने और गरम करने के लिए 250 mL का काँच का बीकर। इसके निशान केवल अनुमानित हैं।',
      '一个 250 毫升的玻璃烧杯，用来盛放、混合和加热液体。上面的刻度只是近似值。',
    ),
    safeUse: [
      l6('Carry it with one hand under the base, not by the rim.', 'Trag es mit einer Hand unter dem Boden, nicht am Rand.', 'Llévalo con una mano bajo la base, no por el borde.', 'Porte-le avec une main sous le fond, pas par le bord.', 'इसे एक हाथ तली के नीचे रखकर उठाओ, किनारे से नहीं।', '用一只手托住底部拿，不要捏杯口。'),
      l6('When you heat it, fill it to 150 mL at most, so it cannot boil over.', 'Füll es zum Erhitzen höchstens bis 150 mL, damit nichts überkocht.', 'Para calentarlo, llénalo como mucho hasta 150 mL, así no se desborda.', 'Pour le chauffer, remplis-le à 150 mL au plus, pour qu’il ne déborde pas.', 'गरम करते समय इसे अधिक से अधिक 150 mL तक भरो, ताकि उबलकर बाहर न गिरे।', '加热时最多装到 150 毫升，免得沸腾溢出。'),
      l6('Heat it on a hot plate or on a gauze over a tripod, never straight in a flame.', 'Erhitze es auf einer Heizplatte oder auf einem Drahtnetz über einem Dreifuß, nie direkt in der Flamme.', 'Caliéntalo en una placa o sobre una rejilla en un trípode, nunca directamente en la llama.', 'Chauffe-le sur une plaque ou sur une toile métallique posée sur un trépied, jamais directement dans la flamme.', 'इसे हॉट प्लेट पर या तिपाई पर रखी जाली पर गरम करो, सीधे लौ में कभी नहीं।', '放在电热板上或三脚架的石棉网上加热，绝不能直接放进火焰里。'),
      l6('Use a measuring cylinder or pipette when the volume matters.', 'Nimm einen Messzylinder oder eine Pipette, wenn es auf das Volumen ankommt.', 'Usa una probeta o una pipeta cuando el volumen importe.', 'Utilise une éprouvette graduée ou une pipette quand le volume compte.', 'जब आयतन मायने रखे, तो मापक सिलिंडर या पिपेट लो।', '体积要求准确时，用量筒或移液管。'),
      l6('Let hot glass cool before you touch it: hot glass looks the same as cold glass.', 'Lass heißes Glas abkühlen, bevor du es anfasst: Heißes Glas sieht aus wie kaltes.', 'Deja enfriar el vidrio caliente antes de tocarlo: el vidrio caliente parece frío.', 'Laisse refroidir le verre chaud avant de le toucher : le verre chaud ressemble au verre froid.', 'गरम काँच को छूने से पहले ठंडा होने दो: गरम काँच ठंडे जैसा ही दिखता है।', '热玻璃要等它冷却再碰：热玻璃看起来和冷的一样。'),
    ],
    hazards: [
      l6('Hot glass and hot liquid can burn.', 'Heißes Glas und heiße Flüssigkeit verbrennen die Haut.', 'El vidrio y el líquido calientes queman.', 'Le verre et le liquide chauds brûlent.', 'गरम काँच और गरम तरल जला सकते हैं।', '热玻璃和热液体会烫伤。'),
      l6('Chipped or cracked glass can cut and can break when heated.', 'Angeschlagenes oder gesprungenes Glas schneidet und kann beim Erhitzen zerbrechen.', 'El vidrio desportillado o rajado corta y puede romperse al calentarlo.', 'Le verre ébréché ou fêlé coupe et peut casser quand on le chauffe.', 'टूटा या चटका काँच काट सकता है और गरम करने पर फूट सकता है।', '有缺口或裂纹的玻璃会割伤人，加热时还可能破裂。'),
      l6('Some solutions (copper sulfate, potassium permanganate) are harmful: wear goggles and gloves.', 'Manche Lösungen (Kupfersulfat, Kaliumpermanganat) sind gesundheitsschädlich: Trag Schutzbrille und Handschuhe.', 'Algunas disoluciones (sulfato de cobre, permanganato de potasio) son nocivas: usa gafas y guantes.', 'Certaines solutions (sulfate de cuivre, permanganate de potassium) sont nocives : porte lunettes et gants.', 'कुछ घोल (कॉपर सल्फेट, पोटैशियम परमैंगनेट) हानिकारक हैं: चश्मा और दस्ताने पहनो।', '有些溶液（硫酸铜、高锰酸钾）有害：戴好护目镜和手套。'),
    ],
    mistakes: {
      'heating-empty': {
        severity: 'hazard',
        when: 'The hot plate is on and the beaker is empty.',
        say: l6(
          'The beaker is empty on a hot plate: heating dry glass can crack it. Turn the plate off.',
          'Das Becherglas steht leer auf der Heizplatte: Trockenes Glas kann beim Erhitzen springen. Schalte die Platte aus.',
          'El vaso está vacío sobre la placa: calentar vidrio seco puede romperlo. Apaga la placa.',
          'Le bécher est vide sur la plaque : chauffer du verre sec peut le fêler. Éteins la plaque.',
          'बीकर हॉट प्लेट पर खाली है: सूखा काँच गरम करने से चटक सकता है। प्लेट बंद करो।',
          '烧杯空着放在电热板上：干烧玻璃会裂。关掉电热板。',
        ),
      },
      'heating-too-full': {
        severity: 'warn',
        when: 'The hot plate is on with more than 150 mL in the beaker.',
        say: l6(
          'That is too full to heat: it can boil over. Pour some out first.',
          'Das ist zum Erhitzen zu voll: Es kann überkochen. Gieß zuerst etwas ab.',
          'Está demasiado lleno para calentarlo: puede desbordarse al hervir. Vierte un poco antes.',
          'C’est trop plein pour chauffer : ça peut déborder en bouillant. Verse-en d’abord un peu.',
          'यह गरम करने के लिए बहुत भरा है: उबलकर बाहर गिर सकता है। पहले थोड़ा निकाल दो।',
          '太满了，不能加热：会沸腾溢出。先倒掉一些。',
        ),
      },
      overfilled: {
        severity: 'warn',
        when: 'The beaker holds more than its 250 mL mark.',
        say: l6(
          'The beaker is filled past 250 mL: it will spill when you carry it.',
          'Das Becherglas ist über 250 mL gefüllt: Beim Tragen schwappt es über.',
          'El vaso tiene más de 250 mL: se derramará al llevarlo.',
          'Le bécher dépasse 250 mL : il débordera quand tu le porteras.',
          'बीकर 250 mL से ज़्यादा भरा है: उठाने पर छलक जाएगा।',
          '烧杯装得超过 250 毫升：拿起来时会洒出来。',
        ),
      },
    },
  },

  'erlenmeyer-250': {
    name: l6('250 mL conical flask', '250-mL-Erlenmeyerkolben', 'Matraz Erlenmeyer de 250 mL', 'Erlenmeyer de 250 mL', '250 mL शंक्वाकार फ्लास्क', '250 毫升锥形瓶'),
    summary: l6(
      'A 250 mL conical (Erlenmeyer) flask for mixing, swirling and titrations. Its sloping sides keep the liquid in when you swirl it.',
      'Ein 250-mL-Erlenmeyerkolben zum Mischen, Schwenken und Titrieren. Seine schrägen Wände halten die Flüssigkeit beim Schwenken drin.',
      'Un matraz Erlenmeyer de 250 mL para mezclar, agitar y valorar. Sus paredes inclinadas retienen el líquido al agitarlo.',
      'Un erlenmeyer de 250 mL pour mélanger, agiter et titrer. Ses parois inclinées retiennent le liquide quand tu l’agites.',
      'मिलाने, घुमाने और टाइट्रेशन के लिए 250 mL का शंक्वाकार (एर्लेनमेयर) फ्लास्क। इसकी ढलवाँ दीवारें घुमाते समय तरल को अंदर रखती हैं।',
      '一个 250 毫升的锥形瓶（锥形烧瓶），用来混合、摇匀和滴定。倾斜的瓶壁让液体在摇动时不会洒出。',
    ),
    safeUse: [
      l6('Swirl it by moving your wrist in small circles, holding the neck.', 'Schwenk ihn, indem du am Hals hältst und das Handgelenk in kleinen Kreisen bewegst.', 'Agítalo sujetándolo por el cuello y moviendo la muñeca en círculos pequeños.', 'Agite-le en le tenant par le col et en faisant de petits cercles avec le poignet.', 'गर्दन पकड़कर कलाई को छोटे घेरों में घुमाकर इसे घुमाओ।', '握住瓶颈，用手腕画小圈来摇。'),
      l6('Keep it to 150 mL or less when you swirl it, so nothing climbs out.', 'Füll ihn zum Schwenken höchstens bis 150 mL, damit nichts herausschwappt.', 'No pases de 150 mL al agitarlo, para que nada salga.', 'Reste à 150 mL ou moins pour l’agiter, pour que rien ne sorte.', 'घुमाते समय 150 mL या उससे कम रखो, ताकि कुछ बाहर न आए।', '摇动时不超过 150 毫升，免得液体溅出。'),
      l6('Stand it on a white tile under a burette to see a colour change.', 'Stell ihn auf eine weiße Fliese unter die Bürette, um einen Farbumschlag zu sehen.', 'Ponlo sobre una baldosa blanca bajo la bureta para ver el cambio de color.', 'Pose-le sur un carreau blanc sous la burette pour voir le changement de couleur.', 'रंग बदलना देखने के लिए इसे ब्यूरेट के नीचे सफ़ेद टाइल पर रखो।', '放在滴定管下的白瓷板上，便于看清颜色变化。'),
      l6('Never heat it with a stopper in: the pressure can burst it.', 'Erhitze ihn nie mit Stopfen: Der Druck kann ihn sprengen.', 'Nunca lo calientes con el tapón puesto: la presión puede reventarlo.', 'Ne le chauffe jamais bouché : la pression peut le faire éclater.', 'डाट लगाकर इसे कभी गरम मत करो: दबाव से यह फट सकता है।', '绝不要塞着塞子加热：压力会让它炸裂。'),
    ],
    hazards: [
      l6('Glass breaks and cuts.', 'Glas bricht und schneidet.', 'El vidrio se rompe y corta.', 'Le verre casse et coupe.', 'काँच टूटता है और काटता है।', '玻璃会碎，会割伤人。'),
      l6('A stoppered flask can burst when heated.', 'Ein verschlossener Kolben kann beim Erhitzen platzen.', 'Un matraz tapado puede reventar al calentarlo.', 'Un flacon bouché peut éclater quand on le chauffe.', 'डाट लगा फ्लास्क गरम करने पर फट सकता है।', '塞着塞子的烧瓶加热时会炸裂。'),
      l6('Some solutions are harmful: wear goggles.', 'Manche Lösungen sind gesundheitsschädlich: Trag eine Schutzbrille.', 'Algunas disoluciones son nocivas: usa gafas.', 'Certaines solutions sont nocives : porte des lunettes.', 'कुछ घोल हानिकारक हैं: चश्मा पहनो।', '有些溶液有害：戴好护目镜。'),
    ],
    mistakes: {
      'swirl-too-full': {
        severity: 'warn',
        when: 'The flask is swirled with more than 150 mL in it.',
        say: l6(
          'That flask is too full to swirl: keep it under about half full or it will slop out.',
          'Der Kolben ist zum Schwenken zu voll: Halte ihn unter etwa halb voll, sonst schwappt es heraus.',
          'El matraz está demasiado lleno para agitarlo: déjalo por debajo de la mitad o se derramará.',
          'Le flacon est trop plein pour être agité : reste sous la moitié environ, sinon ça déborde.',
          'यह फ्लास्क घुमाने के लिए बहुत भरा है: इसे लगभग आधे से कम रखो, वरना छलक जाएगा।',
          '这个锥形瓶太满了，不能摇：保持在半瓶以下，否则会洒出来。',
        ),
      },
      overfilled: {
        severity: 'warn',
        when: 'The flask holds more than its 250 mL mark.',
        say: l6(
          'The flask is filled past 250 mL: there is no room left to mix.',
          'Der Kolben ist über 250 mL gefüllt: Zum Mischen ist kein Platz mehr.',
          'El matraz tiene más de 250 mL: no queda espacio para mezclar.',
          'Le flacon dépasse 250 mL : il ne reste plus de place pour mélanger.',
          'फ्लास्क 250 mL से ज़्यादा भरा है: मिलाने की जगह नहीं बची।',
          '锥形瓶装得超过 250 毫升：没有空间混合了。',
        ),
      },
    },
  },

  'bunsen-burner': {
    name: l6('Bunsen burner', 'Bunsenbrenner', 'Mechero Bunsen', 'Bec Bunsen', 'बुन्सन बर्नर', '本生灯'),
    summary: l6(
      'A gas burner. The air collar sets the flame: closed gives a yellow safety flame, open gives a hot roaring blue flame.',
      'Ein Gasbrenner. Die Luftregulierung bestimmt die Flamme: geschlossen eine gelbe Sicherheitsflamme, offen eine heiße, rauschende blaue Flamme.',
      'Un quemador de gas. El anillo de aire regula la llama: cerrado da una llama amarilla de seguridad; abierto, una llama azul caliente y rugiente.',
      'Un brûleur à gaz. La virole règle la flamme : fermée, une flamme jaune de sécurité ; ouverte, une flamme bleue chaude et ronflante.',
      'एक गैस बर्नर। हवा का कॉलर लौ तय करता है: बंद हो तो पीली सुरक्षा लौ, खुला हो तो गरम, गरजती नीली लौ।',
      '一种燃气灯。空气调节环决定火焰：关上是黄色安全火焰，打开是又热又呼呼作响的蓝色火焰。',
    ),
    safeUse: [
      l6('Tie back long hair, wear goggles, and stand the burner on a heat-proof mat away from paper.', 'Binde lange Haare zurück, trag eine Schutzbrille und stell den Brenner auf eine hitzefeste Matte, weg von Papier.', 'Recógete el pelo largo, ponte gafas y coloca el mechero sobre una base resistente al calor, lejos del papel.', 'Attache les cheveux longs, mets des lunettes et pose le bec sur un tapis résistant à la chaleur, loin du papier.', 'लंबे बाल बाँधो, चश्मा पहनो, और बर्नर को काग़ज़ से दूर ताप-रोधी मैट पर रखो।', '把长发扎起来，戴好护目镜，把灯放在耐热垫上，远离纸张。'),
      l6('Close the air collar before you light it.', 'Schließ die Luftregulierung, bevor du ihn anzündest.', 'Cierra el anillo de aire antes de encenderlo.', 'Ferme la virole avant de l’allumer.', 'जलाने से पहले हवा का कॉलर बंद करो।', '点火前先关上空气调节环。'),
      l6('Have the lit splint or lighter ready over the barrel before you turn the gas on, then light it at once.', 'Halte den brennenden Span oder das Feuerzeug über das Brennerrohr, bevor du das Gas aufdrehst, und zünde sofort.', 'Ten la astilla encendida o el mechero listo sobre el tubo antes de abrir el gas, y enciéndelo enseguida.', 'Tiens l’allumette ou le briquet allumé au-dessus du tube avant d’ouvrir le gaz, puis allume aussitôt.', 'गैस खोलने से पहले जलती तीली या लाइटर नली के ऊपर तैयार रखो, फिर तुरंत जलाओ।', '开燃气之前，先把点着的木条或点火器放在灯管上方，然后立刻点火。'),
      l6('Open the collar for a hot blue flame only while you are heating something.', 'Öffne die Luftregulierung für die heiße blaue Flamme nur, während du etwas erhitzt.', 'Abre el anillo para la llama azul caliente solo mientras calientas algo.', 'N’ouvre la virole pour la flamme bleue chaude que pendant que tu chauffes quelque chose.', 'गरम नीली लौ के लिए कॉलर तभी खोलो जब कुछ गरम कर रहे हो।', '只有在加热东西时才打开调节环用蓝色火焰。'),
      l6('When you are not heating, close the collar to the yellow safety flame so everyone can see it.', 'Wenn du nichts erhitzt, schließ die Luftregulierung zur gelben Sicherheitsflamme, damit alle sie sehen.', 'Cuando no calientes, cierra el anillo para tener la llama amarilla de seguridad y que todos la vean.', 'Quand tu ne chauffes pas, ferme la virole pour la flamme jaune de sécurité, que tout le monde la voie.', 'जब गरम नहीं कर रहे, कॉलर बंद करके पीली सुरक्षा लौ रखो ताकि सबको दिखे।', '不加热时，关上调节环换成黄色安全火焰，让大家都看得见。'),
      l6('Turn the gas off at the tap when you finish.', 'Dreh das Gas am Hahn ab, wenn du fertig bist.', 'Cierra el gas en la llave cuando termines.', 'Ferme le gaz au robinet quand tu as fini.', 'काम ख़त्म होने पर नल से गैस बंद करो।', '用完后在燃气阀处关掉燃气。'),
    ],
    hazards: [
      l6('Unburnt gas can build up and explode.', 'Unverbranntes Gas kann sich ansammeln und explodieren.', 'El gas sin quemar puede acumularse y explotar.', 'Le gaz non brûlé peut s’accumuler et exploser.', 'बिना जली गैस जमा होकर फट सकती है।', '未燃烧的燃气会积聚并爆炸。'),
      l6('A blue flame is almost invisible in daylight.', 'Eine blaue Flamme ist bei Tageslicht fast unsichtbar.', 'Una llama azul casi no se ve con luz de día.', 'Une flamme bleue est presque invisible en plein jour.', 'नीली लौ दिन की रोशनी में लगभग दिखती नहीं।', '蓝色火焰在日光下几乎看不见。'),
      l6('The barrel stays hot after the flame is out.', 'Das Brennerrohr bleibt heiß, nachdem die Flamme aus ist.', 'El tubo sigue caliente después de apagar la llama.', 'Le tube reste chaud après l’extinction de la flamme.', 'लौ बुझने के बाद भी नली गरम रहती है।', '火焰熄灭后灯管仍然很烫。'),
      l6('Hair, sleeves and paper catch fire.', 'Haare, Ärmel und Papier fangen Feuer.', 'El pelo, las mangas y el papel arden.', 'Les cheveux, les manches et le papier prennent feu.', 'बाल, आस्तीन और काग़ज़ आग पकड़ लेते हैं।', '头发、袖子和纸张会着火。'),
    ],
    mistakes: {
      'gas-unlit': {
        severity: 'escalate',
        when: 'The gas tap has been on for more than 2 seconds with no flame.',
        say: l6(
          'Gas is on but not lit. Turn the gas tap off now, then light it the right way.',
          'Das Gas strömt, aber es brennt nicht. Dreh den Gashahn sofort zu und zünde ihn dann richtig an.',
          'El gas sale pero no está encendido. Cierra la llave del gas ahora y luego enciéndelo como es debido.',
          'Le gaz coule mais n’est pas allumé. Ferme le robinet de gaz tout de suite, puis allume-le correctement.',
          'गैस चालू है पर जली नहीं है। अभी गैस नल बंद करो, फिर सही तरीके से जलाओ।',
          '燃气开着却没有点燃。立刻关上燃气阀，再按正确步骤点火。',
        ),
      },
      'light-collar-open': {
        severity: 'warn',
        when: 'Someone tried to light it with the air collar open, and the gas is still on.',
        say: l6(
          'It will not light with the collar open. Turn the gas off, close the collar, then try again.',
          'Mit offener Luftregulierung zündet er nicht. Dreh das Gas ab, schließ die Luftregulierung und versuch es noch einmal.',
          'Con el anillo de aire abierto no se enciende. Cierra el gas, cierra el anillo y vuelve a intentarlo.',
          'Il ne s’allume pas virole ouverte. Coupe le gaz, ferme la virole, puis réessaie.',
          'कॉलर खुला हो तो यह नहीं जलेगा। गैस बंद करो, कॉलर बंद करो, फिर दोबारा कोशिश करो।',
          '空气调节环开着点不着。先关燃气，关上调节环，再试一次。',
        ),
      },
      'blue-flame-idle': {
        severity: 'warn',
        when: 'A roaring blue flame has burned for over 20 seconds.',
        say: l6(
          'A blue flame is hard to see. If you are not heating, close the collar to the yellow safety flame.',
          'Eine blaue Flamme sieht man kaum. Wenn du nichts erhitzt, schließ die Luftregulierung für die gelbe Sicherheitsflamme.',
          'Una llama azul apenas se ve. Si no estás calentando, cierra el anillo de aire para tener la llama amarilla de seguridad.',
          'Une flamme bleue se voit à peine. Si tu ne chauffes rien, ferme la virole pour avoir la flamme jaune de sécurité.',
          'नीली लौ मुश्किल से दिखती है। अगर तुम कुछ गरम नहीं कर रहे, तो कॉलर बंद करके पीली सुरक्षा लौ कर दो।',
          '蓝色火焰很难看见。如果不在加热，就关上空气调节环，换成黄色安全火焰。',
        ),
      },
    },
  },

  'bench-power-supply': {
    name: l6('Bench power supply', 'Labornetzgerät', 'Fuente de alimentación de laboratorio', 'Alimentation de laboratoire', 'बेंच पावर सप्लाई', '台式稳压电源'),
    summary: l6(
      'A 0-30 V, 0-5 A bench supply. It holds the voltage you set (CV) until the load wants more than the current limit, then it holds the current (CC).',
      'Ein Labornetzgerät mit 0–30 V und 0–5 A. Es hält die eingestellte Spannung (CV), bis die Last mehr als die Strombegrenzung will, dann hält es den Strom (CC).',
      'Una fuente de 0-30 V y 0-5 A. Mantiene la tensión que fijas (CV) hasta que la carga pide más que el límite de corriente; entonces mantiene la corriente (CC).',
      'Une alimentation 0–30 V, 0–5 A. Elle tient la tension réglée (CV) jusqu’à ce que la charge demande plus que la limite de courant, puis elle tient le courant (CC).',
      '0–30 V, 0–5 A की बेंच सप्लाई। यह तुम्हारा सेट किया वोल्टेज (CV) बनाए रखती है, जब तक लोड करंट सीमा से ज़्यादा न माँगे; तब यह करंट (CC) बनाए रखती है।',
      '一台 0–30 V、0–5 A 的台式电源。它保持你设定的电压（CV），直到负载需要的电流超过限流值，然后改为保持电流（CC）。',
    ),
    safeUse: [
      l6('Turn the output off before you connect or change anything.', 'Schalte den Ausgang aus, bevor du etwas anschließt oder änderst.', 'Apaga la salida antes de conectar o cambiar nada.', 'Coupe la sortie avant de brancher ou de modifier quoi que ce soit.', 'कुछ भी जोड़ने या बदलने से पहले आउटपुट बंद करो।', '接线或改动任何东西之前，先关掉输出。'),
      l6('Set the voltage first, then set the current limit a little above what your circuit should draw.', 'Stell zuerst die Spannung ein, dann die Strombegrenzung etwas über das, was deine Schaltung ziehen soll.', 'Fija primero la tensión y luego el límite de corriente un poco por encima de lo que debe consumir tu circuito.', 'Règle d’abord la tension, puis la limite de courant un peu au-dessus de ce que ton circuit doit consommer.', 'पहले वोल्टेज सेट करो, फिर करंट सीमा उतने से थोड़ा ऊपर जितना तुम्हारा सर्किट लेना चाहिए।', '先设电压，再把限流设在电路应有电流稍高一点。'),
      l6('Use red for + and black for -; green is mains earth, not the negative output.', 'Rot für +, Schwarz für −; Grün ist der Schutzleiter, nicht der Minuspol.', 'Usa rojo para + y negro para −; el verde es la tierra de la red, no la salida negativa.', 'Rouge pour +, noir pour − ; le vert est la terre du secteur, pas la sortie négative.', '+ के लिए लाल और − के लिए काला; हरा मेन्स अर्थ है, नेगेटिव आउटपुट नहीं।', '红色接 +，黑色接 −；绿色是市电地线，不是负输出。'),
      l6('If the CC lamp lights when you did not expect it, something draws too much: turn off and check the circuit.', 'Wenn die CC-Lampe unerwartet leuchtet, zieht etwas zu viel Strom: Schalte aus und prüf die Schaltung.', 'Si la luz CC se enciende sin esperarlo, algo consume demasiado: apaga y revisa el circuito.', 'Si le voyant CC s’allume sans que tu t’y attendes, quelque chose consomme trop : coupe et vérifie le circuit.', 'अगर CC लैंप बिना उम्मीद के जले, तो कुछ ज़्यादा करंट ले रहा है: बंद करो और सर्किट जाँचो।', '如果 CC 灯意外亮起，说明有东西电流过大：关掉电源，检查电路。'),
      l6('Never short the output with the current limit turned up.', 'Schließ den Ausgang nie kurz, wenn die Strombegrenzung hoch steht.', 'Nunca cortocircuites la salida con el límite de corriente alto.', 'Ne court-circuite jamais la sortie avec une limite de courant élevée.', 'करंट सीमा ऊँची हो तो आउटपुट को कभी शॉर्ट मत करो।', '限流调高时，绝不要把输出短路。'),
    ],
    hazards: [
      l6('A short or a wrong connection can burn parts and wires.', 'Ein Kurzschluss oder ein falscher Anschluss kann Bauteile und Leitungen verbrennen.', 'Un cortocircuito o una conexión errónea pueden quemar componentes y cables.', 'Un court-circuit ou un mauvais branchement peut brûler composants et fils.', 'शॉर्ट या ग़लत कनेक्शन पुर्ज़ों और तारों को जला सकता है।', '短路或接错线会烧坏元件和导线。'),
      l6('Overloaded resistors get hot enough to burn fingers.', 'Überlastete Widerstände werden heiß genug, um Finger zu verbrennen.', 'Las resistencias sobrecargadas se calientan lo bastante para quemar los dedos.', 'Les résistances surchargées chauffent assez pour brûler les doigts.', 'ओवरलोड रेज़िस्टर इतने गरम हो जाते हैं कि उँगलियाँ जल जाएँ।', '过载的电阻会烫到能烫伤手指。'),
      l6('The mains inside the case is dangerous: never open it while plugged in.', 'Die Netzspannung im Gehäuse ist gefährlich: Öffne es nie, solange es eingesteckt ist.', 'La tensión de red dentro de la caja es peligrosa: nunca la abras enchufada.', 'Le secteur à l’intérieur du boîtier est dangereux : ne l’ouvre jamais branché.', 'केस के अंदर की मेन्स बिजली ख़तरनाक है: प्लग लगे रहते इसे कभी मत खोलो।', '机壳内部有市电，很危险：插着电时绝不要打开。'),
    ],
    mistakes: {
      'short-high-limit': {
        severity: 'hazard',
        when: 'The output is on into a short with the current limit above 1 A.',
        say: l6(
          'That is a short with the current limit turned up. Turn the output off and turn the current limit down.',
          'Das ist ein Kurzschluss bei hoch eingestellter Strombegrenzung. Schalte den Ausgang aus und dreh die Strombegrenzung herunter.',
          'Es un cortocircuito con el límite de corriente alto. Apaga la salida y baja el límite de corriente.',
          'C’est un court-circuit avec une limite de courant élevée. Coupe la sortie et baisse la limite de courant.',
          'यह शॉर्ट है और करंट सीमा ऊँची है। आउटपुट बंद करो और करंट सीमा घटाओ।',
          '这是短路，而且限流调得很高。先关掉输出，再把限流调低。',
        ),
      },
      'resistor-overload': {
        severity: 'escalate',
        when: 'The resistor on the output burns more power than its rating.',
        say: l6(
          'The resistor is burning more than its rating and will overheat. Lower the voltage or use a bigger resistor.',
          'Der Widerstand setzt mehr Leistung um, als er verträgt, und wird überhitzen. Senk die Spannung oder nimm einen größeren Widerstand.',
          'La resistencia disipa más de lo que admite y se sobrecalentará. Baja la tensión o usa una resistencia mayor.',
          'La résistance dissipe plus que sa puissance nominale et va surchauffer. Baisse la tension ou prends une plus grosse résistance.',
          'रेज़िस्टर अपनी रेटिंग से ज़्यादा पावर झेल रहा है और ज़्यादा गरम हो जाएगा। वोल्टेज घटाओ या बड़ा रेज़िस्टर लगाओ।',
          '电阻消耗的功率超过额定值，会过热。降低电压，或换功率更大的电阻。',
        ),
      },
      'limit-at-max': {
        severity: 'warn',
        when: 'The output is on into a load with the current limit at the 5 A maximum.',
        say: l6(
          'The current limit is at maximum, so it protects nothing. Set it just above what the circuit needs.',
          'Die Strombegrenzung steht auf Maximum und schützt so nichts. Stell sie knapp über das ein, was die Schaltung braucht.',
          'El límite de corriente está al máximo, así que no protege nada. Ponlo justo por encima de lo que necesita el circuito.',
          'La limite de courant est au maximum, elle ne protège donc rien. Règle-la juste au-dessus de ce dont le circuit a besoin.',
          'करंट सीमा अधिकतम पर है, इसलिए यह किसी चीज़ को नहीं बचाती। इसे सर्किट की ज़रूरत से थोड़ा ऊपर रखो।',
          '限流开到了最大，等于没有保护。把它设在电路所需电流稍高一点。',
        ),
      },
    },
  },

  'pendulum-stand': {
    name: l6('Simple pendulum', 'Fadenpendel', 'Péndulo simple', 'Pendule simple', 'सरल लोलक', '单摆'),
    summary: l6(
      'A simple pendulum on a retort stand. Its period depends on the string length, T = 2π√(L/g), not on the mass of the bob.',
      'Ein Fadenpendel an einem Stativ. Seine Periode hängt von der Fadenlänge ab, T = 2π√(L/g), nicht von der Masse des Pendelkörpers.',
      'Un péndulo simple en un soporte. Su periodo depende de la longitud del hilo, T = 2π√(L/g), no de la masa.',
      'Un pendule simple sur un support. Sa période dépend de la longueur du fil, T = 2π√(L/g), pas de la masse.',
      'स्टैंड पर लगा एक सरल लोलक। इसका आवर्तकाल धागे की लंबाई पर निर्भर है, T = 2π√(L/g), बॉब के द्रव्यमान पर नहीं।',
      '铁架台上的单摆。它的周期取决于摆线长度，T = 2π√(L/g)，与摆锤质量无关。',
    ),
    safeUse: [
      l6('Clamp the stand to the bench, or put a heavy weight on its base, so it cannot tip.', 'Klemm das Stativ am Tisch fest oder beschwer seinen Fuß, damit es nicht umkippt.', 'Sujeta el soporte a la mesa o pon un peso en su base para que no vuelque.', 'Fixe le support à la table ou leste son pied pour qu’il ne bascule pas.', 'स्टैंड को मेज़ से क्लैंप करो या इसके आधार पर भारी वज़न रखो, ताकि यह न गिरे।', '把铁架台夹在桌上，或在底座上压重物，防止翻倒。'),
      l6('Measure L from the pivot to the centre of the bob.', 'Miss L vom Aufhängepunkt bis zur Mitte des Pendelkörpers.', 'Mide L desde el punto de giro hasta el centro de la masa.', 'Mesure L du point de suspension au centre de la masse.', 'L को धुरी से बॉब के केंद्र तक नापो।', 'L 从悬点量到摆锤中心。'),
      l6('Release the bob from a small angle, under about 15 degrees, without pushing it.', 'Lass den Pendelkörper aus einem kleinen Winkel unter etwa 15 Grad los, ohne ihn anzustoßen.', 'Suelta la masa desde un ángulo pequeño, menos de unos 15 grados, sin empujarla.', 'Lâche la masse depuis un petit angle, sous environ 15 degrés, sans la pousser.', 'बॉब को छोटे कोण से, लगभग 15 डिग्री से कम पर, बिना धक्का दिए छोड़ो।', '从小于约 15 度的小角度释放摆锤，不要推。'),
      l6('Time 10 swings and divide by 10: it is much more accurate than timing one.', 'Stopp 10 Schwingungen und teile durch 10: Das ist viel genauer, als eine zu stoppen.', 'Cronometra 10 oscilaciones y divide entre 10: es mucho más preciso que medir una.', 'Chronomètre 10 oscillations et divise par 10 : c’est bien plus précis que d’en mesurer une.', '10 झूलों का समय नापकर 10 से भाग दो: यह एक झूला नापने से कहीं ज़्यादा सटीक है।', '测 10 次摆动的时间再除以 10：比只测一次准确得多。'),
      l6('Start the timer as the bob passes the lowest point, where it moves fastest.', 'Starte die Stoppuhr, wenn der Pendelkörper den tiefsten Punkt passiert, wo er am schnellsten ist.', 'Pon en marcha el cronómetro cuando la masa pase por el punto más bajo, donde va más rápido.', 'Démarre le chrono quand la masse passe au point le plus bas, là où elle va le plus vite.', 'टाइमर तब शुरू करो जब बॉब सबसे निचले बिंदु से गुज़रे, जहाँ वह सबसे तेज़ चलता है।', '在摆锤经过最低点（速度最快处）时开始计时。'),
    ],
    hazards: [
      l6('A tall stand can tip over: keep the clamp over the base.', 'Ein hohes Stativ kann umkippen: Halt die Klemme über dem Fuß.', 'Un soporte alto puede volcar: mantén la pinza sobre la base.', 'Un grand support peut basculer : garde la pince au-dessus du pied.', 'ऊँचा स्टैंड पलट सकता है: क्लैंप को आधार के ऊपर रखो।', '高的铁架台会翻倒：让夹子保持在底座上方。'),
      l6('A heavy swinging bob can hit faces and glassware.', 'Ein schwerer schwingender Pendelkörper kann Gesichter und Glasgeräte treffen.', 'Una masa pesada oscilando puede golpear caras y material de vidrio.', 'Une masse lourde qui oscille peut heurter visages et verrerie.', 'झूलता भारी बॉब चेहरों और काँच के सामान से टकरा सकता है।', '摆动的重摆锤可能撞到脸和玻璃器皿。'),
    ],
    mistakes: {
      'large-angle': {
        severity: 'warn',
        when: 'The bob is swinging from a release angle above 15 degrees.',
        say: l6(
          'That swing is too big for the formula: release it from under about 15 degrees.',
          'Diese Auslenkung ist zu groß für die Formel: Lass ihn aus weniger als etwa 15 Grad los.',
          'Esa oscilación es demasiado grande para la fórmula: suéltalo desde menos de unos 15 grados.',
          'Cette oscillation est trop grande pour la formule : lâche-le sous environ 15 degrés.',
          'यह झूला सूत्र के लिए बहुत बड़ा है: इसे लगभग 15 डिग्री से कम पर छोड़ो।',
          '摆角太大，公式不适用：从小于约 15 度的位置释放。',
        ),
      },
    },
  },

  'soldering-station': {
    name: l6('Soldering station', 'Lötstation', 'Estación de soldadura', 'Station de soudage', 'सोल्डरिंग स्टेशन', '焊台'),
    summary: l6(
      'A temperature-controlled soldering iron. The tip runs at the dial temperature, about 330 °C for normal work, and looks the same hot or cold.',
      'Ein temperaturgeregelter Lötkolben. Die Spitze hält die eingestellte Temperatur, für normale Arbeit etwa 330 °C, und sieht heiß genauso aus wie kalt.',
      'Un soldador con control de temperatura. La punta trabaja a la temperatura del mando, unos 330 °C para trabajo normal, y parece igual caliente que fría.',
      'Un fer à souder régulé. La panne est à la température du bouton, environ 330 °C pour un travail normal, et paraît la même chaude ou froide.',
      'तापमान-नियंत्रित सोल्डरिंग आयरन। टिप डायल के तापमान पर चलती है, सामान्य काम के लिए लगभग 330 °C, और गरम-ठंडी एक जैसी दिखती है।',
      '一把可控温的电烙铁。烙铁头保持旋钮设定的温度，日常焊接约 330 °C，冷热看起来一样。',
    ),
    safeUse: [
      l6('Always put the iron back in its stand, never down on the bench.', 'Leg den Lötkolben immer in den Ständer, nie auf den Tisch.', 'Deja siempre el soldador en su soporte, nunca sobre la mesa.', 'Repose toujours le fer sur son support, jamais sur la table.', 'आयरन हमेशा स्टैंड में वापस रखो, मेज़ पर कभी नहीं।', '烙铁一定放回支架，绝不放在桌上。'),
      l6('Hold it by the grip only; never touch the metal.', 'Halt ihn nur am Griff; fass nie das Metall an.', 'Sujétalo solo por el mango; nunca toques el metal.', 'Tiens-le uniquement par la poignée ; ne touche jamais le métal.', 'इसे केवल हैंडल से पकड़ो; धातु को कभी मत छुओ।', '只握手柄，绝不碰金属部分。'),
      l6('Use about 320 to 350 °C for normal through-hole soldering.', 'Nimm etwa 320 bis 350 °C für normales Durchsteck-Löten.', 'Usa unos 320 a 350 °C para soldadura normal de agujero pasante.', 'Utilise environ 320 à 350 °C pour la soudure traversante normale.', 'सामान्य थ्रू-होल सोल्डरिंग के लिए लगभग 320 से 350 °C रखो।', '普通直插焊接用约 320 到 350 °C。'),
      l6('Keep the sponge damp, not wet, and wipe the tip on it before each joint.', 'Halt den Schwamm feucht, nicht nass, und wisch die Spitze vor jeder Lötstelle daran ab.', 'Mantén la esponja húmeda, no empapada, y limpia la punta en ella antes de cada soldadura.', 'Garde l’éponge humide, pas trempée, et essuie la panne dessus avant chaque soudure.', 'स्पंज को नम रखो, गीला नहीं, और हर जोड़ से पहले टिप को उस पर पोंछो।', '海绵保持湿润但不滴水，每焊一个点前在上面擦一下烙铁头。'),
      l6('Work with a fan or fume extractor so you do not breathe the flux smoke.', 'Arbeite mit Lüfter oder Absaugung, damit du den Flussmittelrauch nicht einatmest.', 'Trabaja con un ventilador o extractor para no respirar el humo del fundente.', 'Travaille avec un ventilateur ou un extracteur pour ne pas respirer la fumée du flux.', 'पंखे या धुआँ खींचने वाले के साथ काम करो ताकि फ्लक्स का धुआँ साँस में न जाए।', '开着风扇或排烟器工作，别吸入助焊剂烟雾。'),
      l6('Switch it off when you finish or walk away.', 'Schalte ihn aus, wenn du fertig bist oder weggehst.', 'Apágalo cuando termines o te alejes.', 'Éteins-le quand tu as fini ou que tu t’éloignes.', 'काम ख़त्म होने या दूर जाने पर इसे बंद करो।', '用完或离开时关掉它。'),
    ],
    hazards: [
      l6('The tip is around 330 °C and looks cold.', 'Die Spitze hat etwa 330 °C und sieht kalt aus.', 'La punta está a unos 330 °C y parece fría.', 'La panne est à environ 330 °C et paraît froide.', 'टिप लगभग 330 °C की होती है और ठंडी दिखती है।', '烙铁头约 330 °C，看起来却是冷的。'),
      l6('Flux smoke irritates the lungs.', 'Flussmittelrauch reizt die Lunge.', 'El humo del fundente irrita los pulmones.', 'La fumée de flux irrite les poumons.', 'फ्लक्स का धुआँ फेफड़ों को परेशान करता है।', '助焊剂烟雾刺激肺部。'),
      l6('Solder can spit: wear safety glasses.', 'Lot kann spritzen: Trag eine Schutzbrille.', 'El estaño puede salpicar: usa gafas de seguridad.', 'La soudure peut gicler : porte des lunettes de protection.', 'सोल्डर छिटक सकता है: सुरक्षा चश्मा पहनो।', '焊锡可能飞溅：戴好护目镜。'),
    ],
    mistakes: {
      'iron-left-out': {
        severity: 'escalate',
        when: 'The station is on and the iron has been out of its stand for over 15 seconds.',
        say: l6(
          'Put the iron back in its stand when you are not soldering: a hot iron on the bench burns things.',
          'Leg den Lötkolben in den Ständer, wenn du nicht lötest: Ein heißer Kolben auf dem Tisch verbrennt Dinge.',
          'Deja el soldador en su soporte cuando no estés soldando: uno caliente sobre la mesa quema cosas.',
          'Repose le fer sur son support quand tu ne soudes pas : un fer chaud sur la table brûle tout.',
          'जब सोल्डर नहीं कर रहे, आयरन को स्टैंड में रखो: मेज़ पर पड़ा गरम आयरन चीज़ें जला देता है।',
          '不焊接时把烙铁放回支架：放在桌上的热烙铁会烫坏东西。',
        ),
      },
      'too-hot': {
        severity: 'warn',
        when: 'The station is on with the dial at 400 °C or more.',
        say: l6(
          'That is hotter than you need. Around 330 °C is enough; hotter burns the tip and can lift the pads.',
          'Das ist heißer als nötig. Etwa 330 °C reichen; heißer verbrennt die Spitze und kann die Lötpads ablösen.',
          'Está más caliente de lo necesario. Unos 330 °C bastan; más calor quema la punta y puede despegar las pistas.',
          'C’est plus chaud que nécessaire. Environ 330 °C suffisent ; plus chaud brûle la panne et peut décoller les pastilles.',
          'यह ज़रूरत से ज़्यादा गरम है। लगभग 330 °C काफ़ी है; इससे ज़्यादा टिप को जला देता है और पैड उखाड़ सकता है।',
          '温度比需要的高。大约 330 °C 就够了；更高会烧坏烙铁头，还可能让焊盘脱落。',
        ),
      },
      'dry-sponge': {
        severity: 'warn',
        when: 'The station is on with a dry sponge.',
        say: l6(
          'Dampen the sponge first: a dry one melts and does not clean the tip.',
          'Mach den Schwamm erst feucht: Ein trockener schmilzt und reinigt die Spitze nicht.',
          'Humedece primero la esponja: una seca se derrite y no limpia la punta.',
          'Humidifie d’abord l’éponge : une éponge sèche fond et ne nettoie pas la panne.',
          'पहले स्पंज को नम करो: सूखा स्पंज पिघल जाता है और टिप साफ़ नहीं करता।',
          '先把海绵弄湿：干海绵会熔化，也擦不干净烙铁头。',
        ),
      },
    },
  },
};
