import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Behavior matched to the Unity ArApp build:
 * - Enter AR session
 * - Scan with viewer hit-test
 * - Auto-place ONE jet engine once a flat surface is stable
 * - Tap repositions that same engine (no multi-spawn)
 * - Pinch scale + two-finger rotate after placed
 */

const statusEl = document.getElementById("status");
const buttonSlot = document.getElementById("ar-button-slot");
const hudEl = document.getElementById("hud");

const STABLE_HIT_FRAMES = 40; // ~0.6–0.7s at 60fps
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.5;

let camera, scene, renderer;
let controller;
let reticle;
let engineTemplate;
let placedEngine = null;
let hitTestSource = null;
let hitTestSourceRequested = false;
let stableHitFrames = 0;
let lastHitMatrix = new THREE.Matrix4();
let baseScale = 1;

// Gesture state (dom-overlay touches while in AR)
let activeTouches = new Map();
let pinchStartDist = 0;
let pinchStartScale = 1;
let rotateStartAngle = 0;
let rotateStartY = 0;

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
  if (hudEl) hudEl.textContent = message;
}

function createProceduralJetEngine() {
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: 0x8a95a3,
    metalness: 0.85,
    roughness: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x2a313a,
    metalness: 0.7,
    roughness: 0.45,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x39c6ff,
    metalness: 0.4,
    roughness: 0.25,
    emissive: 0x0a3040,
    emissiveIntensity: 0.35,
  });

  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.2, 0.55, 32),
    metal
  );
  housing.rotation.z = Math.PI / 2;
  root.add(housing);

  const intake = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.035, 16, 40),
    dark
  );
  intake.position.x = -0.28;
  intake.rotation.y = Math.PI / 2;
  root.add(intake);

  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.16, 28),
    dark
  );
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.x = 0.34;
  root.add(nozzle);

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.5, 20),
    accent
  );
  core.rotation.z = Math.PI / 2;
  root.add(core);

  for (let i = 0; i < 8; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.04), dark);
    const a = (i / 8) * Math.PI * 2;
    blade.position.set(-0.22, Math.cos(a) * 0.1, Math.sin(a) * 0.1);
    blade.rotation.x = a;
    root.add(blade);
  }

  root.position.y = 0.12;
  return root;
}

async function loadPreferredModel() {
  const loader = new GLTFLoader();
  for (const url of ["models/jet-engine.glb", "models/engine.glb"]) {
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.scale.setScalar(0.45 / maxDim);
      box.setFromObject(model);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center);
      model.position.y -= box.min.y;
      return model;
    } catch {
      // try next
    }
  }
  return createProceduralJetEngine();
}

function applyPoseFromMatrix(target, matrix) {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  matrix.decompose(pos, quat, scl);

  target.position.copy(pos);
  // Keep upright like typical AR floor placement
  const euler = new THREE.Euler().setFromQuaternion(quat, "YXZ");
  target.rotation.set(0, euler.y, 0);
}

function placeOrMoveEngine(matrix, reason) {
  if (!engineTemplate) return;

  if (!placedEngine) {
    placedEngine = engineTemplate.clone(true);
    placedEngine.scale.setScalar(baseScale);
    scene.add(placedEngine);
  }

  applyPoseFromMatrix(placedEngine, matrix);
  reticle.visible = false;

  if (reason === "auto") {
    setStatus("AR App: Auto-placed using WebXR hit-test.", "ok");
  } else if (reason === "tap") {
    setStatus("AR App: Jet engine placed.", "ok");
  }
}

function onSelect() {
  if (!reticle.visible) {
    if (!placedEngine) {
      setStatus(
        "AR App: No WebXR hit-test result yet. Point the camera at a flat surface, then tap."
      );
    }
    return;
  }

  // Tap repositions the single engine (app: one jet engine, not multi-spawn)
  placeOrMoveEngine(lastHitMatrix, "tap");
  stableHitFrames = 0;
}

function touchDistance(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

function touchAngle(a, b) {
  return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
}

function onTouchStart(e) {
  if (!renderer?.xr?.isPresenting || !placedEngine) return;
  for (const t of e.changedTouches) {
    activeTouches.set(t.identifier, t);
  }
  if (activeTouches.size === 2) {
    const [a, b] = [...activeTouches.values()];
    pinchStartDist = touchDistance(a, b) || 1;
    pinchStartScale = placedEngine.scale.x;
    rotateStartAngle = touchAngle(a, b);
    rotateStartY = placedEngine.rotation.y;
    e.preventDefault();
  }
}

function onTouchMove(e) {
  if (!renderer?.xr?.isPresenting || !placedEngine) return;
  for (const t of e.changedTouches) {
    if (activeTouches.has(t.identifier)) activeTouches.set(t.identifier, t);
  }
  if (activeTouches.size === 2) {
    const [a, b] = [...activeTouches.values()];
    const dist = touchDistance(a, b) || 1;
    const nextScale = THREE.MathUtils.clamp(
      pinchStartScale * (dist / pinchStartDist),
      MIN_SCALE,
      MAX_SCALE
    );
    placedEngine.scale.setScalar(nextScale);
    baseScale = nextScale;

    const ang = touchAngle(a, b);
    placedEngine.rotation.y = rotateStartY + (ang - rotateStartAngle);
    e.preventDefault();
  }
}

function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    activeTouches.delete(t.identifier);
  }
  if (activeTouches.size < 2) {
    pinchStartDist = 0;
  }
}

