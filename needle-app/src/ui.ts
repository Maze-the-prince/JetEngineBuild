export type StatusKind = "" | "ok" | "error" | "warn";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

export const ui = {
  statusEl: () => $("status"),
  hudEl: () => $("hud"),
  heroEl: () => $("hero"),
  partPanel: () => $<HTMLElement>("part-panel"),
  partTitle: () => $("part-title"),
  partDesc: () => $("part-desc"),
  btnClose: () => $<HTMLButtonElement>("part-close"),
  btnHide: () => $<HTMLButtonElement>("part-hide"),
  btnShowAll: () => $<HTMLButtonElement>("parts-show-all"),
  btnReset: () => $<HTMLButtonElement>("parts-reset"),
};

export function setStatus(message: string, kind: StatusKind = "") {
  const status = ui.statusEl();
  const hud = ui.hudEl();
  if (status) {
    status.textContent = message;
    status.className = `status${kind ? ` ${kind}` : ""}`;
  }
  if (hud) hud.textContent = message;
  console.log(`[ArApp] ${message}`);
}

export function setArSessionActive(active: boolean) {
  document.body.classList.toggle("ar-session-active", active);
  document.body.classList.toggle("ar-active", active);
}

export function showPartPanel(title: string, description: string) {
  const panel = ui.partPanel();
  const t = ui.partTitle();
  const d = ui.partDesc();
  if (t) t.textContent = title;
  if (d) d.textContent = description;
  if (panel) panel.hidden = false;
}

export function hidePartPanel() {
  const panel = ui.partPanel();
  if (panel) panel.hidden = true;
}

export function bindPartActions(handlers: {
  onClose: () => void;
  onHide: () => void;
  onShowAll: () => void;
  onReset: () => void;
}) {
  ui.btnClose()?.addEventListener("click", (e) => {
    e.preventDefault();
    handlers.onClose();
  });
  ui.btnHide()?.addEventListener("click", (e) => {
    e.preventDefault();
    handlers.onHide();
  });
  ui.btnShowAll()?.addEventListener("click", (e) => {
    e.preventDefault();
    handlers.onShowAll();
  });
  ui.btnReset()?.addEventListener("click", (e) => {
    e.preventDefault();
    handlers.onReset();
  });
}
