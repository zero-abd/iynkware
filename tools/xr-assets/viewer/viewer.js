/* The desktop viewer for iynk's XR assets: serve tools/xr-assets (node viewer/serve.mjs) and open /viewer/.
   URL parameters, so screenshots are scriptable (viewer/shoot.mjs):
     item=boards/uno-r3   which item (out/index.json, else samples/index.json; 'fixtures/ink-board' is built in)
     explode=0..1  xr=0..1 (see-through)  leds=1 (every emissive channel lit)  spin=1 (props and motors turn,
     servos sweep)  anchors=1 (anchor dots)  texts=1 (printed text)  lines=fat|gl  ortho=1 (orthographic camera)
     yaw=deg pitch=deg (turn the default view)  zoom=1  ink=1 (ink width scale)  shot=1 (no UI)
     copies=N (N of the item side by side: a rough draw-call check for a bench of items)
     seat=parts/led@c10,parts/resistor@e11 (other items seated in this one: each item's first pin's tip at that
     anchor, unturned; the Blink breadboard with its LED and resistor)
     logdepth=1 (a logarithmic depth buffer, to check the ink shaders under it)  glow=0 (no halos on lit LEDs)
     A headset-like close-up: scale=3 (the item's scale; 3 is the app's work scale)  dist=0.5 (the camera's distance in
     metres)  fov=45 (vertical degrees; 45 over 900 px is about a Quest 3S's 20 px per degree)  focus=<anchor id>
     (look at that anchor rather than the item's centre)
     bg=#rrggbb (the background; default paper)
     An Enter VR button appears where WebXR immersive-vr is supported: the item then stands at table height half a
     metre in front.
   window.__viewer exposes { asset, renderer, scene, camera, ready }; <html data-ready="1"> once a frame is drawn. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadXrAsset, createTextMeshes } from '../material/xr-asset.js';
import { PAPER } from '../material/ink.js';
import { buildFixture } from './fixture.js';

const Q = new URLSearchParams(location.search);
const html = document.documentElement;
if (Q.get('shot') === '1') html.classList.add('shot');
const $ = (id) => document.getElementById(id);
const num = (k, d) => (Q.has(k) && Q.get(k) !== '' && Number.isFinite(+Q.get(k)) ? +Q.get(k) : d);
const FIXTURE = 'fixtures/ink-board';

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', logarithmicDepthBuffer: Q.get('logdepth') === '1' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.info.autoReset = true;
renderer.xr.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(/^#[0-9a-f]{6}$/i.test(Q.get('bg') || '') ? Q.get('bg') : PAPER);
// in a headset the items stand on a table-height plane in front of the viewer
const world = new THREE.Group();
scene.add(world);
renderer.xr.addEventListener('sessionstart', () => { world.position.set(0, 0.85, -0.45); });
renderer.xr.addEventListener('sessionend', () => { world.position.set(0, 0, 0); });
if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
  if (!ok) return;
  import('three/addons/webxr/VRButton.js').then(({ VRButton }) => { const b = VRButton.createButton(renderer); b.style.position = 'static'; b.style.transform = 'none'; $('xrrow').append(b); });
}).catch(() => {});
const ortho = Q.get('ortho') === '1';
const camera = ortho ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100) : new THREE.PerspectiveCamera(Math.min(120, Math.max(5, num('fov', 18))), 1, 0.001, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;

const state = {
  item: Q.get('item') || '',
  explode: num('explode', 0), xr: num('xr', 0), leds: Q.get('leds') === '1', spin: Q.get('spin') === '1',
  anchors: Q.get('anchors') === '1', texts: Q.get('texts') === '1', lines: Q.get('lines') === 'gl' ? 'gl' : 'fat',
  yaw: num('yaw', 0), pitch: num('pitch', 0), zoom: num('zoom', 1), ink: num('ink', 1),
  scale: Math.max(0.01, num('scale', 1)), dist: num('dist', 0), focus: Q.get('focus') || '',
};
const viewer = { asset: null, renderer, scene, camera, controls, ready: false, items: [], state };
window.__viewer = viewer;

const note = (m) => { $('msg').textContent = m; };
const fail = (m) => { console.error(m); html.dataset.errors = (html.dataset.errors || '') + ' ' + m; note(m); };

/* ---------- the item list ---------- */
async function listItems() {
  const items = [];
  for (const rel of ['../out/index.json', '../samples/index.json']) {
    try {
      const url = new URL(rel, location.href);
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const idx = await r.json();
      // sidecar paths are relative to the index; one written from the tool root ('out/...') is taken from there
      const side = (it) => { const s = it.sidecar || `${it.id}.json`; return /^(out|samples)\//.test(s) ? new URL('../' + s, location.href).href : new URL(s, url).href; };
      for (const it of idx.items || []) items.push({ id: it.id, name: it.name || it.id, kind: it.kind, url: side(it), from: rel.includes('out') ? 'out' : 'samples' });
      if (items.length) break;
    } catch { /* next */ }
  }
  items.push({ id: FIXTURE, name: 'Ink fixture (built in)', kind: 'board', url: null, from: 'fixture' });
  return items;
}

/* ---------- loading ---------- */
let anchorsObj = null, textsObj = null, loadSeq = 0, framesSinceLoad = 0;
async function open(id) {
  const seq = ++loadSeq;
  html.dataset.ready = '0'; viewer.ready = false; framesSinceLoad = 0;
  const it = viewer.items.find((x) => x.id === id) || viewer.items[0];
  state.item = it.id;
  $('item').value = it.id;
  note('loading ' + it.id + ' ...');
  let asset;
  try {
    const opts = { lines: state.lines, inkScale: state.ink, hull: Q.get('hull') === 'all' ? 'all' : 'back', glow: Q.get('glow') !== '0' };
    if (it.from === 'fixture') { const f = buildFixture(); asset = await loadXrAsset('fixture:/' + FIXTURE + '.json', { ...opts, sidecar: f.sidecar, glb: f.glb }); }
    else asset = await loadXrAsset(it.url, opts);
  } catch (e) { fail('could not load ' + it.id + ': ' + (e && e.message)); return; }
  if (seq !== loadSeq) { asset.dispose(); return; }
  if (viewer.asset) viewer.asset.dispose();
  for (const c of viewer.copies || []) c.dispose();
  viewer.copies = [];
  // copies=N: a bench of N of this item side by side (a rough draw-call and frame-time check)
  const copies = Math.min(64, Math.max(1, Math.round(num('copies', 1))));
  if (copies > 1) {
    const b = asset.sidecar.bounds, sx = (b.max[0] - b.min[0]) * 1.15, sz = (b.max[2] - b.min[2]) * 1.15, cols = Math.ceil(Math.sqrt(copies));
    for (let i = 1; i < copies; i++) {
      const opts = { lines: state.lines, inkScale: state.ink, hull: Q.get('hull') === 'all' ? 'all' : 'back', glow: Q.get('glow') !== '0' };
      const c = it.from === 'fixture' ? await loadXrAsset('fixture:/c.json', { ...opts, ...buildFixture() }) : await loadXrAsset(it.url, opts);
      c.object.position.set((i % cols) * sx, 0, -Math.floor(i / cols) * sz);
      c.object.rotation.y = (i % 3) * 0.4;
      world.add(c.object);
      viewer.copies.push(c);
    }
  }
  // seat=<item>@<anchor>,...: items seated in this one, their first pin on that anchor
  for (const s of (Q.get('seat') || '').split(',').filter(Boolean)) {
    const [sid, at] = s.split('@');
    const sit = viewer.items.find((x) => x.id === sid && x.url);
    const hole = (asset.sidecar.anchors || []).find((x) => x.id === at);
    if (!sit || !hole) { fail('cannot seat ' + s); continue; }
    const c = await loadXrAsset(sit.url, { lines: state.lines, inkScale: state.ink, hull: Q.get('hull') === 'all' ? 'all' : 'back', glow: Q.get('glow') !== '0' });
    const pin = (c.sidecar.anchors || []).find((x) => x.kind === 'pin') || { position: [0, 0, 0] };
    c.object.position.set(...hole.position).sub(new THREE.Vector3(...pin.position));
    asset.object.add(c.object);
    viewer.copies.push(c);
  }
  if (anchorsObj) { anchorsObj.geometry.dispose(); anchorsObj.material.dispose(); anchorsObj.removeFromParent(); anchorsObj = null; }
  textsObj = null;
  viewer.asset = asset;
  world.add(asset.object);
  frame();
  buildParts();
  apply();
  note('');
  syncUrl();
}

function frame() {
  const a = viewer.asset, sc = a.sidecar;
  const b = sc.bounds || { min: [-0.05, 0, -0.05], max: [0.05, 0.05, 0.05] };
  a.object.scale.setScalar(state.scale);
  a.object.updateMatrixWorld(true);
  const min = new THREE.Vector3(...b.min).multiplyScalar(state.scale), max = new THREE.Vector3(...b.max).multiplyScalar(state.scale);
  let c = min.clone().add(max).multiplyScalar(0.5);
  const r = Math.max(1e-3, max.clone().sub(min).length() / 2);
  const at = state.focus && a.anchor(state.focus);
  if (state.focus && !at) fail('unknown anchor ' + state.focus);
  if (at) c = at.position.clone();
  const v = new THREE.Vector3(...((sc.look && sc.look.defaultView) || [0.577, 0.577, 0.577])).normalize();
  if (state.yaw) v.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw * Math.PI / 180);
  if (state.pitch) { const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), v).normalize(); v.applyAxisAngle(side, -state.pitch * Math.PI / 180); }
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const fov = (camera.isPerspectiveCamera ? camera.fov : 18) * Math.PI / 180;
  const fit = Math.min(1, aspect);                         // fit the bounding sphere in the narrower side
  const dist = state.dist > 0 ? state.dist : r / Math.sin(Math.atan(Math.tan(fov / 2) * fit)) * 1.02 / state.zoom;
  camera.position.copy(c).addScaledVector(v, dist);
  camera.up.set(0, 1, 0);
  camera.near = dist / 200; camera.far = dist * 20;
  if (camera.isOrthographicCamera) { const h = r * 1.05 / state.zoom; camera.top = h; camera.bottom = -h; camera.left = -h * aspect; camera.right = h * aspect; }
  camera.updateProjectionMatrix();
  controls.target.copy(c);
  camera.lookAt(c);
  controls.update();
  viewer.home = { position: camera.position.clone(), target: c.clone() };
}

