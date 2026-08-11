import "@needle-tools/engine";
import { onInitialized, onStart } from "@needle-tools/engine";
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
 *
 * Register multiple boot paths — on slow Pages loads, onStart alone can race
 * the <needle-engine> context / GLB loadfinished event.
 */
let appliedFor: any = null;

function applyScene(context: any) {
  if (!context?.scene) return;
  setupWebXR(context.scene);
  const app = bootstrapArApp(context.scene);
  app.refreshAfterLoad();

  const cam = context.mainCamera as PerspectiveCamera | undefined;
  const controls =
    context.mainCameraComponent?.controls ||
    context.mainCameraComponent?._controls;
  if (cam) frameDesktopCamera(context.scene, cam, controls);

  appliedFor = context;
  setStatus("Ready. Tap Enter AR on Chrome Android to begin.");
}

function boot(context: any) {
  applyScene(context);
  const el = document.querySelector("needle-engine") as any;
  if (!el) return;

  const reapply = () => applyScene(context);
  el.addEventListener("loadfinished", reapply);
  if (el.loadingFinished) reapply();

  // Extra safety if context resolves after module eval
  el.getContext?.().then((ctx: any) => applyScene(ctx)).catch(() => {});
}

onStart(boot);
onInitialized(boot);

// If the custom element already has a context when this module evaluates
queueMicrotask(() => {
  const el = document.querySelector("needle-engine") as any;
  if (el?.context && el.context !== appliedFor) boot(el.context);
});
