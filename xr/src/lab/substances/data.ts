/**
 * The classroom substances the chemistry lab can hand out: what a school stockroom has, each with its formula (shown
 * on the container: formulas are international), state, colour, its main hazard and the container it comes in
 * (a solution or liquid in a beaker, a solid in a dish). Solutions are the dilute ones a school uses. Names and aliases
 * are for finding them ("vinegar", "baking soda", "CuSO4"); they are English plus a few common German ones.
 */
export type SubstanceState = 'solution' | 'liquid' | 'solid';
export type Container = 'beaker' | 'dish';
export type Hazard = 'none' | 'irritant' | 'corrosive' | 'toxic' | 'oxidiser' | 'flammable';

export interface Substance {
  readonly id: string;
  readonly name: string;
  readonly formula: string;
  readonly state: SubstanceState;
  /** What it looks like, for the liquid or the powder. */
  readonly hex: string;
  readonly hazard: Hazard;
  readonly aliases: readonly string[];
}

const S = (id: string, name: string, formula: string, state: SubstanceState, hex: string, hazard: Hazard, ...aliases: string[]): Substance => ({ id, name, formula, state, hex, hazard, aliases });

export const SUBSTANCES: readonly Substance[] = [
  S('water', 'Water', 'H₂O', 'liquid', '#d6ecff', 'none', 'h2o', 'distilled water', 'wasser'),
  S('hydrochloric-acid', 'Hydrochloric acid (dilute)', 'HCl', 'solution', '#eef4f0', 'corrosive', 'hcl', 'salzsäure'),
  S('sulfuric-acid', 'Sulfuric acid (dilute)', 'H₂SO₄', 'solution', '#eef2f4', 'corrosive', 'h2so4', 'sulphuric acid', 'schwefelsäure'),
  S('nitric-acid', 'Nitric acid (dilute)', 'HNO₃', 'solution', '#f4f2e6', 'corrosive', 'hno3', 'salpetersäure'),
  S('acetic-acid', 'Acetic acid (vinegar)', 'CH₃COOH', 'solution', '#f4efe0', 'irritant', 'vinegar', 'ethanoic acid', 'essig'),
  S('sodium-hydroxide', 'Sodium hydroxide (dilute)', 'NaOH', 'solution', '#eef0f4', 'corrosive', 'naoh', 'caustic soda', 'lye', 'natronlauge'),
  S('ammonia', 'Ammonia solution', 'NH₃(aq)', 'solution', '#eef4f4', 'irritant', 'nh3', 'ammonium hydroxide'),
  S('limewater', 'Limewater', 'Ca(OH)₂', 'solution', '#f2f4f4', 'irritant', 'calcium hydroxide', 'kalkwasser'),
  S('copper-sulfate', 'Copper(II) sulfate', 'CuSO₄', 'solution', '#3d8fdb', 'toxic', 'cuso4', 'copper sulphate', 'blue vitriol', 'kupfersulfat'),
  S('silver-nitrate', 'Silver nitrate', 'AgNO₃', 'solution', '#eef0f2', 'oxidiser', 'agno3', 'silbernitrat'),
  S('potassium-iodide', 'Potassium iodide', 'KI', 'solution', '#f2f2ec', 'irritant', 'ki', 'kaliumiodid'),
  S('lead-nitrate', 'Lead(II) nitrate', 'Pb(NO₃)₂', 'solution', '#f0f0ee', 'toxic', 'pb(no3)2', 'lead nitrate', 'bleinitrat'),
  S('iron-iii-chloride', 'Iron(III) chloride', 'FeCl₃', 'solution', '#c9822e', 'corrosive', 'fecl3', 'ferric chloride', 'eisenchlorid'),
  S('iron-ii-sulfate', 'Iron(II) sulfate', 'FeSO₄', 'solution', '#cfe5c4', 'irritant', 'feso4', 'ferrous sulfate'),
  S('barium-chloride', 'Barium chloride', 'BaCl₂', 'solution', '#f0f2f2', 'toxic', 'bacl2', 'bariumchlorid'),
  S('sodium-sulfate', 'Sodium sulfate', 'Na₂SO₄', 'solution', '#f0f2f4', 'none', 'na2so4'),
  S('sodium-thiosulfate', 'Sodium thiosulfate', 'Na₂S₂O₃', 'solution', '#f0f2f4', 'none', 'na2s2o3', 'hypo'),
  S('hydrogen-peroxide', 'Hydrogen peroxide (dilute)', 'H₂O₂', 'solution', '#eef2f6', 'oxidiser', 'h2o2', 'peroxide'),
  S('phenolphthalein', 'Phenolphthalein indicator', 'phth', 'solution', '#f6f4f2', 'flammable', 'indicator'),
  S('universal-indicator', 'Universal indicator', 'UI', 'solution', '#7fbf6a', 'flammable', 'pH indicator'),
  S('starch', 'Starch solution', '(C₆H₁₀O₅)ₙ', 'solution', '#f2f0ea', 'none', 'stärke'),
  S('ethanol', 'Ethanol', 'C₂H₅OH', 'liquid', '#f4f6f8', 'flammable', 'alcohol', 'ethyl alcohol', 'spiritus'),
  S('sodium-chloride', 'Sodium chloride (salt)', 'NaCl', 'solid', '#f7f7f3', 'none', 'nacl', 'salt', 'table salt', 'kochsalz', 'salz'),
  S('sodium-bicarbonate', 'Sodium hydrogencarbonate (baking soda)', 'NaHCO₃', 'solid', '#f6f6f2', 'none', 'nahco3', 'baking soda', 'bicarbonate', 'natron'),
  S('sodium-carbonate', 'Sodium carbonate', 'Na₂CO₃', 'solid', '#f4f4f0', 'irritant', 'na2co3', 'washing soda', 'soda'),
  S('calcium-carbonate', 'Calcium carbonate (marble chips)', 'CaCO₃', 'solid', '#e9e6de', 'none', 'caco3', 'chalk', 'marble', 'limestone', 'kalk'),
  S('potassium-permanganate', 'Potassium permanganate', 'KMnO₄', 'solid', '#6b2a7a', 'oxidiser', 'kmno4', 'permanganate', 'kaliumpermanganat'),
  S('copper-oxide', 'Copper(II) oxide', 'CuO', 'solid', '#2d2a28', 'toxic', 'cuo', 'kupferoxid'),
  S('iodine', 'Iodine', 'I₂', 'solid', '#4a2f4f', 'toxic', 'i2', 'iod'),
  S('glucose', 'Glucose', 'C₆H₁₂O₆', 'solid', '#f8f6f0', 'none', 'sugar', 'dextrose', 'traubenzucker'),
  S('zinc', 'Zinc granules', 'Zn', 'solid', '#a9adb3', 'none', 'zn', 'zink'),
  S('magnesium', 'Magnesium ribbon', 'Mg', 'solid', '#c6c9cc', 'flammable', 'mg', 'magnesium strip'),
];

export const containerOf = (s: Substance): Container => (s.state === 'solid' ? 'dish' : 'beaker');

const plain = (t: string) =>
  t
    .toLowerCase()
    .replace(/[₀-₉]/g, (d) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d)))
    .replace(/\b(some|a|an|the|of|bottle|beaker|dish|jar|sample|solution|dilute|please)\b/g, ' ')
    .replace(/[^a-z0-9()]+/g, ' ')
    .trim();

/** A substance by id, name, formula or alias, as the person said it; null when the lab does not stock it. */
export function findSubstance(words: string): Substance | null {
  const w = plain(words);
  if (!w) return null;
  const keys = (s: Substance) => [s.id.replace(/-/g, ' '), plain(s.name), plain(s.formula), ...s.aliases.map(plain)];
  return (
    SUBSTANCES.find((s) => keys(s).includes(w)) ??
    (w.length >= 3 ? SUBSTANCES.find((s) => keys(s).some((k) => k.length >= 3 && (w.includes(k) || k.includes(w)))) : undefined) ??
    null
  );
}
