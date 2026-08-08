import { COMPARE_COLORS } from "./constants.js";

/**
 * Multi-symbol compare overlays and percent-mode normalization.
 */
export class SeriesManager {
  /**
   * @param {object} opts
   * @param {import('lightweight-charts').IChartApi | null} opts.chart
   * @param {(symbol: string, range: string) => Promise<object | null>} opts.fetchCandles
   * @param {() => string} opts.getActiveRange
   * @param {() => void} opts.onLegendChange
   * @param {() => import('lightweight-charts').ISeriesApi | null} opts.getMainSeries
   * @param {() => Array<{ time: number; value: number }>} opts.getPrimaryLineData
   * @param {() => string | null} opts.getPrimarySymbol
   */
  constructor(opts) {
    this.chart = opts.chart;
    this.fetchCandles = opts.fetchCandles;
    this.getActiveRange = opts.getActiveRange;
    this.onLegendChange = opts.onLegendChange;
    this.getMainSeries = opts.getMainSeries;
    this.getPrimaryLineData = opts.getPrimaryLineData;
    this.getPrimarySymbol = opts.getPrimarySymbol;
    /** @type {typeof import('lightweight-charts').LineSeries | null} */
    this.LineSeries = null;
    this.percentMode = false;
    /** @type {Map<string, { series: import('lightweight-charts').ISeriesApi<'Line'>, color: string, rawLineData: Array<{ time: number; value: number }>, currency: string }>} */
    this.compareEntries = new Map();
    this.colorIndex = 0;
  }

  setChart(chart) {
    this.chart = chart;
  }

  setLineSeriesCtor(LineSeries) {
    this.LineSeries = LineSeries;
  }

  hasCompareSymbols() {
    return this.compareEntries.size > 0;
  }

  isPercentMode() {
    return this.percentMode;
  }

  setPercentMode(enabled) {
    this.percentMode = Boolean(enabled);
    this.refreshAllSeries();
    this.onLegendChange();
  }

  /** @returns {string[]} */
  getCompareSymbols() {
    return [...this.compareEntries.keys()];
  }

  normalizeLineData(lineData) {
    const first = lineData.find((p) => Number.isFinite(p.value));
    if (!first || first.value === 0) return lineData;
    const base = first.value;
    return lineData.map((p) => ({
      time: p.time,
      value: Number.isFinite(p.value) ? (p.value / base) * 100 : p.value,
    }));
  }

  applyDisplayData(series, rawLineData) {
    const data = this.percentMode ? this.normalizeLineData(rawLineData) : rawLineData;
    series.setData(data);
  }

  getLegendItems() {
    const items = [];
    const primarySym = this.getPrimarySymbol();
    const primaryData = this.getPrimaryLineData();
    if (primarySym && primaryData.length) {
      items.push(this.buildLegendItem(primarySym, primaryData, true));
    }
    for (const [symbol, entry] of this.compareEntries) {
      items.push(this.buildLegendItem(symbol, entry.rawLineData, false, entry.color));
    }
    return items;
  }

  buildLegendItem(symbol, rawLineData, isPrimary, color = null) {
    const displayData = this.percentMode ? this.normalizeLineData(rawLineData) : rawLineData;
    const valid = displayData.filter((p) => Number.isFinite(p.value));
    const first = valid[0]?.value;
    const last = valid[valid.length - 1]?.value;
    const pctFromStart =
      Number.isFinite(first) && first !== 0 && Number.isFinite(last)
        ? ((last - first) / first) * 100
        : null;
    return {
      symbol,
      isPrimary,
      color,
      latest: last,
      pctFromStart,
      percentMode: this.percentMode,
    };
  }

  async addSymbol(symbol) {
    const sym = String(symbol || "")
      .trim()
      .toUpperCase();
    if (!sym || !this.chart || !this.LineSeries) return false;
    if (sym === this.getPrimarySymbol()?.toUpperCase()) return false;
    if (this.compareEntries.has(sym)) return false;

    const range = this.getActiveRange();
    const payload = await this.fetchCandles(sym, range);
    if (!payload?.candleData?.length) return false;

    const rawLineData = payload.candleData.map((b) => ({ time: b.time, value: b.close }));
    const color = COMPARE_COLORS[this.colorIndex % COMPARE_COLORS.length];
    this.colorIndex += 1;

    const series = this.chart.addSeries(this.LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    this.applyDisplayData(series, rawLineData);

    this.compareEntries.set(sym, {
      series,
      color,
      rawLineData,
      currency: payload.currency || "USD",
    });
    this.chart.timeScale().fitContent();
    this.onLegendChange();
    return true;
  }

  removeSymbol(symbol) {
    const sym = String(symbol || "").toUpperCase();
    const entry = this.compareEntries.get(sym);
    if (!entry || !this.chart) return false;
    this.chart.removeSeries(entry.series);
    this.compareEntries.delete(sym);
    this.onLegendChange();
    return true;
  }

  clearAll() {
    for (const sym of [...this.compareEntries.keys()]) {
      this.removeSymbol(sym);
    }
  }

  refreshPrimaryDisplay() {
    if (!this.percentMode) return;
    const main = this.getMainSeries();
    const lineData = this.getPrimaryLineData();
    if (!main || !lineData.length) return;
    main.setData(this.normalizeLineData(lineData));
  }

  refreshAllSeries() {
    if (this.percentMode) {
      this.refreshPrimaryDisplay();
    } else {
      const main = this.getMainSeries();
      const lineData = this.getPrimaryLineData();
      if (main && lineData.length) main.setData(lineData);
    }
    for (const entry of this.compareEntries.values()) {
      this.applyDisplayData(entry.series, entry.rawLineData);
    }
    this.onLegendChange();
  }

  async reloadForRange() {
    const range = this.getActiveRange();
    const tasks = [...this.compareEntries.entries()].map(async ([sym, entry]) => {
      const payload = await this.fetchCandles(sym, range);
      if (!payload?.candleData?.length) return;
      entry.rawLineData = payload.candleData.map((b) => ({ time: b.time, value: b.close }));
      this.applyDisplayData(entry.series, entry.rawLineData);
    });
    await Promise.all(tasks);
    this.refreshPrimaryDisplay();
    this.onLegendChange();
    if (this.chart) this.chart.timeScale().fitContent();
  }

  destroy() {
    this.clearAll();
    this.chart = null;
    this.LineSeries = null;
    this.percentMode = false;
    this.colorIndex = 0;
  }
}
