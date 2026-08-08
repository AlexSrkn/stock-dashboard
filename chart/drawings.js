import { DRAWINGS_STORAGE_PREFIX } from "./constants.js";

/**
 * @typedef {object} DrawingPoint
 * @property {number} time
 * @property {number} price
 */

/**
 * @typedef {object} Drawing
 * @property {string} id
 * @property {'trendline' | 'hline' | 'ray'} type
 * @property {DrawingPoint[]} points
 */

/**
 * User drawings overlay (trendline, horizontal line, ray) with localStorage persistence.
 */
export class DrawingLayer {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.wrapEl
   * @param {() => import('lightweight-charts').IChartApi | null} opts.getChart
   * @param {() => import('lightweight-charts').ISeriesApi | null} opts.getSeries
   * @param {() => string | null} opts.getSymbol
   */
  constructor(opts) {
    this.wrapEl = opts.wrapEl;
    this.getChart = opts.getChart;
    this.getSeries = opts.getSeries;
    this.getSymbol = opts.getSymbol;
    /** @type {'trendline' | 'hline' | 'ray' | 'delete' | null} */
    this.mode = null;
    /** @type {DrawingPoint | null} */
    this.pendingPoint = null;
    /** @type {Drawing[]} */
    this.drawings = [];
    this.svg = this.createSvg();
    this.onPointerDown = this.onPointerDown.bind(this);
    this.wrapEl.addEventListener("pointerdown", this.onPointerDown);
  }

  createSvg() {
    let svg = this.wrapEl.querySelector("#chart-drawings-overlay");
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "chart-drawings-overlay";
      svg.classList.add("chart-drawings-overlay");
      this.wrapEl.appendChild(svg);
    }
    return svg;
  }

  setMode(mode) {
    this.mode = mode || null;
    this.pendingPoint = null;
    this.wrapEl.classList.toggle("chart-wrap--drawing", Boolean(this.mode && this.mode !== "delete"));
    this.wrapEl.classList.toggle("chart-wrap--drawing-delete", this.mode === "delete");
  }

  loadForSymbol(symbol) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) {
      this.drawings = [];
      this.render();
      return;
    }
    try {
      const raw = localStorage.getItem(`${DRAWINGS_STORAGE_PREFIX}${sym}`);
      this.drawings = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this.drawings)) this.drawings = [];
    } catch {
      this.drawings = [];
    }
    this.pendingPoint = null;
    this.render();
  }

  save() {
    const sym = this.getSymbol();
    if (!sym) return;
    try {
      localStorage.setItem(
        `${DRAWINGS_STORAGE_PREFIX}${sym.toUpperCase()}`,
        JSON.stringify(this.drawings)
      );
    } catch {
      /* quota */
    }
  }

  onPointerDown(event) {
    const chart = this.getChart();
    const series = this.getSeries();
    if (!chart || !series || !this.mode) return;
    if (event.button !== 0) return;

    const rect = this.wrapEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (this.mode === "delete") {
      const hit = this.hitTest(x, y, chart, series);
      if (hit) {
        this.drawings = this.drawings.filter((d) => d.id !== hit.id);
        this.save();
        this.render();
      }
      return;
    }

    const point = this.coordToPoint(x, y, chart, series);
    if (!point) return;

    if (this.mode === "hline") {
      this.drawings.push({
        id: crypto.randomUUID(),
        type: "hline",
        points: [point],
      });
      this.save();
      this.render();
      return;
    }

    if (!this.pendingPoint) {
      this.pendingPoint = point;
      return;
    }

    this.drawings.push({
      id: crypto.randomUUID(),
      type: this.mode,
      points: [this.pendingPoint, point],
    });
    this.pendingPoint = null;
    this.save();
    this.render();
  }

  coordToPoint(x, y, chart, series) {
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null || !Number.isFinite(price)) return null;
    const t = typeof time === "number" ? time : null;
    if (t == null) return null;
    return { time: t, price };
  }

  pointToCoord(point, chart, series) {
    const x = chart.timeScale().timeToCoordinate(point.time);
    const y = series.priceToCoordinate(point.price);
    if (x == null || y == null) return null;
    return { x, y };
  }

  render() {
    const chart = this.getChart();
    const series = this.getSeries();
    if (!chart || !series) {
      this.svg.innerHTML = "";
      return;
    }

    const width = this.wrapEl.clientWidth;
    const height = this.wrapEl.clientHeight;
    this.svg.setAttribute("width", String(width));
    this.svg.setAttribute("height", String(height));
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const parts = [];

    for (const drawing of this.drawings) {
      const el = this.renderDrawing(drawing, chart, series, width);
      if (el) parts.push(el);
    }

    if (this.pendingPoint && this.mode !== "hline" && this.mode !== "delete") {
      const p = this.pointToCoord(this.pendingPoint, chart, series);
      if (p) {
        parts.push(
          `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#5b9cff" stroke="#fff" stroke-width="1"/>`
        );
      }
    }

    this.svg.innerHTML = parts.join("");
  }

  renderDrawing(drawing, chart, series, width) {
    const color = "#5b9cff";
    const sw = 2;

    if (drawing.type === "hline" && drawing.points[0]) {
      const p = this.pointToCoord(drawing.points[0], chart, series);
      if (!p) return "";
      return `<line x1="0" y1="${p.y}" x2="${width}" y2="${p.y}" stroke="${color}" stroke-width="${sw}" data-id="${drawing.id}"/>`;
    }

    if (drawing.points.length < 2) return "";
    const a = this.pointToCoord(drawing.points[0], chart, series);
    const b = this.pointToCoord(drawing.points[1], chart, series);
    if (!a || !b) return "";

    if (drawing.type === "ray") {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx === 0 && dy === 0) return "";
      const scale = dx !== 0 ? (width - a.x) / dx : 1;
      const x2 = a.x + dx * scale;
      const y2 = a.y + dy * scale;
      return `<line x1="${a.x}" y1="${a.y}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}" data-id="${drawing.id}"/>`;
    }

    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${sw}" data-id="${drawing.id}"/>`;
  }

  hitTest(x, y, chart, series) {
    const threshold = 8;
    for (const drawing of [...this.drawings].reverse()) {
      if (drawing.type === "hline" && drawing.points[0]) {
        const p = this.pointToCoord(drawing.points[0], chart, series);
        if (p && Math.abs(p.y - y) <= threshold) return drawing;
        continue;
      }
      if (drawing.points.length < 2) continue;
      const a = this.pointToCoord(drawing.points[0], chart, series);
      const b = this.pointToCoord(drawing.points[1], chart, series);
      if (!a || !b) continue;
      let x2 = b.x;
      let y2 = b.y;
      if (drawing.type === "ray") {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const scale = dx !== 0 ? (this.wrapEl.clientWidth - a.x) / dx : 1;
        x2 = a.x + dx * scale;
        y2 = a.y + dy * scale;
      }
      if (distToSegment(x, y, a.x, a.y, x2, y2) <= threshold) return drawing;
    }
    return null;
  }

  subscribeVisibleRange(chart) {
    if (!chart) return () => {};
    const handler = () => this.render();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      } catch {
        /* chart destroyed */
      }
    };
  }

  destroy() {
    this.wrapEl.removeEventListener("pointerdown", this.onPointerDown);
    this.svg.innerHTML = "";
    this.drawings = [];
    this.pendingPoint = null;
    this.mode = null;
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.hypot(px - nx, py - ny);
}
