/**
 * The words printed beside an item's controls, in six languages. Printing on the instrument itself (VOLTAGE, 250 mL,
 * the dish symbols) stays as it is; these are the person's handles, so they are translated. The figures' own
 * translations are reused where the same word exists (Gas tap, Air collar, Light, Fill 50 mL, Empty, Swirl).
 */
import { l6, type L6 } from '../text';

export const CONTROL_LABELS = {
  gas: l6('Gas tap', 'Gashahn', 'Llave del gas', 'Robinet de gaz', 'गैस नल', '燃气阀'),
  collar: l6('Air collar', 'Luftregulierung', 'Anillo de aire', 'Virole d’air', 'हवा का कॉलर', '空气调节环'),
  light: l6('Light', 'Anzünden', 'Encender', 'Allumer', 'जलाओ', '点火'),
  fill: l6('Fill 50 mL', '50 mL einfüllen', 'Añadir 50 mL', 'Verser 50 mL', '50 mL भरो', '加 50 毫升'),
  empty: l6('Empty', 'Ausleeren', 'Vaciar', 'Vider', 'खाली करो', '倒空'),
  heat: l6('Hot plate', 'Heizplatte', 'Placa', 'Plaque', 'हॉट प्लेट', '电热板'),
  swirl: l6('Swirl', 'Schwenken', 'Agitar', 'Agiter', 'घुमाओ', '摇匀'),
  record: l6('Record', 'Notieren', 'Anotar', 'Noter', 'रिकॉर्ड', '记录'),
  power: l6('Power', 'Ein/Aus', 'Encender', 'Marche', 'पावर', '电源'),
  output: l6('Output', 'Ausgang', 'Salida', 'Sortie', 'आउटपुट', '输出'),
  measure: l6('Measure', 'Messen', 'Medir', 'Mesurer', 'मापो', '测量'),
  probe: l6('Probe', 'Tastkopf', 'Sonda', 'Sonde', 'प्रोब', '探头'),
  calibrate: l6('Calibrate', 'Kalibrieren', 'Calibrar', 'Étalonner', 'कैलिब्रेट', '校准'),
  buffer: l6('Buffer', 'Puffer', 'Tampón', 'Tampon', 'बफ़र', '缓冲液'),
  rinse: l6('Rinse', 'Spülen', 'Enjuagar', 'Rincer', 'धोओ', '冲洗'),
  sample: l6('Sample', 'Probe', 'Muestra', 'Échantillon', 'नमूना', '样品'),
  store: l6('Store', 'Aufbewahren', 'Guardar', 'Ranger', 'रखो', '收好'),
  wave: l6('Wave', 'Kurvenform', 'Onda', 'Forme', 'तरंग', '波形'),
  freq: l6('Frequency', 'Frequenz', 'Frecuencia', 'Fréquence', 'आवृत्ति', '频率'),
  amp: l6('Amplitude', 'Amplitude', 'Amplitud', 'Amplitude', 'आयाम', '幅度'),
  timeDiv: l6('Time/div', 'Zeit/Teil', 'Tiempo/div', 'Temps/div', 'समय/खाना', '时间/格'),
  voltsDiv: l6('Volts/div', 'Volt/Teil', 'Voltios/div', 'Volts/div', 'वोल्ट/खाना', '伏/格'),
  voltage: l6('Voltage', 'Spannung', 'Tensión', 'Tension', 'वोल्टेज', '电压'),
  current: l6('Current limit', 'Strombegrenzung', 'Límite de corriente', 'Limite de courant', 'करंट सीमा', '限流'),
  load: l6('Load', 'Last', 'Carga', 'Charge', 'लोड', '负载'),
  length: l6('Length', 'Länge', 'Longitud', 'Longueur', 'लंबाई', '长度'),
  angle: l6('Angle', 'Winkel', 'Ángulo', 'Angle', 'कोण', '角度'),
  iron: l6('Iron', 'Lötkolben', 'Soldador', 'Fer', 'आयरन', '烙铁'),
  sponge: l6('Sponge', 'Schwamm', 'Esponja', 'Éponge', 'स्पंज', '海绵'),
  temp: l6('Temperature', 'Temperatur', 'Temperatura', 'Température', 'तापमान', '温度'),
  loop: l6('Loop', 'Öse', 'Asa', 'Boucle', 'लूप', '丝环'),
  acid: l6('Acid', 'Säure', 'Ácido', 'Acide', 'अम्ल', '酸'),
} as const satisfies Record<string, L6>;

export type ControlLabel = keyof typeof CONTROL_LABELS;
