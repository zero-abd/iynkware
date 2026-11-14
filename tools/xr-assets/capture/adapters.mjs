// Which engine adapter converts an item. An adapter module exports { matches(item), create() }; create() returns one
// fresh adapter object per item, which capture/assemble.mjs drives:
//
//   engine                    'bench' | 'drone' | 'flight' (the sidecar's source.engine)
//   query                     extra ?query for the page (e.g. 'power=0')
//   setup(page, { warn })     put the figure in its rest state (fully built, power off, nothing selected, explode 0,
//                             see-through 0) and return { name, kind, az?, descriptor?, extras?, frame }, where frame is
//                             { source: 'board-mm' | 'flu-mm' | 'range-m', origin: 'footprint-centre' | 'craft-centre' |
//                             'range-origin', restZ: the source z of the surface the item stands on,
//                             coreToSource(p): Colorfigures world point -> source frame (mm) }
//   partOf(ctx, draw, geom)   the part id a draw belongs to ('' for the item itself), or null to leave it out;
//                             ctx.acts lists the data-act groups around it, outermost first ({ act, id, label, part })
//   xray(page, on)            see-through fully on or off
//   explode(page, on)         exploded fully on or off
//   reset(page)               back to the rest state after a channel was driven
//   parts(page)               [{ id, name, parent?, role?, group?, cover?, after?, extras? }]
//   channels(page, { warn })  [{ id, kind, part, parts?: ids whose draws may change, value, bind?, color?, apply(page),
//                             axis?, pivot? (Colorfigures world; else fitted from the motion), angle? (rad at `active`),
//                             amount? (mm at `active`), active? (the value apply() sets; default value.max), scale? (spin:
//                             +1 / -1 about the asset axis) }]
//   anchors(page, ctx)        anchors with position and normal in the Colorfigures world and depth in mm; ctx gives
//                             { marks: label points the figure drew (tags, callouts) in asset metres, warn, toAsset, rest }
import bench from './bench.mjs';
import drone from './drone.mjs';

const ADAPTERS = [bench, drone];

export function adapterFor(item) {
  const make = ADAPTERS.find((a) => a.matches(item));
  return make ? make.create() : null;
}
