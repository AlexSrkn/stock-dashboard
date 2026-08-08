/**
 * Tools → WACC Calculator UI.
 */

const WACC_STORAGE_KEY = "tools:wacc:lastResult";

const WACC_FIELDS = [
  { key: "market_value_equity", label: "Market Value of Equity", kind: "money" },
  { key: "total_debt", label: "Total Debt", kind: "money" },
  { key: "corporate_tax_rate", label: "Corporate Tax Rate", kind: "pct" },
  { key: "current_share_price", label: "Current Share Price", kind: "price" },
  { key: "shares_outstanding", label: "Shares Outstanding", kind: "shares" },
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

function formatPct(n, digits = 2) {
  if (!finite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function formatShares(n) {
  if (!finite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}

function formatPrice(n) {
  if (!finite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseNum(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function loadSavedWaccResult() {
  try {
    const raw = localStorage.getItem(WACC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveWaccResult(payload) {
  try {
    localStorage.setItem(WACC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function createWaccCalculatorController(deps) {
  const { searchStocks, onNavigateToDcf, onNavigateToHub, onWaccSaved } = deps;

  let bound = false;
  let ticker = "";
  let companyName = "";
  let filingFinancials = {};
  let sources = {};
  let values = {};
  let overrides = new Set();
  let searchTimer = 0;
  let requestId = 0;

  function setStatus(msg, isError = false) {
    const el = document.getElementById("tools-wacc-load-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.style.color = isError ? "#f87171" : "";
  }

  function sourceLine(key) {
    const src = sources[key];
    if (!src) return "Not available";
    const bits = [];
    if (String(src.note || "").includes("Market quote")) {
      bits.push(src.note);
    } else {
      bits.push("Source: SEC filing");
      if (src.fiscal_period) bits.push(src.fiscal_period);
      if (src.filing_type) bits.push(src.filing_type);
      if (src.filing_date) bits.push(`Filed ${src.filing_date}`);
      if (src.note) bits.push(src.note);
    }
    return bits.join(" · ");
  }

  function renderFinancialFields() {
    const host = document.getElementById("tools-wacc-financial-fields");
    if (!host) return;
    host.innerHTML = WACC_FIELDS.map((field) => {
      const val = values[field.key];
      const overridden = overrides.has(field.key);
      const shown =
        field.kind === "pct" && finite(val) ? String(Math.round(val * 10000) / 100) : finite(val) ? String(val) : "";
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
            data-wacc-input="${field.key}"
            step="any"
            value="${escapeHtml(shown)}"
            placeholder="Not available — enter manually"
          />
        </div>
      </div>`;
    }).join("");

    host.querySelectorAll("[data-wacc-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-wacc-input");
        let value = parseNum(input.value);
        if (key === "corporate_tax_rate" && value != null) value /= 100;
        values[key] = value;
        let shouldRerender = false;
        if (
          (key === "current_share_price" || key === "shares_outstanding") &&
          !overrides.has("market_value_equity") &&
          finite(values.current_share_price) &&
          finite(values.shares_outstanding)
        ) {
          values.market_value_equity = Math.round(values.current_share_price * values.shares_outstanding * 100) / 100;
          shouldRerender = true;
        }
        const filed = filingFinancials[key];
        if ((finite(filed) && value !== filed) || (!finite(filed) && value != null)) overrides.add(key);
        else overrides.delete(key);
        if (shouldRerender) {
          renderFinancialFields();
        } else {
          const fieldRoot = input.closest(".tools-dcf-field");
          let tag = fieldRoot?.querySelector(".tools-dcf-override-tag");
          if (overrides.has(key) && fieldRoot && !tag) {
            tag = document.createElement("span");
            tag.className = "tools-dcf-override-tag";
            tag.textContent = "Manual override";
            fieldRoot.querySelector(".tools-dcf-field__controls")?.prepend(tag);
          } else if (!overrides.has(key) && tag) {
            tag.remove();
          }
        }
        void runCalculate();
      });
    });
  }

  function renderSources() {
    const el = document.getElementById("tools-wacc-sources");
    if (!el) return;
    const rows = [
      ...WACC_FIELDS,
      { key: "cost_of_debt", label: "Cost of Debt", kind: "pct" },
    ];
    el.innerHTML = rows.map((field) => {
      const val = filingFinancials[field.key];
      const shown =
        field.kind === "pct"
          ? formatPct(val)
          : field.kind === "shares"
            ? formatShares(val)
            : field.kind === "price"
              ? formatPrice(val)
              : formatMoney(val);
      return `<div class="tools-dcf-source-card">
        <div class="tools-dcf-source-card__title">${escapeHtml(field.label)} · ${escapeHtml(shown)}</div>
        <div class="tools-dcf-source-card__meta">${escapeHtml(sourceLine(field.key))}</div>
      </div>`;
    }).join("");
    const costDebtSource = document.getElementById("tools-wacc-cost-of-debt-source");
    if (costDebtSource) costDebtSource.textContent = sourceLine("cost_of_debt");
  }

  function syncMethodVisibility() {
    const method = document.getElementById("tools-wacc-equity-method")?.value || "capm";
    const capm = document.getElementById("tools-wacc-capm-grid");
    const manual = document.getElementById("tools-wacc-manual-equity-field");
    if (capm) capm.hidden = method !== "capm";
    if (manual) manual.hidden = method !== "manual";
  }

  function buildPayload() {
    return {
      market_value_equity: values.market_value_equity,
      total_debt: values.total_debt,
      corporate_tax_rate: values.corporate_tax_rate,
      cost_of_debt: (parseNum(document.getElementById("tools-wacc-cost-of-debt")?.value) ?? null) / 100,
      cost_of_equity_method: document.getElementById("tools-wacc-equity-method")?.value || "capm",
      cost_of_equity: (parseNum(document.getElementById("tools-wacc-cost-of-equity")?.value) ?? null) / 100,
      risk_free_rate: (parseNum(document.getElementById("tools-wacc-risk-free-rate")?.value) ?? null) / 100,
      beta: parseNum(document.getElementById("tools-wacc-beta")?.value),
      equity_risk_premium: (parseNum(document.getElementById("tools-wacc-erp")?.value) ?? null) / 100,
    };
  }

  function renderResult(result) {
    const errors = document.getElementById("tools-wacc-errors");
    if (errors) {
      errors.hidden = !(result.errors || []).length;
      errors.textContent = (result.errors || []).join(" ");
    }

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("tools-wacc-value", formatPct(result.wacc));
    setText("tools-wacc-equity-weight", formatPct(result.equity_weight));
    setText("tools-wacc-debt-weight", formatPct(result.debt_weight));
    setText("tools-wacc-cost-equity-used", formatPct(result.cost_of_equity));
    setText("tools-wacc-after-tax-debt", formatPct(result.after_tax_cost_of_debt));

    const breakdown = document.getElementById("tools-wacc-breakdown");
    if (breakdown) {
      breakdown.innerHTML = `
        <div><dt>Equity Weight</dt><dd class="mono">${formatPct(result.equity_weight)}</dd></div>
        <div><dt>Debt Weight</dt><dd class="mono">${formatPct(result.debt_weight)}</dd></div>
        <div><dt>Cost of Equity</dt><dd class="mono">${formatPct(result.cost_of_equity)}</dd></div>
        <div><dt>After-Tax Cost of Debt</dt><dd class="mono">${formatPct(result.after_tax_cost_of_debt)}</dd></div>
        <div><dt>${formatPct(result.equity_weight)} × ${formatPct(result.cost_of_equity)}</dt><dd class="mono">${formatPct(result.breakdown?.equity_component)}</dd></div>
        <div><dt>${formatPct(result.debt_weight)} × ${formatPct(result.after_tax_cost_of_debt)}</dt><dd class="mono">${formatPct(result.breakdown?.debt_component)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>WACC</dt><dd class="mono">${formatPct(result.wacc)}</dd></div>
      `;
    }

    if (ticker && result.ok && finite(result.wacc)) {
      const saved = {
        ticker,
        companyName,
        wacc: result.wacc,
        inputs: buildPayload(),
        calculatedAt: new Date().toISOString(),
      };
      saveWaccResult(saved);
      onWaccSaved?.(saved);
    }
  }

  async function runCalculate() {
    if (!ticker) return;
    const myId = ++requestId;
    try {
      const res = await fetch("/api/tools/wacc/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (myId !== requestId) return;
      renderResult(data);
    } catch (err) {
      if (myId !== requestId) return;
      const errors = document.getElementById("tools-wacc-errors");
      if (errors) {
        errors.hidden = false;
        errors.textContent = err instanceof Error ? err.message : String(err);
      }
    }
  }

  async function loadTicker(sym) {
    const tickerUp = String(sym || "").trim().toUpperCase();
    if (!tickerUp) {
      setStatus("Enter a valid ticker.", true);
      return;
    }
    setStatus(`Loading WACC inputs for ${tickerUp}…`);
    const workspace = document.getElementById("tools-wacc-workspace");
    try {
      const res = await fetch(`/api/tools/wacc/${encodeURIComponent(tickerUp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.ticker;
      companyName = data.company_name || data.ticker;
      filingFinancials = { ...(data.financials || {}) };
      values = {
        market_value_equity: data.financials?.market_value_equity ?? null,
        total_debt: data.financials?.total_debt ?? null,
        corporate_tax_rate: data.financials?.corporate_tax_rate ?? null,
        current_share_price: data.financials?.current_share_price ?? null,
        shares_outstanding: data.financials?.shares_outstanding ?? null,
      };
      sources = { ...(data.sources || {}) };
      overrides = new Set();
      const selected = document.getElementById("tools-wacc-selected");
      if (selected) selected.textContent = `${ticker} · ${companyName}`;
      const input = document.getElementById("tools-wacc-ticker-input");
      if (input) input.value = ticker;
      const betaInput = document.getElementById("tools-wacc-beta");
      if (betaInput) betaInput.value = data.financials?.beta != null ? String(data.financials.beta) : "";
      const debtInput = document.getElementById("tools-wacc-cost-of-debt");
      if (debtInput) debtInput.value = data.financials?.cost_of_debt != null ? String(data.financials.cost_of_debt * 100) : "";
      if (workspace) workspace.hidden = false;
      renderFinancialFields();
      renderSources();
      setStatus(
        Array.isArray(data.missing) && data.missing.length
          ? `Loaded ${ticker}. Missing or market-based inputs: ${data.missing.join(", ")}`
          : `Loaded ${ticker}.`
      );
      void runCalculate();
    } catch (err) {
      if (workspace) workspace.hidden = true;
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-wacc-suggestions");
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
          return `<li><button type="button" data-wacc-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-wacc-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-wacc-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function resetToInputs() {
    values = {
      market_value_equity: filingFinancials.market_value_equity ?? null,
      total_debt: filingFinancials.total_debt ?? null,
      corporate_tax_rate: filingFinancials.corporate_tax_rate ?? null,
      current_share_price: filingFinancials.current_share_price ?? null,
      shares_outstanding: filingFinancials.shares_outstanding ?? null,
    };
    overrides = new Set();
    renderFinancialFields();
    const debtInput = document.getElementById("tools-wacc-cost-of-debt");
    if (debtInput) debtInput.value = filingFinancials.cost_of_debt != null ? String(filingFinancials.cost_of_debt * 100) : "";
    void runCalculate();
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-wacc-back")?.addEventListener("click", () => onNavigateToHub?.());
    document.getElementById("tools-wacc-load-btn")?.addEventListener("click", () => {
      const q = document.getElementById("tools-wacc-ticker-input")?.value || "";
      void loadTicker(q);
    });
    const searchInput = document.getElementById("tools-wacc-ticker-input");
    searchInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void renderSuggestions(searchInput.value.trim()), 220);
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ul = document.getElementById("tools-wacc-suggestions");
        if (ul) ul.hidden = true;
        void loadTicker(searchInput.value);
      }
    });

    document.getElementById("tools-wacc-reset-filings")?.addEventListener("click", resetToInputs);
    document.getElementById("tools-wacc-equity-method")?.addEventListener("change", () => {
      syncMethodVisibility();
      void runCalculate();
    });
    [
      "tools-wacc-cost-of-equity",
      "tools-wacc-cost-of-debt",
      "tools-wacc-risk-free-rate",
      "tools-wacc-beta",
      "tools-wacc-erp",
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", () => void runCalculate());
    });
    document.getElementById("tools-wacc-use-in-dcf")?.addEventListener("click", () => {
      const saved = loadSavedWaccResult();
      if (saved?.ticker) onNavigateToDcf?.(saved.ticker);
    });

    syncMethodVisibility();
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
    getSavedResult: loadSavedWaccResult,
  };
}
