/**
 * Tools → Enterprise Value Calculator UI.
 */

const EV_FIELDS = [
  { key: "current_share_price", label: "Share Price", kind: "price" },
  { key: "shares_outstanding", label: "Shares Outstanding", kind: "shares" },
  { key: "market_cap", label: "Market Capitalization", kind: "money" },
  { key: "total_debt", label: "Total Debt", kind: "money" },
  { key: "cash", label: "Cash & Cash Equivalents", kind: "money" },
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

export function createEvCalculatorController(deps) {
  const { searchStocks, onNavigateToHub } = deps;

  let bound = false;
  let ticker = "";
  let companyName = "";
  let filingFinancials = {};
  let sources = {};
  let values = {};
  let overrides = new Set();
  /** When user edits market cap directly, prefer manual mode. */
  let marketCapMode = "derived";
  let searchTimer = 0;
  let calcTimer = 0;
  let requestId = 0;

  function setStatus(msg, isError = false) {
    const el = document.getElementById("tools-ev-load-status");
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
    const bits = ["Source: SEC filing / XBRL"];
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

  function syncDerivedMarketCap() {
    if (marketCapMode === "manual") return;
    if (finite(values.current_share_price) && finite(values.shares_outstanding) && values.shares_outstanding > 0) {
      values.market_cap =
        Math.round(values.current_share_price * values.shares_outstanding * 100) / 100;
      const input = document.querySelector('[data-ev-input="market_cap"]');
      if (input && document.activeElement !== input) {
        input.value = displayValueForInput("market_cap", values.market_cap);
      }
    }
  }

  function renderFinancialFields() {
    const host = document.getElementById("tools-ev-financial-fields");
    if (!host) return;
    host.innerHTML = EV_FIELDS.map((field) => {
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
            data-ev-input="${field.key}"
            step="any"
            value="${escapeHtml(displayValueForInput(field.key, val))}"
            placeholder="${escapeHtml(placeholder)}"
          />
        </div>
      </div>`;
    }).join("");

    host.querySelectorAll("[data-ev-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-ev-input");
        const value = parseNum(input.value);
        values[key] = value;

        if (key === "market_cap") {
          marketCapMode = "manual";
        } else if (key === "current_share_price" || key === "shares_outstanding") {
          marketCapMode = "derived";
          syncDerivedMarketCap();
        }

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
    const el = document.getElementById("tools-ev-sources");
    if (!el) return;
    el.innerHTML = EV_FIELDS.map((field) => {
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
      current_share_price: values.current_share_price,
      shares_outstanding: values.shares_outstanding,
      market_cap: values.market_cap,
      market_cap_mode: marketCapMode,
      total_debt: values.total_debt,
      cash: values.cash,
    };
  }

  function renderResult(result) {
    const errEl = document.getElementById("tools-ev-errors");
    if (errEl) {
      errEl.hidden = !(result.errors || []).length;
      errEl.textContent = (result.errors || []).join(" ");
    }

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("tools-ev-hero", formatMoney(result.enterprise_value));
    setText("tools-ev-kpi-net-debt", formatMoney(result.net_debt));
    setText(
      "tools-ev-market-cap-note",
      result.market_cap_source === "price_times_shares"
        ? "Market cap from share price × shares outstanding"
        : result.market_cap_source === "manual"
          ? "Market cap entered directly"
          : ""
    );

    const bridge = document.getElementById("tools-ev-bridge");
    if (bridge) {
      const b = result.bridge || {};
      bridge.innerHTML = `
        <div><dt>Market Capitalization</dt><dd class="mono">${formatMoney(b.market_cap)}</dd></div>
        <div><dt>+ Total Debt</dt><dd class="mono">${formatMoney(b.total_debt)}</dd></div>
        <div><dt>− Cash</dt><dd class="mono">${formatMoney(b.cash != null ? -b.cash : null)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= Enterprise Value</dt><dd class="mono">${formatMoney(b.enterprise_value)}</dd></div>
      `;
    }
  }

  async function runCalculate() {
    if (!ticker) return;
    const myId = ++requestId;
    try {
      const res = await fetch("/api/tools/ev/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (myId !== requestId) return;
      renderResult(data);
    } catch (err) {
      if (myId !== requestId) return;
      const errEl = document.getElementById("tools-ev-errors");
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
    setStatus(`Loading Enterprise Value inputs for ${tickerUp}…`);
    const workspace = document.getElementById("tools-ev-workspace");
    try {
      const res = await fetch(`/api/tools/ev/${encodeURIComponent(tickerUp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.ticker;
      companyName = data.company_name || data.ticker;
      filingFinancials = { ...(data.financials || {}) };
      sources = { ...(data.sources || {}) };
      overrides = new Set();
      marketCapMode = "derived";
      values = {
        current_share_price: filingFinancials.current_share_price ?? null,
        shares_outstanding: filingFinancials.shares_outstanding ?? null,
        market_cap: filingFinancials.market_cap ?? null,
        total_debt: filingFinancials.total_debt ?? null,
        cash: filingFinancials.cash ?? null,
      };
      const selected = document.getElementById("tools-ev-selected");
      if (selected) selected.textContent = `${ticker} · ${companyName}`;
      const input = document.getElementById("tools-ev-ticker-input");
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
      current_share_price: filingFinancials.current_share_price ?? null,
      shares_outstanding: filingFinancials.shares_outstanding ?? null,
      market_cap: filingFinancials.market_cap ?? null,
      total_debt: filingFinancials.total_debt ?? null,
      cash: filingFinancials.cash ?? null,
    };
    overrides = new Set();
    marketCapMode = "derived";
    renderFinancialFields();
    scheduleCalculate();
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-ev-suggestions");
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
          return `<li><button type="button" data-ev-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-ev-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-ev-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-ev-back")?.addEventListener("click", () => onNavigateToHub?.());
    document.getElementById("tools-ev-load-btn")?.addEventListener("click", () => {
      void loadTicker(document.getElementById("tools-ev-ticker-input")?.value || "");
    });
    const searchInput = document.getElementById("tools-ev-ticker-input");
    searchInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void renderSuggestions(searchInput.value.trim()), 220);
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ul = document.getElementById("tools-ev-suggestions");
        if (ul) ul.hidden = true;
        void loadTicker(searchInput.value);
      }
    });
    document.getElementById("tools-ev-reset-filings")?.addEventListener("click", resetToFilings);
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
  };
}
