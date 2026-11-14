/**
 * The design panel's own words, six languages. Everything iynk already says (the numbers' labels, the design checks,
 * the arming rules and their states) comes from iynk's `dronelab` strings through `./text`; this table holds what
 * iynk's 2D page draws as layout instead of text.
 */
import { defineStrings } from '../../shared';

export const designStrings = defineStrings({
  en: {
    title: 'Design',
    battery: 'Battery',
    motor: 'Motor',
    prop: 'Prop',
    price: 'Price',
    thrust: 'Thrust per motor',
    fly: 'Fly',
    willNotArm: 'Will not arm',
    more: '{n} more',
    rules: 'Arming rules',
  },
  de: {
    title: 'Entwurf',
    battery: 'Akku',
    motor: 'Motor',
    prop: 'Propeller',
    price: 'Preis',
    thrust: 'Schub pro Motor',
    fly: 'Fliegen',
    willNotArm: 'Kein Scharfschalten',
    more: '{n} weitere',
    rules: 'Scharfschalt-Regeln',
  },
  es: {
    title: 'Diseño',
    battery: 'Batería',
    motor: 'Motor',
    prop: 'Hélice',
    price: 'Precio',
    thrust: 'Empuje por motor',
    fly: 'Volar',
    willNotArm: 'No se podrá armar',
    more: '{n} más',
    rules: 'Reglas de armado',
  },
  fr: {
    title: 'Conception',
    battery: 'Batterie',
    motor: 'Moteur',
    prop: 'Hélice',
    price: 'Prix',
    thrust: 'Poussée par moteur',
    fly: 'Voler',
    willNotArm: 'Armement refusé',
    more: '{n} de plus',
    rules: "Règles d'armement",
  },
  hi: {
    title: 'डिज़ाइन',
    battery: 'बैटरी',
    motor: 'मोटर',
    prop: 'प्रोपेलर',
    price: 'कीमत',
    thrust: 'प्रति मोटर थ्रस्ट',
    fly: 'उड़ाओ',
    willNotArm: 'आर्म नहीं होगा',
    more: '{n} और',
    rules: 'आर्म करने के नियम',
  },
  zh: {
    title: '设计',
    battery: '电池',
    motor: '电机',
    prop: '螺旋桨',
    price: '价格',
    thrust: '单电机推力',
    fly: '起飞',
    willNotArm: '无法解锁',
    more: '还有 {n} 项',
    rules: '解锁规则',
  },
});

export type DesignKey = Parameters<typeof designStrings.t>[1];
