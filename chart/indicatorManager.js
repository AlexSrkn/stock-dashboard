import {
  computeEma,
  computeRsi,
  computeMacd,
  computeVwap,
  computeAtr,
  computeBollinger,
  computeVolumeProfile,
  plotPoints,
} from "../indicators/index.js";

/** @typedef {'ema20'|'ema50'|'ema200'|'rsi'|'macd'|'vwap'|'atr'|'bb'|'volumeProfile'} IndicatorType */

export const INDICATOR_TYPES = /** @type {const} */ ([
  "ema20",
  "ema50",
  "ema200",
  "rsi",
  "macd",
  "vwap",
  "atr",
  "bb",
  "volumeProfile",
]);

const EMA_PERIODS = { ema20: 20, ema50: 50, ema200: 200 };

const COLORS = {
  ema20: "#60a5fa",
  ema50: "#fb923c",
  ema200: "#c084fc",
  vwap: "#e879f9",
  atr: "#fbbf24",
  bbUpper: "rgba(129, 140, 248, 0.85)",
  bbMiddle: "rgba(99, 102, 241, 0.65)",
  bbLower: "rgba(129, 140, 248, 0.85)",
  rsi: "#a78bfa",
  macdLine: "#3b82f6",
  macdSignal: "#f59e0b",
  macdUp: "rgba(62, 230, 176, 0.55)",
  macdDown: "rgba(255, 107, 122, 0.55)",
  vpBar: "rgba(91, 156, 255, 0.35)",
};

const RSI_SCALE = "indicator-rsi";
const MACD_SCALE = "indicator-macd";

/**
 * Computes, caches, and renders technical indicator overlays.
 * Pure indicator math lives in /indicators; this class owns chart series only.
 */
export class IndicatorManager {
  constructor() {
    /** @type {Set<IndicatorType>} */
    this.active = new Set();
    /** @type {import('lightweight-charts').IChartApi | null} */
    this.chart = null;
    /** @type {import('lightweight-charts').ISeriesApi | null} */
    this.mainSeries = null;
    /** @type {typeof import('lightweight-charts').LineSeries | null} */
    this.LineSeries = null;
    /** @type {typeof import('lightweight-charts').HistogramSeries | null} */
    this.HistogramSeries = null;
    /** @type {boolean} */
    this.showVolume = false;
    /** @type {Map<string, import('lightweight-charts').ISeriesApi>} */
    this.seriesByKey = new Map();
    /** @type {string | null} */
    this.cacheKey = null;
    /** @type {Map<string, unknown>} */
    this.computed = new Map();
    /** @type {Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>} */
    this.sourceCandles = [];
    /** @type {Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>} */
    this.displayCandles = [];
    /** @type {SVGElement | null} */
    this.vpSvg = null;
    this.vpUnsub = null;
  }

  /** @param {IndicatorType} type */
  isActive(type) {
    return this.active.has(type);
  }

  /** @param {IndicatorType} type @param {boolean} enabled */
  setActive(type, enabled) {
    const next = Boolean(enabled);
    if (next) this.active.add(type);
    else this.active.delete(type);
    if (this.chart) this.applyAll();
  }

  /** @returns {IndicatorType[]} */
  getActiveList() {
    return [...this.active];
  }

