import {
  Behaviour,
  GameObject,
  WebARSessionRoot,
  WebXR,
  onXRSessionEnd,
  onXRSessionStart,
  offXRSessionEnd,
  offXRSessionStart,
} from "@needle-tools/engine";
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from "three";
import { ensurePartInspect, type PartInspect } from "./part-inspect";
import {
  hidePartPanel,
  setArSessionActive,
  setPlacementPhase,
  setStatus,
} from "./ui";

const FALLBACK_DELAY_SEC = 8;
const STATUS_LOG_INTERVAL_SEC = 5;

const _pos = new Vector3();
const _quat = new Quaternion();
const _fwd = new Vector3();
const _up = new Vector3(0, 1, 0);
const _look = new Matrix4();

/**
 * Full Unity ArApp WebGL placement rules on top of Needle WebXR:
 * - Tap reticle to place (Needle built-in)
 * - After 8s: auto-place on hit, else camera-forward fallback
 * - One place per session
 * - Part inspect after place
 */
export class ArAppController extends Behaviour {
  private findingGround = false;
  private findingStart = 0;
  private nextStatusLog = 0;
  private usedFallback = false;
  private placed = false;
  private partInspect: PartInspect | null = null;
  private unsubPlaced: (() => void) | null = null;

  private readonly onStart = () => this.onSessionStart();
  private readonly onEnd = () => this.onSessionEnd();

  awake() {
    this.ensureStudioLights();
    this.setupPartInspect();

    this.unsubPlaced = WebARSessionRoot.onPlaced(() => {
      this.onPlaced("tap");
    });

    onXRSessionStart(this.onStart);
    onXRSessionEnd(this.onEnd);
  }

  /** Call after GLB loadfinished so hotspots attach to meshes. */
  refreshAfterLoad() {
    this.ensureStudioLights();
    this.setupPartInspect();
  }

  onDestroy() {
    this.unsubPlaced?.();
    offXRSessionStart(this.onStart);
    offXRSessionEnd(this.onEnd);
  }

  update() {
    if (!this.findingGround || this.placed) return;

    const elapsed = (performance.now() - this.findingStart) / 1000;
    const now = performance.now() / 1000;
    if (now >= this.nextStatusLog) {
      this.nextStatusLog = now + STATUS_LOG_INTERVAL_SEC;
      const root = this.getSessionRoot() as any;
      const hitReady = !!(root && root._reticle?.[0]?.visible);
      setStatus(
        `Scanning for a surface… ${Math.max(0, Math.ceil(FALLBACK_DELAY_SEC - elapsed))}s · hit=${hitReady ? "yes" : "no"}`
      );
    }

    if (elapsed < FALLBACK_DELAY_SEC || this.usedFallback) return;
    this.usedFallback = true;
    this.tryAutoOrFallbackPlace();
  }

  private onSessionStart() {
    setArSessionActive(true);
    setPlacementPhase("finding");
    this.findingGround = true;
    this.findingStart = performance.now();
    this.nextStatusLog = performance.now() / 1000 + STATUS_LOG_INTERVAL_SEC;
    this.usedFallback = false;
    this.placed = false;
    hidePartPanel();
    this.partInspect?.setPickingEnabled(false);
    this.partInspect?.showAllParts();

    const webxr = WebXR.activeWebXRComponent;
    if (webxr) webxr.usePlacementAdjustment = false;
    const root = this.getSessionRoot();
    if (root) root.arTouchTransform = false;

    setStatus("AR mode — point at a flat surface, then tap to place.");
  }

  private onSessionEnd() {
    setArSessionActive(false);
    setPlacementPhase("idle");
    this.findingGround = false;
    this.placed = false;
    this.usedFallback = false;
    hidePartPanel();
    this.partInspect?.setPickingEnabled(false);
    this.partInspect?.showAllParts();
    setStatus("Ready. Tap Enter AR on Chrome Android to begin.");
  }

  private onPlaced(reason: "tap" | "auto-hit" | "fallback") {
    if (this.placed) return;
    this.placed = true;
    this.findingGround = false;
    setPlacementPhase("placed");
    this.partInspect?.setPickingEnabled(true);
    this.partInspect?.captureStartVisibility();

    if (reason === "auto-hit") {
      setStatus("Auto-placed — tap a part to inspect.", "ok");
    } else if (reason === "fallback") {
      setStatus("Placed in front of camera — tap a part to inspect.", "ok");
    } else {
      setStatus("Placed — tap a part to inspect.", "ok");
    }
  }

