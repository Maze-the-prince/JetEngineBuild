import * as THREE from "../vendor/three/three.module.js";
import { ARButton } from "../vendor/three/addons/webxr/ARButton.js";
import { GLTFLoader } from "../vendor/three/addons/loaders/GLTFLoader.js";
import { PARTS, findPartDefByObjectName } from "./parts-catalog.js";

/**
 * Full WebAR port of Unity ArApp (ARManager WebGL path + part inspect UI).
 * No Unity runtime.
 */

const statusEl = document.getElementById("status");
const buttonSlot = document.getElementById("ar-button-slot");
const hudEl = document.getElementById("hud");
const partPanel = document.getElementById("part-panel");
const partTitle = document.getElementById("part-title");
const partDesc = document.getElementById("part-desc");
const btnClosePart = document.getElementById("part-close");
const btnHidePart = document.getElementById("part-hide");
const btnResetParts = document.getElementById("parts-reset");

const FALLBACK_DELAY_SEC = 8;
const STATUS_LOG_INTERVAL_SEC = 5;
const CONTENT_SCALE = 0.25;
const TURBOFAN_LOCAL_Y = 1.67;

let camera, scene, renderer, controller, reticle;
let jetRoot = null;
let modelReady = false;
let hitTestSource = null;
let hitTestSourceRequested = false;
let hitAvailable = false;
let lastHitMatrix = new THREE.Matrix4();
let findingGround = false;
let findingGroundStart = 0;
let nextStatusLog = 0;
let usedFallbackPlacement = false;
let placed = false;
let selectedMeshes = [];
let raycaster = new THREE.Raycaster();

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _ndc = new THREE.Vector2();

function setStatus(message, kind = "") {
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = `status${kind ? ` ${kind}` : ""}`;
  }
  if (hudEl) hudEl.textContent = message;
  console.log(message);
}

function flattenRotation(quaternion) {
  _forward.set(0, 0, 1).applyQuaternion(quaternion);
  _forward.y = 0;
  if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1);
  _forward.normalize();
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), _forward, _up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function buildJetHierarchy(model) {
  const root = new THREE.Group();
  root.name = "JetEngine";

  const content = new THREE.Group();
  content.name = "Content";
  content.scale.setScalar(CONTENT_SCALE);

  // Match Unity prefab: turbofan child at local Y 1.67 under Content
  model.position.set(0, TURBOFAN_LOCAL_Y, 0);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.userData.partDef = findPartDefByObjectName(child.name);
    // climb parents for better name match (Blender may nest meshes)
    if (!child.userData.partDef) {
      let p = child.parent;
      while (p && !child.userData.partDef) {
        child.userData.partDef = findPartDefByObjectName(p.name);
        p = p.parent;
      }
    }
    if (child.material) {
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const mat of mats) {
        if ("side" in mat) mat.side = THREE.DoubleSide;
        if ("metalness" in mat) mat.metalness = Math.max(mat.metalness ?? 0, 0.35);
        if ("roughness" in mat) mat.roughness = Math.min(mat.roughness ?? 1, 0.65);
        mat.needsUpdate = true;
      }
    }
  });

  content.add(model);
  root.add(content);
  root.visible = false;
  return root;
}

async function loadJetEngine() {
  const loader = new GLTFLoader();
  setStatus("AR App: Loading turbofan.glb…");
  const gltf = await loader.loadAsync("models/turbofan.glb");
  console.log(
    "GLB nodes",
    gltf.scene.children.map((c) => c.name),
    "mesh count",
    (() => {
      let n = 0;
      gltf.scene.traverse((o) => {
        if (o.isMesh) n++;
      });
      return n;
    })()
  );
  return buildJetHierarchy(gltf.scene);
}

function hidePartPanel() {
  selectedMeshes = [];
  partPanel.hidden = true;
}

function showPartPanel(def) {
  partTitle.textContent = def.title;
  partDesc.textContent = def.description;
  partPanel.hidden = false;
}

function collectMeshesForPart(def) {
  const meshes = [];
  if (!jetRoot || !def) return meshes;
  jetRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.partDef?.uid === def.uid) meshes.push(obj);
  });
  return meshes;
}