/* ---------- state -> asset ---------- */
function apply() {
  const a = viewer.asset;
  if (!a) return;
  for (const x of [a, ...(viewer.copies || [])]) {
    x.explode(state.explode);
    x.seeThrough(state.xr);
    for (const ch of x.sidecar.channels || []) {
      if (ch.kind === 'emissive') x.set(ch.id, state.leds ? (ch.value.unit === 'rgb' ? [1, 1, 1] : ch.value.max) : ch.value.rest);
      if (ch.kind === 'spin') x.set(ch.id, state.spin ? Math.min(ch.value.max, 90) : 0);   // a slow turn reads; flight rpm strobes
      if (ch.kind === 'rotate' && !state.spin) x.set(ch.id, ch.value.rest);
    }
  }
  if (state.texts && !textsObj) { textsObj = createTextMeshes(a.sidecar, { uniforms: a.uniforms }); if (textsObj) a.root.add(textsObj); }
  if (textsObj) textsObj.visible = state.texts;
  if (state.anchors && !anchorsObj) buildAnchors();
  if (anchorsObj) anchorsObj.visible = state.anchors;
  anchorsDirty = true;
  $('explode').value = state.explode; $('explodeV').textContent = state.explode.toFixed(2);
  $('xr').value = state.xr; $('xrV').textContent = state.xr.toFixed(2);
  $('leds').setAttribute('aria-pressed', state.leds); $('spin').setAttribute('aria-pressed', state.spin);
  $('anchors').checked = state.anchors; $('texts').checked = state.texts;
}
function syncUrl() {
  const p = new URLSearchParams();
  p.set('item', state.item);
  if (state.explode) p.set('explode', state.explode);
  if (state.xr) p.set('xr', state.xr);
  if (state.leds) p.set('leds', 1);
  if (state.spin) p.set('spin', 1);
  if (state.anchors) p.set('anchors', 1);
  if (state.texts) p.set('texts', 1);
  for (const k of ['lines', 'ortho', 'yaw', 'pitch', 'zoom', 'ink', 'shot', 'w', 'h', 'copies', 'seat', 'logdepth', 'hull', 'glow', 'scale', 'dist', 'fov', 'focus', 'bg']) if (Q.has(k)) p.set(k, Q.get(k));
  history.replaceState(null, '', '?' + p.toString().replace(/%2F/g, '/'));
}

