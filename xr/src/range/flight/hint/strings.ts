/** The first-flight hint's six-language strings: how to arm and what each stick does, for controllers and for hands. */
import { defineStrings } from '../../shared';

export const HINT_STRINGS = defineStrings({
  en: {
    armController: 'Press A to arm. Left stick: climb and turn. Right stick: fly forward, back and sideways.',
    takeoffController: 'Armed. Push the left stick up to take off. Press A again to disarm.',
    armHand: 'Pinch Hold to arm, on your right, and keep pinching. Then pinch in the air: your left hand climbs and turns, your right hand flies.',
    takeoffHand: 'Armed. Pinch in the air and lift your left hand to take off.',
  },
  de: {
    armController: 'Drück A zum Scharfmachen. Linker Stick: steigen und drehen. Rechter Stick: vor, zurück und seitwärts fliegen.',
    takeoffController: 'Scharf. Drück den linken Stick nach oben zum Abheben. Noch einmal A zum Entschärfen.',
    armHand: 'Kneif rechts auf „Halten zum Scharfmachen“ und halte fest. Dann kneif in die Luft: Die linke Hand steigt und dreht, die rechte fliegt.',
    takeoffHand: 'Scharf. Kneif in die Luft und heb die linke Hand zum Abheben.',
  },
  es: {
    armController: 'Pulsa A para armar. Stick izquierdo: subir y girar. Stick derecho: volar adelante, atrás y de lado.',
    takeoffController: 'Armado. Empuja el stick izquierdo hacia arriba para despegar. Pulsa A otra vez para desarmar.',
    armHand: 'Pellizca «Mantén para armar», a tu derecha, y no sueltes. Luego pellizca en el aire: la mano izquierda sube y gira, la derecha vuela.',
    takeoffHand: 'Armado. Pellizca en el aire y sube la mano izquierda para despegar.',
  },
  fr: {
    armController: 'Appuie sur A pour armer. Manette gauche : monter et tourner. Manette droite : voler en avant, en arrière et de côté.',
    takeoffController: 'Armé. Pousse la manette gauche vers le haut pour décoller. Appuie encore sur A pour désarmer.',
    armHand: 'Pince « Maintenir pour armer », à ta droite, sans lâcher. Puis pince dans l’air : la main gauche monte et tourne, la droite pilote.',
    takeoffHand: 'Armé. Pince dans l’air et lève la main gauche pour décoller.',
  },
  hi: {
    armController: 'आर्म करने के लिए A दबाओ। बायाँ स्टिक: ऊपर उठना और मुड़ना। दायाँ स्टिक: आगे, पीछे और बगल में उड़ना।',
    takeoffController: 'आर्म हो गया। उड़ान भरने के लिए बायाँ स्टिक ऊपर धकेलो। डिसआर्म के लिए फिर से A दबाओ।',
    armHand: 'दाईं ओर "आर्म के लिए दबाए रखो" को चुटकी से पकड़े रखो। फिर हवा में चुटकी लो: बायाँ हाथ ऊपर उठाता और मोड़ता है, दायाँ उड़ाता है।',
    takeoffHand: 'आर्म हो गया। हवा में चुटकी लो और उड़ान भरने के लिए बायाँ हाथ ऊपर उठाओ।',
  },
  zh: {
    armController: '按 A 解锁。左摇杆：升降和转向。右摇杆：前后左右飞行。',
    takeoffController: '已解锁。把左摇杆往上推即可起飞。再按一次 A 上锁。',
    armHand: '捏住右边的“按住解锁”不放。然后在空中捏合：左手升降和转向，右手飞行。',
    takeoffHand: '已解锁。在空中捏合并抬起左手即可起飞。',
  },
});
