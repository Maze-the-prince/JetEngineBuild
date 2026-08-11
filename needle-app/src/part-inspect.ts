import {
  Behaviour,
  GameObject,
  ObjectRaycaster,
  type PointerEventData,
} from "@needle-tools/engine";
import { Object3D, Plane, Raycaster, Vector2, Vector3 } from "three";
import { findPartDefFromObject, type PartDef } from "./parts-catalog";
import {
  bindUnityUi,
  hideNoteDialog,
  hidePartPanel,
  positionPartCard,
  renderNotes,
  setMoveHud,
  setStatus,
  showNoteDialog,
  showPartPanel,
} from "./ui";

type MeshLike = Object3D & { isMesh?: boolean; visible: boolean };

const STORAGE_KEY = "AR_PARTS";

type PartRuntime = {
  def: PartDef;
  root: Object3D;
  meshes: MeshLike[];
  notes: string[];
  startLocalPos: Vector3;
};

/** Per-mesh hotspot so Needle EventSystem includes geometry in raycasts. */
export class PartHotspot extends Behaviour {
  onPointerClick(args: PointerEventData) {
    const inspect =
      GameObject.getComponentInParent(this.gameObject, PartInspect) ||
      GameObject.getComponent(this.context.scene, PartInspect);
    inspect?.handlePointerClick(args);
  }
}

/**
 * Unity PickMesh / PartUI / Parts menu port.
 */
export class PartInspect extends Behaviour {
  enabledPicking = false;

  private parts = new Map<string, PartRuntime>();
  private selectedUid: string | null = null;
  private hitWorld = new Vector3();
  private moving = false;
  private dragging = false;
  private bound = false;
  private readonly _ndc = new Vector2();
  private readonly _raycaster = new Raycaster();
  private readonly _axisPlane = new Plane();
  private readonly _hit = new Vector3();
  private readonly _world = new Vector3();
  private readonly _local = new Vector3();
  private readonly _axis = new Vector3(1, 0, 0);
  private readonly _axisOrigin = new Vector3();
  private readonly _camUp = new Vector3(0, 1, 0);
  private readonly _p1 = new Vector3();
  private readonly _p2 = new Vector3();
  /** Signed meters along move axis from enter-move origin. */
  private moveT = 0;
  private dragOffsetT = 0;
  /** Ignore scene picks briefly after HUD button presses (AR click-through). */
  private ignorePickUntil = 0;

  awake() {
    this.rebuildParts();
    this.ensureHotspots();
    if (!GameObject.getComponent(this.gameObject, ObjectRaycaster)) {
      GameObject.addComponent(this.gameObject, ObjectRaycaster);
    }
    if (!this.bound) {
      this.bound = true;
      bindUnityUi({
        onClose: () => this.clearSelection(),
        onHide: () => this.hideSelected(),
        onMove: () => this.enterMove(),
        onAddNote: () => this.openNoteDialog(),
        onNoteSave: (text) => this.commitNote(text),
        onNoteCancel: () => this.cancelNoteDialog(),
        onDeleteNote: (i) => this.deleteNote(i),
        onExitMove: () => this.exitMove(),
        onShowAll: () => this.showAllParts(),
        onReset: () => this.resetParts(),
        onSave: () => this.saveParts(),
        onLoad: () => this.loadParts(),
      });

      // Capture on document so AR canvas touches still reach us
      const opts: AddEventListenerOptions = { capture: true, passive: false };
      document.addEventListener("pointerdown", this.onPointerDown, opts);
      document.addEventListener("pointermove", this.onPointerMove, opts);
      document.addEventListener("pointerup", this.onPointerUp, opts);
      document.addEventListener("pointercancel", this.onPointerUp, opts);
    }
  }

  onDestroy() {
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("pointermove", this.onPointerMove, true);
    document.removeEventListener("pointerup", this.onPointerUp, true);
    document.removeEventListener("pointercancel", this.onPointerUp, true);
  }

  update() {
    if (!this.selectedUid || this.moving) return;
    const cam = this.context.mainCamera;
    if (!cam) return;
    const p = this.hitWorld.clone().project(cam);
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    if (p.z < 1) positionPartCard(x, y);
  }

  setPickingEnabled(enabled: boolean) {
    this.enabledPicking = enabled;
    if (!enabled) {
      this.exitMove();
      this.clearSelection();
    }
  }

  captureStartVisibility() {
    this.rebuildParts();
  }

