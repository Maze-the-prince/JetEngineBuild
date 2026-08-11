export type StatusKind = "" | "ok" | "error" | "warn";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** Survives focus/blur quirks in WebXR DOM overlay while typing. */
let noteDraft = "";

export const ui = {
  partCard: () => $<HTMLElement>("part-card"),
  partTitle: () => $("part-title"),
  partDesc: () => $("part-desc"),
  partNotes: () => $<HTMLElement>("part-notes"),
  btnClose: () => $<HTMLButtonElement>("part-close"),
  btnHide: () => $<HTMLButtonElement>("part-hide"),
  btnMove: () => $<HTMLButtonElement>("part-move"),
  btnAddNote: () => $<HTMLButtonElement>("part-add-note"),
  btnMenu: () => $<HTMLButtonElement>("btn-menu"),
  btnExitMove: () => $<HTMLButtonElement>("btn-exit-move"),
  btnPartsMenu: () => $<HTMLButtonElement>("btn-parts-menu"),
  btnShowAll: () => $<HTMLButtonElement>("parts-show-all"),
  btnReset: () => $<HTMLButtonElement>("parts-reset"),
  btnLoad: () => $<HTMLButtonElement>("parts-load"),
  btnSave: () => $<HTMLButtonElement>("parts-save"),
  menuMain: () => $<HTMLElement>("menu-main"),
  menuParts: () => $<HTMLElement>("menu-parts"),
  noteDialog: () => $<HTMLElement>("note-dialog"),
  noteInput: () => $<HTMLTextAreaElement>("note-input"),
  noteCancel: () => $<HTMLButtonElement>("note-cancel"),
  noteSave: () => $<HTMLButtonElement>("note-save"),
  statusEl: () => $("status"),
};

export function setStatus(message: string, _kind: StatusKind = "") {
  const status = ui.statusEl();
  if (status) status.textContent = message;
  console.log(`[ArApp] ${message}`);
}

export function setArSessionActive(active: boolean) {
  document.body.classList.toggle("ar-session-active", active);
  document.body.classList.toggle("ar-active", active);
  if (!active) {
    document.body.classList.remove("finding-ground", "placed", "moving");
    setMoveHud(false);
    hideAllMenus();
    hideNoteDialog();
    hidePartPanel();
  }
}

export function setPlacementPhase(phase: "idle" | "finding" | "placed") {
  document.body.classList.toggle("finding-ground", phase === "finding");
  document.body.classList.toggle("placed", phase === "placed");
}

export function setMoveHud(moving: boolean) {
  document.body.classList.toggle("moving", moving);
  const menu = ui.btnMenu();
  const exit = ui.btnExitMove();
  if (menu) menu.hidden = moving;
  if (exit) exit.hidden = !moving;
}

export function isUiBlocking(): boolean {
  const main = ui.menuMain();
  const parts = ui.menuParts();
  const card = ui.partCard();
  const note = ui.noteDialog();
  return (
    (!!main && !main.hidden) ||
    (!!parts && !parts.hidden) ||
    (!!card && !card.hidden) ||
    (!!note && !note.hidden) ||
    document.body.classList.contains("moving")
  );
}

export function showPartPanel(
  title: string,
  description: string,
  notes: string[] = [],
  screenX?: number,
  screenY?: number
) {
  const panel = ui.partCard();
  const t = ui.partTitle();
  const d = ui.partDesc();
  if (t) t.textContent = title;
  if (d) d.textContent = description;
  renderNotes(notes);
  if (panel) {
    panel.hidden = false;
    if (screenX != null && screenY != null) positionPartCard(screenX, screenY);
  }
}

export function positionPartCard(screenX: number, screenY: number) {
  const panel = ui.partCard();
  if (!panel || panel.hidden) return;
  const w = panel.offsetWidth || 280;
  const h = panel.offsetHeight || 260;
  const pad = 12;
  const x = Math.min(Math.max(screenX, pad + w / 2), window.innerWidth - pad - w / 2);
  const y = Math.min(Math.max(screenY, pad + h), window.innerHeight - pad);
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
}

export function hidePartPanel() {
  const panel = ui.partCard();
  if (panel) panel.hidden = true;
}

