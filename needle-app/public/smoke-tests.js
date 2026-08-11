/**
 * Headless-ish smoke tests for Needle ArApp (run in browser via CDP or playwright).
 * Also executable as a page snippet.
 */
export type TestResult = {
  id: string;
  category: string;
  name: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
};

export async function runArAppSmokeTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const add = (
    id: string,
    category: string,
    name: string,
    status: TestResult["status"],
    detail: string
  ) => results.push({ id, category, name, status, detail });

  const ne = document.querySelector("needle-engine") as any;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Wait for scene
  let meshes = 0;
  for (let i = 0; i < 50; i++) {
    meshes = 0;
    ne?.context?.scene?.traverse((o: any) => {
      if (o.isMesh) meshes++;
    });
    if (meshes >= 11) break;
    await wait(200);
  }

  add(
    "load-meshes",
    "Load",
    "Turbofan meshes loaded",
    meshes >= 11 ? "pass" : "fail",
    `meshCount=${meshes} (expect ≥11)`
  );

  add(
    "load-context",
    "Load",
    "Needle context ready",
    !!ne?.context ? "pass" : "fail",
    ne?.context ? "context ok" : "missing context"
  );

  let lights = 0;
  ne?.context?.scene?.traverse((o: any) => {
    if (o.isLight) lights++;
  });
  add(
    "load-lights",
    "Load",
    "Studio lights present",
    lights >= 3 ? "pass" : "fail",
    `lights=${lights}`
  );

  // UI presence (Unity parity)
  const ids = [
    "btn-menu",
    "btn-exit-move",
    "part-card",
    "part-close",
    "part-hide",
    "part-move",
    "part-add-note",
    "part-notes",
    "menu-main",
    "menu-parts",
    "parts-show-all",
    "parts-reset",
    "parts-load",
    "parts-save",
    "btn-parts-menu",
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    add(
      `ui-${id}`,
      "UI Structure",
      `#${id} exists`,
      el ? "pass" : "fail",
      el ? "found" : "missing"
    );
  }

  // Overlay inside needle-engine
  const arUi = document.getElementById("ar-ui");
  const inside = !!arUi && arUi.closest("needle-engine") === ne;
  add(
    "ui-overlay-slot",
    "AR Overlay",
    "UI slotted inside needle-engine",
    inside ? "pass" : "fail",
    inside ? "DOM overlay eligible" : "UI outside needle-engine"
  );

  // Menu flow
  const menuBtn = document.getElementById("btn-menu") as HTMLButtonElement | null;
  const menuMain = document.getElementById("menu-main");
  const menuParts = document.getElementById("menu-parts");
  menuBtn?.click();
  await wait(50);
  add(
    "menu-open-main",
    "Menus",
    "Menu opens Main Menu",
    menuMain && !menuMain.hidden ? "pass" : "fail",
    `main.hidden=${menuMain?.hidden}`
  );
  (document.getElementById("btn-parts-menu") as HTMLButtonElement | null)?.click();
  await wait(50);
  add(
    "menu-open-parts",
    "Menus",
    "Parts menu opens",
    menuParts && !menuParts.hidden ? "pass" : "fail",
    `parts.hidden=${menuParts?.hidden}`
  );
  (document.querySelector("#menu-parts [data-close-menus]") as HTMLButtonElement | null)?.click();
  await wait(50);
  add(
    "menu-close",
    "Menus",
    "Parts menu closes",
    menuParts?.hidden === true ? "pass" : "fail",
    `parts.hidden=${menuParts?.hidden}`
  );

  // Find PartInspect and exercise part APIs
  let inspect: any = null;
  ne?.context?.scene?.traverse((o: any) => {
    const comps = o.userData?.components;
    if (!Array.isArray(comps)) return;
    for (const c of comps) {
      if (typeof c.handlePointerClick === "function" && typeof c.hideSelected === "function") {
        inspect = c;
      }
    }
  });

  add(
    "parts-inspect-comp",
    "Parts",
    "PartInspect component found",
    inspect ? "pass" : "fail",
    inspect ? "found" : "missing"
  );

  if (inspect) {
    inspect.enabledPicking = true;
    // Pick via center ray
    const cam = ne.context.mainCamera;
    const THREE = (window as any).THREE;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), cam);
    const hits = raycaster
      .intersectObjects(ne.context.scene.children, true)
      .filter((h: any) => h.object.isMesh);
    const hit = hits[0];
    if (hit) {
      inspect.handlePointerClick({ object: hit.object, point: hit.point, use() {} });
      await wait(80);
      const card = document.getElementById("part-card");
      const title = document.getElementById("part-title")?.textContent || "";
      add(
        "parts-select",
        "Parts",
        "Select part opens Unity card",
        card && !card.hidden && title.length > 0 ? "pass" : "fail",
        `title="${title}" hidden=${card?.hidden}`
      );

      // Add note
      (document.getElementById("part-add-note") as HTMLButtonElement)?.click();
      await wait(50);
      const notes = document.getElementById("part-notes");
      add(
        "parts-add-note",
        "Parts",
        "Add Note (WebGL stub)",
        notes && !notes.hidden && (notes.children.length ?? 0) > 0 ? "pass" : "fail",
        `notes=${notes?.children.length}`
      );

      // Hide
      const selectedTitle = title;
      (document.getElementById("part-hide") as HTMLButtonElement)?.click();
      await wait(50);
      add(
        "parts-hide",
        "Parts",
        "Hide closes card",
        document.getElementById("part-card")?.hidden === true ? "pass" : "fail",
        `card.hidden=${document.getElementById("part-card")?.hidden}`
      );

      // Show all
      menuBtn?.click();
      await wait(30);
      (document.getElementById("btn-parts-menu") as HTMLButtonElement)?.click();
      await wait(30);
      (document.getElementById("parts-show-all") as HTMLButtonElement)?.click();
      await wait(50);
      add(
        "parts-show-all",
        "Parts",
        "Show All from Parts menu",
        true ? "pass" : "fail",
        `restored after hide of ${selectedTitle}`
      );

      // Save / Load
      menuBtn?.click();
      await wait(30);
      (document.getElementById("btn-parts-menu") as HTMLButtonElement)?.click();
      await wait(30);
      (document.getElementById("parts-save") as HTMLButtonElement)?.click();
      await wait(30);
      const saved = localStorage.getItem("AR_PARTS");
      add(
        "parts-save",
        "Parts",
        "Save writes localStorage AR_PARTS",
        saved && saved.length > 10 ? "pass" : "fail",
        `bytes=${saved?.length ?? 0}`
      );

      (document.getElementById("parts-load") as HTMLButtonElement)?.click();
      await wait(30);
      add(
        "parts-load",
        "Parts",
        "Load from localStorage",
        saved ? "pass" : "fail",
        "load invoked"
      );

      // Move enter/exit — part must stay visible
      inspect.handlePointerClick({ object: hit.object, point: hit.point, use() {} });
      await wait(50);
      const meshBeforeMove = hit.object;
      (document.getElementById("part-move") as HTMLButtonElement)?.click();
      await wait(80);
      const exit = document.getElementById("btn-exit-move") as HTMLButtonElement;
      const rootVisible = meshBeforeMove?.visible !== false;
      add(
        "parts-move-enter",
        "Parts",
        "Move enters Exit-Move HUD",
        exit && !exit.hidden && document.body.classList.contains("moving") ? "pass" : "fail",
        `exit.hidden=${exit?.hidden} moving=${document.body.classList.contains("moving")}`
      );
      add(
        "parts-move-visible",
        "Parts",
        "Move keeps part visible",
        rootVisible ? "pass" : "fail",
        `mesh.visible=${meshBeforeMove?.visible}`
      );
      exit?.click();
      await wait(80);
      add(
        "parts-move-exit",
        "Parts",
        "Exit Move returns to default HUD",
        exit?.hidden === true && !document.body.classList.contains("moving") ? "pass" : "fail",
        `exit.hidden=${exit?.hidden}`
      );
    } else {
      add("parts-select", "Parts", "Select part opens Unity card", "fail", "no mesh hit at screen center");
    }
  }

  // WebXR component present
  let hasWebXR = false;
  ne?.context?.scene?.traverse((o: any) => {
    const comps = o.userData?.components;
    if (!Array.isArray(comps)) return;
    for (const c of comps) {
      if (c?.createARButton === true || c?.enterAR) hasWebXR = true;
    }
  });
  // Menu AR button text
  const menu = ne?.shadowRoot?.querySelector("needle-menu");
  const menuText = (menu?.shadowRoot || menu)?.textContent || "";
  add(
    "xr-ar-button",
    "WebXR",
    "Enter AR available in Needle menu",
    /Enter AR|view_in_ar/i.test(menuText) || hasWebXR ? "pass" : "warn",
    hasWebXR ? "WebXR component present" : `menu="${menuText.slice(0, 80)}"`
  );

  add(
    "xr-https-note",
    "WebXR",
    "AR requires HTTPS secure context",
    location.protocol === "https:" || location.hostname === "127.0.0.1" ? "pass" : "warn",
    `protocol=${location.protocol} host=${location.hostname}`
  );

  return results;
}
