// The drone adapter and the handedness proof (docs/XR_ASSETS.md sections 2, 5, 7, 8): the asset holds the craft data's
// true geometry, not the mirror image the 2D figure shows. Motor anchors sit where the data puts each motor after the
// documented mapping (asset X = craft y, Y = z, Z = x), every motor's numbering and spin match the craft data and the
// figure's own motor test, each prop node is centred on its motor, and the files validate.
// node --test test/drone.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, capture } from '../capture/assemble.mjs';
import { adapterFor } from '../capture/adapters.mjs';
import { buildPage, loadPage } from '../capture/page.mjs';
import { axisAngle, fitRigid as rigidFit } from '../capture/fit.mjs';
import { allItems } from '../build.mjs';
import { validateGlb, sidecarErrors } from './validate.mjs';

const MM = 0.001;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);
const mean = (ps) => ps.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / ps.length);
const near = (a, b, tol, msg) => assert.ok(len(sub(a, b)) <= tol, `${msg}: [${a.map((v) => v.toFixed(5))}] vs [${b.map((v) => v.toFixed(5))}]`);
/** fromSource (column-major 4x4) applied to a craft point in mm */
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
const det3 = (m) => dot([m[0], m[1], m[2]], cross([m[4], m[5], m[6]], [m[8], m[9], m[10]]));

/** The craft as its own page knows it: SD.craft() motors, SD.motorsOf(frame), and the 2D projection SD.Pb. */
async function craftOf(item) {
  const page = await loadPage(buildPage(item).html, item);
  const SD = page.eval('SL.drone'), craft = SD.craft();
  SD.ui().render();                                  // scene() sets SD.G for this craft's mat
  // copied out of the page's realm (its arrays have another Array.prototype)
  const own = (v) => JSON.parse(JSON.stringify(v));
  const motors = own(craft.motors.map((m) => ({ id: m.id, x: m.x, y: m.y, z: m.z, dir: m.dir, tilt: m.tilt || 0 })));
  const fromLayout = own(SD.motorsOf(craft.frame).map((m) => ({ id: m.id, x: m.x, y: m.y, dir: m.dir })));
  return { page, SD, craft, motors, fromLayout };
}

const results = new Map();
async function converted(item) {
  if (!results.has(item)) results.set(item, convert(item, adapterFor(item)));
  return results.get(item);
}

/** Minimal glb reader: node by name with its translation and every primitive's POSITION, node-local metres. */
function readGlb(buf) {
  const jsonLen = buf.readUInt32LE(12), json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(28 + jsonLen);
  return {
    json,
    node(name) {
      const n = json.nodes.find((q) => q.name === name);
      if (!n) return null;
      const pts = [];
      for (const pr of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[pr.attributes.POSITION], bv = json.bufferViews[acc.bufferView], stride = bv.byteStride || 12;
        const o = (bv.byteOffset || 0) + (acc.byteOffset || 0);
        for (let i = 0; i < acc.count; i++) pts.push([0, 1, 2].map((k) => bin.readFloatLE(o + i * stride + k * 4)));
      }
      return { translation: n.translation || [0, 0, 0], pts };
    },
  };
}

/** Rotates motor i's rotor the way the figure's motor-direction test does (drone.js step(): spin += dir x 20 x dt x
    rpm, CW negative) and returns the rigid turn of the prop's drawing, as a signed angle about the channel's asset axis. */
