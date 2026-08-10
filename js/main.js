import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const statusEl = document.getElementById("status");
const buttonSlot = document.getElementById("ar-button-slot");

let camera, scene, renderer;
let controller;
let reticle;
let jetEngine;
let hitTestSource = null;
let hitTestSourceRequested = false;
let placed = false;

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
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
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.16, 0.04),
      dark
    );
    const a = (i / 8) * Math.PI * 2;
    blade.position.set(-0.22, Math.cos(a) * 0.1, Math.sin(a) * 0.1);
    blade.rotation.x = a;
    root.add(blade);
  }

  // Sit on the floor: shift up by half height-ish
  root.position.y = 0.12;
  root.scale.setScalar(0.85);
  return root;
}

async function loadPreferredModel() {
  const loader = new GLTFLoader();
  const candidates = ["models/jet-engine.glb", "models/engine.glb"];

  for (const url of candidates) {
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      // Normalize roughly to ~0.5m
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
      // try next candidate
    }
  }

  return createProceduralJetEngine();
}

function onSelect() {
  if (!reticle.visible || !jetEngine) return;

  const clone = jetEngine.clone(true);
  reticle.matrix.decompose(clone.position, clone.quaternion, new THREE.Vector3());
  // Keep upright on the surface; preserve yaw from hit pose
  const euler = new THREE.Euler().setFromQuaternion(clone.quaternion, "YXZ");
  clone.quaternion.setFromEuler(new THREE.Euler(0, euler.y, 0, "YXZ"));
  scene.add(clone);
  placed = true;
  setStatus("Placed. Move around it — tap again to place another.", "ok");
}

function initRenderer() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    40
  );

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 1.1);
  hemi.position.set(0.5, 1, 0.25);
  scene.add(hemi);

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
}

function setupARButton() {
  if (!navigator.xr) {
    setStatus("WebXR not available. Use Chrome on an Android AR phone.", "error");
    const btn = document.createElement("button");
    btn.className = "fallback-btn";
    btn.textContent = "AR not supported here";
    btn.disabled = true;
    buttonSlot.appendChild(btn);
    return;
  }

  const button = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay", "light-estimation"],
    domOverlay: { root: document.body },
  });
  buttonSlot.appendChild(button);

  renderer.xr.addEventListener("sessionstart", () => {
    document.body.classList.add("ar-active");
    setStatus("Aim at the floor/table, then tap to place.", "ok");
    hitTestSource = null;
    hitTestSourceRequested = false;
    placed = false;
  });

  renderer.xr.addEventListener("sessionend", () => {
    document.body.classList.remove("ar-active");
    hitTestSource = null;
    hitTestSourceRequested = false;
    setStatus(
      placed
        ? "AR ended. Tap Start AR to place again."
        : "Ready when you are — tap Start AR."
    );
  });
}

function render(_timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();

    if (session && hitTestSourceRequested === false) {
      session
        .requestReferenceSpace("viewer")
        .then((viewerSpace) =>
          session.requestHitTestSource({ space: viewerSpace })
        )
        .then((source) => {
          hitTestSource = source;
        })
        .catch((err) => {
          setStatus(`Hit-test failed: ${err.message}`, "error");
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
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}

async function main() {
  try {
    initRenderer();
    setupARButton();
    setStatus("Loading engine…");
    jetEngine = await loadPreferredModel();
    setStatus("Tap Start AR, allow camera, then tap a surface to place.");

    navigator.xr
      ?.isSessionSupported("immersive-ar")
      .then((ok) => {
        if (!ok) {
          setStatus(
            "This browser/device does not support immersive AR.",
            "error"
          );
        }
      })
      .catch(() => {});

    renderer.setAnimationLoop(render);
  } catch (err) {
    console.error(err);
    setStatus(`Startup failed: ${err.message}`, "error");
  }
}

main();
