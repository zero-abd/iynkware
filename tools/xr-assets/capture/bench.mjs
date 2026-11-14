// Bench engine adapter (figures/engine/bench.js): boards, modules, parts and robotics benches.
// The figure's world is Colorfigures coordinates; BP() maps board mm into it with a reflection, which coreToSource
// undoes, so the asset shows the board as its data describes it (docs/XR_ASSETS.md section 2).
const KIND = { boards: 'board', modules: 'module', parts: 'part', robotics: 'bench' };

const matches = (item) => /^(boards|modules|parts|robotics)\//.test(item);

const create = () => ({
  engine: 'bench',
  query: 'power=0',

  async setup(page) {
    const B = page.eval('SL.bench');
    if (!B || !B.st || !B.md) throw new Error(`${page.item}: the bench engine did not start`);
    this.B = B;
    const st = B.st;
    st.view = 'board'; st.power = null; st.sel = null; st.accent = []; st.exploded = false; st.exK = 0; st.xr = 0; st.xrT = 0;
    st.ev = B.evaluate(); st.o = B.outputs();
    this.snap = JSON.stringify({ ctl: st.ctl, o: st.o });
    const G = B.G;
    this.G = { ...G };
    const g = this.G;
    return {
      name: B.md.name, kind: KIND[page.item.split('/')[0]], az: st.az,
      frame: {
        source: 'board-mm', origin: 'footprint-centre', restZ: g.matH - g.top,
        coreToSource: ([X, Y, Z]) => [g.oy + g.pw - Y, g.ox + g.ph - X, Z - g.top],
      },
    };
  },

  partOf(ctx, d, g) {
    // the cutting mat and anything lying in it stays out (the headset has its own bench)
    const z = this.G.matH + 1e-3;
    const pts = [...g.faces.flatMap((f) => f.v), ...g.lines.flatMap((l) => l.pts)];
    if (pts.length && pts.every((p) => p[2] <= z)) return null;
    if (g.text && g.text.o[2] <= z) return null;
    for (let i = ctx.acts.length - 1; i >= 0; i--) { const a = ctx.acts[i]; if ((a.act === 'part' || a.act === 'ctl' || a.act === 'periph') && a.id) return a.id; }
    return '';
  },

  async xray(page, on) { const st = this.B.st; st.xr = st.xrT = on ? 1 : 0; },
  async explode(page, on) { const st = this.B.st; st.exploded = on; st.exK = on ? 1 : 0; },
  async reset() {
    const st = this.B.st, s = JSON.parse(this.snap);
    st.ctl = s.ctl; st.o = s.o; st.xr = st.xrT = 0; st.exploded = false; st.exK = 0;
  },

  parts() {
    const md = this.B.md;
    return md.parts.map((p) => ({ id: p.id, name: p.name, role: p.led ? 'led' : p.control ? 'control' : /header|socket|jack|usb|terminal/i.test(p.kind) ? 'connector' : 'part', group: p.group }));
  },

  async channels() {
    const md = this.B.md, out = [];
    for (const p of md.parts) {
      if (p.led) out.push({ id: `led:${p.id}`, kind: 'emissive', part: p.id, parts: [p.id], value: { unit: 'level', min: 0, max: 1, rest: 0 },
        bind: p.led.net ? { source: 'net', key: p.led.net } : p.led.rail ? { source: 'rail', key: p.led.rail } : p.led.serial ? { source: 'serial', key: String(p.led.serial) } : undefined,
        apply: () => { this.B.st.o.leds[p.id] = 1; } });
    }
    return out;
  },

  async anchors() {
    const md = this.B.md, B = this.B, out = [];
    for (const pin of Object.values(md.pins)) {
      const part = md.byId[pin.part];
      const top = part.side === 'bottom' ? -md.pcb.thick : (part.h || 0) + (part.z || 0);
      out.push({ id: pin.id, kind: 'pin', part: pin.part, position: B.BP(pin.at[0], pin.at[1], top), normal: [0, 0, part.side === 'bottom' ? -1 : 1], aliases: [...new Set([pin.net, pin.label].filter((x) => x && x !== pin.id))] });
    }
    return out;
  },
});

export default { matches, create };
