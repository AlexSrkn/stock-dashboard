/**
 * Institutions → 13F Portfolio Performance Proxy UI.
 * Ranks institutions by changes in reported 13F portfolio value (not investment returns).
 */

import { buildSparklineSvg } from "./sparkline.js";
import {
  formatProxyHoldings as formatHoldings,
  formatProxyPct as formatPct,
  formatProxyUsd as formatUsd,
} from "./src/institution/portfolioPerformanceProxy/formatDisplay.js";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function pctClass(n) {
  if (!finite(n)) return "";
  if (n > 0) return "change--up";
  if (n < 0) return "change--down";
  return "";
}

/**
 * @param {{
 *   apiJson: (path: string, params?: Record<string, string>) => Promise<any>,
 *   onOpenInstitution?: (cik: string) => void,
 * }} deps
 */
export function createInstitutionPerformanceProxyController(deps) {
  const { apiJson, onOpenInstitution } = deps;

  let bound = false;
  let payload = null;
  let expanded = new Set();
  /** @type {number} */
  let requestId = 0;
  let loading = false;

  function setLoading(on, message = "Loading performance rankings…") {
    loading = on;
    const el = document.getElementById("institution-proxy-performance-loading");
    if (!el) return;
    el.hidden = !on;
    el.textContent = message;
  }

  function setStatus(msg, isError = false) {
    const el = document.getElementById("institution-proxy-performance-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.style.color = isError ? "#f87171" : "";
  }

  function readFilters() {
    return {
      quarter: document.getElementById("proxy-perf-quarter")?.value || "",
      minPortfolioValue: document.getElementById("proxy-perf-min-value")?.value || "",
      minHoldings: document.getElementById("proxy-perf-min-holdings")?.value || "",
      minGrowth1y: document.getElementById("proxy-perf-min-1y")?.value || "",
      minGrowth3y: document.getElementById("proxy-perf-min-3y")?.value || "",
      name: document.getElementById("proxy-perf-name")?.value || "",
      sort: document.getElementById("proxy-perf-sort")?.value || "growth_1y",
      sortDir: document.getElementById("proxy-perf-sort-dir")?.value || "desc",
      pageSize: "50",
      page: "1",
    };
  }

  function populateQuarters(quarters, selected) {
    const sel = document.getElementById("proxy-perf-quarter");
    if (!sel) return;
    const current = selected || sel.value;
    const options = [`<option value="">Latest available</option>`].concat(
      [...(quarters || [])].reverse().map(
        (q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`
      )
    );
    sel.innerHTML = options.join("");
    if (current && (quarters || []).includes(current)) sel.value = current;
    else if (selected) sel.value = selected;
  }

  function historyTable(history) {
    const rows = [...(history || [])]
      .filter((h) => finite(h.qoqChangePct) && finite(h.portfolioValueUsd))
      .reverse();
    if (!rows.length) {
      return `<p class="muted small">No portfolio value history available.</p>`;
    }
    const body = rows
      .map((h) => {
        return `<tr>
          <td class="mono">${escapeHtml(h.quarter)}</td>
          <td class="num mono">${formatUsd(h.portfolioValueUsd)}</td>
          <td class="num mono ${pctClass(h.qoqChangePct)}">${formatPct(h.qoqChangePct)}</td>
          <td class="num mono">${formatHoldings(h.holdingsCount)}</td>
        </tr>`;
      })
      .join("");
    return `<div class="table-scroll institution-proxy-performance__history-wrap">
      <table class="trades-table institution-proxy-performance__history-table">
        <thead>
          <tr>
            <th>Quarter</th>
            <th class="num">Portfolio Value</th>
            <th class="num">QoQ Change</th>
            <th class="num">Holdings</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  }

  function chartBlock(history) {
    const values = (history || []).map((h) => h.portfolioValueUsd).filter(finite);
    if (values.length < 2) {
      return `<p class="muted small">Not enough quarters for a chart.</p>`;
    }
    const up = values[values.length - 1] >= values[0];
    return `<div class="institution-proxy-performance__chart" aria-hidden="true">
      ${buildSparklineSvg(values, up, {
        className: "institution-proxy-performance__spark",
        width: 420,
        height: 120,
      })}
    </div>`;
  }

  function detailHtml(row) {
    return `<tr class="institution-proxy-performance__detail-row" data-proxy-detail="${escapeHtml(row.cik)}">
      <td colspan="8">
        <div class="institution-proxy-performance__detail">
          <div class="institution-proxy-performance__detail-grid">
            <section>
              <h4 class="institution-hub__section-label">Portfolio Value History</h4>
              ${historyTable(row.history)}
            </section>
            <section>
              <h4 class="institution-hub__section-label">Quarterly Growth</h4>
              <dl class="institution-proxy-performance__metrics">
                <div><dt>Current Portfolio Value</dt><dd class="mono">${formatUsd(row.currentPortfolioValueUsd)}</dd></div>
                <div><dt>QoQ Change ($)</dt><dd class="mono ${pctClass(row.qoqChangeUsd)}">${formatUsd(row.qoqChangeUsd)}</dd></div>
                <div><dt>QoQ Change (%)</dt><dd class="mono ${pctClass(row.qoqChangePct)}">${formatPct(row.qoqChangePct)}</dd></div>
                <div><dt>1Y Change ($)</dt><dd class="mono ${pctClass(row.change1yUsd)}">${formatUsd(row.change1yUsd)}</dd></div>
                <div><dt>1Y Change (%)</dt><dd class="mono ${pctClass(row.change1yPct)}">${formatPct(row.change1yPct)}</dd></div>
              </dl>
              <h4 class="institution-hub__section-label">Line Chart</h4>
              ${chartBlock(row.history)}
              <p class="muted small">Reported 13F portfolio value by quarter (proxy, not investment return).</p>
            </section>
          </div>
        </div>
      </td>
    </tr>`;
  }

  function render() {
    const body = document.getElementById("institution-proxy-performance-body");
    const count = document.getElementById("institution-proxy-performance-count");
    const subtitle = document.getElementById("institution-proxy-performance-subtitle");
    if (!body) return;

    if (subtitle && payload) {
      const q = payload.asOfQuarter || "—";
      subtitle.textContent = `As of ${q} · Ranked by change in reported 13F portfolio value`;
    }

    if (count && payload) {
      count.textContent = `${payload.total.toLocaleString()} institution${payload.total === 1 ? "" : "s"}`;
    }

    if (!payload?.rankings?.length) {
      body.innerHTML = `<tr><td colspan="8" class="muted">No institutions match the current filters.</td></tr>`;
      return;
    }

    const html = [];
    for (const row of payload.rankings) {
      const open = expanded.has(row.cik);
      html.push(`<tr class="institution-proxy-performance__row${open ? " is-expanded" : ""}" data-proxy-cik="${escapeHtml(row.cik)}" tabindex="0">
        <td class="mono">${row.rank}</td>
        <td>
          <button type="button" class="table-link institution-proxy-performance__name-btn" data-proxy-open="${escapeHtml(row.cik)}">${escapeHtml(row.name)}</button>
          <div class="muted small mono">${escapeHtml(row.cik.replace(/^0+/, "") || row.cik)}</div>
        </td>
        <td class="num mono">${formatUsd(row.currentPortfolioValueUsd)}</td>
        <td class="num mono ${pctClass(row.qoqChangePct)}">${formatPct(row.qoqChangePct)}</td>
        <td class="num mono ${pctClass(row.change1yPct)}">${formatPct(row.change1yPct)}</td>
        <td class="num mono">${formatHoldings(row.holdingsCount)}</td>
        <td class="mono">${escapeHtml(row.latestFilingDate || "N/A")}</td>
        <td class="num"><button type="button" class="btn btn--ghost institution-proxy-performance__expand" data-proxy-expand="${escapeHtml(row.cik)}" aria-expanded="${open}">${open ? "Hide" : "Details"}</button></td>
      </tr>`);
      if (open) html.push(detailHtml(row));
    }
    body.innerHTML = html.join("");
  }

  async function load() {
    const id = ++requestId;
    setLoading(true);
    setStatus("");
    try {
      const params = readFilters();
      const data = await apiJson("/api/institutions/performance-rankings", params);
      if (id !== requestId) return;
      payload = data;
      populateQuarters(data.availableQuarters || [], data.asOfQuarter);
      const disclaimer = document.getElementById("institution-proxy-performance-disclaimer");
      if (disclaimer && data.disclaimer) disclaimer.textContent = data.disclaimer;
      render();
    } catch (err) {
      if (id !== requestId) return;
      payload = null;
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message || "Failed to load rankings", true);
      const body = document.getElementById("institution-proxy-performance-body");
      if (body) {
        body.innerHTML = `<tr><td colspan="8" class="muted">Unable to load rankings.</td></tr>`;
      }
    } finally {
      if (id === requestId) setLoading(false);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("institution-proxy-performance-back")?.addEventListener("click", () => {
      deps.onBack?.();
    });

    document.getElementById("proxy-perf-apply")?.addEventListener("click", () => {
      expanded.clear();
      void load();
    });

    ["proxy-perf-quarter", "proxy-perf-sort", "proxy-perf-sort-dir"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        expanded.clear();
        void load();
      });
    });

    let nameTimer = 0;
    document.getElementById("proxy-perf-name")?.addEventListener("input", () => {
      window.clearTimeout(nameTimer);
      nameTimer = window.setTimeout(() => {
        expanded.clear();
        void load();
      }, 280);
    });

    document.getElementById("institution-proxy-performance")?.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const openBtn = t.closest("[data-proxy-open]");
      if (openBtn) {
        e.preventDefault();
        const cik = openBtn.getAttribute("data-proxy-open");
        if (cik && onOpenInstitution) onOpenInstitution(cik);
        return;
      }
      const expandBtn = t.closest("[data-proxy-expand]");
      if (expandBtn) {
        e.preventDefault();
        const cik = expandBtn.getAttribute("data-proxy-expand");
        if (!cik) return;
        if (expanded.has(cik)) expanded.delete(cik);
        else expanded.add(cik);
        render();
      }
    });
  }

  return {
    ensure() {
      bind();
    },
    async show() {
      bind();
      if (!payload && !loading) await load();
      else render();
    },
    reload: load,
  };
}
