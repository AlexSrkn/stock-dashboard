/**
 * Tools → DCF Calculator UI (client-side).
 * Filing inputs: GET /api/tools/dcf/:ticker
 * Live valuation: POST /api/tools/dcf/calculate
 */

const FINANCIAL_FIELDS = [
  { key: "revenue", label: "Revenue", kind: "money" },
  { key: "ebit", label: "Operating Income / EBIT", kind: "money" },
  { key: "tax_rate", label: "Tax Rate", kind: "pct" },
  { key: "depreciation", label: "Depreciation & Amortization", kind: "money" },
  { key: "capex", label: "Capital Expenditures", kind: "money" },
  { key: "change_in_working_capital", label: "Change in Working Capital", kind: "money" },
  { key: "cash", label: "Cash", kind: "money" },
  { key: "debt", label: "Total Debt", kind: "money" },
  { key: "shares_outstanding", label: "Shares Outstanding", kind: "shares" },
  { key: "current_share_price", label: "Current Share Price", kind: "price" },
];

const DEFAULT_FCF_GROWTH = [10, 10, 8, 7, 5, 5, 4, 4, 3, 3];
const DEFAULT_REV_GROWTH = [10, 9, 8, 6, 5, 5, 4, 4, 3, 3];
const WACC_STORAGE_KEY = "tools:wacc:lastResult";

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
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatSharePrice(n) {
  if (!finite(n)) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(n, digits = 1) {
  if (!finite(n)) return "—";
  const pct = Math.abs(n) <= 2 ? n * 100 : n;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

function formatPctPlain(n, digits = 1) {
  if (!finite(n)) return "—";
  const pct = Math.abs(n) <= 2 ? n * 100 : n;
  return `${pct.toFixed(digits)}%`;
}

function formatShares(n) {
  if (!finite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
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

export function createDcfCalculatorController(deps) {
  const { searchStocks, onNavigate, onOpenWacc } = deps;

  let bound = false;
  let ticker = "";
  let companyName = "";
  /** @type {Record<string, number|null>} */
  let filingFinancials = {};
  /** @type {Record<string, any>} */
  let sources = {};
  /** @type {Set<string>} */
  let overrides = new Set();
  /** @type {Record<string, number|null>} */
  let values = {};
  let calcTimer = 0;
  let searchTimer = 0;
  let requestId = 0;

  function loadSavedWaccResult() {
    try {
      const raw = localStorage.getItem(WACC_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function years() {
    return Number(document.getElementById("tools-dcf-forecast-years")?.value || 5);
  }

  function setStatus(msg, isError = false) {
    const el = document.getElementById("tools-dcf-load-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.style.color = isError ? "#f87171" : "";
  }

  function setWaccStatus(msg) {
    const el = document.getElementById("tools-dcf-wacc-status");
    if (el) el.textContent = msg || "";
  }

  function renderYearRateInputs() {
    const y = years();
    const fcfHost = document.getElementById("tools-dcf-fcf-growth-rates");
    const revHost = document.getElementById("tools-dcf-revenue-growth-rates");
    const fill = (host, prefix, defaults) => {
      if (!host) return;
      const existing = [...host.querySelectorAll("input")].map((inp) => Number(inp.value));
      host.innerHTML = "";
      for (let i = 0; i < y; i++) {
        const label = document.createElement("label");
        label.innerHTML = `Year ${i + 1}`;
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.1";
        input.className = "institution-hub__toolbar-input";
        input.dataset.dcfRate = prefix;
        input.dataset.dcfYear = String(i);
        input.value = String(
          Number.isFinite(existing[i]) ? existing[i] : defaults[i] ?? defaults[defaults.length - 1]
        );
        input.addEventListener("input", scheduleCalculate);
        label.appendChild(input);
        host.appendChild(label);
      }
    };
    fill(fcfHost, "fcf", DEFAULT_FCF_GROWTH);
    fill(revHost, "rev", DEFAULT_REV_GROWTH);
  }

  function sourceLine(key) {
    const src = sources[key];
    if (key === "current_share_price") {
      return "Enter current price manually.";
    }
    if (!src) return "Not available";
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
    const host = document.getElementById("tools-dcf-financial-fields");
    if (!host) return;
    host.innerHTML = FINANCIAL_FIELDS.map((f) => {
      const val = values[f.key];
      const available = finite(val);
      const overridden = overrides.has(f.key);
      const placeholder =
        f.key === "current_share_price"
          ? "Enter manually"
          : available
            ? ""
            : "Not available — enter manually";
      return `<div class="tools-dcf-field" data-dcf-field="${f.key}">
        <div class="tools-dcf-field__meta">
          <span class="tools-dcf-field__label">${escapeHtml(f.label)}</span>
          <span class="tools-dcf-field__source muted">${escapeHtml(sourceLine(f.key))}</span>
        </div>
        <div class="tools-dcf-field__controls">
          ${overridden ? `<span class="tools-dcf-override-tag">Manual override</span>` : ""}
          <input
            type="number"
            class="institution-hub__toolbar-input"
            data-dcf-input="${f.key}"
            value="${escapeHtml(displayValueForInput(f.key, val))}"
            placeholder="${escapeHtml(placeholder)}"
            step="any"
          />
        </div>
      </div>`;
    }).join("");

    host.querySelectorAll("[data-dcf-input]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const key = inp.getAttribute("data-dcf-input");
        let n = parseNum(inp.value);
        if (key === "tax_rate" && n != null) n = n / 100;
        values[key] = n;
        const filed = filingFinancials[key];
        const fieldRoot = inp.closest(".tools-dcf-field");
        let tag = fieldRoot?.querySelector(".tools-dcf-override-tag");
        const isOverride =
          key !== "current_share_price" &&
          ((finite(filed) && n !== filed) || (!finite(filed) && n != null));
        if (isOverride) overrides.add(key);
        else overrides.delete(key);
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

  function renderFcfBuild(components) {
    const el = document.getElementById("tools-dcf-fcf-build");
    if (!el) return;
    const c = components || {};
    el.innerHTML = `<dl>
      <div><dt>EBIT</dt><dd>${formatMoney(c.ebit)}</dd></div>
      <div><dt>Tax</dt><dd>${formatMoney(c.tax)}</dd></div>
      <div><dt>NOPAT</dt><dd>${formatMoney(c.nopat)}</dd></div>
      <div><dt>D&amp;A</dt><dd>${formatMoney(c.depreciation)}</dd></div>
      <div><dt>CapEx</dt><dd>${formatMoney(c.capex)}</dd></div>
      <div><dt>Change in WC</dt><dd>${formatMoney(c.change_in_working_capital)}</dd></div>
      <div class="tools-dcf-fcf-build__total"><dt>FCF</dt><dd>${formatMoney(c.fcf)}</dd></div>
    </dl>`;
  }

  function renderSources() {
    const el = document.getElementById("tools-dcf-sources");
    if (!el) return;
    const cards = FINANCIAL_FIELDS.filter((f) => f.key !== "current_share_price")
      .map((f) => {
        const src = sources[f.key];
        const val = filingFinancials[f.key];
        if (!src && !finite(val)) {
          return `<div class="tools-dcf-source-card">
            <div class="tools-dcf-source-card__title">${escapeHtml(f.label)}</div>
            <div class="tools-dcf-source-card__meta">Not available from SEC filings</div>
          </div>`;
        }
        const shown =
          f.key === "tax_rate" ? formatPctPlain(val) : f.kind === "shares" ? formatShares(val) : formatMoney(val);
        return `<div class="tools-dcf-source-card">
          <div class="tools-dcf-source-card__title">${escapeHtml(f.label)} · ${escapeHtml(shown)}</div>
          <div class="tools-dcf-source-card__meta">${escapeHtml(sourceLine(f.key))}</div>
        </div>`;
      })
      .join("");
    el.innerHTML = cards || `<p class="muted small">Load a stock to see filing sources.</p>`;
  }

  function readRateInputs(prefix) {
    const y = years();
    const inputs = [...document.querySelectorAll(`[data-dcf-rate="${prefix}"]`)];
    const rates = [];
    for (let i = 0; i < y; i++) {
      const n = parseNum(inputs[i]?.value);
      rates.push((n ?? 0) / 100);
    }
    return rates;
  }

  function readScenarios() {
    const out = { bear: {}, base: {}, bull: {} };
    document.querySelectorAll("[data-dcf-scenario]").forEach((inp) => {
      const id = inp.getAttribute("data-dcf-scenario");
      const field = inp.getAttribute("data-dcf-scenario-field");
      const n = parseNum(inp.value);
      if (!id || !field || n == null) return;
      out[id][field] = n / 100;
    });
    return out;
  }

  function buildPayload() {
    const growthMethod = document.getElementById("tools-dcf-growth-method")?.value || "fcf_growth";
    const terminalMethod =
      document.getElementById("tools-dcf-terminal-method")?.value || "perpetual_growth";
    const wacc = (parseNum(document.getElementById("tools-dcf-wacc")?.value) ?? 9) / 100;
    const terminalGrowth =
      (parseNum(document.getElementById("tools-dcf-terminal-growth")?.value) ?? 2.5) / 100;
    const exitMultiple = parseNum(document.getElementById("tools-dcf-exit-multiple")?.value) ?? 10;
    const fcfMarginCurrent =
      (parseNum(document.getElementById("tools-dcf-fcf-margin-current")?.value) ?? 18) / 100;
    const fcfMarginTerminal =
      (parseNum(document.getElementById("tools-dcf-fcf-margin-terminal")?.value) ?? 20) / 100;

    return {
      revenue: values.revenue,
      ebit: values.ebit,
      tax_rate: values.tax_rate,
      depreciation: values.depreciation,
      capex: values.capex,
      change_in_working_capital: values.change_in_working_capital,
      cash: values.cash,
      debt: values.debt,
      shares_outstanding: values.shares_outstanding,
      current_share_price: values.current_share_price,
      ebitda: filingFinancials.ebitda ?? null,
      forecast_years: years(),
      growth_method: growthMethod,
      fcf_growth_rates: readRateInputs("fcf"),
      revenue_growth_rates: readRateInputs("rev"),
      fcf_margin_current: fcfMarginCurrent,
      fcf_margin_terminal: fcfMarginTerminal,
      wacc,
      terminal_method: terminalMethod,
      terminal_growth: terminalGrowth,
      exit_ebitda_multiple: exitMultiple,
      sensitivity_wacc: parsePctList(document.getElementById("tools-dcf-sens-wacc")?.value),
      sensitivity_terminal_growth: parsePctList(document.getElementById("tools-dcf-sens-g")?.value),
      scenarios: readScenarios(),
    };
  }

  function renderResult(result) {
    const errEl = document.getElementById("tools-dcf-errors");
    if (errEl) {
      if (result.errors?.length) {
        errEl.hidden = false;
        errEl.textContent = result.errors.join(" ");
      } else {
        errEl.hidden = true;
        errEl.textContent = "";
      }
    }

    renderFcfBuild(result.fcf_components);

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText("tools-dcf-intrinsic", formatSharePrice(result.intrinsic_value_per_share));
    setText("tools-dcf-kpi-price", formatSharePrice(values.current_share_price));
    setText(
      "tools-dcf-kpi-upside",
      finite(result.implied_upside) ? formatPct(result.implied_upside) : "—"
    );
    setText("tools-dcf-kpi-ev", formatMoney(result.enterprise_value));
    setText("tools-dcf-kpi-equity", formatMoney(result.equity_value));
    setText(
      "tools-dcf-kpi-tvpct",
      finite(result.terminal_value_percentage)
        ? formatPctPlain(result.terminal_value_percentage)
        : "—"
    );

    const bridge = document.getElementById("tools-dcf-bridge");
    if (bridge) {
      bridge.innerHTML = `
        <div><dt>PV of forecast FCF</dt><dd class="mono">${formatMoney(result.pv_forecast_fcf)}</dd></div>
        <div><dt>PV of terminal value</dt><dd class="mono">${formatMoney(result.pv_terminal_value)}</dd></div>
        <div><dt>Enterprise value</dt><dd class="mono">${formatMoney(result.enterprise_value)}</dd></div>
        <div><dt>− Debt</dt><dd class="mono">${formatMoney(values.debt != null ? -Math.abs(values.debt) : null)}</dd></div>
        <div><dt>+ Cash</dt><dd class="mono">${formatMoney(values.cash)}</dd></div>
        <div class="tools-dcf-bridge__total"><dt>Equity value</dt><dd class="mono">${formatMoney(result.equity_value)}</dd></div>
      `;
    }

    const pvBody = document.getElementById("tools-dcf-pv-body");
    if (pvBody) {
      const rows = result.projected_fcf || [];
      pvBody.innerHTML = rows.length
        ? rows
            .map(
              (r) => `<tr>
            <td>Year ${r.year}</td>
            <td class="num mono">${formatMoney(r.fcf)}</td>
            <td class="num mono">${finite(r.discount_factor) ? r.discount_factor.toFixed(4) : "—"}</td>
            <td class="num mono">${formatMoney(r.present_value)}</td>
          </tr>`
            )
            .join("")
        : `<tr><td colspan="4" class="trades-table__empty">No projections</td></tr>`;
    }

    const rangeEl = document.getElementById("tools-dcf-range");
    if (rangeEl) {
      if (result.dcf_range?.low != null && result.dcf_range?.high != null) {
        rangeEl.textContent = `DCF range ${formatSharePrice(result.dcf_range.low)} — ${formatSharePrice(result.dcf_range.high)}`;
      } else {
        rangeEl.textContent = "DCF range —";
      }
    }

    const cards = document.getElementById("tools-dcf-scenario-cards");
    if (cards) {
      cards.innerHTML = (result.scenarios || [])
        .map(
          (s) => `<div class="tools-dcf-scenario-card">
          <span class="tools-dcf-scenario-card__label">${escapeHtml(s.label)}</span>
          <div class="tools-dcf-scenario-card__value mono">${formatSharePrice(s.intrinsic_value_per_share)}</div>
        </div>`
        )
        .join("");
    }

    setText("tools-dcf-reverse-price", formatSharePrice(values.current_share_price));
    const rev = result.reverse_dcf || {};
    setText(
      "tools-dcf-reverse-growth",
      rev.available && finite(rev.implied_fcf_growth)
        ? formatPctPlain(rev.implied_fcf_growth)
        : "—"
    );
    setText("tools-dcf-reverse-msg", rev.message || (rev.available ? "" : "Enter current price manually to enable Reverse DCF."));

    renderSensitivity(result);
  }

  function renderSensitivity(result) {
    const head = document.getElementById("tools-dcf-sensitivity-head");
    const body = document.getElementById("tools-dcf-sensitivity-body");
    if (!head || !body) return;
    const cells = result.sensitivity_matrix || [];
    const waccs = [...new Set(cells.map((c) => c.wacc))].sort((a, b) => a - b);
    const gs = [...new Set(cells.map((c) => c.terminal_growth))].sort((a, b) => a - b);
    const baseW = (parseNum(document.getElementById("tools-dcf-wacc")?.value) ?? 9) / 100;
    const baseG =
      (parseNum(document.getElementById("tools-dcf-terminal-growth")?.value) ?? 2.5) / 100;

    head.innerHTML = `<tr><th>Growth \\ WACC</th>${waccs
      .map((w) => {
        const cls = Math.abs(w - baseW) < 0.0005 ? " class=\"num is-base-case\"" : " class=\"num\"";
        return `<th${cls}>${(w * 100).toFixed(0)}%</th>`;
      })
      .join("")}</tr>`;

    body.innerHTML = gs
      .map((g) => {
        const rowCls = Math.abs(g - baseG) < 0.0005 ? " is-base-case" : "";
        const tds = waccs
          .map((w) => {
            const cell = cells.find(
              (c) => Math.abs(c.wacc - w) < 1e-9 && Math.abs(c.terminal_growth - g) < 1e-9
            );
            const base =
              Math.abs(w - baseW) < 0.0005 && Math.abs(g - baseG) < 0.0005
                ? " is-base-case"
                : "";
            const text =
              cell?.valid && finite(cell.intrinsic_value_per_share)
                ? formatSharePrice(cell.intrinsic_value_per_share)
                : "—";
            return `<td class="num mono${base}">${text}</td>`;
          })
          .join("");
        return `<tr><th class="num${rowCls}">${(g * 100).toFixed(0)}%</th>${tds}</tr>`;
      })
      .join("");
  }

  async function runCalculate() {
    if (!ticker) return;
    const payload = buildPayload();
    const myId = ++requestId;
    try {
      const res = await fetch("/api/tools/dcf/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (myId !== requestId) return;
      renderResult(data);
    } catch (err) {
      if (myId !== requestId) return;
      const errEl = document.getElementById("tools-dcf-errors");
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

  function syncMethodVisibility() {
    const growth = document.getElementById("tools-dcf-growth-method")?.value;
    const terminal = document.getElementById("tools-dcf-terminal-method")?.value;
    const fcfBlock = document.getElementById("tools-dcf-fcf-growth-block");
    const revBlock = document.getElementById("tools-dcf-revenue-margin-block");
    const gField = document.getElementById("tools-dcf-terminal-growth-field");
    const mField = document.getElementById("tools-dcf-exit-multiple-field");
    if (fcfBlock) fcfBlock.hidden = growth !== "fcf_growth";
    if (revBlock) revBlock.hidden = growth !== "revenue_margin";
    if (gField) gField.hidden = terminal !== "perpetual_growth";
    if (mField) mField.hidden = terminal !== "exit_multiple";
  }

  function applySavedWacc() {
    const saved = loadSavedWaccResult();
    if (!saved?.ticker || !finite(saved?.wacc)) {
      setWaccStatus("Run the WACC Calculator first to use a calculated WACC here.");
      return;
    }
    if (!ticker) {
      setWaccStatus("Load a stock in the DCF Calculator first.");
      return;
    }
    if (String(saved.ticker).toUpperCase() !== String(ticker).toUpperCase()) {
      setWaccStatus(`Saved WACC is for ${saved.ticker}. Recalculate WACC for ${ticker} or open the WACC tool.`);
      return;
    }
    const input = document.getElementById("tools-dcf-wacc");
    if (input) input.value = String(saved.wacc * 100);
    setWaccStatus(`Using calculated WACC ${((saved.wacc || 0) * 100).toFixed(2)}% from WACC Calculator.`);
    scheduleCalculate();
  }

  async function loadTicker(sym) {
    const tickerUp = String(sym || "").trim().toUpperCase();
    if (!tickerUp) {
      setStatus("Enter a valid ticker.", true);
      return;
    }
    setStatus(`Loading SEC filings for ${tickerUp}…`);
    const workspace = document.getElementById("tools-dcf-workspace");
    try {
      const res = await fetch(`/api/tools/dcf/${encodeURIComponent(tickerUp)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.ticker;
      companyName = data.company_name || data.ticker;
      filingFinancials = { ...(data.financials || {}) };
      sources = { ...(data.sources || {}) };
      overrides = new Set();
      values = { ...filingFinancials };
      const selected = document.getElementById("tools-dcf-selected");
      if (selected) selected.textContent = `${ticker} · ${companyName}`;
      const input = document.getElementById("tools-dcf-ticker-input");
      if (input) input.value = ticker;
      if (workspace) workspace.hidden = false;
      renderFinancialFields();
      renderSources();
      renderYearRateInputs();
      syncMethodVisibility();
      const missing = Array.isArray(data.missing) ? data.missing : [];
      setStatus(
        missing.length
          ? `Loaded ${ticker}. Missing from filings (enter manually): ${missing.join(", ")}`
          : `Loaded ${ticker} from SEC filings.`
      );
      const savedWacc = loadSavedWaccResult();
      if (savedWacc?.ticker && String(savedWacc.ticker).toUpperCase() === ticker) {
        setWaccStatus(`Calculated WACC available: ${(savedWacc.wacc * 100).toFixed(2)}%.`);
      } else {
        setWaccStatus("");
      }
      onNavigate?.(ticker);
      scheduleCalculate();
    } catch (err) {
      if (workspace) workspace.hidden = true;
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  }

  function resetToFilings() {
    values = { ...filingFinancials, current_share_price: values.current_share_price };
    overrides = new Set();
    if (finite(values.current_share_price)) {
      /* keep price */
    }
    renderFinancialFields();
    scheduleCalculate();
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-dcf-suggestions");
    if (!ul) return;
    if (!q || q.length < 1) {
      ul.hidden = true;
      ul.innerHTML = "";
      return;
    }
    try {
      const results = await searchStocks(q);
      const rows = Array.isArray(results) ? results.slice(0, 8) : [];
      if (!rows.length) {
        ul.hidden = true;
        ul.innerHTML = "";
        return;
      }
      ul.hidden = false;
      ul.innerHTML = rows
        .map((r) => {
          const sym = r.symbol || r.ticker;
          const name = r.description || r.name || "";
          return `<li><button type="button" data-dcf-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-dcf-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-dcf-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-dcf-back")?.addEventListener("click", () => {
      onNavigate?.(null);
    });

    document.getElementById("tools-dcf-load-btn")?.addEventListener("click", () => {
      const q = document.getElementById("tools-dcf-ticker-input")?.value || "";
      void loadTicker(q);
    });

    const input = document.getElementById("tools-dcf-ticker-input");
    input?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void renderSuggestions(input.value.trim()), 220);
    });
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("tools-dcf-suggestions").hidden = true;
        void loadTicker(input.value);
      }
    });

    document.getElementById("tools-dcf-reset-filings")?.addEventListener("click", resetToFilings);
    document.getElementById("tools-dcf-use-wacc-btn")?.addEventListener("click", applySavedWacc);
    document.getElementById("tools-dcf-open-wacc-btn")?.addEventListener("click", () => {
      if (ticker) onOpenWacc?.(ticker);
      else onOpenWacc?.(null);
    });

    ["tools-dcf-forecast-years", "tools-dcf-growth-method", "tools-dcf-terminal-method"].forEach(
      (id) => {
        document.getElementById(id)?.addEventListener("change", () => {
          if (id === "tools-dcf-forecast-years") renderYearRateInputs();
          syncMethodVisibility();
          scheduleCalculate();
        });
      }
    );

    [
      "tools-dcf-wacc",
      "tools-dcf-terminal-growth",
      "tools-dcf-exit-multiple",
      "tools-dcf-fcf-margin-current",
      "tools-dcf-fcf-margin-terminal",
      "tools-dcf-sens-wacc",
      "tools-dcf-sens-g",
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", scheduleCalculate);
    });

    document.querySelectorAll("[data-dcf-scenario]").forEach((inp) => {
      inp.addEventListener("input", scheduleCalculate);
    });

    document.getElementById("tools-dcf-constant-growth-btn")?.addEventListener("click", () => {
      const row = document.getElementById("tools-dcf-constant-growth-row");
      if (row) row.hidden = !row.hidden;
    });

    document.getElementById("tools-dcf-apply-constant-growth")?.addEventListener("click", () => {
      const g = parseNum(document.getElementById("tools-dcf-constant-growth")?.value) ?? 8;
      document.querySelectorAll('[data-dcf-rate="fcf"]').forEach((inp) => {
        inp.value = String(g);
      });
      scheduleCalculate();
    });

    renderYearRateInputs();
    syncMethodVisibility();
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
  };
}
