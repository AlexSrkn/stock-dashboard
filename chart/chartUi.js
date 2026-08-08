/**
 * Chart toolbar UI — wires DOM controls to ChartExtensions (no chart logic here).
 */

let chartDrawOpen = false;
let chartCompareOpen = false;
let chartIndicatorsOpen = false;
/** @type {(() => void) | null} */
let onDrawMenuToggle = null;
/** @type {(() => void) | null} */
let onCompareMenuToggle = null;
/** @type {(() => void) | null} */
let onIndicatorsMenuToggle = null;

export function setChartDrawMenuHooks(hooks = {}) {
  onDrawMenuToggle = hooks.onToggle || null;
}

export function setChartCompareMenuHooks(hooks = {}) {
  onCompareMenuToggle = hooks.onToggle || null;
}

export function setChartIndicatorsMenuHooks(hooks = {}) {
  onIndicatorsMenuToggle = hooks.onToggle || null;
}

function closeOtherToolbarMenus(except = null) {
  if (except !== "draw") setChartDrawOpen(false);
  if (except !== "compare") setChartCompareOpen(false);
  if (except !== "indicators") setChartIndicatorsOpen(false);
  if (except !== "settings") {
    const settingsMenu = document.getElementById("chart-settings-menu");
    const settingsBtn = document.getElementById("chart-settings-btn");
    if (settingsMenu) settingsMenu.hidden = true;
    if (settingsBtn) settingsBtn.setAttribute("aria-expanded", "false");
  }
}

function setChartDrawOpen(open) {
  if (open) closeOtherToolbarMenus("draw");
  chartDrawOpen = open;
  const menu = document.getElementById("chart-draw-menu");
  const btn = document.getElementById("chart-draw-btn");
  if (menu) menu.hidden = !open;
  if (btn) {
    btn.setAttribute("aria-expanded", String(open));
    const toolActive = document.querySelector(".chart-drawing-btn.is-active");
    btn.classList.toggle("is-active", open || !!toolActive);
  }
  onDrawMenuToggle?.(open);
}

function setChartCompareOpen(open) {
  if (open) closeOtherToolbarMenus("compare");
  chartCompareOpen = open;
  const menu = document.getElementById("chart-compare-menu");
  const btn = document.getElementById("chart-compare-btn");
  if (menu) menu.hidden = !open;
  if (btn) {
    btn.setAttribute("aria-expanded", String(open));
    btn.classList.toggle("is-active", open);
  }
  onCompareMenuToggle?.(open);
}

function setChartIndicatorsOpen(open) {
  if (open) closeOtherToolbarMenus("indicators");
  chartIndicatorsOpen = open;
  const menu = document.getElementById("chart-indicators-menu");
  const btn = document.getElementById("chart-indicators-btn");
  if (menu) menu.hidden = !open;
  if (btn) {
    btn.setAttribute("aria-expanded", String(open));
    btn.classList.toggle("is-active", open);
  }
  onIndicatorsMenuToggle?.(open);
}

/**
 * @param {import('./chart.js').ChartExtensions} extensions
 */
export function setupChartToolbar(extensions) {
  const compareMenuBtn = document.getElementById("chart-compare-btn");
  const compareAddBtn = document.getElementById("chart-compare-add-btn");
  const percentInput = document.getElementById("chart-percent-mode");
  const insiderInput = document.getElementById("chart-show-insider");
  const legendEl = document.getElementById("chart-compare-legend");
  const drawRoot = document.getElementById("chart-draw");
  const drawBtn = document.getElementById("chart-draw-btn");
  const compareRoot = document.getElementById("chart-compare");
  const indicatorsRoot = document.getElementById("chart-indicators");
  const indicatorsBtn = document.getElementById("chart-indicators-btn");

  compareMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setChartCompareOpen(!chartCompareOpen);
  });

  compareAddBtn?.addEventListener("click", async () => {
    const raw = window.prompt("Symbol to compare (e.g. MSFT):");
    if (!raw) return;
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    const ok = await extensions.addCompareSymbol(sym);
    if (!ok) {
      window.alert(`Could not load chart data for ${sym}.`);
    }
  });

  percentInput?.addEventListener("change", () => {
    extensions.setPercentMode(percentInput.checked);
  });

  insiderInput?.addEventListener("change", () => {
    extensions.setShowInsider(insiderInput.checked);
  });

  indicatorsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setChartIndicatorsOpen(!chartIndicatorsOpen);
  });

  drawBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setChartDrawOpen(!chartDrawOpen);
  });

  document.querySelectorAll(".chart-drawing-btn[data-drawing-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.drawingMode || null;
      const active = btn.classList.contains("is-active");
      document.querySelectorAll(".chart-drawing-btn").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-pressed", "false");
      });
      if (active) {
        extensions.setDrawingMode(null);
        drawBtn?.classList.remove("is-active");
      } else {
        btn.classList.add("is-active");
        btn.setAttribute("aria-pressed", "true");
        extensions.setDrawingMode(mode);
        drawBtn?.classList.add("is-active");
      }
      setChartDrawOpen(false);
    });
  });

  document.addEventListener("click", (e) => {
    if (chartDrawOpen && drawRoot && !drawRoot.contains(e.target)) {
      setChartDrawOpen(false);
    }
    if (chartCompareOpen && compareRoot && !compareRoot.contains(e.target)) {
      setChartCompareOpen(false);
    }
    if (chartIndicatorsOpen && indicatorsRoot && !indicatorsRoot.contains(e.target)) {
      setChartIndicatorsOpen(false);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (chartDrawOpen) setChartDrawOpen(false);
      if (chartCompareOpen) setChartCompareOpen(false);
      if (chartIndicatorsOpen) setChartIndicatorsOpen(false);
    }
  });

  legendEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-symbol]");
    if (!btn) return;
    extensions.removeCompareSymbol(btn.dataset.removeSymbol || "");
  });
}

export function closeChartDrawMenu() {
  setChartDrawOpen(false);
}

export function closeChartCompareMenu() {
  setChartCompareOpen(false);
}

export function closeChartIndicatorsMenu() {
  setChartIndicatorsOpen(false);
}