async function figureTurn(item, i, assetAxis) {
  const adapter = adapterFor(item), page = await loadPage(buildPage(item).html, item);
  try {
    const info = await adapter.setup(page, { warn() {} });
    const mo = adapter.craft.motors[i], st = adapter.st;
    const rest = capture(page, adapter).draws.filter((d) => d.part === 'PROPS');
    st.spin[i] += (mo.dir === 'CW' ? -1 : 1) * 20 * 0.02 * 1;      // one motor-test frame at full rpm, dt 0.02 s
    const act = capture(page, adapter).draws.filter((d) => d.part === 'PROPS');
    const keys = new Set(act.map((d) => d.geo)), rkeys = new Set(rest.map((d) => d.geo));
    const gone = rest.filter((d) => !keys.has(d.geo)), came = act.filter((d) => !rkeys.has(d.geo));
    const vs = (d) => [...d.faces.flatMap((f) => f.v), ...d.lines.flatMap((l) => l.pts)];
    const P = [], Q = [];
    for (const g of gone) {
      const a = vs(g), ca = mean(a);
      const best = came.filter((c) => vs(c).length === a.length).sort((x, y) => len(sub(mean(vs(x)), ca)) - len(sub(mean(vs(y)), ca)))[0];
      if (best) { P.push(...a); Q.push(...vs(best)); }
    }
    assert.ok(P.length >= 3, `${item} ${mo.id}: the prop's drawing follows the rotor angle`);
    const fit = rigidFit(P, Q), aa = axisAngle(fit, mean(P));
    assert.ok(fit.rms < 0.01, `${item} ${mo.id}: the prop turns rigidly (rms ${fit.rms} mm)`);
    // Colorfigures world -> asset: the adapter's coreToSource (a translation) then flu-mm (y, z, x), a rotation
    const s = (p) => info.frame.coreToSource(p), o = s([0, 0, 0]), q = sub(s(aa.axis), o);
    const axis = [q[1], q[2], q[0]];
    return aa.angle * dot(axis, assetAxis);
  } finally { page.close(); }
}

// Betaflight quad-x (docs/FIGURES-DRONE.md section 4): M1 rear-right CW, M2 front-right CCW, M3 rear-left CCW,
// M4 front-left CW. Asset +X is the craft's left, +Z its nose.
const QUADRANT = { M1: [-1, -1], M2: [-1, 1], M3: [1, -1], M4: [1, 1] };

test('quad5: frame is flu-mm at the craft centre, a rotation and a scale, not mirrored', async () => {
  const { sidecar } = await converted('drones/quad5');
  assert.equal(sidecar.frame.source, 'flu-mm');
  assert.equal(sidecar.frame.origin, 'craft-centre');
  const m = sidecar.frame.fromSource;
  assert.ok(det3(m) > 0, `det(fromSource) = ${det3(m)} must be positive`);
  assert.ok(Math.abs(det3(m) - MM ** 3) < 1e-15, 'a uniform 0.001 scale');
  // the documented mapping: asset X = craft y (left), Y = z (up), Z = x (forward)
  near(apply(m, [1, 0, 0]), [0, 0, MM], 1e-12, 'craft +x (nose) is asset +Z');
  near(apply(m, [0, 1, 0]), [MM, 0, 0], 1e-12, 'craft +y (left) is asset +X');
  near(apply(m, [0, 0, 1]), [0, MM, 0], 1e-12, 'craft +z (up) is asset +Y');
  near(apply(m, [0, 0, 0]), [0, 0, 0], 1e-12, 'origin: craft centre, on the mat');
});

