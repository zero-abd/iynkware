// The immersive test page for the iynkware-xr deploy: a cube, controller rays, hand joints and a status list that
// shows what the headers allow. build.mjs fills in the three.js version and serves this file under a content hash.
import * as THREE from "./three-__THREE_VERSION__/three.module.js";

const button = document.getElementById("enter");
const statusList = document.getElementById("status");
const rows = new Map();

function show(label, value, good) {
  let dd = rows.get(label);
  if (!dd) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    dd = document.createElement("dd");
    statusList.append(dt, dd);
    rows.set(label, dd);
  }
  dd.textContent = String(value);
  dd.className = good === undefined ? "" : good ? "ok" : "bad";
}

// The scene: a cube a little below eye height, 0.8 m in front of the floor origin.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const background = new THREE.Color(0x101418);
scene.background = background;
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.5, 0.4);
camera.lookAt(0, 1.3, -0.8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 3, 2);
scene.add(sun);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.25, 0.25, 0.25),
  new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.45 }),
);
cube.position.set(0, 1.3, -0.8);
scene.add(cube);

// Controllers: a short ray each; select (trigger, or a pinch with hands) recolours the cube.
const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  controller.add(new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0xe8ecef })));
  controller.addEventListener("select", () => cube.material.color.offsetHSL(0.17, 0, 0));
  scene.add(controller);
}

// Hand joints, drawn from the XR frame directly: 25 joints per hand.
const joints = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0x5ab8ff }),
  50,
);
joints.count = 0;
joints.frustumCulled = false;
scene.add(joints);
const jointMatrix = new THREE.Matrix4();
const jointScale = new THREE.Matrix4();

function drawHands(frame) {
  const space = renderer.xr.getReferenceSpace();
  let count = 0;
  for (const source of frame.session.inputSources) {
    if (!source.hand) continue;
    for (const jointSpace of source.hand.values()) {
      const pose = frame.getJointPose?.(jointSpace, space);
      if (!pose || count >= 50) continue;
      const r = pose.radius ?? 0.008;
      jointMatrix.fromArray(pose.transform.matrix).multiply(jointScale.makeScale(r, r, r));
      joints.setMatrixAt(count++, jointMatrix);
    }
  }
  joints.count = count;
  joints.instanceMatrix.needsUpdate = true;
}

function describeInputs(session) {
  const kinds = [...session.inputSources].map((s) => `${s.handedness} ${s.hand ? "hand" : "controller"}`);
  show("inputs", kinds.length ? kinds.join(", ") : "none yet");
}

renderer.setAnimationLoop((time, frame) => {
  cube.rotation.set(time / 2400, time / 1700, 0);
  if (frame) drawHands(frame);
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Entering: immersive-ar (passthrough) first, immersive-vr if AR is refused. Hand tracking is optional.
const sessionInit = { optionalFeatures: ["local-floor", "hand-tracking"] };
let session = null;

async function requestSession(modes) {
  let lastError = null;
  for (const mode of modes) {
    try {
      return { mode, xrSession: await navigator.xr.requestSession(mode, sessionInit) };
    } catch (error) {
      lastError = error;
      show(`${mode} request`, `${error.name}: ${error.message}`, false);
    }
  }
  throw lastError ?? new Error("no immersive mode is supported");
}

async function enter(modes) {
  button.disabled = true;
  try {
    const { mode, xrSession } = await requestSession(modes);
    const features = xrSession.enabledFeatures ?? [];
    renderer.xr.setReferenceSpaceType(features.length === 0 || features.includes("local-floor") ? "local-floor" : "local");
    scene.background = mode === "immersive-ar" ? null : background;
    await renderer.xr.setSession(xrSession);
    session = xrSession;
    show("session", mode, true);
    show("features", features.length ? features.join(", ") : "not reported");
    show("hand-tracking", features.includes("hand-tracking") ? "granted" : "not granted", features.includes("hand-tracking"));
    describeInputs(xrSession);
    xrSession.addEventListener("inputsourceschange", () => describeInputs(xrSession));
    xrSession.addEventListener("end", () => {
      session = null;
      scene.background = background;
      button.textContent = "Enter";
      show("session", "ended");
    });
    button.textContent = "Exit";
  } catch (error) {
    show("session", `${error.name}: ${error.message}`, false);
  } finally {
    button.disabled = false;
  }
}

// What the page can do here. A refusal shows in red, which points at a header or at the browser.
async function probe() {
  show("page", location.origin);
  show("three.js", `r${THREE.REVISION}`);
  show("secure context", window.isSecureContext, window.isSecureContext);
  const policy = document.featurePolicy;
  if (policy) {
    for (const feature of ["xr-spatial-tracking", "microphone"]) {
      const allowed = policy.allowsFeature(feature);
      show(`policy ${feature}`, allowed ? "allowed" : "refused", allowed);
    }
  }
  try {
    // The smallest valid module: the magic number and version 1. Needs 'wasm-unsafe-eval'.
    await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    show("wasm", "compiles", true);
  } catch (error) {
    show("wasm", `${error.name}: ${error.message}`, false);
  }
  await new Promise((done) => {
    const url = URL.createObjectURL(new Blob(["postMessage('ok')"], { type: "text/javascript" }));
    const worker = new Worker(url);
    const timer = setTimeout(() => finish("no answer", false), 3000);
    function finish(value, good) {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      show("blob worker", value, good);
      done();
    }
    worker.onmessage = () => finish("runs", true);
    worker.onerror = (event) => finish(event.message || "refused", false);
  });

  const modes = [];
  if (navigator.xr) {
    for (const mode of ["immersive-ar", "immersive-vr"]) {
      const supported = await navigator.xr.isSessionSupported(mode).catch(() => false);
      show(mode, supported ? "supported" : "not supported", supported);
      if (supported) modes.push(mode);
    }
  } else {
    show("navigator.xr", "missing", false);
  }
  if (modes.length) {
    button.textContent = "Enter";
    button.disabled = false;
    button.addEventListener("click", () => (session ? session.end() : enter(modes)));
  } else {
    button.textContent = "No immersive mode";
  }
}

probe();
