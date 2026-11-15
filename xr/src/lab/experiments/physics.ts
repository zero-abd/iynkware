/**
 * Physics: the pendulum's period. Time ten swings at two lengths, compare each period with 2π√(L/g), and work out g.
 */
import { fill, l6, same } from '../text';
import { NOTES } from '../model/catalogue';
import { MIN_SWINGS, periodSmall } from '../model/items/physics';
import type { Experiment, ExpCtx } from './types';

const rep = (c: ExpCtx) => c.item('pendulum-stand')?.report ?? {};
const p = (c: ExpCtx) => c.item('pendulum-stand')?.state.p ?? {};
const near = (T: unknown, L: unknown) => typeof T === 'number' && typeof L === 'number' && L > 0 && Math.abs(T - periodSmall(L)) / periodSmall(L) < 0.02;
const G_CHOICES = [9.0, 9.4, 9.8, 10.2] as const;

export const PENDULUM: Experiment = {
  id: 'physics/pendulum',
  lab: 'physics',
  title: l6('Pendulum period', 'Periode eines Pendels', 'Periodo del péndulo', 'Période du pendule', 'लोलक का आवर्तकाल', '单摆周期'),
  goal: l6(
    'Measure the period at two string lengths, compare it with T = 2π√(L/g) and work out g.',
    'Miss die Periode bei zwei Fadenlängen, vergleiche sie mit T = 2π√(L/g) und bestimme g.',
    'Mide el periodo con dos longitudes de hilo, compáralo con T = 2π√(L/g) y calcula g.',
    'Mesure la période pour deux longueurs de fil, compare-la à T = 2π√(L/g) et calcule g.',
    'धागे की दो लंबाइयों पर आवर्तकाल नापो, T = 2π√(L/g) से तुलना करो और g निकालो।',
    '在两种摆线长度下测量周期，与 T = 2π√(L/g) 比较，并求出 g。',
  ),
  kit: [{ kind: 'pendulum-stand', x: 0, z: -110, params: { length: 400, amplitude: 20 } }],
  steps: [
    {
      id: 'angle',
      focus: 'pendulum-stand',
      text: l6('Set a small release angle: 10 degrees or less.', 'Stell einen kleinen Auslenkwinkel ein: 10 Grad oder weniger.', 'Pon un ángulo de salida pequeño: 10 grados o menos.', 'Choisis un petit angle de lâcher : 10 degrés ou moins.', 'छोटा छोड़ने का कोण रखो: 10 डिग्री या कम।', '设一个小的释放角：10 度或更小。'),
      hint: l6('The formula is only right for small swings.', 'Die Formel stimmt nur für kleine Auslenkungen.', 'La fórmula solo vale para oscilaciones pequeñas.', 'La formule n’est juste que pour de petites oscillations.', 'सूत्र केवल छोटे झूलों के लिए सही है।', '公式只对小幅摆动成立。'),
      done: (c) => (p(c).amplitude as number) <= 10,
    },
    {
      id: 'release',
      focus: 'pendulum-stand',
      text: l6('Release the bob.', 'Lass den Pendelkörper los.', 'Suelta la masa.', 'Lâche la masse.', 'बॉब को छोड़ो।', '释放摆锤。'),
      hint: l6('Press the bob.', 'Drück auf den Pendelkörper.', 'Pulsa la masa.', 'Appuie sur la masse.', 'बॉब दबाओ।', '按一下摆锤。'),
      done: (c) => p(c).swinging === true,
    },
    {
      id: 'count',
      focus: 'pendulum-stand',
      text: fill(l6('Count {n} full swings.', 'Zähl {n} volle Schwingungen.', 'Cuenta {n} oscilaciones completas.', 'Compte {n} oscillations complètes.', '{n} पूरे झूले गिनो।', '数 {n} 次完整摆动。'), { n: MIN_SWINGS }),
      hint: l6('One swing is there and back again.', 'Eine Schwingung ist hin und wieder zurück.', 'Una oscilación es ida y vuelta.', 'Une oscillation, c’est un aller et retour.', 'एक झूला यानी जाना और वापस आना।', '一次摆动是来回一趟。'),
      done: (c) => (rep(c).swings as number) >= MIN_SWINGS,
    },
    {
      id: 'record1',
      focus: 'pendulum-stand',
      text: l6('Press Record to write down the period.', 'Drück auf Notieren, um die Periode aufzuschreiben.', 'Pulsa Anotar para apuntar el periodo.', 'Appuie sur Noter pour écrire la période.', 'आवर्तकाल लिखने के लिए रिकॉर्ड दबाओ।', '按“记录”写下周期。'),
      hint: l6('Record is on the stand’s base.', 'Notieren ist am Fuß des Stativs.', 'Anotar está en la base del soporte.', 'Noter est sur le pied du support.', 'रिकॉर्ड स्टैंड के आधार पर है।', '“记录”在铁架台底座上。'),
      done: (c) => (rep(c).records as number) >= 1,
    },
    {
      id: 'length',
      focus: 'pendulum-stand',
      text: l6('Stop the bob and change the string length.', 'Halt den Pendelkörper an und ändere die Fadenlänge.', 'Para la masa y cambia la longitud del hilo.', 'Arrête la masse et change la longueur du fil.', 'बॉब रोको और धागे की लंबाई बदलो।', '让摆锤停下，改变摆线长度。'),
      hint: l6('Press the bob to stop it, then press Length.', 'Drück auf den Pendelkörper zum Anhalten, dann auf Länge.', 'Pulsa la masa para pararla y luego Longitud.', 'Appuie sur la masse pour l’arrêter, puis sur Longueur.', 'रोकने के लिए बॉब दबाओ, फिर लंबाई दबाओ।', '按摆锤让它停下，再按“长度”。'),
      done: (c) => (rep(c).records as number) >= 1 && p(c).length !== rep(c).r1L,
    },
    {
      id: 'record2',
      focus: 'pendulum-stand',
      text: l6('Release it again, count 10 swings and record.', 'Lass ihn wieder los, zähl 10 Schwingungen und notiere.', 'Suéltalo otra vez, cuenta 10 oscilaciones y anota.', 'Lâche-le à nouveau, compte 10 oscillations et note.', 'फिर छोड़ो, 10 झूले गिनो और रिकॉर्ड करो।', '再次释放，数 10 次摆动后记录。'),
      hint: l6('A longer string swings more slowly.', 'Ein längerer Faden schwingt langsamer.', 'Un hilo más largo oscila más despacio.', 'Un fil plus long oscille plus lentement.', 'लंबा धागा धीरे झूलता है।', '摆线越长，摆得越慢。'),
      done: (c) => (rep(c).records as number) >= 2,
    },
    {
      id: 'g',
      text: l6('Work out g = 4π²L / T² (L in metres). Which is closest?', 'Rechne g = 4π²L / T² (L in Metern). Was kommt am nächsten?', 'Calcula g = 4π²L / T² (L en metros). ¿Cuál se acerca más?', 'Calcule g = 4π²L / T² (L en mètres). Quelle valeur est la plus proche ?', 'g = 4π²L / T² निकालो (L मीटर में)। कौन-सा सबसे पास है?', '计算 g = 4π²L / T²（L 以米为单位）。哪个最接近？'),
      hint: l6('For 0.4 m and 1.27 s: 4 × 9.87 × 0.4 / 1.61.', 'Für 0,4 m und 1,27 s: 4 × 9,87 × 0,4 / 1,61.', 'Para 0,4 m y 1,27 s: 4 × 9,87 × 0,4 / 1,61.', 'Pour 0,4 m et 1,27 s : 4 × 9,87 × 0,4 / 1,61.', '0.4 m और 1.27 s के लिए: 4 × 9.87 × 0.4 / 1.61।', '以 0.4 m、1.27 s 为例：4 × 9.87 × 0.4 / 1.61。'),
      ask: { key: 'g', choices: G_CHOICES.map((g) => ({ value: g, label: same(`${g} m/s²`) })), correct: () => 9.8 },
      done: (c) => c.answer('g') !== undefined,
    },
  ],
  checks: [
    {
      id: 'two-lengths',
      label: l6('Two lengths at least 100 mm apart', 'Zwei Längen mindestens 100 mm auseinander', 'Dos longitudes separadas al menos 100 mm', 'Deux longueurs séparées d’au moins 100 mm', 'कम से कम 100 mm अंतर वाली दो लंबाइयाँ', '两种长度相差至少 100 mm'),
      pass: (c) => (rep(c).records as number) >= 2 && Math.abs((rep(c).r1L as number) - (rep(c).r2L as number)) >= 100,
    },
    {
      id: 'formula',
      label: l6('Both periods match 2π√(L/g)', 'Beide Perioden passen zu 2π√(L/g)', 'Ambos periodos coinciden con 2π√(L/g)', 'Les deux périodes collent à 2π√(L/g)', 'दोनों आवर्तकाल 2π√(L/g) से मेल खाते हैं', '两个周期都符合 2π√(L/g)'),
      pass: (c) => near(rep(c).r1T, rep(c).r1L) && near(rep(c).r2T, rep(c).r2L),
      detail: (c) => {
        const r = rep(c);
        const t = (L: unknown) => (typeof L === 'number' && L > 0 ? periodSmall(L).toFixed(2) : '—');
        return fill(same('L₁ {l1} mm: {t1} s ({f1} s) · L₂ {l2} mm: {t2} s ({f2} s)'), { l1: String(r.r1L), t1: String(r.r1T), f1: t(r.r1L), l2: String(r.r2L), t2: String(r.r2T), f2: t(r.r2L) });
      },
    },
    {
      id: 'small-angle',
      label: l6('Released from a small angle', 'Aus kleinem Winkel losgelassen', 'Soltado desde un ángulo pequeño', 'Lâché d’un petit angle', 'छोटे कोण से छोड़ा', '从小角度释放'),
      pass: (c) => !c.ever('large-angle'),
    },
    {
      id: 'g',
      label: l6('Worked out g', 'g bestimmt', 'Calculó g', 'A calculé g', 'g निकाला', '求出了 g'),
      pass: (c) => c.answer('g') === 9.8,
    },
  ],
  hazards: NOTES['pendulum-stand']!.hazards,
};