test('quad5: motor anchors sit where the craft data puts them; numbering and spin are Betaflight\'s', async () => {
  const { sidecar } = await converted('drones/quad5');
  const { page, motors, fromLayout } = await craftOf('drones/quad5');
  page.close();
  assert.deepEqual(motors.map((m) => [m.id, m.dir]), fromLayout.map((m) => [m.id, m.dir]), 'craft.motors is SD.motorsOf(frame)');
  assert.deepEqual(motors.map((m) => m.id), ['M1', 'M2', 'M3', 'M4']);
  const A = new Map(sidecar.anchors.map((a) => [a.id, a]));
  for (const mo of motors) {
    for (const kind of ['motor', 'prop']) {
      const a = A.get(`${kind}:${mo.id}`);
      assert.ok(a, `${kind}:${mo.id} anchor`);
      assert.equal(a.kind, kind);
      assert.equal(a.dir, mo.dir, `${a.id} dir is the craft data's`);
      const want = apply(sidecar.frame.fromSource, [mo.x, mo.y, 0]);
      assert.ok(Math.abs(a.position[0] - want[0]) < 0.5 * MM && Math.abs(a.position[2] - want[2]) < 0.5 * MM, `${a.id} at the data's x, y: ${a.position} vs ${want}`);
      near(a.normal, [0, 1, 0], 1e-6, `${a.id} normal is the motor axis (up)`);
      const [sx, sz] = QUADRANT[mo.id];
      assert.equal(Math.sign(a.position[0]), sx, `${a.id}: asset X sign (- is the craft's right)`);
      assert.equal(Math.sign(a.position[2]), sz, `${a.id}: asset Z sign (- is the craft's rear)`);
    }
  }
  assert.equal(A.get('motor:M1').dir, 'CW');
  assert.ok(A.get('motor:M1').position[0] < 0 && A.get('motor:M1').position[2] < 0, 'M1 rear-right: X < 0, Z < 0');
  assert.ok(A.get('motor:M2').position[0] < 0 && A.get('motor:M2').position[2] > 0, 'M2 front-right: X < 0, Z > 0');
  // the prop sits above its motor on the same axis
  for (const mo of motors) assert.ok(A.get(`prop:${mo.id}`).position[1] > A.get(`motor:${mo.id}`).position[1]);
});

test('quad5: each prop channel spins its own prop about its motor, CW as -1 about +Y', async () => {
  const { sidecar, glb } = await converted('drones/quad5');
  const g = readGlb(glb), A = new Map(sidecar.anchors.map((a) => [a.id, a]));
  const Rp = 5 * 25.4 / 2 * MM;
  for (const id of ['M1', 'M2', 'M3', 'M4']) {
    const ch = sidecar.channels.find((c) => c.id === `prop:${id}`), m = A.get(`motor:${id}`);
    assert.ok(ch, `prop:${id} channel`);
    assert.equal(ch.kind, 'spin');
    assert.equal(ch.part, 'PROPS');
    assert.deepEqual(ch.nodes, [`prop:${id}`]);
    assert.deepEqual(ch.bind, { source: 'motor', key: id });
    assert.equal(ch.value.unit, 'rpm');
    assert.equal(ch.value.rest, 0);
    assert.ok(ch.value.max >= 20000 && ch.value.max <= 60000, `a 5-inch's top speed: ${ch.value.max} rpm`);
    near(ch.axis, [0, 1, 0], 1e-6, `prop:${id} axis`);
    assert.equal(ch.scale, m.dir === 'CW' ? -1 : 1, `prop:${id} spin sense follows dir ${m.dir}`);
    assert.equal(A.get(`prop:${id}`).channel, `prop:${id}`);
    // the node: its origin is the pivot, on the motor's axis, and its geometry is centred on that axis
    const n = g.node(`prop:${id}`);
    assert.ok(n && n.pts.length > 50, `prop:${id} node has the blades`);
    near(n.translation, ch.pivot, 1e-6, `prop:${id} node translation is the pivot`);
    assert.ok(Math.hypot(ch.pivot[0] - m.position[0], ch.pivot[2] - m.position[2]) < 0.1 * MM, `prop:${id} pivot on the motor axis`);
    const c = mean(n.pts);
    assert.ok(Math.hypot(c[0], c[2]) < 3 * MM, `prop:${id} geometry centred on its motor (off by ${(Math.hypot(c[0], c[2]) / MM).toFixed(2)} mm)`);
    const reach = Math.max(...n.pts.map((p) => Math.hypot(p[0], p[2])));
    assert.ok(reach > 0.9 * Rp && reach < 1.05 * Rp, `prop:${id} reaches the blade tips (${(reach / MM).toFixed(1)} mm of ${(Rp / MM).toFixed(1)})`);
    // the bell's spokes turn with it, in their own node
    const mc = sidecar.channels.find((q) => q.id === `motor:${id}`);
    assert.ok(mc && mc.scale === ch.scale && mc.part === 'MOTORS', `motor:${id} channel turns the bell the same way`);
  }
  // the parts that carry those nodes
  const props = sidecar.parts.find((p) => p.id === 'PROPS');
  assert.deepEqual([...props.nodes].sort(), ['prop:M1', 'prop:M2', 'prop:M3', 'prop:M4']);
});

