/**
 * Tools → Earnings Power Value (EPV) Calculator UI.
 */

const WACC_STORAGE_KEY = "tools:wacc:lastResult";

const EPV_FIELDS = [
  { key: "revenue", label: "Revenue", kind: "money" },
  { key: "ebit", label: "Operating Income / EBIT", kind: "money" },
  { key: "tax_rate", label: "Tax Rate", kind: "pct" },
  { key: "depreciation", label: "Depreciation & Amortization", kind: "money" },
  { key: "cash", label: "Cash", kind: "money" },
  { key: "debt", label: "Total Debt", kind: "money" },
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

function formatPct(n, digits = 2) {
  if (!finite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function formatPctSigned(n, digits = 1) {
  if (!finite(n)) return "—";
  const pct = n * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
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

function parsePctList(raw) {
  return String(raw || "")
    .split(/[, ]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
    .map((n) => n / 100);
}

function loadSavedWaccResult() {
  try {
    const raw = localStorage.getItem(WACC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function createEpvCalculatorController(deps) {
  const { searchStocks, onNavigateToHub, onOpenWacc } = deps;

  let bound = false;
  let ticker = "";
  let companyName = "";
  let filingFinancials = {};
  let sources = {};
  let historicalMargins = [];
  let values = {};
  let overrides = new Set();
  let searchTimer = 0;
  let calcTimer = 0;
  let requestId = 0;

  function setStatus(msg, isError = false) {
    const el = document.getElementById("tools-epv-load-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.style.color = isError ? "#f87171" : "";
  }

  function sourceLine(key) {
    const src = sources[key];
    if (key === "current_share_price" && !src) return "Enter current price manually.";
    if (!src) return "Not available";
    if (String(src.note || "").includes("Market quote")) return src.note;
    const bits = ["Source: SEC filing"];
    if (src.fiscal_period) bits.push(src.fiscal_period);
    if (src.filing_type) bits.push(src.filing_type);
    if (src.filing_date) bits.push(`Filed ${src.filing_date}`);
    if (src.note) bits.push(src.note);
    return bits.join(" · ");
  }

  function displayValueForInput(key, val) {
    if (!finite(val)) return "";
    if (key === "tax_rate") return String(Math.round(val * 10000) / 100);
    return String(val);
  }

  function renderFinancialFields() {
    const host = document.getElementById("tools-epv-financial-fields");
    if (!host) return;
    host.innerHTML = EPV_FIELDS.map((field) => {
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
            data-epv-input="${field.key}"
            step="any"
            value="${escapeHtml(displayValueForInput(field.key, val))}"
            placeholder="${escapeHtml(placeholder)}"
          />
        </div>
      </div>`;
    }).join("");

    host.querySelectorAll("[data-epv-input]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-epv-input");
        let value = parseNum(input.value);
        if (key === "tax_rate" && value != null) value /= 100;
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

  function renderHistoricalMargins() {
    const el = document.getElementById("tools-epv-historical-margins");
    if (!el) return;
    if (!historicalMargins.length) {
      el.innerHTML = `<p class="muted small">Not available — insufficient filing history.</p>`;
      return;
    }
    el.innerHTML = `<div class="table-scroll"><table class="trades-table">
      <thead><tr><th>Period</th><th class="num">Revenue</th><th class="num">EBIT</th><th class="num">Operating margin</th></tr></thead>
      <tbody>
        ${historicalMargins
          .map(
            (row) => `<tr>
          <td>${escapeHtml(row.fiscal_period || (row.fiscal_year != null ? String(row.fiscal_year) : "—"))}</td>
          <td class="num mono">${formatMoney(row.revenue)}</td>
          <td class="num mono">${formatMoney(row.ebit)}</td>
          <td class="num mono">${formatPct(row.operating_margin)}</td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table></div>`;
  }

  function renderSources() {
    const el = document.getElementById("tools-epv-sources");
    if (!el) return;
    el.innerHTML = EPV_FIELDS.map((field) => {
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
  }

  function syncMethodVisibility() {
    const method = document.getElementById("tools-epv-normalization-method")?.value || "normalized_margin";
    const marginField = document.getElementById("tools-epv-normalized-margin-field");
    if (marginField) marginField.hidden = method !== "normalized_margin";
  }

  function applySavedWaccIfAvailable() {
    const saved = loadSavedWaccResult();
    const input = document.getElementById("tools-epv-wacc");
    const status = document.getElementById("tools-epv-wacc-status");
    if (!input) return;
    if (saved?.ticker && String(saved.ticker).toUpperCase() === ticker && finite(saved.wacc)) {
      input.value = String(Math.round(saved.wacc * 10000) / 100);
      if (status) status.textContent = `Using calculated WACC ${(saved.wacc * 100).toFixed(2)}% from WACC Calculator.`;
      return;
    }
    if (!input.value) input.value = "9";
    if (status) status.textContent = "";
  }

  function buildPayload() {
    const method = document.getElementById("tools-epv-normalization-method")?.value || "normalized_margin";
    return {
      revenue: values.revenue,
      ebit: values.ebit,
      average_ebit: filingFinancials.average_ebit ?? null,
      tax_rate: values.tax_rate,
      cash: values.cash,
      debt: values.debt,
      shares_outstanding: values.shares_outstanding,
      current_share_price: values.current_share_price,
      normalization_method: method,
      normalized_margin: (() => {
        const n = parseNum(document.getElementById("tools-epv-normalized-margin")?.value);
        return n == null ? null : n / 100;
      })(),
      wacc: (() => {
        const n = parseNum(document.getElementById("tools-epv-wacc")?.value);
        return n == null ? null : n / 100;
      })(),
      sensitivity_wacc: parsePctList(document.getElementById("tools-epv-sens-wacc")?.value),
      sensitivity_margins: parsePctList(document.getElementById("tools-epv-sens-margins")?.value),
      scenarios: {
        bear: {
          normalized_margin:
            (parseNum(document.querySelector('[data-epv-scenario="bear"][data-epv-scenario-field="normalized_margin"]')?.value) ?? 8) /
            100,
          wacc:
            (parseNum(document.querySelector('[data-epv-scenario="bear"][data-epv-scenario-field="wacc"]')?.value) ?? 10) / 100,
        },
        base: {
          normalized_margin:
            (parseNum(document.querySelector('[data-epv-scenario="base"][data-epv-scenario-field="normalized_margin"]')?.value) ?? 10) /
            100,
          wacc:
            (parseNum(document.querySelector('[data-epv-scenario="base"][data-epv-scenario-field="wacc"]')?.value) ?? 9) / 100,
        },
        bull: {
          normalized_margin:
            (parseNum(document.querySelector('[data-epv-scenario="bull"][data-epv-scenario-field="normalized_margin"]')?.value) ?? 12) /
            100,
          wacc:
            (parseNum(document.querySelector('[data-epv-scenario="bull"][data-epv-scenario-field="wacc"]')?.value) ?? 8) / 100,
        },
      },
    };
  }

  function renderResult(result) {
    const errEl = document.getElementById("tools-epv-errors");
    if (errEl) {
      errEl.hidden = !(result.errors || []).length;
      errEl.textContent = (result.errors || []).join(" ");
    }

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("tools-epv-hero", formatPrice(result.epv_per_share));
    setText("tools-epv-kpi-enterprise", formatMoney(result.enterprise_epv));
    setText("tools-epv-kpi-equity", formatMoney(result.equity_epv));
    setText("tools-epv-kpi-price", formatPrice(values.current_share_price));
    setText("tools-epv-kpi-upside", formatPctSigned(result.implied_upside));

    const bridge = document.getElementById("tools-epv-bridge");
    if (bridge) {
      const b = result.bridge || {};
      bridge.innerHTML = `
        <div><dt>Normalized EBIT</dt><dd class="mono">${formatMoney(b.normalized_ebit)}</dd></div>
        <div><dt>− Tax</dt><dd class="mono">${formatMoney(b.tax != null ? -b.tax : null)}</dd></div>
        <div><dt>= After-tax earnings</dt><dd class="mono">${formatMoney(b.normalized_after_tax_earnings)}</dd></div>
        <div><dt>÷ WACC</dt><dd class="mono">${formatPct(b.wacc)}</dd></div>
        <div><dt>= Enterprise EPV</dt><dd class="mono">${formatMoney(b.enterprise_epv)}</dd></div>
        <div><dt>− Debt</dt><dd class="mono">${formatMoney(b.debt != null ? -b.debt : null)}</dd></div>
        <div><dt>+ Cash</dt><dd class="mono">${formatMoney(b.cash)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= Equity EPV</dt><dd class="mono">${formatMoney(b.equity_epv)}</dd></div>
        <div><dt>÷ Diluted shares</dt><dd class="mono">${formatShares(b.shares_outstanding)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>= EPV per share</dt><dd class="mono">${formatPrice(b.epv_per_share)}</dd></div>
      `;
    }

    const cards = document.getElementById("tools-epv-scenario-cards");
    if (cards) {
      cards.innerHTML = (result.scenarios || [])
        .map(
          (s) => `<div class="tools-dcf-scenario-card">
          <span class="tools-dcf-scenario-card__label">${escapeHtml(s.label)}</span>
          <div class="tools-dcf-scenario-card__value mono">${formatPrice(s.epv_per_share)}</div>
        </div>`
        )
        .join("");
    }

    const rangeEl = document.getElementById("tools-epv-range");
    if (rangeEl) {
      if (result.epv_range?.low != null && result.epv_range?.high != null) {
        rangeEl.textContent = `EPV range ${formatPrice(result.epv_range.low)} — ${formatPrice(result.epv_range.high)}`;
      } else {
        rangeEl.textContent = "EPV range —";
      }
    }

    renderSensitivity(result);
  }

  function renderSensitivity(result) {
    const head = document.getElementById("tools-epv-sensitivity-head");
    const body = document.getElementById("tools-epv-sensitivity-body");
    if (!head || !body) return;
    const cells = result.sensitivity_matrix || [];
    const waccs = [...new Set(cells.map((c) => c.wacc))].sort((a, b) => a - b);
    const margins = [...new Set(cells.map((c) => c.normalized_margin))].sort((a, b) => a - b);
    const baseW = (parseNum(document.getElementById("tools-epv-wacc")?.value) ?? 9) / 100;
    const baseM =
      (parseNum(document.getElementById("tools-epv-normalized-margin")?.value) ?? 10) / 100;

    head.innerHTML = `<tr><th>Margin \\ WACC</th>${waccs
      .map((w) => {
        const cls = Math.abs(w - baseW) < 0.0005 ? ' class="num is-base-case"' : ' class="num"';
        return `<th${cls}>${(w * 100).toFixed(0)}%</th>`;
      })
      .join("")}</tr>`;

    body.innerHTML = margins
      .map((m) => {
        const rowCls = Math.abs(m - baseM) < 0.0005 ? " is-base-case" : "";
        const tds = waccs
          .map((w) => {
            const cell = cells.find(
              (c) => Math.abs(c.wacc - w) < 1e-9 && Math.abs(c.normalized_margin - m) < 1e-9
            );
            const base =
              Math.abs(w - baseW) < 0.0005 && Math.abs(m - baseM) < 0.0005 ? " is-base-case" : "";
            const text =
              cell?.valid && finite(cell.epv_per_share) ? formatPrice(cell.epv_per_share) : "—";
            return `<td class="num mono${base}">${text}</td>`;
          })
          .join("");
        return `<tr><th class="num${rowCls}">${(m * 100).toFixed(0)}%</th>${tds}</tr>`;
      })
      .join("");
  }

  async function runCalculate() {
    if (!ticker) return;
    const myId = ++requestId;
    try {
      const res = await fetch("/api/tools/epv/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (myId !== requestId) return;
      renderResult(data);
    } catch (err) {
      if (myId !== requestId) return;
      const errEl = document.getElementById("tools-epv-errors");
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
    setStatus(`Loading EPV inputs for ${tickerUp}…`);
    const workspace = document.getElementById("tools-epv-workspace");
    try {
      const res = await fetch(`/api/tools/epv/${encodeURIComponent(tickerUp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.ticker;
      companyName = data.company_name || data.ticker;
      filingFinancials = { ...(data.financials || {}) };
      sources = { ...(data.sources || {}) };
      historicalMargins = Array.isArray(data.historical_margins) ? data.historical_margins : [];
      overrides = new Set();
      values = {
        revenue: filingFinancials.revenue ?? null,
        ebit: filingFinancials.ebit ?? null,
        tax_rate: filingFinancials.tax_rate ?? null,
        depreciation: filingFinancials.depreciation ?? null,
        cash: filingFinancials.cash ?? null,
        debt: filingFinancials.debt ?? null,
        shares_outstanding: filingFinancials.shares_outstanding ?? null,
        current_share_price: filingFinancials.current_share_price ?? null,
      };
      const selected = document.getElementById("tools-epv-selected");
      if (selected) selected.textContent = `${ticker} · ${companyName}`;
      const input = document.getElementById("tools-epv-ticker-input");
      if (input) input.value = ticker;
      const marginInput = document.getElementById("tools-epv-normalized-margin");
      if (marginInput) {
        marginInput.value =
          filingFinancials.suggested_normalized_margin != null
            ? String(Math.round(filingFinancials.suggested_normalized_margin * 10000) / 100)
            : "10";
      }
      applySavedWaccIfAvailable();
      if (workspace) workspace.hidden = false;
      renderFinancialFields();
      renderHistoricalMargins();
      renderSources();
      syncMethodVisibility();
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
      revenue: filingFinancials.revenue ?? null,
      ebit: filingFinancials.ebit ?? null,
      tax_rate: filingFinancials.tax_rate ?? null,
      depreciation: filingFinancials.depreciation ?? null,
      cash: filingFinancials.cash ?? null,
      debt: filingFinancials.debt ?? null,
      shares_outstanding: filingFinancials.shares_outstanding ?? null,
      current_share_price: values.current_share_price,
    };
    overrides = new Set();
    if (
      finite(filingFinancials.current_share_price) &&
      values.current_share_price === filingFinancials.current_share_price
    ) {
      /* keep */
    }
    const marginInput = document.getElementById("tools-epv-normalized-margin");
    if (marginInput && filingFinancials.suggested_normalized_margin != null) {
      marginInput.value = String(Math.round(filingFinancials.suggested_normalized_margin * 10000) / 100);
    }
    renderFinancialFields();
    scheduleCalculate();
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-epv-suggestions");
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
          return `<li><button type="button" data-epv-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-epv-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-epv-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-epv-back")?.addEventListener("click", () => onNavigateToHub?.());
    document.getElementById("tools-epv-load-btn")?.addEventListener("click", () => {
      void loadTicker(document.getElementById("tools-epv-ticker-input")?.value || "");
    });
    const searchInput = document.getElementById("tools-epv-ticker-input");
    searchInput?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void renderSuggestions(searchInput.value.trim()), 220);
    });
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ul = document.getElementById("tools-epv-suggestions");
        if (ul) ul.hidden = true;
        void loadTicker(searchInput.value);
      }
    });

    document.getElementById("tools-epv-reset-filings")?.addEventListener("click", resetToFilings);
    document.getElementById("tools-epv-normalization-method")?.addEventListener("change", () => {
      syncMethodVisibility();
      scheduleCalculate();
    });
    [
      "tools-epv-normalized-margin",
      "tools-epv-wacc",
      "tools-epv-sens-wacc",
      "tools-epv-sens-margins",
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", scheduleCalculate);
    });
    document.querySelectorAll("[data-epv-scenario]").forEach((inp) => {
      inp.addEventListener("input", scheduleCalculate);
    });
    document.getElementById("tools-epv-use-wacc-btn")?.addEventListener("click", () => {
      applySavedWaccIfAvailable();
      const saved = loadSavedWaccResult();
      if (!saved?.ticker || String(saved.ticker).toUpperCase() !== ticker) {
        const status = document.getElementById("tools-epv-wacc-status");
        if (status) {
          status.textContent = ticker
            ? `No saved WACC for ${ticker}. Open the WACC Calculator first.`
            : "Load a stock first.";
        }
        return;
      }
      scheduleCalculate();
    });
    document.getElementById("tools-epv-open-wacc-btn")?.addEventListener("click", () => {
      onOpenWacc?.(ticker || null);
    });

    syncMethodVisibility();
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
  };
}
