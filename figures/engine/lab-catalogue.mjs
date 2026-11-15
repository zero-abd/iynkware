// The lab catalogue (figures/lab/catalogue.json): every lab item's name, tutor notes (summary, safe use, mistakes,
// hazards), params, actions, report keys, parts, XR anchors and channels, read from the item files themselves by
// running each page in jsdom (SL.lab.catalogue). The voice tutor and the XR converter read the JSON without running a
// page; lab.test.mjs fails when it falls out of step with the item files.
//
//   node figures/engine/lab-catalogue.mjs           rewrites figures/lab/catalogue.json
//   node figures/engine/lab-catalogue.mjs --check   exits 1 when it is out of date
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFigure, loadFigure } from './testkit.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
export const CATALOGUE = join(ROOT, 'figures/lab/catalogue.json');
export const labIds = () => readdirSync(join(ROOT, 'figures/lab')).filter((f) => f.endsWith('.js') && !f.startsWith('_')).map((f) => f.slice(0, -3)).sort();

/** The catalogue as the item files define it today. */
export async function buildCatalogue() {
  const items = [];
  for (const id of labIds()) {
    const page = await loadFigure(buildFigure(`lab/${id}`), { path: `/figures/lab/${id}.html`, frozenClock: true });
    try {
      const notes = page.notes();
      if (notes.length) throw new Error(`lab/${id}: ${notes.join('; ')}`);
      items.push(JSON.parse(JSON.stringify(page.lab.catalogue(id))));
    } finally {
      page.close();
    }
  }
  return {
    schema: 'iynkware.lab-catalogue/1',
    generated: 'node figures/engine/lab-catalogue.mjs (do not edit by hand; docs/FIGURES-LAB.md)',
    frame: 'mm in the item frame: x to the item\'s right, y away from its front, z up from the mat, origin at the centre of foot on the mat (the bench board-mm frame, docs/XR_ASSETS.md section 2)',
    items,
  };
}

export const serialize = (cat) => JSON.stringify(cat, null, 2) + '\n';

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const text = serialize(await buildCatalogue());
  if (process.argv.includes('--check')) {
    const same = readFileSync(CATALOGUE, 'utf8') === text;
    console.log(same ? 'figures/lab/catalogue.json is up to date' : 'figures/lab/catalogue.json is out of date: run node figures/engine/lab-catalogue.mjs');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(CATALOGUE, text);
  console.log(`wrote figures/lab/catalogue.json (${JSON.parse(text).items.length} items)`);
}