test('quad5: the asset spins each prop the way the figure\'s own motor-direction test turns it', async () => {
  const { sidecar } = await converted('drones/quad5');
  for (const [i, id] of ['M1', 'M2', 'M3', 'M4'].entries()) {
    const ch = sidecar.channels.find((c) => c.id === `prop:${id}`);
    const turn = await figureTurn('drones/quad5', i, ch.axis);
    assert.ok(Math.abs(Math.abs(turn) - 0.4) < 1e-3, `${id}: the figure turned it 0.4 rad (${turn})`);
    assert.equal(Math.sign(turn), ch.scale, `${id}: the figure's motor test turns it ${turn > 0 ? '+' : '-'} about the asset axis; the channel's scale is ${ch.scale}`);
  }
});

test('quad5: glb validates and the sidecar matches the schema', async () => {
  const { sidecar, glb } = await converted('drones/quad5');
  const v = await validateGlb(glb);
  assert.equal(v.errors, 0, JSON.stringify(v.issues.slice(0, 5)));
  assert.deepEqual(sidecarErrors(sidecar), []);
  assert.equal(sidecar.kind, 'drone');
  assert.equal(sidecar.source.engine, 'drone');
  assert.ok(sidecar.bounds.min[1] >= -1e-6, 'nothing below the mat');
  // labels: a tag per part, the see-through callouts in the xray layer
  const L = sidecar.anchors.filter((a) => a.kind === 'label');
  assert.ok(L.some((a) => a.id === 'label:FC' && a.layer === 'base' && a.text === 'FLIGHT CTRL'));
  assert.ok(L.some((a) => a.id === 'label:FC.1' && a.layer === 'xray' && a.text === 'GYRO ICM-42688-P'));
  assert.ok(sidecar.anchors.some((a) => a.id === 'port:XT60' && a.normal[2] < -0.99), 'XT60 faces the rear (-Z)');
  // explode: each part rises by its own z x the craft's explode factor (12 mm on quad5)
  const fc = sidecar.parts.find((p) => p.id === 'FC');
  near(fc.explode, [0, 3 * 12 * MM, 0], 1e-6, 'FC explode');
  assert.equal(sidecar.parts.find((p) => p.id === 'TOP').cover, true);
});

test('the 2D figure is the mirror image: SD.Pb puts motors on the screen side a true camera would not', async () => {
  const { page, SD, motors } = await craftOf('drones/quad5');
  try {
    // the Colorfigures camera at the default view (yaw 45, pitch 35.26): right R, up U, towards the viewer V
    const cam = page.eval('({ R: CAM_R, U: CAM_U, V: CAM_V })');
    const RxU = cross(cam.R, cam.U);
    near(RxU, cam.V.map((v) => -v), 1e-9, 'R x U = -V: the camera is mirrored');
    const c = SD.Pb(0, 0, 0), screenX = (m) => SD.Pb(m.x, m.y, 0)[0] - c[0];
    // a true camera at the same eye (towards-viewer V, up U) has right = U x V = -R
    const trueRight = cross(cam.U, cam.V), trueX = (m) => dot([m.x, m.y, 0], trueRight);
    const M = Object.fromEntries(motors.map((m) => [m.id, m]));
    // M2 (front-right in the data) is drawn right of the centre; a true camera from the same eye shows it on the left
    assert.ok(screenX(M.M2) > 50, `SD.Pb(M2) is ${screenX(M.M2).toFixed(1)} right of the centre`);
    assert.ok(trueX(M.M2) < -50, `a true camera puts M2 ${trueX(M.M2).toFixed(1)} mm left of the centre`);
    // M1 (rear-right) and M4 (front-left) lie on the line of sight at this yaw; M3 (rear-left) mirrors M2
    assert.ok(screenX(M.M3) < -50 && trueX(M.M3) > 50, 'M3 swaps sides the same way');
    // seen from above, M1 -> M2 -> M4 runs counter-clockwise in the data; on the screen (y down) it runs the other way
    const turnOf = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.sign(s); };
    const data = turnOf(['M1', 'M2', 'M4'].map((k) => [M[k].x, M[k].y]));
    const screen = -turnOf(['M1', 'M2', 'M4'].map((k) => SD.Pb(M[k].x, M[k].y, 0)));          // flip y-down to y-up
    assert.equal(data, 1, 'M1 -> M2 -> M4 is counter-clockwise from above in the craft data');
    assert.equal(screen, -1, 'and clockwise on the 2D screen: a mirror image');
    // so the motor test's arrow for M1, which the engine draws turning CW about +z, turns counter-clockwise on screen
    const pts = Array.from({ length: 9 }, (_, i) => { const a = -i / 8 * 1.6 * Math.PI; return SD.Pb(M.M1.x + 22 * Math.cos(a), M.M1.y + 22 * Math.sin(a), 40); });
    assert.equal(-turnOf(pts), 1, 'a CW arc around M1 in the data reads as counter-clockwise in the 2D figure');
  } finally { page.close(); }
});

