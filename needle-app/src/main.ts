import "@needle-tools/engine";
import { onStart, WebXR } from "@needle-tools/engine";

/**
 * Needle WebXR setup matching Unity ArApp WebAR placement:
 * - AR button
 * - placement reticle
 * - tap to place (not auto)
 * - allow post-place adjustment
 */
onStart((context) => {
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
