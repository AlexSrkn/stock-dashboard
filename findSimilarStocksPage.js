/**
 * Tools → Find Similar Stocks UI.
 */

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

function formatScore(n) {
  if (!finite(n)) return "—";
  return `${Math.round(n)}%`;
}

function formatCount(n) {
  if (!finite(n)) return "—";
  return n.toLocaleString();
}

export function createFindSimilarStocksController(deps) {
  const { searchStocks, onNavigateToHub } = deps;

  let bound = false;
  let ticker = "";
  let companyName = "";
  let payload = null;
  let expanded = new Set();
  let searchTimer = 0;
  let requestId = 0;

  function setStatus(msg, isError = false) {
    const el = document.getElementById("tools-similar-load-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.style.color = isError ? "#f87171" : "";
  }

  function readFilters() {
    return {
      minScore: document.getElementById("tools-similar-min-score")?.value || "0",
      sector: document.getElementById("tools-similar-sector")?.value || "",
      marketCap: document.getElementById("tools-similar-market-cap")?.value || "",
      minSharedHolders: document.getElementById("tools-similar-min-holders")?.value || "1",
      requireInsider: document.getElementById("tools-similar-require-insider")?.checked
        ? "1"
        : "0",
      requirePolitician: document.getElementById("tools-similar-require-politician")?.checked
        ? "1"
        : "0",
      requireSignals: document.getElementById("tools-similar-require-signals")?.checked
        ? "1"
        : "0",
      sort: document.getElementById("tools-similar-sort")?.value || "similarity",
      limit: "50",
    };
  }

  function populateSectors(sectors) {
    const sel = document.getElementById("tools-similar-sector");
    if (!sel) return;
    const current = sel.value;
    const options = [`<option value="">All sectors</option>`].concat(
      (sectors || []).map(
        (s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
      )
    );
    sel.innerHTML = options.join("");
    if (current && (sectors || []).includes(current)) sel.value = current;
  }

  function componentBars(components) {
    const entries = [
      ["Institutional Profile", components?.institutional_profile],
      ["Institutional Holder Overlap", components?.institutional_holder_overlap],
      ["Institutional Activity", components?.institutional_activity],
      ["Insider Activity", components?.insider_activity],
      ["Politician Activity", components?.politician_activity],
      ["Signals", components?.signals],
    ];
    return `<div class="tools-similar-breakdown">
      ${entries
        .map(([label, score]) => {
          const pct = finite(score) ? Math.max(0, Math.min(100, score)) : 0;
          return `<div class="tools-similar-breakdown__row">
            <div class="tools-similar-breakdown__label">${escapeHtml(label)}</div>
            <div class="tools-similar-breakdown__track"><span style="width:${pct}%"></span></div>
            <div class="tools-similar-breakdown__score mono">${formatScore(score)}</div>
          </div>`;
        })
        .join("")}
    </div>`;
  }

  function detailHtml(row) {
    const institutions = (row.shared_institutions || [])
      .map((i) => `<li>${escapeHtml(i.name)}</li>`)
      .join("");
    const signals = (row.matching_signals || [])
      .map((s) => `<li>${escapeHtml(s)}</li>`)
      .join("");
    const insider = (row.matching_insider_metrics || [])
      .map((s) => `<li>${escapeHtml(s)}</li>`)
      .join("");
    const politician = (row.matching_politician_metrics || [])
      .map((s) => `<li>${escapeHtml(s)}</li>`)
      .join("");

    return `<div class="tools-similar-detail">
      <h4 class="institution-hub__section-label">Similarity breakdown</h4>
      ${componentBars(row.components)}
      <div class="tools-similar-detail__grid">
        <div>
          <h4 class="institution-hub__section-label">Shared institutional holders</h4>
          ${
            institutions
              ? `<ul class="tools-similar-list">${institutions}</ul>`
              : `<p class="muted small">Not available</p>`
          }
        </div>
        <div>
          <h4 class="institution-hub__section-label">Matching signals</h4>
          ${
            signals
              ? `<ul class="tools-similar-list">${signals}</ul>`
              : `<p class="muted small">No overlapping active signals</p>`
          }
          <h4 class="institution-hub__section-label">Matching insider metrics</h4>
          ${
            insider
              ? `<ul class="tools-similar-list">${insider}</ul>`
              : `<p class="muted small">Not available</p>`
          }
          <h4 class="institution-hub__section-label">Matching politician metrics</h4>
          ${
            politician
              ? `<ul class="tools-similar-list">${politician}</ul>`
              : `<p class="muted small">Not available</p>`
          }
        </div>
      </div>
    </div>`;
  }

  function renderResults() {
    const host = document.getElementById("tools-similar-results");
    const empty = document.getElementById("tools-similar-empty");
    if (!host) return;
    const rows = payload?.results || [];
    if (!rows.length) {
      host.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = ticker
          ? "No similar stocks matched the current filters."
          : "Search for a stock to find similar filing profiles.";
      }
      return;
    }
    if (empty) empty.hidden = true;

    host.innerHTML = rows
      .map((row) => {
        const open = expanded.has(row.ticker);
        const reasons = (row.reasons || [])
          .map((r) => `<li>${escapeHtml(r)}</li>`)
          .join("");
        return `<article class="tools-similar-card" data-similar-ticker="${escapeHtml(row.ticker)}">
          <button type="button" class="tools-similar-card__head" data-similar-expand="${escapeHtml(row.ticker)}" aria-expanded="${open}">
            <div>
              <div class="tools-similar-card__ticker mono">${escapeHtml(row.ticker)}</div>
              <div class="muted small">${escapeHtml(row.company_name || "")}</div>
            </div>
            <div class="tools-similar-card__score mono">${formatScore(row.similarity_score)}</div>
          </button>
          <ul class="tools-similar-reasons">${reasons}</ul>
          <div class="tools-similar-card__meta muted small">
            Shared holders ${formatCount(row.shared_holder_count)}
            · Overlap ${formatScore(row.overlap_percentage)}
            · Discovery ${formatScore(row.institutional_discovery_score)}
            · Conviction ${formatScore(row.conviction_score)}
          </div>
          ${open ? detailHtml(row) : ""}
        </article>`;
      })
      .join("");

    host.querySelectorAll("[data-similar-expand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sym = btn.getAttribute("data-similar-expand");
        if (!sym) return;
        if (expanded.has(sym)) expanded.delete(sym);
        else expanded.add(sym);
        renderResults();
      });
    });
  }

  function renderTarget() {
    const el = document.getElementById("tools-similar-target");
    if (!el || !payload?.target) {
      if (el) el.textContent = "No stock selected";
      return;
    }
    const t = payload.target;
    el.innerHTML = `<strong class="mono">${escapeHtml(t.ticker)}</strong>
      <span class="muted">${escapeHtml(t.company_name || companyName || "")}</span>
      <span class="muted small">· ${formatCount(t.holder_count)} institutional holders
      · Discovery ${formatScore(t.institutional_discovery_score)}</span>`;
  }

  async function loadTicker(sym) {
    const tickerUp = String(sym || "").trim().toUpperCase();
    if (!tickerUp) {
      setStatus("Enter a valid ticker.", true);
      return;
    }
    const filters = readFilters();
    const params = new URLSearchParams(filters);
    setStatus(`Finding stocks similar to ${tickerUp}…`);
    const workspace = document.getElementById("tools-similar-workspace");
    const myId = ++requestId;
    try {
      const res = await fetch(
        `/api/tools/similar-stocks/${encodeURIComponent(tickerUp)}?${params.toString()}`
      );
      const data = await res.json();
      if (myId !== requestId) return;
      if (!res.ok) throw new Error(data.message || data.error || res.statusText);
      ticker = data.target?.ticker || tickerUp;
      companyName = data.target?.company_name || "";
      payload = data;
      expanded = new Set();
      const input = document.getElementById("tools-similar-ticker-input");
      if (input) input.value = ticker;
      if (workspace) workspace.hidden = false;
      populateSectors(data.sectors || []);
      renderTarget();
      renderResults();
      setStatus(
        `Found ${data.results?.length || 0} similar stocks from ${data.total_candidates || 0} overlap candidates.`
      );
    } catch (err) {
      if (myId !== requestId) return;
      payload = null;
      if (workspace) workspace.hidden = true;
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  }

  async function renderSuggestions(q) {
    const ul = document.getElementById("tools-similar-suggestions");
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
          return `<li><button type="button" data-similar-pick="${escapeHtml(sym)}"><span class="mono">${escapeHtml(sym)}</span><span class="muted">${escapeHtml(name)}</span></button></li>`;
        })
        .join("");
      ul.querySelectorAll("[data-similar-pick]").forEach((btn) => {
        btn.addEventListener("click", () => {
          ul.hidden = true;
          void loadTicker(btn.getAttribute("data-similar-pick"));
        });
      });
    } catch {
      ul.hidden = true;
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.getElementById("tools-similar-back")?.addEventListener("click", () =>
      onNavigateToHub?.()
    );
    document.getElementById("tools-similar-load-btn")?.addEventListener("click", () => {
      void loadTicker(document.getElementById("tools-similar-ticker-input")?.value || "");
    });
    const searchInput = document.getElementById("tools-similar-ticker-input");
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
        const ul = document.getElementById("tools-similar-suggestions");
        if (ul) ul.hidden = true;
        void loadTicker(searchInput.value);
      }
    });

    [
      "tools-similar-min-score",
      "tools-similar-sector",
      "tools-similar-market-cap",
      "tools-similar-min-holders",
      "tools-similar-sort",
      "tools-similar-require-insider",
      "tools-similar-require-politician",
      "tools-similar-require-signals",
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        if (ticker) void loadTicker(ticker);
      });
    });
  }

  return {
    bind,
    loadTicker,
    getTicker: () => ticker,
  };
}
