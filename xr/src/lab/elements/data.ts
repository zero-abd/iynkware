/**
 * The 118 elements for the periodic table panel: symbol, where it sits (row and column of the usual 18-column layout,
 * with the lanthanides and actinides in two rows below), its family and its state at room temperature. Symbols and
 * atomic numbers are international, so nothing here needs translating. Pure and tested.
 */
const SYMBOLS =
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');

export type Family =
  | 'alkali'
  | 'alkaline-earth'
  | 'transition'
  | 'post-transition'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'noble-gas'
  | 'lanthanide'
  | 'actinide';
export type Phase = 'solid' | 'liquid' | 'gas';

export interface Element {
  readonly z: number;
  readonly symbol: string;
  /** 1 to 7 for the main table; 9 and 10 for the lanthanide and actinide rows drawn below it. */
  readonly row: number;
  /** 1 to 18. */
  readonly col: number;
  readonly family: Family;
  readonly phase: Phase;
}

const set = (s: string) => new Set(s.split(' ').map(Number));
const ALKALI = set('3 11 19 37 55 87');
const ALKALINE = set('4 12 20 38 56 88');
const METALLOID = set('5 14 32 33 51 52');
const NONMETAL = set('1 6 7 8 15 16 34');
const HALOGEN = set('9 17 35 53 85 117');
const NOBLE = set('2 10 18 36 54 86 118');
const POST = set('13 31 49 50 81 82 83 84 113 114 115 116');
const GAS = set('1 2 7 8 9 10 17 18 36 54 86');
const LIQUID = set('35 80');

function place(z: number): { row: number; col: number } {
  if (z === 1) return { row: 1, col: 1 };
  if (z === 2) return { row: 1, col: 18 };
  if (z <= 18) {
    const start = z <= 10 ? 3 : 11;
    const row = z <= 10 ? 2 : 3;
    const i = z - start;
    return { row, col: i < 2 ? i + 1 : i + 11 };
  }
  if (z <= 54) {
    const start = z <= 36 ? 19 : 37;
    return { row: z <= 36 ? 4 : 5, col: z - start + 1 };
  }
  const start = z <= 86 ? 55 : 87;
  const row = z <= 86 ? 6 : 7;
  const i = z - start;
  if (i < 2) return { row, col: i + 1 };
  // the f-block: La..Lu and Ac..Lr in their own rows, from column 3
  if (i <= 16) return { row: row + 3, col: i + 1 };
  return { row, col: i - 13 };
}

function family(z: number): Family {
  if (ALKALI.has(z)) return 'alkali';
  if (ALKALINE.has(z)) return 'alkaline-earth';
  if (z >= 57 && z <= 71) return 'lanthanide';
  if (z >= 89 && z <= 103) return 'actinide';
  if (METALLOID.has(z)) return 'metalloid';
  if (NONMETAL.has(z)) return 'nonmetal';
  if (HALOGEN.has(z)) return 'halogen';
  if (NOBLE.has(z)) return 'noble-gas';
  if (POST.has(z)) return 'post-transition';
  return 'transition';
}

export const ELEMENTS: readonly Element[] = SYMBOLS.map((symbol, i) => {
  const z = i + 1;
  return { z, symbol, ...place(z), family: family(z), phase: GAS.has(z) ? 'gas' : LIQUID.has(z) ? 'liquid' : 'solid' };
});

export const elementBySymbol = (s: string): Element | undefined => ELEMENTS.find((e) => e.symbol.toLowerCase() === s.trim().toLowerCase());

/** Tile colours by family: soft tints that keep ink text readable. */
export const FAMILY_HEX: Readonly<Record<Family, string>> = {
  alkali: '#f4a582',
  'alkaline-earth': '#fdd49e',
  transition: '#c6dbef',
  'post-transition': '#d9d9d9',
  metalloid: '#c7e9c0',
  nonmetal: '#ffffb2',
  halogen: '#b3e2cd',
  'noble-gas': '#decbe4',
  lanthanide: '#fbb4c4',
  actinide: '#e5c494',
};
