import {
  Behaviour,
  GameObject,
  ObjectRaycaster,
  type PointerEventData,
} from "@needle-tools/engine";
import { Matrix4, Object3D, Vector2, Vector3 } from "three";
import { findPartDefFromObject, type PartDef } from "./parts-catalog";
import {
  bindUnityUi,
  hideNoteDialog,
  hidePartPanel,
  positionPartCard,
  renderNotes,
  setMoveHud,
  setStatus,
  setUnityUiHandlers,
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

/** Active inspect used by UI + hotspots (only one should handle notes/move). */
let activeInspect: PartInspect | null = null;

/** One document listener set — avoids duplicate handlers when inspect re-binds. */
let moveListenersBound = false;

function moveEventTargets(): EventTarget[] {
  const targets: EventTarget[] = [window, document];
  const ne = document.querySelector("needle-engine");
  const canvas = ne?.shadowRoot?.querySelector("canvas");
  if (canvas) targets.push(canvas);
  if (ne) targets.push(ne);
  return targets;
}

function bindMoveListenersOnce() {
  if (moveListenersBound) return;
  moveListenersBound = true;

  const down: AddEventListenerOptions = { capture: true, passive: false };
  const move: AddEventListenerOptions = { capture: true, passive: false };
  const up: AddEventListenerOptions = { capture: true, passive: false };

  for (const t of moveEventTargets()) {
    t.addEventListener("pointerdown", onDocPointerDown, down);
    t.addEventListener("pointermove", onDocPointerMove, move);
    t.addEventListener("pointerup", onDocPointerUp, up);
    t.addEventListener("pointercancel", onDocPointerUp, up);
    t.addEventListener("touchstart", onTouchStart, down);
    t.addEventListener("touchmove", onTouchMove, move);
    t.addEventListener("touchend", onTouchEnd, up);
    t.addEventListener("touchcancel", onTouchEnd, up);
  }
}

function onDocPointerDown(e: PointerEvent) {
  activeInspect?.handleMovePointerDown(e);
}

function onDocPointerMove(e: PointerEvent) {
  activeInspect?.handleMovePointerMove(e);
}

function onDocPointerUp(e: Event) {
  activeInspect?.handleMovePointerUp(e);
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return;
  activeInspect?.handleMoveTouch(e.touches[0].clientX, e.touches[0].clientY, true, e);
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length !== 1) return;
  activeInspect?.handleMoveTouch(e.touches[0].clientX, e.touches[0].clientY, false, e);
}

function onTouchEnd(e: TouchEvent) {
  if (e.touches.length > 0) return;
  activeInspect?.handleMovePointerUp(e);
}

