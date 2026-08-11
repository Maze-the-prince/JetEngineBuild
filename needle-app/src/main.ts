import "@needle-tools/engine";
import { onStart, WebXR } from "@needle-tools/engine";
import { AmbientLight, DirectionalLight, HemisphereLight } from "three";

/**
 * Needle WebXR setup matching Unity ArApp WebAR placement:
 * - AR button
 * - placement reticle
 * - tap to place (not auto)
 * - allow post-place adjustment
 *
 * Raw GLB has no lights — add studio lighting so the turbofan is visible on desktop.
 */
onStart((context) => {
  context.scene.add(new AmbientLight(0xffffff, 0.55));
  context.scene.add(new HemisphereLight(0xddeeff, 0x223344, 0.65));

  const key = new DirectionalLight(0xffffff, 1.35);
  key.position.set(2.5, 4.5, 2);
  context.scene.add(key);

  const fill = new DirectionalLight(0xaaccff, 0.45);
  fill.position.set(-3, 1.5, -1);
  context.scene.add(fill);

  const webxr = context.scene.addComponent(WebXR, {
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

  console.log("[ArApp] Needle WebXR ready", webxr);
});
