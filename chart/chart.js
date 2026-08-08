import { SeriesManager } from "./seriesManager.js";
import { MarkerLayer } from "./markers.js";
import { DrawingLayer } from "./drawings.js";

/**
 * Orchestrates compare series, event markers, and drawing overlays.
 * Chart initialization (LWC instance) stays in app.js; this module owns extensions.
 */
export class ChartExtensions {
  /**
   * @param {object} deps
   * @param {(symbol: string, range: string) => Promise<object | null>} deps.fetchCandles
   * @param {() => string} deps.getActiveRange
   * @param {() => string | null} deps.getPrimarySymbol
   * @param {() => Array<{ time: number; value: number }>} deps.getPrimaryLineData
   * @param {() => import('lightweight-charts').ISeriesApi | null} deps.getMainSeries
   * @param {() => import('lightweight-charts').IChartApi | null} deps.getChart
   * @param {(enabled: boolean) => void} [deps.onPercentModeChange]
   */
  constructor(deps) {
    this.deps = deps;
    this.wrapEl = document.querySelector(".chart-wrap");
    this.legendEl = document.getElementById("chart-compare-legend");

    this.seriesManager = new SeriesManager({
      chart: null,
      fetchCandles: deps.fetchCandles,
      getActiveRange: deps.getActiveRange,
      onLegendChange: () => this.renderLegend(),
      getMainSeries: deps.getMainSeries,
      getPrimaryLineData: deps.getPrimaryLineData,
      getPrimarySymbol: deps.getPrimarySymbol,
    });

    this.markerLayer = new MarkerLayer({
      getMarkerSeries: deps.getMainSeries,
      createSeriesMarkers: null,
    });

    this.drawingLayer = new DrawingLayer({
      wrapEl: this.wrapEl,
      getChart: deps.getChart,
      getSeries: deps.getMainSeries,
      getSymbol: deps.getPrimarySymbol,
    });

    /** @type {(() => void) | null} */
    this.unsubDrawings = null;
    /** @type {object | null} */
    this.lastSecPayload = null;
    /** @type {object | null} */
    this.lastInsiderPayload = null;
  }

  /**
   * @param {object} ctx
   * @param {import('lightweight-charts').IChartApi} ctx.chart
   * @param {import('lightweight-charts').ISeriesApi} ctx.mainSeries
   * @param {typeof import('lightweight-charts').LineSeries} ctx.LineSeries
   * @param {typeof import('lightweight-charts').createSeriesMarkers} ctx.createSeriesMarkers
   * @param {Array<{ time: number }>} ctx.candleData
   * @param {string | null} ctx.symbol
   */
  onChartReady(ctx) {
    const { chart, mainSeries, LineSeries, createSeriesMarkers, candleData, symbol } = ctx;

    this.seriesManager.setChart(chart);
    this.seriesManager.setLineSeriesCtor(LineSeries);
    this.markerLayer.createSeriesMarkers = createSeriesMarkers;
    this.markerLayer.attachToSeries(mainSeries);
    this.markerLayer.setVisibleTimes(candleData.map((b) => b.time));

    if (this.lastSecPayload) this.markerLayer.setEarningsFromSec(this.lastSecPayload);
    if (this.lastInsiderPayload) this.markerLayer.setInsiderFromApi(this.lastInsiderPayload);

    this.drawingLayer.loadForSymbol(symbol);
    if (this.unsubDrawings) this.unsubDrawings();
    this.unsubDrawings = this.drawingLayer.subscribeVisibleRange(chart);

    if (this.seriesManager.isPercentMode()) {
      this.seriesManager.refreshPrimaryDisplay();
    }

    this.renderLegend();
    requestAnimationFrame(() => this.drawingLayer.render());
  }

  onChartUpdate(candleData) {
    this.markerLayer.setVisibleTimes((candleData || []).map((b) => b.time));
    this.markerLayer.applyMarkers();
    this.seriesManager.refreshAllSeries();
    requestAnimationFrame(() => this.drawingLayer.render());
  }

  async onSymbolChange(symbol) {
    this.seriesManager.clearAll();
    this.drawingLayer.loadForSymbol(symbol);
    this.renderLegend();
  }

  async onRangeChange() {
    await this.seriesManager.reloadForRange();
    requestAnimationFrame(() => this.drawingLayer.render());
  }

  setSecPayload(payload) {
    this.lastSecPayload = payload;
    if (payload) this.markerLayer.setEarningsFromSec(payload);
  }

  setInsiderPayload(payload) {
    this.lastInsiderPayload = payload;
    if (payload) this.markerLayer.setInsiderFromApi(payload);
  }

  async addCompareSymbol(symbol) {
    const ok = await this.seriesManager.addSymbol(symbol);
    if (ok && this.seriesManager.chart?.timeScale) {
      this.seriesManager.chart.timeScale().fitContent();
    }
    return ok;
  }

  onChartDestroy() {
    if (this.unsubDrawings) {
      this.unsubDrawings();
      this.unsubDrawings = null;
    }
    this.seriesManager.setChart(null);
    this.markerLayer.detach();
  }

  removeCompareSymbol(symbol) {
    return this.seriesManager.removeSymbol(symbol);
  }

  setPercentMode(enabled) {
    const next = Boolean(enabled);
    if (next && this.deps.onPercentModeChange) {
      this.deps.onPercentModeChange(true);
    }
    this.seriesManager.setPercentMode(next);
  }

  setShowEarnings(show) {
    this.markerLayer.setShowEarnings(show);
  }

  setShowInsider(show) {
    this.markerLayer.setShowInsider(show);
  }

  setDrawingMode(mode) {
    this.drawingLayer.setMode(mode);
  }

  renderLegend() {
    if (!this.legendEl) return;
    const items = this.seriesManager.getLegendItems();
    const hasCompare = this.seriesManager.hasCompareSymbols();
    if (!hasCompare && !this.seriesManager.isPercentMode()) {
      this.legendEl.hidden = true;
      this.legendEl.innerHTML = "";
      return;
    }

    this.legendEl.hidden = false;
    this.legendEl.innerHTML = items
      .map((item) => {
        const pct =
          item.pctFromStart != null
            ? `${item.pctFromStart >= 0 ? "+" : ""}${item.pctFromStart.toFixed(2)}%`
            : "—";
        const price =
          item.latest != null
            ? item.percentMode
              ? `${item.latest.toFixed(2)}`
            : item.latest.toFixed(2)
            : "—";
        const swatch = item.color
          ? `<span class="chart-legend__swatch" style="background:${item.color}"></span>`
          : `<span class="chart-legend__swatch chart-legend__swatch--primary"></span>`;
        const removeBtn =
          !item.isPrimary && hasCompare
            ? `<button type="button" class="chart-legend__remove" data-remove-symbol="${item.symbol}" title="Remove">×</button>`
            : "";
        return `<div class="chart-legend__item">${swatch}<span class="chart-legend__sym mono">${item.symbol}</span><span class="chart-legend__price mono">${price}${item.percentMode ? "" : suffix}</span><span class="chart-legend__pct mono">${pct}</span>${removeBtn}</div>`;
      })
      .join("");
  }

  resize() {
    this.drawingLayer.render();
  }

  destroy() {
    if (this.unsubDrawings) {
      this.unsubDrawings();
      this.unsubDrawings = null;
    }
    this.seriesManager.destroy();
    this.markerLayer.destroy();
    this.drawingLayer.destroy();
    if (this.legendEl) {
      this.legendEl.hidden = true;
      this.legendEl.innerHTML = "";
    }
  }
}
