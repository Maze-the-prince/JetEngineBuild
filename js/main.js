import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Mirrors Unity ArApp WebGL placement (ARManager.cs):
 * - FindingGround: viewer hit-test
 * - Tap places ONE jet engine at hit (yaw flattened)
 * - After 8s: auto-place from hit, else camera-front fallback
 * - Model: Content scale 0.25, turbofan local Y = 1.67
 */

const statusEl = document.getElementById("status");
const buttonSlot = document.getElementById("ar-button-slot");
const hudEl = document.getElementById("hud");

const FALLBACK_DELAY_SEC = 8;
const STATUS_LOG_INTERVAL_SEC = 5;
const CONTENT_SCALE = 0.25;
const TURBOFAN_LOCAL_Y = 1.67;

let camera, scene, renderer;
let controller;
let reticle;
let jetRoot; // placed asset root (matches JetEngine)
let hitTestSource = null;
let hitTestSourceRequested = false;
let hitAvailable = false;
let lastHitMatrix = new THREE.Matrix4();
let findingGround = false;
let findingGroundStart = 0;
let nextStatusLog = 0;
let usedFallbackPlacement = false;
let placed = false;

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
  if (hudEl) hudEl.textContent = message;
}

function flattenRotation(quaternion) {
  _forward.set(0, 0, 1).applyQuaternion(quaternion);
  _forward.y = 0;
  if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1);
  _forward.normalize();
  const flat = new THREE.Quaternion();
  flat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _forward);
  // Keep upright: look along flattened forward
  const m = new THREE.Matrix4().lookAt(
    new THREE.Vector3(0, 0, 0),
    _forward,
    _up
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function buildJetHierarchy(model) {
  // JetEngine (root) -> Content (0.25) -> turbofan (y=1.67)
  const root = new THREE.Group();
  root.name = "JetEngine";

  const content = new THREE.Group();
  content.name = "Content";
  content.scale.setScalar(CONTENT_SCALE);

  model.name = model.name || "turbofan";
  model.position.set(0, TURBOFAN_LOCAL_Y, 0);

  // Ensure materials render in XR
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const mat of mats) {
          if ("side" in mat) mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        }
      }
    }
  });

  content.add(model);
  root.add(content);
  root.visible = false;
  return root;
}

async function loadJetEngine() {
  // Prefer GLB if present; otherwise Unity FBX
  const gltfLoader = new GLTFLoader();
  for (const url of ["models/jet-engine.glb", "models/turbofan.glb"]) {
    try {
      const gltf = await gltfLoader.loadAsync(url);
      return buildJetHierarchy(gltf.scene);
    } catch {
      // continue
    }
  }

  const fbxLoader = new FBXLoader();
  const fbx = await fbxLoader.loadAsync("models/turbofan.fbx");
  return buildJetHierarchy(fbx);
}

function placeAsset(position, rotation, reason) {
  if (!jetRoot || placed) return;

  jetRoot.position.copy(position);
  jetRoot.quaternion.copy(rotation);
  jetRoot.visible = true;
  placed = true;
  findingGround = false;
  reticle.visible = false;
  hitTestSource = null;

  if (reason === "auto-hit") {
    setStatus("AR App: Auto-placed using WebXR hit-test.", "ok");
  } else if (reason === "fallback") {
    setStatus("AR App: Fallback placement in front of camera.", "ok");
  } else {
    setStatus("AR App: Jet engine placed.", "ok");
  }
}

function tryPlaceFromWebHit() {
  if (!hitAvailable) return false;
  lastHitMatrix.decompose(_pos, _quat, _scl);
  placeAsset(_pos, flattenRotation(_quat), "tap");
  return true;
}

function onSelect() {
  if (!findingGround || placed) return;

  if (tryPlaceFromWebHit()) return;

  setStatus(
    "AR App: No WebXR hit-test result yet. Point the camera at a flat surface, then tap."
  );
}

function tryFallbackPlacement(frame) {
  if (!findingGround || usedFallbackPlacement || placed) return;

  const elapsed = (performance.now() - findingGroundStart) / 1000;
  if (elapsed < FALLBACK_DELAY_SEC) return;

  usedFallbackPlacement = true;

  if (hitAvailable) {
    lastHitMatrix.decompose(_pos, _quat, _scl);
    placeAsset(_pos, flattenRotation(_quat), "auto-hit");
    return;
  }

  // Camera-front fallback (ARManager.cs)
  const xrCam = renderer.xr.getCamera();
  xrCam.getWorldPosition(_pos);
  xrCam.getWorldDirection(_forward);
  const fallback = _pos.clone().addScaledVector(_forward, 1.2);
  fallback.y = _pos.y - 1.4;

  const flatFwd = new THREE.Vector3(_forward.x, 0, _forward.z);
  if (flatFwd.lengthSq() < 1e-6) flatFwd.set(0, 0, -1);
  flatFwd.normalize();
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), flatFwd, _up);
  placeAsset(
    fallback,
    new THREE.Quaternion().setFromRotationMatrix(m),
    "fallback"
  );
}

function logPlacementStatus() {
  if (!findingGround || placed) return;
  const now = performance.now() / 1000;
  if (now < nextStatusLog) return;
  nextStatusLog = now + STATUS_LOG_INTERVAL_SEC;
  setStatus(`AR App: WebAR scanning... hitAvailable=${hitAvailable}.`);
}

function initRenderer() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    40
  );

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(2, 3, 1);
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
}

function resetSessionState() {
  hitTestSource = null;
  hitTestSourceRequested = false;
  hitAvailable = false;
  findingGround = false;
  usedFallbackPlacement = false;
  placed = false;
  reticle.visible = false;
  if (jetRoot) {
    jetRoot.visible = false;
  }
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

  const relabel = () => {
    const t = button.textContent.toLowerCase();
    if (t.includes("start") || t.includes("ar")) button.textContent = "ENTER AR";
  };
  relabel();
  new MutationObserver(relabel).observe(button, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  buttonSlot.appendChild(button);

  renderer.xr.addEventListener("sessionstart", () => {
    document.body.classList.add("ar-active");
    resetSessionState();
    findingGround = true;
    findingGroundStart = performance.now();
    nextStatusLog = performance.now() / 1000 + STATUS_LOG_INTERVAL_SEC;
    setStatus("AR App: WebXR AR session started.");
    setTimeout(() => {
      if (findingGround && !placed) {
        setStatus("AR App: Waiting for Enter AR (WebXR immersive-ar session)...");
        setStatus("AR App: WebAR scanning...");
      }
    }, 200);
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
  if (frame && findingGround && !placed) {
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
          hitAvailable = true;
          lastHitMatrix.fromArray(pose.transform.matrix);
          reticle.visible = true;
          reticle.matrix.copy(lastHitMatrix);
        }
      } else {
        hitAvailable = false;
        reticle.visible = false;
      }
    }

    logPlacementStatus();
    tryFallbackPlacement(frame);
  }

  renderer.render(scene, camera);
}

async function main() {
  try {
    initRenderer();
    setupARButton();
    setStatus("AR App: Waiting for WebXR manager...");
    jetRoot = await loadJetEngine();
    scene.add(jetRoot);
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