  /**
   * @param {object} ctx
   * @param {import('lightweight-charts').IChartApi} ctx.chart
   * @param {import('lightweight-charts').ISeriesApi} ctx.mainSeries
   * @param {typeof import('lightweight-charts').LineSeries} ctx.LineSeries
   * @param {typeof import('lightweight-charts').HistogramSeries} ctx.HistogramSeries
   * @param {boolean} [ctx.showVolume]
   */
  onChartReady(ctx) {
    this.chart = ctx.chart;
    this.mainSeries = ctx.mainSeries;
    this.LineSeries = ctx.LineSeries;
    this.HistogramSeries = ctx.HistogramSeries;
    this.showVolume = Boolean(ctx.showVolume);
    this.ensureVolumeProfileOverlay();
    if (this.vpUnsub) this.vpUnsub();
    this.vpUnsub = this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      this.renderVolumeProfile();
    });
    this.applyAll();
  }

  onChartDestroy() {
    if (this.vpUnsub) {
      try {
        this.chart?.timeScale().unsubscribeVisibleLogicalRangeChange(this.vpUnsub);
      } catch {
        /* chart removed */
      }
      this.vpUnsub = null;
    }
    this.seriesByKey.clear();
    this.chart = null;
    this.mainSeries = null;
    this.LineSeries = null;
    this.HistogramSeries = null;
    if (this.vpSvg) {
      this.vpSvg.innerHTML = "";
      this.vpSvg.hidden = true;
    }
  }

  /**
   * @param {Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>} sourceCandles
   * @param {Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>} displayCandles
   * @param {boolean} [showVolume]
   */
  update(sourceCandles, displayCandles, showVolume = this.showVolume) {
    this.showVolume = showVolume;
    const key = buildCacheKey(sourceCandles, displayCandles);
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.computed.clear();
    }
    this.sourceCandles = sourceCandles;
    this.displayCandles = displayCandles;
    if (this.chart) this.applyAll();
  }

  invalidateCache() {
    this.cacheKey = null;
    this.computed.clear();
  }

  applyAll() {
    if (!this.chart || !this.LineSeries) return;

    this.applyScaleMargins();

    for (const type of INDICATOR_TYPES) {
      if (type === "volumeProfile") {
        this.renderVolumeProfile();
        continue;
      }
      if (type === "macd") {
        this.applyMacd();
        continue;
      }
      if (type === "bb") {
        this.applyBollinger();
        continue;
      }
      this.applyLineIndicator(type);
    }
  }

  applyScaleMargins() {
    if (!this.chart || !this.mainSeries) return;
    const hasRsi = this.active.has("rsi");
    const hasMacd = this.active.has("macd");
    if (!hasRsi && !hasMacd) return;
    let bottomMain = this.showVolume ? 0.28 : 0.05;
    if (hasRsi && hasMacd) bottomMain = Math.max(bottomMain, 0.42);
    else if (hasRsi || hasMacd) bottomMain = Math.max(bottomMain, 0.28);

    this.mainSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.08, bottom: bottomMain },
    });

    if (hasRsi) {
      this.chart.priceScale(RSI_SCALE).applyOptions({
        scaleMargins: {
          top: hasMacd ? 0.72 : 0.78,
          bottom: hasMacd ? 0.14 : this.showVolume ? 0.06 : 0.02,
        },
      });
    }
    if (hasMacd) {
      this.chart.priceScale(MACD_SCALE).applyOptions({
        scaleMargins: { top: 0.86, bottom: this.showVolume ? 0.06 : 0.02 },
      });
    }
  }

  /** @param {IndicatorType} type */
  applyLineIndicator(type) {
    const active = this.active.has(type);
    const lineKey = seriesKey(type);

    if (type === "rsi") {
      const data = active ? plotPoints(this.trimToDisplay(this.getRsi())) : [];
      const series = this.ensureLineSeries(lineKey, {
        color: COLORS.rsi,
        priceScaleId: RSI_SCALE,
        lineWidth: 1.5,
      });
      series.applyOptions({ visible: active });
      series.setData(data);
      return;
    }

    if (type === "atr") {
      const data = active ? plotPoints(this.trimToDisplay(this.getAtr())) : [];
      const series = this.ensureLineSeries(lineKey, {
        color: COLORS.atr,
        lineWidth: 1,
        lineStyle: 2,
      });
      series.applyOptions({ visible: active });
      series.setData(data);
      return;
    }

    if (type.startsWith("ema")) {
      const data = active ? plotPoints(this.trimToDisplay(this.getEma(type))) : [];
      const series = this.ensureLineSeries(lineKey, {
        color: COLORS[type] || "#60a5fa",
        lineWidth: 2,
      });
      series.applyOptions({ visible: active });
      series.setData(data);
      return;
    }

    if (type === "vwap") {
      const data = active ? plotPoints(this.getVwap()) : [];
      const series = this.ensureLineSeries(lineKey, {
        color: COLORS.vwap,
        lineWidth: 2,
        lineStyle: 0,
      });
      series.applyOptions({ visible: active });
      series.setData(data);
    }
  }

  applyBollinger() {
    const active = this.active.has("bb");
    const bb = this.getBollinger();
    const upper = this.ensureLineSeries(seriesKey("bb-upper"), {
      color: COLORS.bbUpper,
      lineWidth: 1,
    });
    const middle = this.ensureLineSeries(seriesKey("bb-middle"), {
      color: COLORS.bbMiddle,
      lineWidth: 1,
      lineStyle: 2,
    });
    const lower = this.ensureLineSeries(seriesKey("bb-lower"), {
      color: COLORS.bbLower,
      lineWidth: 1,
    });
    upper.applyOptions({ visible: active });
    middle.applyOptions({ visible: active });
    lower.applyOptions({ visible: active });
    if (!active) {
      upper.setData([]);
      middle.setData([]);
      lower.setData([]);
      return;
    }
    upper.setData(plotPoints(this.trimToDisplay(bb.upper)));
    middle.setData(plotPoints(this.trimToDisplay(bb.middle)));
    lower.setData(plotPoints(this.trimToDisplay(bb.lower)));
  }

  applyMacd() {
    const active = this.active.has("macd");
    const { macdLine, signalLine, histogram } = this.getMacd();

    const macdSeries = this.ensureLineSeries(seriesKey("macd-line"), {
      color: COLORS.macdLine,
      priceScaleId: MACD_SCALE,
      lineWidth: 1.5,
    });
    const signalSeries = this.ensureLineSeries(seriesKey("macd-signal"), {
      color: COLORS.macdSignal,
      priceScaleId: MACD_SCALE,
      lineWidth: 1,
    });
    const histSeries = this.ensureHistogramSeries(seriesKey("macd-hist"), {
      priceScaleId: MACD_SCALE,
    });

    macdSeries.applyOptions({ visible: active });
    signalSeries.applyOptions({ visible: active });
    histSeries.applyOptions({ visible: active });

    if (!active) {
      macdSeries.setData([]);
      signalSeries.setData([]);
      histSeries.setData([]);
      return;
    }

    macdSeries.setData(plotPoints(this.trimToDisplay(macdLine)));
    signalSeries.setData(plotPoints(this.trimToDisplay(signalLine)));
    histSeries.setData(
      plotPoints(this.trimToDisplay(histogram)).map((p) => ({
        time: p.time,
        value: p.value,
        color: (p.value ?? 0) >= 0 ? COLORS.macdUp : COLORS.macdDown,
      }))
    );
  }

  ensureVolumeProfileOverlay() {
    const wrap = document.querySelector(".chart-wrap");
    if (!wrap) return;
    let svg = wrap.querySelector("#chart-volume-profile");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "chart-volume-profile";
      svg.classList.add("chart-volume-profile");
      wrap.appendChild(svg);
    }
    this.vpSvg = svg;
  }

  renderVolumeProfile() {
    if (!this.vpSvg || !this.chart || !this.mainSeries) return;
    const active = this.active.has("volumeProfile");
    this.vpSvg.hidden = !active;
    if (!active) {
      this.vpSvg.innerHTML = "";
      return;
    }

    const profile = this.getVolumeProfile();
    if (!profile.length) {
      this.vpSvg.innerHTML = "";
      return;
    }

    const wrap = this.vpSvg.parentElement;
    const width = wrap?.clientWidth ?? 0;
    const height = wrap?.clientHeight ?? 0;
    const barMaxWidth = Math.min(72, width * 0.12);
    const x0 = width - barMaxWidth - 8;

    this.vpSvg.setAttribute("width", String(width));
    this.vpSvg.setAttribute("height", String(height));
    this.vpSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const maxVol = Math.max(...profile.map((b) => b.volume), 1);
    const barH = Math.max(3, Math.min(10, height / profile.length));

    const parts = [];
    for (const bin of profile) {
      const y = this.mainSeries.priceToCoordinate(bin.price);
      if (y == null || y < 0 || y > height) continue;
      const w = (bin.volume / maxVol) * barMaxWidth;
      parts.push(
        `<rect x="${x0 + barMaxWidth - w}" y="${y - barH / 2}" width="${w}" height="${barH}" fill="${COLORS.vpBar}" rx="1"/>`
      );
    }
    this.vpSvg.innerHTML = parts.join("");
  }

  /** @param {IndicatorType} type */
  getEma(type) {
    const cacheId = `ema:${EMA_PERIODS[type]}`;
    if (!this.computed.has(cacheId)) {
      this.computed.set(cacheId, computeEma(this.sourceCandles, EMA_PERIODS[type]));
    }
    return /** @type {Array<{ time: number; value?: number }>} */ (this.computed.get(cacheId));
  }

  getRsi() {
    if (!this.computed.has("rsi")) {
      this.computed.set("rsi", computeRsi(this.sourceCandles, 14));
    }
    return /** @type {Array<{ time: number; value?: number }>} */ (this.computed.get("rsi"));
  }

  getMacd() {
    if (!this.computed.has("macd")) {
      this.computed.set("macd", computeMacd(this.sourceCandles, 12, 26, 9));
    }
    return /** @type {{ macdLine: Array<{ time: number; value?: number }>; signalLine: Array<{ time: number; value?: number }>; histogram: Array<{ time: number; value?: number }> }} */ (
      this.computed.get("macd")
    );
  }

  getVwap() {
    if (!this.computed.has("vwap")) {
      this.computed.set("vwap", computeVwap(this.displayCandles));
    }
    return /** @type {Array<{ time: number; value?: number }>} */ (this.computed.get("vwap"));
  }

  getAtr() {
    if (!this.computed.has("atr")) {
      this.computed.set("atr", computeAtr(this.sourceCandles, 14));
    }
    return /** @type {Array<{ time: number; value?: number }>} */ (this.computed.get("atr"));
  }

  getBollinger() {
    if (!this.computed.has("bb")) {
      this.computed.set("bb", computeBollinger(this.sourceCandles, 20, 2));
    }
    return /** @type {{ upper: Array<{ time: number; value?: number }>; middle: Array<{ time: number; value?: number }>; lower: Array<{ time: number; value?: number }> }} */ (
      this.computed.get("bb")
    );
  }

  getVolumeProfile() {
    if (!this.computed.has("volumeProfile")) {
      this.computed.set("volumeProfile", computeVolumeProfile(this.displayCandles));
    }
    return /** @type {Array<{ price: number; volume: number }>} */ (this.computed.get("volumeProfile"));
  }

  /** @param {Array<{ time: number; value?: number }>} series */
  trimToDisplay(series) {
    if (!this.displayCandles.length) return series;
    const times = new Set(this.displayCandles.map((c) => c.time));
    return series.filter((p) => times.has(p.time));
  }

  /** @param {string} key @param {object} options */
  ensureLineSeries(key, options) {
    if (this.seriesByKey.has(key)) return this.seriesByKey.get(key);
    const series = this.chart.addSeries(this.LineSeries, {
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
      ...options,
    });
    this.seriesByKey.set(key, series);
    return series;
  }

  /** @param {string} key @param {object} options */
  ensureHistogramSeries(key, options) {
    if (this.seriesByKey.has(key)) return this.seriesByKey.get(key);
    const series = this.chart.addSeries(this.HistogramSeries, {
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      ...options,
    });
    this.seriesByKey.set(key, series);
    return series;
  }
}

/** @param {string} type */
function seriesKey(type) {
  return `ind:${type}`;
}

function buildCacheKey(sourceCandles, displayCandles) {
  if (!sourceCandles.length && !displayCandles.length) return "";
  const s0 = sourceCandles[0]?.time ?? 0;
  const s1 = sourceCandles[sourceCandles.length - 1]?.time ?? 0;
  const d0 = displayCandles[0]?.time ?? 0;
  const d1 = displayCandles[displayCandles.length - 1]?.time ?? 0;
  return `${sourceCandles.length}:${s0}:${s1}|${displayCandles.length}:${d0}:${d1}`;
}