  private rebuildParts() {
    const prevNotes = new Map<string, string[]>();
    for (const [uid, runtime] of this.parts) prevNotes.set(uid, runtime.notes);

    this.parts.clear();
    this.gameObject.traverse((o: any) => {
      if (!o.isMesh) return;
      const def = findPartDefFromObject(o);
      if (!def) return;
      let runtime = this.parts.get(def.uid);
      if (!runtime) {
        let root: Object3D = o;
        let cur: Object3D | null = o;
        while (cur) {
          if (def.meshNames.includes(cur.name)) {
            root = cur;
            break;
          }
          cur = cur.parent;
        }
        runtime = {
          def,
          root,
          meshes: [],
          notes: prevNotes.get(def.uid) ?? [],
          startLocalPos: root.position.clone(),
        };
        this.parts.set(def.uid, runtime);
      }
      runtime.meshes.push(o);
    });
  }

  private ensureHotspots() {
    this.gameObject.traverse((o: any) => {
      if (!o.isMesh) return;
      if (!findPartDefFromObject(o)) return;
      if (!GameObject.getComponent(o, PartHotspot)) {
        GameObject.addComponent(o, PartHotspot);
      }
    });
  }

  onPointerClick(args: PointerEventData) {
    this.handlePointerClick(args);
  }

  handlePointerClick(args: PointerEventData) {
    if (!this.enabledPicking || this.moving) return;
    if (uiMenuOpen()) return;
    if (performance.now() < this.ignorePickUntil) return;

    const obj = args.object as Object3D | undefined;
    if (!obj) return;
    const def = findPartDefFromObject(obj);
    if (!def) {
      this.clearSelection();
      return;
    }

    args.use?.();
    this.selectedUid = def.uid;
    if (args.point) this.hitWorld.copy(args.point as Vector3);
    else obj.getWorldPosition(this.hitWorld);

    const runtime = this.parts.get(def.uid);
    showPartPanel(def.title, def.description, runtime?.notes ?? []);
    setStatus(`Selected ${def.title}.`);
  }

  clearSelection() {
    this.selectedUid = null;
    hidePartPanel();
    hideNoteDialog();
  }

  hideSelected() {
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (!runtime) return;
    for (const m of runtime.meshes) m.visible = false;
    runtime.root.visible = false;
    setStatus(`Hidden ${runtime.def.title}.`);
    this.clearSelection();
  }

  showAllParts() {
    for (const runtime of this.parts.values()) {
      runtime.root.visible = true;
      for (const m of runtime.meshes) m.visible = true;
    }
    setStatus("All parts visible.");
  }

  resetParts() {
    for (const runtime of this.parts.values()) {
      runtime.root.position.copy(runtime.startLocalPos);
      runtime.root.visible = true;
      for (const m of runtime.meshes) m.visible = true;
      runtime.notes = [];
    }
    this.exitMove();
    this.clearSelection();
    setStatus("Parts reset.");
  }

  private openNoteDialog() {
    if (!this.selectedUid) return;
    this.armUiGuard();
    hidePartPanel();
    showNoteDialog("");
    setStatus("Type a note, then Save.");
  }

  private cancelNoteDialog() {
    this.armUiGuard();
    hideNoteDialog();
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (runtime) {
      showPartPanel(runtime.def.title, runtime.def.description, runtime.notes);
    }
  }

  private commitNote(text: string) {
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (!runtime) {
      hideNoteDialog();
      return;
    }
    const cleaned = text.trim();
    if (!cleaned) {
      setStatus("Note is empty.");
      return;
    }
    this.armUiGuard();
    runtime.notes.push(cleaned);
    hideNoteDialog();
    showPartPanel(runtime.def.title, runtime.def.description, [...runtime.notes]);
    this.saveParts();
    setStatus("Note added.");
  }

  private armUiGuard(ms = 450) {
    this.ignorePickUntil = performance.now() + ms;
  }

  private deleteNote(index: number) {
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (!runtime) return;
    runtime.notes.splice(index, 1);
    renderNotes(runtime.notes);
    this.saveParts();
  }

  private enterMove() {
    if (!this.selectedUid) return;
    const runtime = this.parts.get(this.selectedUid);
    if (!runtime) return;

    this.moving = true;
    this.dragging = false;
    this.moveT = 0;
    this.dragOffsetT = 0;
    runtime.root.getWorldPosition(this._axisOrigin);
    this.resolveMoveAxis(this._axis);
    hidePartPanel();
    hideNoteDialog();
    setMoveHud(true);
    setStatus("Drag left/right along the axis · tap ✕ when done.");

    runtime.root.visible = true;
    for (const m of runtime.meshes) m.visible = true;
  }

