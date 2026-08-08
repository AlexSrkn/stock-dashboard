/**
 * Tools → P/E Valuation Calculator UI.
 */

const PE_FIELDS = [
  { key: "diluted_eps", label: "Diluted EPS", kind: "eps" },
  { key: "net_income", label: "Net Income", kind: "money" },
  { key: "shares_outstanding", label: "Diluted Shares Outstanding", kind: "shares" },
  { key: "current_share_price", label: "Current Share Price", kind: "price" },
];

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

function formatMoney(n) {
  if (!finite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPrice(n) {
  if (!finite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatEps(n) {
  if (!finite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatShares(n) {
  if (!finite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}

function formatPctSigned(n, digits = 1) {
  if (!finite(n)) return "—";
  const pct = n * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

function formatMultiple(n) {
  if (!finite(n)) return "—";
  return `${n.toFixed(1)}x`;
}

function parseNum(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function createPeCalculatorController(deps) {
  const { searchStocks, onNavigateToHub } = deps;

  let bound = false;
  let ticker = "";
  let companyName = "";
  let filingFinancials = {};
  let sources = {};
  let values = {};
  let overrides = new Set();
  let searchTimer = 0;
  let calcTimer = 0;
  let requestId = 0;

  function setStatus(msg, isError = false) {
    const el = document.getElementById("tools-pe-load-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.style.color = isError ? "#f87171" : "";
  }

  function sourceLine(key) {
    const src = sources[key];
    if (key === "current_share_price" && !src) return "Enter share price manually.";
    if (!src) return "Not available";
    if (String(src.note || "").includes("Market quote") && !src.filing_type) {
      return src.note;
    }
    const bits = ["Source: SEC/XBRL"];
    if (src.filing_type) bits.push(src.filing_type);
    if (src.filing_date) bits.push(`Filed ${src.filing_date}`);
    if (src.fiscal_period) bits.push(src.fiscal_period);
    if (src.note) bits.push(src.note);
    return bits.join(" · ");
  }

  function displayValueForInput(key, val) {
    if (!finite(val)) return "";
    return String(val);
  }

  function renderFinancialFields() {
    const host = document.getElementById("tools-pe-financial-fields");
    if (!host) return;
    host.innerHTML = PE_FIELDS.map((field) => {
      const val = values[field.key];
      const overridden = overrides.has(field.key);
      const placeholder =
        field.key === "current_share_price"
          ? "Enter manually if unavailable"
          : finite(val)
            ? ""
            : "Not available — enter manually";
      return `<div class="tools-dcf-field">
        <div class="tools-dcf-field__meta">
          <span class="tools-dcf-field__label">${escapeHtml(field.label)}</span>
          <span class="tools-dcf-field__source muted">${escapeHtml(sourceLine(field.key))}</span>
        </div>
        <div class="tools-dcf-field__controls">
          ${overridden ? `<span class="tools-dcf-override-tag">Manual override</span>` : ""}
          <input
            type="number"
            class="institution-hub__toolbar-input"
            data-pe-input="${field.key}"
            step="any"
            value="${escapeHtml(displayValueForInput(field.key, val))}"
            placeholder="${escapeHtml(placeholder)}"
          />
        </div>
      </div>`;
    }).join("");

    host.querySelectorAll("[data-pe-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-pe-input");
        const value = parseNum(input.value);
        values[key] = value;
        const filed = filingFinancials[key];
        const isOverride =
          (finite(filed) && value !== filed) || (!finite(filed) && value != null);
        if (isOverride) overrides.add(key);
        else overrides.delete(key);
        const fieldRoot = input.closest(".tools-dcf-field");
        let tag = fieldRoot?.querySelector(".tools-dcf-override-tag");
        if (isOverride && fieldRoot && !tag) {
          tag = document.createElement("span");
          tag.className = "tools-dcf-override-tag";
          tag.textContent = "Manual override";
          fieldRoot.querySelector(".tools-dcf-field__controls")?.prepend(tag);
        } else if (!isOverride && tag) {
          tag.remove();
        }
        scheduleCalculate();
      });
    });
  }

  function renderSources() {
    const el = document.getElementById("tools-pe-sources");
    if (!el) return;
    el.innerHTML = PE_FIELDS.map((field) => {
      const val = filingFinancials[field.key];
      const shown =
        field.kind === "shares"
          ? formatShares(val)
          : field.kind === "price"
            ? formatPrice(val)
            : field.kind === "eps"
              ? formatEps(val)
              : formatMoney(val);
      return `<div class="tools-dcf-source-card">
        <div class="tools-dcf-source-card__title">${escapeHtml(field.label)} · ${escapeHtml(shown)}</div>
        <div class="tools-dcf-source-card__meta">${escapeHtml(sourceLine(field.key))}</div>
      </div>`;
    }).join("");
  }

  function buildPayload() {
    return {
      diluted_eps: values.diluted_eps,
      net_income: values.net_income,
      shares_outstanding: values.shares_outstanding,
      current_share_price: values.current_share_price,
      target_pe: parseNum(document.getElementById("tools-pe-target")?.value),
      scenarios: {
        bear: {
          pe_multiple:
            parseNum(document.querySelector('[data-pe-scenario="bear"]')?.value) ?? 15,
        },
        base: {
          pe_multiple:
            parseNum(document.querySelector('[data-pe-scenario="base"]')?.value) ?? 20,
        },
        bull: {
          pe_multiple:
            parseNum(document.querySelector('[data-pe-scenario="bull"]')?.value) ?? 25,
        },
      },
    };
  }

  function renderResult(result) {
    const errEl = document.getElementById("tools-pe-errors");
    if (errEl) {
      errEl.hidden = !(result.errors || []).length;
      errEl.textContent = (result.errors || []).join(" ");
    }

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("tools-pe-hero", formatPrice(result.implied_share_price));
    setText("tools-pe-kpi-eps", formatEps(result.diluted_eps));
    setText("tools-pe-kpi-multiple", formatMultiple(result.target_pe));
    setText("tools-pe-kpi-price", formatPrice(result.current_share_price));
    setText("tools-pe-kpi-upside", formatPctSigned(result.implied_upside));
    setText(
      "tools-pe-eps-note",
      result.eps_source === "derived"
        ? "EPS derived from net income ÷ diluted shares"
        : result.eps_source === "reported"
          ? "Using reported diluted EPS"
          : ""
    );

    const bridge = document.getElementById("tools-pe-bridge");
    if (bridge) {
      const b = result.bridge || {};
      bridge.innerHTML = `
        <div><dt>Current EPS</dt><dd class="mono">${formatEps(b.diluted_eps)}</dd></div>
        <div><dt>× Selected P/E</dt><dd class="mono">${formatMultiple(b.target_pe)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= Implied Share Price</dt><dd class="mono">${formatPrice(b.implied_share_price)}</dd></div>
      `;
    }

    const cards = document.getElementById("tools-pe-scenario-cards");
    if (cards) {
      cards.innerHTML = (result.scenarios || [])
        .map(
          (s) => `<div class="tools-dcf-scenario-card">
          <span class="tools-dcf-scenario-card__label">${escapeHtml(s.label)}</span>
          <div class="muted small mono">${formatMultiple(s.pe_multiple)}</div>
          <div class="tools-dcf-scenario-card__value mono">${formatPrice(s.implied_share_price)}</div>
        </div>`
        )
        .join("");
    }

    const table = document.getElementById("tools-pe-scenario-table-body");
    if (table) {
      const rows = result.scenarios || [];
      if (!rows.length) {
        table.innerHTML = `<tr><td colspan="3" class="muted">Not available</td></tr>`;
      } else {
        table.innerHTML = `
          <tr>
            ${rows.map((s) => `<td class="num mono">${formatMultiple(s.pe_multiple)}</td>`).join("")}
          </tr>
          <tr>
            ${rows
              .map((s) => `<td class="num mono">${formatPrice(s.implied_share_price)}</td>`)
              .join("")}
          </tr>
        `;
      }
    }
  }

  async function runCalculate() {
    if (!ticker) return;
    const myId = ++requestId;
    try {
      const res = await fetch("/api/tools/pe/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (myId !== requestId) return;
      renderResult(data);
    } catch (err) {
      if (myId !== requestId) return;
      const errEl = document.getElementById("tools-pe-errors");
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = err instanceof Error ? err.message : String(err);
      }
    }
  }

  function scheduleCalculate() {
    window.clearTimeout(calcTimer);
    calcTimer = window.setTimeout(() => void runCalculate(), 180);
  }

  async function loadTicker(sym) {
    const tickerUp = String(sym || "").trim().toUpperCase();
    if (!tickerUp) {
      setStatus("Enter a valid ticker.", true);
      return;
    }
    setStatus(`Loading P/E inputs for ${tickerUp}…`);
    const workspace = document.getElementById("tools-pe-workspace");
    try {
      const res = await fetch(`/api/tools/pe/${encodeURIComponent(tickerUp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.ticker;
      companyName = data.company_name || data.ticker;
      filingFinancials = { ...(data.financials || {}) };
      sources = { ...(data.sources || {}) };
      overrides = new Set();
      const eps =
        filingFinancials.diluted_eps ?? filingFinancials.derived_eps ?? null;
      values = {
        diluted_eps: eps,
        net_income: filingFinancials.net_income ?? null,
        shares_outstanding: filingFinancials.shares_outstanding ?? null,
        current_share_price: filingFinancials.current_share_price ?? null,
      };
      // If we seeded from derived EPS, mark diluted_eps source as derived for UI.
      if (filingFinancials.diluted_eps == null && filingFinancials.derived_eps != null) {
        sources.diluted_eps = sources.derived_eps || sources.diluted_eps;
      }
      const selected = document.getElementById("tools-pe-selected");
      if (selected) selected.textContent = `${ticker} · ${companyName}`;
      const input = document.getElementById("tools-pe-ticker-input");
      if (input) input.value = ticker;
      if (workspace) workspace.hidden = false;
      renderFinancialFields();
      renderSources();
      setStatus(
        Array.isArray(data.missing) && data.missing.length
          ? `Loaded ${ticker}. Missing: ${data.missing.join(", ")}`
          : `Loaded ${ticker} from SEC filings.`
      );
      scheduleCalculate();
    } catch (err) {
      if (workspace) workspace.hidden = true;
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  }

  function resetToFilings() {
    const eps = filingFinancials.diluted_eps ?? filingFinancials.derived_eps ?? null;
    values = {
      diluted_eps: eps,
      net_income: filingFinancials.net_income ?? null,
      shares_outstanding: filingFinancials.shares_outstanding ?? null,
      current_share_price: filingFinancials.current_share_price ?? null,
    };
    overrides = new Set();
    renderFinancialFields();
    scheduleCalculate();
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-pe-suggestions");
    if (!ul) return;
    if (!q) {
      ul.hidden = true;
      ul.innerHTML = "";
      return;
    }
    try {
      const results = await searchStocks(q);
      const rows = Array.isArray(results) ? results.slice(0, 8) : [];
      ul.hidden = !rows.length;
      ul.innerHTML = rows
        .map((r) => {
          const sym = r.symbol || r.ticker;
          const name = r.description || r.name || "";
          return `<li><button type="button" data-pe-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-pe-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-pe-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-pe-back")?.addEventListener("click", () => onNavigateToHub?.());
    document.getElementById("tools-pe-load-btn")?.addEventListener("click", () => {
      void loadTicker(document.getElementById("tools-pe-ticker-input")?.value || "");
    });
    const searchInput = document.getElementById("tools-pe-ticker-input");
    searchInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void renderSuggestions(searchInput.value.trim()), 220);
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ul = document.getElementById("tools-pe-suggestions");
        if (ul) ul.hidden = true;
        void loadTicker(searchInput.value);
      }
    });
    document.getElementById("tools-pe-reset-filings")?.addEventListener("click", resetToFilings);
    document.getElementById("tools-pe-target")?.addEventListener("input", scheduleCalculate);
    document.querySelectorAll("[data-pe-scenario]").forEach((inp) => {
      inp.addEventListener("input", scheduleCalculate);
    });
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
  };
}
