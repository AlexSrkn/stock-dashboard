import { EARNINGS_MARKER_COLORS, INSIDER_MARKER_COLORS } from "./constants.js";

/** @typedef {'beat' | 'miss' | 'inline'} EarningsResult */

/**
 * Earnings + insider event markers for the price chart.
 */
export class MarkerLayer {
  /**
   * @param {object} opts
   * @param {() => import('lightweight-charts').ISeriesApi | null} opts.getMarkerSeries
   * @param {typeof import('lightweight-charts').createSeriesMarkers} opts.createSeriesMarkers
   */
  constructor(opts) {
    this.getMarkerSeries = opts.getMarkerSeries;
    this.createSeriesMarkers = opts.createSeriesMarkers;
    /** @type {import('lightweight-charts').ISeriesMarkersPluginApi | null} */
    this.markersApi = null;
    this.showEarnings = false;
    this.showInsider = false;
    /** @type {Array<{ time: number; result: EarningsResult; text: string }>} */
    this.earningsEvents = [];
    /** @type {Array<{ time: number; side: 'buy' | 'sell'; text: string }>} */
    this.insiderEvents = [];
    /** @type {Set<number>} */
    this.visibleTimes = new Set();
  }

  setVisibleTimes(times) {
    this.visibleTimes = new Set(times);
  }

  setShowEarnings(show) {
    this.showEarnings = Boolean(show);
    this.applyMarkers();
  }

  setShowInsider(show) {
    this.showInsider = Boolean(show);
    this.applyMarkers();
  }

  /**
   * @param {object} secPayload
   * @param {Array<{ form: string; filingDate: string; description?: string }>} secPayload.filings
   */
  setEarningsFromSec(secPayload) {
    const filings = secPayload?.filings || [];
    this.earningsEvents = filings
      .filter((f) => isEarningsFiling(f))
      .map((f) => ({
        time: dateToChartTime(f.filingDate),
        result: classifyEarningsResult(f.description || ""),
        text: formatEarningsLabel(f),
      }))
      .filter((e) => e.time != null);
    this.applyMarkers();
  }

  /**
   * @param {object} insiderPayload
   * @param {Array<{ transactionDate: string | null; transactionCode: string; insiderName: string }>} insiderPayload.transactions
   */
  setInsiderFromApi(insiderPayload) {
    const rows = insiderPayload?.transactions || [];
    this.insiderEvents = rows
      .map((row) => {
        const side = insiderSide(row.transactionCode);
        if (!side) return null;
        const time = dateToChartTime(row.transactionDate);
        if (time == null) return null;
        return {
          time,
          side,
          text: `${side === "buy" ? "Buy" : "Sell"}: ${row.insiderName || "Insider"}`,
        };
      })
      .filter(Boolean);
    this.applyMarkers();
  }

  attachToSeries(series) {
    if (!series) return;
    if (this.markersApi) {
      this.markersApi.detach();
      this.markersApi = null;
    }
    this.markersApi = this.createSeriesMarkers(series, []);
    this.applyMarkers();
  }

  detach() {
    if (this.markersApi) {
      this.markersApi.detach();
      this.markersApi = null;
    }
  }

  applyMarkers() {
    if (!this.markersApi) return;
    const markers = [];

    if (this.showEarnings) {
      for (const event of this.earningsEvents) {
        if (this.visibleTimes.size && !timeInVisibleSet(event.time, this.visibleTimes)) continue;
        const color =
          event.result === "beat"
            ? EARNINGS_MARKER_COLORS.beat
            : event.result === "miss"
              ? EARNINGS_MARKER_COLORS.miss
              : EARNINGS_MARKER_COLORS.inline;
        markers.push({
          time: event.time,
          position: "aboveBar",
          color,
          shape: "circle",
          text: event.text,
        });
      }
    }

    if (this.showInsider) {
      for (const event of this.insiderEvents) {
        if (this.visibleTimes.size && !timeInVisibleSet(event.time, this.visibleTimes)) continue;
        markers.push({
          time: event.time,
          position: event.side === "buy" ? "belowBar" : "aboveBar",
          color: event.side === "buy" ? INSIDER_MARKER_COLORS.buy : INSIDER_MARKER_COLORS.sell,
          shape: event.side === "buy" ? "arrowUp" : "arrowDown",
          text: event.text,
        });
      }
    }

    markers.sort((a, b) => {
      const ta = typeof a.time === "number" ? a.time : 0;
      const tb = typeof b.time === "number" ? b.time : 0;
      return ta - tb;
    });

    this.markersApi.setMarkers(markers);
  }

  destroy() {
    this.detach();
    this.earningsEvents = [];
    this.insiderEvents = [];
  }
}

function isEarningsFiling(filing) {
  const form = String(filing.form || "").toUpperCase();
  const desc = String(filing.description || "").toLowerCase();
  if (form !== "8-K") return false;
  return (
    desc.includes("results of operations") ||
    desc.includes("financial results") ||
    desc.includes("earnings") ||
    desc.includes("item 2.02")
  );
}

/** @returns {EarningsResult} */
function classifyEarningsResult(description) {
  const d = String(description || "").toLowerCase();
  if (/\b(beat|exceed|above|surpass|strong)\b/.test(d)) return "beat";
  if (/\b(miss|below|short|disappoint|weak)\b/.test(d)) return "miss";
  return "inline";
}

function formatEarningsLabel(filing) {
  const result = classifyEarningsResult(filing.description || "");
  const label =
    result === "beat" ? "Earnings Beat" : result === "miss" ? "Earnings Miss" : "Earnings";
  return filing.filingDate ? `${label} (${filing.filingDate})` : label;
}

function insiderSide(code) {
  const c = String(code || "").toUpperCase();
  if (c === "P") return "buy";
  if (c === "S") return "sell";
  return null;
}

function dateToChartTime(dateStr) {
  if (!dateStr) return null;
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  const ts = Math.floor(d.getTime() / 1000);
  return Number.isFinite(ts) ? ts : null;
}

function timeInVisibleSet(time, visibleSet) {
  if (visibleSet.has(time)) return true;
  const day = new Date(time * 1000).toISOString().slice(0, 10);
  for (const t of visibleSet) {
    if (new Date(t * 1000).toISOString().slice(0, 10) === day) return true;
  }
  return false;
}