function initRenderer() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    40
  );

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(1, 2, 1);
  scene.add(dir);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x39c6ff })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: false });
  window.addEventListener("touchcancel", onTouchEnd, { passive: false });
}

function resetSessionState() {
  hitTestSource = null;
  hitTestSourceRequested = false;
  stableHitFrames = 0;
  activeTouches.clear();
  if (placedEngine) {
    scene.remove(placedEngine);
    placedEngine = null;
  }
  reticle.visible = false;
}

function setupARButton() {
  if (!navigator.xr) {
    setStatus(
      "AR App: This browser/device does not support WebXR immersive-ar.",
      "error"
    );
    const btn = document.createElement("button");
    btn.className = "fallback-btn";
    btn.textContent = "AR not supported";
    btn.disabled = true;
    buttonSlot.appendChild(btn);
    return;
  }

  const button = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "light-estimation"],
    domOverlay: { root: document.body },
  });
  // Match Unity footer wording
  const relabel = () => {
    if (button.textContent.toLowerCase().includes("start")) {
      button.textContent = "ENTER AR";
    }
  };
  relabel();
  const obs = new MutationObserver(relabel);
  obs.observe(button, { childList: true, characterData: true, subtree: true });
  buttonSlot.appendChild(button);

  renderer.xr.addEventListener("sessionstart", () => {
    document.body.classList.add("ar-active");
    resetSessionState();
    setStatus("AR App: WebXR AR session started.");
    setTimeout(() => {
      if (renderer.xr.isPresenting && !placedEngine) {
        setStatus("AR App: WebAR scanning...");
      }
    }, 300);
  });

  renderer.xr.addEventListener("sessionend", () => {
    document.body.classList.remove("ar-active");
    resetSessionState();
    setStatus(
      "AR App: WebAR mode ready. Tap Enter AR in the page footer to begin."
    );
  });
}

function render(_timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (session && !hitTestSourceRequested) {
      session
        .requestReferenceSpace("viewer")
        .then((viewerSpace) =>
          session.requestHitTestSource({ space: viewerSpace })
        )
        .then((source) => {
          hitTestSource = source;
          setStatus("AR App: WebXR viewer hit-test started.");
        })
        .catch((err) => {
          setStatus(`AR App: WebXR hit-test failed (${err.message})`, "error");
        });

      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource && referenceSpace) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0) {
        const pose = hits[0].getPose(referenceSpace);
        if (pose) {
          lastHitMatrix.fromArray(pose.transform.matrix);
          reticle.matrix.copy(lastHitMatrix);
          reticle.visible = true;
          reticle.material.color.setHex(placedEngine ? 0x6dffa8 : 0x39c6ff);

          // App-like auto place on stable horizontal surface hit
          if (!placedEngine) {
            stableHitFrames += 1;
            if (stableHitFrames === 1) {
              setStatus("AR App: Horizontal plane detected. Placing jet engine.");
            }
            if (stableHitFrames >= STABLE_HIT_FRAMES) {
              placeOrMoveEngine(lastHitMatrix, "auto");
            } else if (stableHitFrames % 15 === 0) {
              setStatus(
                `AR App: WebAR scanning... hitAvailable=true (${stableHitFrames}/${STABLE_HIT_FRAMES})`
              );
            }
          }
        }
      } else {
        reticle.visible = false;
        if (!placedEngine) {
          stableHitFrames = 0;
        }
      }
    }
  }

  renderer.render(scene, camera);
}

async function main() {
  try {
    initRenderer();
    setupARButton();
    setStatus("AR App: Waiting for WebXR manager...");
    engineTemplate = await loadPreferredModel();
    baseScale = 1;
    setStatus(
      "AR App: WebAR mode ready. Tap Enter AR in the page footer to begin."
    );

    navigator.xr?.isSessionSupported("immersive-ar").then((ok) => {
      if (!ok) {
        setStatus(
          "AR App: This browser/device does not support WebXR immersive-ar.",
          "error"
        );
      }
    });

    renderer.setAnimationLoop(render);
  } catch (err) {
    console.error(err);
    setStatus(`AR App: Startup failed (${err.message})`, "error");
  }
}

main();