  private exitMove() {
    if (!this.moving && !this.dragging) {
      setMoveHud(false);
      return;
    }
    this.moving = false;
    this.dragging = false;
    setMoveHud(false);
    this.saveParts();
    setStatus("Move finished.");
  }

  private isUiTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el?.closest) return false;
    return !!el.closest(
      "#ar-ui button, #ar-ui .modal, #ar-ui #part-card, #ar-ui textarea, #ar-ui input, #btn-exit-move, #btn-menu"
    );
  }

  /** Unity-style part axis: horizontal slide along the engine length. */
  private resolveMoveAxis(into: Vector3) {
    into.set(0, 0, 1).transformDirection(this.gameObject.matrixWorld);
    into.y = 0;
    if (into.lengthSq() < 1e-6) {
      into.set(1, 0, 0).transformDirection(this.gameObject.matrixWorld);
      into.y = 0;
    }
    if (into.lengthSq() < 1e-6) into.set(1, 0, 0);
    else into.normalize();
    return into;
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    if (!this.moving || !this.selectedUid) return;
    if (this.isUiTarget(e.target)) return;

    const t = this.screenToAxisT(e.clientX, e.clientY);
    if (t == null) return;

    this.dragOffsetT = this.moveT - t;
    this.dragging = true;
    try {
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.moving || !this.dragging || !this.selectedUid) return;

    const runtime = this.parts.get(this.selectedUid);
    if (!runtime) return;

    const t = this.screenToAxisT(e.clientX, e.clientY);
    if (t == null) return;

    this.moveT = t + this.dragOffsetT;
    this._world
      .copy(this._axis)
      .multiplyScalar(this.moveT)
      .add(this._axisOrigin);

    const parent = runtime.root.parent;
    if (parent) {
      parent.worldToLocal(this._local.copy(this._world));
      runtime.root.position.copy(this._local);
    } else {
      runtime.root.position.copy(this._world);
    }

    e.preventDefault();
  };

  private readonly onPointerUp = () => {
    this.dragging = false;
  };

  /**
   * Unity ProcessMovePart: ray → plane(axis, camera.up), then keep only axis coordinate.
   * Returns signed meters along the frozen enter-move axis from `_axisOrigin`.
   */
  private screenToAxisT(clientX: number, clientY: number): number | null {
    const cam = this.context.mainCamera;
    if (!cam) return null;

    this._ndc.x = (clientX / window.innerWidth) * 2 - 1;
    this._ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, cam);

    this._camUp.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    this._p1.copy(this._axisOrigin).add(this._axis);
    this._p2.copy(this._axisOrigin).add(this._camUp);
    this._axisPlane.setFromCoplanarPoints(this._axisOrigin, this._p1, this._p2);

    if (!this._raycaster.ray.intersectPlane(this._axisPlane, this._hit)) return null;
    return this._hit.sub(this._axisOrigin).dot(this._axis);
  }

  saveParts() {
    const data: Record<string, { visible: boolean; pos: number[]; notes: string[] }> = {};
    for (const [uid, runtime] of this.parts) {
      data[uid] = {
        visible: runtime.root.visible !== false,
        pos: runtime.root.position.toArray(),
        notes: [...runtime.notes],
      };
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setStatus("Parts saved.");
    } catch {
      setStatus("Save failed.", "error");
    }
  }

  loadParts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setStatus("No saved parts.");
        return;
      }
      const data = JSON.parse(raw) as Record<
        string,
        { visible: boolean; pos: number[]; notes: string[] }
      >;
      for (const [uid, saved] of Object.entries(data)) {
        const runtime = this.parts.get(uid);
        if (!runtime) continue;
        runtime.root.position.fromArray(saved.pos);
        runtime.root.visible = saved.visible;
        for (const m of runtime.meshes) m.visible = saved.visible;
        runtime.notes = saved.notes ?? [];
      }
      this.clearSelection();
      setStatus("Parts loaded.");
    } catch {
      setStatus("Load failed.", "error");
    }
  }
}

function uiMenuOpen() {
  const main = document.getElementById("menu-main");
  const parts = document.getElementById("menu-parts");
  const note = document.getElementById("note-dialog");
  return (
    (main && !main.hidden) ||
    (parts && !parts.hidden) ||
    (note && !note.hidden)
  );
}

export function ensurePartInspect(root: Object3D): PartInspect {
  let inspect = GameObject.getComponent(root, PartInspect);
  if (!inspect) {
    inspect = GameObject.addComponent(root, PartInspect);
  }
  inspect.captureStartVisibility();
  return inspect;
}