/** Per-mesh hotspot so Needle EventSystem includes geometry in raycasts. */
export class PartHotspot extends Behaviour {
  onPointerClick(args: PointerEventData) {
    const inspect =
      activeInspect ||
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
  private hotspotsReady = false;
  private readonly _world = new Vector3();
  private readonly _local = new Vector3();
  private readonly _projected = new Vector3();
  private readonly _axis = new Vector3(1, 0, 0);
  private readonly _axisOrigin = new Vector3();
  private readonly _screenA = new Vector3();
  private readonly _screenB = new Vector3();
  private readonly _screenAxis = new Vector2(1, 0);
  private readonly _invParent = new Matrix4();
  private moveT = 0;
  private moveT0 = 0;
  private dragScreen0 = 0;
  private metersPerPx = 0.002;
  private ignorePickUntil = 0;
  private lastCardX = -1;
  private lastCardY = -1;
  private moveRoot: Object3D | null = null;
  private moveParent: Object3D | null = null;
  private placementBasis: Object3D | null = null;
  private pendingX = 0;
  private pendingY = 0;
  private dragX = 0;
  private dragY = 0;
  private fingerDown = false;
  private touchDragActive = false;
  private activePointerId: number | null = null;
  private pickingBeforeMove = false;
  private pickingSuspendedForMove = false;

  awake() {
    this.rebuildParts();
    this.ensureHotspots();
    if (!GameObject.getComponent(this.gameObject, ObjectRaycaster)) {
      GameObject.addComponent(this.gameObject, ObjectRaycaster);
    }

    this.becomeActive();
    bindUnityUi({
      onClose: () => this.clearSelection(),
      onHide: () => this.hideSelected(),
      onMove: () => this.enterMove(),
      onAddNote: () => this.openNoteDialog(),
      onNoteSave: (text: string) => this.commitNote(text),
      onNoteCancel: () => this.cancelNoteDialog(),
      onDeleteNote: (i: number) => this.deleteNote(i),
      onExitMove: () => this.exitMove(),
      onShowAll: () => this.showAllParts(),
      onReset: () => this.resetParts(),
      onSave: () => this.saveParts(),
      onLoad: () => this.loadParts(),
    });
    bindMoveListenersOnce();
  }

  onDestroy() {
    if (activeInspect === this) activeInspect = null;
    this.endDrag();
  }

  private becomeActive() {
    activeInspect = this;
    setUnityUiHandlers({
      onClose: () => this.clearSelection(),
      onHide: () => this.hideSelected(),
      onMove: () => this.enterMove(),
      onAddNote: () => this.openNoteDialog(),
      onNoteSave: (text: string) => this.commitNote(text),
      onNoteCancel: () => this.cancelNoteDialog(),
      onDeleteNote: (i: number) => this.deleteNote(i),
      onExitMove: () => this.exitMove(),
      onShowAll: () => this.showAllParts(),
      onReset: () => this.resetParts(),
      onSave: () => this.saveParts(),
      onLoad: () => this.loadParts(),
    });
  }

  update() {
    // Unity TryGetPressHeld — AR often drops pointermove; poll every frame while held
    if (this.moving && this.fingerDown && this.dragging) {
      this.applyDragAt(this.dragX, this.dragY);
      return;
    }

    if (!this.selectedUid || this.moving) return;
    const cam = this.context.mainCamera;
    if (!cam) return;
    this._projected.copy(this.hitWorld).project(cam);
    if (this._projected.z >= 1) return;
    const x = (this._projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this._projected.y * 0.5 + 0.5) * window.innerHeight;
    if (Math.abs(x - this.lastCardX) < 1.5 && Math.abs(y - this.lastCardY) < 1.5) return;
    this.lastCardX = x;
    this.lastCardY = y;
    positionPartCard(x, y);
  }

  setPickingEnabled(enabled: boolean) {
    this.enabledPicking = enabled;
    if (!enabled) {
      this.pickingSuspendedForMove = false;
      this.exitMove();
      this.clearSelection();
    }
  }

  captureStartVisibility() {
    this.becomeActive();
    this.rebuildParts(true);
    this.ensureHotspots();
    this.placementBasis = null;
  }

  private rebuildParts(preserveStartPos = false) {
    const prevNotes = new Map<string, string[]>();
    const prevStart = new Map<string, Vector3>();
    for (const [uid, runtime] of this.parts) {
      prevNotes.set(uid, runtime.notes);
      prevStart.set(uid, runtime.startLocalPos);
    }

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
        const start =
          preserveStartPos && prevStart.has(def.uid)
            ? prevStart.get(def.uid)!.clone()
            : root.position.clone();
        runtime = {
          def,
          root,
          meshes: [],
          notes: prevNotes.get(def.uid) ?? [],
          startLocalPos: start,
        };
        this.parts.set(def.uid, runtime);
      }
      runtime.meshes.push(o);
    });

    this.hydrateNotesFromStorage();
  }

  private hydrateNotesFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, { notes?: string[] }>;
      for (const [uid, runtime] of this.parts) {
        if (runtime.notes.length) continue;
        const saved = data[uid]?.notes;
        if (saved?.length) runtime.notes = [...saved];
      }
    } catch {
      /* ignore */
    }
  }

  private ensureHotspots() {
    let added = 0;
    this.gameObject.traverse((o: any) => {
      if (!o.isMesh) return;
      if (!findPartDefFromObject(o)) return;
      if (!GameObject.getComponent(o, PartHotspot)) {
        GameObject.addComponent(o, PartHotspot);
        added++;
      }
    });
    if (added > 0 || this.parts.size > 0) this.hotspotsReady = true;
  }

  onPointerClick(args: PointerEventData) {
    this.handlePointerClick(args);
  }

  handlePointerClick(args: PointerEventData) {
    if (this.pickingSuspendedForMove || this.moving) return;
    if (!this.enabledPicking) return;
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

  /** Called when a newer PartInspect replaces this instance on another root. */
  retire() {
    this.enabled = false;
    this.enabledPicking = false;
    this.pickingSuspendedForMove = false;
    if (this.moving) this.exitMove();
    else this.clearSelection();
  }

  clearSelection() {
    if (this.moving) return;
    this.selectedUid = null;
    hidePartPanel();
    hideNoteDialog();
  }

  hideSelected() {
    if (this.moving) return;
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (!runtime) return;
    for (const m of runtime.meshes) m.visible = false;
    runtime.root.visible = false;
    setStatus(`Hidden ${runtime.def.title}.`);
    this.clearSelection();
  }

  /** Keep part + ancestor chain visible (parent hidden = child looks gone in AR). */
  private ensurePartVisible(runtime: PartRuntime) {
    runtime.root.visible = true;
    for (const m of runtime.meshes) m.visible = true;
    let cur: Object3D | null = runtime.root.parent;
    while (cur) {
      cur.visible = true;
      cur = cur.parent;
    }
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
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
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
    if (activeInspect && activeInspect !== this) return;
    const runtime = this.selectedUid ? this.parts.get(this.selectedUid) : null;
    if (!runtime) {
      hideNoteDialog();
      setStatus("Select a part before adding a note.", "warn");
      return;
    }
    const cleaned = text.trim();
    if (!cleaned) {
      setStatus("Note is empty — type something, then Save.");
      return;
    }
    this.armUiGuard(800);
    runtime.notes.push(cleaned);
    hideNoteDialog();
    showPartPanel(runtime.def.title, runtime.def.description, [...runtime.notes]);
    this.saveParts(true);
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
    this.saveParts(true);
  }

  private enterMove() {
    if (!this.selectedUid) return;
    const runtime = this.parts.get(this.selectedUid);
    if (!runtime) return;

    this.armUiGuard(900);
    this.moving = true;
    this.dragging = false;
    this.fingerDown = false;
    this.touchDragActive = false;
    this.activePointerId = null;
    this.moveT = 0;
    this.moveT0 = 0;
    this.dragScreen0 = 0;

    this.ensurePartVisible(runtime);
    runtime.root.getWorldPosition(this._axisOrigin);
    this.resolveMoveAxis(this._axis);
    this.moveRoot = runtime.root;
    this.moveParent = runtime.root.parent;
    if (this.moveParent) {
      this.moveParent.updateWorldMatrix(true, false);
      this._invParent.copy(this.moveParent.matrixWorld).invert();
    }
    this.cacheScreenAxis();

    this.pickingBeforeMove = this.enabledPicking;
    this.pickingSuspendedForMove = true;
    this.enabledPicking = false;

    hidePartPanel();
    hideNoteDialog();
    setMoveHud(true);
    setStatus("Hold and drag left/right · tap ✕ when done.");
  }

  private exitMove() {
    if (!this.moving && !this.dragging) {
      setMoveHud(false);
      return;
    }
    this.endDrag();
    const uid = this.selectedUid;
    this.moving = false;
    this.moveRoot = null;
    this.moveParent = null;
    this.pickingSuspendedForMove = false;
    this.enabledPicking = this.pickingBeforeMove;
    setMoveHud(false);
    this.saveParts(true);

    const runtime = uid ? this.parts.get(uid) : null;
    if (runtime) {
      this.ensurePartVisible(runtime);
      showPartPanel(runtime.def.title, runtime.def.description, runtime.notes);
      setStatus("Move finished.");
    } else {
      setStatus("Move finished.");
    }
  }

  private isUiTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el?.closest) return false;
    return !!el.closest(
      "#ar-ui button, #ar-ui .modal, #ar-ui #part-card, #ar-ui textarea, #ar-ui input, #btn-exit-move, #btn-menu"
    );
  }

  /** Horizontal engine-length axis from the placement/content root (not mesh local Z). */
  private resolveMoveAxis(into: Vector3) {
    const basis = this.getPlacementBasis();
    basis.updateWorldMatrix(true, false);
    into.set(0, 0, 1).transformDirection(basis.matrixWorld);
    into.y = 0;
    if (into.lengthSq() < 1e-6) {
      into.set(1, 0, 0).transformDirection(basis.matrixWorld);
      into.y = 0;
    }
    if (into.lengthSq() < 1e-6) into.set(1, 0, 0);
    else into.normalize();
    return into;
  }

  private getPlacementBasis(): Object3D {
    if (this.placementBasis) return this.placementBasis;

    let best: Object3D | null = null;
    let cur: Object3D | null = this.gameObject;
    while (cur) {
      if (cur.name === "ARSessionRoot" || cur.name === "Content") {
        this.placementBasis = cur;
        return cur;
      }
      if (
        !best &&
        (cur.name === "JetEngine" || cur.name === "Scene") &&
        cur !== this.context.scene
      ) {
        best = cur;
      }
      cur = cur.parent;
    }
    if (best) {
      this.placementBasis = best;
      return best;
    }

    let found: Object3D | null = null;
    this.context.scene.traverse((o) => {
      if (o.name === "ARSessionRoot" || o.name === "Content") found = o;
    });
    this.placementBasis = found ?? this.gameObject;
    return this.placementBasis;
  }

  /** Project 1m of axis to screen once per drag — avoids per-move raycasts in AR. */
  private cacheScreenAxis() {
    const cam = this.context.mainCamera;
    if (!cam) {
      this._screenAxis.set(1, 0);
      this.metersPerPx = 0.002;
      return;
    }

    this._screenA.copy(this._axisOrigin).project(cam);
    this._screenB.copy(this._axisOrigin).add(this._axis).project(cam);

    const ax = (this._screenA.x * 0.5 + 0.5) * window.innerWidth;
    const ay = (-this._screenA.y * 0.5 + 0.5) * window.innerHeight;
    const bx = (this._screenB.x * 0.5 + 0.5) * window.innerWidth;
    const by = (-this._screenB.y * 0.5 + 0.5) * window.innerHeight;

    this._screenAxis.set(bx - ax, by - ay);
    const pix = this._screenAxis.length();
    if (pix < 1e-3) {
      this._screenAxis.set(1, 0);
      this.metersPerPx = 0.002;
    } else {
      this._screenAxis.multiplyScalar(1 / pix);
      this.metersPerPx = 1 / pix;
    }
  }

  private screenToAxisDelta(clientX: number, clientY: number): number {
    return clientX * this._screenAxis.x + clientY * this._screenAxis.y;
  }

  handleMovePointerDown(e: PointerEvent) {
    if (!this.moving || !this.selectedUid) return;
    if (this.isUiTarget(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Touch is handled by touch listeners — avoid double-start on mobile
    if (this.touchDragActive && e.pointerType === "touch") return;

    const runtime = this.parts.get(this.selectedUid);
    if (!runtime) return;

    this.beginDrag(e.clientX, e.clientY);
    this.activePointerId = e.pointerId;
    try {
      (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  }

  handleMovePointerMove(e: PointerEvent) {
    if (!this.moving || !this.fingerDown) return;
    if (this.activePointerId != null && e.pointerId !== this.activePointerId) return;
    this.continueDrag(e.clientX, e.clientY);
    e.preventDefault();
  }

  /** Touch fallback for immersive AR where pointermove is sparse. */
  handleMoveTouch(clientX: number, clientY: number, isStart: boolean, e: TouchEvent) {
    if (!this.moving || !this.selectedUid) return;
    if (this.isUiTarget(e.target)) return;

    if (isStart) {
      const runtime = this.parts.get(this.selectedUid);
      if (!runtime) return;
      this.touchDragActive = true;
      this.beginDrag(clientX, clientY);
      this.activePointerId = null;
    } else if (this.fingerDown) {
      this.continueDrag(clientX, clientY);
    }
    e.preventDefault();
  }

  handleMovePointerUp(e?: Event) {
    if (e instanceof PointerEvent && this.activePointerId != null && e.pointerId !== this.activePointerId) {
      return;
    }
    this.touchDragActive = false;
    this.endDrag();
  }

  private beginDrag(clientX: number, clientY: number) {
    if (!this.selectedUid) return;
    const runtime = this.parts.get(this.selectedUid);
    if (!runtime) return;

    this.ensurePartVisible(runtime);
    this.cacheScreenAxis();
    this.dragScreen0 = this.screenToAxisDelta(clientX, clientY);
    this.moveT0 = this.moveT;
    this.fingerDown = true;
    this.dragging = true;
    this.continueDrag(clientX, clientY);
  }

  private continueDrag(clientX: number, clientY: number) {
    this.dragX = clientX;
    this.dragY = clientY;
    this.pendingX = clientX;
    this.pendingY = clientY;
    if (this.moving && this.fingerDown && this.dragging) {
      this.applyDragAt(clientX, clientY);
    }
  }

  private endDrag() {
    if (this.dragging) {
      this.applyDragAt(this.dragX, this.dragY);
    }
    this.fingerDown = false;
    this.dragging = false;
    this.activePointerId = null;
  }

  private applyDragAt(clientX: number, clientY: number) {
    if (!this.moving || !this.moveRoot) return;

    const screen = this.screenToAxisDelta(clientX, clientY);
    this.moveT = this.moveT0 + (screen - this.dragScreen0) * this.metersPerPx;

    this._world
      .copy(this._axis)
      .multiplyScalar(this.moveT)
      .add(this._axisOrigin);

    if (this.moveParent) {
      this._local.copy(this._world).applyMatrix4(this._invParent);
      this.moveRoot.position.copy(this._local);
    } else {
      this.moveRoot.position.copy(this._world);
    }

    this.moveRoot.visible = true;
  }

  saveParts(quiet = false) {
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
      if (!quiet) setStatus("Parts saved.");
    } catch {
      if (!quiet) setStatus("Save failed.", "error");
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
    if (activeInspect && activeInspect.gameObject !== root) {
      activeInspect.retire();
      activeInspect = null;
    }
    inspect = GameObject.addComponent(root, PartInspect);
  }
  inspect.captureStartVisibility();
  activeInspect = inspect;
  return inspect;
}