export function renderNotes(notes: string[]) {
  const box = ui.partNotes();
  if (!box) return;
  box.replaceChildren();
  if (!notes.length) {
    box.hidden = true;
    box.setAttribute("hidden", "");
    return;
  }
  box.hidden = false;
  box.removeAttribute("hidden");
  for (let index = 0; index < notes.length; index++) {
    const text = notes[index];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "note-item";
    btn.textContent = text;
    btn.title = "Tap to delete";
    btn.dataset.noteIndex = String(index);
    box.appendChild(btn);
  }
}

export function showMainMenu() {
  hidePartPanel();
  hideNoteDialog();
  const main = ui.menuMain();
  const parts = ui.menuParts();
  if (parts) parts.hidden = true;
  if (main) main.hidden = false;
}

export function showPartsMenu() {
  const main = ui.menuMain();
  const parts = ui.menuParts();
  if (main) main.hidden = true;
  if (parts) parts.hidden = false;
}

export function hideAllMenus() {
  const main = ui.menuMain();
  const parts = ui.menuParts();
  if (main) main.hidden = true;
  if (parts) parts.hidden = true;
}

export function showNoteDialog(initial = "") {
  noteDraft = initial;
  const dialog = ui.noteDialog();
  const input = ui.noteInput();
  if (input) {
    input.value = initial;
  }
  if (dialog) dialog.hidden = false;
  // Focus after paint so mobile keyboard can open
  requestAnimationFrame(() => {
    const again = ui.noteInput();
    again?.focus({ preventScroll: true });
    again?.setSelectionRange(again.value.length, again.value.length);
  });
}

export function hideNoteDialog() {
  const dialog = ui.noteDialog();
  const input = ui.noteInput();
  if (dialog) dialog.hidden = true;
  if (input) input.value = "";
  noteDraft = "";
}

export function readNoteDialogValue(): string {
  const live = (ui.noteInput()?.value || "").trim();
  const draft = noteDraft.trim();
  return live || draft;
}

export type UiHandlers = {
  onClose: () => void;
  onHide: () => void;
  onMove: () => void;
  onAddNote: () => void;
  onNoteSave: (text: string) => void;
  onNoteCancel: () => void;
  onDeleteNote: (index: number) => void;
  onExitMove: () => void;
  onShowAll: () => void;
  onReset: () => void;
  onSave: () => void;
  onLoad: () => void;
};

export function bindUnityUi(handlers: UiHandlers) {
  const click = (el: HTMLElement | null, fn: () => void) => {
    el?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  };

  /** Prefer pointerup in AR overlays; ignore the trailing click. */
  const press = (el: HTMLElement | null, fn: () => void) => {
    if (!el) return;
    let armed = false;
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      armed = true;
    });
    el.addEventListener("pointerup", (e) => {
      if (!armed) return;
      armed = false;
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  };

  click(ui.btnMenu(), () => showMainMenu());
  click(ui.btnPartsMenu(), () => showPartsMenu());
  document.querySelectorAll("[data-close-menus]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideAllMenus();
    });
  });

  click(ui.btnClose(), handlers.onClose);
  click(ui.btnHide(), handlers.onHide);
  click(ui.btnMove(), handlers.onMove);
  click(ui.btnAddNote(), handlers.onAddNote);
  press(ui.noteCancel(), handlers.onNoteCancel);
  press(ui.noteSave(), () => {
    handlers.onNoteSave(readNoteDialogValue());
  });
  click(ui.btnExitMove(), handlers.onExitMove);
  click(ui.btnShowAll(), () => {
    hideAllMenus();
    handlers.onShowAll();
  });
  click(ui.btnReset(), () => {
    hideAllMenus();
    handlers.onReset();
  });
  click(ui.btnSave(), () => {
    hideAllMenus();
    handlers.onSave();
  });
  click(ui.btnLoad(), () => {
    hideAllMenus();
    handlers.onLoad();
  });

  const input = ui.noteInput();
  input?.addEventListener("input", () => {
    noteDraft = input.value;
  });
  input?.addEventListener("change", () => {
    noteDraft = input.value;
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      handlers.onNoteCancel();
    }
  });

  ui.partNotes()?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t?.classList.contains("note-item")) return;
    e.preventDefault();
    e.stopPropagation();
    const index = Number(t.dataset.noteIndex);
    if (!Number.isNaN(index)) handlers.onDeleteNote(index);
  });
}
