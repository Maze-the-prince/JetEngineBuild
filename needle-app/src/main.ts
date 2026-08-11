import "@needle-tools/engine";
import { onStart, WebXR } from "@needle-tools/engine";
import { AmbientLight, DirectionalLight, HemisphereLight, type Object3D } from "three";

/**
 * Needle WebXR setup matching Unity ArApp WebAR placement.
 * Raw GLB has no lights — re-add after loadfinished because scene content replaces children.
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
  setupWebXR(context.scene);
  addStudioLights(context.scene);

  const el = document.querySelector("needle-engine");
  const reapply = () => {
    // Scene graph may be rebuilt when the GLB finishes loading.
    (context.scene as any).__arappLights = false;
    addStudioLights(context.scene);
    setupWebXR(context.scene);
    console.log("[ArApp] Needle scene loaded + lit");
  };

  if (el) {
    el.addEventListener("loadfinished", reapply);
    // If already loaded before listener attached
    const anyEl = el as any;
    if (anyEl.loadingFinished) reapply();
  }

  console.log("[ArApp] Needle WebXR ready");
});
