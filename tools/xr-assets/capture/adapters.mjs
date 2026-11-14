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
// Optional, used by the lab adapter:
//   a channel's whole: true   its node takes every rest piece of its parts, not only those drawn differently
//   a channel's keep(draw)    only the changed pieces it keeps go into its node (a lamp drawn on a bigger part)
//   a channel's fromActive    its node is what is drawn only while active (a flame not drawn at rest)
//   xrayPart(draw)            the part a see-through-only piece belongs to, when not the one it is drawn under
//   staticNode(draw)          a static node of its own for a rest piece ('static.liquid', 'static.glass'), or null
//   nodeOpacity(name)         [at see-through 0, at 1] for such a node drawn translucent, or null
//   notDrawn(attrs)           true for a 2D path that is not the item (a mat grid), so it is not counted as dropped
import bench from './bench.mjs';
import drone from './drone.mjs';
import lab from './lab.mjs';

const ADAPTERS = [bench, drone, lab];

export function adapterFor(item) {
  const make = ADAPTERS.find((a) => a.matches(item));
  return make ? make.create() : null;
}
