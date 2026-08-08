/**
 * Tools → FCF Yield Calculator UI.
 */

const FCF_YIELD_FIELDS = [
  { key: "operating_cash_flow", label: "Operating Cash Flow", kind: "money" },
  { key: "capital_expenditures", label: "Capital Expenditures", kind: "money" },
  { key: "free_cash_flow", label: "Free Cash Flow", kind: "money" },
  { key: "current_share_price", label: "Share Price", kind: "price" },
  { key: "shares_outstanding", label: "Shares Outstanding", kind: "shares" },
  { key: "market_cap", label: "Market Capitalization", kind: "money" },
  { key: "total_debt", label: "Total Debt", kind: "money" },
  { key: "cash", label: "Cash & Cash Equivalents", kind: "money" },
  { key: "enterprise_value", label: "Enterprise Value", kind: "money" },
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

function formatShares(n) {
  if (!finite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}

function formatPct(n, digits = 2) {
  if (!finite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function parseNum(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function createFcfYieldCalculatorController(deps) {
  const { searchStocks, onNavigateToHub } = deps;

  let bound = false;
  let ticker = "";
  let companyName = "";
  let filingFinancials = {};
  let sources = {};
  let values = {};
  let overrides = new Set();
  let fcfMode = "derived";
  let marketCapMode = "derived";
  let enterpriseValueMode = "derived";
  let searchTimer = 0;
  let calcTimer = 0;
  let requestId = 0;

  function setStatus(msg, isError = false) {
    const el = document.getElementById("tools-fcfyield-load-status");
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

  function displayValueForInput(_key, val) {
    if (!finite(val)) return "";
    return String(val);
  }

  function syncDerivedFields() {
    if (
      fcfMode === "derived" &&
      finite(values.operating_cash_flow) &&
      finite(values.capital_expenditures)
    ) {
      values.free_cash_flow =
        Math.round((values.operating_cash_flow - Math.abs(values.capital_expenditures)) * 100) /
        100;
      const input = document.querySelector('[data-fcfyield-input="free_cash_flow"]');
      if (input && document.activeElement !== input) {
        input.value = displayValueForInput("free_cash_flow", values.free_cash_flow);
      }
    }

    if (
      marketCapMode === "derived" &&
      finite(values.current_share_price) &&
      finite(values.shares_outstanding) &&
      values.shares_outstanding > 0
    ) {
      values.market_cap =
        Math.round(values.current_share_price * values.shares_outstanding * 100) / 100;
      const input = document.querySelector('[data-fcfyield-input="market_cap"]');
      if (input && document.activeElement !== input) {
        input.value = displayValueForInput("market_cap", values.market_cap);
      }
    }

    if (
      enterpriseValueMode === "derived" &&
      finite(values.market_cap) &&
      finite(values.total_debt) &&
      finite(values.cash)
    ) {
      values.enterprise_value =
        Math.round((values.market_cap + values.total_debt - values.cash) * 100) / 100;
      const input = document.querySelector('[data-fcfyield-input="enterprise_value"]');
      if (input && document.activeElement !== input) {
        input.value = displayValueForInput("enterprise_value", values.enterprise_value);
      }
    }
  }

  function renderFinancialFields() {
    const host = document.getElementById("tools-fcfyield-financial-fields");
    if (!host) return;
    host.innerHTML = FCF_YIELD_FIELDS.map((field) => {
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
            data-fcfyield-input="${field.key}"
            step="any"
            value="${escapeHtml(displayValueForInput(field.key, val))}"
            placeholder="${escapeHtml(placeholder)}"
          />
        </div>
      </div>`;
    }).join("");

    host.querySelectorAll("[data-fcfyield-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-fcfyield-input");
        const value = parseNum(input.value);
        values[key] = value;

        if (key === "free_cash_flow") fcfMode = "manual";
        else if (key === "operating_cash_flow" || key === "capital_expenditures") fcfMode = "derived";

        if (key === "market_cap") marketCapMode = "manual";
        else if (key === "current_share_price" || key === "shares_outstanding") {
          marketCapMode = "derived";
        }

        if (key === "enterprise_value") enterpriseValueMode = "manual";
        else if (key === "market_cap" || key === "total_debt" || key === "cash" || key === "current_share_price" || key === "shares_outstanding") {
          if (key !== "enterprise_value") enterpriseValueMode = "derived";
        }

        syncDerivedFields();

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
    const el = document.getElementById("tools-fcfyield-sources");
    if (!el) return;
    el.innerHTML = FCF_YIELD_FIELDS.map((field) => {
      const val = filingFinancials[field.key];
      const shown =
        field.kind === "shares"
          ? formatShares(val)
          : field.kind === "price"
            ? formatPrice(val)
            : formatMoney(val);
      return `<div class="tools-dcf-source-card">
        <div class="tools-dcf-source-card__title">${escapeHtml(field.label)} · ${escapeHtml(shown)}</div>
        <div class="tools-dcf-source-card__meta">${escapeHtml(sourceLine(field.key))}</div>
      </div>`;
    }).join("");
  }

  function buildPayload() {
    return {
      operating_cash_flow: values.operating_cash_flow,
      capital_expenditures: values.capital_expenditures,
      free_cash_flow: values.free_cash_flow,
      fcf_mode: fcfMode,
      current_share_price: values.current_share_price,
      shares_outstanding: values.shares_outstanding,
      market_cap: values.market_cap,
      total_debt: values.total_debt,
      cash: values.cash,
      enterprise_value: values.enterprise_value,
      enterprise_value_mode: enterpriseValueMode,
    };
  }

  function renderResult(result) {
    const errEl = document.getElementById("tools-fcfyield-errors");
    if (errEl) {
      errEl.hidden = !(result.errors || []).length;
      errEl.textContent = (result.errors || []).join(" ");
    }

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("tools-fcfyield-hero", formatPct(result.fcf_yield));
    setText("tools-fcfyield-kpi-fcf", formatMoney(result.free_cash_flow));
    setText("tools-fcfyield-kpi-yield", formatPct(result.fcf_yield));
    setText("tools-fcfyield-kpi-yield-ev", formatPct(result.fcf_yield_on_ev));
    setText("tools-fcfyield-kpi-mcap", formatMoney(result.market_cap));
    setText("tools-fcfyield-kpi-ev", formatMoney(result.enterprise_value));

    const bridge = document.getElementById("tools-fcfyield-bridge");
    if (bridge) {
      const b = result.bridge || {};
      bridge.innerHTML = `
        <div><dt>Operating Cash Flow</dt><dd class="mono">${formatMoney(b.operating_cash_flow)}</dd></div>
        <div><dt>− Capital Expenditures</dt><dd class="mono">${formatMoney(b.capital_expenditures != null ? -Math.abs(b.capital_expenditures) : null)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= Free Cash Flow</dt><dd class="mono">${formatMoney(b.free_cash_flow)}</dd></div>
        <div><dt>÷ Market Cap</dt><dd class="mono">${formatMoney(b.market_cap)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= FCF Yield</dt><dd class="mono">${formatPct(b.fcf_yield)}</dd></div>
        <div><dt>÷ Enterprise Value</dt><dd class="mono">${formatMoney(b.enterprise_value)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= FCF Yield on EV</dt><dd class="mono">${formatPct(b.fcf_yield_on_ev)}</dd></div>
      `;
    }
  }

  async function runCalculate() {
    if (!ticker) return;
    const myId = ++requestId;
    try {
      const res = await fetch("/api/tools/fcf-yield/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (myId !== requestId) return;
      renderResult(data);
    } catch (err) {
      if (myId !== requestId) return;
      const errEl = document.getElementById("tools-fcfyield-errors");
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
    setStatus(`Loading FCF Yield inputs for ${tickerUp}…`);
    const workspace = document.getElementById("tools-fcfyield-workspace");
    try {
      const res = await fetch(`/api/tools/fcf-yield/${encodeURIComponent(tickerUp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.ticker;
      companyName = data.company_name || data.ticker;
      filingFinancials = { ...(data.financials || {}) };
      sources = { ...(data.sources || {}) };
      overrides = new Set();
      fcfMode = "derived";
      marketCapMode = "derived";
      enterpriseValueMode = "derived";
      values = {
        operating_cash_flow: filingFinancials.operating_cash_flow ?? null,
        capital_expenditures: filingFinancials.capital_expenditures ?? null,
        free_cash_flow: filingFinancials.free_cash_flow ?? null,
        current_share_price: filingFinancials.current_share_price ?? null,
        shares_outstanding: filingFinancials.shares_outstanding ?? null,
        market_cap: filingFinancials.market_cap ?? null,
        total_debt: filingFinancials.total_debt ?? null,
        cash: filingFinancials.cash ?? null,
        enterprise_value: filingFinancials.enterprise_value ?? null,
      };
      const selected = document.getElementById("tools-fcfyield-selected");
      if (selected) selected.textContent = `${ticker} · ${companyName}`;
      const input = document.getElementById("tools-fcfyield-ticker-input");
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
    values = {
      operating_cash_flow: filingFinancials.operating_cash_flow ?? null,
      capital_expenditures: filingFinancials.capital_expenditures ?? null,
      free_cash_flow: filingFinancials.free_cash_flow ?? null,
      current_share_price: filingFinancials.current_share_price ?? null,
      shares_outstanding: filingFinancials.shares_outstanding ?? null,
      market_cap: filingFinancials.market_cap ?? null,
      total_debt: filingFinancials.total_debt ?? null,
      cash: filingFinancials.cash ?? null,
      enterprise_value: filingFinancials.enterprise_value ?? null,
    };
    overrides = new Set();
    fcfMode = "derived";
    marketCapMode = "derived";
    enterpriseValueMode = "derived";
    renderFinancialFields();
    scheduleCalculate();
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-fcfyield-suggestions");
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
          return `<li><button type="button" data-fcfyield-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-fcfyield-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-fcfyield-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-fcfyield-back")?.addEventListener("click", () => onNavigateToHub?.());
    document.getElementById("tools-fcfyield-load-btn")?.addEventListener("click", () => {
      void loadTicker(document.getElementById("tools-fcfyield-ticker-input")?.value || "");
    });
    const searchInput = document.getElementById("tools-fcfyield-ticker-input");
    searchInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(
        () => void renderSuggestions(searchInput.value.trim()),
        220
      );
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ul = document.getElementById("tools-fcfyield-suggestions");
        if (ul) ul.hidden = true;
        void loadTicker(searchInput.value);
      }
    });
    document.getElementById("tools-fcfyield-reset-filings")?.addEventListener("click", resetToFilings);
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
  };
}
