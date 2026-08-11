import "@needle-tools/engine";
import { onStart } from "@needle-tools/engine";
import type { PerspectiveCamera } from "three";
import {
  bootstrapArApp,
  frameDesktopCamera,
  setupWebXR,
} from "./ar-app";
import { setStatus } from "./ui";

/**
 * Needle Engine WebAR port of Unity ArApp.
 * Placement + 8s fallback + part inspect live in ArAppController.
 */
function applyScene(context: any) {
  setupWebXR(context.scene);
  const app = bootstrapArApp(context.scene);
  app.refreshAfterLoad();

  const cam = context.mainCamera as PerspectiveCamera | undefined;
  const controls =
    context.mainCameraComponent?.controls ||
    context.mainCameraComponent?._controls;
  if (cam) frameDesktopCamera(context.scene, cam, controls);

  setStatus("Ready. Tap Enter AR on Chrome Android to begin.");
}

onStart((context) => {
  applyScene(context);

  const el = document.querySelector("needle-engine");
  const reapply = () => applyScene(context);
  el?.addEventListener("loadfinished", reapply);
  if ((el as any)?.loadingFinished) reapply();
});