test('agrihex: ArduPilot hex-x numbering lands where the data says (M1 at 90 deg = the craft\'s right)', async () => {
  const { sidecar, glb } = await converted('drones/agrihex');
  const { page, motors, fromLayout } = await craftOf('drones/agrihex');
  page.close();
  assert.equal(motors.length, 6);
  const A = new Map(sidecar.anchors.map((a) => [a.id, a]));
  // docs/FIGURES-DRONE.md: M1 90 CW, M2 270 CCW, M3 330 CW, M4 150 CCW, M5 30 CCW, M6 210 CW (clockwise from the nose)
  const ANG = { M1: [90, 'CW'], M2: [270, 'CCW'], M3: [330, 'CW'], M4: [150, 'CCW'], M5: [30, 'CCW'], M6: [210, 'CW'] };
  const byLayout = new Map(fromLayout.map((m) => [m.id, m]));
  const R = motors[0].x ** 2 + motors[0].y ** 2;
  for (const mo of motors) {
    const a = A.get(`motor:${mo.id}`), [deg, dir] = ANG[mo.id], t = deg * Math.PI / 180;
    assert.equal(mo.dir, dir, `${mo.id} dir in the data`);
    assert.equal(a.dir, dir);
    assert.ok(Math.abs(mo.x - byLayout.get(mo.id).x) < 1e-6 && Math.abs(mo.y - byLayout.get(mo.id).y) < 1e-6, `${mo.id}: frame.motors agrees with the hex-x layout`);
    // clockwise from the nose: x = r cos t (forward), y = -r sin t (left); asset X = y, Z = x
    const r = Math.sqrt(R);
    assert.ok(Math.abs(a.position[2] - r * Math.cos(t) * MM) < 1e-3 && Math.abs(a.position[0] + r * Math.sin(t) * MM) < 1e-3, `${mo.id} at ${deg} deg: ${a.position}`);
    const ch = sidecar.channels.find((c) => c.id === `prop:${mo.id}`);
    assert.equal(ch.scale, dir === 'CW' ? -1 : 1);
    near(ch.axis, [0, 1, 0], 1e-6, `prop:${mo.id} axis`);
  }
  assert.ok(A.get('motor:M1').position[0] < -0.8 && Math.abs(A.get('motor:M1').position[2]) < 1e-3, 'M1 on the right (-X)');
  const turn = await figureTurn('drones/agrihex', 1, sidecar.channels.find((c) => c.id === 'prop:M1').axis);
  assert.equal(Math.sign(turn), -1, 'the figure turns M1 (CW) negative about +Y');
  const v = await validateGlb(glb);
  assert.equal(v.errors, 0);
  assert.deepEqual(sidecarErrors(sidecar), []);
});

