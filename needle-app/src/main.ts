import "@needle-tools/engine";
import { onStart, WebXR } from "@needle-tools/engine";
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from "three";

/**
 * Needle WebXR setup matching Unity ArApp WebAR placement.
 * Raw GLB has no lights / framing — apply after loadfinished.
 */
function addStudioLights(scene: Object3D) {
  if ((scene as any).__arappLights) return;
  (scene as any).__arappLights = true;

  scene.add(new AmbientLight(0xffffff, 0.7));
  scene.add(new HemisphereLight(0xddeeff, 0x223344, 0.85));

  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4.5, 2);
  scene.add(key);

  const fill = new DirectionalLight(0xaaccff, 0.55);
  fill.position.set(-3, 1.5, -1);
  scene.add(fill);
}

function frameCamera(scene: Object3D, camera: PerspectiveCamera, controls?: { target?: Vector3; update?: () => void }) {
  const box = new Box3();
  scene.traverse((o: any) => {
    if (o.isMesh) box.expandByObject(o);
  });
  if (box.isEmpty()) return;

  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  const dist = Math.max(size.x, size.y, size.z) * 2.2;
  camera.position.set(center.x + dist * 0.6, center.y + dist * 0.35, center.z + dist);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  if (controls?.target) {
    controls.target.copy(center);
    controls.update?.();
  }
}

function setupWebXR(scene: Object3D) {
  if ((scene as any).__arappWebXR) return;
  (scene as any).__arappWebXR = true;

  scene.addComponent(WebXR, {
    createARButton: true,
    createVRButton: false,
    createQRCode: true,
    useQuicklookExport: true,
    autoPlace: false,
    usePlacementReticle: true,
    usePlacementAdjustment: true,
    // Larger = smaller in world. Unity Content scale was 0.25 (already baked into glb).
    arScale: 1,
  });
}

onStart((context) => {
  const apply = () => {
    (context.scene as any).__arappLights = false;
    addStudioLights(context.scene);
    setupWebXR(context.scene);
    const cam = context.mainCamera as PerspectiveCamera;
    const controls =
      (context as any).mainCameraComponent?.controls ||
      (context as any).mainCameraComponent?._controls;
    if (cam) frameCamera(context.scene, cam, controls);
    console.log("[ArApp] Needle scene ready");
  };

  apply();

  const el = document.querySelector("needle-engine");
  el?.addEventListener("loadfinished", apply);
  if ((el as any)?.loadingFinished) apply();
});
