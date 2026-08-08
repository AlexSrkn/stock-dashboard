/**
 * Tools → EV/EBITDA Valuation Calculator UI.
 */

const EVEBITDA_FIELDS = [
  { key: "ebitda", label: "EBITDA", kind: "money" },
  { key: "total_debt", label: "Total Debt", kind: "money" },
  { key: "cash", label: "Cash & Cash Equivalents", kind: "money" },
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

export function createEvEbitdaCalculatorController(deps) {
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
    const el = document.getElementById("tools-evebitda-load-status");
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

  function renderFinancialFields() {
    const host = document.getElementById("tools-evebitda-financial-fields");
    if (!host) return;
    host.innerHTML = EVEBITDA_FIELDS.map((field) => {
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
            data-evebitda-input="${field.key}"
            step="any"
            value="${escapeHtml(displayValueForInput(field.key, val))}"
            placeholder="${escapeHtml(placeholder)}"
          />
        </div>
      </div>`;
    }).join("");

    host.querySelectorAll("[data-evebitda-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-evebitda-input");
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
    const el = document.getElementById("tools-evebitda-sources");
    if (!el) return;
    el.innerHTML = EVEBITDA_FIELDS.map((field) => {
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
      ebitda: values.ebitda,
      total_debt: values.total_debt,
      cash: values.cash,
      shares_outstanding: values.shares_outstanding,
      current_share_price: values.current_share_price,
      target_multiple: parseNum(document.getElementById("tools-evebitda-target")?.value),
      scenarios: {
        bear: {
          ev_ebitda_multiple:
            parseNum(document.querySelector('[data-evebitda-scenario="bear"]')?.value) ?? 12,
        },
        base: {
          ev_ebitda_multiple:
            parseNum(document.querySelector('[data-evebitda-scenario="base"]')?.value) ?? 15,
        },
        bull: {
          ev_ebitda_multiple:
            parseNum(document.querySelector('[data-evebitda-scenario="bull"]')?.value) ?? 18,
        },
      },
    };
  }

  function renderResult(result) {
    const errEl = document.getElementById("tools-evebitda-errors");
    if (errEl) {
      errEl.hidden = !(result.errors || []).length;
      errEl.textContent = (result.errors || []).join(" ");
    }

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("tools-evebitda-hero", formatPrice(result.implied_share_price));
    setText("tools-evebitda-kpi-ev", formatMoney(result.implied_enterprise_value));
    setText("tools-evebitda-kpi-equity", formatMoney(result.implied_equity_value));
    setText("tools-evebitda-kpi-price", formatPrice(result.current_share_price));
    setText("tools-evebitda-kpi-upside", formatPctSigned(result.implied_upside));
    setText(
      "tools-evebitda-net-debt",
      finite(result.net_debt)
        ? result.net_debt < 0
          ? `Net cash ${formatMoney(Math.abs(result.net_debt))}`
          : `Net debt ${formatMoney(result.net_debt)}`
        : "Net debt —"
    );

    const bridge = document.getElementById("tools-evebitda-bridge");
    if (bridge) {
      const b = result.bridge || {};
      bridge.innerHTML = `
        <div><dt>EBITDA</dt><dd class="mono">${formatMoney(b.ebitda)}</dd></div>
        <div><dt>× EV/EBITDA multiple</dt><dd class="mono">${formatMultiple(b.target_multiple)}</dd></div>
        <div><dt>= Enterprise Value</dt><dd class="mono">${formatMoney(b.implied_enterprise_value)}</dd></div>
        <div><dt>− Debt</dt><dd class="mono">${formatMoney(b.total_debt != null ? -b.total_debt : null)}</dd></div>
        <div><dt>+ Cash</dt><dd class="mono">${formatMoney(b.cash)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= Equity Value</dt><dd class="mono">${formatMoney(b.implied_equity_value)}</dd></div>
        <div><dt>÷ Diluted shares</dt><dd class="mono">${formatShares(b.shares_outstanding)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= Implied Share Price</dt><dd class="mono">${formatPrice(b.implied_share_price)}</dd></div>
      `;
    }

    const cards = document.getElementById("tools-evebitda-scenario-cards");
    if (cards) {
      cards.innerHTML = (result.scenarios || [])
        .map(
          (s) => `<div class="tools-dcf-scenario-card">
          <span class="tools-dcf-scenario-card__label">${escapeHtml(s.label)}</span>
          <div class="muted small mono">${formatMultiple(s.ev_ebitda_multiple)}</div>
          <div class="tools-dcf-scenario-card__value mono">${formatPrice(s.implied_share_price)}</div>
        </div>`
        )
        .join("");
    }

    const table = document.getElementById("tools-evebitda-scenario-table-body");
    if (table) {
      const rows = result.scenarios || [];
      if (!rows.length) {
        table.innerHTML = `<tr><td colspan="3" class="muted">Not available</td></tr>`;
      } else {
        table.innerHTML = `
          <tr>
            ${rows.map((s) => `<td class="num mono">${formatMultiple(s.ev_ebitda_multiple)}</td>`).join("")}
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
      const res = await fetch("/api/tools/ev-ebitda/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (myId !== requestId) return;
      renderResult(data);
    } catch (err) {
      if (myId !== requestId) return;
      const errEl = document.getElementById("tools-evebitda-errors");
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
    setStatus(`Loading EV/EBITDA inputs for ${tickerUp}…`);
    const workspace = document.getElementById("tools-evebitda-workspace");
    try {
      const res = await fetch(`/api/tools/ev-ebitda/${encodeURIComponent(tickerUp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.ticker;
      companyName = data.company_name || data.ticker;
      filingFinancials = { ...(data.financials || {}) };
      sources = { ...(data.sources || {}) };
      overrides = new Set();
      values = {
        ebitda: filingFinancials.ebitda ?? null,
        total_debt: filingFinancials.total_debt ?? null,
        cash: filingFinancials.cash ?? null,
        shares_outstanding: filingFinancials.shares_outstanding ?? null,
        current_share_price: filingFinancials.current_share_price ?? null,
      };
      const selected = document.getElementById("tools-evebitda-selected");
      if (selected) selected.textContent = `${ticker} · ${companyName}`;
      const input = document.getElementById("tools-evebitda-ticker-input");
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
      ebitda: filingFinancials.ebitda ?? null,
      total_debt: filingFinancials.total_debt ?? null,
      cash: filingFinancials.cash ?? null,
      shares_outstanding: filingFinancials.shares_outstanding ?? null,
      current_share_price: filingFinancials.current_share_price ?? null,
    };
    overrides = new Set();
    renderFinancialFields();
    scheduleCalculate();
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-evebitda-suggestions");
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
          return `<li><button type="button" data-evebitda-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-evebitda-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-evebitda-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-evebitda-back")?.addEventListener("click", () => onNavigateToHub?.());
    document.getElementById("tools-evebitda-load-btn")?.addEventListener("click", () => {
      void loadTicker(document.getElementById("tools-evebitda-ticker-input")?.value || "");
    });
    const searchInput = document.getElementById("tools-evebitda-ticker-input");
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
        const ul = document.getElementById("tools-evebitda-suggestions");
        if (ul) ul.hidden = true;
        void loadTicker(searchInput.value);
      }
    });
    document.getElementById("tools-evebitda-reset-filings")?.addEventListener("click", resetToFilings);
    document.getElementById("tools-evebitda-target")?.addEventListener("input", scheduleCalculate);
    document.querySelectorAll("[data-evebitda-scenario]").forEach((inp) => {
      inp.addEventListener("input", scheduleCalculate);
    });
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
  };
}