test('wing: the pusher spins about the shaft the figure draws (aft), not the upright the data implies', async () => {
  const { sidecar } = await converted('drones/wing');
  const ch = sidecar.channels.find((c) => c.id === 'prop:M1'), m = sidecar.anchors.find((a) => a.id === 'motor:M1');
  near(ch.axis, [0, 0, -1], 1e-6, 'the pusher shaft points aft (-Z)');
  near(m.normal, [0, 0, -1], 1e-6, 'motor:M1 normal');
  assert.equal(ch.scale, 1, 'CCW (seen from behind, as the craft says) is +1 about the aft shaft');
  assert.ok(sidecar.warnings.some((w) => /M1: the figure turns the rotor about/.test(w)), 'the mismatch with frame.motors is reported');
});

test('gpscam: the gimbal channel pitches the camera the way the craft draws it (+ nose up)', async () => {
  const { sidecar, glb } = await converted('drones/gpscam');
  const ch = sidecar.channels.find((c) => c.id === 'servo:GIMBAL');
  assert.ok(ch, 'servo:GIMBAL channel');
  assert.equal(ch.kind, 'rotate');
  assert.deepEqual(ch.value, { unit: 'deg', min: -90, max: 25, rest: -20 });
  near(ch.pivot, [ch.pivot[0], 64 * MM, 84 * MM], 1e-6,'pivot on the pitch shaft (craft x 84, z 64)');
  assert.ok(Math.abs(Math.abs(ch.axis[0]) - 1) < 1e-6, 'axis along asset X, the craft\'s y');
  const n = readGlb(glb).node('servo:GIMBAL');
  near(n.translation, ch.pivot, 1e-6, 'node translation is the pivot');
  // gpscam.js gimbal(): the camera looks along u = [cos p, 0, sin p] (craft x, y, z); in the asset that is [0, sin p, cos p]
  const look = (deg) => { const p = deg * Math.PI / 180; return [0, Math.sin(p), Math.cos(p)]; };
  const rot = (v, k, th) => { const c = Math.cos(th), s = Math.sin(th), kv = cross(k, v), kd = dot(k, v); return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd * (1 - c)); };
  for (const deg of [-90, 0, 25]) near(rot(look(-20), ch.axis, ch.scale * (deg - ch.value.rest)), look(deg), 1e-4, `pitch ${deg}`);   // scale is rounded to 6 places
});

test('every drone converts: valid glb and sidecar, a motor, prop anchor and prop channel per motor', async () => {
  for (const item of allItems().filter((it) => it.startsWith('drones/'))) {
    const { sidecar, glb } = await converted(item);
    const v = await validateGlb(glb);
    assert.equal(v.errors, 0, `${item}: ${JSON.stringify(v.issues.slice(0, 3))}`);
    assert.deepEqual(sidecarErrors(sidecar), [], item);
    const ids = sidecar.extras.motors.map((m) => m.id);
    assert.ok(ids.length > 0, `${item} has motors`);
    for (const id of ids) {
      const a = sidecar.anchors.find((q) => q.id === `motor:${id}`), p = sidecar.anchors.find((q) => q.id === `prop:${id}`);
      assert.ok(a && p, `${item}: motor:${id} and prop:${id}`);
      const ch = sidecar.channels.find((c) => c.id === `prop:${id}`);
      assert.ok(ch && ch.nodes.length === 1, `${item}: prop:${id} channel with a node`);
      assert.equal(ch.scale, a.dir === 'CW' ? -1 : 1, `${item}: prop:${id} sense`);
      const mo = sidecar.extras.motors.find((q) => q.id === id), want = apply(sidecar.frame.fromSource, [mo.at[0], mo.at[1], 0]);
      assert.ok(Math.hypot(a.position[0] - want[0], a.position[2] - want[2]) < 0.03, `${item}: motor:${id} near the data's x, y`);
    }
    assert.ok(det3(sidecar.frame.fromSource) > 0, `${item} not mirrored`);
  }
});