function onSelectPartFromHit(intersects) {
  for (const hit of intersects) {
    const def = hit.object.userData.partDef;
    if (!def) continue;
    selectedMeshes = collectMeshesForPart(def);
    showPartPanel(def);
    setStatus(`AR App: Selected ${def.title}.`, "ok");
    return true;
  }
  return false;
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

function screenToNdc(clientX, clientY) {
  _ndc.x = (clientX / window.innerWidth) * 2 - 1;
  _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  return _ndc;
}

function onSelect(event) {
  // XR select (tap)
  if (!modelReady) {
    setStatus("AR App: Still loading the jet engine…");
    return;
  }

  if (placed) {
    // Pick mesh like Unity PickMesh state
    const xrCam = renderer.xr.getCamera();
    // Cast from screen center / input source if available
    let origin = new THREE.Vector3();
    let direction = new THREE.Vector3();
    if (event?.data?.getWorldPosition && event?.data?.getWorldDirection) {
      event.data.getWorldPosition(origin);
      event.data.getWorldDirection(direction);
    } else {
      xrCam.getWorldPosition(origin);
      xrCam.getWorldDirection(direction);
    }
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObject(jetRoot, true);
    if (!onSelectPartFromHit(hits)) {
      hidePartPanel();
    }
    return;
  }

  if (!findingGround) return;
  if (tryPlaceFromWebHit()) return;
  setStatus(
    "AR App: No WebXR hit-test result yet. Point the camera at a flat surface, then tap."
  );
}

function onDomPointer(clientX, clientY) {
  if (!renderer?.xr?.isPresenting || !placed || !jetRoot) return;
  screenToNdc(clientX, clientY);
  raycaster.setFromCamera(_ndc, camera);
  const hits = raycaster.intersectObject(jetRoot, true);
  if (!onSelectPartFromHit(hits)) hidePartPanel();
}

function tryFallbackPlacement() {
  if (!findingGround || usedFallbackPlacement || placed || !modelReady) return;
  const elapsed = (performance.now() - findingGroundStart) / 1000;
  if (elapsed < FALLBACK_DELAY_SEC) return;
  usedFallbackPlacement = true;

  if (hitAvailable) {
    lastHitMatrix.decompose(_pos, _quat, _scl);
    placeAsset(_pos, flattenRotation(_quat), "auto-hit");
    return;
  }

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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.15));
  const dir = new THREE.DirectionalLight(0xffffff, 1.05);
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

  window.addEventListener(
    "pointerup",
    (e) => {
      if (!partPanel.hidden && e.target.closest("#part-panel")) return;
      onDomPointer(e.clientX, e.clientY);
    },
    { passive: true }
  );
}

function resetSessionState() {
  hitTestSource = null;
  hitTestSourceRequested = false;
  hitAvailable = false;
  findingGround = false;
  usedFallbackPlacement = false;
  placed = false;
  reticle.visible = false;
  hidePartPanel();
  if (jetRoot) {
    jetRoot.visible = false;
    jetRoot.traverse((o) => {
      if (o.isMesh) o.visible = true;
    });
  }
}

function setupARButton() {
  buttonSlot.innerHTML = "";
  if (!("xr" in navigator)) {
    setStatus(
      "AR App: This browser/device does not support WebXR immersive-ar. Use Chrome on Android.",
      "error"
    );
    const btn = document.createElement("button");
    btn.className = "fallback-btn";
    btn.textContent = "Open in Chrome (AR required)";
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
    const t = (button.textContent || "").toLowerCase();
    if (t.includes("start") || t.includes("ar") || t.includes("webxr")) {
      if (!t.includes("not supported") && !t.includes("needs")) {
        button.textContent = "ENTER AR";
      }
    }
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
  });

  renderer.xr.addEventListener("sessionend", () => {
    document.body.classList.remove("ar-active");
    resetSessionState();
    setStatus(
      "AR App: WebAR mode ready. Tap Enter AR to begin."
    );
  });
}

function bindPartUi() {
  btnClosePart.addEventListener("click", () => {
    hidePartPanel();
    setStatus("AR App: Jet engine placed.", "ok");
  });
  btnHidePart.addEventListener("click", () => {
    for (const m of selectedMeshes) m.visible = false;
    hidePartPanel();
    setStatus("AR App: Part hidden. Use Reset parts to show all.", "ok");
  });
  btnResetParts.addEventListener("click", () => {
    if (!jetRoot) return;
    jetRoot.traverse((o) => {
      if (o.isMesh) o.visible = true;
    });
    hidePartPanel();
    setStatus("AR App: All parts reset.", "ok");
  });
}

function render(_t, frame) {
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
        .catch((err) =>
          setStatus(`AR App: WebXR hit-test failed (${err.message})`, "error")
        );
      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource && referenceSpace) {
      const hits = frame.getHitTestResults(hitTestSource);
      if (hits.length) {
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
    tryFallbackPlacement();
  }

  renderer.render(scene, camera);
}

async function main() {
  try {
    setStatus("AR App: Starting WebAR…");
    bindPartUi();
    initRenderer();
    setupARButton();
    renderer.setAnimationLoop(render);

    jetRoot = await loadJetEngine();
    scene.add(jetRoot);
    modelReady = true;

    const supported = await navigator.xr?.isSessionSupported("immersive-ar");
    if (supported) {
      setStatus(
        "AR App: WebAR mode ready. Tap Enter AR to begin.",
        "ok"
      );
    } else {
      setStatus(
        "AR App: Model ready. Open this page in Chrome on Android for ENTER AR.",
        "ok"
      );
    }

    // Expose for debugging
    window.__arApp = { PARTS, scene, jetRoot, renderer };
  } catch (err) {
    console.error(err);
    setStatus(`AR App: Startup failed (${err.message})`, "error");
  }
}

main();
