export type StatusKind = "" | "ok" | "error" | "warn";

/** Resolve overlay nodes even if Needle reparents under shadow/slot trees. */
function $(id: string): HTMLElement | null {
  const direct = document.getElementById(id);
  if (direct) return direct;
  const ne = document.querySelector("needle-engine") as HTMLElement | null;
  if (!ne) return null;
  const nested = ne.querySelector(`#${CSS.escape(id)}`);
  if (nested) return nested as HTMLElement;
  const sr = ne.shadowRoot;
  if (sr) {
    const inShadow = sr.querySelector(`#${CSS.escape(id)}`);
    if (inShadow) return inShadow as HTMLElement;
  }
  return null;
}

/** Survives focus/blur quirks in WebXR DOM overlay while typing. */
let noteDraft = "";
let uiBound = false;

export const ui = {
  partCard: () => $("part-card"),
  partTitle: () => $("part-title"),
  partDesc: () => $("part-desc"),
  partNotes: () => $("part-notes"),
  btnClose: () => $("part-close") as HTMLButtonElement | null,
  btnHide: () => $("part-hide") as HTMLButtonElement | null,
  btnMove: () => $("part-move") as HTMLButtonElement | null,
  btnAddNote: () => $("part-add-note") as HTMLButtonElement | null,
  btnMenu: () => $("btn-menu") as HTMLButtonElement | null,
  btnExitMove: () => $("btn-exit-move") as HTMLButtonElement | null,
  btnPartsMenu: () => $("btn-parts-menu") as HTMLButtonElement | null,
  btnShowAll: () => $("parts-show-all") as HTMLButtonElement | null,
  btnReset: () => $("parts-reset") as HTMLButtonElement | null,
  btnLoad: () => $("parts-load") as HTMLButtonElement | null,
  btnSave: () => $("parts-save") as HTMLButtonElement | null,
  menuMain: () => $("menu-main"),
  menuParts: () => $("menu-parts"),
  noteDialog: () => $("note-dialog"),
  noteInput: () => $("note-input") as HTMLTextAreaElement | null,
  noteCancel: () => $("note-cancel") as HTMLButtonElement | null,
  noteSave: () => $("note-save") as HTMLButtonElement | null,
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
    panel.removeAttribute("hidden");
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
  if (panel) {
    panel.hidden = true;
    panel.setAttribute("hidden", "");
  }
}

export function renderNotes(notes: string[]) {
  const box = ui.partNotes();
  if (!box) {
    console.warn("[ArApp] #part-notes missing — cannot render notes");
    return;
  }
  while (box.firstChild) box.removeChild(box.firstChild);
  if (!notes.length) {
    box.hidden = true;
    box.setAttribute("hidden", "");
    return;
  }
  box.hidden = false;
  box.removeAttribute("hidden");
  for (let index = 0; index < notes.length; index++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "note-item";
    btn.textContent = notes[index];
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
  if (parts) {
    parts.hidden = true;
    parts.setAttribute("hidden", "");
  }
  if (main) {
    main.hidden = false;
    main.removeAttribute("hidden");
  }
}

export function showPartsMenu() {
  const main = ui.menuMain();
  const parts = ui.menuParts();
  if (main) {
    main.hidden = true;
    main.setAttribute("hidden", "");
  }
  if (parts) {
    parts.hidden = false;
    parts.removeAttribute("hidden");
  }
}

export function hideAllMenus() {
  const main = ui.menuMain();
  const parts = ui.menuParts();
  if (main) {
    main.hidden = true;
    main.setAttribute("hidden", "");
  }
  if (parts) {
    parts.hidden = true;
    parts.setAttribute("hidden", "");
  }
}

export function showNoteDialog(initial = "") {
  noteDraft = initial;
  const dialog = ui.noteDialog();
  const input = ui.noteInput();
  if (input) input.value = initial;
  if (dialog) {
    dialog.hidden = false;
    dialog.removeAttribute("hidden");
  }
  requestAnimationFrame(() => {
    const again = ui.noteInput();
    again?.focus({ preventScroll: true });
    again?.setSelectionRange(again.value.length, again.value.length);
  });
}

export function hideNoteDialog() {
  const dialog = ui.noteDialog();
  const input = ui.noteInput();
  if (dialog) {
    dialog.hidden = true;
    dialog.setAttribute("hidden", "");
  }
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

/** Live handler target — swapped when PartInspect moves to the loaded model root. */
let activeHandlers: UiHandlers | null = null;

export function setUnityUiHandlers(handlers: UiHandlers) {
  activeHandlers = handlers;
}

export function bindUnityUi(handlers: UiHandlers) {
  setUnityUiHandlers(handlers);
  if (uiBound) return;
  uiBound = true;

  const h = () => activeHandlers;

  const click = (el: HTMLElement | null, fn: () => void) => {
    el?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  };

  /** Capture note text on pointerdown before AR keyboard blur clears the field. */
  const press = (el: HTMLElement | null, fn: (prefetched?: string) => void) => {
    if (!el) return;
    let armed = false;
    let prefetched = "";
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      armed = true;
      prefetched = readNoteDialogValue();
    });
    el.addEventListener("pointerup", (e) => {
      if (!armed) return;
      armed = false;
      e.preventDefault();
      e.stopPropagation();
      fn(prefetched);
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

  click(ui.btnClose(), () => h()?.onClose());
  click(ui.btnHide(), () => h()?.onHide());
  click(ui.btnMove(), () => h()?.onMove());
  click(ui.btnAddNote(), () => h()?.onAddNote());
  press(ui.noteCancel(), () => h()?.onNoteCancel());
  press(ui.noteSave(), (prefetched) => {
    const text = (prefetched || readNoteDialogValue()).trim();
    h()?.onNoteSave(text);
  });
  click(ui.btnExitMove(), () => h()?.onExitMove());
  click(ui.btnShowAll(), () => {
    hideAllMenus();
    h()?.onShowAll();
  });
  click(ui.btnReset(), () => {
    hideAllMenus();
    h()?.onReset();
  });
  click(ui.btnSave(), () => {
    hideAllMenus();
    h()?.onSave();
  });
  click(ui.btnLoad(), () => {
    hideAllMenus();
    h()?.onLoad();
  });

  const input = ui.noteInput();
  input?.addEventListener("input", () => {
    noteDraft = input.value;
  });
  input?.addEventListener("change", () => {
    noteDraft = input.value;
  });
  input?.addEventListener("keyup", () => {
    noteDraft = input.value;
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") h()?.onNoteCancel();
  });

  ui.partNotes()?.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t?.classList.contains("note-item")) return;
    e.preventDefault();
    e.stopPropagation();
    const index = Number(t.dataset.noteIndex);
    if (!Number.isNaN(index)) h()?.onDeleteNote(index);
  });
}
