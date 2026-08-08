import { MARKET_OVERVIEW } from "./marketOverview.js";
import { buildSparklineSvg as renderSparkline } from "./sparkline.js";

let marketStripTimer = null;
/** @type {(() => void) | null} */
let updateMarketStripScrollBtn = null;

function formatMarketPrice(n, currency = "USD") {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const code = currency || "USD";
  const abs = Math.abs(x);
  let fractionDigits = 2;
  if (code === "JPY" || abs >= 10_000) fractionDigits = 0;
  else if (abs >= 1000) fractionDigits = 2;
  else if (abs < 10) fractionDigits = 2;
  try {
    return x.toLocaleString(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return `${x.toFixed(fractionDigits)} ${code}`;
  }
}

function formatMarketChange(pct) {
  const x = Number(pct);
  if (!Number.isFinite(x)) return "—";
  const sign = x >= 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}%`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function marketSparkline(points, up) {
  return renderSparkline(points, up, { className: "market-strip__spark" });
}

function renderMarketItem(def, row) {
  if (!row || row.error || row.price == null) {
    return `
      <div class="market-strip__item market-strip__item--error" title="${escapeHtml(def.label)}">
        <div class="market-strip__col">
          <span class="market-strip__name">${escapeHtml(def.shortLabel)}</span>
          ${marketSparkline([], true)}
        </div>
        <div class="market-strip__quote">
          <span class="market-strip__price mono">—</span>
          <span class="market-strip__chg muted">—</span>
        </div>
      </div>
    `;
  }

  const up = Number(row.changePct) >= 0;
  const trendClass = up ? "market-strip__item--up" : "market-strip__item--down";
  const chgClass = up ? "market-strip__chg--up" : "market-strip__chg--down";

  return `
    <div class="market-strip__item ${trendClass}" title="${escapeHtml(def.label)} · ${escapeHtml(row.symbol)}">
      <div class="market-strip__col">
        <span class="market-strip__name">${escapeHtml(def.shortLabel)}</span>
        ${marketSparkline(row.sparkline, up)}
      </div>
      <div class="market-strip__quote">
        <span class="market-strip__price mono">${escapeHtml(formatMarketPrice(row.price, row.currency))}</span>
        <span class="market-strip__chg ${chgClass} mono">${escapeHtml(formatMarketChange(row.changePct))}</span>
      </div>
    </div>
  `;
}

function renderMarketStripSkeleton() {
  const track = document.getElementById("market-strip-track");
  if (!track) return;
  track.innerHTML = MARKET_OVERVIEW.map(
    (item) => `
    <div class="market-strip__item market-strip__item--loading" aria-busy="true">
      <div class="market-strip__col">
        <span class="market-strip__name">${escapeHtml(item.shortLabel)}</span>
        ${marketSparkline([], true)}
      </div>
      <div class="market-strip__quote">
        <span class="market-strip__price mono">—</span>
        <span class="market-strip__chg">—</span>
      </div>
    </div>
  `
  ).join("");
}

function renderMarketStripItems(items) {
  const track = document.getElementById("market-strip-track");
  if (!track) return;
  const byRequest = new Map(
    (items || []).map((row) => [row.requestSymbol || row.symbol, row])
  );

  track.innerHTML = MARKET_OVERVIEW.map((def) => {
    const row = byRequest.get(def.symbol);
    return renderMarketItem(def, row);
  }).join("");
  requestAnimationFrame(() => updateMarketStripScrollBtn?.());
}

async function refreshMarketStrip() {
  const track = document.getElementById("market-strip-track");
  if (!track) return;
  try {
    const res = await fetch("/api/yahoo/market-overview", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || `HTTP ${res.status}`);
    }
    renderMarketStripItems(Array.isArray(data?.markets) ? data.markets : []);
  } catch (err) {
    console.warn("Market overview:", err);
    renderMarketStripItems(
      MARKET_OVERVIEW.map((item) => ({ requestSymbol: item.symbol, symbol: item.symbol, error: true }))
    );
  }
}

export function initMarketStrip() {
  const track = document.getElementById("market-strip-track");
  if (!track) return;
  renderMarketStripSkeleton();
  setupMarketStripScroll();
  void refreshMarketStrip();
  if (marketStripTimer) clearInterval(marketStripTimer);
  marketStripTimer = setInterval(() => {
    if (document.visibilityState === "visible") void refreshMarketStrip();
  }, 60_000);
}

function setupMarketStripScroll() {
  const strip = document.getElementById("market-strip");
  const btnLeft = document.getElementById("market-strip-scroll-left");
  const btnRight = document.getElementById("market-strip-scroll-right");
  if (!strip || !btnLeft || !btnRight) return;

  const updateScrollBtn = () => {
    const canScroll = strip.scrollWidth - strip.clientWidth > 4;
    const atStart = strip.scrollLeft <= 4;
    const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 4;
    btnLeft.hidden = !canScroll || atStart;
    btnRight.hidden = !canScroll || atEnd;
  };

  updateMarketStripScrollBtn = updateScrollBtn;

  btnLeft.addEventListener("click", () => {
    strip.scrollBy({ left: -strip.clientWidth * 0.65, behavior: "smooth" });
  });

  btnRight.addEventListener("click", () => {
    strip.scrollBy({ left: strip.clientWidth * 0.65, behavior: "smooth" });
  });

  strip.addEventListener("scroll", updateScrollBtn, { passive: true });
  window.addEventListener("resize", updateScrollBtn);
  updateScrollBtn();
}
