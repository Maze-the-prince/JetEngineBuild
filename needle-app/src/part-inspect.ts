import {
  Behaviour,
  GameObject,
  ObjectRaycaster,
  type PointerEventData,
} from "@needle-tools/engine";
import { Object3D, Vector2, Vector3 } from "three";
import { findPartDefFromObject, type PartDef } from "./parts-catalog";
import {
  bindUnityUi,
  hidePartPanel,
  isUiBlocking,
  positionPartCard,
  renderNotes,
  setMoveHud,
  setStatus,
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
  startVisible: boolean;
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
  private dragLast = new Vector2();
  private bound = false;
  private readonly _axis = new Vector3();
  private readonly _camRight = new Vector3();

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
        onAddNote: () => this.addNote(),
        onDeleteNote: (i) => this.deleteNote(i),
        onExitMove: () => this.exitMove(),
        onShowAll: () => this.showAllParts(),
        onReset: () => this.resetParts(),
        onSave: () => this.saveParts(),
        onLoad: () => this.loadParts(),
      });
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerup", this.onPointerUp, { passive: true });
    }
  }

  onDestroy() {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  }

  update() {
    if (!this.selectedUid) return;
    if (this.moving) return;
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
    this.parts.clear();
    this.gameObject.traverse((o: any) => {
      if (!o.isMesh) return;
      const def = findPartDefFromObject(o);
      if (!def) return;
      let runtime = this.parts.get(def.uid);
      if (!runtime) {
        // Prefer named root object matching first mesh name
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
          notes: [],
          startLocalPos: root.position.clone(),
          startVisible: true,
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
    if (isUiBlocking() && document.getElementById("part-card")?.hidden === false) {
      // allow re-picking while card open (Unity replaces selection)
    }
    if (uiMenuOpen()) return;

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
    showPartPanel(def.title, def.description, runtime?.notes ?? [], undefined, undefined);
    setStatus(`Selected ${def.title}.`);
  }

  clearSelection() {
    this.selectedUid = null;
    hidePartPanel();
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

  private addNote() {
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (!runtime) return;
    // Match Unity WebGL stub
    const hhmm = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    runtime.notes.push(`Web note ${hhmm}`);
    renderNotes(runtime.notes);
    setStatus("Note added.");
  }

  private deleteNote(index: number) {
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (!runtime) return;
    runtime.notes.splice(index, 1);
    renderNotes(runtime.notes);
  }

  private enterMove() {
    if (!this.selectedUid) return;
    this.moving = true;
    hidePartPanel();
    setMoveHud(true);
    setStatus("Drag to move part · tap ✕ when done.");
  }

  private exitMove() {
    if (!this.moving) return;
    this.moving = false;
    setMoveHud(false);
    setStatus("Move finished.");
  }

  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.moving || !this.selectedUid) return;
    const runtime = this.parts.get(this.selectedUid);
    const cam = this.context.mainCamera;
    if (!runtime || !cam) return;

    if (this.dragLast.x === 0 && this.dragLast.y === 0) {
      this.dragLast.set(e.clientX, e.clientY);
      return;
    }

    const dx = e.clientX - this.dragLast.x;
    const dy = e.clientY - this.dragLast.y;
    this.dragLast.set(e.clientX, e.clientY);

    // Slide along part local Z (Unity axis forward), scaled by screen drag
    this._axis.set(0, 0, 1).transformDirection(runtime.root.matrixWorld).normalize();
    this._camRight.set(1, 0, 0).transformDirection(cam.matrixWorld).normalize();
    const along = this._axis.dot(this._camRight) >= 0 ? 1 : -1;
    const delta = (dx * along - dy * 0.35) * 0.0025;
    runtime.root.position.addScaledVector(this._axis, delta);
  };

  private readonly onPointerUp = () => {
    this.dragLast.set(0, 0);
  };

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
  return (main && !main.hidden) || (parts && !parts.hidden);
}

export function ensurePartInspect(root: Object3D): PartInspect {
  let inspect = GameObject.getComponent(root, PartInspect);
  if (!inspect) {
    inspect = GameObject.addComponent(root, PartInspect);
  }
  inspect.captureStartVisibility();
  return inspect;
}
