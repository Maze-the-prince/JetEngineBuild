import {
  Behaviour,
  GameObject,
  ObjectRaycaster,
  type PointerEventData,
} from "@needle-tools/engine";
import type { Object3D } from "three";
import { findPartDefFromObject, type PartDef } from "./parts-catalog";
import { bindPartActions, hidePartPanel, setStatus, showPartPanel } from "./ui";

type MeshLike = Object3D & { isMesh?: boolean; visible: boolean };

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
 * Unity PickMesh / Part UI port:
 * tap a part → title + description → Hide / Close / Show All / Reset
 */
export class PartInspect extends Behaviour {
  enabledPicking = false;

  private selected: PartDef | null = null;
  private selectedMeshes: MeshLike[] = [];
  private startVisibility = new Map<Object3D, boolean>();
  private bound = false;

  awake() {
    this.captureStartVisibility();
    this.ensureHotspots();
    if (!GameObject.getComponent(this.gameObject, ObjectRaycaster)) {
      GameObject.addComponent(this.gameObject, ObjectRaycaster);
    }
    if (!this.bound) {
      this.bound = true;
      bindPartActions({
        onClose: () => this.clearSelection(),
        onHide: () => this.hideSelected(),
        onShowAll: () => this.showAllParts(),
        onReset: () => this.resetParts(),
      });
    }
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

  setPickingEnabled(enabled: boolean) {
    this.enabledPicking = enabled;
    if (!enabled) this.clearSelection();
  }

  captureStartVisibility() {
    this.startVisibility.clear();
    this.gameObject.traverse((o: any) => {
      if (o.isMesh) this.startVisibility.set(o, o.visible !== false);
    });
  }

  onPointerClick(args: PointerEventData) {
    this.handlePointerClick(args);
  }

  handlePointerClick(args: PointerEventData) {
    if (!this.enabledPicking) return;
    const obj = args.object as Object3D | undefined;
    if (!obj) return;

    const def = findPartDefFromObject(obj);
    if (!def) {
      this.clearSelection();
      return;
    }

    args.use?.();
    this.selected = def;
    this.selectedMeshes = this.collectMeshes(def);
    showPartPanel(def.title, def.description);
    setStatus(`Selected ${def.title}.`, "ok");
  }

  private collectMeshes(def: PartDef): MeshLike[] {
    const meshes: MeshLike[] = [];
    this.gameObject.traverse((o: any) => {
      if (!o.isMesh) return;
      const hit = findPartDefFromObject(o);
      if (hit?.uid === def.uid) meshes.push(o);
    });
    return meshes;
  }

  clearSelection() {
    this.selected = null;
    this.selectedMeshes = [];
    hidePartPanel();
  }

  hideSelected() {
    if (!this.selected) return;
    for (const m of this.selectedMeshes) m.visible = false;
    setStatus(`Hidden ${this.selected.title}.`, "ok");
    this.clearSelection();
  }

  showAllParts() {
    this.gameObject.traverse((o: any) => {
      if (o.isMesh) o.visible = true;
    });
    setStatus("All parts visible.", "ok");
  }

  resetParts() {
    this.gameObject.traverse((o: any) => {
      if (!o.isMesh) return;
      const start = this.startVisibility.get(o);
      o.visible = start !== false;
    });
    this.clearSelection();
    setStatus("Parts reset.", "ok");
  }
}

/** Attach PartInspect to the loaded engine root (Scene group or scene). */
export function ensurePartInspect(root: Object3D): PartInspect {
  let inspect = GameObject.getComponent(root, PartInspect);
  if (!inspect) {
    inspect = GameObject.addComponent(root, PartInspect);
  }
  inspect.captureStartVisibility();
  return inspect;
}
