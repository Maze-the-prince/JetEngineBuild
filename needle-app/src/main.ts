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
 */
let appliedFor: any = null;
let framedFor: any = null;
let loadHooked = false;

function applyScene(context: any, opts: { frame?: boolean; refresh?: boolean } = {}) {
  if (!context?.scene) return;
  setupWebXR(context.scene);
  const app = bootstrapArApp(context.scene);

  if (opts.refresh !== false) app.refreshAfterLoad();

  if (opts.frame !== false && framedFor !== context) {
    const cam = context.mainCamera as PerspectiveCamera | undefined;
    const controls =
      context.mainCameraComponent?.controls ||
      context.mainCameraComponent?._controls;
    if (cam) {
      frameDesktopCamera(context.scene, cam, controls);
      framedFor = context;
    }
  }

  appliedFor = context;
  setStatus("Ready. Tap Enter AR on Chrome Android to begin.");
}

function boot(context: any) {
  applyScene(context);
  const el = document.querySelector("needle-engine") as any;
  if (!el || loadHooked) return;
  loadHooked = true;

  el.addEventListener("loadfinished", () => applyScene(context, { frame: true, refresh: true }));
  if (el.loadingFinished) applyScene(context, { frame: true, refresh: true });

  el.getContext?.()
    .then((ctx: any) => {
      if (ctx && ctx !== appliedFor) applyScene(ctx);
    })
    .catch(() => {});
}

onStart(boot);
onInitialized(boot);

queueMicrotask(() => {
  const el = document.querySelector("needle-engine") as any;
  if (el?.context && el.context !== appliedFor) boot(el.context);
});