  private getSessionRoot(): WebARSessionRoot | null {
    return WebXR.activeWebXRComponent?.arSessionRoot ?? null;
  }

  private tryAutoOrFallbackPlace() {
    if (this.placed || WebARSessionRoot.hasPlaced) {
      this.onPlaced("tap");
      return;
    }

    const root = this.getSessionRoot() as any;
    if (!root) {
      setStatus("Waiting for AR session root…", "warn");
      this.usedFallback = false;
      return;
    }

    const reticle = root._reticle?.[0] as Object3D | undefined;
    if (reticle?.visible) {
      try {
        root.onPlaceScene?.(null);
        this.onPlaced("auto-hit");
        return;
      } catch (err) {
        console.warn("[ArApp] auto hit place failed", err);
      }
    }

    this.placeFallbackInFrontOfCamera(root);
  }

  private placeFallbackInFrontOfCamera(root: any) {
    const cam = this.context.mainCamera as PerspectiveCamera | null;
    if (!cam) {
      setStatus("No camera for fallback place.", "error");
      return;
    }

    cam.getWorldPosition(_pos);
    cam.getWorldDirection(_fwd);
    const fallback = _pos.clone().addScaledVector(_fwd, 1.2);
    fallback.y = _pos.y - 1.4;

    const flatFwd = new Vector3(_fwd.x, 0, _fwd.z);
    if (flatFwd.lengthSq() < 1e-6) flatFwd.set(0, 0, -1);
    flatFwd.normalize();
    _look.lookAt(new Vector3(), flatFwd, _up);
    _quat.setFromRotationMatrix(_look);

    let reticle = root._reticle?.[0] as any;
    if (!reticle) {
      reticle = new Object3D();
      reticle.name = "AR Fallback Reticle";
      reticle.matrixAutoUpdate = false;
      root._reticle = root._reticle || [];
      root._reticle[0] = reticle;
      this.context.scene.add(reticle);
    }

    reticle.position.copy(fallback);
    reticle.quaternion.copy(_quat);
    reticle["lastPos"] = fallback.clone();
    reticle["lastQuat"] = _quat.clone();
    reticle.visible = true;
    reticle.updateMatrix?.();

    const prevAuto = root.autoPlace;
    root.autoPlace = true;
    try {
      root.onPlaceScene?.(null);
      this.onPlaced("fallback");
    } catch (err) {
      console.warn("[ArApp] fallback place failed", err);
      setStatus("Could not auto-place — tap when the reticle appears.", "warn");
      this.usedFallback = false;
    } finally {
      root.autoPlace = prevAuto;
    }
  }

  private setupPartInspect() {
    let root: Object3D = this.context.scene;
    this.context.scene.traverse((o) => {
      if (
        o.name === "Scene" ||
        o.name === "ARSessionRoot" ||
        o.name === "Content" ||
        o.name === "JetEngine"
      ) {
        if (o !== this.context.scene) root = o;
      }
    });
    this.partInspect = ensurePartInspect(root);
    this.partInspect.setPickingEnabled(true);
  }

  private ensureStudioLights() {
    const scene = this.context.scene as any;
    if (scene.__arappLights) return;
    scene.__arappLights = true;
    scene.add(new AmbientLight(0xffffff, 0.7));
    scene.add(new HemisphereLight(0xddeeff, 0x223344, 0.85));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(2.5, 4.5, 2);
    scene.add(key);
    const fill = new DirectionalLight(0xaaccff, 0.55);
    fill.position.set(-3, 1.5, -1);
    scene.add(fill);
  }
}

export function frameDesktopCamera(
  scene: Object3D,
  camera: PerspectiveCamera,
  controls?: { target?: Vector3; update?: () => void }
) {
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

export function setupWebXR(scene: Object3D) {
  const existing = GameObject.getComponent(scene, WebXR);
  if (existing) return existing;

  return scene.addComponent(WebXR, {
    createARButton: true,
    createVRButton: false,
    createQRCode: true,
    useQuicklookExport: true,
    autoPlace: false,
    usePlacementReticle: true,
    usePlacementAdjustment: false,
    arScale: 1,
  });
}

export function bootstrapArApp(scene: Object3D): ArAppController {
  let ctrl = GameObject.getComponent(scene, ArAppController);
  if (!ctrl) ctrl = GameObject.addComponent(scene, ArAppController);
  return ctrl;
}