/* ---------- parts ---------- */
function buildParts() {
  const a = viewer.asset, box = $('parts');
  box.textContent = '';
  const parts = (a.sidecar.parts || []).filter((p) => p.id !== '');
  $('partsN').textContent = `(${parts.length})`;
  for (const p of parts) {
    const row = document.createElement('div');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.title = 'show / hide';
    cb.onchange = () => { a.setPartVisible(p.id, cb.checked); anchorsDirty = true; };
    const t = document.createElement('span');
    t.textContent = p.id;
    const s = document.createElement('small');
    s.textContent = ' ' + (p.name || '') + (p.role ? ' · ' + p.role : '');
    row.append(cb, t, s);
    row.title = `${p.id} ${p.name || ''} (index ${p.index})`;
    row.onmouseenter = () => a.highlight(p.id);
    row.onmouseleave = () => a.highlight(null);
    box.append(row);
  }
}

/* ---------- anchors ---------- */
let anchorsDirty = true;
function buildAnchors() {
  const a = viewer.asset, list = a.sidecar.anchors || [];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(list.length * 3), 3));
  const m = new THREE.PointsMaterial({ color: new THREE.Color('#d6402b'), size: 6, sizeAttenuation: false, depthTest: true });
  anchorsObj = new THREE.Points(g, m);
  anchorsObj.renderOrder = 3;
  anchorsObj.frustumCulled = false;
  anchorsObj.userData.ids = list.map((x) => x.id);
  scene.add(anchorsObj);              // anchor() positions are world positions
  anchorsDirty = true;
}
function updateAnchors() {
  if (!anchorsObj || !anchorsObj.visible || !anchorsDirty) return;
  const a = viewer.asset, pos = anchorsObj.geometry.attributes.position;
  anchorsObj.userData.ids.forEach((id, i) => {
    const w = a.anchor(id);
    const p = w.position.addScaledVector(w.normal, 0.0003);
    pos.setXYZ(i, p.x, p.y, p.z);
  });
  pos.needsUpdate = true;
  anchorsObj.geometry.computeBoundingSphere();
  anchorsDirty = false;
}
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
canvas.addEventListener('pointermove', (e) => {
  const tip = $('tip');
  if (!anchorsObj || !anchorsObj.visible) { tip.style.display = 'none'; return; }
  const r = canvas.getBoundingClientRect();
  mouse.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const d = camera.isPerspectiveCamera ? camera.position.distanceTo(controls.target) : 1;
  ray.params.Points.threshold = d * 0.006;
  const hit = ray.intersectObject(anchorsObj)[0];
  if (!hit) { tip.style.display = 'none'; return; }
  const a = viewer.asset.sidecar.anchors[hit.index];
  tip.textContent = `${a.id} · ${a.kind}${a.part ? ' · ' + a.part : ''}`;
  tip.style.display = 'block'; tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY + 10 + 'px';
});

