/**
 * financialSignals.js
 *
 * Converts raw financial metrics into simple investment signals for screening.
 * Each metric returns green (+1), yellow (0), or red (-1) with a human label.
 *
 * Input values are expected in **display units** (percentages as 16.6, not 0.166),
 * except where noted. Optional ratio normalization is applied for common API formats.
 */

/** @typedef {"green" | "yellow" | "red"} SignalColor */

/** @typedef {{ signal: SignalColor, label: string, score: number, value?: number }} SignalResult */

/** @typedef {{ metric: string, displayMetric?: string, signal: SignalColor, label: string, score: number, value: number | null }} MetricSignal */

/* * @typedef {{
 *   revenueGrowth?: number | null;
 *   epsGrowth?: number | null;
 *   grossMargin?: number | null;
 *   operatingMargin?: number | null;
 *   netMargin?: number | null;
 *   roa?: number | null;
 *   roe?: number | null;
 *   roePeriodLabel?: string | null;
 *   roaPeriodLabel?: string | null;
 *   fcfMargin?: number | null;
 *   currentRatio?: number | null;
 *   debtToEquity?: number | null;
 *   netCash?: number | null;
 * }} StockData
 */

const SCORE_BY_SIGNAL = /** @type {const} */ ({
  green: 1,
  yellow: 0,
  red: -1,
});

const SIGNAL_COLORS = /** @type {const} */ ({
  green: "#22c55e",
  yellow: "#94a3b8",
  red: "#ef4444",
});

const OVERALL_RATINGS = [
  { min: 8, label: "Excellent" },
  { min: 4, label: "Strong" },
  { min: 0, label: "Neutral" },
  { min: -4, label: "Weak" },
  { min: -Infinity, label: "Poor" },
];

/**
 * @param {SignalColor} signal
 * @param {string} label
 * @param {number | null | undefined} value
 * @returns {SignalResult & { value: number | null }}
 */