/* ---------- UI ---------- */
function wire() {
  const sel = $('item');
  for (const it of viewer.items) { const o = document.createElement('option'); o.value = it.id; o.textContent = `${it.id}${it.from === 'samples' ? ' (sample)' : ''}`; sel.append(o); }
  sel.onchange = () => open(sel.value);
  $('explode').oninput = (e) => { state.explode = +e.target.value; apply(); syncUrl(); };
  $('xr').oninput = (e) => { state.xr = +e.target.value; apply(); syncUrl(); };
  $('leds').onclick = () => { state.leds = !state.leds; apply(); syncUrl(); };
  $('spin').onclick = () => { state.spin = !state.spin; apply(); syncUrl(); };
  $('reset').onclick = () => { if (viewer.home) { camera.position.copy(viewer.home.position); controls.target.copy(viewer.home.target); controls.update(); } };
  $('anchors').onchange = (e) => { state.anchors = e.target.checked; apply(); syncUrl(); };
  $('texts').onchange = (e) => { state.texts = e.target.checked; apply(); syncUrl(); };
}

/* ---------- loop ---------- */
function resize() {
  const w = num('w', 0) || window.innerWidth, h = num('h', 0) || window.innerHeight;
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  if (camera.isPerspectiveCamera) camera.aspect = w / h;
  else { const k = (camera.top - camera.bottom) / 2; camera.left = -k * w / h; camera.right = k * w / h; }
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0, fps = 0, statT = 1, t = 0;
function loop() {
  const dt = Math.min(0.1, clock.getDelta());
  t += dt;
  const a = viewer.asset;
  if (a) {
    if (state.spin) {
      for (const ch of a.sidecar.channels || []) if (ch.kind === 'rotate') a.set(ch.id, ch.value.rest + (ch.value.max - ch.value.min) * 0.4 * Math.sin(t * 1.6));
      anchorsDirty = true;
    }
    a.update(dt);
    for (const c of viewer.copies || []) c.update(dt);
    updateAnchors();
  }
  controls.update();
  renderer.render(scene, camera);
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
  statT += dt;
  if (a && statT > 0.25) {
    statT = 0;
    const i = renderer.info.render, s = a.sidecar.stats || {};
    $('stats').textContent = `${a.sidecar.id}\n${fps.toFixed(0)} fps\ndraw calls ${i.calls} (item ${a.drawCalls()}, glTF ${s.drawCalls ?? '?'})\ntriangles ${i.triangles.toLocaleString('en')} (glTF ${(s.triangles ?? 0).toLocaleString('en')})\nlines ${i.lines.toLocaleString('en')}  points ${i.points}`;
  }
  if (a && !viewer.ready && ++framesSinceLoad >= 3) { viewer.ready = true; html.dataset.ready = '1'; }
}

(async function main() {
  resize();
  try { viewer.items = await listItems(); } catch (e) { fail('no item list: ' + e.message); }
  wire();
  renderer.setAnimationLoop(loop);
  const want = state.item && viewer.items.some((x) => x.id === state.item) ? state.item : (viewer.items.find((x) => x.id === 'boards/uno-r3') || viewer.items[0]).id;
  if (state.item && state.item !== want) fail('unknown item ' + state.item);
  await open(want);
})();