function makeSignal(signal, label, value) {
  return {
    signal,
    label,
    score: SCORE_BY_SIGNAL[signal],
    value: toNumber(value),
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Treat Yahoo-style ratios (0.166) as percentages when magnitude is <= 1.
 * @param {number | null | undefined} value
 * @returns {number | null}
 */
function asPercent(value) {
  const n = toNumber(value);
  if (n == null) return null;
  if (n !== 0 && Math.abs(n) <= 1) return n * 100;
  return n;
}

/**
 * ROE from APIs may be a ratio (1.41) or percent (141.47).
 * @param {number | null | undefined} value
 * @returns {number | null}
 */
function asRoePercent(value) {
  const n = toNumber(value);
  if (n == null) return null;
  if (n !== 0 && Math.abs(n) <= 5) return n * 100;
  return n;
}

/**
 * @param {number | null} value
 * @param {string} metric
 * @returns {MetricSignal}
 */
function unavailable(value, metric) {
  return {
    metric,
    signal: "yellow",
    label: "Data unavailable",
    score: 0,
    value,
  };
}

// ---------------------------------------------------------------------------
// Metric evaluators — add new metrics by creating a function and registering it
// ---------------------------------------------------------------------------

/** @param {StockData} d */
function evalRevenueGrowth(d) {
  const value = asPercent(d.revenueGrowth);
  if (value == null) return unavailable(value, "Revenue Growth");
  if (value > 20) return makeSignal("green", "Strong growth", value);
  if (value >= 10) return makeSignal("green", "Good growth", value);
  if (value >= 5) return makeSignal("yellow", "Moderate growth", value);
  if (value >= 0) return makeSignal("yellow", "Slow growth", value);
  return makeSignal("red", "Revenue shrinking", value);
}

/** @param {StockData} d */
function evalEpsGrowth(d) {
  const value = asPercent(d.epsGrowth);
  if (value == null) return unavailable(value, "EPS Growth");
  if (value > 25) return makeSignal("green", "Strong earnings growth", value);
  if (value >= 10) return makeSignal("green", "Good earnings growth", value);
  if (value >= 0) return makeSignal("yellow", "Moderate earnings growth", value);
  return makeSignal("red", "Earnings declining", value);
}

/** @param {StockData} d */
function evalGrossMargin(d) {
  const value = asPercent(d.grossMargin);
  if (value == null) return unavailable(value, "Gross Margin");
  if (value > 50) return makeSignal("green", "Excellent gross margin", value);
  if (value >= 35) return makeSignal("green", "Strong gross margin", value);
  if (value >= 20) return makeSignal("yellow", "Moderate gross margin", value);
  return makeSignal("red", "Weak gross margin", value);
}

/** @param {StockData} d */
function evalOperatingMargin(d) {
  const value = asPercent(d.operatingMargin);
  if (value == null) return unavailable(value, "Operating Margin");
  if (value > 25) return makeSignal("green", "Excellent operating margin", value);
  if (value >= 15) return makeSignal("green", "Strong operating margin", value);
  if (value >= 5) return makeSignal("yellow", "Moderate operating margin", value);
  return makeSignal("red", "Weak operating margin", value);
}

/** @param {StockData} d */
function evalNetMargin(d) {
  const value = asPercent(d.netMargin);
  if (value == null) return unavailable(value, "Net Margin");
  if (value > 20) return makeSignal("green", "Excellent net margin", value);
  if (value >= 10) return makeSignal("green", "Strong net margin", value);
  if (value >= 5) return makeSignal("yellow", "Moderate net margin", value);
  return makeSignal("red", "Weak net margin", value);
}

/** @param {StockData} d */
function evalFcfMargin(d) {
  const value = asPercent(d.fcfMargin);
  if (value == null) return unavailable(value, "FCF Margin");
  if (value > 20) return makeSignal("green", "Excellent FCF margin", value);
  if (value >= 10) return makeSignal("green", "Strong FCF margin", value);
  if (value >= 5) return makeSignal("yellow", "Moderate FCF margin", value);
  return makeSignal("red", "Weak FCF margin", value);
}

/** @param {StockData} d */
function evalRoa(d) {
  const value = asPercent(d.roa);
  if (value == null) return unavailable(value, "ROA");
  if (value > 15) return makeSignal("green", "Excellent ROA", value);
  if (value >= 8) return makeSignal("green", "Strong ROA", value);
  if (value >= 3) return makeSignal("yellow", "Moderate ROA", value);
  return makeSignal("red", "Weak ROA", value);
}

/** @param {StockData} d */
function evalRoe(d) {
  const value = asRoePercent(d.roe);
  if (value == null) return unavailable(value, "ROE");
  if (value > 100) {
    return makeSignal("green", "Very high ROE (possible buyback distortion)", value);
  }
  if (value > 20) return makeSignal("green", "Excellent ROE", value);
  if (value >= 10) return makeSignal("green", "Strong ROE", value);
  if (value >= 5) return makeSignal("yellow", "Moderate ROE", value);
  return makeSignal("red", "Weak ROE", value);
}

/** @param {StockData} d */
function evalCurrentRatio(d) {
  const value = toNumber(d.currentRatio);
  if (value == null) return unavailable(value, "Current Ratio");
  if (value > 2) return makeSignal("green", "Strong liquidity", value);
  if (value >= 1) return makeSignal("green", "Adequate liquidity", value);
  if (value >= 0.8) return makeSignal("yellow", "Tight liquidity", value);
  return makeSignal("red", "Liquidity risk", value);
}

/**
 * Accept SEC ratio (0.85) or Yahoo-style percent (85).
 * @param {number | null | undefined} value
 * @returns {number | null}
 */
function asDebtToEquityPercent(value) {
  const n = toNumber(value);
  if (n == null) return null;
  if (n !== 0 && Math.abs(n) <= 5) return n * 100;
  return n;
}

/** @param {StockData} d */
function evalDebtToEquity(d) {
  const value = asDebtToEquityPercent(d.debtToEquity);
  if (value == null) return unavailable(value, "Debt / Equity");
  if (value < 50) return makeSignal("green", "Conservative leverage", value);
  if (value <= 100) return makeSignal("yellow", "Moderate leverage", value);
  if (value <= 200) return makeSignal("red", "High leverage", value);
  return makeSignal("red", "Very high leverage", value);
}

/** netCash = cash & equivalents − total debt (SEC filings, USD). */
function evalNetCash(d) {
  const netCash = toNumber(d.netCash);
  if (netCash == null) return unavailable(netCash, "Net Cash");
  if (netCash >= 0) return makeSignal("green", "Net cash position", netCash);
  return makeSignal("red", "Net debt position", netCash);
}

/**
 * Registry of screener metrics. Add new entries here to extend the system.
 * @type {Array<{ metric: string, evaluate: (data: StockData) => SignalResult & { value: number | null } }>}
 */
const METRIC_REGISTRY = [
  { metric: "Revenue Growth", evaluate: evalRevenueGrowth },
  { metric: "EPS Growth", evaluate: evalEpsGrowth },
  { metric: "Gross Margin", evaluate: evalGrossMargin },
  { metric: "Operating Margin", evaluate: evalOperatingMargin },
  { metric: "Net Margin", evaluate: evalNetMargin },
  { metric: "FCF Margin", evaluate: evalFcfMargin },
  { metric: "ROA", evaluate: evalRoa },
  { metric: "ROE", evaluate: evalRoe },
  { metric: "Current Ratio", evaluate: evalCurrentRatio },
  { metric: "Debt / Equity", evaluate: evalDebtToEquity },
  { metric: "Net Cash", evaluate: evalNetCash },
];

/** Category groupings for overview score cards (SEC filings fundamentals only). */
export const SIGNAL_CATEGORIES = {
  Growth: ["Revenue Growth", "EPS Growth"],
  Profitability: ["Gross Margin", "Operating Margin", "Net Margin", "ROA", "ROE", "FCF Margin"],
  "Financial Health": ["Current Ratio", "Debt / Equity", "Net Cash"],
};

/** Display order for category cards. */
export const CATEGORY_ORDER = ["Growth", "Profitability", "Financial Health"];

/** Priority when picking top bullish / bearish highlights. */
const SIGNAL_PRIORITY = [
  "Revenue Growth",
  "EPS Growth",
  "Net Margin",
  "ROE",
  "ROA",
  "FCF Margin",
  "Gross Margin",
  "Operating Margin",
  "Net Cash",
  "Debt / Equity",
  "Current Ratio",
];

/**
 * @param {SignalColor} signal
 * @returns {number}
 */
function signalToPoints(signal) {
  if (signal === "green") return 100;
  if (signal === "yellow") return 50;
  return 0;
}

/**
 * @param {number | null} score
 * @returns {SignalColor}
 */
export function scoreToTone(score) {
  if (score == null || !Number.isFinite(score)) return "yellow";
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

/**
 * @param {MetricSignal[]} signals
 * @returns {Array<{ name: string, score: number | null, tone: SignalColor, metrics: MetricSignal[] }>}
 */
export function getCategoryScores(signals) {
  const byMetric = new Map(signals.map((s) => [s.metric, s]));
  return CATEGORY_ORDER.map((name) => {
    const metricNames = SIGNAL_CATEGORIES[name] || [];
    const metrics = metricNames.map((m) => byMetric.get(m)).filter(Boolean);
    if (!metrics.length) {
      return { name, score: null, tone: /** @type {SignalColor} */ ("yellow"), metrics: [] };
    }
    const score = Math.round(
      metrics.reduce((sum, s) => sum + signalToPoints(s.signal), 0) / metrics.length
    );
    return { name, score, tone: scoreToTone(score), metrics };
  });
}

/**
 * @param {MetricSignal[]} signals
 * @param {SignalColor} tone
 * @param {number} [limit=5]
 */
function pickTopSignals(signals, tone, limit = 5) {
  const priority = new Map(SIGNAL_PRIORITY.map((m, i) => [m, i]));
  return signals
    .filter((s) => s.signal === tone)
    .sort((a, b) => (priority.get(a.metric) ?? 999) - (priority.get(b.metric) ?? 999))
    .slice(0, limit);
}

/** @param {MetricSignal[]} signals @param {number} [limit=5] */
export function getTopBullishSignals(signals, limit = 5) {
  return pickTopSignals(signals, "green", limit);
}

/** @param {MetricSignal[]} signals @param {number} [limit=5] */
export function getTopBearishSignals(signals, limit = 5) {
  return pickTopSignals(signals, "red", limit);
}

/**
 * Build investment signals from normalized financial inputs.
 * @param {StockData} stockData
 * @returns {{ signals: MetricSignal[], summary: { totalGreen: number, totalYellow: number, totalRed: number, totalScore: number } }}
 */
export function generateSignals(stockData) {
  const data = stockData ?? {};

  /** @type {MetricSignal[]} */
  const signals = METRIC_REGISTRY.map(({ metric, evaluate }) => {
    const result = evaluate(data);
    let displayMetric = metric;
    if (metric === "ROE" && data.roePeriodLabel) {
      displayMetric = `ROE (${data.roePeriodLabel})`;
    } else if (metric === "ROA" && data.roaPeriodLabel) {
      displayMetric = `ROA (${data.roaPeriodLabel})`;
    }
    return {
      metric,
      displayMetric,
      signal: result.signal,
      label: result.label,
      score: result.score,
      value: result.value,
    };
  });

  const summary = signals.reduce(
    (acc, s) => {
      if (s.signal === "green") acc.totalGreen += 1;
      else if (s.signal === "yellow") acc.totalYellow += 1;
      else acc.totalRed += 1;
      acc.totalScore += s.score;
      return acc;
    },
    { totalGreen: 0, totalYellow: 0, totalRed: 0, totalScore: 0 }
  );

  return { signals, summary };
}

/**
 * CSS hex color for a signal state.
 * @param {SignalColor | string | null | undefined} signal
 * @returns {string}
 */
export function getSignalColor(signal) {
  return SIGNAL_COLORS[/** @type {SignalColor} */ (signal)] ?? "#94a3b8";
}

/**
 * Aggregate score → overall qualitative rating.
 * @param {number} score
 * @returns {string}
 */
export function getOverallRating(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "Neutral";
  for (const tier of OVERALL_RATINGS) {
    if (n >= tier.min) return tier.label;
  }
  return "Poor";
}

export default {
  generateSignals,
  getSignalColor,
  getOverallRating,
  getCategoryScores,
  getTopBullishSignals,
  getTopBearishSignals,
  scoreToTone,
  SIGNAL_CATEGORIES,
  CATEGORY_ORDER,
};
