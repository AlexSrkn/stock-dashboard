import {
  generateSignals,
  getOverallRating,
  getCategoryScores,
  getTopBullishSignals,
  getTopBearishSignals,
} from "./financialSignals.js";
import { ChartExtensions } from "./chart/chart.js";
import { setupChartToolbar, closeChartDrawMenu, closeChartCompareMenu, closeChartIndicatorsMenu, setChartDrawMenuHooks, setChartCompareMenuHooks, setChartIndicatorsMenuHooks } from "./chart/chartUi.js";
import { IndicatorManager } from "./chart/indicatorManager.js";
import { initLandingPage } from "./landingPage.js";
import { buildSparklineSvg } from "./sparkline.js";
import { createDcfCalculatorController } from "./dcfCalculatorPage.js";
import { createWaccCalculatorController } from "./waccCalculatorPage.js";
import { createEpvCalculatorController } from "./epvCalculatorPage.js";
import { createEvCalculatorController } from "./enterpriseValueCalculatorPage.js";
import { createPeCalculatorController } from "./peValuationPage.js";
import { createEvEbitdaCalculatorController } from "./evebitdaValuationPage.js";
import { createFcfYieldCalculatorController } from "./fcfYieldCalculatorPage.js";
import { createFindSimilarStocksController } from "./findSimilarStocksPage.js";
import { createInstitutionPerformanceProxyController } from "./institutionPerformanceProxyPage.js";
import { setupAuthLoginPanel, isAuthPath, showAuthRoute, hideAuthRoute } from "./authLoginPanel.js?v=tv-us-equity-1";
import {
  formatProxyHoldings,
  formatProxyPct,
  formatProxyUsd,
} from "./src/institution/portfolioPerformanceProxy/formatDisplay.js";
import { formatSignedUsdCompact } from "./src/format/money.js";

const LWC_MODULE_URL =
  "/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs";
/** @type {typeof import('lightweight-charts') | null} */
let lwcLib = null;
/** @type {Promise<typeof import('lightweight-charts')> | null} */
let lwcLoadPromise = null;

async function ensureLightweightCharts() {
  if (lwcLib) return lwcLib;
  if (!lwcLoadPromise) {
    lwcLoadPromise = import(LWC_MODULE_URL).then((mod) => {
      lwcLib = mod;
      return mod;
    });
  }
  return lwcLoadPromise;
}

const WATCHLIST_STORAGE_KEY = "tradepile-watchlist";

/** @type {{ symbol: string; name: string; price: number; changePct: number }[]} */
let watchlist = [];

let activeIndex = -1;
/** @type {{ symbol: string; name: string; price: number; changePct: number; currency?: string; exchange?: string } | null} */
let previewStock = null;
let chartInstance = null;
let chartMainSeries = null;
let chartVolumeSeries = null;
/** @type {import('lightweight-charts').ISeriesApi<'Line'> | null} */
let chartMa20Series = null;
/** @type {import('lightweight-charts').ISeriesApi<'Line'> | null} */
let chartMa50Series = null;
/** @type {import('lightweight-charts').ISeriesApi<'Line'> | null} */
let chartMa200Series = null;
let chartCrosshairUnsub = null;
let lastChartConfigKey = null;
/** @type {Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number }>} */
let chartBarByTime = new Map();
let activeRange = "1D";
/** @type {"line" | "area" | "candlestick"} */
let activeChartType = "area";
let chartShowVolume = false;
let chartSettingsOpen = false;
let chartFullscreenOpen = false;
/** @type {ChartExtensions | null} */
let chartExtensions = null;
/** @type {IndicatorManager | null} */
let chartIndicatorManager = null;
/** @type {Record<string, boolean>} */
let chartIndicatorVisible = {
  ema20: false,
  ema50: false,
  ema200: false,
  rsi: false,
  macd: false,
  vwap: false,
  atr: false,
  bb: false,
  volumeProfile: false,
};
/** @type {string | null} */
let lastChartSymbol = null;
/** Moving-average overlay visibility (persists across timeframe / symbol changes). */
let chartMa20Visible = false;
let chartMa50Visible = false;
let chartMa200Visible = false;
let watchlistSearchOpen = false;
let searchDebounceTimer = null;
let searchRequestId = 0;
let topSearchDebounceTimer = null;
let topSearchRequestId = 0;
/** Incremented on each panel load; only the latest load may commit results. */
let panelLoadSeq = 0;
/** Symbol the user is currently viewing (source of truth for panel loads). */
let viewingSymbol = null;
/** Symbol currently reflected in loaded panel data. */
let loadedPanelSymbol = null;
let openStockPreviewSeq = 0;

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function setViewingSymbol(symbol) {
  viewingSymbol = normalizeSymbol(symbol) || null;
}

function getViewingSymbol() {
  return viewingSymbol || normalizeSymbol(getDisplayStock()?.symbol) || null;
}

function isStalePanelLoad(loadSeq, symbol) {
  if (loadSeq !== panelLoadSeq) return true;
  const expected = normalizeSymbol(symbol);
  if (!expected) return true;
  return getViewingSymbol() !== expected;
}

function resetStockPanelUi(sym) {
  const symbol = normalizeSymbol(sym);
  loadedPanelSymbol = null;
  lastStockClassification = null;
  lastSecFilings = [];
  lastFilingsFundamentals = null;
  lastSecFilingsForScores = null;
  lastOwnershipHolders = [];
  lastOwnershipQuarterMeta = {};
  filingsFundamentalsSymbol = null;
  signalsSymbol = symbol || null;
  insiderClusterSymbol = symbol || null;
  secFilingsExpanded = false;
  ownershipExpanded = false;

  renderStockClassificationLabel(null);
  renderTradingViewWidget(symbol, { force: true });
  renderTradingViewSymbolInfo(symbol, { force: true });
  setChartFootnote("Loading chart…");
  setOverviewDataSource("Loading SEC filings…");
  setOwnershipSubtitle("Loading 13F holdings…");
  setSecSubtitle("Loading SEC submissions…");
  renderStockOverview(null, "Loading…");
  renderCategoryScoresPanel(null, "Loading…");
  renderOwnershipIntelligencePanel(null, "Loading…");
  renderStockInsiderCluster(null);
  renderOwnershipHoldersBody(
    `<tr><td colspan="6" class="trades-table__empty">Loading institutional holders…</td></tr>`
  );
  const secBody = document.getElementById("sec-filings-body");
  if (secBody) {
    secBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Loading SEC submissions…</td></tr>`;
  }
  if (activeStockTab === "signals" && symbol) {
    void loadSignalsPanel(symbol);
  }
  if (activeStockTab === "filings-fundamentals" && symbol) {
    void loadFilingsFundamentalsPanel(symbol);
  }
}

/** @type {{ points: Array<{ x: number; y: number }>; candleData: Array<{ time: number; open: number; high: number; low: number; close: number }>; volumeData: Array<{ time: number; value: number; color: string }>; rangeChangePct: number; positive: boolean; currency: string; range: string; interval?: string } | null} */
let lastPriceSeries = null;

const CHART_UP_COLOR = "#3ee6b0";
const CHART_DOWN_COLOR = "#ff6b7a";
const CHART_UP_FILL = "rgba(62, 230, 176, 0.22)";
const CHART_DOWN_FILL = "rgba(255, 107, 122, 0.18)";
const CHART_UP_VOLUME = "rgba(62, 230, 176, 0.45)";
const CHART_DOWN_VOLUME = "rgba(255, 107, 122, 0.45)";
const CHART_MA_COLORS = { 20: "#3B82F6", 50: "#F59E0B", 200: "#8B5CF6" };
const CHART_MA_PERIODS = [20, 50, 200];
/** Extra pre-window bars fetched for Finviz/TradingView-style SMA warmup. */
const MA_WARMUP_BARS = { 20: 50, 50: 100, 200: 300 };
const MA_WARMUP_MAX = 300;

let activeCurrency = "USD";

const STOCK_TABS = ["overview", "signals", "filings-fundamentals", "ownership", "activity", "insider-activity", "congress-activity", "sec-filings"];
let activeStockTab = "overview";

let screenerOpen = false;
let recentlyActiveOpen = false;
let stocksMostAccumulatedOpen = false;
let stocksOwnershipChangesOpen = false;
let stocksHolderOverlapOpen = false;
let stocksOwnershipHistoryOpen = false;
let stocksCompareOpen = false;
/** @type {{ a: string; b: string; period: string }} */
let stocksCompareSelection = { a: "", b: "", period: "latest" };
/** @type {object | null} */
let lastStockComparePayload = null;
let stockCompareLoading = false;
let stockCompareBound = false;
let stockCompareHoldersExpanded = false;

const PULSE_PREVIEW_LIMIT = 5;
const INSTITUTION_TABS = ["holdings", "activity", "options", "performance", "history"];
const EXPLORE_MODES = ["stocks", "institutions", "insiders", "politicians", "signals", "tools"];
let activeExploreMode = "stocks";
let activeInstitutionTab = "holdings";
let activeInstitutionHubView = "directory";
/** @type {ReturnType<typeof createInstitutionPerformanceProxyController> | null} */
let institutionProxyPerformance = null;
let activeInsiderHubView = "trades";
let activeSignalsHubView = "directory";
/** @type {object | null} */
let lastTopInstitutionNewEntries = null;
let topInstitutionEntriesSelectedId = null;
let topInstitutionEntriesBound = false;
let topInstitutionEntriesSortKey = "value";
let topInstitutionEntriesSortDir = "desc";
let activeToolsHubView = "directory";
/** @type {ReturnType<typeof createDcfCalculatorController> | null} */
let dcfCalculator = null;
/** @type {ReturnType<typeof createWaccCalculatorController> | null} */
let waccCalculator = null;
/** @type {ReturnType<typeof createEpvCalculatorController> | null} */
let epvCalculator = null;
/** @type {ReturnType<typeof createEvCalculatorController> | null} */
let evCalculator = null;
/** @type {ReturnType<typeof createPeCalculatorController> | null} */
let peCalculator = null;
/** @type {ReturnType<typeof createEvEbitdaCalculatorController> | null} */
let evebitdaCalculator = null;
/** @type {ReturnType<typeof createFcfYieldCalculatorController> | null} */
let fcfYieldCalculator = null;
/** @type {ReturnType<typeof createFindSimilarStocksController> | null} */
let similarStocksTool = null;
let institutionPerformancePeriod = "qoq";
let lastInstitutionPerformanceRankings = [];
let institutionPerformanceRankingsLoading = false;
let institutionPerformanceRankingsBound = false;
let mostAccumulatedPeriod = "quarter";
/** @type {object | null} */
let lastMostAccumulatedPayload = null;
let mostAccumulatedLoading = false;
let mostAccumulatedBound = false;
let mostAccumulatedSortKey = "netSharesAdded";
let mostAccumulatedSortDir = "desc";
let mostAccumulatedPage = 1;
const INSTITUTION_MOST_ACCUMULATED_PAGE_SIZE = 30;
let mostAccumulatedFilters = {
  search: "",
  sector: "",
  size: "",
  minBuyers: 0,
  minShares: 0,
  positiveOnly: false,
};
/** @type {object | null} */
let lastNewPositionsPayload = null;
let newPositionsLoading = false;
let newPositionsBound = false;
let newPositionsSortKey = "positionValueUsd";
let newPositionsSortDir = "desc";
let newPositionsPage = 1;
const INSTITUTION_NEW_POSITIONS_PAGE_SIZE = 50;
let newPositionsFilterOptionsReady = false;
let newPositionsSearchTimer = null;
let newPositionsFilters = {
  quarter: "",
  institution: "",
  sector: "",
  minValue: 0,
  search: "",
  minWeight: 0,
};
/** @type {object | null} */
let lastDoubleSignalPayload = null;
let doubleSignalLoading = false;
let doubleSignalBound = false;
let doubleSignalWindowDays = 90;
let doubleSignalSortKey = "signalStrengthScore";
let doubleSignalSortDir = "desc";
let doubleSignalPage = 1;
const DOUBLE_SIGNAL_PAGE_SIZE = 50;
let activeDoubleSignalTicker = null;
let doubleSignalFilters = {
  institution: "",
  insiderRole: "",
  sector: "",
  minInstValue: 0,
  minInsiderValue: 0,
  search: "",
};
/** @type {object | null} */
let lastTripleSignalPayload = null;
let tripleSignalLoading = false;
let tripleSignalBound = false;
let tripleSignalWindowDays = 180;
let tripleSignalSortKey = "signalStrengthScore";
let tripleSignalSortDir = "desc";
let tripleSignalPage = 1;
const TRIPLE_SIGNAL_PAGE_SIZE = 50;
let activeTripleSignalTicker = null;
let tripleSignalFilters = {
  institution: "",
  insiderRole: "",
  sector: "",
  minInstValue: 0,
  minInsiderValue: 0,
  minPoliticianValue: 0,
  search: "",
};
/** @type {object | null} */
let lastConflictSignalsPayload = null;
let conflictSignalsLoading = false;
let conflictSignalsBound = false;
let conflictSignalsSortKey = "conflictScore";
let conflictSignalsSortDir = "desc";
let conflictSignalsPage = 1;
const CONFLICT_SIGNALS_PAGE_SIZE = 50;
let conflictSignalsFilters = {
  signalType: "",
  sector: "",
  marketCap: "",
  minConflictScore: 0,
  insiderRole: "",
  search: "",
};
/** @type {object | null} */
let lastHiddenGemsPayload = null;
let hiddenGemsLoading = false;
let hiddenGemsBound = false;
let hiddenGemsSortKey = "hiddenGemScore";
let hiddenGemsSortDir = "desc";
let hiddenGemsPage = 1;
const HIDDEN_GEMS_PAGE_SIZE = 50;
let hiddenGemsFilters = {
  quarter: "",
  sector: "",
  marketCap: "",
  minScore: 0,
  maxOwnershipPct: 35,
  minOwnershipGrowthPct: 15,
  minInstitutions: 0,
  onlyNewPositions: false,
  search: "",
};
/** @type {object | null} */
let lastConvictionScorePayload = null;
let convictionScoreLoading = false;
let convictionScoreBound = false;
let convictionScoreSortKey = "convictionScore";
let convictionScoreSortDir = "desc";
let convictionScorePage = 1;
const CONVICTION_SCORE_PAGE_SIZE = 50;
/** @type {Set<string>} */
let convictionScoreExpanded = new Set();
let convictionScoreFilters = {
  quarter: "",
  sector: "",
  marketCap: "",
  minScore: 0,
  minHolders: 5,
  minMedianWeight: "",
  minHighConvictionHolders: 0,
  compare: "",
  search: "",
};
/** @type {object | null} */
let lastInstitutionalDiscoveryPayload = null;
let institutionalDiscoveryLoading = false;
let institutionalDiscoveryBound = false;
let institutionalDiscoverySortKey = "discoveryScore";
let institutionalDiscoverySortDir = "desc";
let institutionalDiscoveryPage = 1;
const INSTITUTIONAL_DISCOVERY_PAGE_SIZE = 50;
/** @type {Set<string>} */
let institutionalDiscoveryExpanded = new Set();
let institutionalDiscoveryFilters = {
  quarter: "",
  sector: "",
  marketCap: "",
  minScore: 0,
  minNewHolders: 0,
  minHolderGrowth: "",
  minGrowthStreak: 0,
  search: "",
};
/** @type {object | null} */
let lastConvictionBuysPayload = null;
let convictionBuysLoading = false;
let convictionBuysBound = false;
let convictionBuysSortKey = "convictionScore";
let convictionBuysSortDir = "desc";
let convictionBuysPage = 1;
const CONVICTION_BUYS_PAGE_SIZE = 50;
let convictionBuysFilters = {
  minScore: 0,
  dateFrom: "",
  dateTo: "",
  role: "",
  sector: "",
  marketCap: "",
  ticker: "",
};
/** @type {object | null} */
let lastRepeatBuyersPayload = null;
let repeatBuyersLoading = false;
let repeatBuyersBound = false;
let repeatBuyersSortKey = "repeatBuyerScore";
let repeatBuyersSortDir = "desc";
let repeatBuyersPage = 1;
const REPEAT_BUYERS_PAGE_SIZE = 50;
let repeatBuyersFilters = {
  minScore: 0,
  minPurchases: 2,
  minStreak: 0,
  minInvested: "",
  dateFrom: "",
  dateTo: "",
  role: "",
  sector: "",
  marketCap: "",
  ticker: "",
  search: "",
};
/** @type {object | null} */
let lastInsiderSentimentPayload = null;
let insiderSentimentLoading = false;
let insiderSentimentBound = false;
let insiderSentimentSortKey = "sentimentScore";
let insiderSentimentSortDir = "desc";
let insiderSentimentPage = 1;
const INSIDER_SENTIMENT_PAGE_SIZE = 50;
let insiderSentimentFilters = {
  minScore: "",
  minTrades: 1,
  minUniqueInsiders: 1,
  dateFrom: "",
  dateTo: "",
  sector: "",
  marketCap: "",
  search: "",
};
/** @type {object | null} */
let lastFirstTimeBuyersPayload = null;
let firstTimeBuyersLoading = false;
let firstTimeBuyersBound = false;
let firstTimeBuyersSortKey = "firstTimeBuyerScore";
let firstTimeBuyersSortDir = "desc";
let firstTimeBuyersPage = 1;
const FIRST_TIME_BUYERS_PAGE_SIZE = 50;
let firstTimeBuyersFilters = {
  minScore: 0,
  minYears: 3,
  firstEverOnly: false,
  dateFrom: "",
  dateTo: "",
  role: "",
  sector: "",
  marketCap: "",
  ticker: "",
  search: "",
};
/** @type {object | null} */
let lastHeavySellingPayload = null;
let heavySellingLoading = false;
let heavySellingBound = false;
let heavySellingSortKey = "heavySellingScore";
let heavySellingSortDir = "desc";
let heavySellingPage = 1;
const HEAVY_SELLING_PAGE_SIZE = 50;
let heavySellingFilters = {
  minScore: 0,
  minUniqueSellers: 0,
  minTransactionValue: "",
  clusterOnly: false,
  clusterWindowDays: 30,
  dateFrom: "",
  dateTo: "",
  role: "",
  sector: "",
  marketCap: "",
  ticker: "",
  search: "",
};
/** @type {object | null} */
let lastCompletelySoldPayload = null;
let completelySoldLoading = false;
let completelySoldBound = false;
let completelySoldSortKey = "previousPositionValueUsd";
let completelySoldSortDir = "desc";
let completelySoldPage = 1;
const INSTITUTION_COMPLETELY_SOLD_PAGE_SIZE = 30;
let completelySoldFilters = {
  quarter: "",
  sector: "",
  minValue: 0,
  search: "",
  minExits: 0,
};
/** @type {object | null} */
let lastInstitutionComparePayload = null;
let institutionCompareLoading = false;
let institutionCompareBound = false;
let institutionCompareTab = "top";
let institutionCompareSortKey = "valueA";
let institutionCompareSortDir = "desc";
let institutionCompareCikA = "";
let institutionCompareCikB = "";
let notableInvestorsBound = false;
let notableInvestorsQuery = "";
/** @type {string | null} */
let activeInstitutionCik = null;
/** @type {Array<{ name: string; cik: string; type: string }>} */
let trackedInstitutions = [];
/** @type {{ fetchedAt?: string; house?: unknown[]; senate?: unknown[] } | null} */
let politiciansRecentData = null;
let politiciansHubLoading = false;
let politiciansHubLoaded = false;
let politiciansHubControlsBound = false;
let politiciansHubFilters = { chamber: "all", sortKey: "date", sortDir: "desc" };
let activePoliticianHubView = "trades";
let politicianAccumulatedPeriod = "quarter";
let politicianAccumulatedChamber = "all";
let politicianPortfoliosPeriod = "quarter";
let politicianPortfoliosChamber = "all";
/** @type {object | null} */
let lastPoliticianMostAccumulated = null;
/** @type {object | null} */
let lastPoliticianLargestPortfolios = null;
let politicianMostAccumulatedLoading = false;
let politicianLargestPortfoliosLoading = false;
let politicianMostAccumulatedBound = false;
let politicianLargestPortfoliosBound = false;
let politicianAccumulatedSortKey = "netAmountUsd";
let politicianAccumulatedSortDir = "desc";
let politicianPortfoliosSortKey = "netPortfolioUsd";
let politicianPortfoliosSortDir = "desc";
let politicianAccumulatedFilters = { search: "", positiveOnly: false };
/** @type {object | null} */
let lastPoliticianRepeatBuyers = null;
let politicianRepeatBuyersLoading = false;
let politicianRepeatBuyersBound = false;
let politicianRepeatBuyersSortKey = "repeatBuyerScore";
let politicianRepeatBuyersSortDir = "desc";
let politicianRepeatBuyersPage = 1;
const POLITICIAN_REPEAT_BUYERS_PAGE_SIZE = 50;
let politicianRepeatBuyersFilters = {
  minScore: 0,
  minPurchases: 2,
  minStreak: 0,
  dateFrom: "",
  dateTo: "",
  chamber: "",
  politician: "",
  state: "",
  party: "",
  sector: "",
  marketCap: "",
  ticker: "",
  search: "",
};
/** @type {object | null} */
let lastPoliticianFirstTimeBuyers = null;
let politicianFirstTimeBuyersLoading = false;
let politicianFirstTimeBuyersBound = false;
let politicianFirstTimeBuyersSortKey = "transactionDate";
let politicianFirstTimeBuyersSortDir = "desc";
let politicianFirstTimeBuyersPage = 1;
const POLITICIAN_FIRST_TIME_BUYERS_PAGE_SIZE = 50;
let politicianFirstTimeBuyersFilters = {
  minYears: 3,
  firstRecordedOnly: false,
  dateFrom: "",
  dateTo: "",
  chamber: "",
  politician: "",
  state: "",
  party: "",
  sector: "",
  marketCap: "",
  ticker: "",
  search: "",
};
/** @type {object | null} */
let lastPoliticianHeavySelling = null;
let politicianHeavySellingLoading = false;
let politicianHeavySellingBound = false;
let politicianHeavySellingSortKey = "estimatedTotalSold";
let politicianHeavySellingSortDir = "desc";
let politicianHeavySellingPage = 1;
const POLITICIAN_HEAVY_SELLING_PAGE_SIZE = 50;
let politicianHeavySellingFilters = {
  multipleSellersOnly: false,
  consecutiveOnly: false,
  minUniqueSellers: 0,
  minEstimatedSale: "",
  windowDays: 30,
  dateFrom: "",
  dateTo: "",
  chamber: "",
  politician: "",
  state: "",
  party: "",
  sector: "",
  marketCap: "",
  ticker: "",
  search: "",
};
let politicianSectorPeriod = "quarter";
let politicianSectorChamber = "all";
let politicianSectorLoading = false;
let politicianSectorBound = false;
let politicianSectorSortKey = "tradeCount";
let politicianSectorSortDir = "desc";
let activePoliticianSectorSlug = "";
/** @type {object | null} */
let lastPoliticianSectorPayload = null;
/** @type {object | null} */
let lastPoliticianSectorDetailPayload = null;
/** @type {object | null} */
let lastPoliticianProfileSectorPayload = null;
let politicianSectorFilters = {
  dateFrom: "",
  dateTo: "",
  politician: "",
  state: "",
  transactionType: "",
  sector: "",
  search: "",
};
let activePoliticianKey = null;
let politiciansHubShowAllTrades = false;
const POLITICIANS_TRADES_INITIAL_COUNT = 20;

let insidersRecentData = null;
let insidersHubLoading = false;
let insidersHubLoaded = false;
let insidersHubControlsBound = false;
let insidersHubFilters = { signal: "high", sort: "recent" };
let activeInsiderKey = null;
let insidersHubShowAllTrades = false;
const INSIDERS_TRADES_INITIAL_COUNT = 20;
/** @type {Map<string, string>} */
const institutionCikByName = new Map();
/** @type {Record<string, unknown> | null} */
let lastInstitutionMeta = null;

const INSTITUTION_STRATEGY_CATEGORIES = [
  { key: "asset_manager", label: "Asset Managers" },
  { key: "hedge_fund", label: "Hedge Funds" },
  { key: "quant", label: "Quant Funds" },
  { key: "activist", label: "Activist Investors" },
];

const INSTITUTION_TYPE_LABELS = {
  asset_manager: "Asset Manager",
  hedge_fund: "Hedge Fund",
  quant: "Quant Fund",
  activist: "Activist Investor",
};

/** @type {{ query: string; category: string | null; sort: string }} */
let institutionHubFilters = { query: "", category: null, sort: "az" };
/** @type {Map<string, { positionCount: number | null; portfolioValueUsd: number | null }>} */
const institutionHubStats = new Map();
let institutionHubStatsLoading = false;
let institutionHubStatsReady = false;
let institutionHubControlsBound = false;
const INSTITUTION_HUB_PAGE_SIZE = 16;

const STOCK_HUB_COLLECTIONS = [
  "sp500",
  "institutional",
  "executive-insider",
  "revenue-growth",
  "fcf-leaders",
  "high-margin",
];
const STOCK_HUB_COUNT_IDS = {
  sp500: "stock-hub-sp500-count",
  institutional: "stock-hub-institutional-count",
  "executive-insider": "stock-hub-executive-count",
  "revenue-growth": "stock-hub-revenue-growth-count",
  "fcf-leaders": "stock-hub-fcf-count",
  "high-margin": "stock-hub-high-margin-count",
};
const STOCK_HUB_PAGE_SIZE = 24;
/** @type {null | "sp500" | "institutional" | "executive-insider" | "revenue-growth" | "fcf-leaders" | "high-margin"} */
let activeStockHubCollection = "sp500";
const STOCK_HUB_SECTOR_COLLECTIONS = new Set(["revenue-growth", "fcf-leaders", "high-margin"]);
let stockHubFilters = { query: "", sector: "" };
let stockHubSectorOptions = [];
let stockHubShowAll = false;
let stockHubControlsBound = false;
/** @type {Array<{ symbol: string; name: string; meta?: string; sector?: string; industry?: string }>} */
let stockHubRows = [];
let stockHubLoading = false;
let stockHubCountsPrefetched = false;
/** @type {Record<string, { loadedAt: number; rows: typeof stockHubRows; meta?: string }>} */
const stockHubCollectionCache = {};
let stockRecentlyActiveLoading = false;
let stockRecentlyActiveBound = false;
let stockRecentlyActiveSource = "all";
let stockRecentlyActiveFilters = { from: "", to: "" };
let lastStockRecentlyActivePayload = null;
let stocksMostAccumulatedLoading = false;
let stocksMostAccumulatedBound = false;
let stocksMostAccumulatedPeriod = "90d";
let stocksMostAccumulatedMarketCap = "";
let stocksMostAccumulatedSearch = "";
let stocksMostAccumulatedSortKey = "accumulationScore";
let stocksMostAccumulatedSortDir = "desc";
let stocksMostAccumulatedPage = 1;
const STOCKS_MOST_ACCUMULATED_PAGE_SIZE = 50;
/** @type {object | null} */
let lastStocksMostAccumulatedPayload = null;
let stocksOwnershipChangesLoading = false;
let stocksOwnershipChangesBound = false;
let stocksOwnershipChangesDirection = "increases";
let stocksOwnershipChangesQuarter = "latest";
let stocksOwnershipChangesMarketCap = "";
let stocksOwnershipChangesSector = "";
let stocksOwnershipChangesSearch = "";
let stocksOwnershipChangesSortKey = "changePct";
let stocksOwnershipChangesSortDir = "desc";
let stocksOwnershipChangesPage = 1;
const STOCKS_OWNERSHIP_CHANGES_PAGE_SIZE = 50;
/** @type {object | null} */
let lastStocksOwnershipChangesPayload = null;
let stocksHolderOverlapLoading = false;
let stocksHolderOverlapBound = false;
let stocksHolderOverlapTicker = "";
let stocksHolderOverlapMode = "weighted";
let stocksHolderOverlapMinInst = 1;
let stocksHolderOverlapMinPct = 0;
let stocksHolderOverlapSector = "";
let stocksHolderOverlapMarketCap = "";
let stocksHolderOverlapInstitutionType = "";
let stocksHolderOverlapPage = 1;
const STOCKS_HOLDER_OVERLAP_PAGE_SIZE = 50;
/** @type {object | null} */
let lastStocksHolderOverlapPayload = null;
let stocksOwnershipHistoryLoading = false;
let stocksOwnershipHistoryBound = false;
let stocksOwnershipHistoryQuarter = "";
let stocksOwnershipHistoryCategory = "";
let stocksOwnershipHistoryMarketCap = "";
let stocksOwnershipHistorySector = "";
let stocksOwnershipHistorySearch = "";
let stocksOwnershipHistoryMinGrowth = "";
let stocksOwnershipHistoryMaxOwn = "";
let stocksOwnershipHistoryMinHolders = "";
let stocksOwnershipHistorySortKey = "ownershipExpansionScore";
let stocksOwnershipHistorySortDir = "desc";
let stocksOwnershipHistoryPage = 1;
const STOCKS_OWNERSHIP_HISTORY_PAGE_SIZE = 50;
/** @type {object | null} */
let lastStocksOwnershipHistoryPayload = null;
let institutionHubShowAll = false;

const INSTITUTION_ACTIVITY_INITIAL_COUNT = 5;
const INSTITUTION_HOLDINGS_INITIAL_COUNT = 15;
const PORTFOLIO_POWERBAR_MAX_SEGMENTS = 12;
const PORTFOLIO_POWERBAR_COLORS = [
  "#3ee6b0",
  "#5b9cff",
  "#f5a623",
  "#b388ff",
  "#ff6b7a",
  "#4dd0e1",
  "#aed581",
  "#ff8a65",
  "#9575cd",
  "#4fc3f7",
  "#dce775",
  "#f06292",
];
const PORTFOLIO_POWERBAR_OTHER_COLOR = "#5a6478";
/** @type {Array<object>} */
let lastInstitutionAdds = [];
/** @type {Array<object>} */
let lastInstitutionTrims = [];
/** @type {Array<object>} */
let lastInstitutionExits = [];
/** @type {Array<object>} */
let lastInstitutionNewPositions = [];
/** @type {Array<object>} */
let lastInstitutionActivityAll = [];
let institutionAddsExpanded = false;
let institutionTrimsExpanded = false;
let institutionExitsExpanded = false;
let institutionNewExpanded = false;
/** @type {Array<object>} */
let lastInstitutionHoldings = [];
/** @type {Record<string, unknown> | null} */
let lastInstitutionHoldingsMeta = null;
let institutionHoldingsExpanded = false;
let institutionHoldingsSortKey = "valueUsd";
let institutionHoldingsSortDir = "desc";
let lastInstitutionOptionsCalls = [];
let lastInstitutionOptionsPuts = [];
let lastInstitutionOptionsByStock = [];
let lastInstitutionCommonExposureUsd = 0;
let institutionOptionsStocksExpanded = false;
let institutionOptionsSortKey = "totalExposure";
let institutionOptionsSortDir = "desc";
let institutionAddsSortKey = "valueChangeUsd";
let institutionAddsSortDir = "desc";
let institutionTrimsSortKey = "valueChangeUsd";
let institutionTrimsSortDir = "asc";
let institutionExitsSortKey = "previousValueUsd";
let institutionExitsSortDir = "desc";
let institutionNewSortKey = "newValue";
let institutionNewSortDir = "desc";
let institutionActivitySortKey = "valueChangeUsd";
let institutionActivitySortDir = "desc";

const ACTIVITY_INITIAL_COUNT = 5;

/** @type {Array<{ fundName: string; filerCik?: string; sharesChange: number; currentShares: number; previousShares: number; valueChangeUsd: number | null }>} */
let lastActivityBuyers = [];
/** @type {Array<{ fundName: string; filerCik?: string; sharesChange: number; currentShares: number; previousShares: number; valueChangeUsd: number | null }>} */
let lastActivitySellers = [];
/** @type {Array<{ fundName: string; filerCik?: string; shares: number; previousShares: number; valueUsd: number | null; previousValueUsd: number | null }>} */
let lastActivityExits = [];
/** @type {Array<{ fundName: string; filerCik?: string; shares: number; valueUsd: number | null }>} */
let lastActivityNewPositions = [];
let activityBuyersExpanded = false;
let activitySellersExpanded = false;
let activityExitsExpanded = false;
let activityNewExpanded = false;
let activityBuyersSortKey = "sharesChange";
let activityBuyersSortDir = "desc";
let activitySellersSortKey = "sharesChange";
let activitySellersSortDir = "asc";
let activityExitsSortKey = "previousValueUsd";
let activityExitsSortDir = "desc";
let activityNewSortKey = "valueUsd";
let activityNewSortDir = "desc";
/** @type {{ currentQuarter?: string; previousQuarter?: string | null }} */
let lastActivityQuarterMeta = {};

const OPTIONS_INITIAL_COUNT = 5;

/** @type {Array<{ fundName: string; contracts: number; valueUsd: number | null }>} */
let lastOptionsCalls = [];
/** @type {Array<{ fundName: string; contracts: number; valueUsd: number | null }>} */
let lastOptionsPuts = [];
/** @type {Array<{ fundName: string; totalContracts: number; commonValueUsd: number; callValueUsd: number; putValueUsd: number; biasScore: number | null; biasLabel: string; biasTone: string }>} */
let lastOptionsByFund = [];
let optionsFundsExpanded = false;
/** @type {number | null} */
let lastWeightedCommonExposure = null;

const OPTIONS_CALL_WEIGHT = 0.7;
const OPTIONS_PUT_WEIGHT = 0.7;

/** @type {Array<{ form: string; filingDate: string; accessionNumber: string; description: string; href: string }>} */
let lastSecFilings = [];
let lastFilingsFundamentals = null;
/** Cached SEC filings used for category score cards (Signals tab). */
let lastSecFilingsForScores = null;
/** @type {null | { sector?: string | null; industry?: string | null; sic?: string | null; sicDescription?: string | null }} */
let lastStockClassification = null;
/** @type {string | null} */
let filingsFundamentalsSymbol = null;

const SEC_FILINGS_INITIAL_COUNT = 5;
let secFilingsExpanded = false;

/** @type {Array<{ title: string; publisher: string; link: string; publishedAt: string | null; thumbnailUrl: string | null }>} */
/** @type {Array<{ fundName: string; shares: number; valueUsd: number | null; pctOutstanding: number | null; sharesChangePct?: number | null; valueChangeUsd?: number | null; previousShares?: number | null }>} */
let lastOwnershipHolders = [];

const OWNERSHIP_INITIAL_COUNT = 10;
let ownershipExpanded = false;
/** @type {"fundName" | "shares" | "valueUsd" | "pctOutstanding" | "sharesChangePct" | "valueChangeUsd"} */
let ownershipHoldersSortKey = "valueUsd";
/** @type {"asc" | "desc"} */
let ownershipHoldersSortDir = "desc";
let lastOwnershipCurrency = "USD";
/** @type {number | null} */
let lastOwnershipStockPrice = null;
/** @type {{ currentQuarter?: string; previousQuarter?: string | null }} */
let lastOwnershipQuarterMeta = {};

async function apiJson(path, params = {}) {
  const u = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  }
  const res = await fetch(u);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body.message || body.error || text || res.statusText;
    throw new Error(typeof msg === "string" ? msg : res.statusText);
  }
  return body;
}

function loadSavedSymbols() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((s) => String(s || "").trim().toUpperCase())
      .filter((s) => /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/i.test(s));
  } catch {
    return [];
  }
}

function saveWatchlistSymbols() {
  const symbols = watchlist.map((w) => w.symbol);
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(symbols));
}

function setDashboardStatus(msg, isError = false) {
  const el = document.getElementById("dashboard-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("dashboard-status--error", Boolean(isError && msg));
}

function setChartFootnote(text) {
  const el = document.getElementById("chart-footnote");
  if (el) el.textContent = text;
}

function setSecSubtitle(text) {
  const el = document.getElementById("sec-subtitle");
  if (el) el.textContent = text;
}

function setOverviewDataSource(text) {
  const el = document.getElementById("overview-data-source");
  if (el) el.textContent = text;
}

function setOwnershipSubtitle(_text) {
  const el = document.getElementById("ownership-subtitle");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

function formatHoldingValueUsd(usd, currency = activeCurrency) {
  const x = Number(usd);
  if (!Number.isFinite(x)) return "—";
  return formatPrice(x, currency);
}

function resolveOwnershipStockPrice() {
  const fromMeta = lastOwnershipStockPrice;
  if (fromMeta != null && Number.isFinite(Number(fromMeta))) return Number(fromMeta);
  const fromStock = getDisplayStock()?.price;
  if (fromStock != null && Number.isFinite(Number(fromStock))) return Number(fromStock);
  const pts = lastPriceSeries?.points;
  if (pts?.length) {
    const last = Number(pts[pts.length - 1]?.y);
    if (Number.isFinite(last)) return last;
  }
  return null;
}

function resolveOwnershipRowValueUsd(h) {
  const direct = Number(h.valueUsd);
  if (Number.isFinite(direct)) return direct;
  const px = resolveOwnershipStockPrice();
  const shares = Number(h.shares);
  if (px != null && Number.isFinite(shares)) return shares * px;
  const legacyThousands = Number(h.valueUsdThousands);
  if (Number.isFinite(legacyThousands)) return legacyThousands * 1000;
  return null;
}

function enrichOwnershipHolders(holders) {
  const px = resolveOwnershipStockPrice();
  const enriched = holders.map((h) => {
    const valueUsd = resolveOwnershipRowValueUsd(h);
    let valueChangeUsd = h.valueChangeUsd ?? null;
    const prevSh = h.previousShares;
    if (
      valueChangeUsd == null &&
      px != null &&
      prevSh != null &&
      Number.isFinite(Number(prevSh))
    ) {
      const curVal =
        valueUsd ?? (Number.isFinite(Number(h.shares)) ? Number(h.shares) * px : null);
      if (curVal != null) {
        valueChangeUsd = Math.round((curVal - Number(prevSh) * px) * 100) / 100;
      }
    }
    return {
      ...h,
      valueUsd: valueUsd ?? h.valueUsd ?? null,
      valueChangeUsd,
    };
  });
  return enriched;
}

function sortOwnershipHolders(holders) {
  const key = ownershipHoldersSortKey;
  const dir = ownershipHoldersSortDir === "asc" ? 1 : -1;
  return [...holders].sort((a, b) => {
    if (key === "fundName") {
      const byName = String(a.fundName || "").localeCompare(String(b.fundName || ""), undefined, {
        sensitivity: "base",
      });
      if (byName !== 0) return byName * dir;
      return (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0);
    }
    const ax = Number(a[key]);
    const bx = Number(b[key]);
    const aOk = Number.isFinite(ax);
    const bOk = Number.isFinite(bx);
    if (!aOk && !bOk) {
      return String(a.fundName || "").localeCompare(String(b.fundName || ""), undefined, {
        sensitivity: "base",
      });
    }
    if (!aOk) return 1;
    if (!bOk) return -1;
    if (bx !== ax) return (ax - bx) * dir;
    return String(a.fundName || "").localeCompare(String(b.fundName || ""), undefined, {
      sensitivity: "base",
    });
  });
}

function updateOwnershipHoldersSortButtons() {
  document.querySelectorAll("[data-ownership-holders-sort]").forEach((btn) => {
    const key = btn.getAttribute("data-ownership-holders-sort");
    const active = key === ownershipHoldersSortKey;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    btn.classList.toggle("is-active", active);
    btn.dataset.sortDir = active ? ownershipHoldersSortDir : "";
    btn.textContent = active
      ? `${label} ${ownershipHoldersSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });
}

function formatShareCount(shares) {
  const x = Number(shares);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function renderOwnershipHoldersBody(html) {
  const body = document.getElementById("ownership-holders-body");
  if (body) body.innerHTML = html;
}

function renderOwnershipEmpty(msg) {
  lastOwnershipHolders = [];
  lastOwnershipQuarterMeta = {};
  ownershipExpanded = false;
  renderOwnershipHoldersBody(
    `<tr><td colspan="6" class="trades-table__empty">${escapeHtml(msg)}</td></tr>`
  );
  updateOwnershipMoreControl();
  setOwnershipSubtitle("Institutional holders from 13F filings");
}

/** Format raw USD value changes for institutional activity / ownership tables. */
/** Activity / ownership value cells: API fields are raw USD dollars. */
function formatValueAddedMillions(usd) {
  return formatSignedUsdCompact(usd);
}

function renderOwnershipChangeCell(h) {
  const sharesChangePct = h.sharesChangePct;
  const prevQ = lastOwnershipQuarterMeta.previousQuarter;
  const curQ = lastOwnershipQuarterMeta.currentQuarter;
  const title =
    prevQ && curQ
      ? `Common-stock shares: ${curQ} vs ${prevQ} (latest 13F filing per quarter; excludes puts/calls)`
      : "Quarter-over-quarter common-stock share change";
  if (sharesChangePct == null || !Number.isFinite(Number(sharesChangePct))) {
    return `<td class="mono num ownership-change" title="${escapeHtml(title)}">—</td>`;
  }
  const pct = Number(sharesChangePct);
  const dir = pct >= 0 ? "up" : "down";
  const label = formatChange(pct);
  return `<td class="mono num ownership-change" title="${escapeHtml(title)}"><span class="change-pill change-pill--${dir}">${escapeHtml(label)}</span></td>`;
}

function renderOwnershipValueAddedCell(h) {
  const prevQ = lastOwnershipQuarterMeta.previousQuarter;
  const curQ = lastOwnershipQuarterMeta.currentQuarter;
  const title =
    prevQ && curQ
      ? `13F value of share-count change: ${curQ} vs ${prevQ} (quarter-end reported price)`
      : "Dollar value of the share-count change at 13F quarter-end price";
  const valueChangeUsd = h.valueChangeUsd;
  if (valueChangeUsd == null || !Number.isFinite(Number(valueChangeUsd))) {
    return `<td class="mono num ownership-value-added" title="${escapeHtml(title)}">—</td>`;
  }
  const x = Number(valueChangeUsd);
  const dir = x >= 0 ? "up" : "down";
  const label = formatValueAddedMillions(x);
  return `<td class="mono num ownership-value-added" title="${escapeHtml(title)}"><span class="change-pill change-pill--${dir}">${escapeHtml(label)}</span></td>`;
}

function institutionFundLinkHtml(fundName, filerCik) {
  const name = fundName || "—";
  const cik = filerCik || institutionCikByName.get(name);
  const label = escapeHtml(name);
  if (!cik) return `<span class="ownership-fund__name">${label}</span>`;
  const bare = bareInstitutionCik(cik);
  const href = institutionPath(bare);
  return `<a href="${href}" class="ownership-fund__link" data-institution-cik="${escapeHtml(bare)}">${label}</a>`;
}

function institutionStockLinkHtml(ticker, issuerName) {
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const name = issuerName ? String(issuerName).trim() : "";
  const label = escapeHtml(name || sym || "—");
  if (!sym) return label;
  return `<a href="${stockPath(sym)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(sym)}">${label}</a>`;
}

function renderOwnershipRow(h) {
  const fund = institutionFundLinkHtml(h.fundName, h.filerCik);
  return `
    <tr>
      <td>${fund}</td>
      <td class="mono num">${escapeHtml(formatShareCount(h.shares))}</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(resolveOwnershipRowValueUsd(h), lastOwnershipCurrency))}</td>
      <td class="mono num">${escapeHtml(formatPercentValue(h.pctOutstanding, false))}</td>
      ${renderOwnershipChangeCell(h)}
      ${renderOwnershipValueAddedCell(h)}
    </tr>
  `;
}

function updateOwnershipMoreControl() {
  const foot = document.getElementById("ownership-foot");
  const btn = document.getElementById("ownership-more-btn");
  if (!foot || !btn) return;

  const extra = lastOwnershipHolders.length - OWNERSHIP_INITIAL_COUNT;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  btn.textContent = ownershipExpanded
    ? "Show fewer holders"
    : `Show more holders (${extra})`;
  btn.setAttribute("aria-expanded", ownershipExpanded ? "true" : "false");
}

function renderOwnershipTable() {
  if (!lastOwnershipHolders.length) {
    renderOwnershipHoldersBody(
      `<tr><td colspan="6" class="trades-table__empty">No institutional holders found for this quarter. Confirm 13F data is ingested for this ticker.</td></tr>`
    );
    updateOwnershipMoreControl();
    return;
  }

  const holders = sortOwnershipHolders(enrichOwnershipHolders(lastOwnershipHolders));
  const visible = ownershipExpanded
    ? holders
    : holders.slice(0, OWNERSHIP_INITIAL_COUNT);

  updateOwnershipHoldersSortButtons();
  renderOwnershipHoldersBody(visible.map(renderOwnershipRow).join(""));
  updateOwnershipMoreControl();
}

async function fetchTopHolders(symbol) {
  const sym = encodeURIComponent(symbol);
  return apiJson(`/api/stocks/${sym}/top-holders`, { limit: 100 });
}

function parseStockRoute(pathname) {
  const m = String(pathname || "").match(
    /^\/stock\/([A-Za-z0-9.\^-]+)(?:\/([a-z0-9-]+))?\/?$/
  );
  if (!m) return null;
  const tab = m[2] || "overview";
  return {
    symbol: m[1].toUpperCase(),
    tab: STOCK_TABS.includes(tab) ? tab : "overview",
  };
}

function isLandingPath(pathname) {
  const p = String(pathname || "/");
  return p === "/" || p === "";
}

function isAuthRoutePath(pathname) {
  return isAuthPath(pathname);
}

function isPremiumPath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  return p === "/pricing" || p === "/premium";
}

function isFaqPath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  return p === "/faq";
}

function isMethodologyPath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  return p === "/methodology";
}

function isDataSourcesPath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  return p === "/data-sources";
}

function isAboutPath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  return p === "/about";
}

function isContactPath(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  return p === "/contact";
}

const LEGAL_PAGES = {
  cookies: { path: "/legal/cookies", viewId: "view-legal-cookies", title: "Cookie Policy — TradeAtlant" },
  privacy: { path: "/legal/privacy", viewId: "view-legal-privacy", title: "Privacy Policy — TradeAtlant" },
  terms: { path: "/legal/terms", viewId: "view-legal-terms", title: "Terms of Service — TradeAtlant" },
  disclaimer: { path: "/legal/disclaimer", viewId: "view-legal-disclaimer", title: "Disclaimer — TradeAtlant" },
  impressum: { path: "/legal/impressum", viewId: "view-legal-impressum", title: "Impressum — TradeAtlant" },
};

function parseLegalPageKey(pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  for (const [key, page] of Object.entries(LEGAL_PAGES)) {
    if (p === page.path) return key;
  }
  return null;
}

const LANDING_PAGE_TITLE = "TradeAtlant — Stock & institutional research";
const PREMIUM_PAGE_TITLE = "Premium — TradeAtlant";
const FAQ_PAGE_TITLE = "FAQ — TradeAtlant";
const METHODOLOGY_PAGE_TITLE = "Methodology — TradeAtlant";
const DATA_SOURCES_PAGE_TITLE = "Data Sources — TradeAtlant";
const ABOUT_PAGE_TITLE = "About — TradeAtlant";
const CONTACT_PAGE_TITLE = "Contact — TradeAtlant";
const APP_PAGE_TITLE = "TradeAtlant";

function hidePremiumView() {
  const premium = document.getElementById("view-premium");
  if (premium) premium.hidden = true;
  document.body.classList.remove("is-premium");
}

function hideFaqView() {
  const faq = document.getElementById("view-faq");
  if (faq) faq.hidden = true;
  document.body.classList.remove("is-faq");
}

function hideMethodologyView() {
  const page = document.getElementById("view-methodology");
  if (page) page.hidden = true;
  document.body.classList.remove("is-methodology");
}

function hideDataSourcesView() {
  const page = document.getElementById("view-data-sources");
  if (page) page.hidden = true;
  document.body.classList.remove("is-data-sources");
}

function hideAboutView() {
  const page = document.getElementById("view-about");
  if (page) page.hidden = true;
  document.body.classList.remove("is-about");
}

function hideContactView() {
  const page = document.getElementById("view-contact");
  if (page) page.hidden = true;
  document.body.classList.remove("is-contact");
}

function hideLegalView() {
  for (const page of Object.values(LEGAL_PAGES)) {
    const el = document.getElementById(page.viewId);
    if (el) el.hidden = true;
  }
  document.body.classList.remove("is-legal-page");
}

function hideInfoViews() {
  hidePremiumView();
  hideFaqView();
  hideMethodologyView();
  hideDataSourcesView();
  hideAboutView();
  hideContactView();
  hideLegalView();
}

function showPremiumView(visible) {
  if (!visible) {
    hidePremiumView();
    return;
  }
  const premium = document.getElementById("view-premium");
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  hideAuthRoute();
  hideFaqView();
  hideMethodologyView();
  hideDataSourcesView();
  hideAboutView();
  hideContactView();
  hideLegalView();
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (premium) premium.hidden = false;
  document.body.classList.remove("is-landing");
  document.body.classList.add("is-premium");
  document.title = PREMIUM_PAGE_TITLE;
  clearMobileOverlays();
  closeTopSearch();
  setDashboardStatus("");
}

function showFaqView(visible) {
  if (!visible) {
    hideFaqView();
    return;
  }
  const faq = document.getElementById("view-faq");
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  hideAuthRoute();
  hidePremiumView();
  hideMethodologyView();
  hideDataSourcesView();
  hideAboutView();
  hideContactView();
  hideLegalView();
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (faq) faq.hidden = false;
  document.body.classList.remove("is-landing");
  document.body.classList.add("is-faq");
  document.title = FAQ_PAGE_TITLE;
  clearMobileOverlays();
  closeTopSearch();
  setDashboardStatus("");
  window.scrollTo(0, 0);
}

function showMethodologyView(visible) {
  if (!visible) {
    hideMethodologyView();
    return;
  }
  const page = document.getElementById("view-methodology");
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  hideAuthRoute();
  hidePremiumView();
  hideFaqView();
  hideDataSourcesView();
  hideAboutView();
  hideContactView();
  hideLegalView();
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (page) page.hidden = false;
  document.body.classList.remove("is-landing");
  document.body.classList.add("is-methodology");
  document.title = METHODOLOGY_PAGE_TITLE;
  clearMobileOverlays();
  closeTopSearch();
  setDashboardStatus("");
  window.scrollTo(0, 0);
}

function showDataSourcesView(visible) {
  if (!visible) {
    hideDataSourcesView();
    return;
  }
  const page = document.getElementById("view-data-sources");
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  hideAuthRoute();
  hidePremiumView();
  hideFaqView();
  hideMethodologyView();
  hideAboutView();
  hideContactView();
  hideLegalView();
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (page) page.hidden = false;
  document.body.classList.remove("is-landing");
  document.body.classList.add("is-data-sources");
  document.title = DATA_SOURCES_PAGE_TITLE;
  clearMobileOverlays();
  closeTopSearch();
  setDashboardStatus("");
  window.scrollTo(0, 0);
}

function showAboutView(visible) {
  if (!visible) {
    hideAboutView();
    return;
  }
  const page = document.getElementById("view-about");
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  hideAuthRoute();
  hidePremiumView();
  hideFaqView();
  hideMethodologyView();
  hideDataSourcesView();
  hideContactView();
  hideLegalView();
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (page) page.hidden = false;
  document.body.classList.remove("is-landing");
  document.body.classList.add("is-about");
  document.title = ABOUT_PAGE_TITLE;
  clearMobileOverlays();
  closeTopSearch();
  setDashboardStatus("");
  window.scrollTo(0, 0);
}

function showContactView(visible) {
  if (!visible) {
    hideContactView();
    return;
  }
  const page = document.getElementById("view-contact");
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  hideAuthRoute();
  hidePremiumView();
  hideFaqView();
  hideMethodologyView();
  hideDataSourcesView();
  hideAboutView();
  hideLegalView();
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (page) page.hidden = false;
  document.body.classList.remove("is-landing");
  document.body.classList.add("is-contact");
  document.title = CONTACT_PAGE_TITLE;
  clearMobileOverlays();
  closeTopSearch();
  setDashboardStatus("");
  window.scrollTo(0, 0);
}

function showLegalView(key) {
  if (!key) {
    hideLegalView();
    return;
  }
  const config = LEGAL_PAGES[key];
  if (!config) {
    hideLegalView();
    return;
  }
  const page = document.getElementById(config.viewId);
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  hideAuthRoute();
  hidePremiumView();
  hideFaqView();
  hideMethodologyView();
  hideDataSourcesView();
  hideAboutView();
  hideContactView();
  hideLegalView();
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (page) page.hidden = false;
  document.body.classList.remove("is-landing");
  document.body.classList.add("is-legal-page");
  document.title = config.title;
  clearMobileOverlays();
  closeTopSearch();
  setDashboardStatus("");
  window.scrollTo(0, 0);
}

function showLandingView(visible) {
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  if (landing) landing.hidden = !visible;
  if (shell) shell.hidden = visible;
  if (visible) hideInfoViews();
  document.body.classList.toggle("is-landing", visible);
  document.title = visible ? LANDING_PAGE_TITLE : APP_PAGE_TITLE;
  if (visible) {
    hideAuthRoute();
    clearMobileOverlays();
    closeTopSearch();
    setDashboardStatus("");
  }
}

function navigateToLanding() {
  if (isLandingPath(window.location.pathname)) {
    showLandingView(true);
    return;
  }
  history.pushState({ landing: true }, "", "/");
  showLandingView(true);
}

let activePulseTab = "movers";

async function refreshSidebarMarketPanels() {
  setSidebarMarketPanelsLoading();
  await Promise.allSettled([
    refreshPulseDiscoveriesSidebar(),
    refreshPulseActivitySidebar(),
    refreshPulseAccumulatedSidebar(),
  ]);
}

function pulseSkeletonHtml(count = 4) {
  return Array.from({ length: count }, () => `
    <li class="pulse-skeleton" aria-hidden="true">
      <div class="pulse-skeleton__lines">
        <div class="pulse-skeleton__left">
          <div class="pulse-skeleton__bar pulse-skeleton__bar--sym"></div>
          <div class="pulse-skeleton__bar pulse-skeleton__bar--name"></div>
        </div>
        <div class="pulse-skeleton__right">
          <div class="pulse-skeleton__bar pulse-skeleton__bar--price"></div>
          <div class="pulse-skeleton__bar pulse-skeleton__bar--chg"></div>
        </div>
      </div>
    </li>`).join("");
}

function pulseEmptyHtml(message) {
  return `<li class="pulse-empty"><p class="pulse-empty__text">${escapeHtml(message)}</p></li>`;
}

function setSidebarMarketPanelsLoading() {
  const skeleton = pulseSkeletonHtml(4);
  for (const id of [
    "pulse-discoveries-preview",
    "market-movers-gainers-preview",
    "market-movers-losers-preview",
    "market-movers-volume-preview",
  ]) {
    const list = document.getElementById(id);
    if (list) list.innerHTML = skeleton;
  }
}

function setPulseTab(tab) {
  activePulseTab = tab;
  const section = document.getElementById("market-pulse-section");
  if (!section) return;
  section.querySelectorAll("[data-pulse-tab]").forEach((btn) => {
    const active = btn.getAttribute("data-pulse-tab") === tab;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  section.querySelectorAll("[data-pulse-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-pulse-panel") !== tab;
  });
}

function setupMarketPulseTabs() {
  document.getElementById("market-pulse-section")?.querySelectorAll("[data-pulse-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-pulse-tab");
      if (tab) setPulseTab(tab);
    });
  });
}

async function enterAppFromLanding(mode) {
  showLandingView(false);
  if (mode === "institutions") {
    await ensureInstitutionsIndex();
    activeInstitutionCik = null;
    activeInstitutionHubView = "directory";
    setExploreMode("institutions", { navigate: true });
    void refreshSidebarMarketPanels();
    return;
  }
  if (mode === "insiders") {
    activeInsiderKey = null;
    activeInsiderHubView = "trades";
    setExploreMode("insiders", { navigate: true });
    void refreshSidebarMarketPanels();
    return;
  }
  if (mode === "politicians") {
    activePoliticianKey = null;
    activePoliticianHubView = "trades";
    setExploreMode("politicians", { navigate: true });
    void refreshSidebarMarketPanels();
    return;
  }
  if (mode === "signals") {
    setExploreMode("signals", { navigate: false });
    navigateToSignalsHub();
    void refreshSidebarMarketPanels();
    return;
  }
  if (mode === "tools") {
    setExploreMode("tools", { navigate: false });
    navigateToToolsHub();
    void refreshSidebarMarketPanels();
    return;
  }
  setExploreMode("stocks", { navigate: false });
  navigateToStocksHub();
  void refreshSidebarMarketPanels();
}

function stockPath(symbol, tab = "overview") {
  const sym = encodeURIComponent(symbol);
  return tab === "overview" ? `/stock/${sym}` : `/stock/${sym}/${tab}`;
}

function bareInstitutionCik(cik) {
  return String(cik || "").replace(/^0+/, "") || "0";
}

function parseInstitutionRoute(pathname) {
  const m = String(pathname || "").match(
    /^\/institution\/(\d+)(?:\/(holdings|activity|options|performance|history))?\/?$/
  );
  if (!m) return null;
  const tab = m[2] || "holdings";
  return {
    cik: bareInstitutionCik(m[1]),
    tab: INSTITUTION_TABS.includes(tab) ? tab : "holdings",
  };
}

function parseAppRoute(pathname) {
  if (isLandingPath(pathname)) return { mode: "landing" };
  if (isAuthRoutePath(pathname)) return { mode: "auth" };
  if (isPremiumPath(pathname)) return { mode: "premium" };
  if (isFaqPath(pathname)) return { mode: "faq" };
  if (isMethodologyPath(pathname)) return { mode: "methodology" };
  if (isDataSourcesPath(pathname)) return { mode: "data-sources" };
  if (isAboutPath(pathname)) return { mode: "about" };
  if (isContactPath(pathname)) return { mode: "contact" };
  const legalKey = parseLegalPageKey(pathname);
  if (legalKey) return { mode: "legal", legalKey };
  const inst = parseInstitutionRoute(pathname);
  if (inst) return { mode: "institutions", hub: false, ...inst };
  if (pathname === "/institutions" || pathname.startsWith("/institutions/")) {
    if (pathname === "/institutions/performance" || pathname === "/institutions/proxy-performance") {
      return { mode: "institutions", hub: true, performanceRankings: true };
    }
    if (pathname === "/institutions/most-accumulated") {
      return { mode: "institutions", hub: true, mostAccumulated: true };
    }
    if (pathname === "/institutions/new-positions") {
      return { mode: "institutions", hub: true, newPositions: true };
    }
    if (pathname === "/institutions/completely-sold") {
      return { mode: "institutions", hub: true, completelySold: true };
    }
    if (pathname === "/institutions/compare") {
      return { mode: "institutions", hub: true, institutionCompare: true };
    }
    if (pathname === "/institutions/notable-investors") {
      return { mode: "institutions", hub: true, notableInvestors: true };
    }
    return { mode: "institutions", hub: true };
  }
  const pol = parsePoliticianRoute(pathname);
  if (pol) return { mode: "politicians", politicianKey: pol.key };
  if (pathname === "/politicians/most-accumulated") {
    return { mode: "politicians", hub: true, politicianHubView: "most-accumulated" };
  }
  if (pathname === "/politicians/largest-portfolios") {
    return { mode: "politicians", hub: true, politicianHubView: "largest-portfolios" };
  }
  if (pathname === "/politicians/repeat-buyers") {
    return { mode: "politicians", hub: true, politicianHubView: "repeat-buyers" };
  }
  if (pathname === "/politicians/first-time-buyers") {
    return { mode: "politicians", hub: true, politicianHubView: "first-time-buyers" };
  }
  if (pathname === "/politicians/heavy-selling") {
    return { mode: "politicians", hub: true, politicianHubView: "heavy-selling" };
  }
  if (pathname === "/politicians/sector-exposure") {
    return { mode: "politicians", hub: true, politicianHubView: "sector-exposure" };
  }
  const sectorDetail = pathname.match(/^\/politicians\/sector-exposure\/([^/]+)\/?$/);
  if (sectorDetail) {
    return {
      mode: "politicians",
      hub: true,
      politicianHubView: "sector-exposure",
      sectorSlug: decodeURIComponent(sectorDetail[1]),
    };
  }
  if (pathname === "/politicians" || pathname === "/politicians/trades") {
    return { mode: "politicians", hub: true, politicianHubView: "trades" };
  }
  const insider = parseInsiderRoute(pathname);
  if (insider) return { mode: "insiders", insiderKey: insider.key };
  if (pathname === "/insiders/clusters") {
    return { mode: "insiders", hub: true, insiderHubView: "clusters" };
  }
  if (pathname === "/insiders/conviction-buys") {
    return { mode: "insiders", hub: true, insiderHubView: "conviction-buys" };
  }
  if (pathname === "/insiders/repeat-buyers") {
    return { mode: "insiders", hub: true, insiderHubView: "repeat-buyers" };
  }
  if (pathname === "/insiders/sentiment") {
    return { mode: "insiders", hub: true, insiderHubView: "sentiment" };
  }
  if (pathname === "/insiders/first-time-buyers") {
    return { mode: "insiders", hub: true, insiderHubView: "first-time-buyers" };
  }
  if (pathname === "/insiders/heavy-selling") {
    return { mode: "insiders", hub: true, insiderHubView: "heavy-selling" };
  }
  if (pathname === "/insiders/trades" || pathname === "/insiders") {
    return { mode: "insiders", hub: true, insiderHubView: "trades" };
  }
  if (pathname.startsWith("/insiders/")) {
    return { mode: "insiders", hub: true, insiderHubView: "trades" };
  }
  if (pathname === "/signals/top-institution-new-entries") {
    return { mode: "signals", hub: true, signalsHubView: "top-institution-entries" };
  }
  const doubleSignalDetail = pathname.match(/^\/signals\/double-signal\/([^/]+)\/?$/);
  if (doubleSignalDetail) {
    return {
      mode: "signals",
      hub: true,
      signalsHubView: "double-signal",
      doubleSignalTicker: decodeURIComponent(doubleSignalDetail[1]).toUpperCase(),
    };
  }
  if (pathname === "/signals/double-signal") {
    return { mode: "signals", hub: true, signalsHubView: "double-signal" };
  }
  const tripleSignalDetail = pathname.match(/^\/signals\/triple-signal\/([^/]+)\/?$/);
  if (tripleSignalDetail) {
    return {
      mode: "signals",
      hub: true,
      signalsHubView: "triple-signal",
      tripleSignalTicker: decodeURIComponent(tripleSignalDetail[1]).toUpperCase(),
    };
  }
  if (pathname === "/signals/triple-signal") {
    return { mode: "signals", hub: true, signalsHubView: "triple-signal" };
  }
  if (pathname === "/signals/conflict-signals") {
    return { mode: "signals", hub: true, signalsHubView: "conflict-signals" };
  }
  if (pathname === "/signals/hidden-gems") {
    return { mode: "signals", hub: true, signalsHubView: "hidden-gems" };
  }
  if (pathname === "/signals/conviction-score") {
    return { mode: "signals", hub: true, signalsHubView: "conviction-score" };
  }
  if (pathname === "/signals/institutional-discovery") {
    return { mode: "signals", hub: true, signalsHubView: "institutional-discovery" };
  }
  if (pathname === "/signals/screener") {
    return { mode: "stocks", screener: true, redirectFrom: "/signals/screener" };
  }
  if (pathname === "/signals/smart-money") {
    return { mode: "signals", hub: true, signalsHubView: "smart-money" };
  }
  if (pathname === "/signals" || pathname.startsWith("/signals/")) {
    return { mode: "signals", hub: true, signalsHubView: "directory" };
  }
  if (pathname === "/tools/dcf" || pathname.startsWith("/tools/dcf/")) {
    return { mode: "tools", hub: true, toolsHubView: "dcf" };
  }
  if (pathname === "/tools/wacc" || pathname.startsWith("/tools/wacc/")) {
    return { mode: "tools", hub: true, toolsHubView: "wacc" };
  }
  if (pathname === "/tools/epv" || pathname.startsWith("/tools/epv/")) {
    return { mode: "tools", hub: true, toolsHubView: "epv" };
  }
  if (
    pathname === "/tools/ev" ||
    pathname.startsWith("/tools/ev/") ||
    pathname === "/tools/enterprise-value" ||
    pathname.startsWith("/tools/enterprise-value/")
  ) {
    return { mode: "tools", hub: true, toolsHubView: "ev" };
  }
  if (
    pathname === "/tools/pe" ||
    pathname.startsWith("/tools/pe/") ||
    pathname === "/tools/pe-valuation" ||
    pathname.startsWith("/tools/pe-valuation/")
  ) {
    return { mode: "tools", hub: true, toolsHubView: "pe" };
  }
  if (
    pathname === "/tools/ev-ebitda" ||
    pathname.startsWith("/tools/ev-ebitda/") ||
    pathname === "/tools/evebitda" ||
    pathname.startsWith("/tools/evebitda/")
  ) {
    return { mode: "tools", hub: true, toolsHubView: "evebitda" };
  }
  if (
    pathname === "/tools/fcf-yield" ||
    pathname.startsWith("/tools/fcf-yield/") ||
    pathname === "/tools/fcfyield" ||
    pathname.startsWith("/tools/fcfyield/")
  ) {
    return { mode: "tools", hub: true, toolsHubView: "fcfyield" };
  }
  if (
    pathname === "/tools/similar-stocks" ||
    pathname.startsWith("/tools/similar-stocks/") ||
    pathname === "/tools/similar" ||
    pathname.startsWith("/tools/similar/")
  ) {
    return { mode: "tools", hub: true, toolsHubView: "similar" };
  }
  if (pathname === "/tools" || pathname.startsWith("/tools/")) {
    return { mode: "tools", hub: true, toolsHubView: "directory" };
  }
  if (pathname === "/stocks/screener") {
    return { mode: "stocks", screener: true };
  }
  if (pathname === "/stocks/recently-active") {
    return { mode: "stocks", recentlyActive: true };
  }
  if (pathname === "/stocks/most-accumulated") {
    return { mode: "stocks", stocksMostAccumulated: true };
  }
  if (pathname === "/stocks/ownership-changes") {
    return { mode: "stocks", stocksOwnershipChanges: true };
  }
  if (pathname === "/stocks/holder-overlap") {
    return { mode: "stocks", stocksHolderOverlap: true };
  }
  if (pathname === "/stocks/ownership-history") {
    return { mode: "stocks", stocksOwnershipHistory: true };
  }
  if (pathname === "/stocks/compare" || pathname === "/stocks/stock-comparison") {
    return { mode: "stocks", stocksCompare: true };
  }
  if (pathname === "/stocks") {
    return { mode: "stocks" };
  }
  // Legacy Yahoo earnings calendar route → stocks hub
  if (pathname === "/earnings-calendar" || pathname.startsWith("/earnings-calendar/")) {
    return { mode: "stocks" };
  }
  const stock = parseStockRoute(pathname);
  if (stock) return { mode: "stocks", ...stock };
  return { mode: "stocks" };
}

function institutionPath(cik, tab = "holdings") {
  const bare = bareInstitutionCik(cik);
  return tab === "holdings" ? `/institution/${bare}` : `/institution/${bare}/${tab}`;
}

function institutionTabFromHref(href) {
  const path = String(href || "");
  if (path.includes("/performance")) return "performance";
  if (path.includes("/options")) return "options";
  if (path.includes("/activity")) return "activity";
  if (path.includes("/history")) return "history";
  return "holdings";
}

function politicianKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^the honorable\s+/i, "")
    .replace(/^hon\.?\s+/i, "")
    .replace(/^rep\.?\s+/i, "")
    .replace(/^sen\.?\s+/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function politicianSectorPath(slug) {
  return slug ? `/politicians/sector-exposure/${encodeURIComponent(slug)}` : "/politicians/sector-exposure";
}

function politicianPath(key) {
  return key ? `/politicians/${encodeURIComponent(key)}` : "/politicians";
}

function parsePoliticianRoute(pathname) {
  const m = String(pathname || "").match(/^\/politicians\/([^/]+)\/?$/);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  if (slug === "most-accumulated" || slug === "largest-portfolios" || slug === "trades" || slug === "sector-exposure" || slug === "repeat-buyers" || slug === "first-time-buyers" || slug === "heavy-selling") {
    return null;
  }
  return { key: slug };
}

function insiderKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function insiderPath(key) {
  return key ? `/insiders/${encodeURIComponent(key)}` : "/insiders/trades";
}

const INSIDER_HUB_RESERVED = new Set([
  "clusters",
  "trades",
  "conviction-buys",
  "repeat-buyers",
  "sentiment",
  "first-time-buyers",
  "heavy-selling",
]);

function parseInsiderRoute(pathname) {
  const m = String(pathname || "").match(/^\/insiders\/([^/]+)\/?$/);
  if (!m) return null;
  const key = decodeURIComponent(m[1]);
  if (INSIDER_HUB_RESERVED.has(key)) return null;
  return { key };
}

function insiderHubPath(view = activeInsiderHubView) {
  if (view === "clusters") return "/insiders/clusters";
  if (view === "conviction-buys") return "/insiders/conviction-buys";
  if (view === "repeat-buyers") return "/insiders/repeat-buyers";
  if (view === "sentiment") return "/insiders/sentiment";
  if (view === "first-time-buyers") return "/insiders/first-time-buyers";
  if (view === "heavy-selling") return "/insiders/heavy-selling";
  return "/insiders/trades";
}

function updateExploreNav() {
  const track = document.getElementById("workspace-selector-track");
  document.querySelectorAll(".explore-nav__btn").forEach((btn) => {
    const on = btn.dataset.explore === activeExploreMode;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-current", on ? "page" : "false");
  });
  if (track) track.dataset.active = activeExploreMode;
}

function updateTopSearchForMode() {
  const input = document.getElementById("top-search-input");
  const label = document.getElementById("top-search-label");
  if (activeExploreMode === "institutions") {
    if (input) input.placeholder = "Search institutions…";
    if (label) label.textContent = "Search institutions";
  } else if (activeExploreMode === "insiders") {
    if (input) input.placeholder = "Search insiders…";
    if (label) label.textContent = "Search insiders";
  } else if (activeExploreMode === "politicians") {
    if (input) input.placeholder = "Search politicians…";
    if (label) label.textContent = "Search politicians";
  } else if (activeExploreMode === "signals") {
    if (input) input.placeholder = "Search signals…";
    if (label) label.textContent = "Search signals";
  } else if (activeExploreMode === "tools") {
    if (input) input.placeholder = "Search tools…";
    if (label) label.textContent = "Search tools";
  } else {
    if (input) input.placeholder = "Search stocks…";
    if (label) label.textContent = "Search stocks";
  }
}

function showMainEntityView() {
  const stocks = document.getElementById("view-stocks");
  const institutions = document.getElementById("view-institutions");
  const insiders = document.getElementById("view-insiders");
  const politicians = document.getElementById("view-politicians");
  const signals = document.getElementById("view-signals");
  const tools = document.getElementById("view-tools");
  if (stocks) stocks.hidden = activeExploreMode !== "stocks";
  if (institutions) institutions.hidden = activeExploreMode !== "institutions";
  if (insiders) insiders.hidden = activeExploreMode !== "insiders";
  if (politicians) politicians.hidden = activeExploreMode !== "politicians";
  if (signals) signals.hidden = activeExploreMode !== "signals";
  if (tools) tools.hidden = activeExploreMode !== "tools";
}

function isStockHubVisible() {
  return (
    activeExploreMode === "stocks" &&
    !getDisplayStock() &&
    !screenerOpen &&
    !recentlyActiveOpen &&
    !stocksMostAccumulatedOpen &&
    !stocksOwnershipChangesOpen &&
    !stocksHolderOverlapOpen &&
    !stocksOwnershipHistoryOpen &&
    !stocksCompareOpen
  );
}

function updateStocksView() {
  const hub = document.getElementById("stock-hub");
  const showHub = isStockHubVisible();
  if (hub) hub.hidden = !showHub;

  const overlayOpen =
    screenerOpen ||
    recentlyActiveOpen ||
    stocksMostAccumulatedOpen ||
    stocksOwnershipChangesOpen ||
    stocksHolderOverlapOpen ||
    stocksOwnershipHistoryOpen ||
    stocksCompareOpen;
  const screenerEl = document.getElementById("view-screener");
  const recentlyActiveEl = document.getElementById("view-stock-recent-activity");
  const mostAccumulatedEl = document.getElementById("view-stock-most-accumulated");
  const ownershipChangesEl = document.getElementById("view-stock-ownership-changes");
  const holderOverlapEl = document.getElementById("view-stock-holder-overlap");
  const ownershipHistoryEl = document.getElementById("view-stock-ownership-history");
  const compareEl = document.getElementById("view-stock-compare");
  if (screenerEl) screenerEl.hidden = !screenerOpen;
  if (recentlyActiveEl) recentlyActiveEl.hidden = !recentlyActiveOpen;
  if (mostAccumulatedEl) mostAccumulatedEl.hidden = !stocksMostAccumulatedOpen;
  if (ownershipChangesEl) ownershipChangesEl.hidden = !stocksOwnershipChangesOpen;
  if (holderOverlapEl) holderOverlapEl.hidden = !stocksHolderOverlapOpen;
  if (ownershipHistoryEl) ownershipHistoryEl.hidden = !stocksOwnershipHistoryOpen;
  if (compareEl) compareEl.hidden = !stocksCompareOpen;

  const hideDetail = showHub || overlayOpen;
  document
    .querySelectorAll(
      "#view-stocks > :not(#view-screener):not(#view-stock-recent-activity):not(#view-stock-most-accumulated):not(#view-stock-ownership-changes):not(#view-stock-holder-overlap):not(#view-stock-ownership-history):not(#view-stock-compare):not(#stock-hub)"
    )
    .forEach((el) => {
      // Tab panels must also respect the active tab, otherwise opening a stock
      // (which runs updateStocksView via renderHeader) would reveal every panel.
      if (el.classList.contains("stock-panel")) {
        el.hidden = hideDetail || el.dataset.stockPanel !== activeStockTab;
      } else {
        el.hidden = hideDetail;
      }
    });

  if (showHub) {
    void renderStockHub();
  }
  if (screenerOpen) void initScreenerHub();
  if (recentlyActiveOpen) void loadRecentlyActiveStocksPage();
  if (stocksMostAccumulatedOpen) void loadStocksMostAccumulatedPage();
  if (stocksOwnershipChangesOpen) void loadStocksOwnershipChangesPage();
  if (stocksHolderOverlapOpen) void loadStocksHolderOverlapPage();
  if (stocksOwnershipHistoryOpen) void loadStocksOwnershipHistoryPage();
  if (stocksCompareOpen) void loadStockComparePage();
}

function updateStocksOverlay() {
  updateStocksView();
}

function closeStocksOverlays() {
  screenerOpen = false;
  recentlyActiveOpen = false;
  stocksMostAccumulatedOpen = false;
  stocksOwnershipChangesOpen = false;
  stocksHolderOverlapOpen = false;
  stocksOwnershipHistoryOpen = false;
  stocksCompareOpen = false;
  updateStocksView();
}

function navigateToStocksHub() {
  previewStock = null;
  activeIndex = -1;
  setViewingSymbol(null);
  const switching = activeStockHubCollection !== "sp500";
  activeStockHubCollection = "sp500";
  if (switching) {
    stockHubRows = [];
    stockHubShowAll = false;
    stockHubFilters.sector = "";
    syncStockHubSectorSelect("");
  }
  closeStocksOverlays();
  if (window.location.pathname !== "/stocks") {
    history.pushState({ explore: "stocks", stockHub: true }, "", "/stocks");
  }
  renderWatchlist();
  renderHeader();
  updateStocksView();
}

function stockHubCollectionLabel(collection) {
  if (collection === "sp500") return "S&P 500";
  if (collection === "institutional") return "Institutional accumulation";
  if (collection === "executive-insider") return "Executive insider buying";
  if (collection === "revenue-growth") return "Revenue growth leaders";
  if (collection === "fcf-leaders") return "Free cash flow leaders";
  if (collection === "high-margin") return "High margin stocks";
  return "Stocks";
}

function formatStockHubFundamentalsPeriod(stock) {
  const period = String(stock.fiscalPeriod || "").toUpperCase();
  const year = stock.fiscalYear;
  if (period && Number.isFinite(Number(year))) return `${period} FY${year}`;
  if (stock.periodEnd) return String(stock.periodEnd).slice(0, 10);
  return "";
}

function syncStockHubSearchInputs(value) {
  const header = document.getElementById("stock-hub-search");
  const directory = document.getElementById("stock-directory-search");
  if (header && header.value !== value) header.value = value;
  if (directory && directory.value !== value) directory.value = value;
}

function clearStockHubFilters() {
  stockHubFilters = { query: "", sector: "" };
  stockHubShowAll = false;
  syncStockHubSearchInputs("");
  syncStockHubSectorSelect("");
  updateStockHubSectorField();
  updateStockHubFeatureRow();
  renderStockHub();
}

function stockHubCollectionCacheKey(collection) {
  if (STOCK_HUB_SECTOR_COLLECTIONS.has(collection)) {
    return `${collection}:${stockHubFilters.sector || ""}`;
  }
  return collection;
}

function syncStockHubSectorSelect(value) {
  const select = document.getElementById("stock-hub-sector-filter");
  if (select && select.value !== value) select.value = value;
}

function updateStockHubSectorField() {
  const field = document.getElementById("stock-hub-sector-field");
  if (!field) return;
  const show = Boolean(activeStockHubCollection && STOCK_HUB_SECTOR_COLLECTIONS.has(activeStockHubCollection));
  field.hidden = !show;
}

function populateStockHubSectorOptions(sectors) {
  const select = document.getElementById("stock-hub-sector-filter");
  if (!select) return;

  const next = Array.isArray(sectors)
    ? sectors.map((s) => String(s || "").trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
    : [];
  const same =
    next.length === stockHubSectorOptions.length &&
    next.every((value, index) => value === stockHubSectorOptions[index]);
  if (same) return;

  stockHubSectorOptions = next;
  const current = stockHubFilters.sector;
  select.innerHTML = `<option value="">All sectors</option>${next
    .map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`)
    .join("")}`;
  syncStockHubSectorSelect(current);
}

function fundamentalsCollectionApiPath(collection) {
  if (collection === "revenue-growth") return "/api/stocks/revenue-growth-leaders";
  if (collection === "fcf-leaders") return "/api/stocks/fcf-leaders";
  if (collection === "high-margin") return "/api/stocks/high-margin";
  return null;
}

function mapFundamentalsStockRow(stock, meta) {
  return {
    symbol: String(stock.ticker || "").toUpperCase(),
    name: String(stock.companyName || stock.ticker || ""),
    sector: stock.sector ? String(stock.sector) : "",
    industry: stock.industry ? String(stock.industry) : "",
    meta,
  };
}

function updateStockHubFeatureRow() {
  document.querySelectorAll("[data-stock-collection]").forEach((btn) => {
    const key = btn.getAttribute("data-stock-collection");
    const active = activeStockHubCollection === key;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  const heading = document.getElementById("stock-hub-directory-heading");
  if (heading) {
    heading.textContent = activeStockHubCollection
      ? stockHubCollectionLabel(activeStockHubCollection)
      : "Browse stocks";
  }
}

function setStockHubCollectionCount(collection, text) {
  const el = document.getElementById(STOCK_HUB_COUNT_IDS[collection]);
  if (el) el.textContent = text;
}

function stockHubPayloadCount(data) {
  // Prefer the returned list length so hub cards match the capped payload
  // (some APIs used to set `count` to the uncapped universe size).
  if (Array.isArray(data?.stocks)) return data.stocks.length;
  const fromCount = Number(data?.count);
  if (Number.isFinite(fromCount) && fromCount >= 0) return fromCount;
  return 0;
}

function formatStockHubCollectionCount(collection, n, extra = {}) {
  const noun = collection === "sp500" ? "stocks" : "tickers";
  const base = `${n} ${noun}`;
  return extra.suffix ? `${base} · ${extra.suffix}` : base;
}

async function prefetchStockHubCollectionCounts() {
  const jobs = [
    apiJson("/api/stocks/sp500").then((data) => {
      setStockHubCollectionCount("sp500", formatStockHubCollectionCount("sp500", stockHubPayloadCount(data)));
    }),
    apiJson("/api/stocks/institutional-accumulation", { limit: 200 }).then((data) => {
      setStockHubCollectionCount(
        "institutional",
        formatStockHubCollectionCount("institutional", stockHubPayloadCount(data), {
          suffix: data.currentQuarter || "",
        })
      );
    }),
    apiJson("/api/stocks/executive-insider-accumulation", { limit: 200, window: 90 }).then((data) => {
      setStockHubCollectionCount(
        "executive-insider",
        formatStockHubCollectionCount("executive-insider", stockHubPayloadCount(data), {
          suffix: data.lookbackDays ? `${data.lookbackDays}d` : "",
        })
      );
    }),
    apiJson("/api/stocks/revenue-growth-leaders", { limit: 200 }).then((data) => {
      setStockHubCollectionCount(
        "revenue-growth",
        formatStockHubCollectionCount("revenue-growth", stockHubPayloadCount(data))
      );
    }),
    apiJson("/api/stocks/fcf-leaders", { limit: 200 }).then((data) => {
      setStockHubCollectionCount(
        "fcf-leaders",
        formatStockHubCollectionCount("fcf-leaders", stockHubPayloadCount(data))
      );
    }),
    apiJson("/api/stocks/high-margin", { limit: 200 }).then((data) => {
      setStockHubCollectionCount(
        "high-margin",
        formatStockHubCollectionCount("high-margin", stockHubPayloadCount(data))
      );
    }),
  ];
  await Promise.allSettled(jobs);
}

function stockHubQueryMatches(row, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const sym = String(row.symbol || "").toLowerCase();
  const name = String(row.name || "").toLowerCase();
  return sym.includes(q) || name.includes(q);
}

function getFilteredStockHubRows() {
  return stockHubRows.filter((row) => stockHubQueryMatches(row, stockHubFilters.query));
}

function updateStockHubMoreControl(totalCount) {
  const foot = document.getElementById("stock-hub-more-foot");
  const btn = document.getElementById("stock-hub-more-btn");
  if (!foot || !btn) return;

  const extra = totalCount - STOCK_HUB_PAGE_SIZE;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  if (stockHubShowAll) {
    btn.textContent = "Show fewer";
    btn.setAttribute("aria-expanded", "true");
  } else {
    btn.textContent = `Show more (${extra})`;
    btn.setAttribute("aria-expanded", "false");
  }
}

async function loadStockHubCollection(collection) {
  if (!STOCK_HUB_COLLECTIONS.includes(collection)) return;

  const cacheKey = stockHubCollectionCacheKey(collection);
  const cached = stockHubCollectionCache[cacheKey];
  if (cached && Date.now() - cached.loadedAt < 5 * 60 * 1000) {
    stockHubRows = cached.rows;
    if (cached.sectors) populateStockHubSectorOptions(cached.sectors);
    return cached.meta || "";
  }

  stockHubLoading = true;
  const loading = document.getElementById("stock-hub-loading");
  if (loading) {
    loading.hidden = false;
    loading.textContent = `Loading ${stockHubCollectionLabel(collection).toLowerCase()}…`;
  }

  try {
    if (collection === "sp500") {
      const data = await apiJson("/api/stocks/sp500");
      stockHubRows = (Array.isArray(data.stocks) ? data.stocks : []).map((s) => ({
        symbol: String(s.symbol || "").toUpperCase(),
        name: String(s.name || s.companyName || s.symbol || ""),
        sector: s.sector ? String(s.sector) : "",
        industry: s.industry ? String(s.industry) : "",
      }));
      setStockHubCollectionCount(
        "sp500",
        formatStockHubCollectionCount("sp500", stockHubRows.length)
      );
      stockHubCollectionCache[collection] = {
        loadedAt: Date.now(),
        rows: stockHubRows,
        meta: data.updatedAt ? `Updated ${data.updatedAt.slice(0, 10)}` : "",
      };
      return stockHubCollectionCache[collection].meta || "";
    }

    if (collection === "institutional") {
      const data = await apiJson("/api/stocks/institutional-accumulation", { limit: 200 });
      if (!Array.isArray(data.stocks) || !data.stocks.length) {
        throw new Error(
          "No institutional accumulation data yet. Run npm run stocks:warm-institutional-accumulation, then restart the server."
        );
      }
      stockHubRows = (Array.isArray(data.stocks) ? data.stocks : []).map((s) => ({
        symbol: String(s.ticker || "").toUpperCase(),
        name: String(s.companyName || s.ticker || ""),
        sector: s.sector ? String(s.sector) : "",
        industry: s.industry ? String(s.industry) : "",
        meta: `+${formatShareCount(s.sharesBought)} shares · ${s.institutionCount} funds`,
      }));
      setStockHubCollectionCount(
        "institutional",
        formatStockHubCollectionCount("institutional", stockHubRows.length, {
          suffix: data.currentQuarter || "",
        })
      );
      const meta = data.currentQuarter
        ? `Latest quarter ${data.currentQuarter}${data.previousQuarter ? ` vs ${data.previousQuarter}` : ""}`
        : "";
      stockHubCollectionCache[collection] = { loadedAt: Date.now(), rows: stockHubRows, meta };
      return meta;
    }

    if (collection === "executive-insider") {
      const data = await apiJson("/api/stocks/executive-insider-accumulation", { limit: 200, window: 90 });
      stockHubRows = (Array.isArray(data.stocks) ? data.stocks : []).map((s) => {
        const roles = [];
        if (s.ceoCount) roles.push(`${s.ceoCount} CEO${s.ceoCount === 1 ? "" : "s"}`);
        if (s.cfoCount) roles.push(`${s.cfoCount} CFO${s.cfoCount === 1 ? "" : "s"}`);
        return {
          symbol: String(s.ticker || "").toUpperCase(),
          name: String(s.companyName || s.ticker || ""),
          sector: s.sector ? String(s.sector) : "",
          industry: s.industry ? String(s.industry) : "",
          meta: `${formatHoldingValueUsd(s.totalBuyValue)} bought · ${roles.join(", ") || `${s.buyerCount} executive${s.buyerCount === 1 ? "" : "s"}`}`,
        };
      });
      setStockHubCollectionCount(
        "executive-insider",
        formatStockHubCollectionCount("executive-insider", stockHubRows.length, {
          suffix: data.lookbackDays ? `${data.lookbackDays}d` : "",
        })
      );
      const meta = data.lookbackDays ? `${data.lookbackDays}-day CEO/CFO open-market buys` : "";
      stockHubCollectionCache[collection] = { loadedAt: Date.now(), rows: stockHubRows, meta };
      return meta;
    }

    if (STOCK_HUB_SECTOR_COLLECTIONS.has(collection)) {
      const apiPath = fundamentalsCollectionApiPath(collection);
      const sector = stockHubFilters.sector.trim() || undefined;
      const data = await apiJson(apiPath, { limit: 200, sector });
      if (!Array.isArray(data.stocks) || !data.stocks.length) {
        const sectorHint = sector ? ` for ${sector}` : "";
        const warmHint =
          collection === "revenue-growth"
            ? "No revenue growth data yet. Run: npm run stocks:warm-fundamentals"
            : collection === "fcf-leaders"
              ? "No free cash flow data yet. Run: npm run stocks:warm-fundamentals"
              : "No operating margin data yet. Run: npm run stocks:warm-fundamentals";
        throw new Error(`${warmHint}${sectorHint}`);
      }

      populateStockHubSectorOptions(data.sectors);

      stockHubRows = data.stocks.map((s) => {
        const periodLabel = formatStockHubFundamentalsPeriod(s);
        let meta = "";
        if (collection === "revenue-growth") {
          meta = `${formatPercentValue(s.revenueGrowthYoy, false, true)} YoY${periodLabel ? ` · ${periodLabel}` : ""}`;
        } else if (collection === "fcf-leaders") {
          meta = `${formatSecFundamentalValue(s.freeCashFlow)} FCF${periodLabel ? ` · ${periodLabel}` : ""}`;
        } else {
          meta = `${formatPercentValue(s.operatingMargin, false)} margin${periodLabel ? ` · ${periodLabel}` : ""}`;
        }
        return mapFundamentalsStockRow(s, meta);
      });

      setStockHubCollectionCount(
        collection,
        formatStockHubCollectionCount(collection, stockHubRows.length)
      );

      const metaByCollection = {
        "revenue-growth": "Latest period · revenue > $100M · YoY vs prior year",
        "fcf-leaders": "Latest period · operating cash flow minus capex",
        "high-margin": "Latest period · revenue > $100M",
      };
      const meta = metaByCollection[collection];
      stockHubCollectionCache[cacheKey] = {
        loadedAt: Date.now(),
        rows: stockHubRows,
        meta,
        sectors: data.sectors,
      };
      return meta;
    }
  } catch (err) {
    stockHubRows = [];
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  } finally {
    stockHubLoading = false;
  }

  return "";
}

async function activateStockHubCollection(collection, { toggle = false } = {}) {
  if (!STOCK_HUB_COLLECTIONS.includes(collection)) return;
  const wasActive = activeStockHubCollection === collection;
  if (toggle && wasActive) {
    activeStockHubCollection = null;
    stockHubRows = [];
    stockHubShowAll = false;
    updateStockHubSectorField();
    updateStockHubFeatureRow();
    renderStockHub();
    return;
  }

  const switching = activeStockHubCollection !== collection;
  activeStockHubCollection = collection;
  stockHubShowAll = false;
  if (switching) {
    stockHubRows = [];
    stockHubFilters.sector = "";
    syncStockHubSectorSelect("");
  }
  updateStockHubSectorField();
  updateStockHubFeatureRow();

  try {
    await loadStockHubCollection(activeStockHubCollection);
    renderStockHub();
  } catch (err) {
    const loading = document.getElementById("stock-hub-loading");
    const grid = document.getElementById("stock-hub-grid");
    const empty = document.getElementById("stock-hub-empty");
    if (loading) {
      loading.hidden = false;
      loading.textContent = err instanceof Error ? err.message : String(err);
    }
    if (grid) grid.hidden = true;
    if (empty) empty.hidden = true;
  }
}

async function selectStockHubCollection(collection) {
  return activateStockHubCollection(collection, { toggle: true });
}

async function renderStockHub() {
  if (!isStockHubVisible()) return;

  if (!stockHubCountsPrefetched) {
    stockHubCountsPrefetched = true;
    void prefetchStockHubCollectionCounts();
  }

  const grid = document.getElementById("stock-hub-grid");
  const empty = document.getElementById("stock-hub-empty");
  const loading = document.getElementById("stock-hub-loading");
  const countEl = document.getElementById("stock-directory-count");
  if (!grid) return;

  updateStockHubFeatureRow();

  if (!activeStockHubCollection && !stockHubFilters.query.trim()) {
    if (loading) {
      loading.hidden = false;
      loading.textContent = "Pick a collection or search to browse stocks.";
    }
    grid.hidden = true;
    grid.innerHTML = "";
    if (empty) empty.hidden = true;
    if (countEl) countEl.textContent = "";
    updateStockHubMoreControl(0);
    return;
  }

  if (stockHubFilters.query.trim() && !activeStockHubCollection) {
    if (loading) {
      loading.hidden = false;
      loading.textContent = "Searching stocks…";
    }
    grid.hidden = true;
    try {
      const data = await apiJson("/api/stocks/search", { q: stockHubFilters.query.trim(), limit: 50 });
      stockHubRows = (Array.isArray(data.results) ? data.results : []).map((r) => ({
        symbol: String(r.symbol || "").toUpperCase(),
        name: String(r.description || r.name || r.symbol || ""),
      }));
    } catch {
      stockHubRows = [];
    }
  } else if (activeStockHubCollection && !stockHubRows.length && !stockHubLoading) {
    try {
      await loadStockHubCollection(activeStockHubCollection);
    } catch (err) {
      if (loading) {
        loading.hidden = false;
        loading.textContent = err instanceof Error ? err.message : String(err);
      }
      return;
    }
  }

  if (stockHubLoading) return;

  if (loading) loading.hidden = true;

  const rows = getFilteredStockHubRows();
  if (countEl) {
    const total = stockHubRows.length;
    countEl.textContent =
      rows.length === total ? `${rows.length} stocks` : `${rows.length} of ${total}`;
  }

  if (!rows.length) {
    grid.hidden = true;
    grid.innerHTML = "";
    const hasFilters = Boolean(
      stockHubFilters.query.trim() || stockHubFilters.sector.trim() || activeStockHubCollection
    );
    if (empty) empty.hidden = !hasFilters;
    updateStockHubMoreControl(0);
    return;
  }

  if (empty) empty.hidden = true;
  grid.hidden = false;
  const visibleRows = stockHubShowAll ? rows : rows.slice(0, STOCK_HUB_PAGE_SIZE);
  grid.innerHTML = visibleRows
    .map(
      (row) => `
    <button
      type="button"
      class="institution-dir-card stock-dir-card"
      role="listitem"
      data-stock-symbol="${escapeHtml(row.symbol)}"
      aria-label="Open ${escapeHtml(row.symbol)}"
    >
      <span class="institution-dir-card__name mono">${escapeHtml(row.symbol)}</span>
      ${
        row.sector || row.industry
          ? `<span class="stock-dir-card__classification">
        ${row.sector ? `<span class="stock-dir-card__sector">${escapeHtml(row.sector)}</span>` : ""}
        ${row.industry ? `<span class="stock-dir-card__industry">${escapeHtml(row.industry)}</span>` : ""}
      </span>`
          : `<span class="institution-dir-card__type">${escapeHtml(row.name)}</span>`
      }
      ${row.meta ? `<span class="stock-dir-card__meta">${escapeHtml(row.meta)}</span>` : ""}
    </button>
  `
    )
    .join("");

  grid.querySelectorAll("[data-stock-symbol]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = btn.getAttribute("data-stock-symbol");
      if (sym) void openStockPreview(sym);
    });
  });

  updateStockHubMoreControl(rows.length);
}

function setupStockHub() {
  if (stockHubControlsBound) return;
  stockHubControlsBound = true;

  const headerSearch = document.getElementById("stock-hub-search");
  const directorySearch = document.getElementById("stock-directory-search");
  const clearBtn = document.getElementById("stock-hub-clear-filters");
  const sectorFilter = document.getElementById("stock-hub-sector-filter");
  const featureRow = document.getElementById("stock-hub-feature-row");
  const moreBtn = document.getElementById("stock-hub-more-btn");

  const onSearchInput = (value) => {
    stockHubFilters.query = value;
    stockHubShowAll = false;
    syncStockHubSearchInputs(value);
    void renderStockHub();
  };

  if (headerSearch) {
    headerSearch.addEventListener("input", () => onSearchInput(headerSearch.value));
    headerSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSearchInput(headerSearch.value);
      }
    });
  }
  if (directorySearch) {
    directorySearch.addEventListener("input", () => onSearchInput(directorySearch.value));
  }
  if (sectorFilter) {
    sectorFilter.addEventListener("change", () => {
      stockHubFilters.sector = sectorFilter.value;
      stockHubShowAll = false;
      if (activeStockHubCollection && STOCK_HUB_SECTOR_COLLECTIONS.has(activeStockHubCollection)) {
        void (async () => {
          try {
            await loadStockHubCollection(activeStockHubCollection);
            renderStockHub();
          } catch (err) {
            const loading = document.getElementById("stock-hub-loading");
            if (loading) {
              loading.hidden = false;
              loading.textContent = err instanceof Error ? err.message : String(err);
            }
          }
        })();
      }
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      stockHubFilters = { query: "", sector: "" };
      stockHubShowAll = false;
      syncStockHubSearchInputs("");
      syncStockHubSectorSelect("");
      void activateStockHubCollection("sp500");
    });
  }
  if (featureRow) {
    featureRow.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-stock-collection]");
      if (!btn) return;
      const key = btn.getAttribute("data-stock-collection");
      if (key) void selectStockHubCollection(key);
    });
  }
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      stockHubShowAll = !stockHubShowAll;
      renderStockHub();
    });
  }

  document.getElementById("stock-hub-recently-active-link")?.addEventListener("click", () => {
    navigateToStocksRecentlyActive();
  });
  document.getElementById("stock-hub-most-accumulated-link")?.addEventListener("click", () => {
    navigateToStocksMostAccumulated();
  });
  document.getElementById("stock-hub-ownership-changes-link")?.addEventListener("click", () => {
    navigateToStocksOwnershipChanges();
  });
  document.getElementById("stock-hub-holder-overlap-link")?.addEventListener("click", () => {
    navigateToStocksHolderOverlap();
  });
  document.getElementById("stock-hub-ownership-history-link")?.addEventListener("click", () => {
    navigateToStocksOwnershipHistory();
  });
  document.getElementById("stock-hub-compare-link")?.addEventListener("click", () => {
    navigateToStocksCompare();
  });
  document.getElementById("stock-hub-screener-link")?.addEventListener("click", () => {
    navigateToStocksScreener();
  });
}

function buildRecentlyActiveQueryString() {
  const params = new URLSearchParams();
  if (
    stockRecentlyActiveSource &&
    stockRecentlyActiveSource !== "all" &&
    stockRecentlyActiveSource !== "institution"
  ) {
    params.set("source", stockRecentlyActiveSource);
  }
  if (stockRecentlyActiveFilters.from) params.set("from", stockRecentlyActiveFilters.from);
  if (stockRecentlyActiveFilters.to) params.set("to", stockRecentlyActiveFilters.to);
  return params.toString();
}

function formatRecentlyActiveDayLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  if (value === todayKey) return "Today";
  if (value === yesterdayKey) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function renderRecentlyActiveStocksPage() {
  const loading = document.getElementById("stock-recent-activity-loading");
  const subtitle = document.getElementById("stock-recent-activity-subtitle");
  const daysEl = document.getElementById("stock-recent-activity-days");
  const countEl = document.getElementById("stock-recent-activity-count");
  if (!daysEl) return;

  document.querySelectorAll("[data-recent-activity-source]").forEach((btn) => {
    const active = btn.getAttribute("data-recent-activity-source") === stockRecentlyActiveSource;
    btn.classList.toggle("is-active", active);
  });
  const fromInput = document.getElementById("stock-recent-activity-from");
  const toInput = document.getElementById("stock-recent-activity-to");
  if (fromInput && fromInput.value !== stockRecentlyActiveFilters.from) {
    fromInput.value = stockRecentlyActiveFilters.from;
  }
  if (toInput && toInput.value !== stockRecentlyActiveFilters.to) {
    toInput.value = stockRecentlyActiveFilters.to;
  }

  if (loading) loading.hidden = !stockRecentlyActiveLoading;
  if (stockRecentlyActiveLoading) {
    daysEl.innerHTML = "";
    if (subtitle) subtitle.textContent = "Loading recent filing activity…";
    if (countEl) countEl.textContent = "";
    return;
  }

  const payload = lastStockRecentlyActivePayload;
  if (!payload) {
    daysEl.innerHTML = `<p class="muted small">No activity feed loaded yet.</p>`;
    if (countEl) countEl.textContent = "";
    return;
  }

  const dayGroups = Array.isArray(payload.days) ? payload.days : [];
  if (subtitle) {
    subtitle.textContent = `Verified SEC filing activity only · ${payload.summary?.activityItemCount ?? 0} items across ${payload.summary?.stockCount ?? 0} stocks`;
  }
  if (countEl) {
    countEl.textContent = `${payload.summary?.stockCount ?? 0} stocks · ${payload.summary?.activityItemCount ?? 0} items`;
  }

  if (!dayGroups.length) {
    daysEl.innerHTML = `<p class="muted small">No filing activity matches the current filters.</p>`;
    return;
  }

  daysEl.innerHTML = dayGroups
    .map(
      (day) => `<section class="stock-recent-activity__day">
        <h3 class="stock-recent-activity__day-label">${escapeHtml(formatRecentlyActiveDayLabel(day.date))}</h3>
        <div class="stock-recent-activity__stock-list">
          ${(day.stocks || [])
            .map(
              (card) => `<article class="stock-recent-activity__card">
                <div class="stock-recent-activity__card-head">
                  <div>
                    <a href="${stockPath(card.ticker)}" class="stock-recent-activity__stock-link" data-stock-symbol="${escapeHtml(card.ticker)}">${escapeHtml(card.ticker)}</a>
                    <p class="stock-recent-activity__stock-name">${escapeHtml(card.companyName || card.ticker)}</p>
                  </div>
                  <span class="stock-recent-activity__timestamp">${escapeHtml(card.filingDate || day.date)}</span>
                </div>
                <ul class="stock-recent-activity__items">
                  ${(card.items || [])
                    .map(
                      (item) => `<li><span class="stock-recent-activity__source">${escapeHtml(item.source)}</span> ${escapeHtml(item.actorName)} ${escapeHtml(item.action.toLowerCase())}</li>`
                    )
                    .join("")}
                  ${card.overflowCount ? `<li class="muted small">+${escapeHtml(String(card.overflowCount))} more filing item${card.overflowCount === 1 ? "" : "s"}</li>` : ""}
                </ul>
              </article>`
            )
            .join("")}
        </div>
      </section>`
    )
    .join("");
}

async function loadRecentlyActiveStocksPage() {
  if (!recentlyActiveOpen) return;
  if (stockRecentlyActiveLoading) {
    renderRecentlyActiveStocksPage();
    return;
  }
  stockRecentlyActiveLoading = true;
  renderRecentlyActiveStocksPage();
  try {
    const qs = buildRecentlyActiveQueryString();
    lastStockRecentlyActivePayload = await apiJson(
      qs ? `/api/stocks/recently-active?${qs}` : "/api/stocks/recently-active"
    );
  } catch (err) {
    lastStockRecentlyActivePayload = {
      summary: { stockCount: 0, activityItemCount: 0 },
      days: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    stockRecentlyActiveLoading = false;
    renderRecentlyActiveStocksPage();
  }
}

function setupRecentlyActiveStocksPage() {
  if (stockRecentlyActiveBound) return;
  stockRecentlyActiveBound = true;

  document.getElementById("stock-recent-activity-back")?.addEventListener("click", () => {
    navigateToStocksHub();
  });
  document.querySelectorAll("[data-recent-activity-source]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const source = btn.getAttribute("data-recent-activity-source") || "all";
      if (source === "institution" || source === stockRecentlyActiveSource) return;
      stockRecentlyActiveSource = source;
      void loadRecentlyActiveStocksPage();
    });
  });
  ["stock-recent-activity-from", "stock-recent-activity-to"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      stockRecentlyActiveFilters = {
        from: document.getElementById("stock-recent-activity-from")?.value || "",
        to: document.getElementById("stock-recent-activity-to")?.value || "",
      };
      void loadRecentlyActiveStocksPage();
    });
  });
}

function stocksMostAccumulatedPeriodLabel(period) {
  if (period === "30d") return "Last 30 days";
  if (period === "year") return "Last year";
  return "Last 90 days";
}

function buildStocksMostAccumulatedQueryString() {
  const params = new URLSearchParams();
  if (stocksMostAccumulatedPeriod) params.set("period", stocksMostAccumulatedPeriod);
  if (stocksMostAccumulatedMarketCap) params.set("marketCap", stocksMostAccumulatedMarketCap);
  return params.toString();
}

function filterStocksMostAccumulatedRows(rows) {
  const q = stocksMostAccumulatedSearch.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const ticker = String(row.ticker || "").toLowerCase();
    const name = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || name.includes(q);
  });
}

function sortStocksMostAccumulatedRows(rows) {
  const key = stocksMostAccumulatedSortKey;
  const dir = stocksMostAccumulatedSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "rank") return 0;
    if (key === "ticker") {
      const al = String(a.companyName || a.ticker || "");
      const bl = String(b.companyName || b.ticker || "");
      return al.localeCompare(bl) * dir;
    }
    if (key === "lastFilingDate") {
      const av = String(a.lastFilingDate || "");
      const bv = String(b.lastFilingDate || "");
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv) * dir;
    }
    const ax = Number(a[key]);
    const bx = Number(b[key]);
    if (Number.isFinite(ax) && Number.isFinite(bx)) return (ax - bx) * dir;
    if (a[key] == null && b[key] == null) return 0;
    if (a[key] == null) return 1;
    if (b[key] == null) return -1;
    return String(a[key]).localeCompare(String(b[key])) * dir;
  });
}

function formatStocksAccumulatedUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  return `${sign}$${formatLargeNumber(Math.abs(x))}`;
}

function renderStocksMostAccumulatedSummary(summary) {
  const wrap = document.getElementById("stock-most-accumulated-summary");
  const topEl = document.getElementById("stock-accumulated-top-stock");
  const topMeta = document.getElementById("stock-accumulated-top-stock-meta");
  const countEl = document.getElementById("stock-accumulated-count");
  const netEl = document.getElementById("stock-accumulated-net-value");
  const avgEl = document.getElementById("stock-accumulated-avg-buyers");
  if (!wrap) return;

  if (!summary?.topStock) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  if (topEl) {
    topEl.textContent = summary.topStock.companyName
      ? `${summary.topStock.ticker} · ${summary.topStock.companyName}`
      : summary.topStock.ticker;
  }
  if (topMeta) {
    topMeta.textContent = `Score ${Number(summary.topStock.accumulationScore).toFixed(1)}`;
  }
  if (countEl) countEl.textContent = formatInteger(summary.stockCount);
  if (netEl) netEl.textContent = formatStocksAccumulatedUsd(summary.totalNetBoughtValueUsd);
  if (avgEl) avgEl.textContent = String(summary.averageBuyerCount ?? "—");
}

function renderStocksMostAccumulatedPage() {
  setupStocksMostAccumulatedPage();
  const body = document.getElementById("stock-most-accumulated-body");
  const loading = document.getElementById("stock-most-accumulated-loading");
  const subtitle = document.getElementById("stock-most-accumulated-subtitle");
  const countEl = document.getElementById("stock-most-accumulated-filter-count");
  const pagination = document.getElementById("stock-most-accumulated-pagination");
  const pageLabel = document.getElementById("stock-most-accumulated-page-label");
  const prevBtn = document.getElementById("stock-most-accumulated-prev");
  const nextBtn = document.getElementById("stock-most-accumulated-next");
  if (!body) return;

  document.querySelectorAll("[data-stock-accumulated-period]").forEach((btn) => {
    const active = btn.getAttribute("data-stock-accumulated-period") === stocksMostAccumulatedPeriod;
    btn.classList.toggle("is-active", active);
  });

  const mcapSelect = document.getElementById("stock-most-accumulated-mcap");
  if (mcapSelect && mcapSelect.value !== stocksMostAccumulatedMarketCap) {
    mcapSelect.value = stocksMostAccumulatedMarketCap;
  }
  const searchInput = document.getElementById("stock-most-accumulated-search");
  if (searchInput && searchInput.value !== stocksMostAccumulatedSearch) {
    searchInput.value = stocksMostAccumulatedSearch;
  }

  if (loading) loading.hidden = !stocksMostAccumulatedLoading;

  document.querySelectorAll("[data-stock-accumulated-sort]").forEach((btn) => {
    const key = btn.getAttribute("data-stock-accumulated-sort");
    const active = key === stocksMostAccumulatedSortKey;
    btn.classList.toggle("is-active", active);
    btn.dataset.sortDir = active ? stocksMostAccumulatedSortDir : "";
  });

  if (stocksMostAccumulatedLoading && !lastStocksMostAccumulatedPayload) {
    body.innerHTML = `<tr><td colspan="9" class="muted">Computing accumulation scores from filings…</td></tr>`;
    if (countEl) countEl.textContent = "Loading…";
    if (pagination) pagination.hidden = true;
    return;
  }

  if (stocksMostAccumulatedLoading && lastStocksMostAccumulatedPayload) {
    if (loading) loading.hidden = false;
  }

  const payload = lastStocksMostAccumulatedPayload;
  if (subtitle) {
    const periodText = stocksMostAccumulatedPeriodLabel(payload?.period || stocksMostAccumulatedPeriod);
    subtitle.textContent = payload?.error
      ? payload.error
      : `Weighted net buying across 13F, Form 4, and politician disclosures · ${periodText}.`;
  }

  if (payload?.error && !payload?.stocks?.length) {
    renderStocksMostAccumulatedSummary(null);
    body.innerHTML = `<tr><td colspan="9" class="muted">${escapeHtml(payload.error)}</td></tr>`;
    if (countEl) countEl.textContent = "";
    if (pagination) pagination.hidden = true;
    return;
  }

  const rows = sortStocksMostAccumulatedRows(filterStocksMostAccumulatedRows(payload?.stocks || []));
  renderStocksMostAccumulatedSummary(
    rows.length && payload?.summary
      ? {
          ...payload.summary,
          stockCount: rows.length,
          topStock: rows[0]
            ? {
                ticker: rows[0].ticker,
                companyName: rows[0].companyName,
                accumulationScore: rows[0].accumulationScore,
              }
            : payload.summary.topStock,
        }
      : payload?.summary
  );

  const total = rows.length;
  const pageSize = STOCKS_MOST_ACCUMULATED_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  if (stocksMostAccumulatedPage > pageCount) stocksMostAccumulatedPage = pageCount;
  if (stocksMostAccumulatedPage < 1) stocksMostAccumulatedPage = 1;
  const page = stocksMostAccumulatedPage;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} stock${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (pagination) pagination.hidden = total <= pageSize;
  if (pageLabel) pageLabel.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="muted">No accumulated stocks for this period and filter.</td></tr>`;
    return;
  }

  body.innerHTML = pageRows
    .map((row, idx) => {
      const label = row.companyName
        ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
        : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
      const scoreClass =
        Number(row.accumulationScore) >= 70
          ? "change--up"
          : Number(row.accumulationScore) <= 40
            ? "change--down"
            : "";
      return `<tr>
      <td class="mono num">${start + idx + 1}</td>
      <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${label}</a></td>
      <td class="mono num ${scoreClass}">${Number(row.accumulationScore).toFixed(1)}</td>
      <td class="mono num ${Number(row.netBoughtValueUsd) >= 0 ? "change--up" : "change--down"}">${formatStocksAccumulatedUsd(row.netBoughtValueUsd)}</td>
      <td class="mono num ${Number(row.institutionalBuyingUsd) >= 0 ? "change--up" : "change--down"}">${formatStocksAccumulatedUsd(row.institutionalBuyingUsd)}</td>
      <td class="mono num ${Number(row.insiderBuyingUsd) >= 0 ? "change--up" : "change--down"}">${formatStocksAccumulatedUsd(row.insiderBuyingUsd)}</td>
      <td class="mono num ${Number(row.politicianBuyingUsd) >= 0 ? "change--up" : "change--down"}">${formatStocksAccumulatedUsd(row.politicianBuyingUsd)}</td>
      <td class="mono num">${formatInteger(row.buyerCount)}</td>
      <td class="mono num">${row.lastFilingDate ? escapeHtml(row.lastFilingDate) : "—"}</td>
    </tr>`;
    })
    .join("");
}

async function loadStocksMostAccumulatedPage() {
  if (!stocksMostAccumulatedOpen) return;
  if (stocksMostAccumulatedLoading) {
    renderStocksMostAccumulatedPage();
    return;
  }
  const requestPeriod = stocksMostAccumulatedPeriod;
  const requestMcap = stocksMostAccumulatedMarketCap;
  stocksMostAccumulatedLoading = true;
  renderStocksMostAccumulatedPage();
  try {
    const params = new URLSearchParams();
    params.set("period", requestPeriod);
    if (requestMcap) params.set("marketCap", requestMcap);
    lastStocksMostAccumulatedPayload = await apiJson(
      `/api/stocks/most-accumulated?${params.toString()}`
    );
  } catch (err) {
    lastStocksMostAccumulatedPayload = {
      summary: null,
      stocks: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    stocksMostAccumulatedLoading = false;
    // If filters changed while loading, refetch once.
    if (
      stocksMostAccumulatedOpen &&
      (stocksMostAccumulatedPeriod !== requestPeriod ||
        stocksMostAccumulatedMarketCap !== requestMcap)
    ) {
      void loadStocksMostAccumulatedPage();
      return;
    }
    renderStocksMostAccumulatedPage();
  }
}

function setupStocksMostAccumulatedPage() {
  if (stocksMostAccumulatedBound) return;
  stocksMostAccumulatedBound = true;

  document.getElementById("stock-most-accumulated-back")?.addEventListener("click", () => {
    navigateToStocksHub();
  });
  document.querySelectorAll("[data-stock-accumulated-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const period = btn.getAttribute("data-stock-accumulated-period") || "90d";
      if (period === stocksMostAccumulatedPeriod) return;
      stocksMostAccumulatedPeriod = period;
      stocksMostAccumulatedPage = 1;
      lastStocksMostAccumulatedPayload = null;
      void loadStocksMostAccumulatedPage();
    });
  });
  document.getElementById("stock-most-accumulated-mcap")?.addEventListener("change", (e) => {
    stocksMostAccumulatedMarketCap = e.target?.value || "";
    stocksMostAccumulatedPage = 1;
    lastStocksMostAccumulatedPayload = null;
    void loadStocksMostAccumulatedPage();
  });
  document.getElementById("stock-most-accumulated-search")?.addEventListener("input", (e) => {
    stocksMostAccumulatedSearch = e.target?.value || "";
    stocksMostAccumulatedPage = 1;
    renderStocksMostAccumulatedPage();
  });
  document.querySelectorAll("[data-stock-accumulated-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-stock-accumulated-sort") || "accumulationScore";
      if (key === stocksMostAccumulatedSortKey) {
        stocksMostAccumulatedSortDir = stocksMostAccumulatedSortDir === "asc" ? "desc" : "asc";
      } else {
        stocksMostAccumulatedSortKey = key;
        stocksMostAccumulatedSortDir =
          key === "ticker" || key === "lastFilingDate" || key === "rank" ? "asc" : "desc";
      }
      stocksMostAccumulatedPage = 1;
      renderStocksMostAccumulatedPage();
    });
  });
  document.getElementById("stock-most-accumulated-prev")?.addEventListener("click", () => {
    if (stocksMostAccumulatedPage <= 1) return;
    stocksMostAccumulatedPage -= 1;
    renderStocksMostAccumulatedPage();
  });
  document.getElementById("stock-most-accumulated-next")?.addEventListener("click", () => {
    stocksMostAccumulatedPage += 1;
    renderStocksMostAccumulatedPage();
  });
  document.getElementById("stock-most-accumulated-body")?.addEventListener("click", (e) => {
    const link = e.target?.closest?.("[data-stock-symbol]");
    if (!link) return;
    e.preventDefault();
    const sym = link.getAttribute("data-stock-symbol");
    if (sym) void openStockPreview(sym);
  });
}

function formatOwnershipPct(n) {
  if (n == null || n === "") return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  return `${sign}${Math.abs(x).toFixed(1)}%`;
}

function formatOwnershipPctPlain(n) {
  // Number(null) === 0 — treat missing ownership % as em dash, not 0.0%.
  if (n == null || n === "") return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `${x.toFixed(1)}%`;
}

function buildStocksOwnershipChangesQueryString() {
  const params = new URLSearchParams();
  params.set("direction", stocksOwnershipChangesDirection);
  if (stocksOwnershipChangesQuarter && stocksOwnershipChangesQuarter !== "latest") {
    params.set("quarter", stocksOwnershipChangesQuarter);
  }
  if (stocksOwnershipChangesMarketCap) params.set("marketCap", stocksOwnershipChangesMarketCap);
  if (stocksOwnershipChangesSector) params.set("sector", stocksOwnershipChangesSector);
  if (stocksOwnershipChangesSearch.trim()) params.set("search", stocksOwnershipChangesSearch.trim());
  if (stocksOwnershipChangesSortKey && stocksOwnershipChangesSortKey !== "rank") {
    params.set("sort", stocksOwnershipChangesSortKey);
    params.set("sortDir", stocksOwnershipChangesSortDir);
  }
  params.set("page", String(stocksOwnershipChangesPage));
  params.set("pageSize", String(STOCKS_OWNERSHIP_CHANGES_PAGE_SIZE));
  return params.toString();
}

function sortStocksOwnershipChangesRows(rows) {
  const key = stocksOwnershipChangesSortKey;
  const dir = stocksOwnershipChangesSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "rank") return 0;
    if (key === "ticker") {
      const al = String(a.companyName || a.ticker || "");
      const bl = String(b.companyName || b.ticker || "");
      return al.localeCompare(bl) * dir;
    }
    const ax = Number(a[key]);
    const bx = Number(b[key]);
    if (Number.isFinite(ax) && Number.isFinite(bx)) return (ax - bx) * dir;
    if (a[key] == null && b[key] == null) return 0;
    if (a[key] == null) return 1;
    if (b[key] == null) return -1;
    return String(a[key]).localeCompare(String(b[key])) * dir;
  });
}

function populateOwnershipChangesFilterOptions(payload) {
  const quarterSelect = document.getElementById("stock-ownership-changes-quarter");
  if (quarterSelect && payload?.quarters?.length) {
    const current = stocksOwnershipChangesQuarter;
    const defaultQuarter = payload.defaultQuarter || payload.quarters[0];
    const options = [
      `<option value="latest">${escapeHtml(defaultQuarter)} (default)</option>`,
      ...payload.quarters.map(
        (q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`
      ),
    ];
    quarterSelect.innerHTML = options.join("");
    if (current === "latest" || !payload.quarters.includes(current)) {
      quarterSelect.value = "latest";
      stocksOwnershipChangesQuarter = "latest";
    } else {
      quarterSelect.value = current;
    }
  }

  const sectorSelect = document.getElementById("stock-ownership-changes-sector");
  if (sectorSelect && payload?.sectors) {
    const selected = stocksOwnershipChangesSector;
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      payload.sectors
        .map((sector) => `<option value="${escapeHtml(sector)}">${escapeHtml(sector)}</option>`)
        .join("");
    sectorSelect.value = selected;
  }
}

function renderStocksOwnershipChangesSummary(summary) {
  const wrap = document.getElementById("stock-ownership-changes-summary");
  const topIncrease = document.getElementById("ownership-changes-top-increase");
  const topDecrease = document.getElementById("ownership-changes-top-decrease");
  const countEl = document.getElementById("ownership-changes-stock-count");
  const avgEl = document.getElementById("ownership-changes-avg-change");
  if (!wrap) return;
  if (!summary?.stockCount) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  if (topIncrease) {
    topIncrease.textContent = summary.topIncrease
      ? `${summary.topIncrease.ticker} · ${formatOwnershipPct(summary.topIncrease.changePct)}`
      : "—";
    topIncrease.className = "institution-most-accumulated__summary-value change--up";
  }
  if (topDecrease) {
    topDecrease.textContent = summary.topDecrease
      ? `${summary.topDecrease.ticker} · ${formatOwnershipPct(summary.topDecrease.changePct)}`
      : "—";
    topDecrease.className = "institution-most-accumulated__summary-value change--down";
  }
  if (countEl) countEl.textContent = formatInteger(summary.stockCount);
  if (avgEl) {
    avgEl.textContent = summary.averageChangePct == null ? "—" : formatOwnershipPct(summary.averageChangePct);
    avgEl.className = `institution-most-accumulated__summary-value mono ${
      Number(summary.averageChangePct) >= 0 ? "change--up" : "change--down"
    }`;
  }
}

function renderStocksOwnershipChangesPage() {
  setupStocksOwnershipChangesPage();
  const body = document.getElementById("stock-ownership-changes-body");
  const loading = document.getElementById("stock-ownership-changes-loading");
  const subtitle = document.getElementById("stock-ownership-changes-subtitle");
  const countEl = document.getElementById("stock-ownership-changes-count");
  const pagination = document.getElementById("stock-ownership-changes-pagination");
  const pageLabel = document.getElementById("stock-ownership-changes-page-label");
  const prevBtn = document.getElementById("stock-ownership-changes-prev");
  const nextBtn = document.getElementById("stock-ownership-changes-next");
  if (!body) return;

  document.querySelectorAll("[data-ownership-changes-direction]").forEach((btn) => {
    const active = btn.getAttribute("data-ownership-changes-direction") === stocksOwnershipChangesDirection;
    btn.classList.toggle("is-active", active);
  });

  const mcapSelect = document.getElementById("stock-ownership-changes-mcap");
  if (mcapSelect && mcapSelect.value !== stocksOwnershipChangesMarketCap) {
    mcapSelect.value = stocksOwnershipChangesMarketCap;
  }
  const searchInput = document.getElementById("stock-ownership-changes-search");
  if (searchInput && searchInput.value !== stocksOwnershipChangesSearch) {
    searchInput.value = stocksOwnershipChangesSearch;
  }

  if (loading) loading.hidden = !stocksOwnershipChangesLoading;

  document.querySelectorAll("[data-ownership-changes-sort]").forEach((btn) => {
    const key = btn.getAttribute("data-ownership-changes-sort");
    const active = key === stocksOwnershipChangesSortKey;
    btn.classList.toggle("is-active", active);
    btn.dataset.sortDir = active ? stocksOwnershipChangesSortDir : "";
  });

  const payload = lastStocksOwnershipChangesPayload;
  if (payload) populateOwnershipChangesFilterOptions(payload);

  if (stocksOwnershipChangesLoading && !payload) {
    body.innerHTML = `<tr><td colspan="8" class="muted">Loading institutional ownership changes…</td></tr>`;
    if (countEl) countEl.textContent = "Loading…";
    if (pagination) pagination.hidden = true;
    return;
  }

  if (subtitle) {
    const quarterLabel = payload?.quarter || "—";
    const prevLabel = payload?.previousQuarter || "—";
    subtitle.textContent = payload?.error
      ? payload.error
      : `Biggest QoQ institutional ownership % movers · comparing ${quarterLabel} vs ${prevLabel}.`;
  }

  if (payload?.error && !payload?.stocks?.length) {
    renderStocksOwnershipChangesSummary(null);
    body.innerHTML = `<tr><td colspan="8" class="muted">${escapeHtml(payload.error)}</td></tr>`;
    if (countEl) countEl.textContent = "";
    if (pagination) pagination.hidden = true;
    return;
  }

  const rows = payload?.stocks || [];
  renderStocksOwnershipChangesSummary(payload?.summary);

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || stocksOwnershipChangesPage;
  const pageSize = Number(payload?.pageSize) || STOCKS_OWNERSHIP_CHANGES_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} stock${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (pagination) pagination.hidden = total <= pageSize;
  if (pageLabel) pageLabel.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted">No ownership changes match the current filters.</td></tr>`;
    return;
  }

  const rankOffset = (page - 1) * pageSize;
  body.innerHTML = rows
    .map((row, idx) => {
      const label = row.companyName
        ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
        : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
      const changeClass = Number(row.changePct) >= 0 ? "change--up" : "change--down";
      return `<tr>
      <td class="mono num">${rankOffset + idx + 1}</td>
      <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${label}</a></td>
      <td class="mono num">${formatOwnershipPctPlain(row.currentOwnershipPct)}</td>
      <td class="mono num">${formatOwnershipPctPlain(row.previousOwnershipPct)}</td>
      <td class="mono num ${changeClass}">${formatOwnershipPct(row.changePct)}</td>
      <td class="mono num">${formatInteger(row.institutionCount)}</td>
      <td class="mono num">${formatLargeNumber(row.totalInstitutionalShares)}</td>
      <td class="mono num">${escapeHtml(row.currentQuarter || "—")}</td>
    </tr>`;
    })
    .join("");
}

async function loadStocksOwnershipChangesPage() {
  if (!stocksOwnershipChangesOpen) return;
  if (stocksOwnershipChangesLoading) {
    renderStocksOwnershipChangesPage();
    return;
  }
  const requestKey = buildStocksOwnershipChangesQueryString();
  stocksOwnershipChangesLoading = true;
  renderStocksOwnershipChangesPage();
  try {
    lastStocksOwnershipChangesPayload = await apiJson(
      `/api/stocks/ownership-changes?${requestKey}`
    );
  } catch (err) {
    lastStocksOwnershipChangesPayload = {
      summary: null,
      stocks: [],
      total: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    stocksOwnershipChangesLoading = false;
    if (
      stocksOwnershipChangesOpen &&
      buildStocksOwnershipChangesQueryString() !== requestKey
    ) {
      void loadStocksOwnershipChangesPage();
      return;
    }
    renderStocksOwnershipChangesPage();
  }
}

function setupStocksOwnershipChangesPage() {
  if (stocksOwnershipChangesBound) return;
  stocksOwnershipChangesBound = true;

  document.getElementById("stock-ownership-changes-back")?.addEventListener("click", () => {
    navigateToStocksHub();
  });
  document.querySelectorAll("[data-ownership-changes-direction]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const direction = btn.getAttribute("data-ownership-changes-direction") || "increases";
      if (direction === stocksOwnershipChangesDirection) return;
      stocksOwnershipChangesDirection = direction;
      stocksOwnershipChangesSortKey = "changePct";
      stocksOwnershipChangesSortDir = direction === "decreases" ? "asc" : "desc";
      stocksOwnershipChangesPage = 1;
      void loadStocksOwnershipChangesPage();
    });
  });
  document.getElementById("stock-ownership-changes-search")?.addEventListener("input", (e) => {
    stocksOwnershipChangesSearch = e.target?.value || "";
    stocksOwnershipChangesPage = 1;
    void loadStocksOwnershipChangesPage();
  });
  document.getElementById("stock-ownership-changes-quarter")?.addEventListener("change", (e) => {
    stocksOwnershipChangesQuarter = e.target?.value || "latest";
    stocksOwnershipChangesPage = 1;
    void loadStocksOwnershipChangesPage();
  });
  document.getElementById("stock-ownership-changes-sector")?.addEventListener("change", (e) => {
    stocksOwnershipChangesSector = e.target?.value || "";
    stocksOwnershipChangesPage = 1;
    void loadStocksOwnershipChangesPage();
  });
  document.getElementById("stock-ownership-changes-mcap")?.addEventListener("change", (e) => {
    stocksOwnershipChangesMarketCap = e.target?.value || "";
    stocksOwnershipChangesPage = 1;
    void loadStocksOwnershipChangesPage();
  });
  document.querySelectorAll("[data-ownership-changes-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-ownership-changes-sort") || "changePct";
      if (key === stocksOwnershipChangesSortKey) {
        stocksOwnershipChangesSortDir = stocksOwnershipChangesSortDir === "asc" ? "desc" : "asc";
      } else {
        stocksOwnershipChangesSortKey = key;
        stocksOwnershipChangesSortDir =
          key === "ticker" || key === "currentQuarter" || key === "rank" ? "asc" : "desc";
      }
      stocksOwnershipChangesPage = 1;
      void loadStocksOwnershipChangesPage();
    });
  });
  document.getElementById("stock-ownership-changes-prev")?.addEventListener("click", () => {
    if (stocksOwnershipChangesPage <= 1) return;
    stocksOwnershipChangesPage -= 1;
    void loadStocksOwnershipChangesPage();
  });
  document.getElementById("stock-ownership-changes-next")?.addEventListener("click", () => {
    stocksOwnershipChangesPage += 1;
    void loadStocksOwnershipChangesPage();
  });
  document.getElementById("stock-ownership-changes-body")?.addEventListener("click", (e) => {
    const link = e.target?.closest?.("[data-stock-symbol]");
    if (!link) return;
    e.preventDefault();
    const sym = link.getAttribute("data-stock-symbol");
    if (sym) void openStockPreview(sym);
  });
}

function buildStocksHolderOverlapQueryString() {
  const params = new URLSearchParams();
  if (stocksHolderOverlapTicker) params.set("ticker", stocksHolderOverlapTicker);
  params.set("mode", stocksHolderOverlapMode);
  params.set("minInstitutions", String(stocksHolderOverlapMinInst || 1));
  params.set("minOverlapPct", String(stocksHolderOverlapMinPct || 0));
  if (stocksHolderOverlapSector) params.set("sector", stocksHolderOverlapSector);
  if (stocksHolderOverlapMarketCap) params.set("marketCap", stocksHolderOverlapMarketCap);
  if (stocksHolderOverlapInstitutionType) params.set("institutionType", stocksHolderOverlapInstitutionType);
  params.set("page", String(stocksHolderOverlapPage));
  params.set("pageSize", String(STOCKS_HOLDER_OVERLAP_PAGE_SIZE));
  return params.toString();
}

function formatHolderOverlapWeight(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)}%`;
}

function populateHolderOverlapFilterOptions(payload) {
  const sectorSelect = document.getElementById("stock-holder-overlap-sector");
  if (sectorSelect && payload?.sectors) {
    const selected = stocksHolderOverlapSector;
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      payload.sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = selected;
  }
  const typeSelect = document.getElementById("stock-holder-overlap-itype");
  if (typeSelect && payload?.institutionTypes) {
    const selected = stocksHolderOverlapInstitutionType;
    typeSelect.innerHTML =
      `<option value="">All types</option>` +
      payload.institutionTypes
        .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
        .join("");
    typeSelect.value = selected;
  }
}

function renderStocksHolderOverlapPage() {
  setupStocksHolderOverlapPage();
  const body = document.getElementById("stock-holder-overlap-body");
  const loading = document.getElementById("stock-holder-overlap-loading");
  const subtitle = document.getElementById("stock-holder-overlap-subtitle");
  const countEl = document.getElementById("stock-holder-overlap-count");
  const pagination = document.getElementById("stock-holder-overlap-pagination");
  const pageLabel = document.getElementById("stock-holder-overlap-page-label");
  const prevBtn = document.getElementById("stock-holder-overlap-prev");
  const nextBtn = document.getElementById("stock-holder-overlap-next");
  const alsoOwnLabel = document.getElementById("stock-holder-overlap-also-own-label");
  const sideGrid = document.getElementById("stock-holder-overlap-side-grid");
  if (!body) return;

  const hasTicker = Boolean(stocksHolderOverlapTicker);
  if (sideGrid) sideGrid.hidden = !hasTicker;

  document.querySelectorAll("[data-holder-overlap-mode]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-holder-overlap-mode") === stocksHolderOverlapMode);
  });

  const tickerInput = document.getElementById("stock-holder-overlap-ticker");
  if (tickerInput && tickerInput.value !== stocksHolderOverlapTicker) tickerInput.value = stocksHolderOverlapTicker;
  const minInst = document.getElementById("stock-holder-overlap-min-inst");
  if (minInst) minInst.value = String(stocksHolderOverlapMinInst);
  const minPct = document.getElementById("stock-holder-overlap-min-pct");
  if (minPct) minPct.value = String(stocksHolderOverlapMinPct);
  const mcap = document.getElementById("stock-holder-overlap-mcap");
  if (mcap) mcap.value = stocksHolderOverlapMarketCap;

  if (loading) loading.hidden = !stocksHolderOverlapLoading;

  const payload = lastStocksHolderOverlapPayload;
  if (payload) populateHolderOverlapFilterOptions(payload);

  const summary = document.getElementById("stock-holder-overlap-summary");
  if (!hasTicker) {
    if (summary) summary.hidden = true;
    body.innerHTML = `<tr><td colspan="6" class="muted">Enter a ticker and click Analyze to see which stocks its institutional holders also own.</td></tr>`;
    if (countEl) countEl.textContent = "";
    if (pagination) pagination.hidden = true;
    return;
  }

  if (stocksHolderOverlapLoading && !payload) {
    body.innerHTML = `<tr><td colspan="6" class="muted">Computing holder overlap…</td></tr>`;
    if (countEl) countEl.textContent = "Loading…";
    if (pagination) pagination.hidden = true;
    return;
  }

  if (payload?.error) {
    if (summary) summary.hidden = true;
    body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(payload.error)}</td></tr>`;
    if (countEl) countEl.textContent = "";
    if (pagination) pagination.hidden = true;
    return;
  }

  if (summary) summary.hidden = false;
  const targetEl = document.getElementById("holder-overlap-target");
  const quarterEl = document.getElementById("holder-overlap-quarter");
  const holdersEl = document.getElementById("holder-overlap-holders");
  const stockCountEl = document.getElementById("holder-overlap-stock-count");
  if (targetEl) {
    targetEl.textContent = payload?.summary?.targetCompanyName
      ? `${payload.summary.targetTicker} · ${payload.summary.targetCompanyName}`
      : payload?.summary?.targetTicker || stocksHolderOverlapTicker;
  }
  if (quarterEl) quarterEl.textContent = payload?.summary?.quarter || "—";
  if (holdersEl) holdersEl.textContent = formatInteger(payload?.summary?.holderCount || 0);
  if (stockCountEl) stockCountEl.textContent = formatInteger(payload?.summary?.overlapStockCount || 0);

  if (subtitle) {
    const modeLabel =
      stocksHolderOverlapMode === "popularity"
        ? "ranked by institution count"
        : stocksHolderOverlapMode === "conviction"
          ? "ranked by average portfolio weight"
          : "ranked by sum of portfolio weights";
    subtitle.textContent = `${payload?.summary?.targetTicker || stocksHolderOverlapTicker} holders also own — ${modeLabel}.`;
  }
  if (alsoOwnLabel) {
    alsoOwnLabel.textContent = `${payload?.summary?.targetTicker || stocksHolderOverlapTicker} holders also own`;
  }

  const rows = payload?.stocks || [];
  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || stocksHolderOverlapPage;
  const pageSize = Number(payload?.pageSize) || STOCKS_HOLDER_OVERLAP_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total ? `${formatInteger(total)} stock${total === 1 ? "" : "s"}` : "No matches";
  }
  if (pagination) pagination.hidden = total <= pageSize;
  if (pageLabel) pageLabel.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted">No overlapping holdings for this ticker and filters.</td></tr>`;
  } else {
    const offset = (page - 1) * pageSize;
    body.innerHTML = rows
      .map((row, idx) => {
        const label = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
        return `<tr>
          <td class="mono num">${offset + idx + 1}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${label}</a></td>
          <td class="mono num">${formatInteger(row.overlapCount)}</td>
          <td class="mono num">${Number(row.overlapPercentage).toFixed(1)}%</td>
          <td class="mono num">${formatHolderOverlapWeight(row.weightedScore)}</td>
          <td class="mono num">${formatHolderOverlapWeight(row.convictionScore)}</td>
        </tr>`;
      })
      .join("");
  }

  const instBody = document.getElementById("stock-holder-overlap-institutions");
  const institutions = payload?.institutions || [];
  if (instBody) {
    instBody.innerHTML = institutions.length
      ? institutions
          .map(
            (row) => `<tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="muted small">${escapeHtml(row.institutionType || "—")}</td>
        <td class="mono num">${formatLargeNumber(row.shares)}</td>
        <td class="mono num">${formatStocksAccumulatedUsd(row.valueUsd).replace(/^\+/, "")}</td>
        <td class="mono num">${formatHolderOverlapWeight(row.portfolioWeight)}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="muted">No institutional holders found.</td></tr>`;
  }

  const insiderBody = document.getElementById("stock-holder-overlap-insiders");
  const insiders = payload?.insiders || [];
  if (insiderBody) {
    insiderBody.innerHTML = insiders.length
      ? insiders
          .map(
            (row) => `<tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="muted small">${escapeHtml(row.title || "—")}</td>
        <td class="mono num">${escapeHtml(row.transactionDate || "—")}</td>
        <td class="mono num change--up">${formatStocksAccumulatedUsd(row.transactionValue)}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted">No insider purchases in the last year.</td></tr>`;
  }

  const polBody = document.getElementById("stock-holder-overlap-politicians");
  const politicians = payload?.politicians || [];
  if (polBody) {
    polBody.innerHTML = politicians.length
      ? politicians
          .map(
            (row) => `<tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="muted small">${escapeHtml(row.chamber || "—")}</td>
        <td class="mono num">${escapeHtml(row.transactionDate || "—")}</td>
        <td class="mono num change--up">${formatStocksAccumulatedUsd(row.estimatedValueUsd)}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted">No politician purchases in the last year.</td></tr>`;
  }
}

async function loadStocksHolderOverlapPage() {
  if (!stocksHolderOverlapOpen) return;
  if (!stocksHolderOverlapTicker) {
    lastStocksHolderOverlapPayload = null;
    renderStocksHolderOverlapPage();
    return;
  }
  if (stocksHolderOverlapLoading) {
    renderStocksHolderOverlapPage();
    return;
  }
  const requestKey = buildStocksHolderOverlapQueryString();
  stocksHolderOverlapLoading = true;
  renderStocksHolderOverlapPage();
  try {
    lastStocksHolderOverlapPayload = await apiJson(`/api/stocks/holder-overlap?${requestKey}`);
  } catch (err) {
    lastStocksHolderOverlapPayload = {
      summary: null,
      stocks: [],
      institutions: [],
      insiders: [],
      politicians: [],
      total: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    stocksHolderOverlapLoading = false;
    if (stocksHolderOverlapOpen && buildStocksHolderOverlapQueryString() !== requestKey) {
      void loadStocksHolderOverlapPage();
      return;
    }
    renderStocksHolderOverlapPage();
  }
}

function setupStocksHolderOverlapPage() {
  if (stocksHolderOverlapBound) return;
  stocksHolderOverlapBound = true;

  document.getElementById("stock-holder-overlap-back")?.addEventListener("click", () => {
    navigateToStocksHub();
  });
  document.querySelectorAll("[data-holder-overlap-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-holder-overlap-mode") || "weighted";
      if (mode === stocksHolderOverlapMode) return;
      stocksHolderOverlapMode = mode;
      stocksHolderOverlapPage = 1;
      void loadStocksHolderOverlapPage();
    });
  });
  document.getElementById("stock-holder-overlap-run")?.addEventListener("click", () => {
    stocksHolderOverlapTicker = String(
      document.getElementById("stock-holder-overlap-ticker")?.value || ""
    )
      .trim()
      .toUpperCase();
    stocksHolderOverlapMinInst =
      Number(document.getElementById("stock-holder-overlap-min-inst")?.value || 1) || 1;
    stocksHolderOverlapMinPct =
      Number(document.getElementById("stock-holder-overlap-min-pct")?.value || 0) || 0;
    stocksHolderOverlapPage = 1;
    void loadStocksHolderOverlapPage();
  });
  document.getElementById("stock-holder-overlap-ticker")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.getElementById("stock-holder-overlap-run")?.click();
  });
  document.getElementById("stock-holder-overlap-sector")?.addEventListener("change", (e) => {
    stocksHolderOverlapSector = e.target?.value || "";
    stocksHolderOverlapPage = 1;
    void loadStocksHolderOverlapPage();
  });
  document.getElementById("stock-holder-overlap-mcap")?.addEventListener("change", (e) => {
    stocksHolderOverlapMarketCap = e.target?.value || "";
    stocksHolderOverlapPage = 1;
    void loadStocksHolderOverlapPage();
  });
  document.getElementById("stock-holder-overlap-itype")?.addEventListener("change", (e) => {
    stocksHolderOverlapInstitutionType = e.target?.value || "";
    stocksHolderOverlapPage = 1;
    void loadStocksHolderOverlapPage();
  });
  document.getElementById("stock-holder-overlap-prev")?.addEventListener("click", () => {
    if (stocksHolderOverlapPage <= 1) return;
    stocksHolderOverlapPage -= 1;
    void loadStocksHolderOverlapPage();
  });
  document.getElementById("stock-holder-overlap-next")?.addEventListener("click", () => {
    stocksHolderOverlapPage += 1;
    void loadStocksHolderOverlapPage();
  });
  document.getElementById("view-stock-holder-overlap")?.addEventListener("click", (e) => {
    const link = e.target?.closest?.("[data-stock-symbol]");
    if (!link) return;
    e.preventDefault();
    const sym = link.getAttribute("data-stock-symbol");
    if (sym) void openStockPreview(sym);
  });
}

const OWNERSHIP_HISTORY_CATEGORY_LABELS = {
  ownership_expansion: "Ownership Expansion",
  institutional_adoption: "Institutional Adoption",
  early_discovery: "Early Discovery",
  ownership_decliner: "Ownership Decliner",
};

function buildStocksOwnershipHistoryQuery() {
  return {
    quarter: stocksOwnershipHistoryQuarter || undefined,
    category: stocksOwnershipHistoryCategory || undefined,
    sector: stocksOwnershipHistorySector || undefined,
    marketCap: stocksOwnershipHistoryMarketCap || undefined,
    minOwnershipGrowth:
      stocksOwnershipHistoryMinGrowth !== "" ? stocksOwnershipHistoryMinGrowth : undefined,
    maxOwnershipPct: stocksOwnershipHistoryMaxOwn !== "" ? stocksOwnershipHistoryMaxOwn : undefined,
    minHolderGrowth:
      stocksOwnershipHistoryMinHolders !== "" ? stocksOwnershipHistoryMinHolders : undefined,
    search: stocksOwnershipHistorySearch.trim() || undefined,
    page: stocksOwnershipHistoryPage,
    pageSize: STOCKS_OWNERSHIP_HISTORY_PAGE_SIZE,
    sort: stocksOwnershipHistorySortKey === "rank" ? "ownershipExpansionScore" : stocksOwnershipHistorySortKey,
    sortDir: stocksOwnershipHistorySortDir,
  };
}

function syncStocksOwnershipHistoryFiltersFromDom() {
  stocksOwnershipHistoryCategory =
    document.getElementById("stock-ownership-history-category")?.value || "";
  stocksOwnershipHistoryQuarter =
    document.getElementById("stock-ownership-history-quarter")?.value || "";
  stocksOwnershipHistorySector =
    document.getElementById("stock-ownership-history-sector")?.value || "";
  stocksOwnershipHistoryMarketCap =
    document.getElementById("stock-ownership-history-mcap")?.value || "";
  stocksOwnershipHistoryMinGrowth =
    document.getElementById("stock-ownership-history-min-growth")?.value ?? "";
  stocksOwnershipHistoryMaxOwn =
    document.getElementById("stock-ownership-history-max-own")?.value ?? "";
  stocksOwnershipHistoryMinHolders =
    document.getElementById("stock-ownership-history-min-holders")?.value ?? "";
  stocksOwnershipHistorySearch =
    document.getElementById("stock-ownership-history-search")?.value || "";
}

function formatSignedPts(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const fixed = v.toFixed(digits);
  return v > 0 ? `+${fixed}` : fixed;
}

function renderOwnershipHistoryHighlight(cardId, metaId, highlight) {
  const card = document.getElementById(cardId);
  const meta = document.getElementById(metaId);
  if (!card) return;
  if (!highlight?.ticker) {
    card.textContent = "—";
    if (meta) meta.textContent = "";
    return;
  }
  card.innerHTML = `<button type="button" class="linkish" data-open-stock="${escapeHtml(highlight.ticker)}">${escapeHtml(highlight.ticker)}</button>`;
  if (meta) {
    meta.textContent = [highlight.companyName, highlight.label].filter(Boolean).join(" · ");
  }
}

function renderStocksOwnershipHistoryPage() {
  setupStocksOwnershipHistoryPage();
  const payload = lastStocksOwnershipHistoryPayload;
  const body = document.getElementById("stock-ownership-history-body");
  const loading = document.getElementById("stock-ownership-history-loading");
  const countEl = document.getElementById("stock-ownership-history-count");
  const pagination = document.getElementById("stock-ownership-history-pagination");
  const pageLabel = document.getElementById("stock-ownership-history-page-label");
  const prevBtn = document.getElementById("stock-ownership-history-prev");
  const nextBtn = document.getElementById("stock-ownership-history-next");
  const subtitle = document.getElementById("stock-ownership-history-subtitle");

  if (loading) loading.hidden = !stocksOwnershipHistoryLoading;

  document.querySelectorAll("[data-ownership-history-sort]").forEach((btn) => {
    const key = btn.dataset.ownershipHistorySort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === stocksOwnershipHistorySortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (stocksOwnershipHistorySortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${stocksOwnershipHistorySortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  const summary = payload?.summary || {};
  renderOwnershipHistoryHighlight(
    "ownership-history-fastest",
    "ownership-history-fastest-meta",
    summary.fastestGrowth
  );
  renderOwnershipHistoryHighlight(
    "ownership-history-holders",
    "ownership-history-holders-meta",
    summary.biggestHolderIncrease
  );
  renderOwnershipHistoryHighlight(
    "ownership-history-decline",
    "ownership-history-decline-meta",
    summary.biggestDecline
  );
  renderOwnershipHistoryHighlight(
    "ownership-history-discovery",
    "ownership-history-discovery-meta",
    summary.newDiscoveries
  );

  if (!payload) {
    if (body && !stocksOwnershipHistoryLoading) {
      body.innerHTML = `<tr><td colspan="9" class="muted">No ownership history loaded. Run <code class="inline-code">npm run stocks:warm-ownership-history</code> if needed.</td></tr>`;
    }
    if (countEl) countEl.textContent = "";
    if (pagination) pagination.hidden = true;
    return;
  }

  const quarterSelect = document.getElementById("stock-ownership-history-quarter");
  if (quarterSelect) {
    const quarters = Array.isArray(payload.quarters) ? payload.quarters : [];
    const current = stocksOwnershipHistoryQuarter || payload.currentQuarter || "";
    quarterSelect.innerHTML = quarters
      .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
      .join("");
    if (current && quarters.includes(current)) quarterSelect.value = current;
    else if (quarters[0]) quarterSelect.value = quarters[0];
    stocksOwnershipHistoryQuarter = quarterSelect.value;
  }
  const sectorSelect = document.getElementById("stock-ownership-history-sector");
  if (sectorSelect) {
    const selected = stocksOwnershipHistorySector;
    const sectors = Array.isArray(payload.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = selected;
  }
  const catSelect = document.getElementById("stock-ownership-history-category");
  if (catSelect) catSelect.value = stocksOwnershipHistoryCategory;
  const mcap = document.getElementById("stock-ownership-history-mcap");
  if (mcap) mcap.value = stocksOwnershipHistoryMarketCap;

  if (subtitle) {
    const q = payload.currentQuarter || "—";
    const pq = payload.previousQuarter ? ` vs ${payload.previousQuarter}` : "";
    subtitle.textContent = `Historical ownership rankings from 13F filings${q ? ` · ${q}${pq}` : ""}.`;
  }

  const rows = Array.isArray(payload.stocks) ? payload.stocks : [];
  const total = Number(payload.total) || 0;
  const page = Number(payload.page) || stocksOwnershipHistoryPage;
  const pageSize = Number(payload.pageSize) || STOCKS_OWNERSHIP_HISTORY_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  if (countEl) countEl.textContent = `${formatInteger(total)} stock${total === 1 ? "" : "s"}`;

  if (!rows.length) {
    if (body) {
      body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No stocks match these filters.</td></tr>`;
    }
  } else if (body) {
    body.innerHTML = rows
      .map((row, idx) => {
        const rank = offset + idx + 1;
        const cat =
          OWNERSHIP_HISTORY_CATEGORY_LABELS[row.category] || row.category || "—";
        const label = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
        return `<tr data-stock-symbol="${escapeHtml(row.ticker)}">
          <td class="mono num">${rank}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${label}</a></td>
          <td class="mono num">${Number.isFinite(Number(row.currentInstitutionalOwnership)) ? `${Number(row.currentInstitutionalOwnership).toFixed(1)}%` : "—"}</td>
          <td class="mono num">${formatSignedPts(row.ownershipChange)}</td>
          <td class="mono num">${formatInteger(row.currentHolderCount)}</td>
          <td class="mono num">${formatInteger(row.newInstitutions)}</td>
          <td class="mono num">${formatInteger(row.exitedInstitutions)}</td>
          <td class="mono num">${Number.isFinite(Number(row.ownershipExpansionScore)) ? Number(row.ownershipExpansionScore).toFixed(1) : "—"}</td>
          <td>${escapeHtml(cat)}</td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageLabel) pageLabel.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadStocksOwnershipHistoryPage() {
  if (!stocksOwnershipHistoryOpen) return;
  if (stocksOwnershipHistoryLoading) {
    renderStocksOwnershipHistoryPage();
    return;
  }
  stocksOwnershipHistoryLoading = true;
  renderStocksOwnershipHistoryPage();
  const requestKey = JSON.stringify(buildStocksOwnershipHistoryQuery());
  try {
    lastStocksOwnershipHistoryPayload = await apiJson(
      "/api/stocks/ownership-history",
      buildStocksOwnershipHistoryQuery()
    );
  } catch (err) {
    lastStocksOwnershipHistoryPayload = null;
    const body = document.getElementById("stock-ownership-history-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    stocksOwnershipHistoryLoading = false;
    if (
      stocksOwnershipHistoryOpen &&
      JSON.stringify(buildStocksOwnershipHistoryQuery()) !== requestKey
    ) {
      void loadStocksOwnershipHistoryPage();
      return;
    }
    renderStocksOwnershipHistoryPage();
  }
}

function exportOwnershipHistoryCsv() {
  const rows = lastStocksOwnershipHistoryPayload?.stocks;
  if (!Array.isArray(rows) || !rows.length) return;
  const headers = [
    "rank",
    "ticker",
    "company_name",
    "sector",
    "current_institutional_ownership",
    "ownership_change",
    "current_holder_count",
    "holder_change",
    "new_institutions",
    "exited_institutions",
    "ownership_expansion_score",
    "institutional_adoption_score",
    "category",
    "quarter",
  ];
  const offset =
    ((Number(lastStocksOwnershipHistoryPayload.page) || 1) - 1) *
    (Number(lastStocksOwnershipHistoryPayload.pageSize) || STOCKS_OWNERSHIP_HISTORY_PAGE_SIZE);
  const lines = [headers.join(",")];
  rows.forEach((row, idx) => {
    const values = [
      offset + idx + 1,
      row.ticker,
      `"${String(row.companyName || "").replace(/"/g, '""')}"`,
      `"${String(row.sector || "").replace(/"/g, '""')}"`,
      row.currentInstitutionalOwnership,
      row.ownershipChange,
      row.currentHolderCount,
      row.holderChange,
      row.newInstitutions,
      row.exitedInstitutions,
      row.ownershipExpansionScore,
      row.institutionalAdoptionScore,
      row.category,
      row.currentQuarter,
    ];
    lines.push(values.join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ownership-history-${lastStocksOwnershipHistoryPayload.currentQuarter || "export"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function setupStocksOwnershipHistoryPage() {
  if (stocksOwnershipHistoryBound) return;
  stocksOwnershipHistoryBound = true;

  document.getElementById("stock-ownership-history-back")?.addEventListener("click", () => {
    navigateToStocksHub();
  });
  document.getElementById("stock-ownership-history-export")?.addEventListener("click", () => {
    exportOwnershipHistoryCsv();
  });
  document.getElementById("stock-ownership-history-prev")?.addEventListener("click", () => {
    if (stocksOwnershipHistoryPage <= 1) return;
    stocksOwnershipHistoryPage -= 1;
    void loadStocksOwnershipHistoryPage();
  });
  document.getElementById("stock-ownership-history-next")?.addEventListener("click", () => {
    stocksOwnershipHistoryPage += 1;
    void loadStocksOwnershipHistoryPage();
  });

  const panel = document.getElementById("view-stock-ownership-history");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-ownership-history-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-ownership-history-sort");
      if (!key || key === "rank") return;
      if (stocksOwnershipHistorySortKey === key) {
        stocksOwnershipHistorySortDir =
          stocksOwnershipHistorySortDir === "desc" ? "asc" : "desc";
      } else {
        stocksOwnershipHistorySortKey = key;
        stocksOwnershipHistorySortDir =
          key === "ticker" || key === "companyName" || key === "category" ? "asc" : "desc";
      }
      stocksOwnershipHistoryPage = 1;
      void loadStocksOwnershipHistoryPage();
      return;
    }
    const link = e.target.closest?.("[data-stock-symbol]");
    if (link) {
      e.preventDefault();
      const sym = link.getAttribute("data-stock-symbol");
      if (sym) void openStockPreview(sym);
      return;
    }
    const open = e.target.closest?.("[data-open-stock]");
    if (open) {
      const ticker = open.getAttribute("data-open-stock");
      if (ticker) void openStockPreview(ticker);
    }
  });

  [
    "stock-ownership-history-category",
    "stock-ownership-history-quarter",
    "stock-ownership-history-sector",
    "stock-ownership-history-mcap",
    "stock-ownership-history-min-growth",
    "stock-ownership-history-max-own",
    "stock-ownership-history-min-holders",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncStocksOwnershipHistoryFiltersFromDom();
      stocksOwnershipHistoryPage = 1;
      void loadStocksOwnershipHistoryPage();
    });
  });

  let searchTimer = null;
  document.getElementById("stock-ownership-history-search")?.addEventListener("input", (e) => {
    stocksOwnershipHistorySearch = e.target?.value || "";
    stocksOwnershipHistoryPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadStocksOwnershipHistoryPage(), 250);
  });
}

function compareFmtInt(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return formatInteger(n);
}

function compareFmtPct(n, signed = false) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function compareFmtUsd(n) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return "—";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

function compareFmtBool(v) {
  if (v == null) return "—";
  return v ? "Yes" : "No";
}

function compareHigherClass(a, b, side) {
  if (a == null || b == null || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return "";
  if (Number(a) === Number(b)) return "";
  const higher = Number(a) > Number(b) ? "A" : "B";
  return higher === side ? " is-higher-activity" : "";
}

function compareMetricRow(label, a, b, formatFn = compareFmtInt) {
  return `<tr>
    <td>${escapeHtml(label)}</td>
    <td class="mono num${compareHigherClass(a, b, "A")}">${escapeHtml(formatFn(a))}${
      compareHigherClass(a, b, "A") ? ' <span class="stock-compare-higher muted">Higher activity</span>' : ""
    }</td>
    <td class="mono num${compareHigherClass(a, b, "B")}">${escapeHtml(formatFn(b))}${
      compareHigherClass(a, b, "B") ? ' <span class="stock-compare-higher muted">Higher activity</span>' : ""
    }</td>
  </tr>`;
}

function compareSignalCell(sig) {
  if (!sig || sig.kind === "missing") return "—";
  if (sig.kind === "active") return sig.active ? "✓ Active" : "—";
  if (sig.kind === "score") {
    const label = sig.label ? ` · ${sig.label}` : "";
    return `${Number(sig.score).toFixed(0)}${label}`;
  }
  return "—";
}

function syncStockCompareSelectionUi() {
  const aSel = document.getElementById("stock-compare-a-selected");
  const bSel = document.getElementById("stock-compare-b-selected");
  const period = document.getElementById("stock-compare-period");
  const run = document.getElementById("stock-compare-run");
  const swap = document.getElementById("stock-compare-swap");
  if (aSel) aSel.textContent = stocksCompareSelection.a || "—";
  if (bSel) bSel.textContent = stocksCompareSelection.b || "—";
  if (period) period.value = stocksCompareSelection.period || "latest";
  const ready =
    Boolean(stocksCompareSelection.a) &&
    Boolean(stocksCompareSelection.b) &&
    stocksCompareSelection.a !== stocksCompareSelection.b;
  if (run) run.disabled = !ready;
  if (swap) swap.disabled = !stocksCompareSelection.a && !stocksCompareSelection.b;
}

function renderStockCompareSummary(payload) {
  const body = document.getElementById("stock-compare-summary-body");
  if (!body) return;
  const card = (side) => {
    const s = side.summary || {};
    const signals = (s.activeSignals || []).slice(0, 4).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    return `<div class="stock-compare-summary__card">
      <h4 class="mono">${escapeHtml(side.ticker)}</h4>
      <p class="muted small">${escapeHtml(side.companyName || "")}</p>
      <ul class="stock-compare-summary__list">
        <li>${compareFmtInt(s.institutionalHolders)} institutional holders</li>
        <li>${compareFmtInt(s.newPositions)} new positions</li>
        <li>${compareFmtInt(s.insiderBuyers)} insider buyers</li>
        <li>${compareFmtInt(s.politicianBuyers)} politician buyers</li>
      </ul>
      ${signals ? `<ul class="stock-compare-summary__signals">${signals}</ul>` : `<p class="muted small">No active scored signals in cache.</p>`}
    </div>`;
  };
  body.innerHTML = `${card(payload.stockA)}<div class="stock-compare-summary__vs">VS</div>${card(payload.stockB)}`;
}

function renderStockCompareInstitutional(payload) {
  const a = payload.stockA.institutional;
  const b = payload.stockB.institutional;
  const setHead = (id, ticker) => {
    const el = document.getElementById(id);
    if (el) el.textContent = ticker;
  };
  setHead("stock-compare-inst-head-a", payload.stockA.ticker);
  setHead("stock-compare-inst-head-b", payload.stockB.ticker);
  const body = document.getElementById("stock-compare-inst-body");
  if (!body) return;
  if (!a.available && !b.available) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No institutional 13F data available.</td></tr>`;
  } else {
    body.innerHTML = [
      compareMetricRow("Institutional holders", a.holderCount, b.holderCount),
      compareMetricRow("New positions", a.newPositions, b.newPositions),
      compareMetricRow("Increasing", a.increasingPositions, b.increasingPositions),
      compareMetricRow("Decreasing", a.decreasingPositions, b.decreasingPositions),
      compareMetricRow("Exited", a.exitedPositions, b.exitedPositions),
      compareMetricRow("Ownership", a.ownershipPercentage, b.ownershipPercentage, (n) => compareFmtPct(n)),
      compareMetricRow("QoQ change", a.ownershipChange, b.ownershipChange, (n) => compareFmtPct(n, true)),
      compareMetricRow("13F value", a.total13fValue, b.total13fValue, compareFmtUsd),
      compareMetricRow("Latest quarter", a.latestQuarter, b.latestQuarter, (n) => (n == null ? "—" : String(n))),
    ].join("");
  }

  const holdersEl = document.getElementById("stock-compare-inst-holders");
  if (holdersEl) {
    holdersEl.hidden = !stockCompareHoldersExpanded;
    if (stockCompareHoldersExpanded) {
      const table = (side, list) => {
        if (!list?.length) return `<p class="muted small">${escapeHtml(side)}: No data</p>`;
        return `<div><h4 class="institution-hub__section-label">${escapeHtml(side)} top holders</h4>
          <div class="table-scroll"><table class="trades-table"><thead><tr>
            <th class="num">Rank</th><th>Institution</th><th class="num">Weight*</th><th class="num">Shares</th><th class="num">Value</th><th class="num">QoQ</th>
          </tr></thead><tbody>${list
            .map(
              (h) => `<tr>
            <td class="mono num">${h.rank}</td>
            <td>${escapeHtml(h.institution)}</td>
            <td class="mono num">${h.portfolioWeight == null ? "—" : `${h.portfolioWeight.toFixed(2)}%`}</td>
            <td class="mono num">${compareFmtInt(h.shares)}</td>
            <td class="mono num">${compareFmtUsd(h.valueUsd)}</td>
            <td class="mono num">${compareFmtPct(h.qoqChangePct, true)}</td>
          </tr>`
            )
            .join("")}</tbody></table></div>
          <p class="muted small">* Weight = share of tracked holders’ reported value in this stock (not full portfolio weight).</p></div>`;
      };
      holdersEl.innerHTML = `<div class="stock-compare-holders-grid">${table(
        payload.stockA.ticker,
        a.topHolders
      )}${table(payload.stockB.ticker, b.topHolders)}</div>`;
    }
  }

  const overlapEl = document.getElementById("stock-compare-inst-overlap");
  if (overlapEl) {
    const items = payload.overlap?.institutions?.items || [];
    const count = payload.overlap?.institutions?.count ?? 0;
    overlapEl.innerHTML = `<h4 class="institution-hub__section-label">Institutions owning both (${formatInteger(
      count
    )})</h4>${
      items.length
        ? `<div class="table-scroll"><table class="trades-table"><thead><tr>
            <th>Institution</th>
            <th class="num">${escapeHtml(payload.stockA.ticker)} weight*</th>
            <th class="num">${escapeHtml(payload.stockB.ticker)} weight*</th>
          </tr></thead><tbody>${items
            .map(
              (i) => `<tr>
            <td>${escapeHtml(i.name)}</td>
            <td class="mono num">${i.weightA == null ? "—" : `${i.weightA.toFixed(2)}%`}</td>
            <td class="mono num">${i.weightB == null ? "—" : `${i.weightB.toFixed(2)}%`}</td>
          </tr>`
            )
            .join("")}</tbody></table></div>`
        : `<p class="muted small">No overlapping institutions in the tracked holder lists.</p>`
    }`;
  }
}

function renderStockCompareInsiders(payload) {
  const a = payload.stockA.insiders;
  const b = payload.stockB.insiders;
  document.getElementById("stock-compare-insider-head-a").textContent = payload.stockA.ticker;
  document.getElementById("stock-compare-insider-head-b").textContent = payload.stockB.ticker;
  const body = document.getElementById("stock-compare-insider-body");
  if (!a.available && !b.available) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No insider Form 4 data available.</td></tr>`;
  } else {
    body.innerHTML = [
      compareMetricRow("Buy transactions", a.buyTransactions, b.buyTransactions),
      compareMetricRow("Sell transactions", a.sellTransactions, b.sellTransactions),
      compareMetricRow("Unique buyers", a.uniqueBuyers, b.uniqueBuyers),
      compareMetricRow("Unique sellers", a.uniqueSellers, b.uniqueSellers),
      compareMetricRow("Est. buy value", a.estimatedBuyValue, b.estimatedBuyValue, compareFmtUsd),
      compareMetricRow("Est. sell value", a.estimatedSellValue, b.estimatedSellValue, compareFmtUsd),
      compareMetricRow("Open-market buys", a.openMarketBuys, b.openMarketBuys),
      compareMetricRow("Open-market sells", a.openMarketSells, b.openMarketSells),
      compareMetricRow("Repeat buyers", a.repeatBuyers, b.repeatBuyers),
      compareMetricRow("First-time buyers", a.firstTimeBuyers, b.firstTimeBuyers),
      compareMetricRow("Cluster buying", a.clusterBuying, b.clusterBuying, compareFmtBool),
      compareMetricRow("Heavy selling", a.heavySelling, b.heavySelling, compareFmtBool),
    ].join("");
  }
  const overlapEl = document.getElementById("stock-compare-insider-overlap");
  const items = payload.overlap?.insiders?.items || [];
  overlapEl.innerHTML = `<h4 class="institution-hub__section-label">Insiders trading both (${formatInteger(
    payload.overlap?.insiders?.count ?? 0
  )})</h4>${
    items.length
      ? `<div class="table-scroll"><table class="trades-table"><thead><tr>
          <th>Insider</th><th>Role</th>
          <th>${escapeHtml(payload.stockA.ticker)}</th>
          <th>${escapeHtml(payload.stockB.ticker)}</th>
          <th>Latest</th>
        </tr></thead><tbody>${items
          .map(
            (i) => `<tr>
          <td>${escapeHtml(i.name)}</td>
          <td>${escapeHtml(i.role || "—")}</td>
          <td>${escapeHtml(i.activityA)}</td>
          <td>${escapeHtml(i.activityB)}</td>
          <td class="mono">${escapeHtml(i.latestDate || "—")}</td>
        </tr>`
          )
          .join("")}</tbody></table></div>`
      : `<p class="muted small">No overlapping insiders in this period.</p>`
  }`;
}

function renderStockComparePoliticians(payload) {
  const a = payload.stockA.politicians;
  const b = payload.stockB.politicians;
  document.getElementById("stock-compare-pol-head-a").textContent = payload.stockA.ticker;
  document.getElementById("stock-compare-pol-head-b").textContent = payload.stockB.ticker;
  const body = document.getElementById("stock-compare-pol-body");
  if (!a.available && !b.available) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No politician disclosure data available.</td></tr>`;
  } else {
    body.innerHTML = [
      compareMetricRow("Buy transactions", a.buyTransactions, b.buyTransactions),
      compareMetricRow("Sell transactions", a.sellTransactions, b.sellTransactions),
      compareMetricRow("Unique buyers", a.uniqueBuyers, b.uniqueBuyers),
      compareMetricRow("Unique sellers", a.uniqueSellers, b.uniqueSellers),
      compareMetricRow("Est. buy value", a.estimatedBuyValue, b.estimatedBuyValue, compareFmtUsd),
      compareMetricRow("Est. sell value", a.estimatedSellValue, b.estimatedSellValue, compareFmtUsd),
      compareMetricRow("Repeat buyers", a.repeatBuyers, b.repeatBuyers),
      compareMetricRow("First-time buyers", a.firstTimeBuyers, b.firstTimeBuyers),
      compareMetricRow("Heavy buying", a.heavyBuying, b.heavyBuying, compareFmtBool),
      compareMetricRow("Heavy selling", a.heavySelling, b.heavySelling, compareFmtBool),
      compareMetricRow("Latest activity", a.latestActivityDate, b.latestActivityDate, (n) =>
        n == null ? "—" : String(n)
      ),
    ].join("");
  }
  document.getElementById("stock-compare-pol-party").innerHTML = `
    <h4 class="institution-hub__section-label">Party & chamber breakdown</h4>
    <div class="table-scroll"><table class="trades-table"><thead><tr>
      <th>Metric</th><th class="num">${escapeHtml(payload.stockA.ticker)}</th><th class="num">${escapeHtml(payload.stockB.ticker)}</th>
    </tr></thead><tbody>
      ${compareMetricRow("Democrat buyers", a.democratBuyers, b.democratBuyers)}
      ${compareMetricRow("Republican buyers", a.republicanBuyers, b.republicanBuyers)}
      ${compareMetricRow("Other/unknown buyers", a.otherBuyers, b.otherBuyers)}
      ${compareMetricRow("Democrat sellers", a.democratSellers, b.democratSellers)}
      ${compareMetricRow("Republican sellers", a.republicanSellers, b.republicanSellers)}
      ${compareMetricRow("Other/unknown sellers", a.otherSellers, b.otherSellers)}
      ${compareMetricRow("Senators buying", a.senatorBuyers, b.senatorBuyers)}
      ${compareMetricRow("Representatives buying", a.representativeBuyers, b.representativeBuyers)}
      ${compareMetricRow("Senators selling", a.senatorSellers, b.senatorSellers)}
      ${compareMetricRow("Representatives selling", a.representativeSellers, b.representativeSellers)}
    </tbody></table></div>`;

  const items = payload.overlap?.politicians?.items || [];
  document.getElementById("stock-compare-pol-overlap").innerHTML = `<h4 class="institution-hub__section-label">Politicians trading both (${formatInteger(
    payload.overlap?.politicians?.count ?? 0
  )})</h4>${
    items.length
      ? `<div class="table-scroll"><table class="trades-table"><thead><tr>
          <th>Politician</th><th>Party</th><th>Chamber</th>
          <th>${escapeHtml(payload.stockA.ticker)}</th>
          <th>${escapeHtml(payload.stockB.ticker)}</th>
          <th>Latest</th>
        </tr></thead><tbody>${items
          .map(
            (i) => `<tr>
          <td>${escapeHtml(i.name)}</td>
          <td>${escapeHtml(i.party || "—")}</td>
          <td>${escapeHtml(i.chamber || "—")}</td>
          <td>${escapeHtml(i.activityA)}</td>
          <td>${escapeHtml(i.activityB)}</td>
          <td class="mono">${escapeHtml(i.latestTransaction || "—")}</td>
        </tr>`
          )
          .join("")}</tbody></table></div>`
      : `<p class="muted small">No overlapping politicians in this period.</p>`
  }`;
}

function renderStockCompareSignals(payload) {
  document.getElementById("stock-compare-signals-head-a").textContent = payload.stockA.ticker;
  document.getElementById("stock-compare-signals-head-b").textContent = payload.stockB.ticker;
  const a = payload.stockA.signals;
  const b = payload.stockB.signals;
  const rows = [
    ["Smart Money", a.smartMoney, b.smartMoney],
    ["Double Signal", a.doubleSignal, b.doubleSignal],
    ["Triple Signal", a.tripleSignal, b.tripleSignal],
    ["Hidden Gem", a.hiddenGem, b.hiddenGem],
    ["Conflict Signal", a.conflictSignal, b.conflictSignal],
    ["Institutional Discovery", a.institutionalDiscovery, b.institutionalDiscovery],
    ["Conviction Score", a.convictionScore, b.convictionScore],
  ];
  document.getElementById("stock-compare-signals-body").innerHTML = rows
    .map(([name, sa, sb]) => {
      const href = sa?.href || sb?.href || "/signals";
      return `<tr>
        <td><a href="${escapeHtml(href)}" class="fundamentals-grid__link" data-compare-signal-link="${escapeHtml(
          href
        )}">${escapeHtml(name)}</a></td>
        <td class="mono num">${escapeHtml(compareSignalCell(sa))}</td>
        <td class="mono num">${escapeHtml(compareSignalCell(sb))}</td>
      </tr>`;
    })
    .join("");
}

function renderStockCompareShared(payload) {
  const el = document.getElementById("stock-compare-shared-body");
  if (!el) return;
  el.innerHTML = `
    <div class="stock-compare-shared__grid">
      <div class="stock-compare-shared__card">
        <h4>Institutions</h4>
        <p class="mono stock-compare-shared__count">${formatInteger(payload.overlap?.institutions?.count ?? 0)}</p>
        <p class="muted small">owning both</p>
        <ul>${(payload.overlap?.institutions?.items || [])
          .slice(0, 8)
          .map((i) => `<li>${escapeHtml(i.name)}</li>`)
          .join("") || "<li class='muted'>None</li>"}</ul>
      </div>
      <div class="stock-compare-shared__card">
        <h4>Insiders</h4>
        <p class="mono stock-compare-shared__count">${formatInteger(payload.overlap?.insiders?.count ?? 0)}</p>
        <p class="muted small">trading both</p>
        <ul>${(payload.overlap?.insiders?.items || [])
          .slice(0, 8)
          .map((i) => `<li>${escapeHtml(i.name)}</li>`)
          .join("") || "<li class='muted'>None</li>"}</ul>
      </div>
      <div class="stock-compare-shared__card">
        <h4>Politicians</h4>
        <p class="mono stock-compare-shared__count">${formatInteger(payload.overlap?.politicians?.count ?? 0)}</p>
        <p class="muted small">trading both</p>
        <ul>${(payload.overlap?.politicians?.items || [])
          .slice(0, 8)
          .map((i) => `<li>${escapeHtml(i.name)}</li>`)
          .join("") || "<li class='muted'>None</li>"}</ul>
      </div>
    </div>`;
}

function renderStockCompareTimeline(payload) {
  document.getElementById("stock-compare-tl-head-a").textContent = payload.stockA.ticker;
  document.getElementById("stock-compare-tl-head-b").textContent = payload.stockB.ticker;
  const body = document.getElementById("stock-compare-timeline-body");
  const events = Array.isArray(payload.timeline) ? payload.timeline : [];
  if (!events.length) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No filing activity in this period.</td></tr>`;
    return;
  }
  const byDate = new Map();
  for (const e of events) {
    const list = byDate.get(e.date) || [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a)).slice(0, 40);
  body.innerHTML = dates
    .map((date) => {
      const list = byDate.get(date) || [];
      const cell = (side) =>
        list
          .filter((e) => e.side === side)
          .map((e) => `<div class="stock-compare-tl-event">${escapeHtml(e.label)}</div>`)
          .join("") || `<span class="muted">—</span>`;
      return `<tr>
        <td class="mono">${escapeHtml(date)}</td>
        <td>${cell("A")}</td>
        <td>${cell("B")}</td>
      </tr>`;
    })
    .join("");
}

function renderStockComparePage() {
  setupStockComparePage();
  syncStockCompareSelectionUi();
  const loading = document.getElementById("stock-compare-loading");
  const errorEl = document.getElementById("stock-compare-error");
  const results = document.getElementById("stock-compare-results");
  if (loading) loading.hidden = !stockCompareLoading;
  const payload = lastStockComparePayload;
  if (!payload) {
    if (results) results.hidden = true;
    return;
  }
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
  if (results) results.hidden = false;
  renderStockCompareSummary(payload);
  renderStockCompareInstitutional(payload);
  renderStockCompareInsiders(payload);
  renderStockComparePoliticians(payload);
  renderStockCompareSignals(payload);
  renderStockCompareShared(payload);
  renderStockCompareTimeline(payload);
  const expandBtn = document.getElementById("stock-compare-inst-expand");
  if (expandBtn) {
    expandBtn.setAttribute("aria-expanded", stockCompareHoldersExpanded ? "true" : "false");
    expandBtn.textContent = stockCompareHoldersExpanded ? "Hide top holders" : "Top holders";
  }
}

async function loadStockComparePage() {
  setupStockComparePage();
  syncStockCompareSelectionUi();
  const a = stocksCompareSelection.a;
  const b = stocksCompareSelection.b;
  const results = document.getElementById("stock-compare-results");
  const errorEl = document.getElementById("stock-compare-error");
  if (!a || !b || a === b) {
    if (results) results.hidden = true;
    if (errorEl && a && b && a === b) {
      errorEl.hidden = false;
      errorEl.textContent = "Select two different stocks.";
    }
    return;
  }
  if (stockCompareLoading) {
    renderStockComparePage();
    return;
  }
  stockCompareLoading = true;
  renderStockComparePage();
  try {
    lastStockComparePayload = await apiJson("/api/stocks/compare", {
      tickerA: a,
      tickerB: b,
      period: stocksCompareSelection.period || "latest",
    });
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
  } catch (err) {
    lastStockComparePayload = null;
    if (results) results.hidden = true;
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = err instanceof Error ? err.message : String(err);
    }
  } finally {
    stockCompareLoading = false;
    renderStockComparePage();
  }
}

function setupStockComparePage() {
  if (stockCompareBound) return;
  stockCompareBound = true;

  document.getElementById("stock-compare-back")?.addEventListener("click", () => {
    navigateToStocksHub();
  });

  document.getElementById("stock-compare-period")?.addEventListener("change", (e) => {
    stocksCompareSelection.period = e.target.value || "latest";
    if (stocksCompareSelection.a && stocksCompareSelection.b) {
      navigateToStocksCompare({
        tickerA: stocksCompareSelection.a,
        tickerB: stocksCompareSelection.b,
        period: stocksCompareSelection.period,
      });
      void loadStockComparePage();
    } else {
      syncStockCompareSelectionUi();
    }
  });

  document.getElementById("stock-compare-run")?.addEventListener("click", () => {
    navigateToStocksCompare({
      tickerA: stocksCompareSelection.a,
      tickerB: stocksCompareSelection.b,
      period: stocksCompareSelection.period,
    });
    void loadStockComparePage();
  });

  document.getElementById("stock-compare-swap")?.addEventListener("click", () => {
    const tmp = stocksCompareSelection.a;
    stocksCompareSelection.a = stocksCompareSelection.b;
    stocksCompareSelection.b = tmp;
    navigateToStocksCompare({
      tickerA: stocksCompareSelection.a,
      tickerB: stocksCompareSelection.b,
      period: stocksCompareSelection.period,
    });
    void loadStockComparePage();
  });

  document.getElementById("stock-compare-inst-expand")?.addEventListener("click", () => {
    stockCompareHoldersExpanded = !stockCompareHoldersExpanded;
    renderStockComparePage();
  });

  document.getElementById("stock-compare-signals-body")?.addEventListener("click", (e) => {
    const link = e.target.closest?.("[data-compare-signal-link]");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("data-compare-signal-link");
    if (href) {
      history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  });

  const bindSearch = (side) => {
    const input = document.getElementById(side === "A" ? "stock-compare-a-input" : "stock-compare-b-input");
    const list = document.getElementById(
      side === "A" ? "stock-compare-a-suggestions" : "stock-compare-b-suggestions"
    );
    if (!input || !list) return;
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 1) {
          list.hidden = true;
          list.innerHTML = "";
          return;
        }
        try {
          const results = await searchStocks(q);
          if (!results.length) {
            list.innerHTML = `<li class="muted">No matches</li>`;
            list.hidden = false;
            return;
          }
          list.innerHTML = results
            .slice(0, 8)
            .map((r) => {
              const sym = String(r.symbol || "").toUpperCase();
              const name = r.name || r.description || "";
              return `<li><button type="button" data-compare-pick="${escapeHtml(sym)}" data-compare-side="${side}">
                <span class="mono">${escapeHtml(sym)}</span>
                <span class="muted small">${escapeHtml(name)}</span>
              </button></li>`;
            })
            .join("");
          list.hidden = false;
        } catch {
          list.hidden = true;
        }
      }, 200);
    });
    list.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-compare-pick]");
      if (!btn) return;
      const sym = btn.getAttribute("data-compare-pick");
      const which = btn.getAttribute("data-compare-side");
      if (!sym) return;
      if (which === "A") {
        if (sym === stocksCompareSelection.b) {
          const err = document.getElementById("stock-compare-error");
          if (err) {
            err.hidden = false;
            err.textContent = "Stock A and Stock B must be different.";
          }
          return;
        }
        stocksCompareSelection.a = sym;
      } else {
        if (sym === stocksCompareSelection.a) {
          const err = document.getElementById("stock-compare-error");
          if (err) {
            err.hidden = false;
            err.textContent = "Stock A and Stock B must be different.";
          }
          return;
        }
        stocksCompareSelection.b = sym;
      }
      input.value = "";
      list.hidden = true;
      list.innerHTML = "";
      syncStockCompareSelectionUi();
      if (stocksCompareSelection.a && stocksCompareSelection.b) {
        navigateToStocksCompare({
          tickerA: stocksCompareSelection.a,
          tickerB: stocksCompareSelection.b,
          period: stocksCompareSelection.period,
        });
        void loadStockComparePage();
      }
    });
  };
  bindSearch("A");
  bindSearch("B");
}

function setScreenerVisible(visible) {
  screenerOpen = Boolean(visible);
  if (screenerOpen) {
    recentlyActiveOpen = false;
    stocksMostAccumulatedOpen = false;
    stocksOwnershipChangesOpen = false;
    stocksHolderOverlapOpen = false;
    stocksOwnershipHistoryOpen = false;
    stocksCompareOpen = false;
  }
  updateStocksOverlay();
  if (screenerOpen) {
    renderHeader();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function navigateToStocksScreener() {
  if (window.location.pathname !== "/stocks/screener") {
    history.pushState({ screener: true }, "", "/stocks/screener");
  }
  showLandingView(false);
  setExploreMode("stocks", { navigate: false });
  setScreenerVisible(true);
}

function navigateToStocksRecentlyActive() {
  if (window.location.pathname !== "/stocks/recently-active") {
    history.pushState({ recentlyActive: true }, "", "/stocks/recently-active");
  }
  showLandingView(false);
  setExploreMode("stocks", { navigate: false });
  closeStocksOverlays();
  recentlyActiveOpen = true;
  updateStocksView();
}

function navigateToStocksMostAccumulated() {
  if (window.location.pathname !== "/stocks/most-accumulated") {
    history.pushState({ stocksMostAccumulated: true }, "", "/stocks/most-accumulated");
  }
  showLandingView(false);
  setExploreMode("stocks", { navigate: false });
  closeStocksOverlays();
  stocksMostAccumulatedOpen = true;
  updateStocksView();
}

function navigateToStocksOwnershipChanges() {
  if (window.location.pathname !== "/stocks/ownership-changes") {
    history.pushState({ stocksOwnershipChanges: true }, "", "/stocks/ownership-changes");
  }
  showLandingView(false);
  setExploreMode("stocks", { navigate: false });
  closeStocksOverlays();
  stocksOwnershipChangesOpen = true;
  updateStocksView();
}

function navigateToStocksHolderOverlap() {
  if (window.location.pathname !== "/stocks/holder-overlap") {
    history.pushState({ stocksHolderOverlap: true }, "", "/stocks/holder-overlap");
  }
  showLandingView(false);
  setExploreMode("stocks", { navigate: false });
  closeStocksOverlays();
  stocksHolderOverlapOpen = true;
  updateStocksView();
}

function navigateToStocksOwnershipHistory() {
  if (window.location.pathname !== "/stocks/ownership-history") {
    history.pushState({ stocksOwnershipHistory: true }, "", "/stocks/ownership-history");
  }
  showLandingView(false);
  setExploreMode("stocks", { navigate: false });
  closeStocksOverlays();
  stocksOwnershipHistoryOpen = true;
  updateStocksView();
}

function stockCompareUrl(a, b, period) {
  const params = new URLSearchParams();
  if (a) params.set("tickerA", a);
  if (b) params.set("tickerB", b);
  if (period && period !== "latest") params.set("period", period);
  const q = params.toString();
  return q ? `/stocks/compare?${q}` : "/stocks/compare";
}

function navigateToStocksCompare(options = {}) {
  previewStock = null;
  activeIndex = -1;
  if (options.tickerA) stocksCompareSelection.a = String(options.tickerA).trim().toUpperCase();
  if (options.tickerB) stocksCompareSelection.b = String(options.tickerB).trim().toUpperCase();
  if (options.period) stocksCompareSelection.period = String(options.period);
  const path = stockCompareUrl(
    stocksCompareSelection.a,
    stocksCompareSelection.b,
    stocksCompareSelection.period
  );
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState(
      {
        explore: "stocks",
        stocksCompare: true,
        tickerA: stocksCompareSelection.a,
        tickerB: stocksCompareSelection.b,
        period: stocksCompareSelection.period,
      },
      "",
      path
    );
  }
  closeStocksOverlays();
  stocksCompareOpen = true;
  updateStocksView();
}

function updateInstitutionsView() {
  const hub = document.getElementById("institution-hub");
  const rankings = document.getElementById("institution-performance-rankings");
  const proxyPerformance = document.getElementById("institution-proxy-performance");
  const mostAccumulated = document.getElementById("institution-most-accumulated");
  const newPositions = document.getElementById("institution-new-positions");
  const completelySold = document.getElementById("institution-completely-sold");
  const notableInvestors = document.getElementById("institution-notable-investors");
  const institutionCompare = document.getElementById("institution-compare");
  const profile = document.getElementById("institution-profile");
  const showProfile = Boolean(activeInstitutionCik);
  // "performance" hub view is now the 13F reported-value proxy (no Yahoo prices).
  const showPerformance =
    (activeInstitutionHubView === "performance" ||
      activeInstitutionHubView === "proxy-performance") &&
    !showProfile;
  const showMostAccumulated = activeInstitutionHubView === "most-accumulated" && !showProfile;
  const showNewPositions = activeInstitutionHubView === "new-positions" && !showProfile;
  const showCompletelySold = activeInstitutionHubView === "completely-sold" && !showProfile;
  const showNotableInvestors = activeInstitutionHubView === "notable-investors" && !showProfile;
  const showInstitutionCompare = activeInstitutionHubView === "compare" && !showProfile;
  const showDirectory =
    !showProfile &&
    !showPerformance &&
    !showMostAccumulated &&
    !showNewPositions &&
    !showCompletelySold &&
    !showNotableInvestors &&
    !showInstitutionCompare;
  if (hub) hub.hidden = !showDirectory;
  if (rankings) rankings.hidden = true; // retired Yahoo price-based rankings UI
  if (proxyPerformance) proxyPerformance.hidden = showProfile || !showPerformance;
  if (mostAccumulated) mostAccumulated.hidden = showProfile || !showMostAccumulated;
  if (newPositions) newPositions.hidden = showProfile || !showNewPositions;
  if (completelySold) completelySold.hidden = showProfile || !showCompletelySold;
  if (notableInvestors) notableInvestors.hidden = showProfile || !showNotableInvestors;
  if (institutionCompare) institutionCompare.hidden = showProfile || !showInstitutionCompare;
  if (profile) profile.hidden = !showProfile;
  if (showProfile) {
    scrollInstitutionProfileIntoView();
  } else if (showPerformance) {
    void ensureInstitutionProxyPerformance().show();
  } else if (showMostAccumulated) {
    void loadMostAccumulatedPage();
  } else if (showNewPositions) {
    void loadNewPositionsPage();
  } else if (showCompletelySold) {
    void loadCompletelySoldPage();
  } else if (showNotableInvestors) {
    renderNotableInvestorsPage();
  } else if (showInstitutionCompare) {
    void loadInstitutionComparePage();
  } else {
    renderInstitutionHub();
  }
}

function ensureInstitutionProxyPerformance() {
  if (institutionProxyPerformance) {
    institutionProxyPerformance.ensure();
    return institutionProxyPerformance;
  }
  institutionProxyPerformance = createInstitutionPerformanceProxyController({
    apiJson,
    onOpenInstitution: (cik) => {
      void openInstitution(cik, "holdings");
    },
    onBack: () => navigateToInstitutionDirectory(),
  });
  institutionProxyPerformance.ensure();
  return institutionProxyPerformance;
}

function navigateToInstitutionProxyPerformance() {
  navigateToInstitutionPerformanceRankings();
}

function navigateToInstitutionMostAccumulated() {
  activeInstitutionCik = null;
  activeInstitutionHubView = "most-accumulated";
  if (window.location.pathname !== "/institutions/most-accumulated") {
    history.pushState({ explore: "institutions", mostAccumulated: true }, "", "/institutions/most-accumulated");
  }
  setExploreMode("institutions", { navigate: false });
  updateInstitutionsView();
}

function navigateToInstitutionNewPositions() {
  activeInstitutionCik = null;
  activeInstitutionHubView = "new-positions";
  if (window.location.pathname !== "/institutions/new-positions") {
    history.pushState({ explore: "institutions", newPositions: true }, "", "/institutions/new-positions");
  }
  setExploreMode("institutions", { navigate: false });
  updateInstitutionsView();
}

function navigateToInstitutionCompletelySold() {
  activeInstitutionCik = null;
  activeInstitutionHubView = "completely-sold";
  if (window.location.pathname !== "/institutions/completely-sold") {
    history.pushState({ explore: "institutions", completelySold: true }, "", "/institutions/completely-sold");
  }
  setExploreMode("institutions", { navigate: false });
  updateInstitutionsView();
}

function navigateToInstitutionCompare({ cikA = "", cikB = "", replace = false } = {}) {
  activeInstitutionCik = null;
  activeInstitutionHubView = "compare";
  if (cikA) institutionCompareCikA = bareInstitutionCik(cikA);
  if (cikB) institutionCompareCikB = bareInstitutionCik(cikB);
  const params = new URLSearchParams();
  if (institutionCompareCikA) params.set("a", institutionCompareCikA);
  if (institutionCompareCikB) params.set("b", institutionCompareCikB);
  const qs = params.toString();
  const path = qs ? `/institutions/compare?${qs}` : "/institutions/compare";
  if (window.location.pathname + window.location.search !== path) {
    const state = { explore: "institutions", institutionCompare: true };
    if (replace) history.replaceState(state, "", path);
    else history.pushState(state, "", path);
  }
  setExploreMode("institutions", { navigate: false });
  updateInstitutionsView();
}

function navigateToNotableInvestors() {
  activeInstitutionCik = null;
  activeInstitutionHubView = "notable-investors";
  if (window.location.pathname !== "/institutions/notable-investors") {
    history.pushState(
      { explore: "institutions", notableInvestors: true },
      "",
      "/institutions/notable-investors"
    );
  }
  setExploreMode("institutions", { navigate: false });
  updateInstitutionsView();
}

function navigateToInstitutionPerformanceRankings() {
  activeInstitutionCik = null;
  activeInstitutionHubView = "performance";
  if (window.location.pathname !== "/institutions/performance") {
    history.pushState({ explore: "institutions", performanceRankings: true }, "", "/institutions/performance");
  }
  setExploreMode("institutions", { navigate: false });
  updateInstitutionsView();
}

function navigateToInstitutionDirectory() {
  activeInstitutionCik = null;
  activeInstitutionHubView = "directory";
  if (window.location.pathname !== "/institutions") {
    history.pushState({ explore: "institutions" }, "", "/institutions");
  }
  updateInstitutionsView();
}

function navigateToInsiderClusters() {
  activeInsiderKey = null;
  activeInsiderHubView = "clusters";
  if (window.location.pathname !== "/insiders/clusters") {
    history.pushState({ explore: "insiders", insiderHubView: "clusters" }, "", "/insiders/clusters");
  }
  setExploreMode("insiders", { navigate: false });
  updateInsidersView();
}

function navigateToConvictionBuys() {
  activeInsiderKey = null;
  activeInsiderHubView = "conviction-buys";
  if (window.location.pathname !== "/insiders/conviction-buys") {
    history.pushState(
      { explore: "insiders", insiderHubView: "conviction-buys" },
      "",
      "/insiders/conviction-buys"
    );
  }
  setExploreMode("insiders", { navigate: false });
  updateInsidersView();
}

function navigateToRepeatBuyers() {
  activeInsiderKey = null;
  activeInsiderHubView = "repeat-buyers";
  if (window.location.pathname !== "/insiders/repeat-buyers") {
    history.pushState(
      { explore: "insiders", insiderHubView: "repeat-buyers" },
      "",
      "/insiders/repeat-buyers"
    );
  }
  setExploreMode("insiders", { navigate: false });
  updateInsidersView();
}

function navigateToInsiderSentiment() {
  activeInsiderKey = null;
  activeInsiderHubView = "sentiment";
  if (window.location.pathname !== "/insiders/sentiment") {
    history.pushState(
      { explore: "insiders", insiderHubView: "sentiment" },
      "",
      "/insiders/sentiment"
    );
  }
  setExploreMode("insiders", { navigate: false });
  updateInsidersView();
}

function navigateToFirstTimeBuyers() {
  activeInsiderKey = null;
  activeInsiderHubView = "first-time-buyers";
  if (window.location.pathname !== "/insiders/first-time-buyers") {
    history.pushState(
      { explore: "insiders", insiderHubView: "first-time-buyers" },
      "",
      "/insiders/first-time-buyers"
    );
  }
  setExploreMode("insiders", { navigate: false });
  updateInsidersView();
}

function navigateToHeavySelling() {
  activeInsiderKey = null;
  activeInsiderHubView = "heavy-selling";
  if (window.location.pathname !== "/insiders/heavy-selling") {
    history.pushState(
      { explore: "insiders", insiderHubView: "heavy-selling" },
      "",
      "/insiders/heavy-selling"
    );
  }
  setExploreMode("insiders", { navigate: false });
  updateInsidersView();
}

function signalsHubPath(view = activeSignalsHubView) {
  if (view === "directory") return "/signals";
  if (view === "top-institution-entries") return "/signals/top-institution-new-entries";
  if (view === "double-signal") {
    return activeDoubleSignalTicker
      ? `/signals/double-signal/${encodeURIComponent(activeDoubleSignalTicker)}`
      : "/signals/double-signal";
  }
  if (view === "triple-signal") {
    return activeTripleSignalTicker
      ? `/signals/triple-signal/${encodeURIComponent(activeTripleSignalTicker)}`
      : "/signals/triple-signal";
  }
  if (view === "conflict-signals") return "/signals/conflict-signals";
  if (view === "hidden-gems") return "/signals/hidden-gems";
  if (view === "conviction-score") return "/signals/conviction-score";
  if (view === "institutional-discovery") return "/signals/institutional-discovery";
  return "/signals/smart-money";
}

function navigateToSignalsHub() {
  activeSignalsHubView = "directory";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = null;
  if (window.location.pathname !== "/signals") {
    history.pushState({ explore: "signals", signalsHubView: "directory" }, "", "/signals");
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToSignalsSmartMoney() {
  activeSignalsHubView = "smart-money";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = null;
  if (window.location.pathname !== "/signals/smart-money") {
    history.pushState({ explore: "signals", signalsHubView: "smart-money" }, "", "/signals/smart-money");
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToToolsHub() {
  activeToolsHubView = "directory";
  if (window.location.pathname !== "/tools") {
    history.pushState({ explore: "tools", toolsHubView: "directory" }, "", "/tools");
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
}

function navigateToToolsDcf(ticker = null) {
  activeToolsHubView = "dcf";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym ? `/tools/dcf?ticker=${encodeURIComponent(sym)}` : "/tools/dcf";
  const next = path;
  if (`${window.location.pathname}${window.location.search}` !== next) {
    history.pushState({ explore: "tools", toolsHubView: "dcf", ticker: sym || null }, "", next);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensureDcfCalculator();
  if (sym) void dcfCalculator?.loadTicker(sym);
}

function navigateToToolsWacc(ticker = null) {
  activeToolsHubView = "wacc";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym ? `/tools/wacc?ticker=${encodeURIComponent(sym)}` : "/tools/wacc";
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState({ explore: "tools", toolsHubView: "wacc", ticker: sym || null }, "", path);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensureWaccCalculator();
  if (sym) void waccCalculator?.loadTicker(sym);
}

function navigateToToolsEpv(ticker = null) {
  activeToolsHubView = "epv";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym ? `/tools/epv?ticker=${encodeURIComponent(sym)}` : "/tools/epv";
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState({ explore: "tools", toolsHubView: "epv", ticker: sym || null }, "", path);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensureEpvCalculator();
  if (sym) void epvCalculator?.loadTicker(sym);
}

function navigateToToolsEv(ticker = null) {
  activeToolsHubView = "ev";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym ? `/tools/ev?ticker=${encodeURIComponent(sym)}` : "/tools/ev";
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState({ explore: "tools", toolsHubView: "ev", ticker: sym || null }, "", path);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensureEvCalculator();
  if (sym) void evCalculator?.loadTicker(sym);
}

function navigateToToolsPe(ticker = null) {
  activeToolsHubView = "pe";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym ? `/tools/pe?ticker=${encodeURIComponent(sym)}` : "/tools/pe";
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState({ explore: "tools", toolsHubView: "pe", ticker: sym || null }, "", path);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensurePeCalculator();
  if (sym) void peCalculator?.loadTicker(sym);
}

function navigateToToolsEvEbitda(ticker = null) {
  activeToolsHubView = "evebitda";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym ? `/tools/ev-ebitda?ticker=${encodeURIComponent(sym)}` : "/tools/ev-ebitda";
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState({ explore: "tools", toolsHubView: "evebitda", ticker: sym || null }, "", path);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensureEvEbitdaCalculator();
  if (sym) void evebitdaCalculator?.loadTicker(sym);
}

function navigateToToolsFcfYield(ticker = null) {
  activeToolsHubView = "fcfyield";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym ? `/tools/fcf-yield?ticker=${encodeURIComponent(sym)}` : "/tools/fcf-yield";
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState({ explore: "tools", toolsHubView: "fcfyield", ticker: sym || null }, "", path);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensureFcfYieldCalculator();
  if (sym) void fcfYieldCalculator?.loadTicker(sym);
}

function navigateToToolsSimilarStocks(ticker = null) {
  activeToolsHubView = "similar";
  const sym = ticker ? String(ticker).trim().toUpperCase() : "";
  const path = sym
    ? `/tools/similar-stocks?ticker=${encodeURIComponent(sym)}`
    : "/tools/similar-stocks";
  if (`${window.location.pathname}${window.location.search}` !== path) {
    history.pushState({ explore: "tools", toolsHubView: "similar", ticker: sym || null }, "", path);
  }
  setExploreMode("tools", { navigate: false });
  updateToolsView();
  ensureSimilarStocksTool();
  if (sym) void similarStocksTool?.loadTicker(sym);
}

function ensureDcfCalculator() {
  if (dcfCalculator) {
    dcfCalculator.bind();
    return dcfCalculator;
  }
  dcfCalculator = createDcfCalculatorController({
    searchStocks,
    onNavigate: (ticker) => {
      if (!ticker) {
        navigateToToolsHub();
        return;
      }
      const path = `/tools/dcf?ticker=${encodeURIComponent(ticker)}`;
      if (`${window.location.pathname}${window.location.search}` !== path) {
        history.replaceState({ explore: "tools", toolsHubView: "dcf", ticker }, "", path);
      }
    },
    onOpenWacc: (ticker) => navigateToToolsWacc(ticker),
  });
  dcfCalculator.bind();
  return dcfCalculator;
}

function ensureWaccCalculator() {
  if (waccCalculator) {
    waccCalculator.bind();
    return waccCalculator;
  }
  waccCalculator = createWaccCalculatorController({
    searchStocks,
    onNavigateToHub: () => navigateToToolsHub(),
    onNavigateToDcf: (ticker) => navigateToToolsDcf(ticker),
    onWaccSaved: (saved) => {
      if (
        activeExploreMode === "tools" &&
        activeToolsHubView === "dcf" &&
        dcfCalculator?.getTicker?.() &&
        String(dcfCalculator.getTicker()).toUpperCase() === String(saved?.ticker || "").toUpperCase()
      ) {
        const status = document.getElementById("tools-dcf-wacc-status");
        if (status) status.textContent = `Calculated WACC available: ${(saved.wacc * 100).toFixed(2)}%.`;
      }
      if (
        activeExploreMode === "tools" &&
        activeToolsHubView === "epv" &&
        epvCalculator?.getTicker?.() &&
        String(epvCalculator.getTicker()).toUpperCase() === String(saved?.ticker || "").toUpperCase()
      ) {
        const status = document.getElementById("tools-epv-wacc-status");
        if (status) status.textContent = `Calculated WACC available: ${(saved.wacc * 100).toFixed(2)}%.`;
      }
    },
  });
  waccCalculator.bind();
  return waccCalculator;
}

function ensureEpvCalculator() {
  if (epvCalculator) {
    epvCalculator.bind();
    return epvCalculator;
  }
  epvCalculator = createEpvCalculatorController({
    searchStocks,
    onNavigateToHub: () => navigateToToolsHub(),
    onOpenWacc: (ticker) => navigateToToolsWacc(ticker),
  });
  epvCalculator.bind();
  return epvCalculator;
}

function ensureEvCalculator() {
  if (evCalculator) {
    evCalculator.bind();
    return evCalculator;
  }
  evCalculator = createEvCalculatorController({
    searchStocks,
    onNavigateToHub: () => navigateToToolsHub(),
  });
  evCalculator.bind();
  return evCalculator;
}

function ensurePeCalculator() {
  if (peCalculator) {
    peCalculator.bind();
    return peCalculator;
  }
  peCalculator = createPeCalculatorController({
    searchStocks,
    onNavigateToHub: () => navigateToToolsHub(),
  });
  peCalculator.bind();
  return peCalculator;
}

function ensureEvEbitdaCalculator() {
  if (evebitdaCalculator) {
    evebitdaCalculator.bind();
    return evebitdaCalculator;
  }
  evebitdaCalculator = createEvEbitdaCalculatorController({
    searchStocks,
    onNavigateToHub: () => navigateToToolsHub(),
  });
  evebitdaCalculator.bind();
  return evebitdaCalculator;
}

function ensureFcfYieldCalculator() {
  if (fcfYieldCalculator) {
    fcfYieldCalculator.bind();
    return fcfYieldCalculator;
  }
  fcfYieldCalculator = createFcfYieldCalculatorController({
    searchStocks,
    onNavigateToHub: () => navigateToToolsHub(),
  });
  fcfYieldCalculator.bind();
  return fcfYieldCalculator;
}

function ensureSimilarStocksTool() {
  if (similarStocksTool) {
    similarStocksTool.bind();
    return similarStocksTool;
  }
  similarStocksTool = createFindSimilarStocksController({
    searchStocks,
    onNavigateToHub: () => navigateToToolsHub(),
  });
  similarStocksTool.bind();
  return similarStocksTool;
}

function updateToolsView() {
  if (activeExploreMode !== "tools") return;
  const directory = document.getElementById("tools-directory-hub");
  const dcf = document.getElementById("tools-dcf-hub");
  const wacc = document.getElementById("tools-wacc-hub");
  const epv = document.getElementById("tools-epv-hub");
  const ev = document.getElementById("tools-ev-hub");
  const pe = document.getElementById("tools-pe-hub");
  const evebitda = document.getElementById("tools-evebitda-hub");
  const fcfyield = document.getElementById("tools-fcfyield-hub");
  const similar = document.getElementById("tools-similar-hub");
  const showDcf = activeToolsHubView === "dcf";
  const showWacc = activeToolsHubView === "wacc";
  const showEpv = activeToolsHubView === "epv";
  const showEv = activeToolsHubView === "ev";
  const showPe = activeToolsHubView === "pe";
  const showEvebitda = activeToolsHubView === "evebitda";
  const showFcfYield = activeToolsHubView === "fcfyield";
  const showSimilar = activeToolsHubView === "similar";
  if (directory) {
    directory.hidden =
      showDcf ||
      showWacc ||
      showEpv ||
      showEv ||
      showPe ||
      showEvebitda ||
      showFcfYield ||
      showSimilar;
  }
  if (dcf) dcf.hidden = !showDcf;
  if (wacc) wacc.hidden = !showWacc;
  if (epv) epv.hidden = !showEpv;
  if (ev) ev.hidden = !showEv;
  if (pe) pe.hidden = !showPe;
  if (evebitda) evebitda.hidden = !showEvebitda;
  if (fcfyield) fcfyield.hidden = !showFcfYield;
  if (similar) similar.hidden = !showSimilar;
  if (showDcf) ensureDcfCalculator();
  if (showWacc) ensureWaccCalculator();
  if (showEpv) ensureEpvCalculator();
  if (showEv) ensureEvCalculator();
  if (showPe) ensurePeCalculator();
  if (showEvebitda) ensureEvEbitdaCalculator();
  if (showFcfYield) ensureFcfYieldCalculator();
  if (showSimilar) ensureSimilarStocksTool();
}

function navigateToTopInstitutionNewEntries() {
  activeSignalsHubView = "top-institution-entries";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = null;
  if (window.location.pathname !== "/signals/top-institution-new-entries") {
    history.pushState(
      { explore: "signals", signalsHubView: "top-institution-entries" },
      "",
      "/signals/top-institution-new-entries"
    );
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToDoubleSignal(ticker = null) {
  activeSignalsHubView = "double-signal";
  activeTripleSignalTicker = null;
  activeDoubleSignalTicker = ticker ? String(ticker).trim().toUpperCase() : null;
  const path = activeDoubleSignalTicker
    ? `/signals/double-signal/${encodeURIComponent(activeDoubleSignalTicker)}`
    : "/signals/double-signal";
  if (window.location.pathname !== path) {
    history.pushState(
      { explore: "signals", signalsHubView: "double-signal", doubleSignalTicker: activeDoubleSignalTicker },
      "",
      path
    );
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToTripleSignal(ticker = null) {
  activeSignalsHubView = "triple-signal";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = ticker ? String(ticker).trim().toUpperCase() : null;
  const path = activeTripleSignalTicker
    ? `/signals/triple-signal/${encodeURIComponent(activeTripleSignalTicker)}`
    : "/signals/triple-signal";
  if (window.location.pathname !== path) {
    history.pushState(
      { explore: "signals", signalsHubView: "triple-signal", tripleSignalTicker: activeTripleSignalTicker },
      "",
      path
    );
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToConflictSignals() {
  activeSignalsHubView = "conflict-signals";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = null;
  if (window.location.pathname !== "/signals/conflict-signals") {
    history.pushState(
      { explore: "signals", signalsHubView: "conflict-signals" },
      "",
      "/signals/conflict-signals"
    );
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToHiddenGems() {
  activeSignalsHubView = "hidden-gems";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = null;
  if (window.location.pathname !== "/signals/hidden-gems") {
    history.pushState(
      { explore: "signals", signalsHubView: "hidden-gems" },
      "",
      "/signals/hidden-gems"
    );
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToConvictionScore() {
  activeSignalsHubView = "conviction-score";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = null;
  if (window.location.pathname !== "/signals/conviction-score") {
    history.pushState(
      { explore: "signals", signalsHubView: "conviction-score" },
      "",
      "/signals/conviction-score"
    );
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function navigateToInstitutionalDiscovery() {
  activeSignalsHubView = "institutional-discovery";
  activeDoubleSignalTicker = null;
  activeTripleSignalTicker = null;
  if (window.location.pathname !== "/signals/institutional-discovery") {
    history.pushState(
      { explore: "signals", signalsHubView: "institutional-discovery" },
      "",
      "/signals/institutional-discovery"
    );
  }
  setExploreMode("signals", { navigate: false });
  updateSignalsView();
}

function updateSignalsView() {
  if (activeExploreMode !== "signals") return;
  showMainEntityView();
  window.scrollTo({ top: 0, behavior: "instant" });

  const directory = document.getElementById("signals-directory-hub");
  const smartMoney = document.getElementById("signals-smart-money-hub");
  const topEntries = document.getElementById("signals-top-institution-entries-hub");
  const doubleSignal = document.getElementById("signals-double-signal-hub");
  const tripleSignal = document.getElementById("signals-triple-signal-hub");
  const conflictSignals = document.getElementById("signals-conflict-signals-hub");
  const hiddenGems = document.getElementById("signals-hidden-gems-hub");
  const convictionScore = document.getElementById("signals-conviction-score-hub");
  const institutionalDiscovery = document.getElementById("signals-institutional-discovery-hub");
  const showSmartMoney = activeSignalsHubView === "smart-money";
  const showTopEntries = activeSignalsHubView === "top-institution-entries";
  const showDoubleSignal = activeSignalsHubView === "double-signal";
  const showTripleSignal = activeSignalsHubView === "triple-signal";
  const showConflictSignals = activeSignalsHubView === "conflict-signals";
  const showHiddenGems = activeSignalsHubView === "hidden-gems";
  const showConvictionScore = activeSignalsHubView === "conviction-score";
  const showInstitutionalDiscovery = activeSignalsHubView === "institutional-discovery";
  const showDirectory =
    !showSmartMoney &&
    !showTopEntries &&
    !showDoubleSignal &&
    !showTripleSignal &&
    !showConflictSignals &&
    !showHiddenGems &&
    !showConvictionScore &&
    !showInstitutionalDiscovery;

  if (directory) directory.hidden = !showDirectory;
  if (smartMoney) smartMoney.hidden = !showSmartMoney;
  if (topEntries) topEntries.hidden = !showTopEntries;
  if (doubleSignal) doubleSignal.hidden = !showDoubleSignal;
  if (tripleSignal) tripleSignal.hidden = !showTripleSignal;
  if (conflictSignals) conflictSignals.hidden = !showConflictSignals;
  if (hiddenGems) hiddenGems.hidden = !showHiddenGems;
  if (convictionScore) convictionScore.hidden = !showConvictionScore;
  if (institutionalDiscovery) institutionalDiscovery.hidden = !showInstitutionalDiscovery;

  if (showSmartMoney) void loadSmartMoneyHub();
  if (showTopEntries) void loadTopInstitutionNewEntriesHub();
  if (showDoubleSignal) void loadDoubleSignalHub();
  if (showTripleSignal) void loadTripleSignalHub();
  if (showConflictSignals) void loadConflictSignalsHub();
  if (showHiddenGems) void loadHiddenGemsHub();
  if (showConvictionScore) void loadConvictionScoreHub();
  if (showInstitutionalDiscovery) void loadInstitutionalDiscoveryHub();
}

function navigateToInsiderTrades() {
  activeInsiderKey = null;
  activeInsiderHubView = "trades";
  if (window.location.pathname !== "/insiders/trades" && window.location.pathname !== "/insiders") {
    history.pushState({ explore: "insiders", insiderHubView: "trades" }, "", "/insiders/trades");
  }
  setExploreMode("insiders", { navigate: false });
  updateInsidersView();
}

function scrollInstitutionProfileIntoView() {
  const profile = document.getElementById("institution-profile");
  if (!profile || profile.hidden) return;
  requestAnimationFrame(() => {
    profile.scrollIntoView({ block: "start", behavior: "instant" });
  });
}

function setExploreMode(mode, { navigate = true } = {}) {
  if (!EXPLORE_MODES.includes(mode)) mode = "stocks";
  // Close mobile chrome so the dimmed scrim cannot stick after a section change.
  clearMobileOverlays();
  showLandingView(false);
  activeExploreMode = mode;
  updateExploreNav();
  updateTopSearchForMode();
  showMainEntityView();
  closeTopSearch();

  if (mode === "institutions") {
    if (navigate && !parseInstitutionRoute(window.location.pathname)) {
      activeInstitutionCik = null;
      activeInstitutionHubView = "directory";
      if (window.location.pathname !== "/institutions") {
        history.pushState({ explore: "institutions" }, "", "/institutions");
      }
    }
    updateInstitutionsView();
    return;
  }

  if (mode === "insiders") {
    activeInstitutionCik = null;
    if (!window.location.pathname.match(/^\/insiders\/[^/]+/)) {
      activeInsiderKey = null;
    } else if (parseInsiderRoute(window.location.pathname)) {
      /* keep profile key */
    } else {
      activeInsiderKey = null;
    }
    if (navigate) {
      const route = parseAppRoute(window.location.pathname);
      if (route.insiderHubView === "clusters") {
        activeInsiderHubView = "clusters";
        if (window.location.pathname !== "/insiders/clusters") {
          history.pushState({ explore: "insiders", insiderHubView: "clusters" }, "", "/insiders/clusters");
        }
      } else if (route.insiderHubView === "conviction-buys") {
        activeInsiderHubView = "conviction-buys";
        if (window.location.pathname !== "/insiders/conviction-buys") {
          history.pushState(
            { explore: "insiders", insiderHubView: "conviction-buys" },
            "",
            "/insiders/conviction-buys"
          );
        }
      } else if (route.insiderHubView === "repeat-buyers") {
        activeInsiderHubView = "repeat-buyers";
        if (window.location.pathname !== "/insiders/repeat-buyers") {
          history.pushState(
            { explore: "insiders", insiderHubView: "repeat-buyers" },
            "",
            "/insiders/repeat-buyers"
          );
        }
      } else if (route.insiderHubView === "sentiment") {
        activeInsiderHubView = "sentiment";
        if (window.location.pathname !== "/insiders/sentiment") {
          history.pushState(
            { explore: "insiders", insiderHubView: "sentiment" },
            "",
            "/insiders/sentiment"
          );
        }
      } else if (route.insiderHubView === "first-time-buyers") {
        activeInsiderHubView = "first-time-buyers";
        if (window.location.pathname !== "/insiders/first-time-buyers") {
          history.pushState(
            { explore: "insiders", insiderHubView: "first-time-buyers" },
            "",
            "/insiders/first-time-buyers"
          );
        }
      } else if (route.insiderHubView === "heavy-selling") {
        activeInsiderHubView = "heavy-selling";
        if (window.location.pathname !== "/insiders/heavy-selling") {
          history.pushState(
            { explore: "insiders", insiderHubView: "heavy-selling" },
            "",
            "/insiders/heavy-selling"
          );
        }
      } else if (!parseInsiderRoute(window.location.pathname)) {
        activeInsiderHubView = "trades";
        if (window.location.pathname !== "/insiders/trades" && window.location.pathname !== "/insiders") {
          history.pushState({ explore: "insiders", insiderHubView: "trades" }, "", "/insiders/trades");
        } else if (
          window.location.pathname === "/insiders/clusters" ||
          window.location.pathname === "/insiders/conviction-buys" ||
          window.location.pathname === "/insiders/repeat-buyers" ||
          window.location.pathname === "/insiders/sentiment" ||
          window.location.pathname === "/insiders/first-time-buyers" ||
          window.location.pathname === "/insiders/heavy-selling"
        ) {
          history.replaceState({ explore: "insiders", insiderHubView: "trades" }, "", "/insiders/trades");
        }
      }
    }
    void updateInsidersView();
    return;
  }

  if (mode === "politicians") {
    activeInstitutionCik = null;
    if (!window.location.pathname.match(/^\/politicians\/[^/]+/)) {
      activePoliticianKey = null;
    } else if (parsePoliticianRoute(window.location.pathname)) {
      /* keep profile key */
    } else if (
      window.location.pathname === "/politicians/most-accumulated" ||
      window.location.pathname === "/politicians/largest-portfolios" ||
      window.location.pathname === "/politicians/repeat-buyers" ||
      window.location.pathname === "/politicians/first-time-buyers" ||
      window.location.pathname === "/politicians/heavy-selling" ||
      window.location.pathname === "/politicians/sector-exposure" ||
      window.location.pathname.startsWith("/politicians/sector-exposure/")
    ) {
      activePoliticianKey = null;
    } else if (!parsePoliticianRoute(window.location.pathname)) {
      activePoliticianKey = null;
    }
    if (navigate) {
      const route = parseAppRoute(window.location.pathname);
      if (route.politicianHubView) {
        activePoliticianHubView = route.politicianHubView;
      } else if (!parsePoliticianRoute(window.location.pathname)) {
        activePoliticianHubView = "trades";
        if (
          window.location.pathname !== "/politicians" &&
          window.location.pathname !== "/politicians/trades"
        ) {
          history.pushState({ explore: "politicians", politicianHubView: "trades" }, "", "/politicians");
        }
      }
    }
    void updatePoliticiansView();
    return;
  }

  if (mode === "signals") {
    activeInstitutionCik = null;
    activePoliticianKey = null;
    activeInsiderKey = null;
    if (navigate) {
      const route = parseAppRoute(window.location.pathname);
      if (route.signalsHubView === "top-institution-entries") {
        activeSignalsHubView = "top-institution-entries";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = null;
        if (window.location.pathname !== "/signals/top-institution-new-entries") {
          history.pushState(
            { explore: "signals", signalsHubView: "top-institution-entries" },
            "",
            "/signals/top-institution-new-entries"
          );
        }
      } else if (route.signalsHubView === "double-signal") {
        activeSignalsHubView = "double-signal";
        activeTripleSignalTicker = null;
        activeDoubleSignalTicker = route.doubleSignalTicker ?? null;
        const path = activeDoubleSignalTicker
          ? `/signals/double-signal/${encodeURIComponent(activeDoubleSignalTicker)}`
          : "/signals/double-signal";
        if (window.location.pathname !== path) {
          history.pushState(
            { explore: "signals", signalsHubView: "double-signal", doubleSignalTicker: activeDoubleSignalTicker },
            "",
            path
          );
        }
      } else if (route.signalsHubView === "triple-signal") {
        activeSignalsHubView = "triple-signal";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = route.tripleSignalTicker ?? null;
        const path = activeTripleSignalTicker
          ? `/signals/triple-signal/${encodeURIComponent(activeTripleSignalTicker)}`
          : "/signals/triple-signal";
        if (window.location.pathname !== path) {
          history.pushState(
            { explore: "signals", signalsHubView: "triple-signal", tripleSignalTicker: activeTripleSignalTicker },
            "",
            path
          );
        }
      } else if (route.signalsHubView === "conflict-signals") {
        activeSignalsHubView = "conflict-signals";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = null;
        if (window.location.pathname !== "/signals/conflict-signals") {
          history.pushState(
            { explore: "signals", signalsHubView: "conflict-signals" },
            "",
            "/signals/conflict-signals"
          );
        }
      } else if (route.signalsHubView === "hidden-gems") {
        activeSignalsHubView = "hidden-gems";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = null;
        if (window.location.pathname !== "/signals/hidden-gems") {
          history.pushState(
            { explore: "signals", signalsHubView: "hidden-gems" },
            "",
            "/signals/hidden-gems"
          );
        }
      } else if (route.signalsHubView === "conviction-score") {
        activeSignalsHubView = "conviction-score";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = null;
        if (window.location.pathname !== "/signals/conviction-score") {
          history.pushState(
            { explore: "signals", signalsHubView: "conviction-score" },
            "",
            "/signals/conviction-score"
          );
        }
      } else if (route.signalsHubView === "institutional-discovery") {
        activeSignalsHubView = "institutional-discovery";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = null;
        if (window.location.pathname !== "/signals/institutional-discovery") {
          history.pushState(
            { explore: "signals", signalsHubView: "institutional-discovery" },
            "",
            "/signals/institutional-discovery"
          );
        }
      } else if (route.signalsHubView === "smart-money") {
        activeSignalsHubView = "smart-money";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = null;
        if (window.location.pathname !== "/signals/smart-money") {
          history.pushState({ explore: "signals", signalsHubView: "smart-money" }, "", "/signals/smart-money");
        }
      } else {
        activeSignalsHubView = "directory";
        activeDoubleSignalTicker = null;
        activeTripleSignalTicker = null;
        if (window.location.pathname !== "/signals") {
          history.pushState({ explore: "signals", signalsHubView: "directory" }, "", "/signals");
        }
      }
    }
    void updateSignalsView();
    return;
  }

  if (mode === "tools") {
    activeInstitutionCik = null;
    activePoliticianKey = null;
    activeInsiderKey = null;
    if (navigate) {
      if (activeToolsHubView === "dcf") {
        const sym = dcfCalculator?.getTicker?.() || "";
        const path = sym ? `/tools/dcf?ticker=${encodeURIComponent(sym)}` : "/tools/dcf";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState({ explore: "tools", toolsHubView: "dcf", ticker: sym || null }, "", path);
        }
      } else if (activeToolsHubView === "wacc") {
        const sym = waccCalculator?.getTicker?.() || "";
        const path = sym ? `/tools/wacc?ticker=${encodeURIComponent(sym)}` : "/tools/wacc";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState({ explore: "tools", toolsHubView: "wacc", ticker: sym || null }, "", path);
        }
      } else if (activeToolsHubView === "epv") {
        const sym = epvCalculator?.getTicker?.() || "";
        const path = sym ? `/tools/epv?ticker=${encodeURIComponent(sym)}` : "/tools/epv";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState({ explore: "tools", toolsHubView: "epv", ticker: sym || null }, "", path);
        }
      } else if (activeToolsHubView === "ev") {
        const sym = evCalculator?.getTicker?.() || "";
        const path = sym ? `/tools/ev?ticker=${encodeURIComponent(sym)}` : "/tools/ev";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState({ explore: "tools", toolsHubView: "ev", ticker: sym || null }, "", path);
        }
      } else if (activeToolsHubView === "pe") {
        const sym = peCalculator?.getTicker?.() || "";
        const path = sym ? `/tools/pe?ticker=${encodeURIComponent(sym)}` : "/tools/pe";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState({ explore: "tools", toolsHubView: "pe", ticker: sym || null }, "", path);
        }
      } else if (activeToolsHubView === "evebitda") {
        const sym = evebitdaCalculator?.getTicker?.() || "";
        const path = sym
          ? `/tools/ev-ebitda?ticker=${encodeURIComponent(sym)}`
          : "/tools/ev-ebitda";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState(
            { explore: "tools", toolsHubView: "evebitda", ticker: sym || null },
            "",
            path
          );
        }
      } else if (activeToolsHubView === "fcfyield") {
        const sym = fcfYieldCalculator?.getTicker?.() || "";
        const path = sym
          ? `/tools/fcf-yield?ticker=${encodeURIComponent(sym)}`
          : "/tools/fcf-yield";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState(
            { explore: "tools", toolsHubView: "fcfyield", ticker: sym || null },
            "",
            path
          );
        }
      } else if (activeToolsHubView === "similar") {
        const sym = similarStocksTool?.getTicker?.() || "";
        const path = sym
          ? `/tools/similar-stocks?ticker=${encodeURIComponent(sym)}`
          : "/tools/similar-stocks";
        if (`${window.location.pathname}${window.location.search}` !== path) {
          history.pushState(
            { explore: "tools", toolsHubView: "similar", ticker: sym || null },
            "",
            path
          );
        }
      } else if (window.location.pathname !== "/tools") {
        history.pushState({ explore: "tools", toolsHubView: "directory" }, "", "/tools");
      }
    }
    updateToolsView();
    return;
  }

  activeInstitutionCik = null;
  updateInstitutionsView();
  const onInstitutionPath =
    window.location.pathname.startsWith("/institution") ||
    window.location.pathname.startsWith("/institutions");
  const onPoliticiansPath = window.location.pathname.startsWith("/politicians");
  const onInsidersPath = window.location.pathname.startsWith("/insiders");
  const onSignalsPath = window.location.pathname.startsWith("/signals");
  const onToolsPath = window.location.pathname.startsWith("/tools");
  const onStocksScreener = window.location.pathname.startsWith("/stocks/screener");
  if (
    navigate &&
    (onInstitutionPath ||
      onPoliticiansPath ||
      onInsidersPath ||
      onSignalsPath ||
      onToolsPath ||
      onStocksScreener)
  ) {
    closeStocksOverlays();
    const sym = getDisplayStock()?.symbol;
    history.pushState({ explore: "stocks", symbol: sym }, "", sym ? stockPath(sym, activeStockTab) : "/stocks");
  }
}

async function ensureInstitutionsIndex() {
  if (trackedInstitutions.length) return;
  const data = await apiJson("/api/institutions");
  trackedInstitutions = Array.isArray(data.funds) ? data.funds : [];
  institutionCikByName.clear();
  for (const f of trackedInstitutions) {
    if (f?.name && f?.cik) institutionCikByName.set(f.name, bareInstitutionCik(f.cik));
  }
  renderInstitutionHub();
  void loadInstitutionHubStats();
}

function institutionTypeLabel(type) {
  return INSTITUTION_TYPE_LABELS[type] || type || "Institution";
}

function institutionHubQueryMatches(fund, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = String(fund.name || "").toLowerCase();
  const cik = bareInstitutionCik(fund.cik);
  return name.includes(q) || cik.includes(q.replace(/^0+/, ""));
}

function getFilteredInstitutions() {
  let rows = trackedInstitutions.filter((f) => {
    if (institutionHubFilters.category && f.type !== institutionHubFilters.category) return false;
    return institutionHubQueryMatches(f, institutionHubFilters.query);
  });

  const sort = institutionHubFilters.sort;
  if (sort === "type") {
    rows = [...rows].sort((a, b) => {
      const ta = institutionTypeLabel(a.type);
      const tb = institutionTypeLabel(b.type);
      return ta.localeCompare(tb) || String(a.name).localeCompare(String(b.name));
    });
  } else if (sort === "assets") {
    rows = [...rows].sort((a, b) => {
      const av = institutionHubStats.get(bareInstitutionCik(a.cik))?.portfolioValueUsd;
      const bv = institutionHubStats.get(bareInstitutionCik(b.cik))?.portfolioValueUsd;
      const an = av != null && Number.isFinite(av) ? av : -1;
      const bn = bv != null && Number.isFinite(bv) ? bv : -1;
      return bn - an || String(a.name).localeCompare(String(b.name));
    });
  } else if (sort === "holdings") {
    rows = [...rows].sort((a, b) => {
      const av = institutionHubStats.get(bareInstitutionCik(a.cik))?.positionCount;
      const bv = institutionHubStats.get(bareInstitutionCik(b.cik))?.positionCount;
      const an = av != null && Number.isFinite(av) ? av : -1;
      const bn = bv != null && Number.isFinite(bv) ? bv : -1;
      return bn - an || String(a.name).localeCompare(String(b.name));
    });
  } else {
    rows = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  return rows;
}

function ensureInstitutionHubStrategyRow() {
  const row = document.getElementById("institution-hub-strategy-row");
  if (!row || row.childElementCount) return;

  row.innerHTML = INSTITUTION_STRATEGY_CATEGORIES.map(
    ({ key, label }) => `
      <button
        type="button"
        class="institution-hub__strategy-btn"
        data-institution-category="${escapeHtml(key)}"
        aria-pressed="false"
      >
        <span class="institution-hub__strategy-label">${escapeHtml(label)}</span>
        <span class="institution-hub__strategy-count">—</span>
      </button>
    `
  ).join("");
}

function updateInstitutionHubStrategyRow() {
  const row = document.getElementById("institution-hub-strategy-row");
  if (!row) return;
  ensureInstitutionHubStrategyRow();

  row.querySelectorAll("[data-institution-category]").forEach((btn) => {
    const key = btn.getAttribute("data-institution-category");
    const count = trackedInstitutions.filter((f) => f.type === key).length;
    const active = institutionHubFilters.category === key;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
    const countEl = btn.querySelector(".institution-hub__strategy-count");
    if (countEl) countEl.textContent = `${count} institution${count === 1 ? "" : "s"}`;
  });
}

function updateInstitutionHubSortOptions() {
  const select = document.getElementById("institution-directory-sort");
  if (!select) return;
  const assetsOpt = select.querySelector('option[value="assets"]');
  const holdingsOpt = select.querySelector('option[value="holdings"]');
  const hasStats = institutionHubStats.size > 0;
  if (assetsOpt) {
    assetsOpt.disabled = !hasStats;
    assetsOpt.textContent = hasStats ? "Largest Assets" : "Largest Assets (loading…)";
  }
  if (holdingsOpt) {
    holdingsOpt.disabled = !hasStats;
    holdingsOpt.textContent = hasStats ? "Most Holdings" : "Most Holdings (loading…)";
  }
  if (!hasStats && (select.value === "assets" || select.value === "holdings")) {
    select.value = "az";
    institutionHubFilters.sort = "az";
  }
}

function syncInstitutionHubSearchInputs(value) {
  const header = document.getElementById("institution-hub-search");
  const directory = document.getElementById("institution-directory-search");
  if (header && header.value !== value) header.value = value;
  if (directory && directory.value !== value) directory.value = value;
}

function clearInstitutionHubFilters() {
  institutionHubFilters = { query: "", category: null, sort: "az" };
  institutionHubShowAll = false;
  syncInstitutionHubSearchInputs("");
  const select = document.getElementById("institution-directory-sort");
  if (select) select.value = "az";
  updateInstitutionHubStrategyRow();
  renderInstitutionHub();
}

async function loadInstitutionHubStats() {
  if (institutionHubStatsLoading || institutionHubStatsReady || !trackedInstitutions.length) return;
  institutionHubStatsLoading = true;
  const batchSize = 4;
  const funds = [...trackedInstitutions];
  for (let i = 0; i < funds.length; i += batchSize) {
    const batch = funds.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (f) => {
        const bare = bareInstitutionCik(f.cik);
        if (institutionHubStats.has(bare)) return;
        try {
          const data = await apiJson(`/api/institutions/${bare}`);
          const meta = data?.meta;
          if (meta) {
            institutionHubStats.set(bare, {
              positionCount: meta.positionCount ?? null,
              portfolioValueUsd: meta.portfolioValueUsd ?? null,
            });
          }
        } catch {
          /* profile stats optional for directory sorting */
        }
      })
    );
    updateInstitutionHubSortOptions();
    if (institutionHubFilters.sort === "assets" || institutionHubFilters.sort === "holdings") {
      renderInstitutionHub();
    }
  }
  institutionHubStatsLoading = false;
  institutionHubStatsReady = true;
  updateInstitutionHubSortOptions();
  renderInstitutionHub();
}

function updateInstitutionHubMoreControl(totalCount) {
  const foot = document.getElementById("institution-hub-more-foot");
  const btn = document.getElementById("institution-hub-more-btn");
  if (!foot || !btn) return;

  const extra = totalCount - INSTITUTION_HUB_PAGE_SIZE;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  if (institutionHubShowAll) {
    btn.textContent = "Show fewer";
    btn.setAttribute("aria-expanded", "true");
  } else {
    btn.textContent = `Show more (${extra})`;
    btn.setAttribute("aria-expanded", "false");
  }
}

function renderInstitutionHub() {
  const grid = document.getElementById("institution-hub-grid");
  const empty = document.getElementById("institution-hub-empty");
  const loading = document.getElementById("institution-hub-loading");
  const countEl = document.getElementById("institution-directory-count");
  if (!grid) return;

  if (!trackedInstitutions.length) {
    if (loading) loading.hidden = false;
    grid.hidden = true;
    if (empty) empty.hidden = true;
    if (countEl) countEl.textContent = "";
    updateInstitutionHubMoreControl(0);
    return;
  }

  if (loading) loading.hidden = true;
  updateInstitutionHubStrategyRow();
  updateInstitutionHubSortOptions();

  const rows = getFilteredInstitutions();
  if (countEl) {
    const total = trackedInstitutions.length;
    countEl.textContent =
      rows.length === total ? `${rows.length} institutions` : `${rows.length} of ${total}`;
  }

  if (!rows.length) {
    grid.hidden = true;
    grid.innerHTML = "";
    const hasActiveFilters = Boolean(
      institutionHubFilters.query.trim() || institutionHubFilters.category
    );
    if (empty) empty.hidden = !(trackedInstitutions.length && hasActiveFilters);
    updateInstitutionHubMoreControl(0);
    return;
  }

  if (empty) empty.hidden = true;
  grid.hidden = false;
  const visibleRows = institutionHubShowAll ? rows : rows.slice(0, INSTITUTION_HUB_PAGE_SIZE);
  grid.innerHTML = visibleRows
    .map(
      (f) => `
    <button
      type="button"
      class="institution-dir-card"
      role="listitem"
      data-institution-cik="${escapeHtml(bareInstitutionCik(f.cik))}"
      aria-label="Open ${escapeHtml(f.name)}"
    >
      <span class="institution-dir-card__name">${escapeHtml(f.name)}</span>
      <span class="institution-dir-card__type">${escapeHtml(institutionTypeLabel(f.type))}</span>
      <span class="institution-dir-card__cik">CIK ${escapeHtml(bareInstitutionCik(f.cik))}</span>
    </button>
  `
    )
    .join("");

  grid.querySelectorAll("[data-institution-cik]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cik = btn.getAttribute("data-institution-cik");
      if (cik) void openInstitution(cik, "holdings");
    });
  });

  updateInstitutionHubMoreControl(rows.length);
}

function setupInstitutionHub() {
  if (institutionHubControlsBound) return;
  institutionHubControlsBound = true;

  const headerSearch = document.getElementById("institution-hub-search");
  const directorySearch = document.getElementById("institution-directory-search");
  const sortSelect = document.getElementById("institution-directory-sort");
  const clearBtn = document.getElementById("institution-hub-clear-filters");
  const strategyRow = document.getElementById("institution-hub-strategy-row");

  const onSearchInput = (value) => {
    institutionHubFilters.query = value;
    institutionHubShowAll = false;
    syncInstitutionHubSearchInputs(value);
    renderInstitutionHub();
  };

  if (headerSearch) {
    headerSearch.addEventListener("input", () => onSearchInput(headerSearch.value));
  }
  if (directorySearch) {
    directorySearch.addEventListener("input", () => onSearchInput(directorySearch.value));
  }
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      institutionHubFilters.sort = sortSelect.value || "az";
      institutionHubShowAll = false;
      renderInstitutionHub();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => clearInstitutionHubFilters());
  }
  if (strategyRow) {
    strategyRow.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-institution-category]");
      if (!btn) return;
      const key = btn.getAttribute("data-institution-category");
      institutionHubFilters.category = institutionHubFilters.category === key ? null : key;
      institutionHubShowAll = false;
      updateInstitutionHubStrategyRow();
      renderInstitutionHub();
    });
  }
  const moreBtn = document.getElementById("institution-hub-more-btn");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      institutionHubShowAll = !institutionHubShowAll;
      renderInstitutionHub();
    });
  }
}

function parsePoliticianFilingDateMs(value) {
  const m = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

function getAllPoliticianFilings() {
  const house = Array.isArray(politiciansRecentData?.house) ? politiciansRecentData.house : [];
  const senate = Array.isArray(politiciansRecentData?.senate) ? politiciansRecentData.senate : [];
  return [...house, ...senate];
}

function sortPoliticianFilings(filings) {
  const rows = [...filings];
  rows.sort((a, b) => {
    const byDate = parsePoliticianFilingDateMs(b.filingDate) - parsePoliticianFilingDateMs(a.filingDate);
    if (byDate !== 0) return byDate;
    return String(a.politicianName || "").localeCompare(String(b.politicianName || ""), undefined, {
      sensitivity: "base",
    });
  });
  return rows;
}

function parseTradeDateMs(value) {
  if (!value) return 0;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return parsePoliticianFilingDateMs(value);
}

function formatPoliticianTradeDate(value) {
  if (!value) return "—";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  return String(value);
}

function flattenPoliticianTrades(filings) {
  const rows = [];
  for (const filing of filings) {
    const key = filing.politicianKey || politicianKey(filing.politicianName);
    for (const trade of filing.trades || []) {
      rows.push({
        ...trade,
        politicianName: filing.politicianName,
        politicianKey: trade.politicianKey || key,
        chamber: filing.chamber,
        filingDate: filing.filingDate,
      });
    }
  }
  return rows;
}

function getFilteredPoliticianTrades() {
  let filings = getAllPoliticianFilings();
  const chamber = politiciansHubFilters.chamber;
  if (chamber === "house" || chamber === "senate") {
    filings = filings.filter((f) => f.chamber === chamber);
  }
  let rows = flattenPoliticianTrades(filings);
  const key = politiciansHubFilters.sortKey || "date";
  const mul = politiciansHubFilters.sortDir === "asc" ? 1 : -1;
  const stockLabel = (t) => String(t.ticker || t.assetName || "").toUpperCase();
  const typeLabel = (t) => String(t.transactionCategory || t.transactionType || "").toLowerCase();
  const amountOf = (t) => t.amountMax ?? t.amountMin ?? 0;

  rows.sort((a, b) => {
    let cmp = 0;
    if (key === "politicianName") {
      cmp = String(a.politicianName || "").localeCompare(String(b.politicianName || ""), undefined, {
        sensitivity: "base",
      });
    } else if (key === "stock") {
      cmp = stockLabel(a).localeCompare(stockLabel(b), undefined, { sensitivity: "base" });
    } else if (key === "type") {
      cmp = typeLabel(a).localeCompare(typeLabel(b), undefined, { sensitivity: "base" });
    } else if (key === "amount") {
      cmp = amountOf(a) - amountOf(b);
    } else if (key === "chamber") {
      cmp = String(a.chamber || "").localeCompare(String(b.chamber || ""), undefined, {
        sensitivity: "base",
      });
    } else {
      cmp = parseTradeDateMs(a.transactionDate) - parseTradeDateMs(b.transactionDate);
    }
    if (cmp !== 0) return cmp * mul;
    const byDate = parseTradeDateMs(b.transactionDate) - parseTradeDateMs(a.transactionDate);
    if (byDate !== 0) return byDate;
    return String(a.politicianName || "").localeCompare(String(b.politicianName || ""), undefined, {
      sensitivity: "base",
    });
  });
  return rows;
}

function normalizePoliticianKeyMatch(value) {
  let key = politicianKey(String(value || ""));
  if (key.startsWith("hon-")) key = key.slice(4);
  if (key.startsWith("rep-")) key = key.slice(4);
  if (key.startsWith("sen-")) key = key.slice(4);
  return key;
}

function getPoliticianFilingsByKey(key) {
  if (!key) return [];
  const want = normalizePoliticianKeyMatch(key);
  return getAllPoliticianFilings().filter((f) => {
    const stored = normalizePoliticianKeyMatch(f.politicianKey || "");
    if (stored && stored === want) return true;
    return normalizePoliticianKeyMatch(f.politicianName) === want;
  });
}

function politicianStockCell(trade) {
  const raw = trade.ticker ? String(trade.ticker).trim().toUpperCase() : "";
  const placeholder =
    !raw ||
    raw === "--" ||
    raw === "—" ||
    raw === "–" ||
    raw === "-" ||
    raw === "N/A" ||
    raw === "NA" ||
    raw === "NONE";
  const sym = placeholder ? "" : raw;
  if (sym) return institutionStockLinkHtml(sym, sym);
  const name = String(trade.assetName || "").trim();
  if (!name) return "—";
  const paren = name.match(/\(([A-Z]{1,6}(?:\.[A-Z])?)\)/);
  if (paren) return institutionStockLinkHtml(paren[1], name);
  const short = name.length > 52 ? `${name.slice(0, 49)}…` : name;
  return escapeHtml(short);
}

function updatePoliticiansHubToolbar() {
  document.querySelectorAll("[data-politicians-chamber]").forEach((btn) => {
    const on = btn.dataset.politiciansChamber === politiciansHubFilters.chamber;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-politicians-trades-sort]").forEach((btn) => {
    const key = btn.getAttribute("data-politicians-trades-sort");
    const active = key === politiciansHubFilters.sortKey;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (politiciansHubFilters.sortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${politiciansHubFilters.sortDir === "asc" ? "▲" : "▼"}`
      : label;
  });
}

function politiciansTradesDefaultSortDir(key) {
  if (key === "politicianName" || key === "stock" || key === "type" || key === "chamber") return "asc";
  return "desc";
}

function setupPoliticiansHub() {
  if (politiciansHubControlsBound) return;
  politiciansHubControlsBound = true;

  const chamberRow = document.getElementById("politicians-hub-chamber-row");

  if (chamberRow) {
    chamberRow.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-politicians-chamber]");
      if (!btn) return;
      const chamber = btn.getAttribute("data-politicians-chamber");
      if (!chamber || chamber === politiciansHubFilters.chamber) return;
      politiciansHubFilters.chamber = chamber;
      politiciansHubShowAllTrades = false;
      updatePoliticiansHubToolbar();
      renderPoliticiansHub();
    });
  }

  document.querySelectorAll("[data-politicians-trades-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-politicians-trades-sort");
      if (!key) return;
      if (key === politiciansHubFilters.sortKey) {
        politiciansHubFilters.sortDir = politiciansHubFilters.sortDir === "asc" ? "desc" : "asc";
      } else {
        politiciansHubFilters.sortKey = key;
        politiciansHubFilters.sortDir = politiciansTradesDefaultSortDir(key);
      }
      politiciansHubShowAllTrades = false;
      updatePoliticiansHubToolbar();
      renderPoliticiansHub();
    });
  });

  document.getElementById("politicians-trades-more-btn")?.addEventListener("click", () => {
    politiciansHubShowAllTrades = !politiciansHubShowAllTrades;
    renderPoliticiansHub();
  });
  document.getElementById("politicians-hub-most-accumulated-link")?.addEventListener("click", () => {
    navigateToPoliticianMostAccumulated();
  });
  document.getElementById("politicians-hub-largest-portfolios-link")?.addEventListener("click", () => {
    navigateToPoliticianLargestPortfolios();
  });
  document.getElementById("politicians-hub-repeat-buyers-link")?.addEventListener("click", () => {
    navigateToPoliticianRepeatBuyers();
  });
  document.getElementById("politicians-hub-first-time-buyers-link")?.addEventListener("click", () => {
    navigateToPoliticianFirstTimeBuyers();
  });
  document.getElementById("politicians-hub-heavy-selling-link")?.addEventListener("click", () => {
    navigateToPoliticianHeavySelling();
  });
  document.getElementById("politicians-back-btn")?.addEventListener("click", () => {
    closePoliticianProfile();
  });
}

function openPoliticianProfile(key, { navigate = true } = {}) {
  if (!key) return;
  activePoliticianKey = key;
  activePoliticianHubView = "trades";
  if (navigate) {
    const path = politicianPath(key);
    if (window.location.pathname !== path) {
      history.pushState({ politicianKey: key }, "", path);
    }
  }
  // Switch into politicians mode when coming from Stocks (e.g. congress-activity).
  // Avoid calling setExploreMode when already there — updatePoliticiansView used to
  // re-enter openPoliticianProfile and freeze the tab in a loop.
  if (activeExploreMode !== "politicians") {
    setExploreMode("politicians", { navigate: false });
    return;
  }
  void updatePoliticiansView();
}

function closePoliticianProfile({ navigate = true } = {}) {
  activePoliticianKey = null;
  if (navigate && window.location.pathname !== "/politicians") {
    history.pushState({ explore: "politicians" }, "", "/politicians");
  }
  if (activeExploreMode === "politicians") {
    void updatePoliticiansView();
  } else {
    renderPoliticiansHub();
  }
}

function politicianChamberLabel(chamber) {
  return chamber === "senate" ? "Senate" : "House";
}

function politicianTradeCategoryLabel(category) {
  if (category === "buy") return "Purchase";
  if (category === "sell") return "Sale";
  if (category === "exchange") return "Exchange";
  return "Other";
}

function politicianTradeCategoryClass(category) {
  if (category === "buy") return "politicians-trade--buy";
  if (category === "sell") return "politicians-trade--sell";
  return "";
}

/** Normalize House PTR codes to Senate-style display labels. */
function politicianTransactionTypeLabel(trade) {
  const raw = String(trade?.transactionType || "").trim();
  if (!raw) return politicianTradeCategoryLabel(trade?.transactionCategory);
  const upper = raw.toUpperCase();
  if (upper === "P") return "Purchase";
  if (upper === "S") return "Sale (Full)";
  if (/^S\s*\(\s*PARTIAL\s*\)$/i.test(raw)) return "Sale (Partial)";
  if (upper === "E") return "Exchange";
  return raw;
}

function politicianAssetTypeLabel(trade) {
  const raw = String(trade?.assetType || "").trim();
  if (!raw) return "—";
  const upper = raw.toUpperCase();
  const map = {
    ST: "Stock",
    OP: "Stock Option",
    GS: "Government Security",
    PS: "Preferred Stock",
    OT: "Other",
    HN: "Hedge Fund / Non-Public",
    CS: "Corporate Security",
    BD: "Corporate Bond",
  };
  return map[upper] || raw;
}

function formatPoliticianLocation(filing) {
  if (filing.chamber === "house") {
    const parts = [filing.state, filing.district ? `D${filing.district}` : null].filter(Boolean);
    return parts.join("-") || "";
  }
  if (filing.state) return String(filing.state);
  return filing.office || "";
}

function renderPoliticianTradeRows(trades) {
  if (!trades?.length) {
    return `<tr><td colspan="7" class="politicians-hub__no-trades">No transactions parsed</td></tr>`;
  }
  return trades
    .map((trade) => {
      const catClass = politicianTradeCategoryClass(trade.transactionCategory);
      const typeLabel = politicianTransactionTypeLabel(trade);
      const comment = String(trade.comment || "").trim();
      return `<tr class="politicians-hub__trade-row ${catClass}">
        <td>${escapeHtml(formatPoliticianTradeDate(trade.transactionDate))}</td>
        <td>${escapeHtml(trade.owner || "—")}</td>
        <td>${politicianStockCell(trade)}</td>
        <td>${escapeHtml(politicianAssetTypeLabel(trade))}</td>
        <td>${escapeHtml(typeLabel)}</td>
        <td class="num">${escapeHtml(trade.amountRange || "—")}</td>
        <td class="politicians-hub__comment">${comment ? escapeHtml(comment) : "—"}</td>
      </tr>`;
    })
    .join("");
}

function renderPoliticianTradeTableRow(trade) {
  const catClass = politicianTradeCategoryClass(trade.transactionCategory);
  const key = trade.politicianKey || politicianKey(trade.politicianName);
  const typeLabel = politicianTransactionTypeLabel(trade);
  return `<tr class="politicians-hub__trade-row ${catClass}" data-chamber="${escapeHtml(trade.chamber || "")}">
    <td><a href="${politicianPath(key)}" class="politicians-name-link" data-politician-key="${escapeHtml(key)}">${escapeHtml(trade.politicianName)}</a></td>
    <td>${politicianStockCell(trade)}</td>
    <td>${escapeHtml(typeLabel)}</td>
    <td>${escapeHtml(formatPoliticianTradeDate(trade.transactionDate))}</td>
    <td class="num">${escapeHtml(trade.amountRange || "—")}</td>
    <td><span class="politicians-hub__chamber-badge politicians-hub__chamber-badge--inline">${escapeHtml(politicianChamberLabel(trade.chamber))}</span></td>
  </tr>`;
}

function renderPoliticianFilingCard(filing) {
  const location = formatPoliticianLocation(filing);
  const chamberLabel = politicianChamberLabel(filing.chamber);
  return `<article class="politicians-hub__filing" data-chamber="${escapeHtml(filing.chamber)}">
    <header class="politicians-hub__filing-head">
      <div>
        <div class="politicians-hub__filing-title-row">
          <h4 class="politicians-hub__filing-name">${escapeHtml(filing.politicianName)}</h4>
          <span class="politicians-hub__chamber-badge">${escapeHtml(chamberLabel)}</span>
        </div>
        <p class="politicians-hub__filing-meta muted small">
          ${escapeHtml(filing.filingDate || "—")}${location ? ` · ${escapeHtml(location)}` : ""} · ${filing.tradeCount} trade${filing.tradeCount === 1 ? "" : "s"}
        </p>
      </div>
      <a class="politicians-hub__source-link small" href="${escapeHtml(filing.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source</a>
    </header>
    <div class="politicians-hub__table-wrap">
      <table class="politicians-hub__table politicians-hub__table--senate">
        <thead>
          <tr>
            <th>Date</th>
            <th>Owner</th>
            <th>Stock</th>
            <th>Asset type</th>
            <th>Type</th>
            <th class="num">Amount</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>${renderPoliticianTradeRows(filing.trades)}</tbody>
      </table>
    </div>
  </article>`;
}

function renderPoliticianProfile() {
  const nameEl = document.getElementById("politicians-profile-name");
  const metaEl = document.getElementById("politicians-profile-meta");
  const list = document.getElementById("politicians-profile-filings");
  if (!activePoliticianKey) return;

  if (politiciansHubLoading && !politiciansRecentData) {
    if (nameEl) nameEl.textContent = "Loading…";
    if (metaEl) metaEl.textContent = "Fetching congressional filings…";
    if (list) list.innerHTML = `<p class="muted small">Loading trades…</p>`;
    return;
  }

  const filings = getPoliticianFilingsByKey(activePoliticianKey);
  if (!filings.length) {
    // Only close after data has loaded and this key truly has no filings.
    if (politiciansHubLoaded) {
      activePoliticianKey = null;
      if (window.location.pathname.startsWith("/politicians/")) {
        history.replaceState({ explore: "politicians" }, "", "/politicians");
      }
      renderPoliticiansHub();
    }
    return;
  }
  const sorted = sortPoliticianFilings(filings);
  const first = sorted[0];
  const tradeCount = sorted.reduce((n, f) => n + (f.tradeCount || 0), 0);
  const chambers = [...new Set(sorted.map((f) => politicianChamberLabel(f.chamber)))].join(" · ");
  if (nameEl) nameEl.textContent = first.politicianName;
  if (metaEl) {
    metaEl.textContent = `${sorted.length} filing${sorted.length === 1 ? "" : "s"} · ${tradeCount} trade${tradeCount === 1 ? "" : "s"} · ${chambers}`;
  }
  if (list) list.innerHTML = sorted.map(renderPoliticianFilingCard).join("");
  void loadPoliticianProfileSector(activePoliticianKey);
}

function renderPoliticiansHubList() {
  const empty = document.getElementById("politicians-hub-empty");
  const loading = document.getElementById("politicians-hub-loading");
  const main = document.getElementById("politicians-hub-main");
  const profile = document.getElementById("politicians-profile");
  const toolbar = document.getElementById("politicians-hub-toolbar");
  const tradesWrap = document.getElementById("politicians-trades-wrap");
  const tradesBody = document.getElementById("politicians-trades-body");
  const moreFoot = document.getElementById("politicians-trades-more-foot");
  const moreBtn = document.getElementById("politicians-trades-more-btn");
  const emptyFilter = document.getElementById("politicians-hub-empty-filter");
  const meta = document.getElementById("politicians-hub-meta");

  const showProfile = Boolean(activePoliticianKey);
  if (main) main.hidden = showProfile;
  if (profile) profile.hidden = !showProfile;
  if (showProfile) {
    renderPoliticianProfile();
    return;
  }

  if (loading) loading.hidden = !politiciansHubLoading;
  if (!politiciansHubLoading && !politiciansRecentData) {
    if (empty) empty.hidden = false;
    if (main) main.hidden = true;
    if (profile) profile.hidden = true;
    return;
  }
  if (politiciansHubLoading) {
    if (empty) empty.hidden = true;
    return;
  }

  const trades = getFilteredPoliticianTrades();
  const hasData = trades.length > 0;
  const visible = politiciansHubShowAllTrades
    ? trades
    : trades.slice(0, POLITICIANS_TRADES_INITIAL_COUNT);
  const hasMore = trades.length > POLITICIANS_TRADES_INITIAL_COUNT;

  if (empty) empty.hidden = hasData;
  if (toolbar) toolbar.hidden = !hasData;
  if (meta) {
    meta.hidden = !hasData;
    if (hasData) {
      const chamberLabel =
        politiciansHubFilters.chamber === "all"
          ? "All chambers"
          : politicianChamberLabel(politiciansHubFilters.chamber);
      meta.textContent = `${trades.length} trade${trades.length === 1 ? "" : "s"} · ${chamberLabel}`;
    }
  }

  updatePoliticiansHubToolbar();

  if (emptyFilter) emptyFilter.hidden = !(getAllPoliticianFilings().length > 0 && !hasData);
  if (tradesWrap) tradesWrap.hidden = !hasData;
  if (tradesBody) {
    tradesBody.innerHTML = hasData
      ? visible.map(renderPoliticianTradeTableRow).join("")
      : `<tr><td colspan="6" class="trades-table__empty">No trades to display.</td></tr>`;
  }
  if (moreFoot) moreFoot.hidden = !hasData || !hasMore;
  if (moreBtn) {
    const remaining = Math.max(0, trades.length - POLITICIANS_TRADES_INITIAL_COUNT);
    moreBtn.textContent = politiciansHubShowAllTrades
      ? "Show less"
      : `Show ${remaining} more trade${remaining === 1 ? "" : "s"}`;
    moreBtn.setAttribute("aria-expanded", String(politiciansHubShowAllTrades));
  }
}

function renderPoliticiansHub() {
  renderPoliticiansHubList();
}

async function ensurePoliticiansRecent() {
  if (politiciansHubLoaded && politiciansRecentData) return politiciansRecentData;
  politiciansHubLoading = true;
  renderPoliticiansHub();
  try {
    politiciansRecentData = await apiJson("/api/politicians/recent");
    politiciansHubLoaded = true;
    return politiciansRecentData;
  } catch (err) {
    politiciansRecentData = null;
    politiciansHubLoaded = true;
    return null;
  } finally {
    politiciansHubLoading = false;
    renderPoliticiansHub();
  }
}

async function updatePoliticiansView() {
  if (activeExploreMode !== "politicians") return;
  showMainEntityView();
  window.scrollTo({ top: 0, behavior: "instant" });
  await ensurePoliticiansRecent();

  const hub = document.getElementById("politicians-hub");
  const mostAccumulated = document.getElementById("politicians-most-accumulated");
  const largestPortfolios = document.getElementById("politicians-largest-portfolios");
  const repeatBuyers = document.getElementById("politicians-repeat-buyers");
  const firstTimeBuyers = document.getElementById("politicians-first-time-buyers");
  const heavySelling = document.getElementById("politicians-heavy-selling");
  const sectorExposure = document.getElementById("politicians-sector-exposure");
  const showProfile = Boolean(activePoliticianKey);
  const showMostAccumulated = activePoliticianHubView === "most-accumulated" && !showProfile;
  const showLargestPortfolios = activePoliticianHubView === "largest-portfolios" && !showProfile;
  const showRepeatBuyers = activePoliticianHubView === "repeat-buyers" && !showProfile;
  const showFirstTimeBuyers = activePoliticianHubView === "first-time-buyers" && !showProfile;
  const showHeavySelling = activePoliticianHubView === "heavy-selling" && !showProfile;
  const showSectorExposure = activePoliticianHubView === "sector-exposure" && !showProfile;
  const showTrades =
    !showProfile &&
    !showMostAccumulated &&
    !showLargestPortfolios &&
    !showRepeatBuyers &&
    !showFirstTimeBuyers &&
    !showHeavySelling &&
    !showSectorExposure;

  if (hub) hub.hidden = !showTrades && !showProfile;
  if (mostAccumulated) mostAccumulated.hidden = !showMostAccumulated;
  if (largestPortfolios) largestPortfolios.hidden = !showLargestPortfolios;
  if (repeatBuyers) repeatBuyers.hidden = !showRepeatBuyers;
  if (firstTimeBuyers) firstTimeBuyers.hidden = !showFirstTimeBuyers;
  if (heavySelling) heavySelling.hidden = !showHeavySelling;
  if (sectorExposure) sectorExposure.hidden = !showSectorExposure;

  const route = parsePoliticianRoute(window.location.pathname);
  if (route?.key) {
    activePoliticianKey = route.key;
    activePoliticianHubView = "trades";
    if (hub) hub.hidden = false;
    if (mostAccumulated) mostAccumulated.hidden = true;
    if (largestPortfolios) largestPortfolios.hidden = true;
    if (repeatBuyers) repeatBuyers.hidden = true;
    if (firstTimeBuyers) firstTimeBuyers.hidden = true;
    if (heavySelling) heavySelling.hidden = true;
    if (sectorExposure) sectorExposure.hidden = true;
    renderPoliticiansHub();
    return;
  }
  if (showMostAccumulated) {
    void loadPoliticianMostAccumulatedPage();
    return;
  }
  if (showLargestPortfolios) {
    void loadPoliticianLargestPortfoliosPage();
    return;
  }
  if (showRepeatBuyers) {
    void loadPoliticianRepeatBuyersPage();
    return;
  }
  if (showFirstTimeBuyers) {
    void loadPoliticianFirstTimeBuyersPage();
    return;
  }
  if (showHeavySelling) {
    void loadPoliticianHeavySellingPage();
    return;
  }
  if (showSectorExposure) {
    const sectorRoute = window.location.pathname.match(/^\/politicians\/sector-exposure\/([^/]+)\/?$/);
    activePoliticianSectorSlug = sectorRoute ? decodeURIComponent(sectorRoute[1]) : "";
    void loadPoliticianSectorExposurePage();
    return;
  }
  renderPoliticiansHub();
}

function navigateToPoliticianTrades() {
  activePoliticianKey = null;
  activePoliticianHubView = "trades";
  if (window.location.pathname !== "/politicians") {
    history.pushState({ explore: "politicians", politicianHubView: "trades" }, "", "/politicians");
  }
  setExploreMode("politicians", { navigate: false });
  updatePoliticiansView();
}

function navigateToPoliticianMostAccumulated() {
  activePoliticianKey = null;
  activePoliticianHubView = "most-accumulated";
  if (window.location.pathname !== "/politicians/most-accumulated") {
    history.pushState(
      { explore: "politicians", politicianHubView: "most-accumulated" },
      "",
      "/politicians/most-accumulated"
    );
  }
  setExploreMode("politicians", { navigate: false });
  updatePoliticiansView();
}

function navigateToPoliticianLargestPortfolios() {
  activePoliticianKey = null;
  activePoliticianHubView = "largest-portfolios";
  if (window.location.pathname !== "/politicians/largest-portfolios") {
    history.pushState(
      { explore: "politicians", politicianHubView: "largest-portfolios" },
      "",
      "/politicians/largest-portfolios"
    );
  }
  setExploreMode("politicians", { navigate: false });
  updatePoliticiansView();
}

function navigateToPoliticianRepeatBuyers() {
  activePoliticianKey = null;
  activePoliticianHubView = "repeat-buyers";
  if (window.location.pathname !== "/politicians/repeat-buyers") {
    history.pushState(
      { explore: "politicians", politicianHubView: "repeat-buyers" },
      "",
      "/politicians/repeat-buyers"
    );
  }
  setExploreMode("politicians", { navigate: false });
  updatePoliticiansView();
}

function navigateToPoliticianFirstTimeBuyers() {
  activePoliticianKey = null;
  activePoliticianHubView = "first-time-buyers";
  if (window.location.pathname !== "/politicians/first-time-buyers") {
    history.pushState(
      { explore: "politicians", politicianHubView: "first-time-buyers" },
      "",
      "/politicians/first-time-buyers"
    );
  }
  setExploreMode("politicians", { navigate: false });
  updatePoliticiansView();
}

function navigateToPoliticianHeavySelling() {
  activePoliticianKey = null;
  activePoliticianHubView = "heavy-selling";
  if (window.location.pathname !== "/politicians/heavy-selling") {
    history.pushState(
      { explore: "politicians", politicianHubView: "heavy-selling" },
      "",
      "/politicians/heavy-selling"
    );
  }
  setExploreMode("politicians", { navigate: false });
  updatePoliticiansView();
}

function navigateToPoliticianSectorExposure({ sectorSlug = "" } = {}) {
  activePoliticianKey = null;
  activePoliticianHubView = "sector-exposure";
  activePoliticianSectorSlug = sectorSlug || "";
  const path = sectorSlug ? politicianSectorPath(sectorSlug) : "/politicians/sector-exposure";
  if (window.location.pathname !== path) {
    history.pushState(
      { explore: "politicians", politicianHubView: "sector-exposure", sectorSlug: sectorSlug || null },
      "",
      path
    );
  }
  setExploreMode("politicians", { navigate: false });
  updatePoliticiansView();
}

const POLITICIAN_ACCUMULATED_SORT_LABELS = {
  rank: "Rank",
  ticker: "Stock",
  politiciansBuying: "Politicians buying",
  netAmountUsd: "Net amount",
  percentIncrease: "% increase",
  totalPoliticiansActive: "Total politicians active",
};

const POLITICIAN_PORTFOLIOS_SORT_LABELS = {
  rank: "Rank",
  politicianName: "Politician",
  chamber: "Chamber",
  totalBuyUsd: "Total purchases",
  totalSellUsd: "Total sales",
  netPortfolioUsd: "Net portfolio",
  tradeCount: "Trades",
};

function formatDisclosedUsd(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  return `${sign}$${formatLargeNumber(Math.abs(x))}`;
}

function formatDisclosedUsdPlain(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `$${formatLargeNumber(Math.abs(x))}`;
}

function politicianAnalyticsPeriodLabel(period) {
  if (period === "30d") return "Last 30 days";
  if (period === "year") return "Last year";
  return "Last quarter";
}

function politicianAccumulatedRowClass(row) {
  const classes = [];
  if (row.highlightManyPoliticians) classes.push("most-accumulated-row--many-institutions");
  if (row.highlightHighIncrease) classes.push("most-accumulated-row--high-increase");
  if (row.isNewTop10) classes.push("most-accumulated-row--new-top10");
  return classes.join(" ");
}

function filterPoliticianAccumulatedRows(rows) {
  const q = politicianAccumulatedFilters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (politicianAccumulatedFilters.positiveOnly && row.netAmountUsd <= 0) return false;
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const label = String(row.assetLabel || "").toLowerCase();
    return ticker.includes(q) || label.includes(q);
  });
}

function sortPoliticianRows(rows, key, dir, defaultNumericKey) {
  const factor = dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    if (key === "rank") return 0;
    if (key === "ticker") {
      const al = String(a.assetLabel || a.ticker || "");
      const bl = String(b.assetLabel || b.ticker || "");
      return al.localeCompare(bl) * factor;
    }
    if (key === "politicianName") {
      return String(a.politicianName || "").localeCompare(String(b.politicianName || "")) * factor;
    }
    if (key === "chamber") {
      return String(a.chamber || "").localeCompare(String(b.chamber || "")) * factor;
    }
    const av = Number(a[key]);
    const bv = Number(b[key]);
    if (Number.isFinite(av) && Number.isFinite(bv)) return (av - bv) * factor;
    return 0;
  });
  if (key === "rank" || key === defaultNumericKey) {
    const ranked = [...sorted].sort((a, b) => Number(b[defaultNumericKey]) - Number(a[defaultNumericKey]));
    return dir === "asc" ? ranked.reverse() : ranked;
  }
  return sorted;
}

function renderPoliticianMostAccumulatedSummary(summary) {
  const wrap = document.getElementById("politicians-most-accumulated-summary");
  const topEl = document.getElementById("politicians-accumulated-top-stock");
  const topMeta = document.getElementById("politicians-accumulated-top-stock-meta");
  const buyersEl = document.getElementById("politicians-accumulated-total-buyers");
  const amountEl = document.getElementById("politicians-accumulated-total-amount");
  const avgEl = document.getElementById("politicians-accumulated-avg-pct");
  if (!wrap) return;
  if (!summary?.topStock) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  if (topEl) {
    topEl.textContent = summary.topStock.assetLabel
      ? `${summary.topStock.ticker} · ${summary.topStock.assetLabel}`
      : summary.topStock.ticker;
  }
  if (topMeta) topMeta.textContent = `${formatDisclosedUsd(summary.topStock.netAmountUsd)} net`;
  if (buyersEl) buyersEl.textContent = formatInteger(summary.totalPoliticiansBuying);
  if (amountEl) {
    amountEl.textContent = formatDisclosedUsd(summary.totalNetAmountUsd);
    amountEl.className = `institution-most-accumulated__summary-value mono ${
      summary.totalNetAmountUsd >= 0 ? "change--up" : "change--down"
    }`;
  }
  if (avgEl) {
    const x = summary.averagePercentIncrease;
    avgEl.textContent = x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
  }
}

function renderPoliticianMostAccumulatedTable() {
  const body = document.getElementById("politicians-most-accumulated-body");
  const loading = document.getElementById("politicians-most-accumulated-loading");
  const subtitle = document.getElementById("politicians-most-accumulated-subtitle");
  const countEl = document.getElementById("politicians-accumulated-count");
  if (!body) return;

  document.querySelectorAll("[data-politician-accumulation-period]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.politicianAccumulationPeriod === politicianAccumulatedPeriod);
  });
  document.querySelectorAll("[data-politicians-page-chamber]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.politiciansPageChamber === politicianAccumulatedChamber);
  });
  document.querySelectorAll("[data-politicians-accumulated-sort]").forEach((btn) => {
    const key = btn.dataset.politiciansAccumulatedSort;
    const active = key === politicianAccumulatedSortKey;
    const label = POLITICIAN_ACCUMULATED_SORT_LABELS[key] || key;
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? `${label} ${politicianAccumulatedSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  if (loading) loading.hidden = !politicianMostAccumulatedLoading;
  if (politicianMostAccumulatedLoading) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">Loading congressional accumulation…</td></tr>`;
    return;
  }

  const payload = lastPoliticianMostAccumulated;
  if (!payload) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No accumulation data available.</td></tr>`;
    return;
  }
  if (!payload.available) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">${escapeHtml(
      payload.unavailableReason || "Period unavailable."
    )}</td></tr>`;
    renderPoliticianMostAccumulatedSummary(null);
    if (subtitle) subtitle.textContent = `${politicianAnalyticsPeriodLabel(politicianAccumulatedPeriod)} · unavailable`;
    if (countEl) countEl.textContent = "";
    return;
  }

  const filtered = filterPoliticianAccumulatedRows(payload.stocks || []);
  const rows = sortPoliticianRows(
    filtered,
    politicianAccumulatedSortKey,
    politicianAccumulatedSortDir,
    "netAmountUsd"
  );

  const filteredSummary = {
    topStock: rows[0]
      ? { ticker: rows[0].ticker, assetLabel: rows[0].assetLabel, netAmountUsd: rows[0].netAmountUsd }
      : null,
    totalPoliticiansBuying: rows.reduce((sum, r) => sum + r.politiciansBuying, 0),
    totalNetAmountUsd: rows.reduce((sum, r) => sum + r.netAmountUsd, 0),
    averagePercentIncrease: (() => {
      const vals = rows.map((r) => r.percentIncrease).filter((v) => v != null && Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    })(),
  };
  renderPoliticianMostAccumulatedSummary(filteredSummary);

  const chamberLabel =
    politicianAccumulatedChamber === "all"
      ? "All chambers"
      : politicianChamberLabel(politicianAccumulatedChamber);
  if (subtitle) {
    subtitle.textContent = `${politicianAnalyticsPeriodLabel(politicianAccumulatedPeriod)} · ${chamberLabel} · ${rows.length} stocks`;
  }
  if (countEl) countEl.textContent = rows.length ? `${rows.length} shown` : "No matches";

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No stocks match the current filters.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((row, index) => {
      const amountClass = row.netAmountUsd >= 0 ? "change--up" : "change--down";
      const pctClass =
        row.percentIncrease == null ? "" : row.percentIncrease >= 0 ? "change--up" : "change--down";
      const label = row.assetLabel
        ? `<span class="most-accumulated-stock__name">${escapeHtml(row.assetLabel)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
        : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
      return `<tr class="${politicianAccumulatedRowClass(row)}">
      <td class="mono num">${index + 1}</td>
      <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${label}</a></td>
      <td class="mono num">${formatInteger(row.politiciansBuying)}</td>
      <td class="mono num ${amountClass}">${escapeHtml(formatDisclosedUsd(row.netAmountUsd))}</td>
      <td class="mono num ${pctClass}">${row.percentIncrease == null ? "—" : `${row.percentIncrease >= 0 ? "+" : "−"}${Math.abs(row.percentIncrease).toFixed(1)}%`}</td>
      <td class="mono num">${formatInteger(row.totalPoliticiansActive)}</td>
    </tr>`;
    })
    .join("");
}

async function loadPoliticianMostAccumulatedPage() {
  if (politicianMostAccumulatedLoading) {
    renderPoliticianMostAccumulatedTable();
    return;
  }
  politicianMostAccumulatedLoading = true;
  renderPoliticianMostAccumulatedTable();
  try {
    lastPoliticianMostAccumulated = await apiJson("/api/politicians/most-accumulated", {
      period: politicianAccumulatedPeriod,
      chamber: politicianAccumulatedChamber,
    });
  } catch (err) {
    lastPoliticianMostAccumulated = {
      available: false,
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
      stocks: [],
    };
  } finally {
    politicianMostAccumulatedLoading = false;
    renderPoliticianMostAccumulatedTable();
  }
}

function renderPoliticianLargestPortfoliosTable() {
  const body = document.getElementById("politicians-largest-portfolios-body");
  const loading = document.getElementById("politicians-largest-portfolios-loading");
  const subtitle = document.getElementById("politicians-largest-portfolios-subtitle");
  if (!body) return;

  document.querySelectorAll("[data-politician-portfolios-period]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.politicianPortfoliosPeriod === politicianPortfoliosPeriod);
  });
  document.querySelectorAll("[data-politicians-portfolios-chamber]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.politiciansPortfoliosChamber === politicianPortfoliosChamber);
  });
  document.querySelectorAll("[data-politicians-portfolios-sort]").forEach((btn) => {
    const key = btn.dataset.politiciansPortfoliosSort;
    const active = key === politicianPortfoliosSortKey;
    const label = POLITICIAN_PORTFOLIOS_SORT_LABELS[key] || key;
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? `${label} ${politicianPortfoliosSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  if (loading) loading.hidden = !politicianLargestPortfoliosLoading;
  if (politicianLargestPortfoliosLoading) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">Loading portfolio rankings…</td></tr>`;
    return;
  }

  const payload = lastPoliticianLargestPortfolios;
  if (!payload) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">No portfolio data available.</td></tr>`;
    return;
  }
  if (!payload.available) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">${escapeHtml(
      payload.unavailableReason || "Period unavailable."
    )}</td></tr>`;
    if (subtitle) subtitle.textContent = "Politicians ranked by net disclosed portfolio flow.";
    return;
  }

  const rows = sortPoliticianRows(
    payload.politicians || [],
    politicianPortfoliosSortKey,
    politicianPortfoliosSortDir,
    "netPortfolioUsd"
  );
  const chamberLabel =
    politicianPortfoliosChamber === "all"
      ? "All chambers"
      : politicianChamberLabel(politicianPortfoliosChamber);
  if (subtitle) {
    subtitle.textContent = `${politicianAnalyticsPeriodLabel(politicianPortfoliosPeriod)} · ${chamberLabel} · ${rows.length} politicians`;
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">No politicians match the current filters.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((row, index) => {
      const netClass = row.netPortfolioUsd >= 0 ? "change--up" : "change--down";
      return `<tr>
      <td class="mono num">${index + 1}</td>
      <td><a href="${politicianPath(row.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.politicianKey)}">${escapeHtml(row.politicianName)}</a></td>
      <td><span class="politicians-hub__chamber-badge politicians-hub__chamber-badge--inline">${escapeHtml(politicianChamberLabel(row.chamber))}</span></td>
      <td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.totalBuyUsd))}</td>
      <td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.totalSellUsd))}</td>
      <td class="mono num ${netClass}">${escapeHtml(formatDisclosedUsd(row.netPortfolioUsd))}</td>
      <td class="mono num">${formatInteger(row.tradeCount)}</td>
    </tr>`;
    })
    .join("");
}

async function loadPoliticianLargestPortfoliosPage() {
  if (politicianLargestPortfoliosLoading) {
    renderPoliticianLargestPortfoliosTable();
    return;
  }
  politicianLargestPortfoliosLoading = true;
  renderPoliticianLargestPortfoliosTable();
  try {
    lastPoliticianLargestPortfolios = await apiJson("/api/politicians/largest-portfolios", {
      period: politicianPortfoliosPeriod,
      chamber: politicianPortfoliosChamber,
    });
  } catch (err) {
    lastPoliticianLargestPortfolios = {
      available: false,
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
      politicians: [],
    };
  } finally {
    politicianLargestPortfoliosLoading = false;
    renderPoliticianLargestPortfoliosTable();
  }
}

function politicianRepeatBuyerLabelClass(label) {
  if (label === "High Conviction Buyer") return "repeat-buyer-label repeat-buyer-label--serial";
  if (label === "Strong Accumulator") return "repeat-buyer-label repeat-buyer-label--strong";
  if (label === "Repeat Buyer") return "repeat-buyer-label repeat-buyer-label--repeat";
  return "repeat-buyer-label repeat-buyer-label--occasional";
}

function politicianRepeatBuyersQueryParams() {
  return {
    minScore: politicianRepeatBuyersFilters.minScore || undefined,
    minPurchases: politicianRepeatBuyersFilters.minPurchases || undefined,
    minStreak: politicianRepeatBuyersFilters.minStreak || undefined,
    dateFrom: politicianRepeatBuyersFilters.dateFrom || undefined,
    dateTo: politicianRepeatBuyersFilters.dateTo || undefined,
    chamber: politicianRepeatBuyersFilters.chamber || undefined,
    politician: politicianRepeatBuyersFilters.politician || undefined,
    state: politicianRepeatBuyersFilters.state || undefined,
    party: politicianRepeatBuyersFilters.party || undefined,
    sector: politicianRepeatBuyersFilters.sector || undefined,
    marketCap: politicianRepeatBuyersFilters.marketCap || undefined,
    ticker: politicianRepeatBuyersFilters.ticker || undefined,
    search: politicianRepeatBuyersFilters.search || undefined,
    page: politicianRepeatBuyersPage,
    pageSize: POLITICIAN_REPEAT_BUYERS_PAGE_SIZE,
    sort: politicianRepeatBuyersSortKey,
    sortDir: politicianRepeatBuyersSortDir,
  };
}

function syncPoliticianRepeatBuyersFiltersFromDom() {
  politicianRepeatBuyersFilters.minScore =
    Number(document.getElementById("politicians-rb-min-score")?.value || 0) || 0;
  politicianRepeatBuyersFilters.minPurchases =
    Number(document.getElementById("politicians-rb-min-purchases")?.value || 2) || 2;
  politicianRepeatBuyersFilters.minStreak =
    Number(document.getElementById("politicians-rb-min-streak")?.value || 0) || 0;
  politicianRepeatBuyersFilters.dateFrom =
    document.getElementById("politicians-rb-date-from")?.value || "";
  politicianRepeatBuyersFilters.dateTo =
    document.getElementById("politicians-rb-date-to")?.value || "";
  politicianRepeatBuyersFilters.chamber =
    document.getElementById("politicians-rb-chamber")?.value || "";
  politicianRepeatBuyersFilters.politician =
    document.getElementById("politicians-rb-politician")?.value || "";
  politicianRepeatBuyersFilters.state =
    document.getElementById("politicians-rb-state")?.value || "";
  politicianRepeatBuyersFilters.party =
    document.getElementById("politicians-rb-party")?.value || "";
  politicianRepeatBuyersFilters.sector =
    document.getElementById("politicians-rb-sector")?.value || "";
  politicianRepeatBuyersFilters.marketCap =
    document.getElementById("politicians-rb-mcap")?.value || "";
  politicianRepeatBuyersFilters.ticker = String(
    document.getElementById("politicians-rb-ticker")?.value || ""
  )
    .trim()
    .toUpperCase();
  politicianRepeatBuyersFilters.search =
    document.getElementById("politicians-rb-search")?.value || "";
}

function renderPoliticianRepeatBuyersFilterOptions(payload) {
  const setSelect = (id, current, optionsHtml) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = optionsHtml;
    el.value = current;
  };

  setSelect(
    "politicians-rb-politician",
    politicianRepeatBuyersFilters.politician,
    `<option value="">All politicians</option>` +
      (Array.isArray(payload?.politicians) ? payload.politicians : [])
        .map(
          (p) =>
            `<option value="${escapeHtml(p.politicianKey)}">${escapeHtml(p.politicianName)}</option>`
        )
        .join("")
  );
  setSelect(
    "politicians-rb-state",
    politicianRepeatBuyersFilters.state,
    `<option value="">All states</option>` +
      (Array.isArray(payload?.states) ? payload.states : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );
  setSelect(
    "politicians-rb-party",
    politicianRepeatBuyersFilters.party,
    `<option value="">All parties</option>` +
      (Array.isArray(payload?.parties) ? payload.parties : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );
  setSelect(
    "politicians-rb-sector",
    politicianRepeatBuyersFilters.sector,
    `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );

  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setVal("politicians-rb-min-score", String(politicianRepeatBuyersFilters.minScore || 0));
  setVal("politicians-rb-min-purchases", String(politicianRepeatBuyersFilters.minPurchases || 2));
  setVal("politicians-rb-min-streak", String(politicianRepeatBuyersFilters.minStreak || 0));
  setVal("politicians-rb-date-from", politicianRepeatBuyersFilters.dateFrom || "");
  setVal("politicians-rb-date-to", politicianRepeatBuyersFilters.dateTo || "");
  setVal("politicians-rb-chamber", politicianRepeatBuyersFilters.chamber || "");
  setVal("politicians-rb-mcap", politicianRepeatBuyersFilters.marketCap || "");
  const ticker = document.getElementById("politicians-rb-ticker");
  if (ticker && ticker.value !== politicianRepeatBuyersFilters.ticker) {
    ticker.value = politicianRepeatBuyersFilters.ticker || "";
  }
  const search = document.getElementById("politicians-rb-search");
  if (search && search.value !== politicianRepeatBuyersFilters.search) {
    search.value = politicianRepeatBuyersFilters.search || "";
  }
}

function renderPoliticianRepeatBuyersPage() {
  setupPoliticianRepeatBuyersPage();
  const payload = lastPoliticianRepeatBuyers;
  const body = document.getElementById("politicians-repeat-buyers-body");
  const meta = document.getElementById("politicians-repeat-buyers-subtitle");
  const countEl = document.getElementById("politicians-rb-count");
  const pagination = document.getElementById("politicians-rb-pagination");
  const pageInfo = document.getElementById("politicians-rb-page-info");
  const prevBtn = document.getElementById("politicians-rb-prev");
  const nextBtn = document.getElementById("politicians-rb-next");
  const loading = document.getElementById("politicians-repeat-buyers-loading");

  if (loading) loading.hidden = !politicianRepeatBuyersLoading;

  document.querySelectorAll("[data-politicians-rb-sort]").forEach((btn) => {
    const key = btn.dataset.politiciansRbSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === politicianRepeatBuyersSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (politicianRepeatBuyersSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${politicianRepeatBuyersSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderPoliticianRepeatBuyersFilterOptions(payload);

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("politicians-rb-active", formatInteger(summary.activeRepeatBuyers ?? 0));
  setText("politicians-rb-streak", formatInteger(summary.longestPurchaseStreak ?? 0));
  const largest = summary.largestEstimatedInvestment;
  setText(
    "politicians-rb-largest",
    largest
      ? `${largest.ticker} · ${formatDisclosedUsdPlain(largest.value)}`
      : "—"
  );
  setText(
    "politicians-rb-avg-score",
    summary.averageRepeatBuyerScore != null
      ? Number(summary.averageRepeatBuyerScore).toFixed(1)
      : "—"
  );

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || politicianRepeatBuyersPage;
  const pageSize = Number(payload?.pageSize) || POLITICIAN_REPEAT_BUYERS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} pair${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (politicianRepeatBuyersLoading && !payload) {
    body.innerHTML = `<tr><td colspan="12" class="trades-table__empty">Loading repeat buyers…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  if (payload && payload.available === false) {
    body.innerHTML = `<tr><td colspan="12" class="trades-table__empty">${escapeHtml(
      payload.unavailableReason || "No politician data available."
    )}</td></tr>`;
    if (meta) meta.textContent = "Unavailable";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="12" class="trades-table__empty">No repeat buyers match these filters. Run <code class="inline-code">npm run politicians:fetch-recent</code> if disclosures are missing.</td></tr>`;
    if (meta) meta.textContent = total === 0 ? "No results" : "Empty page";
  } else {
    const offset = (page - 1) * pageSize;
    if (meta) {
      meta.textContent = `Page ${page} of ${totalPages} · ≥2 purchases per politician/stock`;
    }
    body.innerHTML = rows
      .map((row, i) => {
        const rank = offset + i + 1;
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        return `<tr>
          <td class="mono num">${rank}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td><a href="${politicianPath(row.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.politicianKey)}">${escapeHtml(row.politicianName)}</a></td>
          <td>${escapeHtml(row.party || "—")}</td>
          <td class="mono">${escapeHtml(row.state || "—")}</td>
          <td class="mono num">${formatInteger(row.purchaseCount ?? 0)}</td>
          <td class="mono num">${formatInteger(row.purchasesLast12Months ?? 0)}</td>
          <td class="mono num">${formatInteger(row.purchaseStreak ?? 0)}</td>
          <td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.estimatedTotalInvested))}</td>
          <td class="mono">${escapeHtml(row.latestPurchase || "—")}</td>
          <td class="mono num">${Number(row.repeatBuyerScore).toFixed(1)}</td>
          <td><span class="${escapeHtml(politicianRepeatBuyerLabelClass(row.classification))}">${escapeHtml(row.classification || "—")}</span></td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadPoliticianRepeatBuyersPage() {
  if (politicianRepeatBuyersLoading) {
    renderPoliticianRepeatBuyersPage();
    return;
  }
  politicianRepeatBuyersLoading = true;
  renderPoliticianRepeatBuyersPage();
  const requestKey = JSON.stringify(politicianRepeatBuyersQueryParams());
  try {
    lastPoliticianRepeatBuyers = await apiJson(
      "/api/politicians/repeat-buyers",
      politicianRepeatBuyersQueryParams()
    );
  } catch (err) {
    lastPoliticianRepeatBuyers = {
      available: false,
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
      summary: {},
      rows: [],
      total: 0,
    };
  } finally {
    politicianRepeatBuyersLoading = false;
    if (JSON.stringify(politicianRepeatBuyersQueryParams()) !== requestKey) {
      void loadPoliticianRepeatBuyersPage();
      return;
    }
    renderPoliticianRepeatBuyersPage();
  }
}

function setupPoliticianRepeatBuyersPage() {
  if (politicianRepeatBuyersBound) return;
  politicianRepeatBuyersBound = true;

  document.getElementById("politicians-repeat-buyers-back")?.addEventListener("click", () => {
    navigateToPoliticianTrades();
  });
  document.getElementById("politicians-rb-prev")?.addEventListener("click", () => {
    if (politicianRepeatBuyersPage <= 1) return;
    politicianRepeatBuyersPage -= 1;
    void loadPoliticianRepeatBuyersPage();
  });
  document.getElementById("politicians-rb-next")?.addEventListener("click", () => {
    politicianRepeatBuyersPage += 1;
    void loadPoliticianRepeatBuyersPage();
  });

  const panel = document.getElementById("politicians-repeat-buyers");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-politicians-rb-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-politicians-rb-sort");
      if (!key) return;
      if (politicianRepeatBuyersSortKey === key) {
        politicianRepeatBuyersSortDir =
          politicianRepeatBuyersSortDir === "desc" ? "asc" : "desc";
      } else {
        politicianRepeatBuyersSortKey = key;
        politicianRepeatBuyersSortDir =
          key === "ticker" ||
          key === "politicianName" ||
          key === "party" ||
          key === "state" ||
          key === "classification"
            ? "asc"
            : "desc";
      }
      politicianRepeatBuyersPage = 1;
      void loadPoliticianRepeatBuyersPage();
    }
  });

  [
    "politicians-rb-min-score",
    "politicians-rb-min-purchases",
    "politicians-rb-min-streak",
    "politicians-rb-date-from",
    "politicians-rb-date-to",
    "politicians-rb-chamber",
    "politicians-rb-politician",
    "politicians-rb-state",
    "politicians-rb-party",
    "politicians-rb-sector",
    "politicians-rb-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncPoliticianRepeatBuyersFiltersFromDom();
      politicianRepeatBuyersPage = 1;
      void loadPoliticianRepeatBuyersPage();
    });
  });

  let searchTimer = null;
  const debounceReload = () => {
    syncPoliticianRepeatBuyersFiltersFromDom();
    politicianRepeatBuyersPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadPoliticianRepeatBuyersPage(), 250);
  };
  document.getElementById("politicians-rb-ticker")?.addEventListener("input", debounceReload);
  document.getElementById("politicians-rb-search")?.addEventListener("input", debounceReload);
}

function politicianFirstTimeBuyersQueryParams() {
  return {
    minYears: politicianFirstTimeBuyersFilters.minYears || undefined,
    firstRecordedOnly: politicianFirstTimeBuyersFilters.firstRecordedOnly ? "1" : undefined,
    dateFrom: politicianFirstTimeBuyersFilters.dateFrom || undefined,
    dateTo: politicianFirstTimeBuyersFilters.dateTo || undefined,
    chamber: politicianFirstTimeBuyersFilters.chamber || undefined,
    politician: politicianFirstTimeBuyersFilters.politician || undefined,
    state: politicianFirstTimeBuyersFilters.state || undefined,
    party: politicianFirstTimeBuyersFilters.party || undefined,
    sector: politicianFirstTimeBuyersFilters.sector || undefined,
    marketCap: politicianFirstTimeBuyersFilters.marketCap || undefined,
    ticker: politicianFirstTimeBuyersFilters.ticker || undefined,
    search: politicianFirstTimeBuyersFilters.search || undefined,
    page: politicianFirstTimeBuyersPage,
    pageSize: POLITICIAN_FIRST_TIME_BUYERS_PAGE_SIZE,
    sort: politicianFirstTimeBuyersSortKey,
    sortDir: politicianFirstTimeBuyersSortDir,
  };
}

function syncPoliticianFirstTimeBuyersFiltersFromDom() {
  politicianFirstTimeBuyersFilters.minYears =
    Number(document.getElementById("politicians-ftb-min-years")?.value || 3) || 3;
  politicianFirstTimeBuyersFilters.firstRecordedOnly = !!document.getElementById(
    "politicians-ftb-first-only"
  )?.checked;
  politicianFirstTimeBuyersFilters.dateFrom =
    document.getElementById("politicians-ftb-date-from")?.value || "";
  politicianFirstTimeBuyersFilters.dateTo =
    document.getElementById("politicians-ftb-date-to")?.value || "";
  politicianFirstTimeBuyersFilters.chamber =
    document.getElementById("politicians-ftb-chamber")?.value || "";
  politicianFirstTimeBuyersFilters.politician =
    document.getElementById("politicians-ftb-politician")?.value || "";
  politicianFirstTimeBuyersFilters.state =
    document.getElementById("politicians-ftb-state")?.value || "";
  politicianFirstTimeBuyersFilters.party =
    document.getElementById("politicians-ftb-party")?.value || "";
  politicianFirstTimeBuyersFilters.sector =
    document.getElementById("politicians-ftb-sector")?.value || "";
  politicianFirstTimeBuyersFilters.marketCap =
    document.getElementById("politicians-ftb-mcap")?.value || "";
  politicianFirstTimeBuyersFilters.ticker = String(
    document.getElementById("politicians-ftb-ticker")?.value || ""
  )
    .trim()
    .toUpperCase();
  politicianFirstTimeBuyersFilters.search =
    document.getElementById("politicians-ftb-search")?.value || "";
}

function renderPoliticianFirstTimeBuyersFilterOptions(payload) {
  const setSelect = (id, current, optionsHtml) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = optionsHtml;
    el.value = current;
  };

  setSelect(
    "politicians-ftb-politician",
    politicianFirstTimeBuyersFilters.politician,
    `<option value="">All politicians</option>` +
      (Array.isArray(payload?.politicians) ? payload.politicians : [])
        .map(
          (p) =>
            `<option value="${escapeHtml(p.politicianKey)}">${escapeHtml(p.politicianName)}</option>`
        )
        .join("")
  );
  setSelect(
    "politicians-ftb-state",
    politicianFirstTimeBuyersFilters.state,
    `<option value="">All states</option>` +
      (Array.isArray(payload?.states) ? payload.states : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );
  setSelect(
    "politicians-ftb-party",
    politicianFirstTimeBuyersFilters.party,
    `<option value="">All parties</option>` +
      (Array.isArray(payload?.parties) ? payload.parties : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );
  setSelect(
    "politicians-ftb-sector",
    politicianFirstTimeBuyersFilters.sector,
    `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );

  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setVal("politicians-ftb-min-years", String(politicianFirstTimeBuyersFilters.minYears || 3));
  setVal("politicians-ftb-date-from", politicianFirstTimeBuyersFilters.dateFrom || "");
  setVal("politicians-ftb-date-to", politicianFirstTimeBuyersFilters.dateTo || "");
  setVal("politicians-ftb-chamber", politicianFirstTimeBuyersFilters.chamber || "");
  setVal("politicians-ftb-mcap", politicianFirstTimeBuyersFilters.marketCap || "");
  const firstOnly = document.getElementById("politicians-ftb-first-only");
  if (firstOnly) firstOnly.checked = !!politicianFirstTimeBuyersFilters.firstRecordedOnly;
  const ticker = document.getElementById("politicians-ftb-ticker");
  if (ticker && ticker.value !== politicianFirstTimeBuyersFilters.ticker) {
    ticker.value = politicianFirstTimeBuyersFilters.ticker || "";
  }
  const search = document.getElementById("politicians-ftb-search");
  if (search && search.value !== politicianFirstTimeBuyersFilters.search) {
    search.value = politicianFirstTimeBuyersFilters.search || "";
  }
}

function formatPoliticianYearsSinceLastBuy(row) {
  if (row.firstRecordedPurchase) return "First recorded";
  if (row.yearsSinceLastBuy == null || !Number.isFinite(Number(row.yearsSinceLastBuy))) {
    return "—";
  }
  return `${Number(row.yearsSinceLastBuy).toFixed(1)}y`;
}

function renderPoliticianFirstTimeBuyersPage() {
  setupPoliticianFirstTimeBuyersPage();
  const payload = lastPoliticianFirstTimeBuyers;
  const body = document.getElementById("politicians-first-time-buyers-body");
  const meta = document.getElementById("politicians-first-time-buyers-subtitle");
  const countEl = document.getElementById("politicians-ftb-count");
  const pagination = document.getElementById("politicians-ftb-pagination");
  const pageInfo = document.getElementById("politicians-ftb-page-info");
  const prevBtn = document.getElementById("politicians-ftb-prev");
  const nextBtn = document.getElementById("politicians-ftb-next");
  const loading = document.getElementById("politicians-first-time-buyers-loading");

  if (loading) loading.hidden = !politicianFirstTimeBuyersLoading;

  document.querySelectorAll("[data-politicians-ftb-sort]").forEach((btn) => {
    const key = btn.dataset.politiciansFtbSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === politicianFirstTimeBuyersSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (politicianFirstTimeBuyersSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${politicianFirstTimeBuyersSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderPoliticianFirstTimeBuyersFilterOptions(payload);

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("politicians-ftb-first-recorded", formatInteger(summary.firstRecordedBuyers ?? 0));
  setText("politicians-ftb-returning", formatInteger(summary.returningBuyers ?? 0));
  setText(
    "politicians-ftb-avg-years",
    summary.averageYearsSincePreviousPurchase != null
      ? Number(summary.averageYearsSincePreviousPurchase).toFixed(1)
      : "—"
  );
  setText(
    "politicians-ftb-total",
    summary.totalEstimatedPurchases != null
      ? formatDisclosedUsdPlain(summary.totalEstimatedPurchases)
      : "—"
  );

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || politicianFirstTimeBuyersPage;
  const pageSize = Number(payload?.pageSize) || POLITICIAN_FIRST_TIME_BUYERS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} purchase${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (politicianFirstTimeBuyersLoading && !payload) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">Loading first-time buyers…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  if (payload && payload.available === false) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">${escapeHtml(
      payload.unavailableReason || "No politician data available."
    )}</td></tr>`;
    if (meta) meta.textContent = "Unavailable";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">No first-time or returning buys match these filters. Run <code class="inline-code">npm run politicians:fetch-recent</code> if disclosures are missing.</td></tr>`;
    if (meta) {
      meta.textContent =
        total === 0
          ? `No results · gap ≥${payload?.minYearsThreshold ?? 3}y`
          : "Empty page";
    }
  } else {
    if (meta) {
      meta.textContent = `Page ${page} of ${totalPages} · gap ≥${payload?.minYearsThreshold ?? 3}y`;
    }
    body.innerHTML = rows
      .map((row) => {
        const yearsLabel = formatPoliticianYearsSinceLastBuy(row);
        const yearsCell =
          yearsLabel === "—"
            ? ""
            : `<span class="repeat-buyer-label">${escapeHtml(yearsLabel)}</span>`;
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        return `<tr>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td><a href="${politicianPath(row.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.politicianKey)}">${escapeHtml(row.politicianName)}</a></td>
          <td>${escapeHtml(row.party || "—")}</td>
          <td class="mono">${escapeHtml(row.state || "—")}</td>
          <td class="mono">${escapeHtml(row.transactionDate || "—")}</td>
          <td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.estimatedPurchaseValue))}</td>
          <td class="mono">${escapeHtml(row.previousBuyDate || "—")}</td>
          <td class="num">${yearsCell}</td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadPoliticianFirstTimeBuyersPage() {
  if (politicianFirstTimeBuyersLoading) {
    renderPoliticianFirstTimeBuyersPage();
    return;
  }
  politicianFirstTimeBuyersLoading = true;
  renderPoliticianFirstTimeBuyersPage();
  const requestKey = JSON.stringify(politicianFirstTimeBuyersQueryParams());
  try {
    lastPoliticianFirstTimeBuyers = await apiJson(
      "/api/politicians/first-time-buyers",
      politicianFirstTimeBuyersQueryParams()
    );
  } catch (err) {
    lastPoliticianFirstTimeBuyers = {
      available: false,
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
      summary: {},
      rows: [],
      total: 0,
    };
  } finally {
    politicianFirstTimeBuyersLoading = false;
    if (JSON.stringify(politicianFirstTimeBuyersQueryParams()) !== requestKey) {
      void loadPoliticianFirstTimeBuyersPage();
      return;
    }
    renderPoliticianFirstTimeBuyersPage();
  }
}

function setupPoliticianFirstTimeBuyersPage() {
  if (politicianFirstTimeBuyersBound) return;
  politicianFirstTimeBuyersBound = true;

  document.getElementById("politicians-first-time-buyers-back")?.addEventListener("click", () => {
    navigateToPoliticianTrades();
  });
  document.getElementById("politicians-ftb-prev")?.addEventListener("click", () => {
    if (politicianFirstTimeBuyersPage <= 1) return;
    politicianFirstTimeBuyersPage -= 1;
    void loadPoliticianFirstTimeBuyersPage();
  });
  document.getElementById("politicians-ftb-next")?.addEventListener("click", () => {
    politicianFirstTimeBuyersPage += 1;
    void loadPoliticianFirstTimeBuyersPage();
  });

  const panel = document.getElementById("politicians-first-time-buyers");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-politicians-ftb-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-politicians-ftb-sort");
      if (!key) return;
      if (politicianFirstTimeBuyersSortKey === key) {
        politicianFirstTimeBuyersSortDir =
          politicianFirstTimeBuyersSortDir === "desc" ? "asc" : "desc";
      } else {
        politicianFirstTimeBuyersSortKey = key;
        politicianFirstTimeBuyersSortDir =
          key === "ticker" ||
          key === "politicianName" ||
          key === "party" ||
          key === "state"
            ? "asc"
            : "desc";
      }
      politicianFirstTimeBuyersPage = 1;
      void loadPoliticianFirstTimeBuyersPage();
    }
  });

  [
    "politicians-ftb-min-years",
    "politicians-ftb-first-only",
    "politicians-ftb-date-from",
    "politicians-ftb-date-to",
    "politicians-ftb-chamber",
    "politicians-ftb-politician",
    "politicians-ftb-state",
    "politicians-ftb-party",
    "politicians-ftb-sector",
    "politicians-ftb-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncPoliticianFirstTimeBuyersFiltersFromDom();
      politicianFirstTimeBuyersPage = 1;
      void loadPoliticianFirstTimeBuyersPage();
    });
  });

  let searchTimer = null;
  const debounceReload = () => {
    syncPoliticianFirstTimeBuyersFiltersFromDom();
    politicianFirstTimeBuyersPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadPoliticianFirstTimeBuyersPage(), 250);
  };
  document.getElementById("politicians-ftb-ticker")?.addEventListener("input", debounceReload);
  document.getElementById("politicians-ftb-search")?.addEventListener("input", debounceReload);
}

function politicianHeavySellingQueryParams() {
  const minSaleRaw = String(politicianHeavySellingFilters.minEstimatedSale || "").trim();
  return {
    multipleSellersOnly: politicianHeavySellingFilters.multipleSellersOnly ? "1" : undefined,
    consecutiveOnly: politicianHeavySellingFilters.consecutiveOnly ? "1" : undefined,
    minUniqueSellers: politicianHeavySellingFilters.minUniqueSellers || undefined,
    minEstimatedSale: minSaleRaw ? Number(minSaleRaw) || undefined : undefined,
    windowDays: politicianHeavySellingFilters.windowDays || undefined,
    dateFrom: politicianHeavySellingFilters.dateFrom || undefined,
    dateTo: politicianHeavySellingFilters.dateTo || undefined,
    chamber: politicianHeavySellingFilters.chamber || undefined,
    politician: politicianHeavySellingFilters.politician || undefined,
    state: politicianHeavySellingFilters.state || undefined,
    party: politicianHeavySellingFilters.party || undefined,
    sector: politicianHeavySellingFilters.sector || undefined,
    marketCap: politicianHeavySellingFilters.marketCap || undefined,
    ticker: politicianHeavySellingFilters.ticker || undefined,
    search: politicianHeavySellingFilters.search || undefined,
    page: politicianHeavySellingPage,
    pageSize: POLITICIAN_HEAVY_SELLING_PAGE_SIZE,
    sort: politicianHeavySellingSortKey,
    sortDir: politicianHeavySellingSortDir,
  };
}

function syncPoliticianHeavySellingFiltersFromDom() {
  politicianHeavySellingFilters.multipleSellersOnly = !!document.getElementById(
    "politicians-hs-multi-only"
  )?.checked;
  politicianHeavySellingFilters.consecutiveOnly = !!document.getElementById(
    "politicians-hs-consec-only"
  )?.checked;
  politicianHeavySellingFilters.minUniqueSellers =
    Number(document.getElementById("politicians-hs-min-sellers")?.value || 0) || 0;
  politicianHeavySellingFilters.minEstimatedSale =
    document.getElementById("politicians-hs-min-sale")?.value || "";
  politicianHeavySellingFilters.windowDays =
    Number(document.getElementById("politicians-hs-window")?.value || 30) || 30;
  politicianHeavySellingFilters.dateFrom =
    document.getElementById("politicians-hs-date-from")?.value || "";
  politicianHeavySellingFilters.dateTo =
    document.getElementById("politicians-hs-date-to")?.value || "";
  politicianHeavySellingFilters.chamber =
    document.getElementById("politicians-hs-chamber")?.value || "";
  politicianHeavySellingFilters.politician =
    document.getElementById("politicians-hs-politician")?.value || "";
  politicianHeavySellingFilters.state =
    document.getElementById("politicians-hs-state")?.value || "";
  politicianHeavySellingFilters.party =
    document.getElementById("politicians-hs-party")?.value || "";
  politicianHeavySellingFilters.sector =
    document.getElementById("politicians-hs-sector")?.value || "";
  politicianHeavySellingFilters.marketCap =
    document.getElementById("politicians-hs-mcap")?.value || "";
  politicianHeavySellingFilters.ticker = String(
    document.getElementById("politicians-hs-ticker")?.value || ""
  )
    .trim()
    .toUpperCase();
  politicianHeavySellingFilters.search =
    document.getElementById("politicians-hs-search")?.value || "";
}

function renderPoliticianHeavySellingFilterOptions(payload) {
  const setSelect = (id, current, optionsHtml) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = optionsHtml;
    el.value = current;
  };

  setSelect(
    "politicians-hs-politician",
    politicianHeavySellingFilters.politician,
    `<option value="">All politicians</option>` +
      (Array.isArray(payload?.politicians) ? payload.politicians : [])
        .map(
          (p) =>
            `<option value="${escapeHtml(p.politicianKey)}">${escapeHtml(p.politicianName)}</option>`
        )
        .join("")
  );
  setSelect(
    "politicians-hs-party",
    politicianHeavySellingFilters.party,
    `<option value="">All parties</option>` +
      (Array.isArray(payload?.parties) ? payload.parties : [])
        .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
        .join("")
  );
  setSelect(
    "politicians-hs-state",
    politicianHeavySellingFilters.state,
    `<option value="">All states</option>` +
      (Array.isArray(payload?.states) ? payload.states : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );
  setSelect(
    "politicians-hs-sector",
    politicianHeavySellingFilters.sector,
    `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("")
  );

  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el && el.value !== value) el.value = value;
  };
  setVal("politicians-hs-chamber", politicianHeavySellingFilters.chamber || "");
  setVal("politicians-hs-mcap", politicianHeavySellingFilters.marketCap || "");
  setVal("politicians-hs-min-sellers", String(politicianHeavySellingFilters.minUniqueSellers || 0));
  setVal("politicians-hs-min-sale", politicianHeavySellingFilters.minEstimatedSale || "");
  setVal("politicians-hs-window", String(politicianHeavySellingFilters.windowDays || 30));
  setVal("politicians-hs-date-from", politicianHeavySellingFilters.dateFrom || "");
  setVal("politicians-hs-date-to", politicianHeavySellingFilters.dateTo || "");
  const multi = document.getElementById("politicians-hs-multi-only");
  if (multi) multi.checked = !!politicianHeavySellingFilters.multipleSellersOnly;
  const consec = document.getElementById("politicians-hs-consec-only");
  if (consec) consec.checked = !!politicianHeavySellingFilters.consecutiveOnly;
  const ticker = document.getElementById("politicians-hs-ticker");
  if (ticker && ticker.value !== politicianHeavySellingFilters.ticker) {
    ticker.value = politicianHeavySellingFilters.ticker || "";
  }
  const search = document.getElementById("politicians-hs-search");
  if (search && search.value !== politicianHeavySellingFilters.search) {
    search.value = politicianHeavySellingFilters.search || "";
  }
}

function renderPoliticianHeavySellingPage() {
  setupPoliticianHeavySellingPage();
  const payload = lastPoliticianHeavySelling;
  const body = document.getElementById("politicians-heavy-selling-body");
  const meta = document.getElementById("politicians-heavy-selling-subtitle");
  const countEl = document.getElementById("politicians-hs-count");
  const pagination = document.getElementById("politicians-hs-pagination");
  const pageInfo = document.getElementById("politicians-hs-page-info");
  const prevBtn = document.getElementById("politicians-hs-prev");
  const nextBtn = document.getElementById("politicians-hs-next");
  const loading = document.getElementById("politicians-heavy-selling-loading");

  if (loading) loading.hidden = !politicianHeavySellingLoading;

  document.querySelectorAll("[data-politicians-hs-sort]").forEach((btn) => {
    const key = btn.dataset.politiciansHsSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === politicianHeavySellingSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (politicianHeavySellingSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${politicianHeavySellingSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderPoliticianHeavySellingFilterOptions(payload);

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  const largest = summary.largestEstimatedSale;
  setText(
    "politicians-hs-largest",
    largest
      ? `${largest.ticker} · ${formatDisclosedUsdPlain(largest.value)}`
      : "—"
  );
  setText("politicians-hs-multi", formatInteger(summary.stocksWithMultipleSellers ?? 0));
  setText("politicians-hs-sellers", formatInteger(summary.activePoliticianSellers ?? 0));
  setText(
    "politicians-hs-total",
    formatDisclosedUsdPlain(summary.totalEstimatedValueSold ?? 0)
  );

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || politicianHeavySellingPage;
  const pageSize = Number(payload?.pageSize) || POLITICIAN_HEAVY_SELLING_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} stock${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (politicianHeavySellingLoading && !payload) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">Loading heavy selling…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  if (payload && payload.available === false) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">${escapeHtml(
      payload.unavailableReason || "No politician data available."
    )}</td></tr>`;
    if (meta) meta.textContent = "Unavailable";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">No sell disclosures match these filters. Run <code class="inline-code">npm run politicians:fetch-recent</code> if disclosures are missing.</td></tr>`;
    if (meta) meta.textContent = total === 0 ? "No results" : "Empty page";
  } else {
    if (meta) {
      const windowDays = payload?.multipleSellersWindowDays ?? 30;
      meta.textContent = `Page ${page} of ${totalPages} · sell disclosures only · multi-seller window ${windowDays}d`;
    }
    body.innerHTML = rows
      .map((row) => {
        const multiLabel = row.multipleSellers
          ? `Yes (${formatInteger(row.multipleSellerCount ?? row.uniqueSellers)})`
          : "No";
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        return `<tr>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td class="mono num">${formatInteger(row.sellTransactions ?? 0)}</td>
          <td class="mono num">${formatInteger(row.uniqueSellers ?? 0)}</td>
          <td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.estimatedTotalSold))}</td>
          <td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.largestSale))}</td>
          <td class="mono num">${formatInteger(row.currentConsecutiveSales ?? 0)}</td>
          <td>${escapeHtml(multiLabel)}</td>
          <td class="mono">${escapeHtml(row.latestSale || "—")}</td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadPoliticianHeavySellingPage() {
  if (politicianHeavySellingLoading) {
    renderPoliticianHeavySellingPage();
    return;
  }
  politicianHeavySellingLoading = true;
  renderPoliticianHeavySellingPage();
  const requestKey = JSON.stringify(politicianHeavySellingQueryParams());
  try {
    lastPoliticianHeavySelling = await apiJson(
      "/api/politicians/heavy-selling",
      politicianHeavySellingQueryParams()
    );
  } catch (err) {
    lastPoliticianHeavySelling = {
      available: false,
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
      summary: {},
      rows: [],
      total: 0,
    };
  } finally {
    politicianHeavySellingLoading = false;
    if (JSON.stringify(politicianHeavySellingQueryParams()) !== requestKey) {
      void loadPoliticianHeavySellingPage();
      return;
    }
    renderPoliticianHeavySellingPage();
  }
}

function setupPoliticianHeavySellingPage() {
  if (politicianHeavySellingBound) return;
  politicianHeavySellingBound = true;

  document.getElementById("politicians-heavy-selling-back")?.addEventListener("click", () => {
    navigateToPoliticianTrades();
  });
  document.getElementById("politicians-hs-prev")?.addEventListener("click", () => {
    if (politicianHeavySellingPage <= 1) return;
    politicianHeavySellingPage -= 1;
    void loadPoliticianHeavySellingPage();
  });
  document.getElementById("politicians-hs-next")?.addEventListener("click", () => {
    politicianHeavySellingPage += 1;
    void loadPoliticianHeavySellingPage();
  });

  const panel = document.getElementById("politicians-heavy-selling");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-politicians-hs-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-politicians-hs-sort");
      if (!key) return;
      if (politicianHeavySellingSortKey === key) {
        politicianHeavySellingSortDir =
          politicianHeavySellingSortDir === "desc" ? "asc" : "desc";
      } else {
        politicianHeavySellingSortKey = key;
        politicianHeavySellingSortDir =
          key === "ticker" || key === "multipleSellers" ? "asc" : "desc";
      }
      politicianHeavySellingPage = 1;
      void loadPoliticianHeavySellingPage();
    }
  });

  [
    "politicians-hs-multi-only",
    "politicians-hs-consec-only",
    "politicians-hs-min-sellers",
    "politicians-hs-min-sale",
    "politicians-hs-window",
    "politicians-hs-date-from",
    "politicians-hs-date-to",
    "politicians-hs-chamber",
    "politicians-hs-politician",
    "politicians-hs-state",
    "politicians-hs-party",
    "politicians-hs-sector",
    "politicians-hs-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncPoliticianHeavySellingFiltersFromDom();
      politicianHeavySellingPage = 1;
      void loadPoliticianHeavySellingPage();
    });
  });

  let searchTimer = null;
  const debounceReload = () => {
    syncPoliticianHeavySellingFiltersFromDom();
    politicianHeavySellingPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadPoliticianHeavySellingPage(), 250);
  };
  document.getElementById("politicians-hs-ticker")?.addEventListener("input", debounceReload);
  document.getElementById("politicians-hs-search")?.addEventListener("input", debounceReload);
}

function setupPoliticianAnalyticsPages() {
  if (!politicianMostAccumulatedBound) {
    politicianMostAccumulatedBound = true;
    document.getElementById("politicians-most-accumulated-back")?.addEventListener("click", () => {
      navigateToPoliticianTrades();
    });
    document.getElementById("politicians-most-accumulated")?.addEventListener("click", (e) => {
      const periodBtn = e.target.closest?.("[data-politician-accumulation-period]");
      if (periodBtn) {
        const period = periodBtn.getAttribute("data-politician-accumulation-period");
        if (!period || period === politicianAccumulatedPeriod) return;
        politicianAccumulatedPeriod = period;
        void loadPoliticianMostAccumulatedPage();
        return;
      }
      const chamberBtn = e.target.closest?.("[data-politicians-page-chamber]");
      if (chamberBtn) {
        const chamber = chamberBtn.getAttribute("data-politicians-page-chamber");
        if (!chamber || chamber === politicianAccumulatedChamber) return;
        politicianAccumulatedChamber = chamber;
        void loadPoliticianMostAccumulatedPage();
        return;
      }
      const sortBtn = e.target.closest?.("[data-politicians-accumulated-sort]");
      if (sortBtn) {
        const key = sortBtn.getAttribute("data-politicians-accumulated-sort");
        if (!key) return;
        if (politicianAccumulatedSortKey === key) {
          politicianAccumulatedSortDir = politicianAccumulatedSortDir === "desc" ? "asc" : "desc";
        } else {
          politicianAccumulatedSortKey = key;
          politicianAccumulatedSortDir = key === "ticker" ? "asc" : "desc";
        }
        renderPoliticianMostAccumulatedTable();
      }
    });
    document.getElementById("politicians-accumulated-search")?.addEventListener("input", (e) => {
      politicianAccumulatedFilters.search = e.target.value || "";
      renderPoliticianMostAccumulatedTable();
    });
    document.getElementById("politicians-accumulated-positive-only")?.addEventListener("change", (e) => {
      politicianAccumulatedFilters.positiveOnly = Boolean(e.target.checked);
      renderPoliticianMostAccumulatedTable();
    });
  }

  if (!politicianLargestPortfoliosBound) {
    politicianLargestPortfoliosBound = true;
    document.getElementById("politicians-largest-portfolios-back")?.addEventListener("click", () => {
      navigateToPoliticianTrades();
    });
    document.getElementById("politicians-largest-portfolios")?.addEventListener("click", (e) => {
      const periodBtn = e.target.closest?.("[data-politician-portfolios-period]");
      if (periodBtn) {
        const period = periodBtn.getAttribute("data-politician-portfolios-period");
        if (!period || period === politicianPortfoliosPeriod) return;
        politicianPortfoliosPeriod = period;
        void loadPoliticianLargestPortfoliosPage();
        return;
      }
      const chamberBtn = e.target.closest?.("[data-politicians-portfolios-chamber]");
      if (chamberBtn) {
        const chamber = chamberBtn.getAttribute("data-politicians-portfolios-chamber");
        if (!chamber || chamber === politicianPortfoliosChamber) return;
        politicianPortfoliosChamber = chamber;
        void loadPoliticianLargestPortfoliosPage();
        return;
      }
      const sortBtn = e.target.closest?.("[data-politicians-portfolios-sort]");
      if (sortBtn) {
        const key = sortBtn.getAttribute("data-politicians-portfolios-sort");
        if (!key) return;
        if (politicianPortfoliosSortKey === key) {
          politicianPortfoliosSortDir = politicianPortfoliosSortDir === "desc" ? "asc" : "desc";
        } else {
          politicianPortfoliosSortKey = key;
          politicianPortfoliosSortDir =
            key === "politicianName" || key === "chamber" ? "asc" : "desc";
        }
        renderPoliticianLargestPortfoliosTable();
      }
    });
  }
}

const POLITICIAN_SECTOR_SORT_LABELS = {
  sector: "Sector",
  tradeCount: "Trades",
  politicianCount: "Politicians",
  totalEstimatedValueUsd: "Est. value",
  buyCount: "Buys",
  sellCount: "Sells",
  netBuyCount: "Net buys",
  mostTradedStock: "Most traded stock",
  largestBuyer: "Largest buyer",
};

function buildPoliticianSectorQueryString() {
  const params = new URLSearchParams();
  params.set("period", politicianSectorPeriod);
  params.set("chamber", politicianSectorChamber);
  if (politicianSectorFilters.dateFrom) params.set("dateFrom", politicianSectorFilters.dateFrom);
  if (politicianSectorFilters.dateTo) params.set("dateTo", politicianSectorFilters.dateTo);
  if (politicianSectorFilters.politician) params.set("politician", politicianSectorFilters.politician);
  if (politicianSectorFilters.state) params.set("state", politicianSectorFilters.state);
  if (politicianSectorFilters.transactionType) {
    params.set("transactionType", politicianSectorFilters.transactionType);
  }
  if (politicianSectorFilters.sector) params.set("sector", politicianSectorFilters.sector);
  if (politicianSectorFilters.search.trim()) params.set("search", politicianSectorFilters.search.trim());
  return params.toString();
}

function readPoliticianSectorFiltersFromDom() {
  politicianSectorFilters.dateFrom = document.getElementById("politicians-sector-date-from")?.value || "";
  politicianSectorFilters.dateTo = document.getElementById("politicians-sector-date-to")?.value || "";
  politicianSectorFilters.politician =
    document.getElementById("politicians-sector-politician")?.value || "";
  politicianSectorFilters.state = document.getElementById("politicians-sector-state")?.value || "";
  politicianSectorFilters.transactionType =
    document.getElementById("politicians-sector-transaction")?.value || "";
  politicianSectorFilters.sector = document.getElementById("politicians-sector-sector")?.value || "";
  politicianSectorFilters.search = document.getElementById("politicians-sector-search")?.value || "";
}

function renderPoliticianSectorFilterOptions(payload) {
  const politicianSelect = document.getElementById("politicians-sector-politician");
  const stateSelect = document.getElementById("politicians-sector-state");
  const sectorSelect = document.getElementById("politicians-sector-sector");
  if (politicianSelect) {
    const current = politicianSectorFilters.politician;
    politicianSelect.innerHTML =
      `<option value="">All politicians</option>` +
      (Array.isArray(payload?.politicians) ? payload.politicians : [])
        .map(
          (p) =>
            `<option value="${escapeHtml(p.politicianKey)}">${escapeHtml(p.politicianName)}</option>`
        )
        .join("");
    politicianSelect.value = current;
  }
  if (stateSelect) {
    const current = politicianSectorFilters.state;
    stateSelect.innerHTML =
      `<option value="">All states</option>` +
      (Array.isArray(payload?.states) ? payload.states : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("");
    stateSelect.value = current;
  }
  if (sectorSelect) {
    const current = politicianSectorFilters.sector;
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("");
    sectorSelect.value = current;
  }
}

function renderPoliticianSectorBarChart(container, rows, { mode = "single", maxRows = 10 } = {}) {
  if (!container) return;
  const slice = (rows || []).slice(0, maxRows);
  if (!slice.length) {
    container.innerHTML = `<p class="muted small">No chart data for the current filters.</p>`;
    return;
  }
  if (mode === "buySell") {
    const max = Math.max(...slice.flatMap((r) => [r.buyCount || 0, r.sellCount || 0]), 1);
    container.innerHTML = slice
      .map((row) => {
        const buyPct = ((row.buyCount || 0) / max) * 100;
        const sellPct = ((row.sellCount || 0) / max) * 100;
        return `<div class="politician-sector-chart__row">
          <span class="politician-sector-chart__label">${escapeHtml(row.sector)}</span>
          <div class="politician-sector-chart__bar-wrap">
            <div class="politician-sector-chart__bar" style="width:${buyPct.toFixed(1)}%"></div>
            <div class="politician-sector-chart__bar politician-sector-chart__bar--sell" style="width:${sellPct.toFixed(1)}%"></div>
          </div>
          <span class="politician-sector-chart__value">${row.buyCount || 0} / ${row.sellCount || 0}</span>
        </div>`;
      })
      .join("");
    return;
  }
  const max = Math.max(...slice.map((r) => r.tradeCount || 0), 1);
  container.innerHTML = slice
    .map((row) => {
      const pct = ((row.tradeCount || 0) / max) * 100;
      return `<div class="politician-sector-chart__row">
        <span class="politician-sector-chart__label">${escapeHtml(row.sector)}</span>
        <div class="politician-sector-chart__bar-wrap">
          <div class="politician-sector-chart__bar" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="politician-sector-chart__value">${formatInteger(row.tradeCount || 0)}</span>
      </div>`;
    })
    .join("");
}

function renderPoliticianSectorMonthlyChart(container, rows) {
  if (!container) return;
  const slice = (rows || []).slice(-12);
  if (!slice.length) {
    container.innerHTML = `<p class="muted small">No monthly activity for the current filters.</p>`;
    return;
  }
  const max = Math.max(...slice.map((r) => r.tradeCount || 0), 1);
  container.innerHTML = slice
    .map((row) => {
      const pct = ((row.tradeCount || 0) / max) * 100;
      const topSector = row.sectors?.[0]?.sector;
      const suffix = topSector ? ` · ${topSector}` : "";
      return `<div class="politician-sector-chart__month-row">
        <span class="politician-sector-chart__label mono">${escapeHtml(row.month)}</span>
        <div class="politician-sector-chart__bar-wrap">
          <div class="politician-sector-chart__bar" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="politician-sector-chart__value">${formatInteger(row.tradeCount || 0)}${escapeHtml(suffix)}</span>
      </div>`;
    })
    .join("");
}

function sortPoliticianSectorRows(rows) {
  const key = politicianSectorSortKey;
  const dir = politicianSectorSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "sector") return String(a.sector).localeCompare(String(b.sector)) * dir;
    if (key === "mostTradedStock") {
      const av = String(a.mostTradedStock?.ticker || a.mostTradedStock?.companyName || "");
      const bv = String(b.mostTradedStock?.ticker || b.mostTradedStock?.companyName || "");
      return av.localeCompare(bv) * dir;
    }
    if (key === "largestBuyer") {
      return String(a.largestBuyer?.politicianName || "").localeCompare(String(b.largestBuyer?.politicianName || "")) * dir;
    }
    return (Number(a[key]) - Number(b[key])) * dir;
  });
}

function renderPoliticianSectorExposureTable() {
  const body = document.getElementById("politicians-sector-exposure-body");
  const loading = document.getElementById("politicians-sector-exposure-loading");
  const subtitle = document.getElementById("politicians-sector-exposure-subtitle");
  const countEl = document.getElementById("politicians-sector-count-label");
  const summary = document.getElementById("politicians-sector-exposure-summary");
  const charts = document.getElementById("politicians-sector-charts");
  if (!body) return;

  document.querySelectorAll("[data-politicians-sector-sort]").forEach((btn) => {
    const key = btn.dataset.politiciansSectorSort;
    const active = key === politicianSectorSortKey;
    const label = POLITICIAN_SECTOR_SORT_LABELS[key] || key;
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? `${label} ${politicianSectorSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  if (loading) loading.hidden = !politicianSectorLoading;
  if (politicianSectorLoading) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">Loading sector exposure…</td></tr>`;
    return;
  }

  const payload = lastPoliticianSectorPayload;
  if (!payload?.available) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${escapeHtml(payload?.unavailableReason || "No sector exposure data available.")}</td></tr>`;
    if (summary) summary.hidden = true;
    if (charts) charts.hidden = true;
    if (subtitle) subtitle.textContent = "Explore which sectors members of Congress are investing in based on publicly disclosed trades.";
    return;
  }

  renderPoliticianSectorFilterOptions(payload);
  const rows = sortPoliticianSectorRows(payload.rows || []);
  if (summary) summary.hidden = false;
  if (charts) charts.hidden = false;
  document.getElementById("politicians-sector-total-trades").textContent = formatInteger(payload.summary.totalTrades);
  document.getElementById("politicians-sector-total-politicians").textContent = formatInteger(
    payload.summary.totalPoliticians
  );
  document.getElementById("politicians-sector-count").textContent = formatInteger(payload.summary.sectorCount);
  document.getElementById("politicians-sector-top-sector").textContent =
    payload.summary.mostTradedSector || "—";

  renderPoliticianSectorBarChart(
    document.getElementById("politicians-sector-chart-allocation"),
    payload.charts?.sectorAllocation || [],
    { mode: "single" }
  );
  renderPoliticianSectorBarChart(
    document.getElementById("politicians-sector-chart-buy-sell"),
    payload.charts?.buyVsSell || [],
    { mode: "buySell" }
  );
  renderPoliticianSectorMonthlyChart(
    document.getElementById("politicians-sector-chart-monthly"),
    payload.charts?.monthlyActivity || []
  );

  const chamberLabel =
    politicianSectorChamber === "all" ? "All chambers" : politicianChamberLabel(politicianSectorChamber);
  if (subtitle) {
    subtitle.textContent = `${politicianAnalyticsPeriodLabel(politicianSectorPeriod)} · ${chamberLabel} · ${rows.length} sectors`;
  }
  if (countEl) countEl.textContent = rows.length ? `${rows.length} sectors` : "No matches";

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No sectors match the current filters.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((row) => {
      const stock = row.mostTradedStock;
      const stockLabel = stock
        ? stock.ticker
          ? `<a href="${stockPath(stock.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(stock.ticker)}">${escapeHtml(stock.ticker)}</a>`
          : escapeHtml(stock.companyName || "—")
        : "—";
      const buyer = row.largestBuyer
        ? `<a href="${politicianPath(row.largestBuyer.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.largestBuyer.politicianKey)}">${escapeHtml(row.largestBuyer.politicianName)}</a>`
        : "—";
      return `<tr>
        <td><a href="${politicianSectorPath(row.sectorSlug)}" class="fundamentals-grid__link">${escapeHtml(row.sector)}</a></td>
        <td class="mono num">${formatInteger(row.tradeCount)}</td>
        <td class="mono num">${formatInteger(row.politicianCount)}</td>
        <td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.totalEstimatedValueUsd))}</td>
        <td class="mono num">${formatInteger(row.buyCount)}</td>
        <td class="mono num">${formatInteger(row.sellCount)}</td>
        <td class="mono num">${formatInteger(row.netBuyCount)}</td>
        <td>${stockLabel}</td>
        <td>${buyer}</td>
      </tr>`;
    })
    .join("");
}

function renderPoliticianSectorDetail() {
  const main = document.getElementById("politicians-sector-exposure-main");
  const detail = document.getElementById("politicians-sector-detail");
  const payload = lastPoliticianSectorDetailPayload;
  if (!activePoliticianSectorSlug) {
    if (main) main.hidden = false;
    if (detail) detail.hidden = true;
    return;
  }
  if (main) main.hidden = true;
  if (detail) detail.hidden = false;
  if (!payload) return;

  document.getElementById("politicians-sector-detail-title").textContent = payload.sector || "Sector";
  document.getElementById("politicians-sector-detail-subtitle").textContent =
    payload.available
      ? `${payload.summary.tradeCount} trades · ${payload.summary.politicianCount} politicians · ${formatDisclosedUsdPlain(payload.summary.totalEstimatedValueUsd)} estimated`
      : payload.unavailableReason || "No data";

  const summary = document.getElementById("politicians-sector-detail-summary");
  if (summary) {
    summary.innerHTML = payload.available
      ? `<div class="institution-most-accumulated__summary-card"><span class="institution-most-accumulated__summary-label">Trades</span><span class="institution-most-accumulated__summary-value mono">${formatInteger(payload.summary.tradeCount)}</span></div>
      <div class="institution-most-accumulated__summary-card"><span class="institution-most-accumulated__summary-label">Purchases</span><span class="institution-most-accumulated__summary-value mono">${formatInteger(payload.summary.buyCount)}</span></div>
      <div class="institution-most-accumulated__summary-card"><span class="institution-most-accumulated__summary-label">Sales</span><span class="institution-most-accumulated__summary-value mono">${formatInteger(payload.summary.sellCount)}</span></div>
      <div class="institution-most-accumulated__summary-card"><span class="institution-most-accumulated__summary-label">Politicians</span><span class="institution-most-accumulated__summary-value mono">${formatInteger(payload.summary.politicianCount)}</span></div>`
      : "";
  }

  const monthlyWrap = document.getElementById("politicians-sector-detail-monthly-wrap");
  if (monthlyWrap) monthlyWrap.hidden = !payload.available;
  renderPoliticianSectorMonthlyChart(
    document.getElementById("politicians-sector-detail-monthly"),
    payload.monthlyActivity || []
  );

  const polBody = document.getElementById("politicians-sector-detail-politicians");
  if (polBody) {
    polBody.innerHTML = (payload.politicians || [])
      .map(
        (row) => `<tr>
        <td><a href="${politicianPath(row.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.politicianKey)}">${escapeHtml(row.politicianName)}</a></td>
        <td class="mono num">${formatInteger(row.tradeCount)}</td>
        <td class="mono num">${formatInteger(row.buyCount)}</td>
        <td class="mono num">${formatInteger(row.sellCount)}</td>
        <td class="mono num">${escapeHtml(formatDisclosedUsd(row.netAmountUsd))}</td>
      </tr>`
      )
      .join("");
  }

  const stocksBody = document.getElementById("politicians-sector-detail-stocks");
  if (stocksBody) {
    stocksBody.innerHTML = (payload.mostTradedStocks || [])
      .map((row) => {
        const label = row.ticker
          ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.companyName || row.ticker)}</a>`
          : escapeHtml(row.companyName || "—");
        return `<tr><td>${label}</td><td class="mono num">${formatInteger(row.tradeCount)}</td><td class="mono num">${escapeHtml(formatDisclosedUsdPlain(row.totalValueUsd))}</td></tr>`;
      })
      .join("");
  }

  const renderTradeRows = (rows) =>
    (rows || [])
      .map((row) => {
        const stock = row.ticker
          ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.companyName || row.ticker)}</a>`
          : escapeHtml(row.companyName || "—");
        return `<tr>
        <td><a href="${politicianPath(row.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.politicianKey)}">${escapeHtml(row.politicianName)}</a></td>
        <td>${stock}</td>
        <td class="mono num">${escapeHtml(row.amountRange || formatDisclosedUsdPlain(row.amountUsd))}</td>
        <td class="mono">${escapeHtml(formatPoliticianTradeDate(row.transactionDate))}</td>
      </tr>`;
      })
      .join("");

  const buysBody = document.getElementById("politicians-sector-detail-buys");
  if (buysBody) buysBody.innerHTML = renderTradeRows(payload.largestPurchases);
  const sellsBody = document.getElementById("politicians-sector-detail-sells");
  if (sellsBody) sellsBody.innerHTML = renderTradeRows(payload.largestSales);
  const recentBody = document.getElementById("politicians-sector-detail-recent");
  if (recentBody) {
    recentBody.innerHTML = (payload.recentDisclosures || [])
      .map((row) => {
        const stock = row.ticker
          ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.companyName || row.ticker)}</a>`
          : escapeHtml(row.companyName || "—");
        return `<tr>
        <td><a href="${politicianPath(row.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.politicianKey)}">${escapeHtml(row.politicianName)}</a></td>
        <td>${stock}</td>
        <td>${escapeHtml(row.transactionType || row.transactionCategory)}</td>
        <td class="mono num">${escapeHtml(row.amountRange || formatDisclosedUsdPlain(row.amountUsd))}</td>
        <td class="mono">${escapeHtml(formatPoliticianTradeDate(row.transactionDate))}</td>
      </tr>`;
      })
      .join("");
  }
}

async function loadPoliticianSectorExposurePage() {
  readPoliticianSectorFiltersFromDom();
  if (politicianSectorLoading) {
    renderPoliticianSectorExposureTable();
    return;
  }
  politicianSectorLoading = true;
  renderPoliticianSectorExposureTable();
  try {
    const qs = buildPoliticianSectorQueryString();
    lastPoliticianSectorPayload = await apiJson(`/api/politicians/sector-exposure?${qs}`);
    if (activePoliticianSectorSlug) {
      lastPoliticianSectorDetailPayload = await apiJson(
        `/api/politicians/sector-exposure/${encodeURIComponent(activePoliticianSectorSlug)}?${qs}`
      );
    } else {
      lastPoliticianSectorDetailPayload = null;
    }
  } catch (err) {
    lastPoliticianSectorPayload = {
      available: false,
      unavailableReason:
        err instanceof Error ? err.message : "Failed to load politician sector exposure.",
      rows: [],
      charts: { sectorAllocation: [], buyVsSell: [], monthlyActivity: [] },
      summary: { totalTrades: 0, totalPoliticians: 0, sectorCount: 0, mostTradedSector: null },
    };
    lastPoliticianSectorDetailPayload = null;
  } finally {
    politicianSectorLoading = false;
    renderPoliticianSectorExposureTable();
    renderPoliticianSectorDetail();
  }
}

async function loadPoliticianProfileSector(key) {
  const section = document.getElementById("politicians-profile-sector");
  if (!section || !key) {
    if (section) section.hidden = true;
    return;
  }
  try {
    lastPoliticianProfileSectorPayload = await apiJson(
      `/api/politicians/profile/${encodeURIComponent(key)}/sector-exposure?period=quarter&chamber=all`
    );
  } catch {
    lastPoliticianProfileSectorPayload = null;
  }
  renderPoliticianProfileSector();
}

function renderPoliticianProfileSector() {
  const section = document.getElementById("politicians-profile-sector");
  const payload = lastPoliticianProfileSectorPayload;
  if (!section) return;
  if (!payload?.available || !payload.sectorAllocation?.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const summary = document.getElementById("politicians-profile-sector-summary");
  if (summary) {
    summary.innerHTML = `<div class="institution-most-accumulated__summary-card"><span class="institution-most-accumulated__summary-label">Top sector</span><span class="institution-most-accumulated__summary-value">${escapeHtml(payload.mostTradedSectors[0]?.sector || "—")}</span></div>`;
  }
  renderPoliticianSectorBarChart(
    document.getElementById("politicians-profile-sector-allocation"),
    payload.sectorAllocation.map((row) => ({ sector: row.sector, tradeCount: row.tradeCount })),
    { mode: "single", maxRows: 6 }
  );
  renderPoliticianSectorBarChart(
    document.getElementById("politicians-profile-sector-buy-sell"),
    payload.sectorAllocation.map((row) => ({ sector: row.sector, buyCount: row.buyCount, sellCount: row.sellCount })),
    { mode: "buySell", maxRows: 6 }
  );
  renderPoliticianSectorMonthlyChart(
    document.getElementById("politicians-profile-sector-monthly"),
    payload.monthlySectorActivity || []
  );
}

function setupPoliticianSectorExposurePage() {
  if (politicianSectorBound) return;
  politicianSectorBound = true;

  document.getElementById("politicians-sector-exposure-back")?.addEventListener("click", () => {
    navigateToPoliticianTrades();
  });
  document.getElementById("politicians-hub-sector-exposure-link")?.addEventListener("click", () => {
    navigateToPoliticianSectorExposure();
  });
  document.getElementById("politicians-sector-detail-back")?.addEventListener("click", () => {
    navigateToPoliticianSectorExposure();
  });

  document.getElementById("politicians-sector-exposure")?.addEventListener("click", (e) => {
    const periodBtn = e.target.closest?.("[data-politician-sector-period]");
    if (periodBtn) {
      const period = periodBtn.getAttribute("data-politician-sector-period");
      if (!period || period === politicianSectorPeriod) return;
      politicianSectorPeriod = period;
      void loadPoliticianSectorExposurePage();
      return;
    }
    const chamberBtn = e.target.closest?.("[data-politicians-sector-chamber]");
    if (chamberBtn) {
      const chamber = chamberBtn.getAttribute("data-politicians-sector-chamber");
      if (!chamber || chamber === politicianSectorChamber) return;
      politicianSectorChamber = chamber;
      void loadPoliticianSectorExposurePage();
      return;
    }
    const sortBtn = e.target.closest?.("[data-politicians-sector-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-politicians-sector-sort");
      if (!key) return;
      if (politicianSectorSortKey === key) {
        politicianSectorSortDir = politicianSectorSortDir === "desc" ? "asc" : "desc";
      } else {
        politicianSectorSortKey = key;
        politicianSectorSortDir = key === "sector" || key === "mostTradedStock" || key === "largestBuyer" ? "asc" : "desc";
      }
      renderPoliticianSectorExposureTable();
    }
  });

  [
    "politicians-sector-date-from",
    "politicians-sector-date-to",
    "politicians-sector-politician",
    "politicians-sector-state",
    "politicians-sector-transaction",
    "politicians-sector-sector",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      readPoliticianSectorFiltersFromDom();
      void loadPoliticianSectorExposurePage();
    });
  });
  document.getElementById("politicians-sector-search")?.addEventListener("input", (e) => {
    politicianSectorFilters.search = e.target.value || "";
    void loadPoliticianSectorExposurePage();
  });

  document.getElementById("politicians-sector-exposure-body")?.addEventListener("click", (e) => {
    const link = e.target.closest?.('a[href^="/politicians/sector-exposure/"]');
    if (!link) return;
    e.preventDefault();
    const parts = link.getAttribute("href")?.split("/") || [];
    const slug = decodeURIComponent(parts[parts.length - 1] || "");
    if (slug) navigateToPoliticianSectorExposure({ sectorSlug: slug });
  });
}

function getAllInsiderTransactions() {
  return Array.isArray(insidersRecentData?.transactions) ? insidersRecentData.transactions : [];
}

function formatInsiderHubDate(value) {
  if (!value) return "—";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  return String(value);
}

function parseInsiderTradeDateMs(value) {
  if (!value) return 0;
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return 0;
}

function insiderSecFilingUrl(row) {
  const cik = String(row.cik || "").replace(/\D/g, "");
  const acc = String(row.accessionNumber || "").replace(/-/g, "");
  if (!cik || !acc) return null;
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${row.accessionNumber}-index.htm`;
}

function getFilteredInsiderTrades() {
  let rows = getAllInsiderTransactions().map((row) => ({
    ...row,
    insiderKey: insiderKey(row.insiderName),
  }));
  const signal = insidersHubFilters.signal;
  if (signal === "high") rows = rows.filter((r) => r.isHighSignal);
  else if (signal === "low") rows = rows.filter((r) => !r.isHighSignal);

  const sort = insidersHubFilters.sort;
  if (sort === "name") {
    rows.sort((a, b) => {
      const byName = String(a.insiderName || "").localeCompare(String(b.insiderName || ""), undefined, {
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
      return parseInsiderTradeDateMs(b.transactionDate) - parseInsiderTradeDateMs(a.transactionDate);
    });
    return rows;
  }
  if (sort === "stock") {
    rows.sort((a, b) => {
      const aSym = String(a.ticker || "").toUpperCase();
      const bSym = String(b.ticker || "").toUpperCase();
      const byStock = aSym.localeCompare(bSym, undefined, { sensitivity: "base" });
      if (byStock !== 0) return byStock;
      return parseInsiderTradeDateMs(b.transactionDate) - parseInsiderTradeDateMs(a.transactionDate);
    });
    return rows;
  }
  if (sort === "amount") {
    rows.sort((a, b) => {
      const aAmt = Number(a.transactionValue) || 0;
      const bAmt = Number(b.transactionValue) || 0;
      if (bAmt !== aAmt) return bAmt - aAmt;
      return parseInsiderTradeDateMs(b.transactionDate) - parseInsiderTradeDateMs(a.transactionDate);
    });
    return rows;
  }
  rows.sort((a, b) => {
    const byDate = parseInsiderTradeDateMs(b.transactionDate) - parseInsiderTradeDateMs(a.transactionDate);
    if (byDate !== 0) return byDate;
    return String(a.insiderName || "").localeCompare(String(b.insiderName || ""), undefined, {
      sensitivity: "base",
    });
  });
  return rows;
}

function getInsiderFilingsByKey(key) {
  if (!key) return [];
  const rows = getAllInsiderTransactions().filter((r) => insiderKey(r.insiderName) === key);
  const map = new Map();
  for (const row of rows) {
    const acc = row.accessionNumber || `${row.ticker}-${row.filingDate}`;
    if (!map.has(acc)) {
      map.set(acc, {
        accessionNumber: row.accessionNumber,
        ticker: row.ticker,
        filingDate: row.filingDate,
        insiderTitle: row.insiderTitle,
        cik: row.cik,
        transactions: [],
      });
    }
    map.get(acc).transactions.push(row);
  }
  return [...map.values()].sort(
    (a, b) => parseInsiderTradeDateMs(b.filingDate) - parseInsiderTradeDateMs(a.filingDate)
  );
}

function updateInsidersHubToolbar() {
  document.querySelectorAll("[data-insiders-signal]").forEach((btn) => {
    const on = btn.dataset.insidersSignal === insidersHubFilters.signal;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const sortSelect = document.getElementById("insiders-hub-sort");
  if (sortSelect && sortSelect.value !== insidersHubFilters.sort) {
    sortSelect.value = insidersHubFilters.sort;
  }
}

function setupInsidersHub() {
  if (insidersHubControlsBound) return;
  insidersHubControlsBound = true;

  document.getElementById("insiders-hub-signal-row")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-insiders-signal]");
    if (!btn) return;
    const signal = btn.getAttribute("data-insiders-signal");
    if (!signal || signal === insidersHubFilters.signal) return;
    insidersHubFilters.signal = signal;
    insidersHubShowAllTrades = false;
    updateInsidersHubToolbar();
    renderInsidersHub();
  });
  document.getElementById("insiders-hub-sort")?.addEventListener("change", (e) => {
    insidersHubFilters.sort = e.target.value || "recent";
    insidersHubShowAllTrades = false;
    renderInsidersHub();
  });
  document.getElementById("insiders-trades-more-btn")?.addEventListener("click", () => {
    insidersHubShowAllTrades = !insidersHubShowAllTrades;
    renderInsidersHub();
  });
  document.getElementById("insiders-back-btn")?.addEventListener("click", () => {
    closeInsiderProfile();
  });

  document.getElementById("insiders-hub-clusters-link")?.addEventListener("click", () => {
    navigateToInsiderClusters();
  });
  document.getElementById("insiders-hub-conviction-buys-link")?.addEventListener("click", () => {
    navigateToConvictionBuys();
  });
  document.getElementById("insiders-hub-repeat-buyers-link")?.addEventListener("click", () => {
    navigateToRepeatBuyers();
  });
  document.getElementById("insiders-hub-sentiment-link")?.addEventListener("click", () => {
    navigateToInsiderSentiment();
  });
  document.getElementById("insiders-hub-first-time-buyers-link")?.addEventListener("click", () => {
    navigateToFirstTimeBuyers();
  });
  document.getElementById("insiders-hub-heavy-selling-link")?.addEventListener("click", () => {
    navigateToHeavySelling();
  });
}

function openInsiderProfile(key, { navigate = true } = {}) {
  if (!key) return;
  activeInsiderKey = key;
  if (navigate) {
    const path = insiderPath(key);
    if (window.location.pathname !== path) {
      history.pushState({ insiderKey: key }, "", path);
    }
  }
  setExploreMode("insiders", { navigate: false });
}

function closeInsiderProfile({ navigate = true } = {}) {
  activeInsiderKey = null;
  const target = insiderHubPath(activeInsiderHubView);
  if (navigate && window.location.pathname !== target) {
    history.pushState({ explore: "insiders", insiderHubView: activeInsiderHubView }, "", target);
  }
  updateInsidersView();
}

function renderInsiderHubTradeRows(trades) {
  if (!trades?.length) {
    return `<tr><td colspan="5" class="insiders-hub__no-trades">No transactions parsed</td></tr>`;
  }
  return trades
    .map((trade) => {
      const rowClass = insiderRowHighlightClass(trade.transactionCode);
      const typeLabel = formatInsiderTxCode(trade.transactionCode);
      const sym = trade.ticker ? String(trade.ticker).trim().toUpperCase() : "";
      const stock = sym ? institutionStockLinkHtml(sym, sym) : "—";
      return `<tr class="${rowClass}">
        <td>${stock}</td>
        <td>${escapeHtml(typeLabel)}</td>
        <td>${escapeHtml(formatInsiderHubDate(trade.transactionDate))}</td>
        <td class="num">${escapeHtml(formatHoldingValueUsd(trade.transactionValue, lastOwnershipCurrency))}</td>
        <td class="mono num">${escapeHtml(formatShareCount(trade.shares))}</td>
      </tr>`;
    })
    .join("");
}

function renderInsiderFilingCard(filing) {
  const secUrl = insiderSecFilingUrl(filing.transactions[0] || filing);
  const sym = filing.ticker ? String(filing.ticker).trim().toUpperCase() : "";
  const stock = sym ? institutionStockLinkHtml(sym, sym) : "—";
  return `<article class="insiders-hub__filing">
    <header class="insiders-hub__filing-head">
      <div>
        <h4 class="insiders-hub__filing-title">${stock}</h4>
        <p class="insiders-hub__filing-meta muted small">
          Filed ${escapeHtml(formatInsiderHubDate(filing.filingDate))} · ${filing.transactions.length} trade${filing.transactions.length === 1 ? "" : "s"}${filing.insiderTitle ? ` · ${escapeHtml(filing.insiderTitle)}` : ""}
        </p>
      </div>
      ${secUrl ? `<a class="insiders-hub__source-link" href="${escapeHtml(secUrl)}" target="_blank" rel="noopener noreferrer">SEC filing</a>` : ""}
    </header>
    <div class="insiders-hub__table-wrap">
      <table class="insiders-hub__table">
        <thead>
          <tr>
            <th>Stock</th>
            <th>Type</th>
            <th>Date</th>
            <th class="num">Amount</th>
            <th class="num">Shares</th>
          </tr>
        </thead>
        <tbody>${renderInsiderHubTradeRows(filing.transactions)}</tbody>
      </table>
    </div>
  </article>`;
}

function renderInsiderTradeTableRow(trade) {
  const rowClass = insiderRowHighlightClass(trade.transactionCode);
  const key = trade.insiderKey || insiderKey(trade.insiderName);
  const typeLabel = formatInsiderTxCode(trade.transactionCode);
  const sym = trade.ticker ? String(trade.ticker).trim().toUpperCase() : "";
  const stock = sym ? institutionStockLinkHtml(sym, sym) : "—";
  return `<tr class="${rowClass}">
    <td><a href="${insiderPath(key)}" class="insiders-name-link" data-insider-key="${escapeHtml(key)}">${escapeHtml(trade.insiderName)}</a></td>
    <td>${stock}</td>
    <td>${escapeHtml(typeLabel)}</td>
    <td>${escapeHtml(formatInsiderHubDate(trade.transactionDate))}</td>
    <td class="num">${escapeHtml(formatHoldingValueUsd(trade.transactionValue, lastOwnershipCurrency))}</td>
  </tr>`;
}

function renderInsiderProfile() {
  const nameEl = document.getElementById("insiders-profile-name");
  const metaEl = document.getElementById("insiders-profile-meta");
  const list = document.getElementById("insiders-profile-filings");
  const filings = getInsiderFilingsByKey(activeInsiderKey);
  if (!activeInsiderKey || !filings.length) {
    closeInsiderProfile({ navigate: false });
    return;
  }
  const tradeCount = filings.reduce((n, f) => n + f.transactions.length, 0);
  const titles = [...new Set(filings.map((f) => f.insiderTitle).filter(Boolean))];
  if (nameEl) nameEl.textContent = filings[0].transactions[0]?.insiderName || activeInsiderKey;
  if (metaEl) {
    metaEl.textContent = `${filings.length} filing${filings.length === 1 ? "" : "s"} · ${tradeCount} trade${tradeCount === 1 ? "" : "s"}${titles[0] ? ` · ${titles[0]}` : ""}`;
  }
  if (list) list.innerHTML = filings.map(renderInsiderFilingCard).join("");
}

function renderInsidersHub() {
  const empty = document.getElementById("insiders-hub-empty");
  const loading = document.getElementById("insiders-hub-loading");
  const main = document.getElementById("insiders-hub-main");
  const toolbar = document.getElementById("insiders-hub-toolbar");
  const tradesWrap = document.getElementById("insiders-trades-wrap");
  const tradesBody = document.getElementById("insiders-trades-body");
  const moreFoot = document.getElementById("insiders-trades-more-foot");
  const moreBtn = document.getElementById("insiders-trades-more-btn");
  const emptyFilter = document.getElementById("insiders-hub-empty-filter");
  const meta = document.getElementById("insiders-hub-meta");

  if (loading) loading.hidden = !insidersHubLoading;
  if (!insidersHubLoading && insidersRecentData == null) {
    if (empty) empty.hidden = false;
    if (main) main.hidden = true;
    return;
  }
  if (insidersHubLoading) {
    if (empty) empty.hidden = true;
    return;
  }

  if (main) main.hidden = false;

  const allRows = getAllInsiderTransactions();
  const trades = getFilteredInsiderTrades();
  const hasData = allRows.length > 0;
  const visible = insidersHubShowAllTrades ? trades : trades.slice(0, INSIDERS_TRADES_INITIAL_COUNT);
  const hasMore = trades.length > INSIDERS_TRADES_INITIAL_COUNT;

  if (empty) empty.hidden = hasData;
  if (toolbar) toolbar.hidden = !hasData;
  if (meta) {
    meta.hidden = !hasData;
    if (hasData) {
      const signalLabel =
        insidersHubFilters.signal === "high"
          ? "Open market"
          : insidersHubFilters.signal === "low"
            ? "Administrative"
            : "All signals";
      meta.textContent = `${trades.length} of ${allRows.length} trades · ${signalLabel}`;
    }
  }

  updateInsidersHubToolbar();
  if (emptyFilter) emptyFilter.hidden = !(hasData && trades.length === 0);
  if (tradesWrap) tradesWrap.hidden = !trades.length;
  if (tradesBody) {
    tradesBody.innerHTML = trades.length
      ? visible.map(renderInsiderTradeTableRow).join("")
      : `<tr><td colspan="5" class="trades-table__empty">No trades to display.</td></tr>`;
  }
  if (moreFoot) moreFoot.hidden = !trades.length || !hasMore;
  if (moreBtn) {
    const remaining = Math.max(0, trades.length - INSIDERS_TRADES_INITIAL_COUNT);
    moreBtn.textContent = insidersHubShowAllTrades
      ? "Show less"
      : `Show ${remaining} more trade${remaining === 1 ? "" : "s"}`;
    moreBtn.setAttribute("aria-expanded", String(insidersHubShowAllTrades));
  }
}

async function ensureInsidersRecent() {
  if (insidersHubLoaded && insidersRecentData) return insidersRecentData;
  insidersHubLoading = true;
  renderInsidersHub();
  try {
    insidersRecentData = await apiJson("/api/insiders/recent", { limit: 500, signal: "all" });
    insidersHubLoaded = true;
    return insidersRecentData;
  } catch (err) {
    insidersRecentData = insidersHubLoaded ? { transactions: [], count: 0 } : null;
    insidersHubLoaded = true;
    return insidersRecentData;
  } finally {
    insidersHubLoading = false;
    renderInsidersHub();
  }
}

async function updateInsidersView() {
  if (activeExploreMode !== "insiders") return;
  showMainEntityView();
  window.scrollTo({ top: 0, behavior: "instant" });

  const clustersHub = document.getElementById("insider-clusters-hub");
  const convictionHub = document.getElementById("insider-conviction-buys-hub");
  const repeatHub = document.getElementById("insider-repeat-buyers-hub");
  const sentimentHub = document.getElementById("insider-sentiment-hub");
  const firstTimeHub = document.getElementById("insider-first-time-buyers-hub");
  const heavySellingHub = document.getElementById("insider-heavy-selling-hub");
  const tradesHub = document.getElementById("insiders-trades-hub");
  const profile = document.getElementById("insiders-profile");
  const showProfile = Boolean(activeInsiderKey);
  const showClusters = !showProfile && activeInsiderHubView === "clusters";
  const showConviction = !showProfile && activeInsiderHubView === "conviction-buys";
  const showRepeat = !showProfile && activeInsiderHubView === "repeat-buyers";
  const showSentiment = !showProfile && activeInsiderHubView === "sentiment";
  const showFirstTime = !showProfile && activeInsiderHubView === "first-time-buyers";
  const showHeavySelling = !showProfile && activeInsiderHubView === "heavy-selling";
  const showTrades = !showProfile && activeInsiderHubView === "trades";

  if (clustersHub) clustersHub.hidden = !showClusters;
  if (convictionHub) convictionHub.hidden = !showConviction;
  if (repeatHub) repeatHub.hidden = !showRepeat;
  if (sentimentHub) sentimentHub.hidden = !showSentiment;
  if (firstTimeHub) firstTimeHub.hidden = !showFirstTime;
  if (heavySellingHub) heavySellingHub.hidden = !showHeavySelling;
  if (tradesHub) tradesHub.hidden = !showTrades;
  if (profile) profile.hidden = !showProfile;

  if (showProfile) {
    renderInsiderProfile();
    return;
  }

  if (showClusters) {
    void loadInsiderClusterHub();
    return;
  }

  if (showConviction) {
    void loadConvictionBuysHub();
    return;
  }

  if (showRepeat) {
    void loadRepeatBuyersHub();
    return;
  }

  if (showSentiment) {
    void loadInsiderSentimentHub();
    return;
  }

  if (showFirstTime) {
    void loadFirstTimeBuyersHub();
    return;
  }

  if (showHeavySelling) {
    void loadHeavySellingHub();
    return;
  }

  if (showTrades) {
    await ensureInsidersRecent();
    renderInsidersHub();
  }
}

function setInstitutionTab(tab, { updateUrl = true } = {}) {
  if (!INSTITUTION_TABS.includes(tab)) tab = "holdings";
  activeInstitutionTab = tab;
  document.querySelectorAll("[data-institution-tab]").forEach((btn) => {
    const on = btn.dataset.institutionTab === tab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".institution-panel").forEach((panel) => {
    panel.hidden = panel.dataset.institutionPanel !== tab;
  });
  if (updateUrl && activeInstitutionCik) {
    const path = institutionPath(activeInstitutionCik, tab);
    if (window.location.pathname !== path) {
      history.pushState({ institutionCik: activeInstitutionCik, institutionTab: tab }, "", path);
    }
  }
  if (activeInstitutionCik) void loadInstitutionPanel(tab, activeInstitutionCik);
}

function renderInstitutionHeader(meta) {
  lastInstitutionMeta = meta;
  const nameEl = document.getElementById("institution-name-label");
  const typeEl = document.getElementById("institution-type-label");
  const qEl = document.getElementById("institution-quarter-label");
  const posEl = document.getElementById("institution-positions-label");
  if (nameEl) nameEl.textContent = meta?.name || "—";
  if (typeEl) typeEl.textContent = meta?.type ? `${meta.type} · CIK ${bareInstitutionCik(meta.cik)}` : "Institutional filer";
  if (qEl) {
    qEl.textContent = meta?.currentQuarter
      ? `Latest quarter ${meta.currentQuarter}${meta.previousQuarter ? ` (vs ${meta.previousQuarter})` : ""}`
      : "No 13F quarter on file";
  }
  if (posEl) {
    const parts = [];
    if (meta?.positionCount != null) parts.push(`${meta.positionCount} positions`);
    if (meta?.portfolioValueUsd != null) parts.push(formatHoldingValueUsd(meta.portfolioValueUsd));
    if (meta?.filingsOnRecord != null) parts.push(`${meta.filingsOnRecord} filings`);
    posEl.textContent = parts.join(" · ") || "";
  }
}

function renderInstitutionPortfolioPowerbar(holdings, meta) {
  const wrap = document.getElementById("institution-holdings-powerbar");
  const track = document.getElementById("institution-holdings-powerbar-track");
  const legend = document.getElementById("institution-holdings-powerbar-legend");
  if (!wrap || !track || !legend) return;

  if (!holdings?.length) {
    wrap.hidden = true;
    track.innerHTML = "";
    legend.innerHTML = "";
    return;
  }

  const listedValue = holdings.reduce((s, h) => s + (Number(h.valueUsd) || 0), 0);
  const portfolioTotal =
    meta?.portfolioValueUsd != null && Number(meta.portfolioValueUsd) > 0
      ? Number(meta.portfolioValueUsd)
      : listedValue;
  const rows = holdings
    .map((h) => {
      const valueUsd = Number(h.valueUsd) || 0;
      const pct =
        portfolioTotal > 0
          ? ((Number(h.valueUsd) || 0) / portfolioTotal) * 100
          : h.pctOfPortfolio != null && Number.isFinite(Number(h.pctOfPortfolio))
            ? Number(h.pctOfPortfolio)
            : 0;
      return { ...h, pct };
    })
    .filter((h) => h.pct > 0)
    .sort((a, b) => b.pct - a.pct);

  if (!rows.length) {
    wrap.hidden = true;
    return;
  }

  const top = rows.slice(0, PORTFOLIO_POWERBAR_MAX_SEGMENTS);
  const otherPct = Math.max(0, roundPct(100 - top.reduce((s, r) => s + r.pct, 0)));
  const segments = [...top];
  if (otherPct >= 0.05) {
    segments.push({
      ticker: null,
      issuer: "Other",
      pct: otherPct,
      isOther: true,
    });
  }

  wrap.hidden = false;
  track.innerHTML = segments
    .map((seg, i) => {
      const pct = roundPct(seg.pct);
      if (pct <= 0) return "";
      const color = seg.isOther ? PORTFOLIO_POWERBAR_OTHER_COLOR : PORTFOLIO_POWERBAR_COLORS[i % PORTFOLIO_POWERBAR_COLORS.length];
      const sym = seg.ticker ? String(seg.ticker).toUpperCase() : "";
      const label = sym || String(seg.issuer || "Other");
      const title = `${label} · ${pct.toFixed(1)}% of portfolio`;
      const stockAttr = sym ? ` data-stock-symbol="${escapeHtml(sym)}"` : "";
      return `<button type="button" class="portfolio-powerbar__segment" style="--segment-color:${color};width:${pct}%" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${stockAttr}></button>`;
    })
    .join("");

  legend.innerHTML = segments
    .map((seg, i) => {
      const pct = roundPct(seg.pct);
      if (pct <= 0) return "";
      const color = seg.isOther ? PORTFOLIO_POWERBAR_OTHER_COLOR : PORTFOLIO_POWERBAR_COLORS[i % PORTFOLIO_POWERBAR_COLORS.length];
      const sym = seg.ticker ? String(seg.ticker).toUpperCase() : "";
      const label = sym || (seg.isOther ? "Other" : String(seg.issuer || "—"));
      const stockAttr = sym ? ` data-stock-symbol="${escapeHtml(sym)}"` : "";
      return `
    <li>
      <button type="button" class="portfolio-powerbar__legend-item"${stockAttr} title="${escapeHtml(label)} · ${pct.toFixed(1)}%">
        <span class="portfolio-powerbar__swatch" style="background:${color}"></span>
        <span class="portfolio-powerbar__legend-label">${escapeHtml(label)}</span>
        <span class="portfolio-powerbar__legend-pct mono">${escapeHtml(pct.toFixed(1))}%</span>
      </button>
    </li>
  `;
    })
    .join("");
}

function roundPct(n) {
  return Math.round(Number(n) * 10) / 10;
}

function institutionRowSortValue(row, key) {
  if (key === "ticker" || key === "issuer" || key === "fundName") {
    return String(row[key] || row.fundName || row.ticker || "").trim().toLowerCase();
  }
  if (key === "newValue") {
    const n = Number(row.currentValueUsd ?? row.valueChangeUsd);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(row[key]);
  return Number.isFinite(n) ? n : null;
}

function sortInstitutionTableRows(rows, key, dir) {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = institutionRowSortValue(a, key);
    const bv = institutionRowSortValue(b, key);
    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av || "").localeCompare(String(bv || ""), undefined, { sensitivity: "base" });
      if (cmp !== 0) return cmp * mul;
    } else {
      if (av == null && bv == null) {
        /* fall through */
      } else if (av == null) return 1;
      else if (bv == null) return -1;
      else if (av !== bv) return (av - bv) * mul;
    }
    return String(a.fundName || a.ticker || a.issuer || "").localeCompare(
      String(b.fundName || b.ticker || b.issuer || ""),
      undefined,
      { sensitivity: "base" }
    );
  });
}

function updateInstitutionTableSortButtons(attr, activeKey, activeDir) {
  document.querySelectorAll(`[${attr}]`).forEach((btn) => {
    const key = btn.getAttribute(attr);
    const active = key === activeKey;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    btn.classList.toggle("is-active", active);
    btn.dataset.sortDir = active ? activeDir : "";
    btn.textContent = active ? `${label} ${activeDir === "asc" ? "▲" : "▼"}` : label;
  });
}

function bindInstitutionTableSort(attr, getKey, getDir, setKey, setDir, defaultDirForKey, rerender) {
  document.querySelectorAll(`[${attr}]`).forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute(attr);
      if (!key) return;
      if (key === getKey()) {
        setDir(getDir() === "asc" ? "desc" : "asc");
      } else {
        setKey(key);
        setDir(defaultDirForKey(key));
      }
      rerender();
    });
  });
}

function renderInstitutionHoldingsRow(h) {
  const sym = h.ticker ? String(h.ticker).toUpperCase() : "";
  const tickerCell = sym
    ? `<a href="${stockPath(sym)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(sym)}">${escapeHtml(sym)}</a>`
    : "—";
  return `
    <tr>
      <td class="mono">${tickerCell}</td>
      <td>${institutionStockLinkHtml(h.ticker, h.issuer)}</td>
      <td class="mono num">${escapeHtml(formatShareCount(h.shares))}</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(h.valueUsd))}</td>
      <td class="mono num">${escapeHtml(formatPercentValue(h.pctOfPortfolio, false))}</td>
    </tr>
  `;
}

function updateInstitutionHoldingsMoreControl() {
  const foot = document.getElementById("institution-holdings-foot");
  const btn = document.getElementById("institution-holdings-more-btn");
  if (!foot || !btn) return;
  const extra = lastInstitutionHoldings.length - INSTITUTION_HOLDINGS_INITIAL_COUNT;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }
  foot.hidden = false;
  btn.textContent = institutionHoldingsExpanded
    ? "Show fewer"
    : `View all (${lastInstitutionHoldings.length})`;
  btn.setAttribute("aria-expanded", institutionHoldingsExpanded ? "true" : "false");
}

function renderInstitutionHoldingsTable(holdings, meta) {
  lastInstitutionHoldings = Array.isArray(holdings) ? holdings : [];
  lastInstitutionHoldingsMeta = meta ?? null;
  renderInstitutionPortfolioPowerbar(lastInstitutionHoldings, lastInstitutionHoldingsMeta);
  const body = document.getElementById("institution-holdings-body");
  if (!body) return;
  updateInstitutionTableSortButtons(
    "data-institution-holdings-sort",
    institutionHoldingsSortKey,
    institutionHoldingsSortDir
  );
  if (!lastInstitutionHoldings.length) {
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">No holdings for the latest quarter.</td></tr>`;
    updateInstitutionHoldingsMoreControl();
    return;
  }
  const sorted = sortInstitutionTableRows(
    lastInstitutionHoldings,
    institutionHoldingsSortKey,
    institutionHoldingsSortDir
  );
  const visible = institutionHoldingsExpanded
    ? sorted
    : sorted.slice(0, INSTITUTION_HOLDINGS_INITIAL_COUNT);
  body.innerHTML = visible.map(renderInstitutionHoldingsRow).join("");
  updateInstitutionHoldingsMoreControl();
}

function institutionActivityTickerCell(r) {
  const sym = r.ticker ? String(r.ticker).toUpperCase() : "";
  if (!sym) return "—";
  return `<a href="${stockPath(sym)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(sym)}">${escapeHtml(sym)}</a>`;
}

function renderInstitutionActivityValueCell(valueChangeUsd) {
  if (valueChangeUsd == null || !Number.isFinite(Number(valueChangeUsd))) {
    return `<td class="mono num">—</td>`;
  }
  const x = Number(valueChangeUsd);
  const dir = x >= 0 ? "up" : "down";
  return `<td class="mono num"><span class="change-pill change-pill--${dir}">${escapeHtml(formatValueAddedMillions(x))}</span></td>`;
}

function renderInstitutionActivityMoverRow(r, { sold = false } = {}) {
  const sc = Number(r.sharesChange);
  const shareLabel = sold ? formatShareCount(Math.abs(sc)) : formatSharesDelta(sc);
  const shareDir = sold ? "down" : "up";
  return `
    <tr>
      <td class="mono">${institutionActivityTickerCell(r)}</td>
      <td>${institutionStockLinkHtml(r.ticker, r.issuer)}</td>
      ${renderInstitutionActivityValueCell(r.valueChangeUsd)}
      <td class="mono num"><span class="change-pill change-pill--${shareDir}">${escapeHtml(shareLabel)}</span></td>
      <td class="mono num">${escapeHtml(formatShareCount(r.previousShares))}</td>
      <td class="mono num">${escapeHtml(formatShareCount(r.currentShares))}</td>
    </tr>
  `;
}

function renderInstitutionNewPositionRow(r) {
  const valueUsd = r.currentValueUsd ?? r.valueChangeUsd;
  const valueCell =
    valueUsd == null || !Number.isFinite(Number(valueUsd))
      ? "—"
      : `<span class="change-pill change-pill--up">${escapeHtml(formatValueAddedMillions(Number(valueUsd)))}</span>`;
  return `
    <tr>
      <td class="mono">${institutionActivityTickerCell(r)}</td>
      <td>${institutionStockLinkHtml(r.ticker, r.issuer)}</td>
      <td class="mono num">${valueCell}</td>
      <td class="mono num">${escapeHtml(formatShareCount(r.currentShares))}</td>
    </tr>
  `;
}

function renderInstitutionExitRow(r) {
  const valueUsd = r.previousValueUsd;
  const valueCell =
    valueUsd == null || !Number.isFinite(Number(valueUsd))
      ? "—"
      : `<span class="change-pill change-pill--down">${escapeHtml(formatValueAddedMillions(-Math.abs(Number(valueUsd))))}</span>`;
  return `
    <tr>
      <td class="mono">${institutionActivityTickerCell(r)}</td>
      <td>${institutionStockLinkHtml(r.ticker, r.issuer)}</td>
      <td class="mono num">${valueCell}</td>
      <td class="mono num"><span class="change-pill change-pill--down">${escapeHtml(formatShareCount(r.previousShares))}</span></td>
    </tr>
  `;
}

function renderInstitutionActivitySection(bodyId, rows, emptyMsg, renderRow, colSpan = 6) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!rows?.length) {
    body.innerHTML = `<tr><td colspan="${colSpan}" class="trades-table__empty">${escapeHtml(emptyMsg)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(renderRow).join("");
}

function updateInstitutionActivityMoreControl(footId, btnId, total, expanded, showFewerLabel, showMoreLabel) {
  const foot = document.getElementById(footId);
  const btn = document.getElementById(btnId);
  if (!foot || !btn) return;
  const extra = total - INSTITUTION_ACTIVITY_INITIAL_COUNT;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }
  foot.hidden = false;
  btn.textContent = expanded ? showFewerLabel : `${showMoreLabel} (${extra})`;
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function renderInstitutionActivityPanels({
  adds = [],
  trims = [],
  completelySold = [],
  newPositions = [],
  activity = [],
} = {}) {
  lastInstitutionAdds = adds;
  lastInstitutionTrims = trims;
  lastInstitutionExits = completelySold;
  lastInstitutionNewPositions = newPositions;
  if (activity.length) lastInstitutionActivityAll = activity;

  const sortedAdds = sortInstitutionTableRows(
    lastInstitutionAdds,
    institutionAddsSortKey,
    institutionAddsSortDir
  );
  const sortedTrims = sortInstitutionTableRows(
    lastInstitutionTrims,
    institutionTrimsSortKey,
    institutionTrimsSortDir
  );
  const sortedExits = sortInstitutionTableRows(
    lastInstitutionExits,
    institutionExitsSortKey,
    institutionExitsSortDir
  );
  const sortedNew = sortInstitutionTableRows(
    lastInstitutionNewPositions,
    institutionNewSortKey,
    institutionNewSortDir
  );

  const visibleAdds = institutionAddsExpanded
    ? sortedAdds
    : sortedAdds.slice(0, INSTITUTION_ACTIVITY_INITIAL_COUNT);
  const visibleTrims = institutionTrimsExpanded
    ? sortedTrims
    : sortedTrims.slice(0, INSTITUTION_ACTIVITY_INITIAL_COUNT);
  const visibleExits = institutionExitsExpanded
    ? sortedExits
    : sortedExits.slice(0, INSTITUTION_ACTIVITY_INITIAL_COUNT);
  const visibleNew = institutionNewExpanded
    ? sortedNew
    : sortedNew.slice(0, INSTITUTION_ACTIVITY_INITIAL_COUNT);

  updateInstitutionTableSortButtons("data-institution-adds-sort", institutionAddsSortKey, institutionAddsSortDir);
  updateInstitutionTableSortButtons("data-institution-trims-sort", institutionTrimsSortKey, institutionTrimsSortDir);
  updateInstitutionTableSortButtons("data-institution-exits-sort", institutionExitsSortKey, institutionExitsSortDir);
  updateInstitutionTableSortButtons("data-institution-new-sort", institutionNewSortKey, institutionNewSortDir);
  updateInstitutionTableSortButtons(
    "data-institution-activity-sort",
    institutionActivitySortKey,
    institutionActivitySortDir
  );

  renderInstitutionActivitySection(
    "institution-adds-body",
    visibleAdds,
    "No adds to existing positions this quarter.",
    (r) => renderInstitutionActivityMoverRow(r)
  );
  renderInstitutionActivitySection(
    "institution-trims-body",
    visibleTrims,
    "No trims this quarter.",
    (r) => renderInstitutionActivityMoverRow(r, { sold: true })
  );
  renderInstitutionActivitySection(
    "institution-exits-body",
    visibleExits,
    "No full exits this quarter.",
    renderInstitutionExitRow,
    4
  );
  renderInstitutionActivitySection(
    "institution-new-body",
    visibleNew,
    "No new positions this quarter.",
    renderInstitutionNewPositionRow,
    4
  );
  renderInstitutionActivityTable(lastInstitutionActivityAll);

  updateInstitutionActivityMoreControl(
    "institution-adds-foot",
    "institution-adds-more-btn",
    lastInstitutionAdds.length,
    institutionAddsExpanded,
    "Show fewer adds",
    "Show all adds"
  );
  updateInstitutionActivityMoreControl(
    "institution-trims-foot",
    "institution-trims-more-btn",
    lastInstitutionTrims.length,
    institutionTrimsExpanded,
    "Show fewer trims",
    "Show all trims"
  );
  updateInstitutionActivityMoreControl(
    "institution-exits-foot",
    "institution-exits-more-btn",
    lastInstitutionExits.length,
    institutionExitsExpanded,
    "Show fewer exits",
    "Show all exits"
  );
  updateInstitutionActivityMoreControl(
    "institution-new-foot",
    "institution-new-more-btn",
    lastInstitutionNewPositions.length,
    institutionNewExpanded,
    "Show fewer new positions",
    "Show all new positions"
  );
}

function renderInstitutionActivityTable(activity) {
  const body = document.getElementById("institution-activity-body");
  if (!body) return;
  if (!activity?.length) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No quarter-over-quarter changes (need two consecutive 13F quarters).</td></tr>`;
    return;
  }
  const sorted = sortInstitutionTableRows(activity, institutionActivitySortKey, institutionActivitySortDir);
  body.innerHTML = sorted
    .map((r) => {
      const sc = Number(r.sharesChange);
      const dir = sc >= 0 ? "up" : "down";
      const sym = r.ticker ? String(r.ticker).toUpperCase() : "";
      const tickerCell = sym
        ? `<a href="${stockPath(sym)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(sym)}">${escapeHtml(sym)}</a>`
        : "—";
      const pct =
        r.sharesChangePct != null && Number.isFinite(Number(r.sharesChangePct))
          ? ` (${formatChange(Number(r.sharesChangePct))})`
          : "";
      const valueCell =
        r.valueChangeUsd == null || !Number.isFinite(Number(r.valueChangeUsd))
          ? "—"
          : `<span class="change-pill change-pill--${Number(r.valueChangeUsd) >= 0 ? "up" : "down"}">${escapeHtml(formatValueAddedMillions(Number(r.valueChangeUsd)))}</span>`;
      return `
    <tr>
      <td class="mono">${tickerCell}</td>
      <td>${institutionStockLinkHtml(r.ticker, r.issuer)}</td>
      <td class="mono num"><span class="change-pill change-pill--${dir}">${escapeHtml(formatSharesDelta(sc))}${escapeHtml(pct)}</span></td>
      <td class="mono num">${escapeHtml(formatShareCount(r.currentShares))}</td>
      <td class="mono num">${escapeHtml(formatShareCount(r.previousShares))}</td>
      <td class="mono num">${valueCell}</td>
    </tr>
  `;
    })
    .join("");
}

function setInstitutionOptionsSubtitle(text) {
  const el = document.getElementById("institution-options-subtitle");
  if (el) el.textContent = text;
}

function institutionOptionsForBias(rows) {
  return (rows || []).map((r) => ({
    fundName: r.ticker || r.issuer || r.cusip,
    valueUsd: r.valueUsd,
    contracts: r.contracts,
  }));
}

function buildInstitutionOptionsByStock(calls, puts) {
  const byCusip = new Map();

  const ensure = (row) => {
    const key = row.cusip || row.ticker || row.issuer;
    if (!key) return null;
    if (!byCusip.has(key)) {
      byCusip.set(key, {
        ticker: row.ticker,
        issuer: row.issuer,
        cusip: row.cusip,
        callContracts: 0,
        callValueUsd: 0,
        putContracts: 0,
        putValueUsd: 0,
        commonValueUsd: Number(row.commonValueUsd) || 0,
      });
    } else if (row.commonValueUsd != null && !byCusip.get(key).commonValueUsd) {
      byCusip.get(key).commonValueUsd = Number(row.commonValueUsd) || 0;
    }
    return byCusip.get(key);
  };

  for (const c of calls || []) {
    const row = ensure(c);
    if (!row) continue;
    row.callContracts = Number(c.contracts) || 0;
    row.callValueUsd = Number(c.valueUsd) || 0;
    if (c.ticker && !row.ticker) row.ticker = c.ticker;
    if (c.issuer && !row.issuer) row.issuer = c.issuer;
  }

  for (const p of puts || []) {
    const row = ensure(p);
    if (!row) continue;
    row.putContracts = Number(p.contracts) || 0;
    row.putValueUsd = Number(p.valueUsd) || 0;
    if (p.ticker && !row.ticker) row.ticker = p.ticker;
    if (p.issuer && !row.issuer) row.issuer = p.issuer;
  }

  const rows = [];
  for (const row of byCusip.values()) {
    const callVal = row.callValueUsd;
    const putVal = row.putValueUsd;
    const hasCalls = callVal > 0 || row.callContracts > 0;
    const hasPuts = putVal > 0 || row.putContracts > 0;
    if (!hasCalls && !hasPuts) continue;

    const common = row.commonValueUsd;
    const totalExposure = common + callVal + putVal;
    const weightedNumerator =
      common + OPTIONS_CALL_WEIGHT * callVal - OPTIONS_PUT_WEIGHT * putVal;
    const biasScore = totalExposure > 0 ? weightedNumerator / totalExposure : null;
    const { netBias: biasLabel, netBiasTone: biasTone } = netBiasFromScore(biasScore);

    rows.push({
      ticker: row.ticker,
      issuer: row.issuer,
      cusip: row.cusip,
      totalContracts: row.callContracts + row.putContracts,
      commonValueUsd: common,
      callValueUsd: callVal,
      putValueUsd: putVal,
      biasScore,
      biasLabel,
      biasTone,
      totalExposure,
    });
  }

  return rows;
}

function renderInstitutionOptionsStockRow(row) {
  const sym = row.ticker ? String(row.ticker).toUpperCase() : "";
  const tickerCell = sym
    ? `<a href="${stockPath(sym)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(sym)}">${escapeHtml(sym)}</a>`
    : "—";
  const biasHtml = formatNetBiasHtml(row.biasLabel, row.biasTone, row.biasScore);
  return `
    <tr>
      <td class="mono">${tickerCell}</td>
      <td>${institutionStockLinkHtml(row.ticker, row.issuer)}</td>
      <td class="mono num">${escapeHtml(row.totalContracts > 0 ? formatShareCount(row.totalContracts) : "—")}</td>
      <td class="mono num">${escapeHtml(formatOptionsExposureCell(row.commonValueUsd))}</td>
      <td class="mono num options-funds-table__calls">${escapeHtml(formatOptionsExposureCell(row.callValueUsd))}</td>
      <td class="mono num options-funds-table__puts">${escapeHtml(formatOptionsExposureCell(row.putValueUsd))}</td>
      <td class="mono num ownership-change">${biasHtml}</td>
    </tr>
  `;
}

function updateInstitutionOptionsStocksMoreControl() {
  const foot = document.getElementById("institution-options-stocks-foot");
  const btn = document.getElementById("institution-options-stocks-more-btn");
  if (!foot || !btn) return;

  const extra = lastInstitutionOptionsByStock.length - OPTIONS_INITIAL_COUNT;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  btn.textContent = institutionOptionsStocksExpanded
    ? "Show fewer stocks"
    : `Show all stocks (${lastInstitutionOptionsByStock.length})`;
  btn.setAttribute("aria-expanded", institutionOptionsStocksExpanded ? "true" : "false");
}

function renderInstitutionOptionsStocksTable() {
  const body = document.getElementById("institution-options-stocks-body");
  if (!body) return;

  updateInstitutionTableSortButtons(
    "data-institution-options-sort",
    institutionOptionsSortKey,
    institutionOptionsSortDir
  );

  if (!lastInstitutionOptionsByStock.length) {
    const quarter = lastInstitutionMeta?.currentQuarter ?? null;
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(quarter)
    )}</td></tr>`;
    updateInstitutionOptionsStocksMoreControl();
    return;
  }

  const sorted = sortInstitutionTableRows(
    lastInstitutionOptionsByStock,
    institutionOptionsSortKey,
    institutionOptionsSortDir
  );
  const visible = institutionOptionsStocksExpanded
    ? sorted
    : sorted.slice(0, OPTIONS_INITIAL_COUNT);
  body.innerHTML = visible.map(renderInstitutionOptionsStockRow).join("");
  updateInstitutionOptionsStocksMoreControl();
}

function renderInstitutionOptionsBiasSummary() {
  const body = document.getElementById("institution-options-bias-body");
  if (!body) return;

  const calls = institutionOptionsForBias(lastInstitutionOptionsCalls);
  const puts = institutionOptionsForBias(lastInstitutionOptionsPuts);
  const { callExposure, putExposure, biasScore, netBias, netBiasTone } = computeOptionsBias(calls, puts);

  if (callExposure <= 0 && putExposure <= 0) {
    body.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(lastInstitutionMeta?.currentQuarter)
    )}</td></tr>`;
    return;
  }

  const byStock = new Map();
  for (const row of [...lastInstitutionOptionsCalls, ...lastInstitutionOptionsPuts]) {
    const label = row.ticker || row.issuer;
    if (!label) continue;
    const v = Number(row.valueUsd);
    if (!Number.isFinite(v) || v <= 0) continue;
    byStock.set(label, (byStock.get(label) ?? 0) + v);
  }
  let largestPosition = "—";
  let largestValue = 0;
  for (const [name, value] of byStock) {
    if (value > largestValue) {
      largestValue = value;
      largestPosition = name;
    }
  }

  const netBiasHtml = formatNetBiasHtml(netBias, netBiasTone, biasScore);

  body.innerHTML = [
    renderOptionsBiasRow("Call exposure", escapeHtml(formatExposureUsd(callExposure)), {
      valueClass: "options-bias__label--call",
    }),
    renderOptionsBiasRow("Put exposure", escapeHtml(formatExposureUsd(putExposure)), {
      valueClass: "options-bias__label--put",
    }),
    renderOptionsBiasRow("Net options bias", netBiasHtml),
    renderOptionsBiasRow(
      "Largest option position",
      escapeHtml(largestPosition === "—" ? "—" : largestPosition)
    ),
  ].join("");
}

function renderInstitutionWeightedBiasSummary() {
  const body = document.getElementById("institution-weighted-bias-body");
  if (!body) return;

  const w = computeWeightedBias(
    lastInstitutionCommonExposureUsd,
    institutionOptionsForBias(lastInstitutionOptionsCalls),
    institutionOptionsForBias(lastInstitutionOptionsPuts)
  );

  const callExposure = sumOptionsValueUsd(institutionOptionsForBias(lastInstitutionOptionsCalls));
  const putExposure = sumOptionsValueUsd(institutionOptionsForBias(lastInstitutionOptionsPuts));
  if (callExposure <= 0 && putExposure <= 0) {
    body.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(lastInstitutionMeta?.currentQuarter)
    )}</td></tr>`;
    return;
  }

  if (w.totalExposure <= 0) {
    body.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(lastInstitutionMeta?.currentQuarter)
    )}</td></tr>`;
    return;
  }

  const netBiasHtml = formatNetBiasHtml(w.netBias, w.netBiasTone, w.weightedBias);

  body.innerHTML = [
    renderOptionsBiasRow("Common exposure", escapeHtml(formatExposureUsd(w.commonExposure))),
    renderOptionsBiasRow(
      `Call exposure (×${OPTIONS_CALL_WEIGHT})`,
      escapeHtml(formatExposureUsd(w.weightedCall)),
      { valueClass: "options-bias__label--call" }
    ),
    renderOptionsBiasRow(
      `Put exposure (×${OPTIONS_PUT_WEIGHT})`,
      escapeHtml(formatExposureUsd(w.weightedPut)),
      { valueClass: "options-bias__label--put" }
    ),
    renderOptionsBiasRow("Total exposure", escapeHtml(formatExposureUsd(w.totalExposure))),
    renderOptionsBiasRow("Weighted bias", netBiasHtml),
  ].join("");
}

function renderInstitutionOptionsTables() {
  renderInstitutionOptionsBiasSummary();
  renderInstitutionWeightedBiasSummary();
  renderInstitutionOptionsStocksTable();
}

function renderInstitutionHistoryTable(filings) {
  const body = document.getElementById("institution-history-body");
  if (!body) return;
  if (!filings?.length) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No 13F filings on record for this filer.</td></tr>`;
    return;
  }
  body.innerHTML = filings
    .map((f) => {
      const val =
        f.totalValueUsd != null && Number.isFinite(Number(f.totalValueUsd))
          ? formatHoldingValueUsd(Number(f.totalValueUsd))
          : "—";
      const link = f.href
        ? `<a class="sec-doc-link" href="${escapeHtml(f.href)}" target="_blank" rel="noopener noreferrer">View</a>`
        : "—";
      return `
    <tr>
      <td class="mono">${escapeHtml(f.quarter || "—")}</td>
      <td class="mono">${escapeHtml(f.filingDate || "—")}</td>
      <td class="mono">${escapeHtml(f.formType || "—")}</td>
      <td class="mono num">${escapeHtml(String(f.holdingsCount ?? "—"))}</td>
      <td class="mono num">${escapeHtml(val)}</td>
      <td>${link}</td>
    </tr>
  `;
    })
    .join("");
}

function formatInstitutionPerformancePct(value, { signed = true } = {}) {
  if (value == null || value === "") return "N/A";
  const x = Number(value);
  if (!Number.isFinite(x)) return "N/A";
  const pct = (x * 100).toFixed(2);
  if (!signed) return `${pct}%`;
  return `${x >= 0 ? "+" : ""}${pct}%`;
}

function formatInstitutionConsistency(score) {
  if (score == null || score === "") return "N/A";
  const x = Number(score);
  if (!Number.isFinite(x)) return "N/A";
  const pct = x * 100;
  const label = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${label}%`;
}

function institutionPerformanceReturnClass(value) {
  const x = Number(value);
  if (!Number.isFinite(x) || x === 0) return "institution-performance-rank-card__return--flat";
  return x > 0
    ? "institution-performance-rank-card__return--up"
    : "institution-performance-rank-card__return--down";
}

function renderInstitutionPerformanceSummary(latest) {
  const wrap = document.getElementById("institution-performance-summary");
  const grid = document.getElementById("institution-performance-summary-grid");
  if (!wrap || !grid) return;
  if (!latest) {
    wrap.hidden = true;
    grid.innerHTML = "";
    return;
  }
  const items = [
    { label: "As of", value: latest.quarter || "—", mono: false },
    { label: "Portfolio value", value: formatProxyUsd(latest.currentPortfolioValueUsd), mono: true },
    { label: "QoQ change", value: formatProxyPct(latest.qoqChangePct), mono: true },
    { label: "1Y change", value: formatProxyPct(latest.change1yPct), mono: true },
    { label: "3Y change", value: formatProxyPct(latest.change3yPct), mono: true },
    { label: "Holdings", value: formatProxyHoldings(latest.holdingsCount), mono: true },
  ];
  grid.innerHTML = items
    .map(
      (item) => `<div class="institution-performance-summary__item">
      <span class="institution-performance-summary__label">${escapeHtml(item.label)}</span>
      <span class="institution-performance-summary__value${item.mono ? " mono" : ""}">${escapeHtml(item.value)}</span>
    </div>`
    )
    .join("");
  wrap.hidden = false;
}

function renderInstitutionPerformanceTable(history) {
  const body = document.getElementById("institution-performance-body");
  if (!body) return;
  const rows = (Array.isArray(history) ? [...history] : []).filter(
    (row) =>
      row.qoqChangePct != null &&
      Number.isFinite(Number(row.qoqChangePct)) &&
      row.portfolioValueUsd != null &&
      Number.isFinite(Number(row.portfolioValueUsd))
  );
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No reported 13F portfolio value history yet.</td></tr>`;
    return;
  }
  rows.sort((a, b) => String(b.quarter).localeCompare(String(a.quarter)));
  body.innerHTML = rows
    .map(
      (row) => `<tr>
      <td class="mono">${escapeHtml(row.quarter || "—")}</td>
      <td class="mono num">${escapeHtml(formatProxyUsd(row.portfolioValueUsd))}</td>
      <td class="mono num">${escapeHtml(formatProxyUsd(row.qoqChangeUsd))}</td>
      <td class="mono num">${escapeHtml(formatProxyPct(row.qoqChangePct))}</td>
      <td class="mono num">${escapeHtml(formatProxyHoldings(row.holdingsCount))}</td>
      <td class="mono num">${escapeHtml(row.filingDate ? String(row.filingDate).slice(0, 10) : "—")}</td>
    </tr>`
    )
    .join("");
}

function performancePeriodLabel(period) {
  if (period === "qoq") return "Latest quarter";
  if (period === "ytd") return "Year to date";
  return "Rolling 1 year";
}

function renderInstitutionPerformanceRankings() {
  const track = document.getElementById("institution-performance-rankings-track");
  const body = document.getElementById("institution-performance-rankings-body");
  const loading = document.getElementById("institution-performance-rankings-loading");
  const subtitle = document.getElementById("institution-performance-rankings-subtitle");
  if (!track || !body) return;

  document.querySelectorAll("[data-performance-period]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.performancePeriod === institutionPerformancePeriod);
  });

  if (loading) loading.hidden = !institutionPerformanceRankingsLoading;

  if (institutionPerformanceRankingsLoading) {
    track.innerHTML = "";
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">Computing institutional performance…</td></tr>`;
    return;
  }

  const rows = lastInstitutionPerformanceRankings;
  if (!rows.length) {
    const cacheHint =
      "No rankings available. Run npm run performance:warm-cache once (batch price job), then refresh.";
    track.innerHTML = `<p class="muted small">${cacheHint}</p>`;
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">${cacheHint}</td></tr>`;
    if (subtitle) subtitle.textContent = "13F-implied portfolio performance from quarter-end holdings";
    return;
  }

  const asOf = rows[0]?.quarter;
  if (subtitle) {
    subtitle.textContent = `${performancePeriodLabel(institutionPerformancePeriod)} · as of ${asOf || "N/A"} · ${rows.length} institutions · 13F-implied`;
  }

  track.innerHTML = rows
    .map((row) => {
      const retClass = institutionPerformanceReturnClass(row.return);
      const cik = bareInstitutionCik(row.institutionId);
      return `<button type="button" class="institution-performance-rank-card" data-institution-cik="${escapeHtml(cik)}" role="listitem">
        <span class="institution-performance-rank-card__rank">#${row.rank}</span>
        <span class="institution-performance-rank-card__name">${escapeHtml(row.name)}</span>
        <span class="institution-performance-rank-card__meta">${escapeHtml(row.type)} · ${escapeHtml(row.quarter || "N/A")}</span>
        <span class="institution-performance-rank-card__return ${retClass} mono">${escapeHtml(formatInstitutionPerformancePct(row.return))}</span>
      </button>`;
    })
    .join("");

  body.innerHTML = rows
    .map(
      (row) => `<tr>
      <td class="mono num">${row.rank}</td>
      <td><a href="${institutionPath(bareInstitutionCik(row.institutionId), "performance")}" class="ownership-fund__link" data-institution-cik="${escapeHtml(bareInstitutionCik(row.institutionId))}">${escapeHtml(row.name)}</a></td>
      <td>${escapeHtml(row.type)}</td>
      <td class="mono">${escapeHtml(row.quarter || "N/A")}</td>
      <td class="mono num">${escapeHtml(formatInstitutionPerformancePct(row.return))}</td>
      <td class="mono num">${escapeHtml(formatInstitutionConsistency(row.consistencyScore))}</td>
      <td class="mono num">${row.volatility != null ? escapeHtml(formatInstitutionPerformancePct(row.volatility, { signed: false })) : "N/A"}</td>
    </tr>`
    )
    .join("");
}

async function loadInstitutionPerformanceRankings() {
  if (institutionPerformanceRankingsLoading) {
    renderInstitutionPerformanceRankings();
    return;
  }
  institutionPerformanceRankingsLoading = true;
  renderInstitutionPerformanceRankings();
  try {
    const data = await apiJson("/api/institutions/performance/rankings", {
      period: institutionPerformancePeriod,
    });
    lastInstitutionPerformanceRankings = Array.isArray(data?.rankings) ? data.rankings : [];
  } catch {
    lastInstitutionPerformanceRankings = [];
  } finally {
    institutionPerformanceRankingsLoading = false;
    renderInstitutionPerformanceRankings();
  }
}

function setupInstitutionPerformanceRankings() {
  if (institutionPerformanceRankingsBound) return;
  institutionPerformanceRankingsBound = true;

  document.getElementById("institution-hub-performance-link")?.addEventListener("click", () => {
    navigateToInstitutionPerformanceRankings();
  });
  document.getElementById("institution-hub-most-accumulated-link")?.addEventListener("click", () => {
    navigateToInstitutionMostAccumulated();
  });
}

const MOST_ACCUMULATED_SORT_LABELS = {
  rank: "Rank",
  ticker: "Stock",
  institutionsBuying: "Institutions buying",
  netSharesAdded: "Net shares added",
  percentIncrease: "% increase",
  totalInstitutionsOwning: "Total institutions owning",
};

function mostAccumulatedPeriodLabel(period) {
  if (period === "30d") return "Last 30 days";
  if (period === "year") return "Last year";
  return "Last quarter";
}

function matchesMostAccumulatedSize(reportedValueUsd, size) {
  const v = Number(reportedValueUsd);
  if (!size || !Number.isFinite(v)) return true;
  if (size === "mega") return v >= 200e9;
  if (size === "large") return v >= 10e9 && v < 200e9;
  if (size === "mid") return v >= 2e9 && v < 10e9;
  if (size === "small") return v < 2e9;
  return true;
}

function filterMostAccumulatedRows(rows) {
  const q = mostAccumulatedFilters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (mostAccumulatedFilters.sector && row.sector !== mostAccumulatedFilters.sector) return false;
    if (!matchesMostAccumulatedSize(row.reportedValueUsd, mostAccumulatedFilters.size)) return false;
    if (mostAccumulatedFilters.minBuyers > 0 && row.institutionsBuying < mostAccumulatedFilters.minBuyers) {
      return false;
    }
    if (mostAccumulatedFilters.minShares > 0 && row.netSharesAdded < mostAccumulatedFilters.minShares) {
      return false;
    }
    if (mostAccumulatedFilters.positiveOnly && row.netSharesAdded <= 0) return false;
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const name = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || name.includes(q);
  });
}

function sortMostAccumulatedRows(rows) {
  const key = mostAccumulatedSortKey;
  const dir = mostAccumulatedSortDir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    if (key === "rank") return 0;
    const av = a[key];
    const bv = b[key];
    if (key === "ticker") {
      const al = String(a.companyName || a.ticker || "");
      const bl = String(b.companyName || b.ticker || "");
      return al.localeCompare(bl) * dir;
    }
    const ax = Number(av);
    const bx = Number(bv);
    if (Number.isFinite(ax) && Number.isFinite(bx)) return (ax - bx) * dir;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return String(av).localeCompare(String(bv)) * dir;
  });
  if (key === "rank" || key === "netSharesAdded") {
    return sorted;
  }
  return sorted;
}

function formatMostAccumulatedShares(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  return `${sign}${formatLargeNumber(Math.abs(x))}`;
}

function formatMostAccumulatedPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : x < 0 ? "−" : "";
  return `${sign}${Math.abs(x).toFixed(1)}%`;
}

function renderMostAccumulatedSummary(summary) {
  const wrap = document.getElementById("institution-most-accumulated-summary");
  const topEl = document.getElementById("most-accumulated-top-stock");
  const topMeta = document.getElementById("most-accumulated-top-stock-meta");
  const buyersEl = document.getElementById("most-accumulated-total-buyers");
  const sharesEl = document.getElementById("most-accumulated-total-shares");
  const avgEl = document.getElementById("most-accumulated-avg-pct");
  if (!wrap) return;

  if (!summary?.topStock) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  if (topEl) {
    topEl.textContent = summary.topStock.companyName
      ? `${summary.topStock.ticker} · ${summary.topStock.companyName}`
      : summary.topStock.ticker;
  }
  if (topMeta) {
    topMeta.textContent = `${formatMostAccumulatedShares(summary.topStock.netSharesAdded)} net shares`;
  }
  if (buyersEl) buyersEl.textContent = formatInteger(summary.totalInstitutionsBuying);
  if (sharesEl) {
    sharesEl.textContent = formatMostAccumulatedShares(summary.totalNetSharesAdded);
    sharesEl.className = `institution-most-accumulated__summary-value mono ${
      summary.totalNetSharesAdded >= 0 ? "change--up" : "change--down"
    }`;
  }
  if (avgEl) avgEl.textContent = formatMostAccumulatedPct(summary.averagePercentIncrease);
}

function renderMostAccumulatedSectorOptions(sectors) {
  const select = document.getElementById("most-accumulated-sector");
  if (!select) return;
  const current = mostAccumulatedFilters.sector;
  select.innerHTML =
    `<option value="">All sectors</option>` +
    (Array.isArray(sectors) ? sectors : [])
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("");
  select.value = current;
}

function renderMostAccumulatedTable() {
  const body = document.getElementById("institution-most-accumulated-body");
  const loading = document.getElementById("institution-most-accumulated-loading");
  const subtitle = document.getElementById("institution-most-accumulated-subtitle");
  const countEl = document.getElementById("most-accumulated-count");
  const pagination = document.getElementById("institution-most-accumulated-pagination");
  const pageLabel = document.getElementById("institution-most-accumulated-page-label");
  const prevBtn = document.getElementById("institution-most-accumulated-prev");
  const nextBtn = document.getElementById("institution-most-accumulated-next");
  if (!body) return;

  document.querySelectorAll("[data-accumulation-period]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.accumulationPeriod === mostAccumulatedPeriod);
  });
  document.querySelectorAll("[data-most-accumulated-sort]").forEach((btn) => {
    const key = btn.dataset.mostAccumulatedSort;
    const active = key === mostAccumulatedSortKey;
    const label = MOST_ACCUMULATED_SORT_LABELS[key] || key;
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? `${label} ${mostAccumulatedSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  if (loading) loading.hidden = !mostAccumulatedLoading;

  if (mostAccumulatedLoading) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">Loading institutional accumulation…</td></tr>`;
    if (pagination) pagination.hidden = true;
    return;
  }

  const payload = lastMostAccumulatedPayload;
  if (!payload) {
    const hint =
      "No accumulation data available. Run npm run institutions:warm-most-accumulated once, then refresh.";
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">${hint}</td></tr>`;
    if (pagination) pagination.hidden = true;
    if (subtitle) {
      subtitle.textContent = "Shows which stocks institutions have accumulated the most over the selected period.";
    }
    return;
  }

  if (!payload.available) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">${escapeHtml(
      payload.unavailableReason || "Period unavailable."
    )}</td></tr>`;
    renderMostAccumulatedSummary(null);
    if (pagination) pagination.hidden = true;
    if (subtitle) {
      subtitle.textContent = `${mostAccumulatedPeriodLabel(mostAccumulatedPeriod)} · unavailable`;
    }
    if (countEl) countEl.textContent = "";
    return;
  }

  const filtered = filterMostAccumulatedRows(payload.stocks || []);
  let rows = sortMostAccumulatedRows(filtered);
  if (mostAccumulatedSortKey === "rank" || mostAccumulatedSortKey === "netSharesAdded") {
    rows = [...rows].sort((a, b) => b.netSharesAdded - a.netSharesAdded);
    if (mostAccumulatedSortDir === "asc") rows.reverse();
  }

  const filteredSummary = {
    topStock: rows[0]
      ? {
          ticker: rows[0].ticker,
          companyName: rows[0].companyName,
          netSharesAdded: rows[0].netSharesAdded,
        }
      : null,
    totalInstitutionsBuying: rows.reduce((sum, r) => sum + r.institutionsBuying, 0),
    totalNetSharesAdded: rows.reduce((sum, r) => sum + r.netSharesAdded, 0),
    averagePercentIncrease: (() => {
      const vals = rows.map((r) => r.percentIncrease).filter((v) => v != null && Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    })(),
  };

  renderMostAccumulatedSummary(filteredSummary);
  renderMostAccumulatedSectorOptions(payload.sectors || []);

  const total = rows.length;
  const pageSize = INSTITUTION_MOST_ACCUMULATED_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  if (mostAccumulatedPage > pageCount) mostAccumulatedPage = pageCount;
  if (mostAccumulatedPage < 1) mostAccumulatedPage = 1;
  const page = mostAccumulatedPage;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const periodMeta = [payload.currentPeriod, payload.previousPeriod].filter(Boolean).join(" vs ");
  if (subtitle) {
    subtitle.textContent = `${mostAccumulatedPeriodLabel(mostAccumulatedPeriod)} · ${periodMeta} · ${total} stocks`;
  }
  if (countEl) {
    countEl.textContent = total
      ? `${start + 1}–${start + pageRows.length} of ${total}`
      : "No matches";
  }

  if (pagination) pagination.hidden = total <= pageSize;
  if (pageLabel) pageLabel.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No stocks match the current filters.</td></tr>`;
    return;
  }

  body.innerHTML = pageRows
    .map((row, index) => {
      const rank = start + index + 1;
      const sharesClass = row.netSharesAdded >= 0 ? "change--up" : "change--down";
      const pctClass =
        row.percentIncrease == null
          ? ""
          : row.percentIncrease >= 0
            ? "change--up"
            : "change--down";
      const label = row.companyName
        ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
        : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
      return `<tr>
      <td class="mono num">${rank}</td>
      <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${label}</a></td>
      <td class="mono num">${formatInteger(row.institutionsBuying)}</td>
      <td class="mono num ${sharesClass}">${escapeHtml(formatMostAccumulatedShares(row.netSharesAdded))}</td>
      <td class="mono num ${pctClass}">${escapeHtml(formatMostAccumulatedPct(row.percentIncrease))}</td>
      <td class="mono num">${formatInteger(row.totalInstitutionsOwning)}</td>
    </tr>`;
    })
    .join("");
}

async function loadMostAccumulatedPage() {
  if (mostAccumulatedLoading) {
    renderMostAccumulatedTable();
    return;
  }
  mostAccumulatedLoading = true;
  renderMostAccumulatedTable();
  try {
    const data = await apiJson("/api/institutions/most-accumulated", { period: mostAccumulatedPeriod });
    lastMostAccumulatedPayload = data;
    mostAccumulatedPage = 1;
  } catch (err) {
    lastMostAccumulatedPayload = {
      available: false,
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
      stocks: [],
      sectors: [],
    };
  } finally {
    mostAccumulatedLoading = false;
    renderMostAccumulatedTable();
  }
}

function readMostAccumulatedFiltersFromDom() {
  mostAccumulatedFilters.search = document.getElementById("most-accumulated-search")?.value || "";
  mostAccumulatedFilters.sector = document.getElementById("most-accumulated-sector")?.value || "";
  mostAccumulatedFilters.size = document.getElementById("most-accumulated-size")?.value || "";
  mostAccumulatedFilters.minBuyers = Number(document.getElementById("most-accumulated-min-buyers")?.value || 0) || 0;
  mostAccumulatedFilters.minShares = Number(document.getElementById("most-accumulated-min-shares")?.value || 0) || 0;
  mostAccumulatedFilters.positiveOnly = Boolean(
    document.getElementById("most-accumulated-positive-only")?.checked
  );
}

function setupMostAccumulatedPage() {
  if (mostAccumulatedBound) return;
  mostAccumulatedBound = true;

  document.getElementById("institution-most-accumulated-back")?.addEventListener("click", () => {
    navigateToInstitutionDirectory();
  });

  document.getElementById("institution-most-accumulated-prev")?.addEventListener("click", () => {
    if (mostAccumulatedPage <= 1) return;
    mostAccumulatedPage -= 1;
    renderMostAccumulatedTable();
  });
  document.getElementById("institution-most-accumulated-next")?.addEventListener("click", () => {
    mostAccumulatedPage += 1;
    renderMostAccumulatedTable();
  });

  const panel = document.getElementById("institution-most-accumulated");
  panel?.addEventListener("click", (e) => {
    const periodBtn = e.target.closest?.("[data-accumulation-period]");
    if (periodBtn) {
      const period = periodBtn.getAttribute("data-accumulation-period");
      if (!period || period === mostAccumulatedPeriod) return;
      mostAccumulatedPeriod = period;
      mostAccumulatedPage = 1;
      void loadMostAccumulatedPage();
      return;
    }
    const sortBtn = e.target.closest?.("[data-most-accumulated-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-most-accumulated-sort");
      if (!key) return;
      if (mostAccumulatedSortKey === key) {
        mostAccumulatedSortDir = mostAccumulatedSortDir === "desc" ? "asc" : "desc";
      } else {
        mostAccumulatedSortKey = key;
        mostAccumulatedSortDir = key === "ticker" ? "asc" : "desc";
      }
      mostAccumulatedPage = 1;
      renderMostAccumulatedTable();
    }
  });

  ["most-accumulated-search", "most-accumulated-sector", "most-accumulated-size", "most-accumulated-min-buyers", "most-accumulated-min-shares"].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener("input", () => {
        readMostAccumulatedFiltersFromDom();
        mostAccumulatedPage = 1;
        renderMostAccumulatedTable();
      });
      document.getElementById(id)?.addEventListener("change", () => {
        readMostAccumulatedFiltersFromDom();
        mostAccumulatedPage = 1;
        renderMostAccumulatedTable();
      });
    }
  );
  document.getElementById("most-accumulated-positive-only")?.addEventListener("change", () => {
    readMostAccumulatedFiltersFromDom();
    mostAccumulatedPage = 1;
    renderMostAccumulatedTable();
  });
}

const NEW_POSITIONS_SORT_LABELS = {
  companyName: "Stock",
  ticker: "Ticker",
  institutionName: "Institution",
  positionValueUsd: "Position value",
  portfolioWeightPct: "Portfolio weight",
  filingDate: "Filing date",
};

function formatNewPositionsFilingDate(value) {
  if (!value) return "—";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  return String(value);
}

function filterNewPositionsRows(rows) {
  const q = newPositionsFilters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (newPositionsFilters.quarter && row.quarter !== newPositionsFilters.quarter) return false;
    if (newPositionsFilters.institution && row.institutionId !== newPositionsFilters.institution) {
      return false;
    }
    if (newPositionsFilters.sector && row.sector !== newPositionsFilters.sector) return false;
    if (
      newPositionsFilters.minValue > 0 &&
      (row.positionValueUsd == null || row.positionValueUsd < newPositionsFilters.minValue)
    ) {
      return false;
    }
    if (
      newPositionsFilters.minWeight > 0 &&
      (row.portfolioWeightPct == null || row.portfolioWeightPct < newPositionsFilters.minWeight)
    ) {
      return false;
    }
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    const institution = String(row.institutionName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q) || institution.includes(q);
  });
}

function sortNewPositionsRows(rows) {
  const key = newPositionsSortKey;
  const dir = newPositionsSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "companyName") {
      const av = String(a.companyName || a.ticker || "").toLowerCase();
      const bv = String(b.companyName || b.ticker || "").toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    if (key === "ticker") {
      return String(a.ticker || "").localeCompare(String(b.ticker || "")) * dir;
    }
    if (key === "institutionName") {
      return String(a.institutionName || "").localeCompare(String(b.institutionName || "")) * dir;
    }
    if (key === "filingDate") {
      const av = Date.parse(a.filingDate || "") || 0;
      const bv = Date.parse(b.filingDate || "") || 0;
      return (av - bv) * dir;
    }
    const av = Number(a[key]);
    const bv = Number(b[key]);
    const an = Number.isFinite(av) ? av : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bv) ? bv : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir;
  });
}

function renderNewPositionsSummary(payload) {
  const summary = payload?.summary;
  const totalEl = document.getElementById("new-positions-total");
  const instEl = document.getElementById("new-positions-institutions");
  const stocksEl = document.getElementById("new-positions-unique-stocks");
  const valueEl = document.getElementById("new-positions-total-value");
  if (totalEl) totalEl.textContent = formatInteger(summary?.totalNewPositions ?? 0);
  if (instEl) instEl.textContent = formatInteger(summary?.institutionsReporting ?? 0);
  if (stocksEl) stocksEl.textContent = formatInteger(summary?.uniqueStocks ?? 0);
  if (valueEl) valueEl.textContent = formatHoldingValueUsd(summary?.totalReportedValueUsd ?? 0);
}

function renderNewPositionsFilterOptions(payload) {
  if (newPositionsFilterOptionsReady) return;
  const quarterSelect = document.getElementById("new-positions-quarter");
  const institutionSelect = document.getElementById("new-positions-institution");
  const sectorSelect = document.getElementById("new-positions-sector");
  if (quarterSelect) {
    const current = newPositionsFilters.quarter;
    quarterSelect.innerHTML =
      `<option value="">All quarters</option>` +
      (Array.isArray(payload?.quarters) ? payload.quarters : [])
        .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
        .join("");
    quarterSelect.value = current;
  }
  if (institutionSelect) {
    const current = newPositionsFilters.institution;
    institutionSelect.innerHTML =
      `<option value="">All institutions</option>` +
      (Array.isArray(payload?.institutions) ? payload.institutions : [])
        .map(
          (inst) =>
            `<option value="${escapeHtml(inst.cik)}">${escapeHtml(inst.name)}</option>`
        )
        .join("");
    institutionSelect.value = current;
  }
  if (sectorSelect) {
    const current = newPositionsFilters.sector;
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("");
    sectorSelect.value = current;
  }
  newPositionsFilterOptionsReady = true;
}

function newPositionsQueryParams() {
  return {
    quarter: newPositionsFilters.quarter || undefined,
    institution: newPositionsFilters.institution || undefined,
    sector: newPositionsFilters.sector || undefined,
    minValue: newPositionsFilters.minValue > 0 ? newPositionsFilters.minValue : undefined,
    minWeight: newPositionsFilters.minWeight > 0 ? newPositionsFilters.minWeight : undefined,
    search: newPositionsFilters.search || undefined,
    page: newPositionsPage,
    pageSize: INSTITUTION_NEW_POSITIONS_PAGE_SIZE,
    sort: newPositionsSortKey,
    sortDir: newPositionsSortDir,
  };
}

function renderNewPositionsTable() {
  const body = document.getElementById("institution-new-positions-body");
  const loading = document.getElementById("institution-new-positions-loading");
  const subtitle = document.getElementById("institution-new-positions-subtitle");
  const countEl = document.getElementById("new-positions-count");
  const pagination = document.getElementById("institution-new-positions-pagination");
  const pageLabel = document.getElementById("institution-new-positions-page-label");
  const prevBtn = document.getElementById("institution-new-positions-prev");
  const nextBtn = document.getElementById("institution-new-positions-next");
  if (!body) return;

  document.querySelectorAll("[data-new-positions-sort]").forEach((btn) => {
    const key = btn.dataset.newPositionsSort;
    const active = key === newPositionsSortKey;
    const label = NEW_POSITIONS_SORT_LABELS[key] || key;
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? `${label} ${newPositionsSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  if (loading) loading.hidden = !newPositionsLoading;
  if (newPositionsLoading) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">Loading new institutional positions…</td></tr>`;
    if (pagination) pagination.hidden = true;
    return;
  }

  const payload = lastNewPositionsPayload;
  if (!payload) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No new position data available. Run npm run institutions:warm-new-positions once, then refresh.</td></tr>`;
    if (pagination) pagination.hidden = true;
    if (subtitle) {
      subtitle.textContent =
        "Stocks that institutions opened as brand-new positions in their most recent 13F filing.";
    }
    return;
  }
  if (payload.unavailableReason) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${escapeHtml(payload.unavailableReason)}</td></tr>`;
    renderNewPositionsSummary(payload);
    if (pagination) pagination.hidden = true;
    if (countEl) countEl.textContent = "";
    return;
  }

  renderNewPositionsFilterOptions(payload);
  renderNewPositionsSummary(payload);

  const rows = payload.positions || [];
  const paginationMeta = payload.pagination || {
    page: newPositionsPage,
    pageSize: INSTITUTION_NEW_POSITIONS_PAGE_SIZE,
    total: rows.length,
    pageCount: 1,
  };
  const total = paginationMeta.total ?? rows.length;
  const page = paginationMeta.page ?? newPositionsPage;
  const pageCount = paginationMeta.pageCount ?? 1;
  const start = total ? (page - 1) * (paginationMeta.pageSize ?? INSTITUTION_NEW_POSITIONS_PAGE_SIZE) : 0;

  if (subtitle) {
    subtitle.textContent = `Latest 13F vs prior filing · ${formatInteger(total)} position${total === 1 ? "" : "s"}`;
  }
  if (countEl) {
    countEl.textContent = total
      ? `${start + 1}–${start + rows.length} of ${formatInteger(total)}`
      : "No matches";
  }

  if (pagination) pagination.hidden = total <= (paginationMeta.pageSize ?? INSTITUTION_NEW_POSITIONS_PAGE_SIZE);
  if (pageLabel) pageLabel.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No positions match the current filters.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((row) => {
      const ticker = row.ticker || "—";
      const stockLabel = row.companyName || row.ticker || "—";
      const stockCell = row.ticker
        ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(stockLabel)}</a>`
        : escapeHtml(stockLabel);
      const instCik = bareInstitutionCik(row.institutionId);
      return `<tr>
      <td>${stockCell}</td>
      <td class="mono">${row.ticker ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(ticker)}</a>` : "—"}</td>
      <td><a href="${institutionPath(instCik, "activity")}" class="ownership-fund__link" data-institution-cik="${escapeHtml(instCik)}">${escapeHtml(row.institutionName)}</a></td>
      <td class="mono">${escapeHtml(row.quarter || "—")}</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.positionValueUsd))}</td>
      <td class="mono num">${escapeHtml(formatShareCount(row.shares))}</td>
      <td class="mono num">${row.portfolioWeightPct == null ? "—" : `${row.portfolioWeightPct.toFixed(2)}%`}</td>
      <td class="mono">${escapeHtml(formatNewPositionsFilingDate(row.filingDate))}</td>
      <td class="muted">None</td>
    </tr>`;
    })
    .join("");
}

function readNewPositionsFiltersFromDom() {
  newPositionsFilters.quarter = document.getElementById("new-positions-quarter")?.value || "";
  newPositionsFilters.institution = document.getElementById("new-positions-institution")?.value || "";
  newPositionsFilters.sector = document.getElementById("new-positions-sector")?.value || "";
  newPositionsFilters.search = document.getElementById("new-positions-search")?.value || "";
  newPositionsFilters.minValue =
    Number(document.getElementById("new-positions-min-value")?.value || 0) || 0;
  newPositionsFilters.minWeight =
    Number(document.getElementById("new-positions-min-weight")?.value || 0) || 0;
}

async function loadNewPositionsPage() {
  if (newPositionsLoading) {
    renderNewPositionsTable();
    return;
  }
  newPositionsLoading = true;
  renderNewPositionsTable();
  try {
    lastNewPositionsPayload = await apiJson(
      "/api/institutions/new-positions",
      newPositionsQueryParams()
    );
    if (lastNewPositionsPayload?.pagination?.page) {
      newPositionsPage = lastNewPositionsPayload.pagination.page;
    }
  } catch (err) {
    lastNewPositionsPayload = {
      computedAt: null,
      quarters: [],
      sectors: [],
      institutions: [],
      summary: {
        totalNewPositions: 0,
        institutionsReporting: 0,
        uniqueStocks: 0,
        totalReportedValueUsd: 0,
      },
      positions: [],
      pagination: { page: 1, pageSize: INSTITUTION_NEW_POSITIONS_PAGE_SIZE, total: 0, pageCount: 1 },
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
    };
  } finally {
    newPositionsLoading = false;
    renderNewPositionsTable();
  }
}

function setupNewPositionsPage() {
  if (newPositionsBound) return;
  newPositionsBound = true;

  document.getElementById("institution-new-positions-back")?.addEventListener("click", () => {
    navigateToInstitutionDirectory();
  });
  document.getElementById("institution-hub-new-positions-link")?.addEventListener("click", () => {
    navigateToInstitutionNewPositions();
  });

  document.getElementById("institution-new-positions-prev")?.addEventListener("click", () => {
    if (newPositionsPage <= 1) return;
    newPositionsPage -= 1;
    void loadNewPositionsPage();
  });
  document.getElementById("institution-new-positions-next")?.addEventListener("click", () => {
    newPositionsPage += 1;
    void loadNewPositionsPage();
  });

  const panel = document.getElementById("institution-new-positions");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-new-positions-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-new-positions-sort");
      if (!key) return;
      if (newPositionsSortKey === key) {
        newPositionsSortDir = newPositionsSortDir === "desc" ? "asc" : "desc";
      } else {
        newPositionsSortKey = key;
        newPositionsSortDir =
          key === "companyName" || key === "ticker" || key === "institutionName" || key === "filingDate"
            ? "asc"
            : "desc";
      }
      newPositionsPage = 1;
      void loadNewPositionsPage();
    }
  });

  [
    "new-positions-quarter",
    "new-positions-institution",
    "new-positions-sector",
    "new-positions-min-value",
    "new-positions-min-weight",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      readNewPositionsFiltersFromDom();
      newPositionsPage = 1;
      void loadNewPositionsPage();
    });
  });
  document.getElementById("new-positions-search")?.addEventListener("input", (e) => {
    newPositionsFilters.search = e.target.value || "";
    newPositionsPage = 1;
    clearTimeout(newPositionsSearchTimer);
    newPositionsSearchTimer = setTimeout(() => void loadNewPositionsPage(), 250);
  });
}

const COMPLETELY_SOLD_SORT_LABELS = {
  companyName: "Stock",
  ticker: "Ticker",
  previousPositionValueUsd: "Prior value (all institutions)",
  previousShares: "Prior shares",
  institutionsExiting: "Institutions exiting",
  sector: "Sector",
};

function filterCompletelySoldRows(rows) {
  const q = completelySoldFilters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (completelySoldFilters.quarter) {
      const quarters = Array.isArray(row.quarters) ? row.quarters : [];
      if (!quarters.includes(completelySoldFilters.quarter)) return false;
    }
    if (completelySoldFilters.sector && row.sector !== completelySoldFilters.sector) return false;
    if (
      completelySoldFilters.minValue > 0 &&
      (row.previousPositionValueUsd == null ||
        row.previousPositionValueUsd < completelySoldFilters.minValue)
    ) {
      return false;
    }
    if (
      completelySoldFilters.minExits > 0 &&
      (Number(row.institutionsExiting) || 0) < completelySoldFilters.minExits
    ) {
      return false;
    }
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

function sortCompletelySoldRows(rows) {
  const key = completelySoldSortKey;
  const dir = completelySoldSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "companyName") {
      const av = String(a.companyName || a.ticker || "").toLowerCase();
      const bv = String(b.companyName || b.ticker || "").toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    if (key === "ticker" || key === "sector") {
      return String(a[key] || "").localeCompare(String(b[key] || "")) * dir;
    }
    const av = Number(a[key]);
    const bv = Number(b[key]);
    const an = Number.isFinite(av) ? av : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bv) ? bv : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir;
  });
}

function renderCompletelySoldSummary(rows, payloadSummary = null) {
  const totalExitEvents = rows.reduce((sum, r) => sum + (Number(r.institutionsExiting) || 0), 0);
  const totalValue = rows.reduce((sum, r) => sum + (r.previousPositionValueUsd ?? 0), 0);
  const totalEl = document.getElementById("completely-sold-total");
  const instEl = document.getElementById("completely-sold-institutions");
  const stocksEl = document.getElementById("completely-sold-unique-stocks");
  const valueEl = document.getElementById("completely-sold-total-value");
  if (totalEl) totalEl.textContent = formatInteger(rows.length);
  if (instEl) {
    instEl.textContent = formatInteger(
      payloadSummary?.institutionsReporting ?? totalExitEvents
    );
  }
  if (stocksEl) stocksEl.textContent = formatInteger(totalExitEvents);
  if (valueEl) valueEl.textContent = formatHoldingValueUsd(totalValue);
}

function renderCompletelySoldFilterOptions(payload) {
  const quarterSelect = document.getElementById("completely-sold-quarter");
  const sectorSelect = document.getElementById("completely-sold-sector");
  if (quarterSelect) {
    const current = completelySoldFilters.quarter;
    quarterSelect.innerHTML =
      `<option value="">All quarters</option>` +
      (Array.isArray(payload?.quarters) ? payload.quarters : [])
        .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
        .join("");
    quarterSelect.value = current;
  }
  if (sectorSelect) {
    const current = completelySoldFilters.sector;
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("");
    sectorSelect.value = current;
  }
}

function renderCompletelySoldTable() {
  const body = document.getElementById("institution-completely-sold-body");
  const loading = document.getElementById("institution-completely-sold-loading");
  const subtitle = document.getElementById("institution-completely-sold-subtitle");
  const countEl = document.getElementById("completely-sold-count");
  const pagination = document.getElementById("institution-completely-sold-pagination");
  const pageLabel = document.getElementById("institution-completely-sold-page-label");
  const prevBtn = document.getElementById("institution-completely-sold-prev");
  const nextBtn = document.getElementById("institution-completely-sold-next");
  if (!body) return;

  document.querySelectorAll("[data-completely-sold-sort]").forEach((btn) => {
    const key = btn.dataset.completelySoldSort;
    const active = key === completelySoldSortKey;
    const label = COMPLETELY_SOLD_SORT_LABELS[key] || key;
    btn.classList.toggle("is-active", active);
    btn.textContent = active ? `${label} ${completelySoldSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  if (loading) loading.hidden = !completelySoldLoading;
  if (completelySoldLoading) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">Loading completely sold positions…</td></tr>`;
    if (pagination) pagination.hidden = true;
    return;
  }

  const payload = lastCompletelySoldPayload;
  if (!payload) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">No completely sold data available. Run npm run institutions:warm-completely-sold once, then refresh.</td></tr>`;
    if (pagination) pagination.hidden = true;
    if (subtitle) {
      subtitle.textContent =
        "Stocks fully exited across tracked institutions, ranked by aggregated prior 13F value.";
    }
    return;
  }
  if (payload.unavailableReason) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">${escapeHtml(payload.unavailableReason)}</td></tr>`;
    renderCompletelySoldSummary([]);
    if (pagination) pagination.hidden = true;
    if (countEl) countEl.textContent = "";
    return;
  }

  renderCompletelySoldFilterOptions(payload);
  const rows = sortCompletelySoldRows(filterCompletelySoldRows(payload.positions || []));
  renderCompletelySoldSummary(rows, payload.summary);

  const total = rows.length;
  const pageSize = INSTITUTION_COMPLETELY_SOLD_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  if (completelySoldPage > pageCount) completelySoldPage = pageCount;
  if (completelySoldPage < 1) completelySoldPage = 1;
  const page = completelySoldPage;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  if (subtitle) {
    subtitle.textContent = `Aggregated exits across institutions · ${total} stock${total === 1 ? "" : "s"}`;
  }
  if (countEl) {
    countEl.textContent = total
      ? `${start + 1}–${start + pageRows.length} of ${total}`
      : "No matches";
  }

  if (pagination) pagination.hidden = total <= pageSize;
  if (pageLabel) pageLabel.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">No stocks match the current filters.</td></tr>`;
    return;
  }

  body.innerHTML = pageRows
    .map((row) => {
      const ticker = row.ticker || "—";
      const stockLabel = row.companyName || row.ticker || "—";
      const stockCell = row.ticker
        ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(stockLabel)}</a>`
        : escapeHtml(stockLabel);
      return `<tr>
      <td>${stockCell}</td>
      <td class="mono">${row.ticker ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(ticker)}</a>` : "—"}</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.previousPositionValueUsd))}</td>
      <td class="mono num">${escapeHtml(formatShareCount(row.previousShares))}</td>
      <td class="mono num">${formatInteger(row.institutionsExiting)}</td>
      <td>${escapeHtml(row.sector || "—")}</td>
      <td class="muted">Sold</td>
    </tr>`;
    })
    .join("");
}

function readCompletelySoldFiltersFromDom() {
  completelySoldFilters.quarter = document.getElementById("completely-sold-quarter")?.value || "";
  completelySoldFilters.sector = document.getElementById("completely-sold-sector")?.value || "";
  completelySoldFilters.search = document.getElementById("completely-sold-search")?.value || "";
  completelySoldFilters.minValue =
    Number(document.getElementById("completely-sold-min-value")?.value || 0) || 0;
  completelySoldFilters.minExits =
    Number(document.getElementById("completely-sold-min-exits")?.value || 0) || 0;
}

async function loadCompletelySoldPage() {
  if (completelySoldLoading) {
    renderCompletelySoldTable();
    return;
  }
  completelySoldLoading = true;
  renderCompletelySoldTable();
  try {
    lastCompletelySoldPayload = await apiJson("/api/institutions/completely-sold");
    completelySoldPage = 1;
  } catch (err) {
    lastCompletelySoldPayload = {
      computedAt: null,
      quarters: [],
      sectors: [],
      summary: {
        totalStocksSold: 0,
        institutionsReporting: 0,
        uniqueStocksSold: 0,
        totalValueExitedUsd: 0,
      },
      positions: [],
      unavailableReason:
        err instanceof Error
          ? err.message
          : "Failed to load. Restart the server (npm start) if you recently updated the app.",
    };
  } finally {
    completelySoldLoading = false;
    renderCompletelySoldTable();
  }
}

function setupCompletelySoldPage() {
  if (completelySoldBound) return;
  completelySoldBound = true;

  document.getElementById("institution-completely-sold-back")?.addEventListener("click", () => {
    navigateToInstitutionDirectory();
  });
  document.getElementById("institution-hub-completely-sold-link")?.addEventListener("click", () => {
    navigateToInstitutionCompletelySold();
  });

  document.getElementById("institution-completely-sold-prev")?.addEventListener("click", () => {
    if (completelySoldPage <= 1) return;
    completelySoldPage -= 1;
    renderCompletelySoldTable();
  });
  document.getElementById("institution-completely-sold-next")?.addEventListener("click", () => {
    completelySoldPage += 1;
    renderCompletelySoldTable();
  });

  const panel = document.getElementById("institution-completely-sold");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-completely-sold-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-completely-sold-sort");
      if (!key) return;
      if (completelySoldSortKey === key) {
        completelySoldSortDir = completelySoldSortDir === "desc" ? "asc" : "desc";
      } else {
        completelySoldSortKey = key;
        completelySoldSortDir =
          key === "companyName" || key === "ticker" || key === "sector" ? "asc" : "desc";
      }
      completelySoldPage = 1;
      renderCompletelySoldTable();
    }
  });

  [
    "completely-sold-quarter",
    "completely-sold-sector",
    "completely-sold-min-value",
    "completely-sold-min-exits",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      readCompletelySoldFiltersFromDom();
      completelySoldPage = 1;
      renderCompletelySoldTable();
    });
  });
  document.getElementById("completely-sold-search")?.addEventListener("input", (e) => {
    completelySoldFilters.search = e.target.value || "";
    completelySoldPage = 1;
    renderCompletelySoldTable();
  });
}

function institutionInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function formatCompareFilingDate(value) {
  if (!value) return "—";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  return String(value);
}

function findTrackedInstitution(cik) {
  const bare = bareInstitutionCik(cik);
  return trackedInstitutions.find((f) => bareInstitutionCik(f.cik) === bare) || null;
}

function filterInstitutionsForCompare(query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return trackedInstitutions.slice(0, 12);
  return trackedInstitutions
    .filter((f) => {
      const name = String(f.name || "").toLowerCase();
      const cik = bareInstitutionCik(f.cik);
      return name.includes(q) || cik.includes(q.replace(/^0+/, ""));
    })
    .slice(0, 12);
}

function updateInstitutionComparePickerUi(side) {
  const suffix = side === "a" ? "a" : "b";
  const cik = side === "a" ? institutionCompareCikA : institutionCompareCikB;
  const fund = cik ? findTrackedInstitution(cik) : null;
  const search = document.getElementById(`compare-institution-${suffix}-search`);
  const avatar = document.getElementById(`compare-avatar-${suffix}`);
  const profileLink = document.getElementById(`compare-profile-link-${suffix}`);
  const quarterEl = document.getElementById(`compare-institution-${suffix}-quarter`);
  const dateEl = document.getElementById(`compare-institution-${suffix}-date`);

  if (search && fund && document.activeElement !== search) {
    search.value = fund.name;
  }
  if (avatar) avatar.textContent = fund ? institutionInitials(fund.name) : "—";
  if (profileLink) {
    if (fund) {
      profileLink.href = institutionPath(bareInstitutionCik(fund.cik), "holdings");
      profileLink.classList.remove("hidden");
      profileLink.dataset.institutionCik = bareInstitutionCik(fund.cik);
    } else {
      profileLink.classList.add("hidden");
      profileLink.removeAttribute("href");
    }
  }

  const payload = lastInstitutionComparePayload;
  const sideData =
    payload && fund
      ? side === "a"
        ? bareInstitutionCik(payload.institutionA?.cik) === bareInstitutionCik(fund.cik)
          ? payload.institutionA
          : null
        : bareInstitutionCik(payload.institutionB?.cik) === bareInstitutionCik(fund.cik)
          ? payload.institutionB
          : null
      : null;

  if (quarterEl) {
    quarterEl.textContent = sideData
      ? `Filing quarter: ${sideData.quarter}`
      : "Filing quarter: —";
  }
  if (dateEl) {
    dateEl.textContent = sideData
      ? `Filing date: ${formatCompareFilingDate(sideData.filingDate)}`
      : "Filing date: —";
  }
}

function updateInstitutionCompareRunState() {
  const btn = document.getElementById("institution-compare-run");
  const hint = document.getElementById("institution-compare-hint");
  const ready =
    Boolean(institutionCompareCikA) &&
    Boolean(institutionCompareCikB) &&
    institutionCompareCikA !== institutionCompareCikB;
  if (btn) btn.disabled = !ready || institutionCompareLoading;
  if (hint) {
    if (!institutionCompareCikA || !institutionCompareCikB) {
      hint.textContent = "Select two institutions to compare their latest 13F filings.";
    } else if (institutionCompareCikA === institutionCompareCikB) {
      hint.textContent = "Choose two different institutions.";
    } else {
      hint.textContent = "Compare uses each institution's latest available 13F filing.";
    }
  }
}

function renderInstitutionCompareSuggestions(side, query) {
  const suffix = side === "a" ? "a" : "b";
  const list = document.getElementById(`compare-institution-${suffix}-suggestions`);
  if (!list) return;
  const rows = filterInstitutionsForCompare(query);
  if (!rows.length) {
    list.hidden = true;
    list.innerHTML = "";
    return;
  }
  list.hidden = false;
  list.innerHTML = rows
    .map(
      (f) => `<li class="institution-compare__suggestion" role="option" data-cik="${escapeHtml(bareInstitutionCik(f.cik))}" tabindex="-1">${escapeHtml(f.name)}</li>`
    )
    .join("");
}

function hideInstitutionCompareSuggestions(side) {
  const suffix = side === "a" ? "a" : "b";
  const list = document.getElementById(`compare-institution-${suffix}-suggestions`);
  if (list) {
    list.hidden = true;
    list.innerHTML = "";
  }
}

function selectInstitutionForCompare(side, cik) {
  const bare = bareInstitutionCik(cik);
  if (side === "a") institutionCompareCikA = bare;
  else institutionCompareCikB = bare;
  hideInstitutionCompareSuggestions(side);
  updateInstitutionComparePickerUi(side);
  updateInstitutionCompareRunState();
  const results = document.getElementById("institution-compare-results");
  if (results) results.hidden = true;
  lastInstitutionComparePayload = null;
}

function setInstitutionCompareTab(tab) {
  institutionCompareTab = tab;
  document.querySelectorAll("[data-compare-tab]").forEach((btn) => {
    const on = btn.dataset.compareTab === tab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".institution-compare__panel").forEach((panel) => {
    panel.hidden = true;
  });
  const panel = document.getElementById(`compare-panel-${tab}`);
  if (panel) panel.hidden = false;
}

function renderCompareStockLink(row) {
  const label = row.companyName || row.ticker || "—";
  if (!row.ticker) return escapeHtml(label);
  return `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(label)}</a>`;
}

function renderCompareTickerLink(row) {
  if (!row.ticker) return "—";
  return `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link mono" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</a>`;
}

function sortSharedCompareRows(rows) {
  const key = institutionCompareSortKey;
  const dir = institutionCompareSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "companyName") {
      const av = String(a.companyName || a.ticker || "").toLowerCase();
      const bv = String(b.companyName || b.ticker || "").toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    if (key === "ticker") {
      return String(a.ticker || "").localeCompare(String(b.ticker || "")) * dir;
    }
    const valueMap = {
      valueA: (r) => r.institutionA.valueUsd,
      weightA: (r) => r.institutionA.weightPct,
      valueB: (r) => r.institutionB.valueUsd,
      weightB: (r) => r.institutionB.weightPct,
      weightDiff: (r) => Math.abs(r.weightDifferencePct),
    };
    const pick = valueMap[key] || ((r) => r.institutionA.valueUsd);
    return (pick(a) - pick(b)) * dir;
  });
}

function renderInstitutionCompareSharedTable() {
  const body = document.getElementById("compare-shared-body");
  if (!body || !lastInstitutionComparePayload) return;

  document.querySelectorAll("[data-compare-shared-sort]").forEach((btn) => {
    const key = btn.dataset.compareSharedSort;
    const active = key === institutionCompareSortKey;
    btn.classList.toggle("is-active", active);
    const labels = {
      companyName: "Stock",
      ticker: "Ticker",
      valueA: "A position value",
      weightA: "A weight",
      valueB: "B position value",
      weightB: "B weight",
      weightDiff: "Weight diff",
    };
    const label = labels[key] || key;
    btn.textContent = active ? `${label} ${institutionCompareSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  const rows = sortSharedCompareRows(lastInstitutionComparePayload.sharedHoldings || []);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">No shared holdings between these portfolios.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `<tr>
      <td>${renderCompareStockLink(row)}</td>
      <td>${renderCompareTickerLink(row)}</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.institutionA.valueUsd))}</td>
      <td class="mono num">${row.institutionA.weightPct.toFixed(2)}%</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.institutionB.valueUsd))}</td>
      <td class="mono num">${row.institutionB.weightPct.toFixed(2)}%</td>
      <td class="mono num">${row.weightDifferencePct >= 0 ? "+" : ""}${row.weightDifferencePct.toFixed(2)}%</td>
    </tr>`
    )
    .join("");
}

function renderInstitutionCompareUniqueTable(side) {
  const suffix = side === "a" ? "a" : "b";
  const body = document.getElementById(`compare-unique-${suffix}-body`);
  if (!body || !lastInstitutionComparePayload) return;
  const rows =
    side === "a"
      ? lastInstitutionComparePayload.uniqueToA || []
      : lastInstitutionComparePayload.uniqueToB || [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No unique holdings.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (row) => `<tr>
      <td>${renderCompareStockLink(row)}</td>
      <td>${renderCompareTickerLink(row)}</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.valueUsd))}</td>
      <td class="mono num">${row.weightPct.toFixed(2)}%</td>
      <td class="mono num">${escapeHtml(formatShareCount(row.shares))}</td>
      <td class="mono">${escapeHtml(row.quarter || "—")}</td>
    </tr>`
    )
    .join("");
}

function renderInstitutionCompareTopLists() {
  const payload = lastInstitutionComparePayload;
  if (!payload) return;
  const listA = document.getElementById("compare-top-list-a");
  const listB = document.getElementById("compare-top-list-b");
  const titleA = document.getElementById("compare-top-title-a");
  const titleB = document.getElementById("compare-top-title-b");
  if (titleA) titleA.textContent = `${payload.institutionA.name} — Top 25`;
  if (titleB) titleB.textContent = `${payload.institutionB.name} — Top 25`;

  const renderList = (holdings) =>
    (holdings || [])
      .map((row) => {
        const label = row.companyName || row.ticker || "—";
        const main = row.ticker
          ? `<a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(label)}</a>`
          : escapeHtml(label);
        return `<li>${main} <span class="muted small mono">${escapeHtml(formatHoldingValueUsd(row.valueUsd))} · ${row.weightPct.toFixed(2)}%</span></li>`;
      })
      .join("");

  if (listA) listA.innerHTML = renderList(payload.institutionA.topHoldings);
  if (listB) listB.innerHTML = renderList(payload.institutionB.topHoldings);
}

function renderInstitutionCompareSectors() {
  const payload = lastInstitutionComparePayload;
  if (!payload) return;
  const listA = document.getElementById("compare-sector-list-a");
  const listB = document.getElementById("compare-sector-list-b");
  const titleA = document.getElementById("compare-sector-title-a");
  const titleB = document.getElementById("compare-sector-title-b");
  const sectorsBtn = document.getElementById("compare-tab-sectors-btn");
  const hasSector = Boolean(payload.stats?.hasSectorData);

  if (sectorsBtn) sectorsBtn.hidden = !hasSector;
  if (!hasSector) {
    if (institutionCompareTab === "sectors") setInstitutionCompareTab("top");
    if (listA) listA.innerHTML = "";
    if (listB) listB.innerHTML = "";
    return;
  }

  if (titleA) titleA.textContent = payload.institutionA.name;
  if (titleB) titleB.textContent = payload.institutionB.name;

  const renderSectors = (slices) =>
    (slices || [])
      .slice(0, 12)
      .map(
        (slice) =>
          `<li><strong>${escapeHtml(slice.sector)}</strong> <span class="mono">${slice.weightPct.toFixed(1)}%</span> <span class="muted small mono">${escapeHtml(formatHoldingValueUsd(slice.valueUsd))}</span></li>`
      )
      .join("");

  if (listA) listA.innerHTML = renderSectors(payload.institutionA.sectorAllocation);
  if (listB) listB.innerHTML = renderSectors(payload.institutionB.sectorAllocation);
}

function renderInstitutionCompareSummary() {
  const payload = lastInstitutionComparePayload;
  const results = document.getElementById("institution-compare-results");
  if (!payload || !results) return;

  results.hidden = false;
  const { institutionA: a, institutionB: b, stats } = payload;

  const setLargest = (el, holding) => {
    if (!el) return;
    if (!holding) {
      el.textContent = "—";
      return;
    }
    const label = holding.companyName || holding.ticker || "—";
    el.textContent = `${label} (${holding.weightPct.toFixed(2)}%)`;
  };

  const setSector = (el, slice) => {
    if (!el) return;
    el.textContent = slice ? `${slice.sector} (${slice.weightPct.toFixed(1)}%)` : "—";
  };

  document.getElementById("compare-summary-title-a").textContent = a.name;
  document.getElementById("compare-summary-title-b").textContent = b.name;
  document.getElementById("compare-a-total-value").textContent = formatHoldingValueUsd(a.portfolioValueUsd);
  document.getElementById("compare-b-total-value").textContent = formatHoldingValueUsd(b.portfolioValueUsd);
  document.getElementById("compare-a-holdings").textContent = formatInteger(a.holdingsCount);
  document.getElementById("compare-b-holdings").textContent = formatInteger(b.holdingsCount);
  setLargest(document.getElementById("compare-a-largest"), a.largestHolding);
  setLargest(document.getElementById("compare-b-largest"), b.largestHolding);
  setSector(document.getElementById("compare-a-sector"), a.topSector);
  setSector(document.getElementById("compare-b-sector"), b.topSector);

  document.getElementById("compare-stat-shared").textContent = formatInteger(stats.sharedCount);
  document.getElementById("compare-stat-unique-a").textContent = formatInteger(stats.uniqueToACount);
  document.getElementById("compare-stat-unique-b").textContent = formatInteger(stats.uniqueToBCount);
  document.getElementById("compare-stat-jaccard").textContent = `${stats.jaccardSimilarityPct.toFixed(1)}%`;
  document.getElementById("compare-stat-weighted").textContent =
    stats.weightedSimilarityPct == null ? "—" : `${stats.weightedSimilarityPct.toFixed(1)}%`;

  updateInstitutionComparePickerUi("a");
  updateInstitutionComparePickerUi("b");
  renderInstitutionCompareSharedTable();
  renderInstitutionCompareUniqueTable("a");
  renderInstitutionCompareUniqueTable("b");
  renderInstitutionCompareTopLists();
  renderInstitutionCompareSectors();
  setInstitutionCompareTab(institutionCompareTab);
}

function renderInstitutionComparePage() {
  const loading = document.getElementById("institution-compare-loading");
  const error = document.getElementById("institution-compare-error");
  if (loading) loading.hidden = !institutionCompareLoading;
  if (error) error.hidden = true;
  updateInstitutionComparePickerUi("a");
  updateInstitutionComparePickerUi("b");
  updateInstitutionCompareRunState();
  if (lastInstitutionComparePayload) renderInstitutionCompareSummary();
}

async function runInstitutionCompare() {
  if (
    !institutionCompareCikA ||
    !institutionCompareCikB ||
    institutionCompareCikA === institutionCompareCikB
  ) {
    return;
  }

  institutionCompareLoading = true;
  const error = document.getElementById("institution-compare-error");
  const results = document.getElementById("institution-compare-results");
  if (error) error.hidden = true;
  if (results) results.hidden = true;
  renderInstitutionComparePage();

  const params = new URLSearchParams();
  params.set("a", institutionCompareCikA);
  params.set("b", institutionCompareCikB);
  const path = `/institutions/compare?${params}`;
  if (window.location.pathname + window.location.search !== path) {
    history.replaceState({ explore: "institutions", institutionCompare: true }, "", path);
  }

  try {
    lastInstitutionComparePayload = await apiJson(
      `/api/institutions/compare?a=${encodeURIComponent(institutionCompareCikA)}&b=${encodeURIComponent(institutionCompareCikB)}`
    );
    renderInstitutionCompareSummary();
  } catch (err) {
    lastInstitutionComparePayload = null;
    if (error) {
      error.hidden = false;
      error.textContent =
        err instanceof Error
          ? err.message
          : "Failed to compare institutions. Restart the server if you recently updated the app.";
    }
  } finally {
    institutionCompareLoading = false;
    renderInstitutionComparePage();
  }
}

async function loadInstitutionComparePage() {
  await ensureInstitutionsIndex();
  const params = new URLSearchParams(window.location.search);
  const nextA = bareInstitutionCik(params.get("a") || institutionCompareCikA || "");
  const nextB = bareInstitutionCik(params.get("b") || institutionCompareCikB || "");
  const ciksChanged =
    nextA !== institutionCompareCikA ||
    nextB !== institutionCompareCikB ||
    (lastInstitutionComparePayload &&
      (bareInstitutionCik(lastInstitutionComparePayload.institutionA?.cik) !== nextA ||
        bareInstitutionCik(lastInstitutionComparePayload.institutionB?.cik) !== nextB));
  institutionCompareCikA = nextA;
  institutionCompareCikB = nextB;
  renderInstitutionComparePage();
  if (institutionCompareCikA && institutionCompareCikB && institutionCompareCikA !== institutionCompareCikB) {
    if (!lastInstitutionComparePayload || ciksChanged) await runInstitutionCompare();
    else renderInstitutionCompareSummary();
  }
}

function bindInstitutionComparePicker(side) {
  const suffix = side === "a" ? "a" : "b";
  const search = document.getElementById(`compare-institution-${suffix}-search`);
  const list = document.getElementById(`compare-institution-${suffix}-suggestions`);
  if (!search || !list) return;

  search.addEventListener("focus", () => {
    renderInstitutionCompareSuggestions(side, search.value);
  });
  search.addEventListener("input", () => {
    const cik = side === "a" ? institutionCompareCikA : institutionCompareCikB;
    if (cik) {
      if (side === "a") institutionCompareCikA = "";
      else institutionCompareCikB = "";
      updateInstitutionCompareRunState();
      const results = document.getElementById("institution-compare-results");
      if (results) results.hidden = true;
      lastInstitutionComparePayload = null;
    }
    renderInstitutionCompareSuggestions(side, search.value);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideInstitutionCompareSuggestions(side);
  });
  list.addEventListener("click", (e) => {
    const item = e.target.closest?.(".institution-compare__suggestion");
    if (!item) return;
    const cik = item.getAttribute("data-cik");
    if (cik) selectInstitutionForCompare(side, cik);
  });
}

/** Curated people ↔ 13F filer map for Institutions → Notable Investors. */
const NOTABLE_INVESTORS = [
  {
    name: "Warren Buffett",
    firm: "Berkshire Hathaway Inc",
    cik: "1067983",
    style: "Value",
    blurb: "Long-horizon compounder focused on durable businesses and capital allocation.",
  },
  {
    name: "Bill Ackman",
    firm: "Pershing Square Capital Management",
    cik: "1336528",
    style: "Activist",
    blurb: "Concentrated activist stakes with public campaigns and high-conviction bets.",
  },
  {
    name: "Carl Icahn",
    firm: "Icahn Enterprises",
    cik: "921669",
    style: "Activist",
    blurb: "Classic activist investor pushing for operational and capital-structure changes.",
  },
  {
    name: "Michael Burry",
    firm: "Scion Asset Management",
    cik: "1649339",
    style: "Deep value",
    blurb: "Contrarian value investor known for concentrated, thesis-driven portfolios.",
  },
  {
    name: "David Tepper",
    firm: "Appaloosa Management",
    cik: "1006438",
    style: "Opportunistic",
    blurb: "Macro-aware opportunistic investor with flexible equity and credit exposure.",
  },
  {
    name: "Cathie Wood",
    firm: "ARK Investment Management",
    cik: "1697748",
    style: "Disruptive growth",
    blurb: "High-conviction growth themes across innovation and technology platforms.",
  },
  {
    name: "George Soros",
    firm: "Soros Fund Management",
    cik: "1029160",
    style: "Macro",
    blurb: "Macro and event-driven capital allocation across global equity markets.",
  },
  {
    name: "Ray Dalio",
    firm: "Bridgewater Associates",
    cik: "1350694",
    style: "Macro / systematic",
    blurb: "Principles-driven macro and risk-parity style institutional investing.",
  },
  {
    name: "Jim Simons",
    firm: "Renaissance Technologies",
    cik: "1037389",
    style: "Quant",
    blurb: "Pioneer of quantitative, model-driven equity trading strategies.",
  },
  {
    name: "David Einhorn",
    firm: "Greenlight Capital",
    cik: "1079114",
    style: "Long/short value",
    blurb: "Value-oriented long/short manager with public research-driven theses.",
  },
  {
    name: "Paul Singer",
    firm: "Elliott Investment Management",
    cik: "1791786",
    style: "Activist",
    blurb: "Multi-strategy activist and event-driven investor across industries.",
  },
  {
    name: "Dan Loeb",
    firm: "Third Point",
    cik: "1040273",
    style: "Event-driven",
    blurb: "Event-driven and activist equity investing with concentrated positions.",
  },
  {
    name: "Ken Griffin",
    firm: "Citadel Advisors",
    cik: "1423053",
    style: "Multi-strategy",
    blurb: "Large multi-strategy platform spanning equities, quant, and market making.",
  },
  {
    name: "Steve Cohen",
    firm: "Point72 Asset Management",
    cik: "1603466",
    style: "Fundamental L/S",
    blurb: "Fundamental long/short equity manager with broad sector coverage.",
  },
  {
    name: "Chase Coleman",
    firm: "Tiger Global Management",
    cik: "1167483",
    style: "Growth / tech",
    blurb: "Growth-oriented public and private technology investing.",
  },
  {
    name: "Philippe Laffont",
    firm: "Coatue Management",
    cik: "1135730",
    style: "Tech growth",
    blurb: "Technology-focused growth investor across public equity markets.",
  },
  {
    name: "Larry Fink",
    firm: "BlackRock",
    cik: "2012383",
    style: "Asset manager",
    blurb: "World's largest asset manager and a core institutional ownership benchmark.",
  },
  {
    name: "Tim Buckley",
    firm: "Vanguard Group",
    cik: "102909",
    style: "Asset manager",
    blurb: "Index and low-cost investing giant and a core ownership benchmark for US equities.",
  },
  {
    name: "Ron O'Hanley",
    firm: "State Street",
    cik: "93751",
    style: "Asset manager",
    blurb: "Major ETF and institutional asset manager, including the SPDR franchise.",
  },
  {
    name: "Abigail Johnson",
    firm: "FMR LLC (Fidelity)",
    cik: "315066",
    style: "Asset manager",
    blurb: "One of the largest active and retail-oriented asset managers in the US.",
  },
  {
    name: "Robert Sharps",
    firm: "T. Rowe Price",
    cik: "80255",
    style: "Active equity",
    blurb: "Fundamental active equity manager with broad mutual-fund and institutional reach.",
  },
  {
    name: "Michael O'Grady",
    firm: "Northern Trust",
    cik: "73124",
    style: "Asset manager",
    blurb: "Large custody and asset-management franchise with significant equity ownership.",
  },
  {
    name: "Jamie Dimon",
    firm: "JPMorgan Chase",
    cik: "19617",
    style: "Asset manager",
    blurb: "Mega-bank investment platform and a major institutional equity holder.",
  },
  {
    name: "Ted Pick",
    firm: "Morgan Stanley",
    cik: "895421",
    style: "Asset manager",
    blurb: "Global wealth and investment management franchise with large public equity books.",
  },
  {
    name: "David Solomon",
    firm: "Goldman Sachs",
    cik: "886982",
    style: "Asset manager",
    blurb: "Investment bank and asset manager with broad institutional equity exposure.",
  },
  {
    name: "Sergio Ermotti",
    firm: "UBS Asset Management",
    cik: "861177",
    style: "Asset manager",
    blurb: "Global wealth and asset-management platform with significant US equity holdings.",
  },
  {
    name: "Robin Vince",
    firm: "Bank of New York Mellon",
    cik: "1390777",
    style: "Asset manager",
    blurb: "Custody and investment-management giant and a major institutional equity owner.",
  },
  {
    name: "Walt Bettinger",
    firm: "Charles Schwab Investment Management",
    cik: "884546",
    style: "Asset manager",
    blurb: "Retail brokerage-led asset manager with large index and equity fund ownership.",
  },
  {
    name: "David Shaw",
    firm: "D. E. Shaw",
    cik: "1009207",
    style: "Quant",
    blurb: "Quantitative multi-strategy firm spanning systematic and discretionary equities.",
  },
  {
    name: "John Overdeck",
    firm: "Two Sigma Investments",
    cik: "1179392",
    style: "Quant",
    blurb: "Data-driven quantitative investor across systematic equity strategies.",
  },
  {
    name: "Cliff Asness",
    firm: "AQR Capital Management",
    cik: "1167557",
    style: "Quant / factor",
    blurb: "Factor-based quantitative investing across value, momentum, and related styles.",
  },
  {
    name: "Izzy Englander",
    firm: "Millennium Management",
    cik: "1273087",
    style: "Multi-strategy",
    blurb: "Large multi-manager platform known for diversified pod-based equity trading.",
  },
  {
    name: "Dmitry Balyasny",
    firm: "Balyasny Asset Management",
    cik: "1218710",
    style: "Multi-strategy",
    blurb: "Multi-strategy hedge fund with broad fundamental and trading coverage.",
  },
  {
    name: "Paul Marshall",
    firm: "Marshall Wace",
    cik: "1318757",
    style: "Long/short equity",
    blurb: "Equity long/short manager known for research-driven and systematic alpha strategies.",
  },
  {
    name: "Daniel Sundheim",
    firm: "D1 Capital Partners",
    cik: "1747057",
    style: "Growth / tech",
    blurb: "Concentrated growth investor focused on public and private technology names.",
  },
  {
    name: "Brad Gerstner",
    firm: "Altimeter Capital",
    cik: "1541617",
    style: "Tech growth",
    blurb: "Technology-focused growth investor with high-conviction public equity stakes.",
  },
  {
    name: "Leopold Aschenbrenner",
    firm: "Situational Awareness LP",
    cik: "2045724",
    style: "AI infrastructure",
    blurb: "AI-thesis fund focused on compute, power, and infrastructure buildout around AGI timelines.",
  },
  {
    name: "Nicholas Maounis",
    firm: "Verition Fund Management",
    cik: "1454027",
    style: "Multi-strategy",
    blurb: "Multi-strategy hedge fund spanning equity, credit, and relative-value trading.",
  },
  {
    name: "Sander Gerber",
    firm: "Hudson Bay Capital",
    cik: "1393825",
    style: "Multi-strategy",
    blurb: "Event-driven and multi-strategy investor across equities and special situations.",
  },
  {
    name: "Scott Ferguson",
    firm: "Sachem Head Capital",
    cik: "1582090",
    style: "Activist",
    blurb: "Concentrated activist investor focused on operational and strategic catalysts.",
  },
];

function getFilteredNotableInvestors() {
  const q = notableInvestorsQuery.trim().toLowerCase();
  if (!q) return NOTABLE_INVESTORS;
  return NOTABLE_INVESTORS.filter((row) => {
    return (
      row.name.toLowerCase().includes(q) ||
      row.firm.toLowerCase().includes(q) ||
      row.style.toLowerCase().includes(q) ||
      bareInstitutionCik(row.cik).includes(q.replace(/^0+/, ""))
    );
  });
}

function renderNotableInvestorsPage() {
  const grid = document.getElementById("institution-notable-investors-grid");
  const empty = document.getElementById("institution-notable-investors-empty");
  const countEl = document.getElementById("institution-notable-investors-count");
  if (!grid) return;

  const rows = getFilteredNotableInvestors();
  if (countEl) {
    countEl.textContent =
      rows.length === NOTABLE_INVESTORS.length
        ? `${rows.length} investors`
        : `${rows.length} of ${NOTABLE_INVESTORS.length}`;
  }

  if (!rows.length) {
    grid.innerHTML = "";
    grid.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  grid.hidden = false;
  grid.innerHTML = rows
    .map(
      (row) => `
    <button
      type="button"
      class="notable-investor-card"
      role="listitem"
      data-institution-cik="${escapeHtml(bareInstitutionCik(row.cik))}"
      aria-label="Open ${escapeHtml(row.name)} — ${escapeHtml(row.firm)}"
    >
      <span class="notable-investor-card__name">${escapeHtml(row.name)}</span>
      <span class="notable-investor-card__firm">${escapeHtml(row.firm)}</span>
      <span class="notable-investor-card__style">${escapeHtml(row.style)}</span>
      <span class="notable-investor-card__blurb">${escapeHtml(row.blurb)}</span>
    </button>
  `
    )
    .join("");

  grid.querySelectorAll("[data-institution-cik]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cik = btn.getAttribute("data-institution-cik");
      if (cik) void openInstitution(cik, "holdings");
    });
  });
}

function setupNotableInvestorsPage() {
  if (notableInvestorsBound) return;
  notableInvestorsBound = true;

  document.getElementById("institution-notable-investors-back")?.addEventListener("click", () => {
    navigateToInstitutionDirectory();
  });
  document.getElementById("institution-hub-notable-investors-link")?.addEventListener("click", () => {
    navigateToNotableInvestors();
  });
  document.getElementById("institution-notable-investors-search")?.addEventListener("input", (e) => {
    notableInvestorsQuery = e.target.value || "";
    renderNotableInvestorsPage();
  });
}

function setupInstitutionComparePage() {
  if (institutionCompareBound) return;
  institutionCompareBound = true;

  document.getElementById("institution-compare-back")?.addEventListener("click", () => {
    navigateToInstitutionDirectory();
  });
  document.getElementById("institution-hub-compare-link")?.addEventListener("click", () => {
    navigateToInstitutionCompare();
  });
  document.getElementById("institution-compare-run")?.addEventListener("click", () => {
    void runInstitutionCompare();
  });

  bindInstitutionComparePicker("a");
  bindInstitutionComparePicker("b");

  document.addEventListener("click", (e) => {
    if (!e.target.closest?.(".institution-compare__search-wrap")) {
      hideInstitutionCompareSuggestions("a");
      hideInstitutionCompareSuggestions("b");
    }
  });

  document.getElementById("institution-compare-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-compare-tab]");
    if (!btn) return;
    setInstitutionCompareTab(btn.dataset.compareTab || "top");
  });

  document.getElementById("compare-panel-shared")?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-compare-shared-sort]");
    if (!sortBtn) return;
    const key = sortBtn.getAttribute("data-compare-shared-sort");
    if (!key) return;
    if (institutionCompareSortKey === key) {
      institutionCompareSortDir = institutionCompareSortDir === "desc" ? "asc" : "desc";
    } else {
      institutionCompareSortKey = key;
      institutionCompareSortDir =
        key === "companyName" || key === "ticker" ? "asc" : "desc";
    }
    renderInstitutionCompareSharedTable();
  });
}

async function loadInstitutionPanel(tab, cik) {
  const bare = bareInstitutionCik(cik);
  try {
    if (tab === "holdings") {
      const data = await apiJson(`/api/institutions/${bare}/holdings`, { limit: 100 });
      renderInstitutionHeader(data.meta);
      const sub = document.getElementById("institution-holdings-subtitle");
      if (sub && data.meta?.currentQuarter) sub.textContent = `${data.meta.currentQuarter} · top by reported value`;
      institutionHoldingsExpanded = false;
      renderInstitutionHoldingsTable(data.holdings, data.meta);
      return;
    }
    if (tab === "activity") {
      const data = await apiJson(`/api/institutions/${bare}/activity`, { limit: 100 });
      renderInstitutionHeader(data.meta);
      const sub = document.getElementById("institution-activity-subtitle");
      if (sub && data.meta?.currentQuarter && data.meta?.previousQuarter) {
        sub.textContent = `${data.meta.currentQuarter} vs ${data.meta.previousQuarter}`;
      }
      institutionAddsExpanded = false;
      institutionTrimsExpanded = false;
      institutionExitsExpanded = false;
      institutionNewExpanded = false;
      renderInstitutionActivityPanels(data);
      return;
    }
    if (tab === "options") {
      const data = await apiJson(`/api/institutions/${bare}/options`, { limit: 200 });
      renderInstitutionHeader(data.meta);
      institutionOptionsStocksExpanded = false;
      lastInstitutionOptionsCalls = Array.isArray(data.calls) ? data.calls : [];
      lastInstitutionOptionsPuts = Array.isArray(data.puts) ? data.puts : [];
      lastInstitutionCommonExposureUsd = Number(data.commonExposureUsd) || 0;
      lastInstitutionOptionsByStock = buildInstitutionOptionsByStock(
        lastInstitutionOptionsCalls,
        lastInstitutionOptionsPuts
      );
      if (!stockHasInstitutionalOptions(lastInstitutionOptionsCalls, lastInstitutionOptionsPuts)) {
        setInstitutionOptionsSubtitle(institutionalOptionsEmptyMessage(data.meta?.currentQuarter));
      } else {
        const optParts = ["13F call & put positions"];
        if (data.meta?.currentQuarter) optParts.push(data.meta.currentQuarter);
        if (lastInstitutionOptionsByStock.length) {
          optParts.push(`${lastInstitutionOptionsByStock.length} underlyings`);
        }
        setInstitutionOptionsSubtitle(optParts.join(" · "));
      }
      renderInstitutionOptionsTables();
      return;
    }
    if (tab === "performance") {
      const data = await apiJson("/api/institutions/performance-rankings", {
        cik: bare,
        pageSize: 1,
      });
      const row = Array.isArray(data.rankings) ? data.rankings[0] : null;
      // Header still needs institution meta from the profile endpoint.
      try {
        const metaPayload = await apiJson(`/api/institutions/${bare}`);
        renderInstitutionHeader(metaPayload.meta || metaPayload);
      } catch {
        /* rankings row still renders without header refresh */
      }
      const sub = document.getElementById("institution-performance-subtitle");
      const methodEl = document.getElementById("institution-performance-methodology");
      if (sub) {
        const q = row?.quarter || data.asOfQuarter;
        sub.textContent = q
          ? `${q} · reported 13F portfolio value changes`
          : "Reported 13F portfolio value changes";
      }
      if (methodEl) {
        methodEl.textContent =
          data.disclaimer ||
          "This reflects changes in the reported value of the institution's disclosed 13F portfolio between filing periods. It is not the institution's actual investment return.";
      }
      if (!row) {
        renderInstitutionPerformanceSummary(null);
        renderInstitutionPerformanceTable([]);
        const body = document.getElementById("institution-performance-body");
        if (body) {
          body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">No reported 13F portfolio value history for this institution (or they have not filed for the latest quarter yet).</td></tr>`;
        }
        return;
      }
      renderInstitutionPerformanceSummary(row);
      renderInstitutionPerformanceTable(row.history);
      return;
    }
    if (tab === "history") {
      const data = await apiJson(`/api/institutions/${bare}/history`, { limit: 40 });
      renderInstitutionHeader(data.meta);
      renderInstitutionHistoryTable(data.filings);
    }
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (tab === "holdings") {
      const body = document.getElementById("institution-holdings-body");
      if (body) body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
      const powerbar = document.getElementById("institution-holdings-powerbar");
      if (powerbar) powerbar.hidden = true;
      lastInstitutionHoldings = [];
      institutionHoldingsExpanded = false;
      const holdingsFoot = document.getElementById("institution-holdings-foot");
      if (holdingsFoot) holdingsFoot.hidden = true;
    } else if (tab === "activity") {
      institutionAddsExpanded = false;
      institutionTrimsExpanded = false;
      institutionExitsExpanded = false;
      institutionNewExpanded = false;
      lastInstitutionAdds = [];
      lastInstitutionTrims = [];
      lastInstitutionExits = [];
      lastInstitutionNewPositions = [];
      const empty = `<tr><td colspan="6" class="trades-table__empty">${msg}</td></tr>`;
      const emptyNew = `<tr><td colspan="4" class="trades-table__empty">${msg}</td></tr>`;
      const emptyExits = `<tr><td colspan="4" class="trades-table__empty">${msg}</td></tr>`;
      for (const id of ["institution-adds-body", "institution-trims-body", "institution-activity-body"]) {
        const body = document.getElementById(id);
        if (body) body.innerHTML = empty;
      }
      const exitsBody = document.getElementById("institution-exits-body");
      if (exitsBody) exitsBody.innerHTML = emptyExits;
      const newBody = document.getElementById("institution-new-body");
      if (newBody) newBody.innerHTML = emptyNew;
    } else if (tab === "options") {
      institutionOptionsStocksExpanded = false;
      lastInstitutionOptionsCalls = [];
      lastInstitutionOptionsPuts = [];
      lastInstitutionOptionsByStock = [];
      lastInstitutionCommonExposureUsd = 0;
      const biasBody = document.getElementById("institution-options-bias-body");
      const weightedBody = document.getElementById("institution-weighted-bias-body");
      const stocksBody = document.getElementById("institution-options-stocks-body");
      const emptyBias = `<tr><td colspan="2" class="options-bias-table__empty">${msg}</td></tr>`;
      const emptyStocks = `<tr><td colspan="7" class="trades-table__empty">${msg}</td></tr>`;
      if (biasBody) biasBody.innerHTML = emptyBias;
      if (weightedBody) weightedBody.innerHTML = emptyBias;
      if (stocksBody) stocksBody.innerHTML = emptyStocks;
      const foot = document.getElementById("institution-options-stocks-foot");
      if (foot) foot.hidden = true;
      setInstitutionOptionsSubtitle("Institutional options (error)");
    } else if (tab === "performance") {
      const summary = document.getElementById("institution-performance-summary");
      if (summary) summary.hidden = true;
      const body = document.getElementById("institution-performance-body");
      if (body) body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">${msg}</td></tr>`;
    } else if (tab === "history") {
      const body = document.getElementById("institution-history-body");
      if (body) body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">${msg}</td></tr>`;
    }
  }
}

async function openInstitution(cik, tab = "holdings") {
  await ensureInstitutionsIndex();
  activeInstitutionCik = bareInstitutionCik(cik);
  activeInstitutionHubView = "directory";
  setExploreMode("institutions", { navigate: false });
  setInstitutionTab(tab, { updateUrl: true });
  const input = document.getElementById("top-search-input");
  const fund = trackedInstitutions.find((f) => bareInstitutionCik(f.cik) === activeInstitutionCik);
  if (input && fund?.name) input.value = fund.name;
  closeTopSearch();
}

async function openInstitutionFromRoute(route) {
  await ensureInstitutionsIndex();
  setExploreMode("institutions", { navigate: false });
  if (route.performanceRankings) {
    activeInstitutionCik = null;
    activeInstitutionHubView = "performance";
    if (window.location.pathname === "/institutions/proxy-performance") {
      history.replaceState(
        { explore: "institutions", performanceRankings: true },
        "",
        "/institutions/performance"
      );
    }
    updateInstitutionsView();
    return;
  }
  if (route.mostAccumulated) {
    activeInstitutionCik = null;
    activeInstitutionHubView = "most-accumulated";
    updateInstitutionsView();
    return;
  }
  if (route.newPositions) {
    activeInstitutionCik = null;
    activeInstitutionHubView = "new-positions";
    updateInstitutionsView();
    return;
  }
  if (route.completelySold) {
    activeInstitutionCik = null;
    activeInstitutionHubView = "completely-sold";
    updateInstitutionsView();
    return;
  }
  if (route.institutionCompare) {
    activeInstitutionCik = null;
    activeInstitutionHubView = "compare";
    const params = new URLSearchParams(window.location.search);
    institutionCompareCikA = bareInstitutionCik(params.get("a") || "");
    institutionCompareCikB = bareInstitutionCik(params.get("b") || "");
    updateInstitutionsView();
    return;
  }
  if (route.notableInvestors) {
    activeInstitutionCik = null;
    activeInstitutionHubView = "notable-investors";
    updateInstitutionsView();
    return;
  }
  if (route.hub) {
    activeInstitutionCik = null;
    activeInstitutionHubView = "directory";
    updateInstitutionsView();
    return;
  }
  activeInstitutionHubView = "directory";
  await openInstitution(route.cik, route.tab);
}

function searchInstitutions(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return trackedInstitutions
    .filter((f) => {
      const name = String(f.name || "").toLowerCase();
      const cik = bareInstitutionCik(f.cik);
      return name.includes(q) || cik.includes(q.replace(/^0+/, ""));
    })
    .slice(0, 25);
}

function updateStockTabsVisibility(visible) {
  const nav = document.getElementById("stock-tabs");
  if (nav) nav.hidden = !visible;
}

function setStockTab(tab, { updateUrl = true } = {}) {
  if (!STOCK_TABS.includes(tab)) tab = "overview";
  if (tab !== "overview" && chartFullscreenOpen) setChartFullscreen(false);
  activeStockTab = tab;
  document.querySelectorAll(".stock-tabs__btn").forEach((btn) => {
    const on = btn.dataset.stockTab === tab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", String(on));
  });
  updateStocksView();
  const stock = getDisplayStock();
  if (updateUrl && stock?.symbol) {
    const path = stockPath(stock.symbol, tab);
    if (window.location.pathname !== path) {
      history.pushState({ symbol: stock.symbol, stockTab: tab }, "", path);
    }
  }
  if (tab === "activity" && stock?.symbol) {
    void loadActivityPanel(stock.symbol);
    void loadOptionsPanel(stock.symbol);
  }
  if (tab === "insider-activity" && stock?.symbol) {
    void loadInsiderActivityPanel(stock.symbol);
  }
  if (tab === "congress-activity" && stock?.symbol) {
    void loadCongressActivityPanel(stock.symbol);
  }
  if (tab === "signals" && stock?.symbol) {
    void loadSignalsPanel(stock.symbol);
  }
  if (tab === "ownership" && lastOwnershipHolders.length) renderOwnershipTable();
  if (tab === "sec-filings") {
    renderSecFilingsTable();
    renderSecFilingsFundamentalsExtras(lastFilingsFundamentals);
  }
  if (tab === "filings-fundamentals" && stock?.symbol) {
    void loadFilingsFundamentalsPanel(stock.symbol);
  }
  if (tab === "overview" && chartInstance) resizeChart();
}

function syncStockUrl(symbol) {
  if (!symbol) {
    if (window.location.pathname.startsWith("/stock/")) {
      history.replaceState(null, "", "/stocks");
    }
    return;
  }
  const path = stockPath(symbol, activeStockTab);
  if (window.location.pathname !== path) {
    history.pushState({ symbol, stockTab: activeStockTab }, "", path);
  }
}

function makePreviewStockStub(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  return {
    symbol: sym,
    name: sym,
    price: null,
    changePct: 0,
    currency: "USD",
    exchange: "",
    notifications: [],
    signals: [],
    latestActivity: null,
  };
}

async function openStockFromRoute(route) {
  const sym = normalizeSymbol(route.symbol);
  if (!sym) return;
  setViewingSymbol(sym);
  const idx = watchlist.findIndex((w) => normalizeSymbol(w.symbol) === sym);
  closeStocksOverlays();
  setStockTab(route.tab, { updateUrl: false });
  if (idx >= 0) {
    previewStock = null;
    activeIndex = idx;
    activeCurrency = watchlist[idx].currency || "USD";
    resetStockPanelUi(sym);
    renderWatchlist();
    renderHeader();
    await loadActiveSymbolPanels(sym);
    return;
  }
  previewStock = makePreviewStockStub(sym);
  activeIndex = -1;
  resetStockPanelUi(sym);
  renderWatchlist();
  renderHeader();
  setDashboardStatus(`Loading ${sym}…`);
  try {
    const entry = await fetchWatchlistEntry(sym);
    if (getViewingSymbol() !== sym) return;
    previewStock = entry;
    renderHeader();
    await loadActiveSymbolPanels(sym);
    setDashboardStatus("");
  } catch (err) {
    setDashboardStatus(err instanceof Error ? err.message : String(err), true);
  }
}

function setActivitySubtitle(text) {
  const el = document.getElementById("activity-subtitle");
  if (el) el.textContent = text;
}

function setInsiderActivitySubtitle(text) {
  const el = document.getElementById("insider-activity-subtitle");
  if (el) el.textContent = text;
}

const INSIDER_TX_CODE_LABELS = {
  P: "Open market purchase",
  S: "Open market sale",
  A: "Grant / award",
  C: "Conversion of derivative",
  D: "Disposition to issuer",
  E: "Expiration of short derivative",
  F: "Tax withholding",
  G: "Gift",
  H: "Expiration of long derivative",
  I: "Discretionary transaction",
  J: "Other acquisition or disposition",
  K: "Equity swap or similar",
  L: "Small acquisition",
  M: "Option / derivative exercise",
  U: "Tender of shares",
  W: "Acquisition or disposition by will",
  X: "In-the-money derivative exercise",
  Z: "Voting trust deposit or withdrawal",
};

let lastInsiderTransactions = [];
let insiderSignalFilter = "high";

function formatInsiderTxCode(code) {
  const c = String(code ?? "").trim().toUpperCase();
  if (!c) return "—";
  return INSIDER_TX_CODE_LABELS[c] || `Code ${c}`;
}

function insiderActivityShowsSignal() {
  return insiderSignalFilter === "all" || insiderSignalFilter === "low";
}

function insiderActivityColspan() {
  return insiderActivityShowsSignal() ? 8 : 7;
}

function syncInsiderSignalColumn() {
  const th = document.getElementById("insider-activity-signal-col");
  if (th) th.hidden = !insiderActivityShowsSignal();
}

function renderInsiderSignalCell(isHighSignal, code) {
  const high = Boolean(isHighSignal);
  const label = high ? "High" : "Low";
  const tone = high ? "up" : "neutral";
  const title = `${formatInsiderTxCode(code)} (${String(code || "").toUpperCase()})`;
  return `<span class="change-pill change-pill--${tone}" title="${escapeHtml(title)}">${label}</span>`;
}

function formatInsiderPricePerShare(price) {
  const x = Number(price);
  if (!Number.isFinite(x) || x <= 0) return "—";
  return formatPrice(x, lastOwnershipCurrency);
}

function insiderRowHighlightClass(transactionCode) {
  const code = String(transactionCode ?? "").trim().toUpperCase();
  if (code === "P") return "insider-row--buy";
  if (code === "S") return "insider-row--sell";
  return "";
}

function renderInsiderTransactionRow(row) {
  const code = String(row.transactionCode || "").trim().toUpperCase();
  const codeLabel = formatInsiderTxCode(code);
  const rowClass = insiderRowHighlightClass(code);
  const signalCell = insiderActivityShowsSignal()
    ? `<td>${renderInsiderSignalCell(row.isHighSignal, code)}</td>`
    : "";
  return `
    <tr${rowClass ? ` class="${rowClass}"` : ""}>
      <td><span class="ownership-fund__name">${escapeHtml(row.insiderName)}</span></td>
      <td>${escapeHtml(row.insiderTitle || "—")}</td>
      <td title="${escapeHtml(code || "—")}">${escapeHtml(codeLabel)}</td>
      ${signalCell}
      <td class="mono num">${escapeHtml(formatShareCount(row.shares))}</td>
      <td class="mono num">${escapeHtml(formatInsiderPricePerShare(row.pricePerShare))}</td>
      <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.transactionValue, lastOwnershipCurrency))}</td>
      <td class="mono">${escapeHtml(row.transactionDate || row.filingDate || "—")}</td>
    </tr>
  `;
}

function renderInsiderActivityTable() {
  const body = document.getElementById("insider-activity-body");
  if (!body) return;
  syncInsiderSignalColumn();

  let rows = lastInsiderTransactions;
  if (insiderSignalFilter === "high") rows = rows.filter((r) => r.isHighSignal);
  if (insiderSignalFilter === "low") rows = rows.filter((r) => !r.isHighSignal);

  if (!rows.length) {
    body.innerHTML =
      `<tr><td colspan="${insiderActivityColspan()}" class="trades-table__empty">No insider transactions match this filter. Run <code class="inline-code">npm run db:ingest-insider-form4 -- TICKER</code> to load Form 4 data.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(renderInsiderTransactionRow).join("");
}

async function loadInsiderActivityPanel(symbol) {
  const body = document.getElementById("insider-activity-body");
  if (!body) return;
  body.innerHTML =
    `<tr><td colspan="${insiderActivityColspan()}" class="trades-table__empty">Loading insider activity…</td></tr>`;
  setInsiderActivitySubtitle("Loading…");
  try {
    const sym = encodeURIComponent(symbol);
    const res = await apiJson(`/api/stocks/${sym}/insider-transactions`, {
      limit: 150,
      sort: "date",
    });
    lastInsiderTransactions = Array.isArray(res?.transactions) ? res.transactions : [];
    const meta = res?.meta || {};
    const parts = ["SEC Form 4"];
    if (meta.cik) parts.push(`CIK ${meta.cik}`);
    if (meta.highSignalCount != null) {
      parts.push(`${meta.highSignalCount} open-market · ${meta.lowSignalCount} admin`);
    }
    setInsiderActivitySubtitle(parts.join(" · "));
    renderInsiderActivityTable();
    void loadStockInsiderCluster(symbol);
  } catch (err) {
    lastInsiderTransactions = [];
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    body.innerHTML = `<tr><td colspan="${insiderActivityColspan()}" class="trades-table__empty">${msg}</td></tr>`;
    setInsiderActivitySubtitle("Insider activity (error)");
  }
}

function setCongressActivitySubtitle(_text) {
  const el = document.getElementById("congress-activity-subtitle");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

let lastCongressTrades = [];

function renderCongressActivityRow(trade) {
  const key = trade.politicianKey || politicianKey(trade.politicianName);
  const catClass = politicianTradeCategoryClass(trade.transactionCategory);
  const filingLink = trade.sourceUrl
    ? `<a href="${escapeHtml(trade.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="fundamentals-grid__link">Filing</a>`
    : "—";
  return `<tr class="politicians-hub__trade-row ${catClass}">
    <td><a href="${politicianPath(key)}" class="politicians-name-link" data-politician-key="${escapeHtml(key)}">${escapeHtml(trade.politicianName)}</a></td>
    <td><span class="politicians-hub__chamber-badge politicians-hub__chamber-badge--inline">${escapeHtml(politicianChamberLabel(trade.chamber))}</span></td>
    <td>${escapeHtml(formatPoliticianTradeDate(trade.transactionDate || trade.notificationDate))}</td>
    <td class="num">${escapeHtml(trade.amountRange || "—")}</td>
    <td>${filingLink}</td>
  </tr>`;
}

function renderCongressActivityTable() {
  const body = document.getElementById("congress-activity-body");
  if (!body) return;

  if (!lastCongressTrades.length) {
    body.innerHTML =
      '<tr><td colspan="5" class="trades-table__empty">No congressional purchases found for this stock. Run <code class="inline-code">npm run politicians:fetch-recent</code> to refresh PTR data.</td></tr>';
    return;
  }
  body.innerHTML = lastCongressTrades.map(renderCongressActivityRow).join("");
}

async function loadCongressActivityPanel(symbol) {
  const body = document.getElementById("congress-activity-body");
  if (!body) return;
  body.innerHTML =
    '<tr><td colspan="5" class="trades-table__empty">Loading congress activity…</td></tr>';
  setCongressActivitySubtitle("Loading…");
  try {
    const sym = encodeURIComponent(symbol);
    const res = await apiJson(`/api/stocks/${sym}/congress-activity`);
    lastCongressTrades = Array.isArray(res?.trades) ? res.trades : [];
    const meta = res?.meta || {};
    const parts = ["Politician purchases (PTR)"];
    if (meta.count != null) parts.push(`${meta.count} buy${meta.count === 1 ? "" : "s"}`);
    setCongressActivitySubtitle(parts.join(" · "));
    renderCongressActivityTable();
  } catch (err) {
    lastCongressTrades = [];
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    setCongressActivitySubtitle("Congress activity (error)");
  }
}

let signalsSymbol = null;

const SIGNAL_CATEGORY_LABELS = {
  institutional: "Institutional",
  insider: "Insider",
  politician: "Politicians",
  "smart-money": "Smart Money",
  "double-signal": "Double Signal",
  "triple-signal": "Triple Signal",
  "top-institution-entry": "Top Institution Entry",
  "hidden-gem": "Hidden Gems",
  "conflict-signal": "Conflict Signal",
  "institutional-discovery": "Institutional Discovery",
  "conviction-score": "Conviction Score",
};

const SIGNAL_CATEGORY_HINTS = {
  institutional: "13F holdings change (latest quarter vs prior)",
  insider: "Form 4 open-market buys vs sells",
  politician: "Congressional buys vs sells (PTR)",
};

function setSignalsSubtitle(_text) {
  const el = document.getElementById("signals-subtitle");
  if (el) {
    el.textContent = "";
    el.hidden = true;
  }
}

function formatSignalValue(value) {
  const x = Number(value);
  if (!Number.isFinite(x) || x === 0) return "$0";
  const sign = x < 0 ? "−" : "";
  return `${sign}${formatSecFundamentalValue(Math.abs(x))}`;
}

function formatSignalStatValue(value, numeric) {
  const x = Number(value);
  if (!Number.isFinite(x)) return "—";
  if (numeric) return x % 1 === 0 ? String(x) : x.toFixed(2);
  return formatSignalValue(x);
}

function renderSignalCard(signal) {
  const category = SIGNAL_CATEGORY_LABELS[signal.category] || signal.category;
  const hint = signal.hint || SIGNAL_CATEGORY_HINTS[signal.category] || "";
  const statLabels = signal.statLabels || { buy: "Buying", sell: "Selling", net: "Net" };
  const numericStats = Boolean(signal.statValuesAreNumeric);
  const dirClass =
    signal.direction === "buying"
      ? "signal-card--buy"
      : signal.direction === "selling"
        ? "signal-card--sell"
        : "signal-card--neutral";
  const strongClass = signal.strength === "high" ? "signal-card--strong" : "";
  const ratioText =
    signal.ratio != null && Number.isFinite(signal.ratio)
      ? `${Number(signal.ratio).toFixed(1)}× ${signal.direction === "selling" ? "sell vs buy" : "buy vs sell"}`
      : "";
  const hubLink = signal.href
    ? `<a href="${escapeHtml(signal.href)}" class="signal-card__hub-link fundamentals-grid__link" data-signal-hub-link="${escapeHtml(signal.href)}">View signal hub →</a>`
    : "";
  return `<article class="signal-card ${dirClass} ${strongClass}">
    <div class="signal-card__head">
      <span class="signal-card__category">${escapeHtml(category)}</span>
      ${signal.strength === "high" ? '<span class="signal-card__badge">HIGH</span>' : ""}
    </div>
    <div class="signal-card__label">${escapeHtml(signal.label)}</div>
    <div class="signal-card__stats">
      <div class="signal-card__stat">
        <span class="signal-card__stat-label">${escapeHtml(statLabels.buy)}</span>
        <span class="signal-card__stat-value mono">${formatSignalStatValue(signal.buyValueUsd, numericStats)}</span>
      </div>
      <div class="signal-card__stat">
        <span class="signal-card__stat-label">${escapeHtml(statLabels.sell)}</span>
        <span class="signal-card__stat-value mono">${formatSignalStatValue(signal.sellValueUsd, numericStats)}</span>
      </div>
      <div class="signal-card__stat">
        <span class="signal-card__stat-label">${escapeHtml(statLabels.net)}</span>
        <span class="signal-card__stat-value mono">${formatSignalStatValue(signal.netValueUsd, numericStats)}</span>
      </div>
    </div>
    ${ratioText ? `<div class="signal-card__ratio">${escapeHtml(ratioText)}</div>` : ""}
    ${hint ? `<div class="signal-card__hint muted small">${escapeHtml(hint)}</div>` : ""}
    ${hubLink}
  </article>`;
}

function renderSignalsPanel(data, errMsg) {
  const grid = document.getElementById("signals-grid");
  if (!grid) return;
  if (errMsg) {
    grid.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(errMsg)}</p>`;
    return;
  }
  if (!data) {
    grid.innerHTML = '<p class="fundamentals-grid__empty">Select a stock to compute signals.</p>';
    return;
  }
  const signals = Array.isArray(data.signals) ? data.signals : [];
  if (!signals.length) {
    grid.innerHTML = '<p class="fundamentals-grid__empty">No signal data available for this stock.</p>';
    return;
  }

  const bullish = signals.filter((s) => s.direction === "buying");
  const bearish = signals.filter((s) => s.direction === "selling");
  const neutral = signals.filter((s) => s.direction !== "buying" && s.direction !== "selling");

  const sections = [];
  if (bullish.length) {
    sections.push(`<div class="signals-section signals-section--bullish">
      <h3 class="signals-section__title signals-section__title--bullish">Bullish Signals</h3>
      <div class="signals-section__grid">${bullish.map(renderSignalCard).join("")}</div>
    </div>`);
  }
  if (neutral.length) {
    sections.push(`<div class="signals-section signals-section--neutral">
      <h3 class="signals-section__title">Neutral Signals</h3>
      <div class="signals-section__grid">${neutral.map(renderSignalCard).join("")}</div>
    </div>`);
  }
  if (bearish.length) {
    sections.push(`<div class="signals-section signals-section--bearish">
      <h3 class="signals-section__title signals-section__title--bearish">Bearish Signals</h3>
      <div class="signals-section__grid">${bearish.map(renderSignalCard).join("")}</div>
    </div>`);
  }

  grid.innerHTML = sections.join("");
}

async function fetchStockSignals(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) throw new Error("Missing symbol");
  const u = new URL(`/api/stocks/${encodeURIComponent(sym)}/signals`, window.location.origin);
  const res = await fetch(u, { cache: "no-store" });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body.message || body.error || text || res.statusText;
    throw new Error(typeof msg === "string" ? msg : res.statusText);
  }
  return body;
}

async function loadSignalsPanel(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return;
  signalsSymbol = sym;
  const grid = document.getElementById("signals-grid");
  if (grid) grid.innerHTML = '<p class="fundamentals-grid__empty">Computing signals…</p>';
  renderCategoryScoresPanel(lastSecFilingsForScores);
  setSignalsSubtitle("Computing signals…");
  try {
    const data = await fetchStockSignals(sym);
    if (signalsSymbol !== sym) return;
    renderSignalsPanel(data);
    const when = data?.computedAt ? new Date(data.computedAt) : null;
    const stamp = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : "";
    setSignalsSubtitle(
      stamp
        ? `Institutional, insider & congressional flow · computed ${stamp}`
        : "Institutional, insider & congressional flow"
    );
  } catch (err) {
    if (signalsSymbol !== sym) return;
    renderSignalsPanel(null, err instanceof Error ? err.message : String(err));
    setSignalsSubtitle("Signals (error)");
  }
}

function renderPulseStockRow(stock) {
  const sym = escapeHtml(stock.symbol);
  const name = escapeHtml(stock.name || stock.symbol);
  return `
    <li>
      <button type="button" class="pulse-row" data-market-symbol="${sym}">
        <span class="pulse-row__main">
          <span class="pulse-row__sym">${sym}</span>
          <span class="pulse-row__name">${name}</span>
        </span>
        <span class="pulse-row__quote">
          <span class="pulse-row__price">${escapeHtml(formatInteger(stock.institutionsBuying ?? 0))}</span>
          <span class="pulse-row__meta">buyers</span>
        </span>
        <span class="pulse-row__arrow" aria-hidden="true">→</span>
      </button>
    </li>`;
}

function formatPulseActivityDate(dateRaw) {
  const key = String(dateRaw || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Symbol + company name only (no Yahoo price). Optional filing date on the right. */
function renderPulseActivityRow(stock) {
  const sym = escapeHtml(stock.symbol);
  const name = escapeHtml(stock.name || stock.symbol);
  const when = formatPulseActivityDate(stock.filingDate);
  return `
    <li>
      <button type="button" class="pulse-row pulse-row--activity" data-market-symbol="${sym}">
        <span class="pulse-row__main">
          <span class="pulse-row__sym">${sym}</span>
          <span class="pulse-row__name">${name}</span>
        </span>
        <span class="pulse-row__quote">
          ${when ? `<span class="pulse-row__meta">${escapeHtml(when)}</span>` : ""}
        </span>
        <span class="pulse-row__arrow" aria-hidden="true">→</span>
      </button>
    </li>`;
}

function renderPulseDiscoveryRow(stock) {
  const sym = escapeHtml(stock.symbol);
  const name = escapeHtml(stock.name || stock.symbol);
  const signalType = escapeHtml(stock.signalType || "Signal");
  return `
    <li>
      <button type="button" class="pulse-row pulse-row--discovery" data-market-symbol="${sym}">
        <span class="pulse-row__main">
          <span class="pulse-row__sym">${sym}</span>
          <span class="pulse-row__name">${name}</span>
        </span>
        <span class="pulse-row__quote">
          <span class="pulse-row__meta">${signalType}</span>
        </span>
        <span class="pulse-row__arrow" aria-hidden="true">→</span>
      </button>
    </li>`;
}

function pickPulseDiscoveryMix(payloads) {
  const seen = new Set();
  const out = [];

  const mapTicker = (row, signalType) => ({
    symbol: String(row?.ticker || "")
      .trim()
      .toUpperCase(),
    name: row?.companyName || row?.ticker,
    signalType,
  });

  const sources = [
    { rows: payloads?.double?.signals, signalType: "Double Signal", count: 1 },
    { rows: payloads?.triple?.signals, signalType: "Triple Signal", count: 1 },
    { rows: payloads?.conflict?.signals, signalType: "Conflict Signal", count: 1 },
    { rows: payloads?.gems?.signals, signalType: "Hidden Gem", count: 1 },
    { rows: payloads?.discovery?.signals, signalType: "Institutional Discovery", count: 1 },
  ];

  const pushFrom = (rows, count, signalType) => {
    let added = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (added >= count) break;
      const mapped = mapTicker(row, signalType);
      if (!mapped.symbol || seen.has(mapped.symbol)) continue;
      // Skip insufficient / unscored discovery rows when possible.
      if (
        signalType === "Institutional Discovery" &&
        (row?.insufficientData || row?.discoveryScore == null)
      ) {
        continue;
      }
      seen.add(mapped.symbol);
      out.push(mapped);
      added += 1;
    }
  };

  for (const source of sources) {
    pushFrom(source.rows, source.count, source.signalType);
  }

  // Backfill from the same priority order if a source was empty.
  if (out.length < PULSE_PREVIEW_LIMIT) {
    for (const source of sources) {
      if (out.length >= PULSE_PREVIEW_LIMIT) break;
      pushFrom(source.rows, PULSE_PREVIEW_LIMIT - out.length, source.signalType);
    }
  }

  return out.slice(0, PULSE_PREVIEW_LIMIT);
}

async function refreshPulseDiscoveriesSidebar() {
  const list = document.getElementById("pulse-discoveries-preview");
  if (!list) return;
  try {
    const [doublePayload, triplePayload, conflictPayload, gemsPayload, discoveryPayload] =
      await Promise.all([
        apiJson("/api/signals/double-signal", { window: 90 }),
        apiJson("/api/signals/triple-signal", { window: 180 }),
        apiJson("/api/signals/conflict-signals", {
          page: 1,
          pageSize: 10,
          sort: "conflictScore",
          sortDir: "desc",
        }),
        apiJson("/api/signals/hidden-gems", {
          page: 1,
          pageSize: 10,
          sort: "hiddenGemScore",
          sortDir: "desc",
        }),
        apiJson("/api/signals/institutional-discovery", {
          page: 1,
          pageSize: 10,
          sort: "discoveryScore",
          sortDir: "desc",
          minScore: 50,
        }),
      ]);
    const mixed = pickPulseDiscoveryMix({
      double: doublePayload,
      triple: triplePayload,
      conflict: conflictPayload,
      gems: gemsPayload,
      discovery: discoveryPayload,
    });
    if (!mixed.length) {
      list.innerHTML = pulseEmptyHtml("No signal discoveries yet");
      return;
    }
    list.innerHTML = mixed.map((stock) => renderPulseDiscoveryRow(stock)).join("");
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    list.innerHTML = pulseEmptyHtml(msg);
  }
}

function isPulseBuyAction(action) {
  const a = String(action || "").trim().toLowerCase();
  // Insider open-market buys only ("Bought shares"); politician purchases separately.
  return a === "bought shares" || a === "disclosed a purchase";
}

/** Newest unique tickers with buy activity from Recently Active day groups. */
function pickPulseBuyStocksFromDays(days, limit = PULSE_PREVIEW_LIMIT) {
  const seen = new Set();
  const out = [];
  for (const day of Array.isArray(days) ? days : []) {
    for (const stock of day.stocks || []) {
      const ticker = String(stock.ticker || "")
        .trim()
        .toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      const items = Array.isArray(stock.items) ? stock.items : [];
      if (!items.some((item) => isPulseBuyAction(item.action))) continue;
      seen.add(ticker);
      out.push({
        symbol: ticker,
        name: stock.companyName || ticker,
        filingDate: stock.filingDate || day.date || null,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function renderPulseActivityPreview(listId, stocks, emptyLabel) {
  const list = document.getElementById(listId);
  if (!list) return;
  const preview = Array.isArray(stocks) ? stocks.slice(0, PULSE_PREVIEW_LIMIT) : [];
  if (!preview.length) {
    list.innerHTML = pulseEmptyHtml(emptyLabel);
    return;
  }
  list.innerHTML = preview.map((stock) => renderPulseActivityRow(stock)).join("");
}

async function refreshPulseActivitySidebar() {
  const insiderList = document.getElementById("market-movers-gainers-preview");
  const politicianList = document.getElementById("market-movers-losers-preview");
  try {
    const [insiderPayload, politicianPayload] = await Promise.all([
      apiJson("/api/stocks/recently-active", { source: "insider" }),
      apiJson("/api/stocks/recently-active", { source: "politician" }),
    ]);
    renderPulseActivityPreview(
      "market-movers-gainers-preview",
      pickPulseBuyStocksFromDays(insiderPayload?.days),
      "No recent insider buys"
    );
    renderPulseActivityPreview(
      "market-movers-losers-preview",
      pickPulseBuyStocksFromDays(politicianPayload?.days),
      "No recent politician buys"
    );
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (insiderList) insiderList.innerHTML = pulseEmptyHtml(msg);
    if (politicianList) politicianList.innerHTML = pulseEmptyHtml(msg);
  }
}

async function refreshPulseAccumulatedSidebar() {
  const list = document.getElementById("market-movers-volume-preview");
  if (!list) return;
  try {
    const data = await apiJson("/api/institutions/most-accumulated", { period: "quarter" });
    const stocks = Array.isArray(data?.stocks)
      ? data.stocks
      : Array.isArray(data?.periods?.quarter?.stocks)
        ? data.periods.quarter.stocks
        : [];
    const preview = stocks.slice(0, PULSE_PREVIEW_LIMIT).map((row) => ({
      symbol: row.ticker,
      name: row.companyName || row.ticker,
      institutionsBuying: row.institutionsBuying,
    }));
    if (!preview.length) {
      list.innerHTML = pulseEmptyHtml(
        data?.unavailableReason || "No institutional accumulation data"
      );
      return;
    }
    list.innerHTML = preview.map((stock) => renderPulseStockRow(stock)).join("");
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    list.innerHTML = pulseEmptyHtml(msg);
  }
}

function setupMarketPulseSidebar() {
  setupMarketPulseTabs();

  document.getElementById("pulse-activity-view-all")?.addEventListener("click", (e) => {
    e.preventDefault();
    setExploreMode("stocks", { navigate: false });
    navigateToStocksRecentlyActive();
  });

  document.getElementById("pulse-accumulated-view-all")?.addEventListener("click", (e) => {
    e.preventDefault();
    setExploreMode("institutions", { navigate: false });
    navigateToInstitutionMostAccumulated();
  });

  document.getElementById("pulse-discoveries-view-all")?.addEventListener("click", (e) => {
    e.preventDefault();
    setExploreMode("signals", { navigate: false });
    navigateToDoubleSignal(null);
  });

  document.getElementById("market-pulse-section")?.addEventListener("click", (e) => {
    const marketBtn = e.target.closest?.("[data-market-symbol]");
    if (marketBtn) {
      const sym = marketBtn.getAttribute("data-market-symbol");
      if (sym) void openStockPreview(sym);
    }
  });
}

function setupInsiderFilters() {
  document.querySelectorAll(".insider-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      const signal = btn.dataset.insiderSignal || "all";
      insiderSignalFilter = signal;
      document.querySelectorAll(".insider-filter").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.insiderSignal === signal);
      });
      renderInsiderActivityTable();
    });
  });
}

function formatSharesDelta(delta) {
  const x = Number(delta);
  if (!Number.isFinite(x)) return "—";
  const sign = x >= 0 ? "+" : "−";
  return `${sign}${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function enrichActivityMovers(rows) {
  const px = resolveOwnershipStockPrice();
  return rows.map((r) => {
    let valueChangeUsd = r.valueChangeUsd ?? null;
    const prevSh = Number(r.previousShares);
    const curSh = Number(r.currentShares);
    if (px != null && Number.isFinite(prevSh) && Number.isFinite(curSh)) {
      valueChangeUsd = Math.round((curSh - prevSh) * px * 100) / 100;
    }
    return { ...r, valueChangeUsd };
  });
}

function buildActivityMoversFromChanges(changesRes) {
  const movers = [];
  for (const row of changesRes?.changes || []) {
    if (!row?.fundName) continue;
    const sc = Number(row.sharesChange);
    if (!Number.isFinite(sc) || sc === 0) continue;
    movers.push({
      fundName: row.fundName,
      filerCik: row.filerCik,
      sharesChange: sc,
      currentShares: Number(row.currentShares),
      previousShares: Number(row.previousShares),
      valueChangeUsd: row.valueChangeUsd ?? null,
    });
  }
  return movers;
}

function buildActivityNewPositions(newRes) {
  const px = resolveOwnershipStockPrice();
  const rows = [];
  for (const row of newRes?.positions || []) {
    if (!row?.fundName) continue;
    const shares = Number(row.shares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    let valueUsd = row.valueUsd ?? null;
    if (px != null) valueUsd = Math.round(shares * px * 100) / 100;
    rows.push({
      fundName: row.fundName,
      filerCik: row.filerCik,
      shares,
      valueUsd,
    });
  }
  return rows.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
}

function buildActivityExits(soldRes) {
  const px = resolveOwnershipStockPrice();
  const rows = [];
  for (const row of soldRes?.positions || []) {
    if (!row?.fundName) continue;
    const previousShares = Number(row.previousShares ?? 0);
    if (!Number.isFinite(previousShares) || previousShares <= 0) continue;
    let previousValueUsd = row.previousValueUsd ?? null;
    if (px != null) previousValueUsd = Math.round(previousShares * px * 100) / 100;
    rows.push({
      fundName: row.fundName,
      filerCik: row.filerCik,
      shares: 0,
      previousShares,
      valueUsd: null,
      previousValueUsd,
    });
  }
  return rows.sort((a, b) => (b.previousValueUsd ?? 0) - (a.previousValueUsd ?? 0));
}

function renderActivityMoverRow(row, { sold = false } = {}) {
  const sc = Number(row.sharesChange);
  const shareLabel = sold ? formatShareCount(Math.abs(sc)) : formatSharesDelta(sc);
  const shareDir = sold ? "down" : "up";
  const valueCell =
    row.valueChangeUsd == null || !Number.isFinite(Number(row.valueChangeUsd))
      ? `<td class="mono num">—</td>`
      : `<td class="mono num"><span class="change-pill change-pill--${Number(row.valueChangeUsd) >= 0 ? "up" : "down"}">${escapeHtml(formatValueAddedMillions(Number(row.valueChangeUsd)))}</span></td>`;
  return `
    <tr>
      <td>${institutionFundLinkHtml(row.fundName, row.filerCik)}</td>
      <td class="mono num"><span class="change-pill change-pill--${shareDir}">${escapeHtml(shareLabel)}</span></td>
      <td class="mono num">${escapeHtml(formatShareCount(row.previousShares))}</td>
      <td class="mono num">${escapeHtml(formatShareCount(row.currentShares))}</td>
      ${valueCell}
    </tr>
  `;
}

function renderActivityExitRow(row) {
  const priorValue =
    row.previousValueUsd == null || !Number.isFinite(Number(row.previousValueUsd))
      ? "—"
      : formatExposureUsd(Number(row.previousValueUsd));
  return `
    <tr>
      <td>${institutionFundLinkHtml(row.fundName, row.filerCik)}</td>
      <td class="mono num">${escapeHtml(priorValue)}</td>
      <td class="mono num"><span class="change-pill change-pill--down">${escapeHtml(formatShareCount(row.previousShares))}</span></td>
    </tr>
  `;
}

function renderActivityNewRow(row) {
  const value =
    row.valueUsd == null || !Number.isFinite(Number(row.valueUsd))
      ? "—"
      : formatExposureUsd(Number(row.valueUsd));
  return `
    <tr>
      <td>${institutionFundLinkHtml(row.fundName, row.filerCik)}</td>
      <td class="mono num"><span class="change-pill change-pill--up">${escapeHtml(value)}</span></td>
      <td class="mono num">${escapeHtml(formatShareCount(row.shares))}</td>
    </tr>
  `;
}

function renderActivityMoversTable(bodyId, rows, emptyMsg) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${escapeHtml(emptyMsg)}</td></tr>`;
    return;
  }
  const sold = bodyId === "activity-sellers-body";
  body.innerHTML = rows.map((r) => renderActivityMoverRow(r, { sold })).join("");
}

function renderActivitySimpleTable(bodyId, rows, emptyMsg, renderRow, colSpan) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${colSpan}" class="trades-table__empty">${escapeHtml(emptyMsg)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(renderRow).join("");
}

function updateActivityMoreControl(footId, btnId, total, expanded, fewerLabel, allLabel) {
  const foot = document.getElementById(footId);
  const btn = document.getElementById(btnId);
  if (!foot || !btn) return;

  const extra = total - ACTIVITY_INITIAL_COUNT;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  btn.textContent = expanded ? fewerLabel : `${allLabel} (${total})`;
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function updateActivityBuyersMoreControl() {
  updateActivityMoreControl(
    "activity-buyers-foot",
    "activity-buyers-more-btn",
    lastActivityBuyers.length,
    activityBuyersExpanded,
    "Show fewer buyers",
    "Show all buyers"
  );
}

function updateActivitySellersMoreControl() {
  updateActivityMoreControl(
    "activity-sellers-foot",
    "activity-sellers-more-btn",
    lastActivitySellers.length,
    activitySellersExpanded,
    "Show fewer sellers",
    "Show all sellers"
  );
}

function updateActivityExitsMoreControl() {
  updateActivityMoreControl(
    "activity-exits-foot",
    "activity-exits-more-btn",
    lastActivityExits.length,
    activityExitsExpanded,
    "Show fewer exits",
    "Show all exits"
  );
}

function updateActivityNewMoreControl() {
  updateActivityMoreControl(
    "activity-new-foot",
    "activity-new-more-btn",
    lastActivityNewPositions.length,
    activityNewExpanded,
    "Show fewer new positions",
    "Show all new positions"
  );
}

function renderActivityTables() {
  const sortedBuyers = sortInstitutionTableRows(
    lastActivityBuyers,
    activityBuyersSortKey,
    activityBuyersSortDir
  );
  const sortedSellers = sortInstitutionTableRows(
    lastActivitySellers,
    activitySellersSortKey,
    activitySellersSortDir
  );
  const sortedExits = sortInstitutionTableRows(
    lastActivityExits,
    activityExitsSortKey,
    activityExitsSortDir
  );
  const sortedNew = sortInstitutionTableRows(
    lastActivityNewPositions,
    activityNewSortKey,
    activityNewSortDir
  );

  const visibleBuyers = activityBuyersExpanded
    ? sortedBuyers
    : sortedBuyers.slice(0, ACTIVITY_INITIAL_COUNT);
  const visibleSellers = activitySellersExpanded
    ? sortedSellers
    : sortedSellers.slice(0, ACTIVITY_INITIAL_COUNT);
  const visibleExits = activityExitsExpanded
    ? sortedExits
    : sortedExits.slice(0, ACTIVITY_INITIAL_COUNT);
  const visibleNew = activityNewExpanded
    ? sortedNew
    : sortedNew.slice(0, ACTIVITY_INITIAL_COUNT);

  updateInstitutionTableSortButtons(
    "data-activity-buyers-sort",
    activityBuyersSortKey,
    activityBuyersSortDir
  );
  updateInstitutionTableSortButtons(
    "data-activity-sellers-sort",
    activitySellersSortKey,
    activitySellersSortDir
  );
  updateInstitutionTableSortButtons(
    "data-activity-exits-sort",
    activityExitsSortKey,
    activityExitsSortDir
  );
  updateInstitutionTableSortButtons("data-activity-new-sort", activityNewSortKey, activityNewSortDir);

  renderActivityMoversTable(
    "activity-buyers-body",
    visibleBuyers,
    "No institutional buyers in this comparison window."
  );
  renderActivityMoversTable(
    "activity-sellers-body",
    visibleSellers,
    "No institutional sellers in this comparison window."
  );
  renderActivitySimpleTable(
    "activity-exits-body",
    visibleExits,
    "No complete exits in this comparison window.",
    renderActivityExitRow,
    3
  );
  renderActivitySimpleTable(
    "activity-new-body",
    visibleNew,
    "No new institutional positions in this comparison window.",
    renderActivityNewRow,
    3
  );
  updateActivityBuyersMoreControl();
  updateActivitySellersMoreControl();
  updateActivityExitsMoreControl();
  updateActivityNewMoreControl();
}

function setOptionsSubtitle(text) {
  const el = document.getElementById("options-subtitle");
  if (el) el.textContent = text;
}

function institutionalOptionsEmptyMessage(quarter) {
  if (quarter) return `No institutional options for the latest quarter (${quarter}).`;
  return "No institutional options for the latest quarter.";
}

function stockHasInstitutionalOptions(calls, puts) {
  const rows = [...(calls || []), ...(puts || [])];
  return rows.some((r) => {
    const contracts = Number(r.contracts);
    const valueUsd = Number(r.valueUsd);
    return (Number.isFinite(contracts) && contracts > 0) || (Number.isFinite(valueUsd) && valueUsd > 0);
  });
}

const OPTIONS_BIAS_NEUTRAL_BAND = 0.1;

function sumOptionsValueUsd(rows) {
  return rows.reduce((sum, r) => {
    const v = Number(r.valueUsd);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

function formatExposureUsd(usd) {
  const x = Number(usd);
  if (!Number.isFinite(x) || x <= 0) return "—";
  const compact = formatLargeNumber(x);
  return compact === "—" ? "—" : `$${compact}`;
}

function formatOptionsBiasScore(score) {
  if (score == null || !Number.isFinite(score)) return null;
  const pct = Math.round(score * 1000) / 10;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct}%`;
}

function sumCommonStockExposureUsd(holders) {
  if (!Array.isArray(holders) || !holders.length) return 0;
  return enrichOwnershipHolders(holders).reduce((sum, h) => {
    const v = resolveOwnershipRowValueUsd(h);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

function netBiasFromScore(score, { bullishLabel = "Call-heavy", bearishLabel = "Put-heavy" } = {}) {
  if (score == null || !Number.isFinite(score)) {
    return { netBias: "—", netBiasTone: "" };
  }
  if (score > OPTIONS_BIAS_NEUTRAL_BAND) {
    return { netBias: bullishLabel, netBiasTone: "call" };
  }
  if (score < -OPTIONS_BIAS_NEUTRAL_BAND) {
    return { netBias: bearishLabel, netBiasTone: "put" };
  }
  return { netBias: "Neutral", netBiasTone: "neutral" };
}

function formatNetBiasHtml(netBias, netBiasTone, score) {
  const scoreLabel = formatOptionsBiasScore(score);
  if (netBias === "—") return "—";
  const pillTone =
    netBiasTone === "call" ? "up" : netBiasTone === "put" ? "down" : "neutral";
  const label = `<span class="change-pill change-pill--${pillTone}">${escapeHtml(netBias)}</span>`;
  if (!scoreLabel) return label;
  return `${label} <span class="muted small">(${escapeHtml(scoreLabel)})</span>`;
}

function computeWeightedBias(commonExposure, calls, puts) {
  const callExposure = sumOptionsValueUsd(calls);
  const putExposure = sumOptionsValueUsd(puts);
  const common = Number(commonExposure) || 0;
  const weightedCall = OPTIONS_CALL_WEIGHT * callExposure;
  const weightedPut = OPTIONS_PUT_WEIGHT * putExposure;
  const totalExposure = common + callExposure + putExposure;
  const weightedNumerator = common + weightedCall - weightedPut;
  const weightedBias =
    totalExposure > 0 ? weightedNumerator / totalExposure : null;
  const { netBias, netBiasTone } = netBiasFromScore(weightedBias);
  return {
    commonExposure: common,
    callExposure,
    putExposure,
    weightedCall,
    weightedPut,
    totalExposure,
    weightedBias,
    netBias,
    netBiasTone,
  };
}

function computeOptionsBias(calls, puts) {
  const callExposure = sumOptionsValueUsd(calls);
  const putExposure = sumOptionsValueUsd(puts);
  const total = callExposure + putExposure;
  const biasScore = total > 0 ? (callExposure - putExposure) / total : null;

  const { netBias, netBiasTone } = netBiasFromScore(biasScore);

  const byFund = new Map();
  for (const row of [...calls, ...puts]) {
    if (!row?.fundName) continue;
    const v = Number(row.valueUsd);
    if (!Number.isFinite(v) || v <= 0) continue;
    byFund.set(row.fundName, (byFund.get(row.fundName) ?? 0) + v);
  }
  let largestHolder = "—";
  let largestValue = 0;
  for (const [name, value] of byFund) {
    if (value > largestValue) {
      largestValue = value;
      largestHolder = name;
    }
  }

  return {
    callExposure,
    putExposure,
    biasScore,
    netBias,
    netBiasTone,
    largestHolder,
  };
}

function renderOptionsBiasRow(metric, valueHtml, { valueClass = "" } = {}) {
  return `
    <tr>
      <td>${escapeHtml(metric)}</td>
      <td class="mono num ${valueClass}">${valueHtml}</td>
    </tr>
  `;
}

function renderOptionsBiasSummary() {
  const body = document.getElementById("options-bias-body");
  if (!body) return;

  const { callExposure, putExposure, biasScore, netBias, netBiasTone, largestHolder } =
    computeOptionsBias(lastOptionsCalls, lastOptionsPuts);

  if (callExposure <= 0 && putExposure <= 0) {
    body.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(lastOwnershipQuarterMeta.currentQuarter)
    )}</td></tr>`;
    return;
  }

  const netBiasHtml = formatNetBiasHtml(netBias, netBiasTone, biasScore);

  body.innerHTML = [
    renderOptionsBiasRow("Call exposure", escapeHtml(formatExposureUsd(callExposure)), {
      valueClass: "options-bias__label--call",
    }),
    renderOptionsBiasRow("Put exposure", escapeHtml(formatExposureUsd(putExposure)), {
      valueClass: "options-bias__label--put",
    }),
    renderOptionsBiasRow("Net options bias", netBiasHtml),
    renderOptionsBiasRow(
      "Largest options holder",
      escapeHtml(largestHolder === "—" ? "—" : largestHolder)
    ),
  ].join("");
}

function renderWeightedBiasSummary() {
  const body = document.getElementById("weighted-bias-body");
  if (!body) return;

  const callExposure = sumOptionsValueUsd(lastOptionsCalls);
  const putExposure = sumOptionsValueUsd(lastOptionsPuts);
  if (callExposure <= 0 && putExposure <= 0) {
    body.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(lastOwnershipQuarterMeta.currentQuarter)
    )}</td></tr>`;
    return;
  }

  if (lastWeightedCommonExposure == null) {
    body.innerHTML =
      '<tr><td colspan="2" class="options-bias-table__empty">Common-stock exposure unavailable.</td></tr>';
    return;
  }

  const w = computeWeightedBias(
    lastWeightedCommonExposure,
    lastOptionsCalls,
    lastOptionsPuts
  );

  if (w.totalExposure <= 0) {
    body.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(lastOwnershipQuarterMeta.currentQuarter)
    )}</td></tr>`;
    return;
  }

  const netBiasHtml = formatNetBiasHtml(w.netBias, w.netBiasTone, w.weightedBias);

  body.innerHTML = [
    renderOptionsBiasRow("Common exposure", escapeHtml(formatExposureUsd(w.commonExposure))),
    renderOptionsBiasRow(
      `Call exposure (×${OPTIONS_CALL_WEIGHT})`,
      escapeHtml(formatExposureUsd(w.weightedCall)),
      { valueClass: "options-bias__label--call" }
    ),
    renderOptionsBiasRow(
      `Put exposure (×${OPTIONS_PUT_WEIGHT})`,
      escapeHtml(formatExposureUsd(w.weightedPut)),
      { valueClass: "options-bias__label--put" }
    ),
    renderOptionsBiasRow("Total exposure", escapeHtml(formatExposureUsd(w.totalExposure))),
    renderOptionsBiasRow("Weighted bias", netBiasHtml),
  ].join("");
}

function buildOptionsByFund(holders, calls, puts) {
  const byFund = new Map();

  const ensure = (fundName, filerCik) => {
    if (!byFund.has(fundName)) {
      byFund.set(fundName, {
        fundName,
        filerCik: filerCik || institutionCikByName.get(fundName) || null,
        callContracts: 0,
        callValueUsd: 0,
        putContracts: 0,
        putValueUsd: 0,
        commonValueUsd: 0,
      });
    } else if (filerCik && !byFund.get(fundName).filerCik) {
      byFund.get(fundName).filerCik = filerCik;
    }
    return byFund.get(fundName);
  };

  for (const h of enrichOwnershipHolders(holders || [])) {
    if (!h?.fundName) continue;
    const row = ensure(h.fundName, h.filerCik);
    const v = resolveOwnershipRowValueUsd(h);
    row.commonValueUsd = Number.isFinite(v) ? v : 0;
  }

  for (const c of calls || []) {
    if (!c?.fundName) continue;
    const row = ensure(c.fundName, c.filerCik);
    row.callContracts = Number(c.contracts) || 0;
    row.callValueUsd = Number(c.valueUsd) || 0;
  }

  for (const p of puts || []) {
    if (!p?.fundName) continue;
    const row = ensure(p.fundName, p.filerCik);
    row.putContracts = Number(p.contracts) || 0;
    row.putValueUsd = Number(p.valueUsd) || 0;
  }

  const rows = [];
  for (const row of byFund.values()) {
    const common = row.commonValueUsd;
    const callVal = row.callValueUsd;
    const putVal = row.putValueUsd;
    const hasCalls = callVal > 0 || row.callContracts > 0;
    const hasPuts = putVal > 0 || row.putContracts > 0;
    if (!hasCalls && !hasPuts) continue;

    const totalExposure = common + callVal + putVal;
    const weightedNumerator =
      common + OPTIONS_CALL_WEIGHT * callVal - OPTIONS_PUT_WEIGHT * putVal;
    const biasScore = totalExposure > 0 ? weightedNumerator / totalExposure : null;
    const { netBias: biasLabel, netBiasTone: biasTone } = netBiasFromScore(biasScore);

    rows.push({
      fundName: row.fundName,
      filerCik: row.filerCik,
      totalContracts: row.callContracts + row.putContracts,
      commonValueUsd: common,
      callValueUsd: callVal,
      putValueUsd: putVal,
      biasScore,
      biasLabel,
      biasTone,
      totalExposure,
    });
  }

  return rows.sort((a, b) => b.totalExposure - a.totalExposure);
}

function formatOptionsExposureCell(usd) {
  const x = Number(usd);
  if (!Number.isFinite(x) || x <= 0) return "—";
  return formatExposureUsd(x);
}

function renderOptionsFundRow(row) {
  const biasHtml = formatNetBiasHtml(row.biasLabel, row.biasTone, row.biasScore);
  return `
    <tr>
      <td>${institutionFundLinkHtml(row.fundName, row.filerCik)}</td>
      <td class="mono num">${escapeHtml(row.totalContracts > 0 ? formatShareCount(row.totalContracts) : "—")}</td>
      <td class="mono num">${escapeHtml(formatOptionsExposureCell(row.commonValueUsd))}</td>
      <td class="mono num options-funds-table__calls">${escapeHtml(formatOptionsExposureCell(row.callValueUsd))}</td>
      <td class="mono num options-funds-table__puts">${escapeHtml(formatOptionsExposureCell(row.putValueUsd))}</td>
      <td class="mono num ownership-change">${biasHtml}</td>
    </tr>
  `;
}

function updateOptionsFundsMoreControl() {
  const foot = document.getElementById("options-funds-foot");
  const btn = document.getElementById("options-funds-more-btn");
  if (!foot || !btn) return;

  const extra = lastOptionsByFund.length - OPTIONS_INITIAL_COUNT;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  btn.textContent = optionsFundsExpanded
    ? "Show fewer funds"
    : `Show all funds (${lastOptionsByFund.length})`;
  btn.setAttribute("aria-expanded", optionsFundsExpanded ? "true" : "false");
}

function renderOptionsFundsTable() {
  const body = document.getElementById("options-funds-body");
  if (!body) return;

  if (!lastOptionsByFund.length) {
    body.innerHTML = `<tr><td colspan="6" class="trades-table__empty">${escapeHtml(
      institutionalOptionsEmptyMessage(lastOwnershipQuarterMeta.currentQuarter)
    )}</td></tr>`;
    updateOptionsFundsMoreControl();
    return;
  }

  const visible = optionsFundsExpanded
    ? lastOptionsByFund
    : lastOptionsByFund.slice(0, OPTIONS_INITIAL_COUNT);
  body.innerHTML = visible.map(renderOptionsFundRow).join("");
  updateOptionsFundsMoreControl();
}

function renderOptionsTables() {
  renderOptionsBiasSummary();
  renderWeightedBiasSummary();
  renderOptionsFundsTable();
}

async function loadActivityPanel(symbol) {
  const buyersBody = document.getElementById("activity-buyers-body");
  const sellersBody = document.getElementById("activity-sellers-body");
  const exitsBody = document.getElementById("activity-exits-body");
  const newBody = document.getElementById("activity-new-body");
  if (!buyersBody || !sellersBody) return;
  activityBuyersExpanded = false;
  activitySellersExpanded = false;
  activityExitsExpanded = false;
  activityNewExpanded = false;
  const loading =
    '<tr><td colspan="5" class="trades-table__empty">Loading institutional activity…</td></tr>';
  const loading3 =
    '<tr><td colspan="3" class="trades-table__empty">Loading institutional activity…</td></tr>';
  buyersBody.innerHTML = loading;
  sellersBody.innerHTML = loading;
  if (exitsBody) exitsBody.innerHTML = loading3;
  if (newBody) newBody.innerHTML = loading3;
  setActivitySubtitle("Loading…");
  try {
    const sym = encodeURIComponent(symbol);
    const [changesRes, newRes, soldRes] = await Promise.all([
      apiJson(`/api/stocks/${sym}/ownership-changes`, { limit: 200 }),
      apiJson(`/api/stocks/${sym}/new-positions`, { limit: 200 }),
      apiJson(`/api/stocks/${sym}/sold-out`, { limit: 200 }),
    ]);
    const meta = changesRes?.meta || newRes?.meta || soldRes?.meta || {};
    lastActivityQuarterMeta = {
      currentQuarter: meta.currentQuarter,
      previousQuarter: meta.previousQuarter ?? null,
    };
    if (meta.stockPrice != null && Number.isFinite(Number(meta.stockPrice))) {
      lastOwnershipStockPrice = Number(meta.stockPrice);
    }
    const parts = ["Institutional activity"];
    if (meta.currentQuarter && meta.previousQuarter) {
      parts.push(`${meta.currentQuarter} vs ${meta.previousQuarter}`);
    }
    const livePx = resolveOwnershipStockPrice();
    if (livePx != null) {
      parts.push(`${formatPrice(livePx, meta.currency || activeCurrency)} live value`);
    }
    setActivitySubtitle(parts.join(" · "));

    const movers = enrichActivityMovers(buildActivityMoversFromChanges(changesRes));
    lastActivityBuyers = movers
      .filter((r) => r.sharesChange > 0)
      .sort((a, b) => b.sharesChange - a.sharesChange);
    lastActivitySellers = movers
      .filter((r) => r.sharesChange < 0)
      .sort((a, b) => a.sharesChange - b.sharesChange);
    lastActivityExits = buildActivityExits(soldRes);
    lastActivityNewPositions = buildActivityNewPositions(newRes);
    renderActivityTables();
  } catch (err) {
    lastActivityBuyers = [];
    lastActivitySellers = [];
    lastActivityExits = [];
    lastActivityNewPositions = [];
    activityBuyersExpanded = false;
    activitySellersExpanded = false;
    activityExitsExpanded = false;
    activityNewExpanded = false;
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    buyersBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    sellersBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    if (exitsBody) exitsBody.innerHTML = `<tr><td colspan="3" class="trades-table__empty">${msg}</td></tr>`;
    if (newBody) newBody.innerHTML = `<tr><td colspan="3" class="trades-table__empty">${msg}</td></tr>`;
    updateActivityBuyersMoreControl();
    updateActivitySellersMoreControl();
    updateActivityExitsMoreControl();
    updateActivityNewMoreControl();
    setActivitySubtitle("Institutional activity (error)");
  }
}

async function loadOptionsPanel(symbol) {
  const fundsBody = document.getElementById("options-funds-body");
  const biasBody = document.getElementById("options-bias-body");
  const weightedBody = document.getElementById("weighted-bias-body");
  if (!fundsBody) return;
  optionsFundsExpanded = false;
  lastWeightedCommonExposure = null;
  const loading =
    '<tr><td colspan="6" class="trades-table__empty">Loading options…</td></tr>';
  const biasLoading = '<tr><td colspan="2" class="options-bias-table__empty">Loading…</td></tr>';
  fundsBody.innerHTML = loading;
  if (biasBody) biasBody.innerHTML = biasLoading;
  if (weightedBody) weightedBody.innerHTML = biasLoading;
  setOptionsSubtitle("Loading…");
  try {
    const sym = encodeURIComponent(symbol);
    const [optionsSettled, holdersSettled] = await Promise.allSettled([
      apiJson(`/api/stocks/${sym}/institutional-options`, { limit: 200 }),
      apiJson(`/api/stocks/${sym}/top-holders`, { limit: 200 }),
    ]);
    if (optionsSettled.status !== "fulfilled") {
      throw optionsSettled.reason;
    }
    const optionsRes = optionsSettled.value;
    const holdersRes = holdersSettled.status === "fulfilled" ? holdersSettled.value : null;
    const meta = optionsRes?.meta || holdersRes?.meta || {};
    lastOptionsCalls = Array.isArray(optionsRes?.calls) ? optionsRes.calls : [];
    lastOptionsPuts = Array.isArray(optionsRes?.puts) ? optionsRes.puts : [];
    const holders = holdersRes?.holders ?? [];
    lastWeightedCommonExposure = holdersRes
      ? sumCommonStockExposureUsd(holders)
      : null;
    lastOptionsByFund = buildOptionsByFund(holders, lastOptionsCalls, lastOptionsPuts);
    if (meta.currency) lastOwnershipCurrency = meta.currency;
    if (meta.stockPrice != null && Number.isFinite(Number(meta.stockPrice))) {
      lastOwnershipStockPrice = Number(meta.stockPrice);
    }
    lastOwnershipQuarterMeta = {
      currentQuarter: meta.currentQuarter,
      previousQuarter: meta.previousQuarter ?? null,
    };
    if (!stockHasInstitutionalOptions(lastOptionsCalls, lastOptionsPuts)) {
      setOptionsSubtitle(institutionalOptionsEmptyMessage(meta.currentQuarter));
    } else {
      const optParts = ["13F call & put positions"];
      if (meta.currentQuarter) optParts.push(meta.currentQuarter);
      if (lastOptionsByFund.length) {
        optParts.push(`${lastOptionsByFund.length} funds`);
      }
      setOptionsSubtitle(optParts.join(" · "));
    }
    renderOptionsTables();
  } catch (err) {
    lastOptionsCalls = [];
    lastOptionsPuts = [];
    lastOptionsByFund = [];
    lastWeightedCommonExposure = null;
    optionsFundsExpanded = false;
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (biasBody) {
      biasBody.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${msg}</td></tr>`;
    }
    if (weightedBody) {
      weightedBody.innerHTML = `<tr><td colspan="2" class="options-bias-table__empty">${msg}</td></tr>`;
    }
    fundsBody.innerHTML = `<tr><td colspan="6" class="trades-table__empty">${msg}</td></tr>`;
    updateOptionsFundsMoreControl();
    setOptionsSubtitle("Institutional options (error)");
  }
}

function formatOwnershipSubtitle(meta, holderCount, tracked) {
  const parts = ["Tracked institutional filers"];
  if (tracked) parts.push(`${holderCount} of ${tracked} with positions`);
  if (meta?.previousQuarter && meta?.currentQuarter) {
    parts.push(`QoQ ${meta.currentQuarter} vs ${meta.previousQuarter}`);
  } else if (meta?.currentQuarter) {
    parts.push(meta.currentQuarter);
  }
  if (meta?.impliedSharesOutstanding) {
    parts.push(`${formatLargeNumber(meta.impliedSharesOutstanding)} implied O/S`);
  }
  return parts;
}

function refreshOwnershipSubtitle() {
  const parts = formatOwnershipSubtitle(
    lastOwnershipQuarterMeta,
    lastOwnershipHolders.length,
    null
  );
  const livePx = resolveOwnershipStockPrice();
  if (livePx != null) {
    parts.push(`${formatPrice(livePx, lastOwnershipCurrency)} live`);
  }
  setOwnershipSubtitle(parts.join(" · "));
}

function formatLargeNumber(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x >= 1e12) return `${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return x.toLocaleString();
}

function formatSignedLargeNumber(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const sign = x < 0 ? "−" : "";
  return `${sign}${formatLargeNumber(Math.abs(x))}`;
}

function formatInteger(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return Math.round(x).toLocaleString();
}

function formatPercentValue(raw, assumeRatio = false, signed = false) {
  if (raw == null || raw === "" || raw === "None") return "—";
  const x = Number(raw);
  if (!Number.isFinite(x)) return String(raw);
  const pct = assumeRatio && Math.abs(x) <= 1 && x !== 0 ? x * 100 : x;
  const pctStr = pct.toFixed(2);
  if (signed) return `${pct >= 0 ? "+" : ""}${pctStr}%`;
  return `${pctStr}%`;
}

async function fetchFundamentals(_symbol) {
  throw new Error("Yahoo fundamentals removed — use SEC filings fundamentals");
}

async function fetchFilingsFundamentals(symbol) {
  return apiJson(`/api/stocks/${encodeURIComponent(symbol)}/filings-fundamentals?_=${Date.now()}`);
}

function filingsMetricNumber(metric) {
  if (metric == null) return null;
  const v = metric.value ?? metric;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Map SEC filings fundamentals → financialSignals input shape. */
function filingsFundamentalsToSignalInput(data) {
  if (!data) return {};
  const derived = data.derivedLatest ?? {};
  const balance = data.statements?.balanceSheet?.latest ?? {};
  const cash = filingsMetricNumber(balance.cash_and_equivalents);
  const totalDebt = derived.total_debt ?? filingsMetricNumber(balance.long_term_debt);
  let netCash = null;
  if (cash != null && totalDebt != null) netCash = cash - totalDebt;
  else if (cash != null) netCash = cash;

  const debtToEquity = derived.debt_to_equity;
  const debtToEquityPct =
    debtToEquity != null && Math.abs(debtToEquity) <= 5 ? debtToEquity * 100 : debtToEquity;

  const periodLabels = data.derivedPeriodLabels ?? {};
  return {
    revenueGrowth: derived.revenue_growth_yoy,
    epsGrowth: derived.eps_growth_yoy,
    grossMargin: derived.gross_margin,
    operatingMargin: derived.operating_margin,
    netMargin: derived.net_margin,
    roa: derived.roa,
    roe: derived.roe,
    roePeriodLabel: periodLabels.roe ?? null,
    roaPeriodLabel: periodLabels.roa ?? null,
    fcfMargin: derived.free_cash_flow_margin,
    currentRatio: derived.current_ratio,
    debtToEquity: debtToEquityPct,
    netCash,
  };
}

const SIGNAL_PERCENT_METRICS = new Set([
  "Revenue Growth",
  "EPS Growth",
  "Gross Margin",
  "Operating Margin",
  "Net Margin",
  "FCF Margin",
  "ROA",
  "ROE",
  "Debt / Equity",
]);

const SIGNAL_SIGNED_GROWTH_METRICS = new Set(["Revenue Growth", "EPS Growth"]);

function formatSignalMetricValue(metric, raw) {
  if (raw == null || !Number.isFinite(Number(raw))) return "—";
  const x = Number(raw);
  if (SIGNAL_PERCENT_METRICS.has(metric)) {
    const pct = Math.abs(x) <= 1 && x !== 0 && metric !== "Debt / Equity" ? x * 100 : x;
    if (SIGNAL_SIGNED_GROWTH_METRICS.has(metric)) {
      return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }
    if (metric === "Debt / Equity") {
      return `${pct.toFixed(1)}%`;
    }
    return `${pct.toFixed(1)}%`;
  }
  if (metric === "Net Cash") return formatSignedLargeNumber(x);
  if (Number.isInteger(x) || Math.abs(x) >= 1000) return formatInteger(x);
  return x.toFixed(1);
}

const OVERVIEW_FILING_METRICS = [
  { key: "revenue_ttm", label: "Revenue (TTM)" },
  { key: "revenue_growth_yoy", label: "Revenue Growth YoY" },
  { key: "eps_basic", label: "EPS (Basic)" },
  { key: "operating_margin", label: "Operating Margin" },
  { key: "gross_profit", label: "Gross Profit" },
  { key: "gross_margin", label: "Gross Margin" },
  { key: "free_cash_flow_margin", label: "Free Cash Flow Margin" },
  { key: "book_value_per_share", label: "Book Value/Share" },
  { key: "total_debt", label: "Total Debt" },
];

function computeOverviewRevenueTtm(filingsData) {
  const quarters =
    filingsData?.statements?.incomeStatement?.quarterly ||
    filingsData?.quarterly ||
    [];
  const sorted = [...quarters]
    .filter((row) => row?.metrics?.revenue != null && Number.isFinite(Number(row.metrics.revenue)))
    .sort((a, b) => String(b.end || "").localeCompare(String(a.end || "")));
  if (sorted.length >= 4) {
    return sorted.slice(0, 4).reduce((sum, row) => sum + Number(row.metrics.revenue), 0);
  }
  const annual =
    filingsData?.statements?.incomeStatement?.annual?.[0] || filingsData?.annual?.[0] || null;
  const annualRevenue = annual?.metrics?.revenue;
  return annualRevenue != null && Number.isFinite(Number(annualRevenue)) ? Number(annualRevenue) : null;
}

function overviewFilingsMetricValue(key, filingsData) {
  if (!filingsData) return null;
  const derived = filingsData.derivedLatest || {};
  const incomeLatest = filingsData.statements?.incomeStatement?.latest || filingsData.latest || {};
  switch (key) {
    case "revenue_ttm":
      return computeOverviewRevenueTtm(filingsData);
    case "revenue_growth_yoy":
      return derived.revenue_growth_yoy ?? null;
    case "eps_basic":
      return filingsMetricNumber(incomeLatest.eps_basic);
    case "operating_margin":
      return derived.operating_margin ?? null;
    case "gross_profit":
      return filingsMetricNumber(incomeLatest.gross_profit);
    case "gross_margin":
      return derived.gross_margin ?? null;
    case "free_cash_flow_margin":
      return derived.free_cash_flow_margin ?? null;
    case "book_value_per_share":
      return derived.book_value_per_share ?? null;
    case "total_debt":
      return derived.total_debt ?? null;
    default:
      return null;
  }
}

function formatOverviewFilingMetricValue(key, value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const v = Number(value);
  switch (key) {
    case "revenue_growth_yoy":
    case "operating_margin":
    case "gross_margin":
    case "free_cash_flow_margin":
      return formatSecDerivedPercent(v);
    case "eps_basic":
    case "book_value_per_share":
      return formatSecFundamentalValue(v, "USD/shares");
    case "revenue_ttm":
    case "gross_profit":
    case "total_debt":
      return formatSecFundamentalValue(v, "USD");
    default:
      return formatSecFundamentalValue(v, "USD");
  }
}

function renderOverviewMetricsItem(metric, filingsData) {
  const value = overviewFilingsMetricValue(metric.key, filingsData);
  const val = formatOverviewFilingMetricValue(metric.key, value);
  return `<div class="overview-key-stats-item">
    <span class="overview-key-stats-item__label">${escapeHtml(metric.label)}</span>
    <span class="overview-key-stats-item__value mono">${escapeHtml(val)}</span>
  </div>`;
}

function renderOverviewMetricsGrid(filingsData) {
  return OVERVIEW_FILING_METRICS.map((metric) => renderOverviewMetricsItem(metric, filingsData)).join("");
}

function hasOverviewFilingMetrics(filingsData) {
  return OVERVIEW_FILING_METRICS.some((metric) => {
    const value = overviewFilingsMetricValue(metric.key, filingsData);
    return value != null && Number.isFinite(Number(value));
  });
}

const OVERVIEW_KEY_STATS = [
  { key: "price", label: "Price" },
  { key: "volume", label: "Volume" },
  { key: "averageVolume", label: "Avg. volume" },
  { key: "dayRange", label: "Day's range" },
  { key: "fiftyTwoWeekRange", label: "52-week range" },
  { key: "marketCap", label: "Market cap (intraday)" },
  { key: "floatShares", label: "Shares float" },
  { key: "nextEarningsDate", label: "Next earnings date", dynamicLabel: true },
  { key: "exDividendDate", label: "Ex-dividend date" },
];

function formatSnapshotValue(key, raw) {
  if (raw == null || raw === "" || raw === "None") return "—";
  switch (key) {
    case "price":
    case "fiftyTwoWeekHigh":
    case "fiftyTwoWeekLow":
      return formatPrice(raw);
    case "marketCap":
    case "revenueTtm":
    case "netIncomeTtm":
    case "ebitda":
    case "totalCash":
    case "totalDebt":
    case "freeCashflow":
      return formatLargeNumber(raw);
    case "netCashDebt":
      return formatSignedLargeNumber(raw);
    case "dilutedEps":
    case "pe":
    case "forwardPe":
    case "peg":
    case "priceToSales":
    case "enterpriseToRevenue":
    case "enterpriseToEbitda":
    case "currentRatio":
    case "debtToEquity":
    case "beta":
    case "shortRatio":
      return Number.isFinite(Number(raw)) ? Number(raw).toFixed(2) : "—";
    case "revenueGrowth":
    case "earningsGrowth":
      return formatPercentValue(raw, true, true);
    case "returnOnEquity": {
      const x = Number(raw);
      if (!Number.isFinite(x)) return "—";
      return `${(x * 100).toFixed(2)}%`;
    }
    case "grossMargin":
    case "operatingMargin":
    case "netMargin":
    case "returnOnAssets":
    case "fcfMargin":
    case "institutionalOwnership":
    case "insiderOwnership":
    case "shortPercentFloat":
      return formatPercentValue(raw, true);
    case "distFrom52WeekHigh":
    case "distFrom52WeekLow":
      return formatPercentValue(raw, false, true);
    case "averageVolume":
    case "sharesOutstanding":
    case "floatShares":
    case "sharesShort":
      return formatInteger(raw);
    default:
      return escapeHtml(String(raw));
  }
}

function formatPriceRange(low, high, currency = activeCurrency) {
  const lo = Number(low);
  const hi = Number(high);
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return "—";
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    return `${formatPrice(lo, currency)} – ${formatPrice(hi, currency)}`;
  }
  if (Number.isFinite(lo)) return formatPrice(lo, currency);
  return formatPrice(hi, currency);
}

function formatOverviewCalendarDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatKeyStatValue(key, data) {
  const currency = data?.currency || activeCurrency;
  switch (key) {
    case "dayRange":
      return formatPriceRange(data.dayLow, data.dayHigh, currency);
    case "fiftyTwoWeekRange":
      return formatPriceRange(data.fiftyTwoWeekLow, data.fiftyTwoWeekHigh, currency);
    case "volume":
    case "averageVolume":
      return formatChartVolume(data[key]);
    case "nextEarningsDate":
      return data.nextEarningsDate ? String(data.nextEarningsDate) : "—";
    case "exDividendDate":
      return formatOverviewCalendarDate(data.exDividendDate);
    default:
      return formatSnapshotValue(key, data[key]);
  }
}

function keyStatLabel(metric, data) {
  if (metric.dynamicLabel && data?.nextEarningsDateLabel) {
    return data.nextEarningsDateLabel;
  }
  return metric.label;
}

function renderKeyStatItem(metric, data) {
  const label = keyStatLabel(metric, data);
  const val = formatKeyStatValue(metric.key, data);
  return `<div class="overview-key-stats-item">
    <span class="overview-key-stats-item__label">${escapeHtml(label)}</span>
    <span class="overview-key-stats-item__value mono">${val}</span>
  </div>`;
}

function renderKeyStatsGrid(data) {
  return OVERVIEW_KEY_STATS.map((metric) => renderKeyStatItem(metric, data)).join("");
}

function formatActivityTrendLabel(trend) {
  const t = String(trend || "neutral").toLowerCase();
  if (t === "bullish") return "Bullish";
  if (t === "bearish") return "Bearish";
  return "Neutral";
}

function renderOwnershipIntelTrend(trend) {
  const tone = String(trend || "neutral").toLowerCase();
  const label = formatActivityTrendLabel(tone);
  return `<span class="overview-ownership-intel-trend overview-ownership-intel-trend--${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function renderOwnershipIntelItem(label, valueHtml) {
  return `<div class="overview-ownership-intel-item">
    <span class="overview-ownership-intel-item__label">${escapeHtml(label)}</span>
    <span class="overview-ownership-intel-item__value">${valueHtml}</span>
  </div>`;
}

function formatSignedCount(value) {
  if (value == null || value === "") return "—";
  const x = Number(value);
  if (!Number.isFinite(x)) return "—";
  if (x > 0) return `+${x.toLocaleString()}`;
  return x.toLocaleString();
}

function formatOwnershipIntelNetShares(netShares, netValueUsd, currency = activeCurrency) {
  const sharesLabel = formatSharesDelta(netShares);
  if (netValueUsd != null && Number.isFinite(Number(netValueUsd)) && Number(netValueUsd) !== 0) {
    const valueLabel = formatHoldingValueUsd(Math.abs(Number(netValueUsd)), currency);
    const sign = Number(netValueUsd) >= 0 ? "+" : "−";
    return `${sharesLabel} <span class="muted small">(${sign}${valueLabel})</span>`;
  }
  return sharesLabel;
}

function formatSmartMoneyComponent(value) {
  const x = Number(value);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}`;
}

function smartMoneyConvictionLabel(score) {
  const x = Number(score);
  if (!Number.isFinite(x)) return "—";
  if (x >= 65) return "Bullish alignment";
  if (x <= 35) return "Bearish alignment";
  return "Neutral / mixed";
}

function smartMoneyConvictionClass(score) {
  const x = Number(score);
  if (!Number.isFinite(x)) return "overview-smart-money__score--neutral";
  if (x >= 65) return "overview-smart-money__score--bullish";
  if (x <= 35) return "overview-smart-money__score--bearish";
  return "overview-smart-money__score--neutral";
}

let insiderClusterLookbackDays = 60;
let insiderClusterHubBound = false;
let insiderClusterSymbol = null;

function insiderClusterScoreClass(score) {
  const x = Number(score);
  if (!Number.isFinite(x)) return "overview-insider-cluster__score--weak";
  if (x >= 70) return "overview-insider-cluster__score--strong";
  if (x >= 40) return "overview-insider-cluster__score--moderate";
  return "overview-insider-cluster__score--weak";
}

function insiderClusterBadgeClass(label) {
  if (label === "Executive Cluster Buying") return "insider-cluster-badge insider-cluster-badge--executive";
  return "insider-cluster-badge";
}

function formatInsiderClusterBuyValue(value) {
  const x = Number(value);
  if (!Number.isFinite(x) || x <= 0) return "—";
  return formatHoldingValueUsd(x, lastOwnershipCurrency);
}

function renderStockInsiderCluster(signal) {
  const overviewWrap = document.getElementById("overview-insider-cluster");
  const overviewScore = document.getElementById("overview-insider-cluster-score");
  const overviewLabel = document.getElementById("overview-insider-cluster-label");
  const overviewSignal = document.getElementById("overview-insider-cluster-signal");

  const banner = document.getElementById("insider-activity-cluster-banner");
  const bannerScore = document.getElementById("insider-activity-cluster-score");
  const bannerLabel = document.getElementById("insider-activity-cluster-label");
  const bannerSignal = document.getElementById("insider-activity-cluster-signal");
  const bannerMeta = document.getElementById("insider-activity-cluster-meta");
  const bannerAlert = document.getElementById("insider-activity-cluster-alert");

  const show = signal && Number.isFinite(Number(signal.insiderClusterScore));

  if (overviewWrap && overviewScore && overviewLabel && overviewSignal) {
    if (!show) {
      overviewWrap.hidden = true;
    } else {
      overviewWrap.hidden = false;
      overviewScore.textContent = Number(signal.insiderClusterScore).toFixed(1);
      overviewScore.className = `overview-insider-cluster__score mono ${insiderClusterScoreClass(signal.insiderClusterScore)}`;
      overviewLabel.textContent = signal.clusterStrengthLabel || "—";
      overviewLabel.className = insiderClusterBadgeClass(signal.clusterStrengthLabel);
      overviewSignal.textContent = signal.clusterSignal || "";
    }
  }

  if (banner && bannerScore && bannerLabel && bannerSignal && bannerMeta && bannerAlert) {
    if (!show) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      bannerScore.textContent = Number(signal.insiderClusterScore).toFixed(1);
      bannerLabel.textContent = signal.clusterStrengthLabel || "—";
      bannerLabel.className = insiderClusterBadgeClass(signal.clusterStrengthLabel);
      bannerSignal.textContent = signal.clusterSignal || "";
      bannerMeta.textContent = `${signal.buyerCount} buyer${signal.buyerCount === 1 ? "" : "s"} · ${formatInsiderClusterBuyValue(signal.totalBuyValue)} · ${signal.lookbackDays}d window`;
      bannerAlert.hidden = !signal.clusterAlert;
    }
  }
}

async function loadStockInsiderCluster(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return;
  insiderClusterSymbol = sym;
  renderStockInsiderCluster(null);
  try {
    const data = await apiJson(`/api/stocks/${encodeURIComponent(sym)}/insider-cluster`, {
      window: insiderClusterLookbackDays,
    });
    if (insiderClusterSymbol !== sym) return;
    renderStockInsiderCluster(data);
  } catch {
    if (insiderClusterSymbol !== sym) return;
    renderStockInsiderCluster(null);
  }
}

async function loadInsiderClusterHub() {
  const body = document.getElementById("insider-cluster-hub-body");
  const meta = document.getElementById("insider-cluster-hub-meta");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">Loading insider cluster signals…</td></tr>`;
  if (meta) meta.textContent = "Loading…";

  document.querySelectorAll("[data-insider-cluster-window]").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.insiderClusterWindow) === insiderClusterLookbackDays);
  });

  try {
    const data = await apiJson("/api/insider-clusters", {
      window: insiderClusterLookbackDays,
      limit: 100,
    });
    const rows = Array.isArray(data?.signals) ? data.signals : [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">No insider cluster signals yet. Run <code class="inline-code">npm run insider-clusters:warm-cache</code>, then restart the server.</td></tr>`;
      if (meta) meta.textContent = `${insiderClusterLookbackDays}-day lookback · open-market buys only`;
      return;
    }
    const alerts = rows.filter((r) => r.clusterAlert).length;
    if (meta) {
      meta.textContent = `${insiderClusterLookbackDays}d · ${rows.length} tickers · ${alerts} alert${alerts === 1 ? "" : "s"}`;
    }
    body.innerHTML = rows
      .map(
        (row, i) => `<tr>
        <td class="mono num">${i + 1}</td>
        <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}"><span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span></a></td>
        <td class="mono num">${Number(row.insiderClusterScore).toFixed(1)}</td>
        <td><span class="${escapeHtml(insiderClusterBadgeClass(row.clusterStrengthLabel))}">${escapeHtml(row.clusterStrengthLabel)}</span></td>
        <td class="mono num">${row.buyerCount}</td>
        <td>${row.ceoParticipation ? "Yes" : "—"}</td>
        <td class="mono num">${escapeHtml(formatInsiderClusterBuyValue(row.totalBuyValue))}</td>
        <td class="small">${escapeHtml(row.clusterSignal || "—")}</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">${msg}</td></tr>`;
    if (meta) meta.textContent = "Failed to load";
  }
}

function bindInsiderClusterHubControls() {
  if (insiderClusterHubBound) return;
  insiderClusterHubBound = true;
  document.querySelectorAll("[data-insider-cluster-window]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.dataset.insiderClusterWindow);
      if (days !== 30 && days !== 60 && days !== 90) return;
      insiderClusterLookbackDays = days;
      void loadInsiderClusterHub();
      const stock = getDisplayStock();
      if (stock?.symbol) void loadStockInsiderCluster(stock.symbol);
    });
  });
}

function convictionBuyLabelClass(label) {
  if (label === "Exceptional Conviction") return "conviction-buy-label conviction-buy-label--exceptional";
  if (label === "High Conviction") return "conviction-buy-label conviction-buy-label--high";
  if (label === "Moderate Conviction") return "conviction-buy-label conviction-buy-label--moderate";
  return "conviction-buy-label conviction-buy-label--low";
}

function convictionBuysQueryParams() {
  return {
    minScore: convictionBuysFilters.minScore || undefined,
    dateFrom: convictionBuysFilters.dateFrom || undefined,
    dateTo: convictionBuysFilters.dateTo || undefined,
    role: convictionBuysFilters.role || undefined,
    sector: convictionBuysFilters.sector || undefined,
    marketCap: convictionBuysFilters.marketCap || undefined,
    ticker: convictionBuysFilters.ticker || undefined,
    page: convictionBuysPage,
    pageSize: CONVICTION_BUYS_PAGE_SIZE,
    sort: convictionBuysSortKey,
    sortDir: convictionBuysSortDir,
  };
}

function syncConvictionBuysFiltersFromDom() {
  convictionBuysFilters.minScore =
    Number(document.getElementById("conviction-buys-min-score")?.value || 0) || 0;
  convictionBuysFilters.dateFrom = document.getElementById("conviction-buys-date-from")?.value || "";
  convictionBuysFilters.dateTo = document.getElementById("conviction-buys-date-to")?.value || "";
  convictionBuysFilters.role = document.getElementById("conviction-buys-role")?.value || "";
  convictionBuysFilters.sector = document.getElementById("conviction-buys-sector")?.value || "";
  convictionBuysFilters.marketCap = document.getElementById("conviction-buys-mcap")?.value || "";
  convictionBuysFilters.ticker = String(
    document.getElementById("conviction-buys-ticker")?.value || ""
  )
    .trim()
    .toUpperCase();
}

function renderConvictionBuysFilterOptions(payload) {
  const sectorSelect = document.getElementById("conviction-buys-sector");
  if (sectorSelect) {
    const current = convictionBuysFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const minScore = document.getElementById("conviction-buys-min-score");
  if (minScore) minScore.value = String(convictionBuysFilters.minScore || 0);
  const dateFrom = document.getElementById("conviction-buys-date-from");
  if (dateFrom) dateFrom.value = convictionBuysFilters.dateFrom || "";
  const dateTo = document.getElementById("conviction-buys-date-to");
  if (dateTo) dateTo.value = convictionBuysFilters.dateTo || "";
  const role = document.getElementById("conviction-buys-role");
  if (role) role.value = convictionBuysFilters.role || "";
  const mcap = document.getElementById("conviction-buys-mcap");
  if (mcap) mcap.value = convictionBuysFilters.marketCap || "";
  const ticker = document.getElementById("conviction-buys-ticker");
  if (ticker && ticker.value !== convictionBuysFilters.ticker) {
    ticker.value = convictionBuysFilters.ticker || "";
  }
}

function renderConvictionBuysHub() {
  setupConvictionBuysHub();
  const payload = lastConvictionBuysPayload;
  const body = document.getElementById("conviction-buys-body");
  const meta = document.getElementById("conviction-buys-meta");
  const countEl = document.getElementById("conviction-buys-count");
  const pagination = document.getElementById("conviction-buys-pagination");
  const pageInfo = document.getElementById("conviction-buys-page-info");
  const prevBtn = document.getElementById("conviction-buys-prev");
  const nextBtn = document.getElementById("conviction-buys-next");
  const loading = document.getElementById("conviction-buys-loading");

  if (loading) loading.hidden = !convictionBuysLoading;

  document.querySelectorAll("[data-conviction-buys-sort]").forEach((btn) => {
    const key = btn.dataset.convictionBuysSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === convictionBuysSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (convictionBuysSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${convictionBuysSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderConvictionBuysFilterOptions(payload);

  const summary = payload?.summary || {};
  const highest = summary.highestConvictionTrade;
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText(
    "conviction-buys-highest",
    highest
      ? `${highest.ticker} · ${Number(highest.convictionScore).toFixed(1)}`
      : "—"
  );
  setText(
    "conviction-buys-avg",
    Number.isFinite(Number(summary.averageConvictionScore))
      ? Number(summary.averageConvictionScore).toFixed(1)
      : "—"
  );
  setText("conviction-buys-high-count", formatInteger(summary.highConvictionBuys ?? 0));
  setText(
    "conviction-buys-capital",
    summary.totalCapitalDeployed != null
      ? formatInsiderClusterBuyValue(summary.totalCapitalDeployed)
      : "—"
  );

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || convictionBuysPage;
  const pageSize = Number(payload?.pageSize) || CONVICTION_BUYS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} purchase${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (convictionBuysLoading && !payload) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">Loading conviction buys…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No open-market conviction buys match these filters. Run <code class="inline-code">npm run insiders:warm-conviction-buys</code> if the cache is empty.</td></tr>`;
    if (meta) meta.textContent = total === 0 ? "No results" : "Empty page";
  } else {
    const offset = (page - 1) * pageSize;
    if (meta) {
      meta.textContent = `Page ${page} of ${totalPages}`;
    }
    body.innerHTML = rows
      .map((row, i) => {
        const rank = offset + i + 1;
        const ownPct = Number.isFinite(Number(row.ownershipIncreasePercent))
          ? `${Number(row.ownershipIncreasePercent).toFixed(1)}%`
          : "—";
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        return `<tr>
          <td class="mono num">${rank}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td>${escapeHtml(row.insiderName || "—")}</td>
          <td>${escapeHtml(row.role || row.insiderTitle || "—")}</td>
          <td class="mono num">${escapeHtml(formatInsiderClusterBuyValue(row.valueUsd))}</td>
          <td class="mono num">${escapeHtml(ownPct)}</td>
          <td class="mono num">${formatInteger(row.purchasesLast12Months ?? 0)}</td>
          <td class="mono num">${Number(row.convictionScore).toFixed(1)}</td>
          <td><span class="${escapeHtml(convictionBuyLabelClass(row.convictionLabel))}">${escapeHtml(row.convictionLabel || "—")}</span></td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadConvictionBuysHub() {
  if (convictionBuysLoading) {
    renderConvictionBuysHub();
    return;
  }
  convictionBuysLoading = true;
  renderConvictionBuysHub();
  const requestKey = JSON.stringify(convictionBuysQueryParams());
  try {
    lastConvictionBuysPayload = await apiJson(
      "/api/insiders/conviction-buys",
      convictionBuysQueryParams()
    );
  } catch (err) {
    lastConvictionBuysPayload = null;
    const body = document.getElementById("conviction-buys-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    convictionBuysLoading = false;
    if (JSON.stringify(convictionBuysQueryParams()) !== requestKey) {
      void loadConvictionBuysHub();
      return;
    }
    renderConvictionBuysHub();
  }
}

function setupConvictionBuysHub() {
  if (convictionBuysBound) return;
  convictionBuysBound = true;

  document.getElementById("conviction-buys-prev")?.addEventListener("click", () => {
    if (convictionBuysPage <= 1) return;
    convictionBuysPage -= 1;
    void loadConvictionBuysHub();
  });
  document.getElementById("conviction-buys-next")?.addEventListener("click", () => {
    convictionBuysPage += 1;
    void loadConvictionBuysHub();
  });

  const panel = document.getElementById("insider-conviction-buys-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-conviction-buys-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-conviction-buys-sort");
      if (!key) return;
      if (convictionBuysSortKey === key) {
        convictionBuysSortDir = convictionBuysSortDir === "desc" ? "asc" : "desc";
      } else {
        convictionBuysSortKey = key;
        convictionBuysSortDir = key === "ticker" ? "asc" : "desc";
      }
      convictionBuysPage = 1;
      void loadConvictionBuysHub();
    }
  });

  [
    "conviction-buys-min-score",
    "conviction-buys-date-from",
    "conviction-buys-date-to",
    "conviction-buys-role",
    "conviction-buys-sector",
    "conviction-buys-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncConvictionBuysFiltersFromDom();
      convictionBuysPage = 1;
      void loadConvictionBuysHub();
    });
  });

  let tickerTimer = null;
  document.getElementById("conviction-buys-ticker")?.addEventListener("input", () => {
    syncConvictionBuysFiltersFromDom();
    convictionBuysPage = 1;
    clearTimeout(tickerTimer);
    tickerTimer = setTimeout(() => void loadConvictionBuysHub(), 250);
  });
}

function repeatBuyerLabelClass(label) {
  if (label === "Serial Buyer") return "repeat-buyer-label repeat-buyer-label--serial";
  if (label === "Strong Accumulator") return "repeat-buyer-label repeat-buyer-label--strong";
  if (label === "Repeat Buyer") return "repeat-buyer-label repeat-buyer-label--repeat";
  return "repeat-buyer-label repeat-buyer-label--occasional";
}

function repeatBuyersQueryParams() {
  const minInvestedRaw = String(repeatBuyersFilters.minInvested || "").trim();
  const minInvested = minInvestedRaw === "" ? undefined : Number(minInvestedRaw);
  return {
    minScore: repeatBuyersFilters.minScore || undefined,
    minPurchases: repeatBuyersFilters.minPurchases || undefined,
    minStreak: repeatBuyersFilters.minStreak || undefined,
    minInvested: Number.isFinite(minInvested) ? minInvested : undefined,
    dateFrom: repeatBuyersFilters.dateFrom || undefined,
    dateTo: repeatBuyersFilters.dateTo || undefined,
    role: repeatBuyersFilters.role || undefined,
    sector: repeatBuyersFilters.sector || undefined,
    marketCap: repeatBuyersFilters.marketCap || undefined,
    ticker: repeatBuyersFilters.ticker || undefined,
    search: repeatBuyersFilters.search || undefined,
    page: repeatBuyersPage,
    pageSize: REPEAT_BUYERS_PAGE_SIZE,
    sort: repeatBuyersSortKey,
    sortDir: repeatBuyersSortDir,
  };
}

function syncRepeatBuyersFiltersFromDom() {
  repeatBuyersFilters.minScore =
    Number(document.getElementById("repeat-buyers-min-score")?.value || 0) || 0;
  repeatBuyersFilters.minPurchases =
    Number(document.getElementById("repeat-buyers-min-purchases")?.value || 2) || 2;
  repeatBuyersFilters.minStreak =
    Number(document.getElementById("repeat-buyers-min-streak")?.value || 0) || 0;
  repeatBuyersFilters.minInvested =
    document.getElementById("repeat-buyers-min-invested")?.value || "";
  repeatBuyersFilters.dateFrom = document.getElementById("repeat-buyers-date-from")?.value || "";
  repeatBuyersFilters.dateTo = document.getElementById("repeat-buyers-date-to")?.value || "";
  repeatBuyersFilters.role = document.getElementById("repeat-buyers-role")?.value || "";
  repeatBuyersFilters.sector = document.getElementById("repeat-buyers-sector")?.value || "";
  repeatBuyersFilters.marketCap = document.getElementById("repeat-buyers-mcap")?.value || "";
  repeatBuyersFilters.ticker = String(
    document.getElementById("repeat-buyers-ticker")?.value || ""
  )
    .trim()
    .toUpperCase();
  repeatBuyersFilters.search = document.getElementById("repeat-buyers-search")?.value || "";
}

function renderRepeatBuyersFilterOptions(payload) {
  const sectorSelect = document.getElementById("repeat-buyers-sector");
  if (sectorSelect) {
    const current = repeatBuyersFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setVal("repeat-buyers-min-score", String(repeatBuyersFilters.minScore || 0));
  setVal("repeat-buyers-min-purchases", String(repeatBuyersFilters.minPurchases || 2));
  setVal("repeat-buyers-min-streak", String(repeatBuyersFilters.minStreak || 0));
  setVal("repeat-buyers-min-invested", repeatBuyersFilters.minInvested || "");
  setVal("repeat-buyers-date-from", repeatBuyersFilters.dateFrom || "");
  setVal("repeat-buyers-date-to", repeatBuyersFilters.dateTo || "");
  setVal("repeat-buyers-role", repeatBuyersFilters.role || "");
  setVal("repeat-buyers-mcap", repeatBuyersFilters.marketCap || "");
  const ticker = document.getElementById("repeat-buyers-ticker");
  if (ticker && ticker.value !== repeatBuyersFilters.ticker) {
    ticker.value = repeatBuyersFilters.ticker || "";
  }
  const search = document.getElementById("repeat-buyers-search");
  if (search && search.value !== repeatBuyersFilters.search) {
    search.value = repeatBuyersFilters.search || "";
  }
}

function renderRepeatBuyersHub() {
  setupRepeatBuyersHub();
  const payload = lastRepeatBuyersPayload;
  const body = document.getElementById("repeat-buyers-body");
  const meta = document.getElementById("repeat-buyers-meta");
  const countEl = document.getElementById("repeat-buyers-count");
  const pagination = document.getElementById("repeat-buyers-pagination");
  const pageInfo = document.getElementById("repeat-buyers-page-info");
  const prevBtn = document.getElementById("repeat-buyers-prev");
  const nextBtn = document.getElementById("repeat-buyers-next");
  const loading = document.getElementById("repeat-buyers-loading");

  if (loading) loading.hidden = !repeatBuyersLoading;

  document.querySelectorAll("[data-repeat-buyers-sort]").forEach((btn) => {
    const key = btn.dataset.repeatBuyersSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === repeatBuyersSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (repeatBuyersSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${repeatBuyersSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderRepeatBuyersFilterOptions(payload);

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("repeat-buyers-active", formatInteger(summary.activeRepeatBuyers ?? 0));
  setText("repeat-buyers-longest", formatInteger(summary.longestPurchaseStreak ?? 0));
  setText(
    "repeat-buyers-largest",
    summary.largestTotalInvestment != null
      ? formatInsiderClusterBuyValue(summary.largestTotalInvestment)
      : "—"
  );
  setText(
    "repeat-buyers-avg",
    Number.isFinite(Number(summary.averageRepeatBuyerScore))
      ? Number(summary.averageRepeatBuyerScore).toFixed(1)
      : "—"
  );

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || repeatBuyersPage;
  const pageSize = Number(payload?.pageSize) || REPEAT_BUYERS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} pair${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (repeatBuyersLoading && !payload) {
    body.innerHTML = `<tr><td colspan="11" class="trades-table__empty">Loading repeat buyers…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="11" class="trades-table__empty">No repeat buyers match these filters. Run <code class="inline-code">npm run insiders:warm-repeat-buyers</code> if the cache is empty.</td></tr>`;
    if (meta) meta.textContent = total === 0 ? "No results" : "Empty page";
  } else {
    const offset = (page - 1) * pageSize;
    if (meta) {
      meta.textContent = `Page ${page} of ${totalPages}`;
    }
    body.innerHTML = rows
      .map((row, i) => {
        const rank = offset + i + 1;
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        return `<tr>
          <td class="mono num">${rank}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td>${escapeHtml(row.insiderName || "—")}</td>
          <td>${escapeHtml(row.role || row.title || "—")}</td>
          <td class="mono num">${formatInteger(row.purchaseCount ?? 0)}</td>
          <td class="mono num">${formatInteger(row.purchasesLast12Months ?? 0)}</td>
          <td class="mono num">${formatInteger(row.purchaseStreak ?? 0)}</td>
          <td class="mono num">${escapeHtml(formatInsiderClusterBuyValue(row.totalInvested))}</td>
          <td class="mono num">${escapeHtml(row.latestPurchase || "—")}</td>
          <td class="mono num">${Number(row.repeatBuyerScore).toFixed(1)}</td>
          <td><span class="${escapeHtml(repeatBuyerLabelClass(row.classification))}">${escapeHtml(row.classification || "—")}</span></td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadRepeatBuyersHub() {
  if (repeatBuyersLoading) {
    renderRepeatBuyersHub();
    return;
  }
  repeatBuyersLoading = true;
  renderRepeatBuyersHub();
  const requestKey = JSON.stringify(repeatBuyersQueryParams());
  try {
    lastRepeatBuyersPayload = await apiJson(
      "/api/insiders/repeat-buyers",
      repeatBuyersQueryParams()
    );
  } catch (err) {
    lastRepeatBuyersPayload = null;
    const body = document.getElementById("repeat-buyers-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="11" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    repeatBuyersLoading = false;
    if (JSON.stringify(repeatBuyersQueryParams()) !== requestKey) {
      void loadRepeatBuyersHub();
      return;
    }
    renderRepeatBuyersHub();
  }
}

function setupRepeatBuyersHub() {
  if (repeatBuyersBound) return;
  repeatBuyersBound = true;

  document.getElementById("repeat-buyers-prev")?.addEventListener("click", () => {
    if (repeatBuyersPage <= 1) return;
    repeatBuyersPage -= 1;
    void loadRepeatBuyersHub();
  });
  document.getElementById("repeat-buyers-next")?.addEventListener("click", () => {
    repeatBuyersPage += 1;
    void loadRepeatBuyersHub();
  });

  const panel = document.getElementById("insider-repeat-buyers-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-repeat-buyers-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-repeat-buyers-sort");
      if (!key) return;
      if (repeatBuyersSortKey === key) {
        repeatBuyersSortDir = repeatBuyersSortDir === "desc" ? "asc" : "desc";
      } else {
        repeatBuyersSortKey = key;
        repeatBuyersSortDir = key === "ticker" ? "asc" : "desc";
      }
      repeatBuyersPage = 1;
      void loadRepeatBuyersHub();
    }
  });

  [
    "repeat-buyers-min-score",
    "repeat-buyers-min-purchases",
    "repeat-buyers-min-streak",
    "repeat-buyers-min-invested",
    "repeat-buyers-date-from",
    "repeat-buyers-date-to",
    "repeat-buyers-role",
    "repeat-buyers-sector",
    "repeat-buyers-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncRepeatBuyersFiltersFromDom();
      repeatBuyersPage = 1;
      void loadRepeatBuyersHub();
    });
  });

  let searchTimer = null;
  const debounceReload = () => {
    syncRepeatBuyersFiltersFromDom();
    repeatBuyersPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadRepeatBuyersHub(), 250);
  };
  document.getElementById("repeat-buyers-ticker")?.addEventListener("input", debounceReload);
  document.getElementById("repeat-buyers-search")?.addEventListener("input", debounceReload);
}

function insiderSentimentLabelClass(label) {
  if (label === "Strong Bullish") return "insider-sentiment-label insider-sentiment-label--strong-bull";
  if (label === "Bullish") return "insider-sentiment-label insider-sentiment-label--bull";
  if (label === "Bearish") return "insider-sentiment-label insider-sentiment-label--bear";
  if (label === "Strong Bearish") return "insider-sentiment-label insider-sentiment-label--strong-bear";
  return "insider-sentiment-label insider-sentiment-label--neutral";
}

function formatSentimentScoreDisplay(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}`;
}

function formatBuyerRatioPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function formatSignedFlow(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return { text: "—", cls: "" };
  const abs = formatInsiderClusterBuyValue(Math.abs(v));
  if (v > 0) return { text: `+${abs}`, cls: "insider-sentiment-flow--pos" };
  if (v < 0) return { text: `−${abs}`, cls: "insider-sentiment-flow--neg" };
  return { text: abs, cls: "" };
}

function insiderSentimentQueryParams() {
  const minScoreRaw = String(insiderSentimentFilters.minScore || "").trim();
  const minScore = minScoreRaw === "" ? undefined : Number(minScoreRaw);
  return {
    minScore: Number.isFinite(minScore) ? minScore : undefined,
    minTrades: insiderSentimentFilters.minTrades || undefined,
    minUniqueInsiders: insiderSentimentFilters.minUniqueInsiders || undefined,
    dateFrom: insiderSentimentFilters.dateFrom || undefined,
    dateTo: insiderSentimentFilters.dateTo || undefined,
    sector: insiderSentimentFilters.sector || undefined,
    marketCap: insiderSentimentFilters.marketCap || undefined,
    search: insiderSentimentFilters.search || undefined,
    page: insiderSentimentPage,
    pageSize: INSIDER_SENTIMENT_PAGE_SIZE,
    sort: insiderSentimentSortKey,
    sortDir: insiderSentimentSortDir,
  };
}

function syncInsiderSentimentFiltersFromDom() {
  insiderSentimentFilters.minScore =
    document.getElementById("insider-sentiment-min-score")?.value || "";
  insiderSentimentFilters.minTrades =
    Number(document.getElementById("insider-sentiment-min-trades")?.value || 1) || 1;
  insiderSentimentFilters.minUniqueInsiders =
    Number(document.getElementById("insider-sentiment-min-insiders")?.value || 1) || 1;
  insiderSentimentFilters.dateFrom =
    document.getElementById("insider-sentiment-date-from")?.value || "";
  insiderSentimentFilters.dateTo =
    document.getElementById("insider-sentiment-date-to")?.value || "";
  insiderSentimentFilters.sector =
    document.getElementById("insider-sentiment-sector")?.value || "";
  insiderSentimentFilters.marketCap =
    document.getElementById("insider-sentiment-mcap")?.value || "";
  insiderSentimentFilters.search =
    document.getElementById("insider-sentiment-search")?.value || "";
}

function renderInsiderSentimentFilterOptions(payload) {
  const sectorSelect = document.getElementById("insider-sentiment-sector");
  if (sectorSelect) {
    const current = insiderSentimentFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setVal("insider-sentiment-min-score", insiderSentimentFilters.minScore || "");
  setVal("insider-sentiment-min-trades", String(insiderSentimentFilters.minTrades || 1));
  setVal("insider-sentiment-min-insiders", String(insiderSentimentFilters.minUniqueInsiders || 1));
  setVal("insider-sentiment-date-from", insiderSentimentFilters.dateFrom || "");
  setVal("insider-sentiment-date-to", insiderSentimentFilters.dateTo || "");
  setVal("insider-sentiment-mcap", insiderSentimentFilters.marketCap || "");
  const search = document.getElementById("insider-sentiment-search");
  if (search && search.value !== insiderSentimentFilters.search) {
    search.value = insiderSentimentFilters.search || "";
  }
}

function renderInsiderSentimentHub() {
  setupInsiderSentimentHub();
  const payload = lastInsiderSentimentPayload;
  const body = document.getElementById("insider-sentiment-body");
  const meta = document.getElementById("insider-sentiment-meta");
  const countEl = document.getElementById("insider-sentiment-count");
  const pagination = document.getElementById("insider-sentiment-pagination");
  const pageInfo = document.getElementById("insider-sentiment-page-info");
  const prevBtn = document.getElementById("insider-sentiment-prev");
  const nextBtn = document.getElementById("insider-sentiment-next");
  const loading = document.getElementById("insider-sentiment-loading");

  if (loading) loading.hidden = !insiderSentimentLoading;

  document.querySelectorAll("[data-insider-sentiment-sort]").forEach((btn) => {
    const key = btn.dataset.insiderSentimentSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === insiderSentimentSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (insiderSentimentSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${insiderSentimentSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderInsiderSentimentFilterOptions(payload);

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("insider-sentiment-bullish", formatInteger(summary.mostBullishStocks ?? 0));
  setText("insider-sentiment-bearish", formatInteger(summary.mostBearishStocks ?? 0));
  const netFlow = formatSignedFlow(summary.netInsiderBuying);
  const netEl = document.getElementById("insider-sentiment-net");
  if (netEl) {
    netEl.textContent = netFlow.text;
    netEl.className = `institution-most-accumulated__summary-value mono ${netFlow.cls}`.trim();
  }
  setText("insider-sentiment-avg", formatSentimentScoreDisplay(summary.averageSentimentScore));

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || insiderSentimentPage;
  const pageSize = Number(payload?.pageSize) || INSIDER_SENTIMENT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} stock${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (insiderSentimentLoading && !payload) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">Loading insider sentiment…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">No insider sentiment matches these filters. Run <code class="inline-code">npm run insiders:warm-sentiment</code> if the cache is empty.</td></tr>`;
    if (meta) meta.textContent = total === 0 ? "No results" : "Empty page";
  } else {
    const offset = (page - 1) * pageSize;
    if (meta) {
      meta.textContent = `Page ${page} of ${totalPages} · sorted by ${insiderSentimentSortKey}`;
    }
    body.innerHTML = rows
      .map((row, i) => {
        const rank = offset + i + 1;
        const flow = formatSignedFlow(row.netDollarFlow);
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        return `<tr>
          <td class="mono num">${rank}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td class="mono num">${formatInteger(row.uniqueBuyers ?? 0)}</td>
          <td class="mono num">${formatInteger(row.uniqueSellers ?? 0)}</td>
          <td class="mono num ${flow.cls}">${escapeHtml(flow.text)}</td>
          <td class="mono num">${escapeHtml(formatBuyerRatioPct(row.buyerRatio))}</td>
          <td class="mono num">${escapeHtml(formatSentimentScoreDisplay(row.sentimentScore))}</td>
          <td><span class="${escapeHtml(insiderSentimentLabelClass(row.classification))}">${escapeHtml(row.classification || "—")}</span></td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadInsiderSentimentHub() {
  if (insiderSentimentLoading) {
    renderInsiderSentimentHub();
    return;
  }
  insiderSentimentLoading = true;
  renderInsiderSentimentHub();
  const requestKey = JSON.stringify(insiderSentimentQueryParams());
  try {
    lastInsiderSentimentPayload = await apiJson(
      "/api/insiders/sentiment",
      insiderSentimentQueryParams()
    );
  } catch (err) {
    lastInsiderSentimentPayload = null;
    const body = document.getElementById("insider-sentiment-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="8" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    insiderSentimentLoading = false;
    if (JSON.stringify(insiderSentimentQueryParams()) !== requestKey) {
      void loadInsiderSentimentHub();
      return;
    }
    renderInsiderSentimentHub();
  }
}

function setupInsiderSentimentHub() {
  if (insiderSentimentBound) return;
  insiderSentimentBound = true;

  document.getElementById("insider-sentiment-prev")?.addEventListener("click", () => {
    if (insiderSentimentPage <= 1) return;
    insiderSentimentPage -= 1;
    void loadInsiderSentimentHub();
  });
  document.getElementById("insider-sentiment-next")?.addEventListener("click", () => {
    insiderSentimentPage += 1;
    void loadInsiderSentimentHub();
  });

  const panel = document.getElementById("insider-sentiment-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-insider-sentiment-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-insider-sentiment-sort");
      if (!key) return;
      if (insiderSentimentSortKey === key) {
        insiderSentimentSortDir = insiderSentimentSortDir === "desc" ? "asc" : "desc";
      } else {
        insiderSentimentSortKey = key;
        insiderSentimentSortDir = key === "ticker" ? "asc" : "desc";
      }
      insiderSentimentPage = 1;
      void loadInsiderSentimentHub();
    }
  });

  [
    "insider-sentiment-min-score",
    "insider-sentiment-min-trades",
    "insider-sentiment-min-insiders",
    "insider-sentiment-date-from",
    "insider-sentiment-date-to",
    "insider-sentiment-sector",
    "insider-sentiment-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncInsiderSentimentFiltersFromDom();
      insiderSentimentPage = 1;
      void loadInsiderSentimentHub();
    });
  });

  let searchTimer = null;
  document.getElementById("insider-sentiment-search")?.addEventListener("input", () => {
    syncInsiderSentimentFiltersFromDom();
    insiderSentimentPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadInsiderSentimentHub(), 250);
  });
}

function firstTimeBuyerLabelClass(label) {
  if (label === "First-Time High Conviction") {
    return "first-time-buyer-label first-time-buyer-label--high";
  }
  if (label === "Long-Term Return Buyer") {
    return "first-time-buyer-label first-time-buyer-label--long";
  }
  if (label === "Notable Return") {
    return "first-time-buyer-label first-time-buyer-label--notable";
  }
  return "first-time-buyer-label first-time-buyer-label--minor";
}

function firstTimeBuyersQueryParams() {
  return {
    minScore: firstTimeBuyersFilters.minScore || undefined,
    minYears: firstTimeBuyersFilters.minYears || undefined,
    firstEverOnly: firstTimeBuyersFilters.firstEverOnly ? "1" : undefined,
    dateFrom: firstTimeBuyersFilters.dateFrom || undefined,
    dateTo: firstTimeBuyersFilters.dateTo || undefined,
    role: firstTimeBuyersFilters.role || undefined,
    sector: firstTimeBuyersFilters.sector || undefined,
    marketCap: firstTimeBuyersFilters.marketCap || undefined,
    ticker: firstTimeBuyersFilters.ticker || undefined,
    search: firstTimeBuyersFilters.search || undefined,
    page: firstTimeBuyersPage,
    pageSize: FIRST_TIME_BUYERS_PAGE_SIZE,
    sort: firstTimeBuyersSortKey,
    sortDir: firstTimeBuyersSortDir,
  };
}

function syncFirstTimeBuyersFiltersFromDom() {
  firstTimeBuyersFilters.minScore =
    Number(document.getElementById("first-time-buyers-min-score")?.value || 0) || 0;
  firstTimeBuyersFilters.minYears =
    Number(document.getElementById("first-time-buyers-min-years")?.value || 3) || 3;
  firstTimeBuyersFilters.firstEverOnly = !!document.getElementById("first-time-buyers-first-ever")
    ?.checked;
  firstTimeBuyersFilters.dateFrom =
    document.getElementById("first-time-buyers-date-from")?.value || "";
  firstTimeBuyersFilters.dateTo =
    document.getElementById("first-time-buyers-date-to")?.value || "";
  firstTimeBuyersFilters.role = document.getElementById("first-time-buyers-role")?.value || "";
  firstTimeBuyersFilters.sector =
    document.getElementById("first-time-buyers-sector")?.value || "";
  firstTimeBuyersFilters.marketCap =
    document.getElementById("first-time-buyers-mcap")?.value || "";
  firstTimeBuyersFilters.ticker = String(
    document.getElementById("first-time-buyers-ticker")?.value || ""
  )
    .trim()
    .toUpperCase();
  firstTimeBuyersFilters.search =
    document.getElementById("first-time-buyers-search")?.value || "";
}

function renderFirstTimeBuyersFilterOptions(payload) {
  const sectorSelect = document.getElementById("first-time-buyers-sector");
  if (sectorSelect) {
    const current = firstTimeBuyersFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setVal("first-time-buyers-min-score", String(firstTimeBuyersFilters.minScore || 0));
  setVal("first-time-buyers-min-years", String(firstTimeBuyersFilters.minYears || 3));
  setVal("first-time-buyers-date-from", firstTimeBuyersFilters.dateFrom || "");
  setVal("first-time-buyers-date-to", firstTimeBuyersFilters.dateTo || "");
  setVal("first-time-buyers-role", firstTimeBuyersFilters.role || "");
  setVal("first-time-buyers-mcap", firstTimeBuyersFilters.marketCap || "");
  const firstEver = document.getElementById("first-time-buyers-first-ever");
  if (firstEver) firstEver.checked = !!firstTimeBuyersFilters.firstEverOnly;
  const ticker = document.getElementById("first-time-buyers-ticker");
  if (ticker && ticker.value !== firstTimeBuyersFilters.ticker) {
    ticker.value = firstTimeBuyersFilters.ticker || "";
  }
  const search = document.getElementById("first-time-buyers-search");
  if (search && search.value !== firstTimeBuyersFilters.search) {
    search.value = firstTimeBuyersFilters.search || "";
  }
}

function renderFirstTimeBuyersHub() {
  setupFirstTimeBuyersHub();
  const payload = lastFirstTimeBuyersPayload;
  const body = document.getElementById("first-time-buyers-body");
  const meta = document.getElementById("first-time-buyers-meta");
  const countEl = document.getElementById("first-time-buyers-count");
  const pagination = document.getElementById("first-time-buyers-pagination");
  const pageInfo = document.getElementById("first-time-buyers-page-info");
  const prevBtn = document.getElementById("first-time-buyers-prev");
  const nextBtn = document.getElementById("first-time-buyers-next");
  const loading = document.getElementById("first-time-buyers-loading");

  if (loading) loading.hidden = !firstTimeBuyersLoading;

  document.querySelectorAll("[data-first-time-buyers-sort]").forEach((btn) => {
    const key = btn.dataset.firstTimeBuyersSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === firstTimeBuyersSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (firstTimeBuyersSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${firstTimeBuyersSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderFirstTimeBuyersFilterOptions(payload);

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("first-time-buyers-first-ever", formatInteger(summary.firstEverBuyers ?? 0));
  setText(
    "first-time-buyers-avg-years",
    summary.averageYearsSinceLastBuy != null
      ? Number(summary.averageYearsSinceLastBuy).toFixed(1)
      : "—"
  );
  const highest = summary.highestConviction;
  setText(
    "first-time-buyers-highest",
    highest
      ? `${highest.ticker} · ${Number(highest.score).toFixed(1)}`
      : "—"
  );
  setText(
    "first-time-buyers-capital",
    summary.totalCapitalInvested != null
      ? formatInsiderClusterBuyValue(summary.totalCapitalInvested)
      : "—"
  );

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || firstTimeBuyersPage;
  const pageSize = Number(payload?.pageSize) || FIRST_TIME_BUYERS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} trade${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (firstTimeBuyersLoading && !payload) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">Loading first-time buyers…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No first-time / long-gap buys match these filters. Run <code class="inline-code">npm run insiders:warm-first-time-buyers</code> if the cache is empty.</td></tr>`;
    if (meta) meta.textContent = total === 0 ? "No results" : "Empty page";
  } else {
    const offset = (page - 1) * pageSize;
    if (meta) {
      meta.textContent = `Page ${page} of ${totalPages} · gap ≥${payload?.minYearsThreshold ?? 3}y · sorted by ${firstTimeBuyersSortKey}`;
    }
    body.innerHTML = rows
      .map((row, i) => {
        const rank = offset + i + 1;
        const yearsLabel = row.firstEverPurchase
          ? "First ever"
          : Number.isFinite(Number(row.yearsSinceLastBuy))
            ? `${Number(row.yearsSinceLastBuy).toFixed(1)}y`
            : "—";
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        return `<tr>
          <td class="mono num">${rank}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td>${escapeHtml(row.insiderName || "—")}</td>
          <td>${escapeHtml(row.role || row.title || "—")}</td>
          <td class="mono num">${escapeHtml(yearsLabel)}</td>
          <td class="mono">${escapeHtml(row.previousBuyDate || "—")}</td>
          <td class="mono num">${escapeHtml(formatInsiderClusterBuyValue(row.purchaseValue))}</td>
          <td class="mono num">${Number(row.firstTimeBuyerScore).toFixed(1)}</td>
          <td><span class="${escapeHtml(firstTimeBuyerLabelClass(row.classification))}">${escapeHtml(row.classification || "—")}</span></td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadFirstTimeBuyersHub() {
  if (firstTimeBuyersLoading) {
    renderFirstTimeBuyersHub();
    return;
  }
  firstTimeBuyersLoading = true;
  renderFirstTimeBuyersHub();
  const requestKey = JSON.stringify(firstTimeBuyersQueryParams());
  try {
    lastFirstTimeBuyersPayload = await apiJson(
      "/api/insiders/first-time-buyers",
      firstTimeBuyersQueryParams()
    );
  } catch (err) {
    lastFirstTimeBuyersPayload = null;
    const body = document.getElementById("first-time-buyers-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    firstTimeBuyersLoading = false;
    if (JSON.stringify(firstTimeBuyersQueryParams()) !== requestKey) {
      void loadFirstTimeBuyersHub();
      return;
    }
    renderFirstTimeBuyersHub();
  }
}

function setupFirstTimeBuyersHub() {
  if (firstTimeBuyersBound) return;
  firstTimeBuyersBound = true;

  document.getElementById("first-time-buyers-prev")?.addEventListener("click", () => {
    if (firstTimeBuyersPage <= 1) return;
    firstTimeBuyersPage -= 1;
    void loadFirstTimeBuyersHub();
  });
  document.getElementById("first-time-buyers-next")?.addEventListener("click", () => {
    firstTimeBuyersPage += 1;
    void loadFirstTimeBuyersHub();
  });

  const panel = document.getElementById("insider-first-time-buyers-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-first-time-buyers-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-first-time-buyers-sort");
      if (!key) return;
      if (firstTimeBuyersSortKey === key) {
        firstTimeBuyersSortDir = firstTimeBuyersSortDir === "desc" ? "asc" : "desc";
      } else {
        firstTimeBuyersSortKey = key;
        firstTimeBuyersSortDir = key === "ticker" ? "asc" : "desc";
      }
      firstTimeBuyersPage = 1;
      void loadFirstTimeBuyersHub();
    }
  });

  [
    "first-time-buyers-min-score",
    "first-time-buyers-min-years",
    "first-time-buyers-first-ever",
    "first-time-buyers-date-from",
    "first-time-buyers-date-to",
    "first-time-buyers-role",
    "first-time-buyers-sector",
    "first-time-buyers-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncFirstTimeBuyersFiltersFromDom();
      firstTimeBuyersPage = 1;
      void loadFirstTimeBuyersHub();
    });
  });

  let searchTimer = null;
  const debounceReload = () => {
    syncFirstTimeBuyersFiltersFromDom();
    firstTimeBuyersPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadFirstTimeBuyersHub(), 250);
  };
  document.getElementById("first-time-buyers-ticker")?.addEventListener("input", debounceReload);
  document.getElementById("first-time-buyers-search")?.addEventListener("input", debounceReload);
}

function heavySellingLabelClass(label) {
  if (label === "Extreme Insider Selling") {
    return "heavy-selling-label heavy-selling-label--extreme";
  }
  if (label === "Heavy Selling") return "heavy-selling-label heavy-selling-label--heavy";
  if (label === "Elevated Selling") return "heavy-selling-label heavy-selling-label--elevated";
  return "heavy-selling-label heavy-selling-label--normal";
}

function heavySellingQueryParams() {
  return {
    minScore: heavySellingFilters.minScore || undefined,
    minUniqueSellers: heavySellingFilters.minUniqueSellers || undefined,
    minTransactionValue: heavySellingFilters.minTransactionValue || undefined,
    clusterOnly: heavySellingFilters.clusterOnly ? "1" : undefined,
    clusterWindowDays: heavySellingFilters.clusterWindowDays || undefined,
    dateFrom: heavySellingFilters.dateFrom || undefined,
    dateTo: heavySellingFilters.dateTo || undefined,
    role: heavySellingFilters.role || undefined,
    sector: heavySellingFilters.sector || undefined,
    marketCap: heavySellingFilters.marketCap || undefined,
    ticker: heavySellingFilters.ticker || undefined,
    search: heavySellingFilters.search || undefined,
    page: heavySellingPage,
    pageSize: HEAVY_SELLING_PAGE_SIZE,
    sort: heavySellingSortKey,
    sortDir: heavySellingSortDir,
  };
}

function syncHeavySellingFiltersFromDom() {
  heavySellingFilters.minScore =
    Number(document.getElementById("heavy-selling-min-score")?.value || 0) || 0;
  heavySellingFilters.minUniqueSellers =
    Number(document.getElementById("heavy-selling-min-sellers")?.value || 0) || 0;
  const minValueRaw = document.getElementById("heavy-selling-min-value")?.value;
  heavySellingFilters.minTransactionValue =
    minValueRaw != null && String(minValueRaw).trim() !== ""
      ? String(Number(minValueRaw) || "")
      : "";
  heavySellingFilters.clusterOnly = !!document.getElementById("heavy-selling-cluster-only")
    ?.checked;
  heavySellingFilters.clusterWindowDays =
    Number(document.getElementById("heavy-selling-window")?.value || 30) || 30;
  heavySellingFilters.dateFrom = document.getElementById("heavy-selling-date-from")?.value || "";
  heavySellingFilters.dateTo = document.getElementById("heavy-selling-date-to")?.value || "";
  heavySellingFilters.role = document.getElementById("heavy-selling-role")?.value || "";
  heavySellingFilters.sector = document.getElementById("heavy-selling-sector")?.value || "";
  heavySellingFilters.marketCap = document.getElementById("heavy-selling-mcap")?.value || "";
  heavySellingFilters.ticker = String(document.getElementById("heavy-selling-ticker")?.value || "")
    .trim()
    .toUpperCase();
  heavySellingFilters.search = document.getElementById("heavy-selling-search")?.value || "";
}

function renderHeavySellingFilterOptions(payload) {
  const sectorSelect = document.getElementById("heavy-selling-sector");
  if (sectorSelect) {
    const current = heavySellingFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setVal("heavy-selling-min-score", String(heavySellingFilters.minScore || 0));
  setVal("heavy-selling-min-sellers", String(heavySellingFilters.minUniqueSellers || 0));
  setVal("heavy-selling-min-value", heavySellingFilters.minTransactionValue || "");
  setVal("heavy-selling-window", String(heavySellingFilters.clusterWindowDays || 30));
  setVal("heavy-selling-date-from", heavySellingFilters.dateFrom || "");
  setVal("heavy-selling-date-to", heavySellingFilters.dateTo || "");
  setVal("heavy-selling-role", heavySellingFilters.role || "");
  setVal("heavy-selling-mcap", heavySellingFilters.marketCap || "");
  const clusterOnly = document.getElementById("heavy-selling-cluster-only");
  if (clusterOnly) clusterOnly.checked = !!heavySellingFilters.clusterOnly;
  const ticker = document.getElementById("heavy-selling-ticker");
  if (ticker && ticker.value !== heavySellingFilters.ticker) {
    ticker.value = heavySellingFilters.ticker || "";
  }
  const search = document.getElementById("heavy-selling-search");
  if (search && search.value !== heavySellingFilters.search) {
    search.value = heavySellingFilters.search || "";
  }
}

function renderHeavySellingHub() {
  setupHeavySellingHub();
  const payload = lastHeavySellingPayload;
  const body = document.getElementById("heavy-selling-body");
  const meta = document.getElementById("heavy-selling-meta");
  const countEl = document.getElementById("heavy-selling-count");
  const pagination = document.getElementById("heavy-selling-pagination");
  const pageInfo = document.getElementById("heavy-selling-page-info");
  const prevBtn = document.getElementById("heavy-selling-prev");
  const nextBtn = document.getElementById("heavy-selling-next");
  const loading = document.getElementById("heavy-selling-loading");

  if (loading) loading.hidden = !heavySellingLoading;

  document.querySelectorAll("[data-heavy-selling-sort]").forEach((btn) => {
    const key = btn.dataset.heavySellingSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === heavySellingSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (heavySellingSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${heavySellingSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  if (payload) renderHeavySellingFilterOptions(payload);

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  const largest = summary.largestInsiderSale;
  setText(
    "heavy-selling-largest",
    largest
      ? `${largest.ticker} · ${formatInsiderClusterBuyValue(largest.value)}`
      : "—"
  );
  setText("heavy-selling-clusters", formatInteger(summary.clusterSellingEvents ?? 0));
  setText("heavy-selling-executives", formatInteger(summary.executiveSellers ?? 0));
  setText(
    "heavy-selling-total",
    summary.totalInsiderSelling != null
      ? formatInsiderClusterBuyValue(summary.totalInsiderSelling)
      : "—"
  );

  const total = Number(payload?.total) || 0;
  const page = Number(payload?.page) || heavySellingPage;
  const pageSize = Number(payload?.pageSize) || HEAVY_SELLING_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) {
    countEl.textContent = total
      ? `${formatInteger(total)} ticker${total === 1 ? "" : "s"}`
      : "No matches";
  }

  if (!body) return;

  if (heavySellingLoading && !payload) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">Loading heavy selling…</td></tr>`;
    if (meta) meta.textContent = "Loading…";
    return;
  }

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No heavy selling matches these filters. Run <code class="inline-code">npm run insiders:warm-heavy-selling</code> if the cache is empty.</td></tr>`;
    if (meta) meta.textContent = total === 0 ? "No results" : "Empty page";
  } else {
    const offset = (page - 1) * pageSize;
    const windowDays = payload?.clusterWindowDays ?? heavySellingFilters.clusterWindowDays ?? 30;
    if (meta) {
      meta.textContent = `Page ${page} of ${totalPages} · cluster ${windowDays}d`;
    }
    body.innerHTML = rows
      .map((row, i) => {
        const rank = offset + i + 1;
        const companyRaw = String(row.companyName || "").trim();
        const company =
          companyRaw && !/^n\/?a$/i.test(companyRaw) && companyRaw !== "—" ? companyRaw : "";
        const stockLabel = company
          ? `<span class="most-accumulated-stock__name">${escapeHtml(company)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker || "—")}</span>`;
        const valueSold = formatInsiderClusterBuyValue(row.valueSold);
        const largestSale = formatInsiderClusterBuyValue(row.largestSale);
        const classification =
          row.classification && !/^n\/?a$/i.test(String(row.classification).trim())
            ? row.classification
            : "";
        return `<tr>
          <td class="mono num">${rank}</td>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td class="mono num">${formatInteger(row.uniqueSellers ?? 0)}</td>
          <td class="mono num">${formatInteger(row.executiveSellers ?? 0)}</td>
          <td class="mono num">${formatInteger(row.sharesSold ?? 0)}</td>
          <td class="mono num">${escapeHtml(valueSold === "—" ? "" : valueSold)}</td>
          <td class="mono num">${escapeHtml(largestSale === "—" ? "" : largestSale)}</td>
          <td class="mono num">${Number(row.heavySellingScore).toFixed(1)}</td>
          <td>${classification ? `<span class="${escapeHtml(heavySellingLabelClass(classification))}">${escapeHtml(classification)}</span>` : ""}</td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadHeavySellingHub() {
  if (heavySellingLoading) {
    renderHeavySellingHub();
    return;
  }
  heavySellingLoading = true;
  renderHeavySellingHub();
  const requestKey = JSON.stringify(heavySellingQueryParams());
  try {
    lastHeavySellingPayload = await apiJson("/api/insiders/heavy-selling", heavySellingQueryParams());
  } catch (err) {
    lastHeavySellingPayload = null;
    const body = document.getElementById("heavy-selling-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    heavySellingLoading = false;
    if (JSON.stringify(heavySellingQueryParams()) !== requestKey) {
      void loadHeavySellingHub();
      return;
    }
    renderHeavySellingHub();
  }
}

function setupHeavySellingHub() {
  if (heavySellingBound) return;
  heavySellingBound = true;

  document.getElementById("heavy-selling-prev")?.addEventListener("click", () => {
    if (heavySellingPage <= 1) return;
    heavySellingPage -= 1;
    void loadHeavySellingHub();
  });
  document.getElementById("heavy-selling-next")?.addEventListener("click", () => {
    heavySellingPage += 1;
    void loadHeavySellingHub();
  });

  const panel = document.getElementById("insider-heavy-selling-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-heavy-selling-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-heavy-selling-sort");
      if (!key) return;
      if (heavySellingSortKey === key) {
        heavySellingSortDir = heavySellingSortDir === "desc" ? "asc" : "desc";
      } else {
        heavySellingSortKey = key;
        heavySellingSortDir = key === "ticker" ? "asc" : "desc";
      }
      heavySellingPage = 1;
      void loadHeavySellingHub();
    }
  });

  [
    "heavy-selling-min-score",
    "heavy-selling-min-sellers",
    "heavy-selling-min-value",
    "heavy-selling-cluster-only",
    "heavy-selling-window",
    "heavy-selling-date-from",
    "heavy-selling-date-to",
    "heavy-selling-role",
    "heavy-selling-sector",
    "heavy-selling-mcap",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncHeavySellingFiltersFromDom();
      heavySellingPage = 1;
      void loadHeavySellingHub();
    });
  });

  let searchTimer = null;
  const debounceReload = () => {
    syncHeavySellingFiltersFromDom();
    heavySellingPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadHeavySellingHub(), 250);
  };
  document.getElementById("heavy-selling-ticker")?.addEventListener("input", debounceReload);
  document.getElementById("heavy-selling-search")?.addEventListener("input", debounceReload);
}

function setupTopInstitutionNewEntriesHub() {
  if (topInstitutionEntriesBound) return;
  topInstitutionEntriesBound = true;
  document.getElementById("top-institution-entries-funds-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-top-institution-id]");
    if (!btn) return;
    const id = btn.getAttribute("data-top-institution-id");
    if (!id || id === topInstitutionEntriesSelectedId) return;
    topInstitutionEntriesSelectedId = id;
    renderTopInstitutionNewEntriesHub();
  });
  document.getElementById("signals-top-institution-entries-hub")?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-top-institution-entries-sort]");
    if (!sortBtn) return;
    const key = sortBtn.getAttribute("data-top-institution-entries-sort");
    if (!key) return;
    if (topInstitutionEntriesSortKey === key) {
      topInstitutionEntriesSortDir = topInstitutionEntriesSortDir === "asc" ? "desc" : "asc";
    } else {
      topInstitutionEntriesSortKey = key;
      topInstitutionEntriesSortDir = "desc";
    }
    renderTopInstitutionNewEntriesHub();
  });
}

function sortTopInstitutionFundEntries(rows) {
  const mul = topInstitutionEntriesSortDir === "asc" ? 1 : -1;
  const key = topInstitutionEntriesSortKey;
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (key === "shares") {
      cmp = (Number(a.currentShares) || 0) - (Number(b.currentShares) || 0);
    } else if (key === "quarter") {
      cmp = String(a.quarter || "").localeCompare(String(b.quarter || ""));
    } else {
      cmp = (Number(a.currentValueUsd) || 0) - (Number(b.currentValueUsd) || 0);
    }
    if (cmp !== 0) return cmp * mul;
    return String(a.ticker || "").localeCompare(String(b.ticker || ""));
  });
}

function updateTopInstitutionEntriesSortButtons() {
  document.querySelectorAll("[data-top-institution-entries-sort]").forEach((btn) => {
    const key = btn.getAttribute("data-top-institution-entries-sort");
    const active = key === topInstitutionEntriesSortKey;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (topInstitutionEntriesSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${topInstitutionEntriesSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });
}

function renderTopInstitutionNewEntriesHub() {
  const fundsList = document.getElementById("top-institution-entries-funds-list");
  const fundsMeta = document.getElementById("top-institution-entries-funds-meta");
  const body = document.getElementById("top-institution-entries-body");
  const meta = document.getElementById("top-institution-entries-meta");
  const heading = document.getElementById("top-institution-entries-table-heading");
  if (!body || !fundsList) return;

  updateTopInstitutionEntriesSortButtons();

  const data = lastTopInstitutionNewEntries;
  if (!data) {
    fundsList.innerHTML = `<p class="muted small">No data loaded.</p>`;
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">No data loaded.</td></tr>`;
    return;
  }

  const institutions = Array.isArray(data.institutions) ? data.institutions : [];
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const instCount = data.topInstitutionCount ?? institutions.length;

  if (!institutions.length) {
    fundsList.innerHTML = `<p class="muted small">No top institutions available.</p>`;
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">No new entries from top performers this quarter. Run <code class="inline-code">npm run performance:warm-cache</code> and <code class="inline-code">npm run signals:warm-top-entries</code> if needed.</td></tr>`;
    if (fundsMeta) fundsMeta.textContent = `Top ${instCount} by rolling 1Y · ${data.asOfQuarter || "—"}`;
    if (meta) meta.textContent = "";
    return;
  }

  if (
    !topInstitutionEntriesSelectedId ||
    !institutions.some((i) => i.institutionId === topInstitutionEntriesSelectedId)
  ) {
    topInstitutionEntriesSelectedId = institutions[0].institutionId;
  }

  const selected =
    institutions.find((i) => i.institutionId === topInstitutionEntriesSelectedId) || institutions[0];

  if (fundsMeta) {
    fundsMeta.textContent = `Top ${instCount} by rolling 1Y · ${data.asOfQuarter || "—"}`;
  }

  fundsList.innerHTML = institutions
    .map((inst) => {
      const active = inst.institutionId === selected.institutionId;
      const count = Number(inst.newEntryCount) || 0;
      return `<button type="button" class="top-institution-entries-fund${active ? " is-active" : ""}" role="option" aria-selected="${active}" data-top-institution-id="${escapeHtml(inst.institutionId)}">
        <span class="top-institution-entries-fund__rank mono">#${inst.rank}</span>
        <span class="top-institution-entries-fund__name">${escapeHtml(inst.name)}</span>
        <span class="top-institution-entries-fund__return mono">${escapeHtml(formatInstitutionPerformancePct(inst.rolling1yReturn))}</span>
        <span class="top-institution-entries-fund__count">${count} new</span>
      </button>`;
    })
    .join("");

  const fundEntries = sortTopInstitutionFundEntries(
    entries.filter((row) => row.institutionId === selected.institutionId)
  );

  if (heading) heading.textContent = `New positions · ${selected.name}`;
  if (meta) {
    meta.textContent = `${fundEntries.length} new position${fundEntries.length === 1 ? "" : "s"} · ${selected.quarter || data.asOfQuarter || "—"}`;
  }

  if (!fundEntries.length) {
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">No new positions with tickers for this fund in the latest filing.</td></tr>`;
    return;
  }

  body.innerHTML = fundEntries
    .map(
      (row) => `<tr>
        <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</a></td>
        <td>${escapeHtml(row.issuer || "—")}</td>
        <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.currentValueUsd, "USD"))}</td>
        <td class="mono num">${escapeHtml(formatShareCount(row.currentShares))}</td>
        <td class="mono">${escapeHtml(row.quarter || "—")}</td>
      </tr>`
    )
    .join("");
}

async function loadTopInstitutionNewEntriesHub() {
  setupTopInstitutionNewEntriesHub();
  const body = document.getElementById("top-institution-entries-body");
  const meta = document.getElementById("top-institution-entries-meta");
  const fundsList = document.getElementById("top-institution-entries-funds-list");
  const fundsMeta = document.getElementById("top-institution-entries-funds-meta");
  if (!body) return;

  if (lastTopInstitutionNewEntries) {
    renderTopInstitutionNewEntriesHub();
    return;
  }

  body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Loading new entries…</td></tr>`;
  if (meta) meta.textContent = "Loading…";
  if (fundsMeta) fundsMeta.textContent = "Loading…";
  if (fundsList) fundsList.innerHTML = `<p class="muted small">Loading funds…</p>`;

  try {
    const data = await apiJson("/api/signals/top-institution-new-entries");
    lastTopInstitutionNewEntries = data;
    const institutions = Array.isArray(data?.institutions) ? data.institutions : [];
    topInstitutionEntriesSelectedId = institutions[0]?.institutionId || null;
    renderTopInstitutionNewEntriesHub();
  } catch (err) {
    lastTopInstitutionNewEntries = null;
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    if (meta) meta.textContent = "Failed to load";
    if (fundsMeta) fundsMeta.textContent = "Failed to load";
    if (fundsList) fundsList.innerHTML = `<p class="muted small">Failed to load funds.</p>`;
  }
}

function formatDoubleSignalDate(value) {
  if (!value) return "—";
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
  return String(value);
}

function matchesDoubleSignalInsiderRole(row, role) {
  if (!role) return true;
  const flags = row.insiderRoles || {};
  if (role === "ceo") return !!flags.ceo;
  if (role === "director") return !!flags.director;
  if (role === "officer") return !!flags.officer;
  return true;
}

function filterDoubleSignalRows(rows) {
  const q = doubleSignalFilters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (doubleSignalFilters.institution) {
      const ids = Array.isArray(row.institutionIds) ? row.institutionIds : [];
      if (!ids.includes(doubleSignalFilters.institution)) return false;
    }
    if (!matchesDoubleSignalInsiderRole(row, doubleSignalFilters.insiderRole)) return false;
    if (doubleSignalFilters.sector && row.sector !== doubleSignalFilters.sector) return false;
    if (
      doubleSignalFilters.minInstValue > 0 &&
      (row.largestInstitutionalPositionUsd == null ||
        row.largestInstitutionalPositionUsd < doubleSignalFilters.minInstValue)
    ) {
      return false;
    }
    if (
      doubleSignalFilters.minInsiderValue > 0 &&
      (row.largestInsiderPurchaseUsd == null ||
        row.largestInsiderPurchaseUsd < doubleSignalFilters.minInsiderValue)
    ) {
      return false;
    }
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

function sortDoubleSignalRows(rows) {
  const key = doubleSignalSortKey;
  const dir = doubleSignalSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "companyName") {
      const av = String(a.companyName || a.ticker || "").toLowerCase();
      const bv = String(b.companyName || b.ticker || "").toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    if (key === "ticker") {
      return String(a.ticker || "").localeCompare(String(b.ticker || "")) * dir;
    }
    if (key === "latestInstitutionalFilingDate" || key === "latestInsiderPurchaseDate") {
      const av = Date.parse(a[key] || "") || 0;
      const bv = Date.parse(b[key] || "") || 0;
      return (av - bv) * dir;
    }
    const av = Number(a[key]);
    const bv = Number(b[key]);
    const an = Number.isFinite(av) ? av : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bv) ? bv : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir;
  });
}

function renderDoubleSignalSummary(payload, filteredCount) {
  const summary = payload?.summary || {};
  const totalEl = document.getElementById("double-signal-total");
  const stocksEl = document.getElementById("double-signal-unique-stocks");
  const instEl = document.getElementById("double-signal-institutions");
  const insiderEl = document.getElementById("double-signal-insider-purchases");
  if (totalEl) totalEl.textContent = formatInteger(filteredCount);
  if (stocksEl) stocksEl.textContent = formatInteger(filteredCount);
  if (instEl) instEl.textContent = formatInteger(summary.institutionsInvolved ?? 0);
  if (insiderEl) insiderEl.textContent = formatInteger(summary.insiderPurchases ?? 0);
}

function renderDoubleSignalFilterOptions(payload) {
  const institutionSelect = document.getElementById("double-signal-institution");
  const sectorSelect = document.getElementById("double-signal-sector");
  const windowSelect = document.getElementById("double-signal-window");
  if (windowSelect) windowSelect.value = String(doubleSignalWindowDays);
  if (institutionSelect) {
    const current = doubleSignalFilters.institution;
    institutionSelect.innerHTML =
      `<option value="">All institutions</option>` +
      (Array.isArray(payload?.institutions) ? payload.institutions : [])
        .map((inst) => `<option value="${escapeHtml(inst.cik)}">${escapeHtml(inst.name)}</option>`)
        .join("");
    institutionSelect.value = current;
  }
  if (sectorSelect) {
    const current = doubleSignalFilters.sector;
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("");
    sectorSelect.value = current;
  }
}

function renderDoubleSignalTableRows(rows) {
  const body = document.getElementById("double-signal-body");
  const meta = document.getElementById("double-signal-meta");
  const countEl = document.getElementById("double-signal-count");
  const pagination = document.getElementById("double-signal-pagination");
  const pageInfo = document.getElementById("double-signal-page-info");
  const prevBtn = document.getElementById("double-signal-prev");
  const nextBtn = document.getElementById("double-signal-next");
  if (!body) return;

  document.querySelectorAll("[data-double-signal-sort]").forEach((btn) => {
    const key = btn.dataset.doubleSignalSort;
    const active = key === doubleSignalSortKey;
    const label = btn.textContent.replace(/\s*[▲▼]$/, "").trim();
    btn.setAttribute("aria-sort", active ? (doubleSignalSortDir === "asc" ? "ascending" : "descending") : "none");
    btn.textContent = active ? `${label} ${doubleSignalSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / DOUBLE_SIGNAL_PAGE_SIZE));
  if (doubleSignalPage > totalPages) doubleSignalPage = totalPages;
  if (doubleSignalPage < 1) doubleSignalPage = 1;
  const start = (doubleSignalPage - 1) * DOUBLE_SIGNAL_PAGE_SIZE;
  const pageRows = rows.slice(start, start + DOUBLE_SIGNAL_PAGE_SIZE);

  if (countEl) {
    countEl.textContent =
      rows.length === 0 ? "No matches" : `${formatInteger(rows.length)} signal${rows.length === 1 ? "" : "s"}`;
  }
  if (meta && lastDoubleSignalPayload) {
    const windowLabel =
      doubleSignalWindowDays === 365 ? "1 year" : `${doubleSignalWindowDays} days`;
    meta.textContent = `${windowLabel} · latest 13F ${lastDoubleSignalPayload.latest13fFilingDate || "—"}`;
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No double signals match the current filters. Run <code class="inline-code">npm run signals:warm-double-signal</code> if data is missing.</td></tr>`;
    if (pagination) pagination.hidden = true;
    return;
  }

  body.innerHTML = pageRows
    .map(
      (row) => `<tr class="double-signal-row" data-double-signal-ticker="${escapeHtml(row.ticker)}" tabindex="0" role="link">
        <td>${escapeHtml(row.companyName || "—")}</td>
        <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</a></td>
        <td class="mono num">${formatInteger(row.institutionCount)}</td>
        <td class="mono num">${formatInteger(row.insiderPurchaseCount)}</td>
        <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.largestInstitutionalPositionUsd, "USD"))}</td>
        <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.largestInsiderPurchaseUsd, "USD"))}</td>
        <td class="mono">${escapeHtml(formatDoubleSignalDate(row.latestInstitutionalFilingDate))}</td>
        <td class="mono">${escapeHtml(formatDoubleSignalDate(row.latestInsiderPurchaseDate))}</td>
        <td class="mono num"><strong>${Number(row.signalStrengthScore).toFixed(0)}</strong></td>
      </tr>`
    )
    .join("");

  if (pagination) {
    pagination.hidden = rows.length <= DOUBLE_SIGNAL_PAGE_SIZE;
    if (pageInfo) pageInfo.textContent = `Page ${doubleSignalPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = doubleSignalPage <= 1;
    if (nextBtn) nextBtn.disabled = doubleSignalPage >= totalPages;
  }
}

function renderDoubleSignalListView() {
  const listPanel = document.getElementById("double-signal-list-panel");
  const detailPanel = document.getElementById("double-signal-detail");
  const summary = document.getElementById("double-signal-summary");
  const toolbar = document.querySelector("#signals-double-signal-hub .institution-most-accumulated__toolbar");
  if (listPanel) listPanel.hidden = false;
  if (detailPanel) detailPanel.hidden = true;
  if (summary) summary.hidden = false;
  if (toolbar) toolbar.hidden = false;

  const rows = sortDoubleSignalRows(filterDoubleSignalRows(lastDoubleSignalPayload?.signals || []));
  renderDoubleSignalSummary(lastDoubleSignalPayload, rows.length);
  renderDoubleSignalTableRows(rows);
}

async function renderDoubleSignalDetail(ticker) {
  const sym = String(ticker || "").trim().toUpperCase();
  if (!sym) return;

  const listPanel = document.getElementById("double-signal-list-panel");
  const detailPanel = document.getElementById("double-signal-detail");
  const summary = document.getElementById("double-signal-summary");
  const toolbar = document.querySelector("#signals-double-signal-hub .institution-most-accumulated__toolbar");
  if (listPanel) listPanel.hidden = true;
  if (detailPanel) detailPanel.hidden = false;
  if (summary) summary.hidden = true;
  if (toolbar) toolbar.hidden = true;

  const tickerEl = document.getElementById("double-signal-detail-ticker");
  const companyEl = document.getElementById("double-signal-detail-company");
  const scoreEl = document.getElementById("double-signal-detail-score");
  const subtitleEl = document.getElementById("double-signal-detail-subtitle");
  const instBody = document.getElementById("double-signal-detail-inst-body");
  const insiderBody = document.getElementById("double-signal-detail-insider-body");
  const timelineEl = document.getElementById("double-signal-timeline");

  if (tickerEl) tickerEl.textContent = sym;
  if (companyEl) companyEl.textContent = "";
  if (scoreEl) scoreEl.textContent = "…";
  if (subtitleEl) {
    subtitleEl.textContent = `Loading ${doubleSignalWindowDays}-day activity…`;
  }
  if (instBody) instBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Loading…</td></tr>`;
  if (insiderBody) insiderBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Loading…</td></tr>`;
  if (timelineEl) timelineEl.innerHTML = "";

  try {
    const detail = await apiJson(`/api/signals/double-signal/${encodeURIComponent(sym)}`, {
      window: doubleSignalWindowDays,
    });
    if (companyEl) {
      companyEl.textContent = detail.companyName ? ` · ${detail.companyName}` : "";
    }
    if (scoreEl) scoreEl.textContent = `${Number(detail.signalStrengthScore).toFixed(0)} / 100`;
    if (subtitleEl) {
      const windowLabel = doubleSignalWindowDays === 365 ? "1 year" : `${doubleSignalWindowDays} days`;
      subtitleEl.textContent = `${windowLabel} window · ${detail.sector || "Unknown sector"}`;
    }

    const instRows = Array.isArray(detail.institutionEvents) ? detail.institutionEvents : [];
    const insiderRows = Array.isArray(detail.insiderEvents) ? detail.insiderEvents : [];
    const timeline = Array.isArray(detail.timeline) ? detail.timeline : [];

    if (instBody) {
      instBody.innerHTML = instRows.length
        ? instRows
            .map(
              (row) => `<tr>
              <td><a href="${institutionPath(bareInstitutionCik(row.institutionId), "activity")}" class="ownership-fund__link" data-institution-cik="${escapeHtml(bareInstitutionCik(row.institutionId))}">${escapeHtml(row.institutionName)}</a></td>
              <td>${escapeHtml(row.buyType === "new" ? "New position" : "Position increase")}</td>
              <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.positionValueUsd, "USD"))}</td>
              <td class="mono num">${escapeHtml(formatShareCount(row.sharesChange))}</td>
              <td class="mono">${escapeHtml(formatDoubleSignalDate(row.filingDate))}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="trades-table__empty">No institutional activity</td></tr>`;
    }

    if (insiderBody) {
      insiderBody.innerHTML = insiderRows.length
        ? insiderRows
            .map(
              (row) => `<tr>
              <td>${escapeHtml(row.insiderName)}</td>
              <td>${escapeHtml(row.insiderTitle || "—")}</td>
              <td class="mono num">${escapeHtml(formatHoldingValueUsd(Math.abs(Number(row.transactionValue) || 0), "USD"))}</td>
              <td class="mono num">${escapeHtml(formatShareCount(row.shares))}</td>
              <td class="mono">${escapeHtml(formatDoubleSignalDate(row.transactionDate))}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="trades-table__empty">No insider purchases</td></tr>`;
    }

    if (timelineEl) {
      timelineEl.innerHTML = timeline.length
        ? timeline
            .map(
              (event) => `<li class="double-signal-timeline__item double-signal-timeline__item--${escapeHtml(event.type)}">
              <span class="double-signal-timeline__date mono">${escapeHtml(formatDoubleSignalDate(event.date))}</span>
              <span class="double-signal-timeline__type">${event.type === "institution" ? "Institution buy" : "Insider buy"}</span>
              <strong>${escapeHtml(event.label)}</strong>
              <span class="muted small">${escapeHtml(event.detail || "")}</span>
              ${event.valueUsd != null ? `<span class="mono num">${escapeHtml(formatHoldingValueUsd(event.valueUsd, "USD"))}</span>` : ""}
            </li>`
            )
            .join("")
        : `<li class="trades-table__empty">No timeline events</li>`;
    }
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (instBody) instBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    if (insiderBody) insiderBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    if (timelineEl) timelineEl.innerHTML = `<li class="trades-table__empty">${msg}</li>`;
  }
}

function syncDoubleSignalFiltersFromDom() {
  doubleSignalWindowDays = Number(document.getElementById("double-signal-window")?.value || 90) || 90;
  if (doubleSignalWindowDays !== 90 && doubleSignalWindowDays !== 180 && doubleSignalWindowDays !== 365) {
    doubleSignalWindowDays = 90;
  }
  doubleSignalFilters.institution = document.getElementById("double-signal-institution")?.value || "";
  doubleSignalFilters.insiderRole = document.getElementById("double-signal-insider-role")?.value || "";
  doubleSignalFilters.sector = document.getElementById("double-signal-sector")?.value || "";
  doubleSignalFilters.search = document.getElementById("double-signal-search")?.value || "";
  doubleSignalFilters.minInstValue =
    Number(document.getElementById("double-signal-min-inst-value")?.value || 0) || 0;
  doubleSignalFilters.minInsiderValue =
    Number(document.getElementById("double-signal-min-insider-value")?.value || 0) || 0;
}

async function loadDoubleSignalHub() {
  const loading = document.getElementById("double-signal-loading");
  if (activeDoubleSignalTicker) {
    if (loading) loading.hidden = true;
    await renderDoubleSignalDetail(activeDoubleSignalTicker);
    return;
  }

  if (loading) loading.hidden = !doubleSignalLoading;
  if (doubleSignalLoading) return;

  doubleSignalLoading = true;
  if (loading) loading.hidden = false;
  try {
    lastDoubleSignalPayload = await apiJson("/api/signals/double-signal", {
      window: doubleSignalWindowDays,
    });
    renderDoubleSignalFilterOptions(lastDoubleSignalPayload);
    renderDoubleSignalListView();
  } catch (err) {
    const body = document.getElementById("double-signal-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    doubleSignalLoading = false;
    if (loading) loading.hidden = true;
  }
}

function bindDoubleSignalHubControls() {
  if (doubleSignalBound) return;
  doubleSignalBound = true;

  document.getElementById("double-signal-detail-back")?.addEventListener("click", () => {
    navigateToDoubleSignal(null);
  });

  document.getElementById("double-signal-prev")?.addEventListener("click", () => {
    if (doubleSignalPage > 1) {
      doubleSignalPage -= 1;
      renderDoubleSignalListView();
    }
  });

  document.getElementById("double-signal-next")?.addEventListener("click", () => {
    doubleSignalPage += 1;
    renderDoubleSignalListView();
  });

  const panel = document.getElementById("signals-double-signal-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-double-signal-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-double-signal-sort");
      if (!key) return;
      if (doubleSignalSortKey === key) {
        doubleSignalSortDir = doubleSignalSortDir === "desc" ? "asc" : "desc";
      } else {
        doubleSignalSortKey = key;
        doubleSignalSortDir =
          key === "companyName" || key === "ticker" ? "asc" : "desc";
      }
      renderDoubleSignalListView();
      return;
    }

    const row = e.target.closest?.("[data-double-signal-ticker]");
    if (row && !e.target.closest("a")) {
      const ticker = row.getAttribute("data-double-signal-ticker");
      if (ticker) navigateToDoubleSignal(ticker);
    }
  });

  panel?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest?.("[data-double-signal-ticker]");
    if (!row) return;
    e.preventDefault();
    const ticker = row.getAttribute("data-double-signal-ticker");
    if (ticker) navigateToDoubleSignal(ticker);
  });

  [
    "double-signal-window",
    "double-signal-institution",
    "double-signal-insider-role",
    "double-signal-sector",
    "double-signal-min-inst-value",
    "double-signal-min-insider-value",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncDoubleSignalFiltersFromDom();
      doubleSignalPage = 1;
      if (id === "double-signal-window") {
        lastDoubleSignalPayload = null;
        void loadDoubleSignalHub();
      } else {
        renderDoubleSignalListView();
      }
    });
  });

  document.getElementById("double-signal-search")?.addEventListener("input", (e) => {
    doubleSignalFilters.search = e.target.value || "";
    doubleSignalPage = 1;
    renderDoubleSignalListView();
  });
}

function formatTripleSignalDate(value) {
  return formatDoubleSignalDate(value);
}

function matchesTripleSignalInsiderRole(row, role) {
  return matchesDoubleSignalInsiderRole(row, role);
}

function filterTripleSignalRows(rows) {
  const q = tripleSignalFilters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (tripleSignalFilters.institution) {
      const ids = Array.isArray(row.institutionIds) ? row.institutionIds : [];
      if (!ids.includes(tripleSignalFilters.institution)) return false;
    }
    if (!matchesTripleSignalInsiderRole(row, tripleSignalFilters.insiderRole)) return false;
    if (tripleSignalFilters.sector && row.sector !== tripleSignalFilters.sector) return false;
    if (
      tripleSignalFilters.minInstValue > 0 &&
      (row.largestInstitutionalPositionUsd == null ||
        row.largestInstitutionalPositionUsd < tripleSignalFilters.minInstValue)
    ) {
      return false;
    }
    if (
      tripleSignalFilters.minInsiderValue > 0 &&
      (row.largestInsiderPurchaseUsd == null ||
        row.largestInsiderPurchaseUsd < tripleSignalFilters.minInsiderValue)
    ) {
      return false;
    }
    if (
      tripleSignalFilters.minPoliticianValue > 0 &&
      (row.largestPoliticianPurchaseUsd == null ||
        row.largestPoliticianPurchaseUsd < tripleSignalFilters.minPoliticianValue)
    ) {
      return false;
    }
    if (!q) return true;
    const ticker = String(row.ticker || "").toLowerCase();
    const company = String(row.companyName || "").toLowerCase();
    return ticker.includes(q) || company.includes(q);
  });
}

function sortTripleSignalRows(rows) {
  const key = tripleSignalSortKey;
  const dir = tripleSignalSortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "companyName") {
      const av = String(a.companyName || a.ticker || "").toLowerCase();
      const bv = String(b.companyName || b.ticker || "").toLowerCase();
      return av.localeCompare(bv) * dir;
    }
    if (key === "ticker") {
      return String(a.ticker || "").localeCompare(String(b.ticker || "")) * dir;
    }
    if (
      key === "latestInstitutionalFilingDate" ||
      key === "latestInsiderPurchaseDate" ||
      key === "latestPoliticianPurchaseDate"
    ) {
      const av = Date.parse(a[key] || "") || 0;
      const bv = Date.parse(b[key] || "") || 0;
      return (av - bv) * dir;
    }
    const av = Number(a[key]);
    const bv = Number(b[key]);
    const an = Number.isFinite(av) ? av : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(bv) ? bv : dir < 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    return (an - bn) * dir;
  });
}

function renderTripleSignalSummary(payload, filteredCount) {
  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("triple-signal-total", formatInteger(filteredCount));
  setText("triple-signal-unique-stocks", formatInteger(filteredCount));
  setText("triple-signal-institutions", formatInteger(summary.institutionsInvolved ?? 0));
  setText("triple-signal-insider-purchases", formatInteger(summary.insiderPurchases ?? 0));
  setText("triple-signal-politician-purchases", formatInteger(summary.politicianPurchases ?? 0));
}

function renderTripleSignalFilterOptions(payload) {
  const institutionSelect = document.getElementById("triple-signal-institution");
  const sectorSelect = document.getElementById("triple-signal-sector");
  const windowSelect = document.getElementById("triple-signal-window");
  if (windowSelect) windowSelect.value = String(tripleSignalWindowDays);
  if (institutionSelect) {
    const current = tripleSignalFilters.institution;
    institutionSelect.innerHTML =
      `<option value="">All institutions</option>` +
      (Array.isArray(payload?.institutions) ? payload.institutions : [])
        .map((inst) => `<option value="${escapeHtml(inst.cik)}">${escapeHtml(inst.name)}</option>`)
        .join("");
    institutionSelect.value = current;
  }
  if (sectorSelect) {
    const current = tripleSignalFilters.sector;
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      (Array.isArray(payload?.sectors) ? payload.sectors : [])
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join("");
    sectorSelect.value = current;
  }
}

function renderTripleSignalTableRows(rows) {
  const body = document.getElementById("triple-signal-body");
  const meta = document.getElementById("triple-signal-meta");
  const countEl = document.getElementById("triple-signal-count");
  const pagination = document.getElementById("triple-signal-pagination");
  const pageInfo = document.getElementById("triple-signal-page-info");
  const prevBtn = document.getElementById("triple-signal-prev");
  const nextBtn = document.getElementById("triple-signal-next");
  if (!body) return;

  document.querySelectorAll("[data-triple-signal-sort]").forEach((btn) => {
    const key = btn.dataset.tripleSignalSort;
    const active = key === tripleSignalSortKey;
    const label = btn.textContent.replace(/\s*[▲▼]$/, "").trim();
    btn.setAttribute("aria-sort", active ? (tripleSignalSortDir === "asc" ? "ascending" : "descending") : "none");
    btn.textContent = active ? `${label} ${tripleSignalSortDir === "asc" ? "▲" : "▼"}` : label;
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / TRIPLE_SIGNAL_PAGE_SIZE));
  if (tripleSignalPage > totalPages) tripleSignalPage = totalPages;
  if (tripleSignalPage < 1) tripleSignalPage = 1;
  const start = (tripleSignalPage - 1) * TRIPLE_SIGNAL_PAGE_SIZE;
  const pageRows = rows.slice(start, start + TRIPLE_SIGNAL_PAGE_SIZE);

  if (countEl) {
    countEl.textContent =
      rows.length === 0 ? "No matches" : `${formatInteger(rows.length)} signal${rows.length === 1 ? "" : "s"}`;
  }
  if (meta && lastTripleSignalPayload) {
    const windowLabel =
      tripleSignalWindowDays === 365 ? "1 year" : `${tripleSignalWindowDays} days`;
    meta.textContent = `${windowLabel} · latest 13F ${lastTripleSignalPayload.latest13fFilingDate || "—"}`;
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="12" class="trades-table__empty">No triple signals match the current filters. Run <code class="inline-code">npm run signals:warm-triple-signal</code> if data is missing. Ensure politician disclosures are loaded via <code class="inline-code">npm run politicians:fetch-recent</code>.</td></tr>`;
    if (pagination) pagination.hidden = true;
    return;
  }

  body.innerHTML = pageRows
    .map(
      (row) => `<tr class="triple-signal-row" data-triple-signal-ticker="${escapeHtml(row.ticker)}" tabindex="0" role="link">
        <td>${escapeHtml(row.companyName || "—")}</td>
        <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</a></td>
        <td class="mono num">${formatInteger(row.institutionCount)}</td>
        <td class="mono num">${formatInteger(row.insiderPurchaseCount)}</td>
        <td class="mono num">${formatInteger(row.politicianPurchaseCount)}</td>
        <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.largestInstitutionalPositionUsd, "USD"))}</td>
        <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.largestInsiderPurchaseUsd, "USD"))}</td>
        <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.largestPoliticianPurchaseUsd, "USD"))}</td>
        <td class="mono">${escapeHtml(formatTripleSignalDate(row.latestInstitutionalFilingDate))}</td>
        <td class="mono">${escapeHtml(formatTripleSignalDate(row.latestInsiderPurchaseDate))}</td>
        <td class="mono">${escapeHtml(formatTripleSignalDate(row.latestPoliticianPurchaseDate))}</td>
        <td class="mono num"><strong>${Number(row.signalStrengthScore).toFixed(0)}</strong></td>
      </tr>`
    )
    .join("");

  if (pagination) {
    pagination.hidden = rows.length <= TRIPLE_SIGNAL_PAGE_SIZE;
    if (pageInfo) pageInfo.textContent = `Page ${tripleSignalPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = tripleSignalPage <= 1;
    if (nextBtn) nextBtn.disabled = tripleSignalPage >= totalPages;
  }
}

function renderTripleSignalListView() {
  const listPanel = document.getElementById("triple-signal-list-panel");
  const detailPanel = document.getElementById("triple-signal-detail");
  const summary = document.getElementById("triple-signal-summary");
  const toolbar = document.querySelector("#signals-triple-signal-hub .institution-most-accumulated__toolbar");
  if (listPanel) listPanel.hidden = false;
  if (detailPanel) detailPanel.hidden = true;
  if (summary) summary.hidden = false;
  if (toolbar) toolbar.hidden = false;

  const rows = sortTripleSignalRows(filterTripleSignalRows(lastTripleSignalPayload?.signals || []));
  renderTripleSignalSummary(lastTripleSignalPayload, rows.length);
  renderTripleSignalTableRows(rows);
}

async function renderTripleSignalDetail(ticker) {
  const sym = String(ticker || "").trim().toUpperCase();
  if (!sym) return;

  const listPanel = document.getElementById("triple-signal-list-panel");
  const detailPanel = document.getElementById("triple-signal-detail");
  const summary = document.getElementById("triple-signal-summary");
  const toolbar = document.querySelector("#signals-triple-signal-hub .institution-most-accumulated__toolbar");
  if (listPanel) listPanel.hidden = true;
  if (detailPanel) detailPanel.hidden = false;
  if (summary) summary.hidden = true;
  if (toolbar) toolbar.hidden = true;

  const tickerEl = document.getElementById("triple-signal-detail-ticker");
  const companyEl = document.getElementById("triple-signal-detail-company");
  const scoreEl = document.getElementById("triple-signal-detail-score");
  const subtitleEl = document.getElementById("triple-signal-detail-subtitle");
  const instBody = document.getElementById("triple-signal-detail-inst-body");
  const insiderBody = document.getElementById("triple-signal-detail-insider-body");
  const polBody = document.getElementById("triple-signal-detail-politician-body");
  const timelineEl = document.getElementById("triple-signal-timeline");

  if (tickerEl) tickerEl.textContent = sym;
  if (companyEl) companyEl.textContent = "";
  if (scoreEl) scoreEl.textContent = "…";
  if (subtitleEl) {
    subtitleEl.textContent = `Loading ${tripleSignalWindowDays}-day activity…`;
  }
  if (instBody) instBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Loading…</td></tr>`;
  if (insiderBody) insiderBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Loading…</td></tr>`;
  if (polBody) polBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Loading…</td></tr>`;
  if (timelineEl) timelineEl.innerHTML = "";

  try {
    const detail = await apiJson(`/api/signals/triple-signal/${encodeURIComponent(sym)}`, {
      window: tripleSignalWindowDays,
    });
    if (companyEl) {
      companyEl.textContent = detail.companyName ? ` · ${detail.companyName}` : "";
    }
    if (scoreEl) scoreEl.textContent = `${Number(detail.signalStrengthScore).toFixed(0)} / 100`;
    if (subtitleEl) {
      const windowLabel = tripleSignalWindowDays === 365 ? "1 year" : `${tripleSignalWindowDays} days`;
      subtitleEl.textContent = `${windowLabel} window · ${detail.sector || "Unknown sector"}`;
    }

    const instRows = Array.isArray(detail.institutionEvents) ? detail.institutionEvents : [];
    const insiderRows = Array.isArray(detail.insiderEvents) ? detail.insiderEvents : [];
    const polRows = Array.isArray(detail.politicianEvents) ? detail.politicianEvents : [];
    const timeline = Array.isArray(detail.timeline) ? detail.timeline : [];

    if (instBody) {
      instBody.innerHTML = instRows.length
        ? instRows
            .map(
              (row) => `<tr>
              <td><a href="${institutionPath(bareInstitutionCik(row.institutionId), "activity")}" class="ownership-fund__link" data-institution-cik="${escapeHtml(bareInstitutionCik(row.institutionId))}">${escapeHtml(row.institutionName)}</a></td>
              <td>${escapeHtml(row.buyType === "new" ? "New position" : "Position increase")}</td>
              <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.positionValueUsd, "USD"))}</td>
              <td class="mono num">${escapeHtml(formatShareCount(row.sharesChange))}</td>
              <td class="mono">${escapeHtml(formatTripleSignalDate(row.filingDate))}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="trades-table__empty">No institutional activity</td></tr>`;
    }

    if (insiderBody) {
      insiderBody.innerHTML = insiderRows.length
        ? insiderRows
            .map(
              (row) => `<tr>
              <td>${escapeHtml(row.insiderName)}</td>
              <td>${escapeHtml(row.insiderTitle || "—")}</td>
              <td class="mono num">${escapeHtml(formatHoldingValueUsd(Math.abs(Number(row.transactionValue) || 0), "USD"))}</td>
              <td class="mono num">${escapeHtml(formatShareCount(row.shares))}</td>
              <td class="mono">${escapeHtml(formatTripleSignalDate(row.transactionDate))}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="trades-table__empty">No insider purchases</td></tr>`;
    }

    if (polBody) {
      polBody.innerHTML = polRows.length
        ? polRows
            .map(
              (row) => `<tr>
              <td><a href="${politicianPath(row.politicianKey)}" class="politicians-name-link" data-politician-key="${escapeHtml(row.politicianKey)}">${escapeHtml(row.politicianName)}</a></td>
              <td>${escapeHtml(row.party || "—")}</td>
              <td>${escapeHtml(row.chamber === "senate" ? "Senate" : "House")}</td>
              <td class="mono num">${escapeHtml(formatHoldingValueUsd(row.estimatedPurchaseUsd, "USD"))}</td>
              <td class="mono">${escapeHtml(formatTripleSignalDate(row.transactionDate))}</td>
            </tr>`
            )
            .join("")
        : `<tr><td colspan="5" class="trades-table__empty">No politician purchases</td></tr>`;
    }

    if (timelineEl) {
      const typeLabel = (type) => {
        if (type === "institution") return "Institution buy";
        if (type === "politician") return "Politician buy";
        return "Insider buy";
      };
      timelineEl.innerHTML = timeline.length
        ? timeline
            .map(
              (event) => `<li class="double-signal-timeline__item double-signal-timeline__item--${escapeHtml(event.type)}">
              <span class="double-signal-timeline__date mono">${escapeHtml(formatTripleSignalDate(event.date))}</span>
              <span class="double-signal-timeline__type">${typeLabel(event.type)}</span>
              <strong>${escapeHtml(event.label)}</strong>
              <span class="muted small">${escapeHtml(event.detail || "")}</span>
              ${event.valueUsd != null ? `<span class="mono num">${escapeHtml(formatHoldingValueUsd(event.valueUsd, "USD"))}</span>` : ""}
            </li>`
            )
            .join("")
        : `<li class="trades-table__empty">No timeline events</li>`;
    }
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (instBody) instBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    if (insiderBody) insiderBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    if (polBody) polBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${msg}</td></tr>`;
    if (timelineEl) timelineEl.innerHTML = `<li class="trades-table__empty">${msg}</li>`;
  }
}

function syncTripleSignalFiltersFromDom() {
  tripleSignalWindowDays = Number(document.getElementById("triple-signal-window")?.value || 90) || 90;
  if (tripleSignalWindowDays !== 90 && tripleSignalWindowDays !== 180 && tripleSignalWindowDays !== 365) {
    tripleSignalWindowDays = 90;
  }
  tripleSignalFilters.institution = document.getElementById("triple-signal-institution")?.value || "";
  tripleSignalFilters.insiderRole = document.getElementById("triple-signal-insider-role")?.value || "";
  tripleSignalFilters.sector = document.getElementById("triple-signal-sector")?.value || "";
  tripleSignalFilters.search = document.getElementById("triple-signal-search")?.value || "";
  tripleSignalFilters.minInstValue =
    Number(document.getElementById("triple-signal-min-inst-value")?.value || 0) || 0;
  tripleSignalFilters.minInsiderValue =
    Number(document.getElementById("triple-signal-min-insider-value")?.value || 0) || 0;
  tripleSignalFilters.minPoliticianValue =
    Number(document.getElementById("triple-signal-min-pol-value")?.value || 0) || 0;
}

async function loadTripleSignalHub() {
  const loading = document.getElementById("triple-signal-loading");
  if (activeTripleSignalTicker) {
    if (loading) loading.hidden = true;
    await renderTripleSignalDetail(activeTripleSignalTicker);
    return;
  }

  if (loading) loading.hidden = !tripleSignalLoading;
  if (tripleSignalLoading) return;

  tripleSignalLoading = true;
  if (loading) loading.hidden = false;
  try {
    lastTripleSignalPayload = await apiJson("/api/signals/triple-signal", {
      window: tripleSignalWindowDays,
    });
    renderTripleSignalFilterOptions(lastTripleSignalPayload);
    renderTripleSignalListView();
  } catch (err) {
    const body = document.getElementById("triple-signal-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="12" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    tripleSignalLoading = false;
    if (loading) loading.hidden = true;
  }
}

function bindTripleSignalHubControls() {
  if (tripleSignalBound) return;
  tripleSignalBound = true;

  document.getElementById("triple-signal-detail-back")?.addEventListener("click", () => {
    navigateToTripleSignal(null);
  });

  document.getElementById("triple-signal-prev")?.addEventListener("click", () => {
    if (tripleSignalPage > 1) {
      tripleSignalPage -= 1;
      renderTripleSignalListView();
    }
  });

  document.getElementById("triple-signal-next")?.addEventListener("click", () => {
    tripleSignalPage += 1;
    renderTripleSignalListView();
  });

  const panel = document.getElementById("signals-triple-signal-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-triple-signal-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-triple-signal-sort");
      if (!key) return;
      if (tripleSignalSortKey === key) {
        tripleSignalSortDir = tripleSignalSortDir === "desc" ? "asc" : "desc";
      } else {
        tripleSignalSortKey = key;
        tripleSignalSortDir =
          key === "companyName" || key === "ticker" ? "asc" : "desc";
      }
      renderTripleSignalListView();
      return;
    }

    const row = e.target.closest?.("[data-triple-signal-ticker]");
    if (row && !e.target.closest("a")) {
      const ticker = row.getAttribute("data-triple-signal-ticker");
      if (ticker) navigateToTripleSignal(ticker);
    }
  });

  panel?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest?.("[data-triple-signal-ticker]");
    if (!row) return;
    e.preventDefault();
    const ticker = row.getAttribute("data-triple-signal-ticker");
    if (ticker) navigateToTripleSignal(ticker);
  });

  [
    "triple-signal-window",
    "triple-signal-institution",
    "triple-signal-insider-role",
    "triple-signal-sector",
    "triple-signal-min-inst-value",
    "triple-signal-min-insider-value",
    "triple-signal-min-pol-value",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncTripleSignalFiltersFromDom();
      tripleSignalPage = 1;
      if (id === "triple-signal-window") {
        lastTripleSignalPayload = null;
        void loadTripleSignalHub();
      } else {
        renderTripleSignalListView();
      }
    });
  });

  document.getElementById("triple-signal-search")?.addEventListener("input", (e) => {
    tripleSignalFilters.search = e.target.value || "";
    tripleSignalPage = 1;
    renderTripleSignalListView();
  });
}

const CONFLICT_SIGNAL_TYPE_LABELS = {
  institutions_buying_insiders_selling: "Inst. buying / Insiders selling",
  institutions_selling_insiders_buying: "Inst. selling / Insiders buying",
  strong_divergence: "Strong divergence",
  double_conviction_conflict: "Double conviction",
};

function conflictSignalsQueryParams() {
  return {
    signalType: conflictSignalsFilters.signalType || undefined,
    sector: conflictSignalsFilters.sector || undefined,
    marketCap: conflictSignalsFilters.marketCap || undefined,
    minConflictScore: conflictSignalsFilters.minConflictScore || undefined,
    insiderRole: conflictSignalsFilters.insiderRole || undefined,
    search: conflictSignalsFilters.search || undefined,
    page: conflictSignalsPage,
    pageSize: CONFLICT_SIGNALS_PAGE_SIZE,
    sort: conflictSignalsSortKey,
    sortDir: conflictSignalsSortDir,
  };
}

function formatSignedScore(n, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const fixed = v.toFixed(digits);
  return v > 0 ? `+${fixed}` : fixed;
}

function syncConflictSignalsFiltersFromDom() {
  conflictSignalsFilters.signalType = document.getElementById("conflict-signals-type")?.value || "";
  conflictSignalsFilters.sector = document.getElementById("conflict-signals-sector")?.value || "";
  conflictSignalsFilters.marketCap = document.getElementById("conflict-signals-mcap")?.value || "";
  conflictSignalsFilters.minConflictScore =
    Number(document.getElementById("conflict-signals-min-score")?.value || 0) || 0;
  conflictSignalsFilters.insiderRole =
    document.getElementById("conflict-signals-insider-role")?.value || "";
  conflictSignalsFilters.search = document.getElementById("conflict-signals-search")?.value || "";
}

function renderConflictSignalsFilterOptions(payload) {
  const sectorSelect = document.getElementById("conflict-signals-sector");
  if (sectorSelect) {
    const current = conflictSignalsFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const typeSelect = document.getElementById("conflict-signals-type");
  if (typeSelect) typeSelect.value = conflictSignalsFilters.signalType;
  const mcap = document.getElementById("conflict-signals-mcap");
  if (mcap) mcap.value = conflictSignalsFilters.marketCap;
  const minScore = document.getElementById("conflict-signals-min-score");
  if (minScore) minScore.value = String(conflictSignalsFilters.minConflictScore || 0);
  const role = document.getElementById("conflict-signals-insider-role");
  if (role) role.value = conflictSignalsFilters.insiderRole;
  const search = document.getElementById("conflict-signals-search");
  if (search && search.value !== conflictSignalsFilters.search) search.value = conflictSignalsFilters.search;
}

function renderConflictSignalsHub() {
  setupConflictSignalsHub();
  const payload = lastConflictSignalsPayload;
  const body = document.getElementById("conflict-signals-body");
  const meta = document.getElementById("conflict-signals-meta");
  const countEl = document.getElementById("conflict-signals-count");
  const pagination = document.getElementById("conflict-signals-pagination");
  const pageInfo = document.getElementById("conflict-signals-page-info");
  const prevBtn = document.getElementById("conflict-signals-prev");
  const nextBtn = document.getElementById("conflict-signals-next");
  const loading = document.getElementById("conflict-signals-loading");

  if (loading) loading.hidden = !conflictSignalsLoading;

  document.querySelectorAll("[data-conflict-signals-sort]").forEach((btn) => {
    const key = btn.dataset.conflictSignalsSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === conflictSignalsSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (conflictSignalsSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${conflictSignalsSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("conflict-signals-total", formatInteger(payload?.total ?? summary.totalSignals ?? 0));
  setText("conflict-signals-bullish", formatInteger(summary.bullishConflicts ?? 0));
  setText("conflict-signals-bearish", formatInteger(summary.bearishConflicts ?? 0));
  setText("conflict-signals-double", formatInteger(summary.doubleConviction ?? 0));

  if (!payload) {
    if (body && !conflictSignalsLoading) {
      body.innerHTML = `<tr><td colspan="9" class="muted">No conflict signals loaded.</td></tr>`;
    }
    if (meta) meta.textContent = conflictSignalsLoading ? "Loading…" : "—";
    if (countEl) countEl.textContent = "";
    if (pagination) pagination.hidden = true;
    return;
  }

  renderConflictSignalsFilterOptions(payload);
  const rows = Array.isArray(payload.signals) ? payload.signals : [];
  const total = Number(payload.total) || 0;
  const page = Number(payload.page) || conflictSignalsPage;
  const pageSize = Number(payload.pageSize) || CONFLICT_SIGNALS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (countEl) countEl.textContent = `${formatInteger(total)} signal${total === 1 ? "" : "s"}`;
  if (meta) {
    const q = payload.currentQuarter || "—";
    const pq = payload.previousQuarter ? ` vs ${payload.previousQuarter}` : "";
    meta.textContent = `Latest quarter ${q}${pq} · open-market Form 4 (${payload.insiderWindowDays || 90}d)`;
  }

  if (!rows.length) {
    if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No conflict signals match these filters.</td></tr>`;
  } else if (body) {
    body.innerHTML = rows
      .map((row) => {
        const signalLabel =
          CONFLICT_SIGNAL_TYPE_LABELS[row.signalType] || row.signalType || "—";
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
        return `<tr class="conflict-signals-row" data-conflict-signals-ticker="${escapeHtml(row.ticker)}" tabindex="0" role="link">
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td>${escapeHtml(signalLabel)}</td>
          <td class="mono num">${formatSignedScore(row.institutionScore)}</td>
          <td class="mono num">${formatSignedScore(row.insiderScore)}</td>
          <td class="mono num">${Number.isFinite(Number(row.conflictScore)) ? Number(row.conflictScore).toFixed(1) : "—"}</td>
          <td class="mono num">${formatInteger(row.institutionsBuyingCount)}</td>
          <td class="mono num">${formatInteger(row.institutionsSellingCount)}</td>
          <td class="mono num">${formatInteger(row.insidersBuyingCount)}</td>
          <td class="mono num">${formatInteger(row.insidersSellingCount)}</td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadConflictSignalsHub() {
  if (conflictSignalsLoading) {
    renderConflictSignalsHub();
    return;
  }
  conflictSignalsLoading = true;
  renderConflictSignalsHub();
  const requestKey = JSON.stringify(conflictSignalsQueryParams());
  try {
    lastConflictSignalsPayload = await apiJson(
      "/api/signals/conflict-signals",
      conflictSignalsQueryParams()
    );
  } catch (err) {
    lastConflictSignalsPayload = null;
    const body = document.getElementById("conflict-signals-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    conflictSignalsLoading = false;
    if (JSON.stringify(conflictSignalsQueryParams()) !== requestKey) {
      void loadConflictSignalsHub();
      return;
    }
    renderConflictSignalsHub();
  }
}

function setupConflictSignalsHub() {
  if (conflictSignalsBound) return;
  conflictSignalsBound = true;

  document.getElementById("conflict-signals-prev")?.addEventListener("click", () => {
    if (conflictSignalsPage <= 1) return;
    conflictSignalsPage -= 1;
    void loadConflictSignalsHub();
  });
  document.getElementById("conflict-signals-next")?.addEventListener("click", () => {
    conflictSignalsPage += 1;
    void loadConflictSignalsHub();
  });

  const panel = document.getElementById("signals-conflict-signals-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-conflict-signals-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-conflict-signals-sort");
      if (!key) return;
      if (conflictSignalsSortKey === key) {
        conflictSignalsSortDir = conflictSignalsSortDir === "desc" ? "asc" : "desc";
      } else {
        conflictSignalsSortKey = key;
        conflictSignalsSortDir =
          key === "companyName" || key === "ticker" || key === "signalType" ? "asc" : "desc";
      }
      conflictSignalsPage = 1;
      void loadConflictSignalsHub();
      return;
    }
    const open = e.target.closest?.("[data-open-stock]");
    if (open) {
      const ticker = open.getAttribute("data-open-stock");
      if (ticker) void openStockPreview(ticker);
    }
  });

  [
    "conflict-signals-type",
    "conflict-signals-sector",
    "conflict-signals-mcap",
    "conflict-signals-min-score",
    "conflict-signals-insider-role",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncConflictSignalsFiltersFromDom();
      conflictSignalsPage = 1;
      void loadConflictSignalsHub();
    });
  });

  let searchTimer = null;
  document.getElementById("conflict-signals-search")?.addEventListener("input", (e) => {
    conflictSignalsFilters.search = e.target.value || "";
    conflictSignalsPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadConflictSignalsHub(), 250);
  });
}

function hiddenGemsQueryParams() {
  return {
    quarter: hiddenGemsFilters.quarter || undefined,
    sector: hiddenGemsFilters.sector || undefined,
    marketCap: hiddenGemsFilters.marketCap || undefined,
    minScore: hiddenGemsFilters.minScore || undefined,
    maxOwnershipPct:
      hiddenGemsFilters.maxOwnershipPct != null ? hiddenGemsFilters.maxOwnershipPct : undefined,
    minOwnershipGrowth:
      hiddenGemsFilters.minOwnershipGrowthPct != null
        ? hiddenGemsFilters.minOwnershipGrowthPct / 100
        : undefined,
    minInstitutions: hiddenGemsFilters.minInstitutions || undefined,
    onlyNewPositions: hiddenGemsFilters.onlyNewPositions ? "1" : undefined,
    search: hiddenGemsFilters.search || undefined,
    page: hiddenGemsPage,
    pageSize: HIDDEN_GEMS_PAGE_SIZE,
    sort: hiddenGemsSortKey,
    sortDir: hiddenGemsSortDir,
  };
}

function formatOwnershipGrowthPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function syncHiddenGemsFiltersFromDom() {
  hiddenGemsFilters.quarter = document.getElementById("hidden-gems-quarter")?.value || "";
  hiddenGemsFilters.sector = document.getElementById("hidden-gems-sector")?.value || "";
  hiddenGemsFilters.marketCap = document.getElementById("hidden-gems-mcap")?.value || "";
  hiddenGemsFilters.minScore =
    Number(document.getElementById("hidden-gems-min-score")?.value || 0) || 0;
  hiddenGemsFilters.maxOwnershipPct =
    Number(document.getElementById("hidden-gems-max-own")?.value ?? 35);
  hiddenGemsFilters.minOwnershipGrowthPct =
    Number(document.getElementById("hidden-gems-min-growth")?.value ?? 15);
  hiddenGemsFilters.minInstitutions =
    Number(document.getElementById("hidden-gems-min-inst")?.value || 0) || 0;
  hiddenGemsFilters.onlyNewPositions = !!document.getElementById("hidden-gems-only-new")?.checked;
  hiddenGemsFilters.search = document.getElementById("hidden-gems-search")?.value || "";
}

function renderHiddenGemsFilterOptions(payload) {
  const quarterSelect = document.getElementById("hidden-gems-quarter");
  if (quarterSelect) {
    const current = hiddenGemsFilters.quarter || payload?.currentQuarter || "";
    const quarters = Array.isArray(payload?.quarters) ? payload.quarters : [];
    quarterSelect.innerHTML =
      quarters.length === 0
        ? `<option value="">Latest</option>`
        : quarters
            .slice()
            .reverse()
            .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
            .join("");
    quarterSelect.value = current && quarters.includes(current) ? current : quarters[quarters.length - 1] || "";
    hiddenGemsFilters.quarter = quarterSelect.value;
  }
  const sectorSelect = document.getElementById("hidden-gems-sector");
  if (sectorSelect) {
    const current = hiddenGemsFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const mcap = document.getElementById("hidden-gems-mcap");
  if (mcap) mcap.value = hiddenGemsFilters.marketCap;
  const minScore = document.getElementById("hidden-gems-min-score");
  if (minScore) minScore.value = String(hiddenGemsFilters.minScore || 0);
  const maxOwn = document.getElementById("hidden-gems-max-own");
  if (maxOwn) maxOwn.value = String(hiddenGemsFilters.maxOwnershipPct ?? 35);
  const minGrowth = document.getElementById("hidden-gems-min-growth");
  if (minGrowth) minGrowth.value = String(hiddenGemsFilters.minOwnershipGrowthPct ?? 15);
  const minInst = document.getElementById("hidden-gems-min-inst");
  if (minInst) minInst.value = String(hiddenGemsFilters.minInstitutions || 0);
  const onlyNew = document.getElementById("hidden-gems-only-new");
  if (onlyNew) onlyNew.checked = !!hiddenGemsFilters.onlyNewPositions;
  const search = document.getElementById("hidden-gems-search");
  if (search && search.value !== hiddenGemsFilters.search) search.value = hiddenGemsFilters.search;
}

function renderHiddenGemsHub() {
  setupHiddenGemsHub();
  const payload = lastHiddenGemsPayload;
  const body = document.getElementById("hidden-gems-body");
  const meta = document.getElementById("hidden-gems-meta");
  const countEl = document.getElementById("hidden-gems-count");
  const pagination = document.getElementById("hidden-gems-pagination");
  const pageInfo = document.getElementById("hidden-gems-page-info");
  const prevBtn = document.getElementById("hidden-gems-prev");
  const nextBtn = document.getElementById("hidden-gems-next");
  const loading = document.getElementById("hidden-gems-loading");

  if (loading) loading.hidden = !hiddenGemsLoading;

  document.querySelectorAll("[data-hidden-gems-sort]").forEach((btn) => {
    const key = btn.dataset.hiddenGemsSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === hiddenGemsSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (hiddenGemsSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${hiddenGemsSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("hidden-gems-total", formatInteger(payload?.total ?? summary.totalGems ?? 0));
  setText("hidden-gems-label-gem", formatInteger(summary.hiddenGem ?? 0));
  setText("hidden-gems-label-strong", formatInteger(summary.strongAccumulation ?? 0));
  setText("hidden-gems-label-discovery", formatInteger(summary.institutionalDiscovery ?? 0));

  if (!payload) {
    if (body && !hiddenGemsLoading) {
      body.innerHTML = `<tr><td colspan="10" class="muted">No hidden gems loaded. Run <code class="inline-code">npm run signals:warm-hidden-gems</code> if needed.</td></tr>`;
    }
    if (meta) meta.textContent = hiddenGemsLoading ? "Loading…" : "—";
    if (countEl) countEl.textContent = "";
    if (pagination) pagination.hidden = true;
    return;
  }

  renderHiddenGemsFilterOptions(payload);
  const rows = Array.isArray(payload.signals) ? payload.signals : [];
  const total = Number(payload.total) || 0;
  const page = Number(payload.page) || hiddenGemsPage;
  const pageSize = Number(payload.pageSize) || HIDDEN_GEMS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (countEl) countEl.textContent = `${formatInteger(total)} gem${total === 1 ? "" : "s"}`;
  if (meta) {
    const q = payload.currentQuarter || "—";
    const pq = payload.previousQuarter ? ` vs ${payload.previousQuarter}` : "";
    meta.textContent = `Latest pair ${q}${pq} · ownership under 35% with aggressive accumulation`;
  }

  if (!rows.length) {
    if (body) {
      body.innerHTML = `<tr><td colspan="10" class="trades-table__empty">No hidden gems match these filters.</td></tr>`;
    }
  } else if (body) {
    body.innerHTML = rows
      .map((row) => {
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(row.ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span>`;
        return `<tr>
          <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}">${stockLabel}</a></td>
          <td>${escapeHtml(row.label || "—")}</td>
          <td class="mono num">${Number.isFinite(Number(row.hiddenGemScore)) ? Number(row.hiddenGemScore).toFixed(1) : "—"}</td>
          <td class="mono num">${Number.isFinite(Number(row.institutionalOwnership)) ? `${Number(row.institutionalOwnership).toFixed(1)}%` : "—"}</td>
          <td class="mono num">${formatOwnershipGrowthPct(row.ownershipGrowth)}</td>
          <td class="mono num">${formatInteger(row.institutionsCount)}</td>
          <td class="mono num">${formatInteger(row.newPositionsCount)}</td>
          <td class="mono num">${formatInteger(row.increasingPositionsCount)}</td>
          <td class="mono num">${formatInteger(row.netSharesAccumulated)}</td>
          <td class="mono num">${Number.isFinite(Number(row.convictionScore)) ? Number(row.convictionScore).toFixed(1) : "—"}</td>
        </tr>`;
      })
      .join("");
  }

  if (pagination) {
    pagination.hidden = totalPages <= 1;
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = page <= 1;
    if (nextBtn) nextBtn.disabled = page >= totalPages;
  }
}

async function loadHiddenGemsHub() {
  if (hiddenGemsLoading) {
    renderHiddenGemsHub();
    return;
  }
  hiddenGemsLoading = true;
  renderHiddenGemsHub();
  const requestKey = JSON.stringify(hiddenGemsQueryParams());
  try {
    lastHiddenGemsPayload = await apiJson("/api/signals/hidden-gems", hiddenGemsQueryParams());
  } catch (err) {
    lastHiddenGemsPayload = null;
    const body = document.getElementById("hidden-gems-body");
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    if (body) body.innerHTML = `<tr><td colspan="10" class="trades-table__empty">${msg}</td></tr>`;
  } finally {
    hiddenGemsLoading = false;
    if (JSON.stringify(hiddenGemsQueryParams()) !== requestKey) {
      void loadHiddenGemsHub();
      return;
    }
    renderHiddenGemsHub();
  }
}

function setupHiddenGemsHub() {
  if (hiddenGemsBound) return;
  hiddenGemsBound = true;

  document.getElementById("hidden-gems-prev")?.addEventListener("click", () => {
    if (hiddenGemsPage <= 1) return;
    hiddenGemsPage -= 1;
    void loadHiddenGemsHub();
  });
  document.getElementById("hidden-gems-next")?.addEventListener("click", () => {
    hiddenGemsPage += 1;
    void loadHiddenGemsHub();
  });

  const panel = document.getElementById("signals-hidden-gems-hub");
  panel?.addEventListener("click", (e) => {
    const sortBtn = e.target.closest?.("[data-hidden-gems-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-hidden-gems-sort");
      if (!key) return;
      if (hiddenGemsSortKey === key) {
        hiddenGemsSortDir = hiddenGemsSortDir === "desc" ? "asc" : "desc";
      } else {
        hiddenGemsSortKey = key;
        hiddenGemsSortDir =
          key === "companyName" || key === "ticker" || key === "label" ? "asc" : "desc";
      }
      hiddenGemsPage = 1;
      void loadHiddenGemsHub();
      return;
    }
    const open = e.target.closest?.("[data-open-stock]");
    if (open) {
      const ticker = open.getAttribute("data-open-stock");
      if (ticker) void openStockPreview(ticker);
    }
  });

  [
    "hidden-gems-quarter",
    "hidden-gems-sector",
    "hidden-gems-mcap",
    "hidden-gems-min-score",
    "hidden-gems-max-own",
    "hidden-gems-min-growth",
    "hidden-gems-min-inst",
    "hidden-gems-only-new",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncHiddenGemsFiltersFromDom();
      hiddenGemsPage = 1;
      void loadHiddenGemsHub();
    });
  });

  let searchTimer = null;
  document.getElementById("hidden-gems-search")?.addEventListener("input", (e) => {
    hiddenGemsFilters.search = e.target.value || "";
    hiddenGemsPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadHiddenGemsHub(), 250);
  });
}

function convictionScoreBadgeClass(classification) {
  const c = String(classification || "").toLowerCase();
  if (c.includes("exceptional")) return "conviction-score-badge conviction-score-badge--exceptional";
  if (c.includes("high")) return "conviction-score-badge conviction-score-badge--high";
  if (c.includes("strong")) return "conviction-score-badge conviction-score-badge--strong";
  if (c.includes("moderate")) return "conviction-score-badge conviction-score-badge--moderate";
  return "conviction-score-badge conviction-score-badge--low";
}

function formatConvictionWeight(fraction) {
  const v = Number(fraction);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function formatConvictionRatio(ratio) {
  const v = Number(ratio);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function convictionScoreQueryParams() {
  const minMedianRaw = convictionScoreFilters.minMedianWeight;
  const minMedian =
    minMedianRaw === "" || minMedianRaw == null ? undefined : Number(minMedianRaw);
  return {
    quarter: convictionScoreFilters.quarter || undefined,
    sector: convictionScoreFilters.sector || undefined,
    marketCap: convictionScoreFilters.marketCap || undefined,
    minScore: convictionScoreFilters.minScore || undefined,
    minHolders: convictionScoreFilters.minHolders || undefined,
    minMedianWeight: Number.isFinite(minMedian) ? minMedian : undefined,
    minHighConvictionHolders: convictionScoreFilters.minHighConvictionHolders || undefined,
    compare: convictionScoreFilters.compare || undefined,
    search: convictionScoreFilters.search || undefined,
    page: convictionScorePage,
    pageSize: CONVICTION_SCORE_PAGE_SIZE,
    sort: convictionScoreSortKey,
    sortDir: convictionScoreSortDir,
  };
}

function syncConvictionScoreFiltersFromDom() {
  convictionScoreFilters.quarter = document.getElementById("conviction-score-quarter")?.value || "";
  convictionScoreFilters.sector = document.getElementById("conviction-score-sector")?.value || "";
  convictionScoreFilters.marketCap = document.getElementById("conviction-score-mcap")?.value || "";
  convictionScoreFilters.minScore =
    Number(document.getElementById("conviction-score-min-score")?.value || 0) || 0;
  convictionScoreFilters.minHolders =
    Number(document.getElementById("conviction-score-min-holders")?.value || 5) || 5;
  convictionScoreFilters.minMedianWeight =
    document.getElementById("conviction-score-min-median")?.value ?? "";
  convictionScoreFilters.minHighConvictionHolders =
    Number(document.getElementById("conviction-score-min-high")?.value || 0) || 0;
  convictionScoreFilters.compare = document.getElementById("conviction-score-compare")?.value || "";
  convictionScoreFilters.search = document.getElementById("conviction-score-search")?.value || "";
}

function renderConvictionScoreFilterOptions(payload) {
  const quarterSelect = document.getElementById("conviction-score-quarter");
  if (quarterSelect) {
    const current = convictionScoreFilters.quarter || payload?.currentQuarter || "";
    const quarters = Array.isArray(payload?.quarters) ? payload.quarters : [];
    quarterSelect.innerHTML =
      quarters.length === 0
        ? `<option value="">Latest</option>`
        : quarters
            .slice()
            .reverse()
            .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
            .join("");
    quarterSelect.value =
      current && quarters.includes(current) ? current : quarters[quarters.length - 1] || "";
    convictionScoreFilters.quarter = quarterSelect.value;
  }
  const sectorSelect = document.getElementById("conviction-score-sector");
  if (sectorSelect) {
    const current = convictionScoreFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const mcap = document.getElementById("conviction-score-mcap");
  if (mcap) mcap.value = convictionScoreFilters.marketCap;
  const minScore = document.getElementById("conviction-score-min-score");
  if (minScore) minScore.value = String(convictionScoreFilters.minScore || 0);
  const minHolders = document.getElementById("conviction-score-min-holders");
  if (minHolders) minHolders.value = String(convictionScoreFilters.minHolders || 5);
  const minMedian = document.getElementById("conviction-score-min-median");
  if (minMedian && minMedian.value !== String(convictionScoreFilters.minMedianWeight ?? "")) {
    minMedian.value = convictionScoreFilters.minMedianWeight ?? "";
  }
  const minHigh = document.getElementById("conviction-score-min-high");
  if (minHigh) minHigh.value = String(convictionScoreFilters.minHighConvictionHolders || 0);
  const compare = document.getElementById("conviction-score-compare");
  if (compare && compare.value !== convictionScoreFilters.compare) {
    compare.value = convictionScoreFilters.compare;
  }
  const search = document.getElementById("conviction-score-search");
  if (search && search.value !== convictionScoreFilters.search) {
    search.value = convictionScoreFilters.search;
  }
}

function renderConvictionScoreDetail(row) {
  const history = Array.isArray(row.history) ? row.history : [];
  const historyHtml = history.length
    ? `<ol class="conviction-score-history">${history
        .map((h) => {
          const score =
            h.convictionScore == null ? "n/a" : Number(h.convictionScore).toFixed(0);
          return `<li><span class="mono">${escapeHtml(h.quarter)}</span> → <strong class="mono">${escapeHtml(score)}</strong></li>`;
        })
        .join("")}</ol>`
    : `<p class="muted small">No quarterly history yet.</p>`;
  const components = row.scoreComponents || {};
  return `
    <div class="conviction-score-detail">
      <p class="conviction-score-detail__explain">${escapeHtml(row.explanation || "")}</p>
      <div class="conviction-score-detail__grid">
        <div>
          <h4 class="institution-hub__section-label">Portfolio weight</h4>
          <p>Median: <span class="mono">${escapeHtml(formatConvictionWeight(row.medianPortfolioWeight))}</span></p>
          <p>Average: <span class="mono">${escapeHtml(formatConvictionWeight(row.averagePortfolioWeight))}</span></p>
        </div>
        <div>
          <h4 class="institution-hub__section-label">High-conviction holders</h4>
          <p>&gt;1%: <span class="mono">${formatInteger(row.holdersAbove1Percent)}</span></p>
          <p>&gt;2%: <span class="mono">${formatInteger(row.holdersAbove2Percent)}</span></p>
          <p>&gt;5%: <span class="mono">${formatInteger(row.holdersAbove5Percent)}</span></p>
          <p>&gt;10%: <span class="mono">${formatInteger(row.holdersAbove10Percent)}</span></p>
        </div>
        <div>
          <h4 class="institution-hub__section-label">Accumulation</h4>
          <p>Increasing: <span class="mono">${formatInteger(row.institutionsIncreasing)}</span></p>
          <p>Decreasing: <span class="mono">${formatInteger(row.institutionsDecreasing)}</span></p>
          <p>New: <span class="mono">${formatInteger(row.newPositions)}</span></p>
          <p>Exited: <span class="mono">${formatInteger(row.exitedPositions)}</span></p>
        </div>
        <div>
          <h4 class="institution-hub__section-label">Persistence</h4>
          <p>2+ quarters: <span class="mono">${formatInteger(row.institutionsAccumulating2PlusQuarters)}</span></p>
          <p>3+ quarters: <span class="mono">${formatInteger(row.institutionsAccumulating3PlusQuarters)}</span></p>
          <p>4+ quarters: <span class="mono">${formatInteger(row.institutionsAccumulating4PlusQuarters)}</span></p>
          <p>Avg streak: <span class="mono">${Number(row.averageAccumulationStreak || 0).toFixed(1)}</span></p>
        </div>
        <div>
          <h4 class="institution-hub__section-label">Score components</h4>
          <p>Weight: <span class="mono">${components.portfolioWeightScore ?? "—"}</span></p>
          <p>Breadth: <span class="mono">${components.highConvictionBreadthScore ?? "—"}</span></p>
          <p>Accumulation: <span class="mono">${components.accumulationScore ?? "—"}</span></p>
          <p>Persistence: <span class="mono">${components.persistenceScore ?? "—"}</span></p>
        </div>
        <div>
          <h4 class="institution-hub__section-label">Quarterly history</h4>
          ${historyHtml}
        </div>
      </div>
    </div>`;
}

function renderConvictionScoreCompare(rows) {
  const panel = document.getElementById("conviction-score-compare-panel");
  const body = document.getElementById("conviction-score-compare-body");
  if (!panel || !body) return;
  const compare = String(convictionScoreFilters.compare || "").trim();
  if (!compare) {
    panel.hidden = true;
    body.innerHTML = "";
    return;
  }
  const tickers = new Set(
    compare
      .split(/[,+\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
  );
  const matched = (rows || []).filter((r) => tickers.has(String(r.ticker || "").toUpperCase()));
  panel.hidden = matched.length === 0;
  if (!matched.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No matching tickers in this quarter.</td></tr>`;
    return;
  }
  body.innerHTML = matched
    .map(
      (row) => `<tr>
      <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</a></td>
      <td class="mono num">${row.convictionScore == null ? "—" : Number(row.convictionScore).toFixed(0)}</td>
      <td class="mono num">${escapeHtml(formatConvictionWeight(row.medianPortfolioWeight))}</td>
      <td class="mono num">${formatInteger(row.holdersAbove2Percent)}</td>
      <td class="mono num">${escapeHtml(formatConvictionRatio(row.accumulationRatio))}</td>
    </tr>`
    )
    .join("");
}

function renderConvictionScoreHub() {
  setupConvictionScoreHub();
  const payload = lastConvictionScorePayload;
  const body = document.getElementById("conviction-score-body");
  const meta = document.getElementById("conviction-score-meta");
  const countEl = document.getElementById("conviction-score-count");
  const pagination = document.getElementById("conviction-score-pagination");
  const pageInfo = document.getElementById("conviction-score-page-info");
  const prevBtn = document.getElementById("conviction-score-prev");
  const nextBtn = document.getElementById("conviction-score-next");
  const loading = document.getElementById("conviction-score-loading");

  if (loading) loading.hidden = !convictionScoreLoading;

  document.querySelectorAll("[data-conviction-score-sort]").forEach((btn) => {
    const key = btn.dataset.convictionScoreSort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === convictionScoreSortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (convictionScoreSortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${convictionScoreSortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  const highest = summary.highestConviction;
  setText(
    "conviction-score-highest",
    highest
      ? `${highest.ticker} · ${Number(highest.score).toFixed(0)}`
      : "—"
  );
  setText(
    "conviction-score-average",
    summary.averageConviction == null ? "—" : Number(summary.averageConviction).toFixed(1)
  );
  setText("conviction-score-high", formatInteger(summary.highConvictionStocks ?? 0));
  setText("conviction-score-exceptional", formatInteger(summary.exceptionalConvictionStocks ?? 0));

  if (!payload) {
    if (body && !convictionScoreLoading) {
      body.innerHTML = `<tr><td colspan="10" class="muted">No conviction scores loaded. Run <code class="inline-code">npm run signals:warm-conviction-score</code> if needed.</td></tr>`;
    }
    if (meta) meta.textContent = convictionScoreLoading ? "Loading…" : "—";
    renderConvictionScoreCompare([]);
    return;
  }

  renderConvictionScoreFilterOptions(payload);
  const rows = Array.isArray(payload.signals) ? payload.signals : [];
  const total = Number(payload.total) || rows.length;
  const page = Number(payload.page) || convictionScorePage;
  const pageSize = Number(payload.pageSize) || CONVICTION_SCORE_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) countEl.textContent = `${formatInteger(total)} stocks`;
  if (meta) {
    meta.textContent = `${payload.currentQuarter || "—"}${
      payload.previousQuarter ? ` vs ${payload.previousQuarter}` : ""
    } · proprietary 0–100 · explainable components`;
  }
  if (pagination) pagination.hidden = total <= pageSize;
  if (pageInfo) pageInfo.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  renderConvictionScoreCompare(rows);

  if (!rows.length) {
    if (body) {
      body.innerHTML = `<tr><td colspan="10" class="muted">No stocks match these filters.</td></tr>`;
    }
    return;
  }

  const startRank = (page - 1) * pageSize;
  if (body) {
    body.innerHTML = rows
      .map((row, i) => {
        const ticker = String(row.ticker || "").toUpperCase();
        const expanded = convictionScoreExpanded.has(ticker);
        const score =
          row.convictionScore == null ? "—" : Number(row.convictionScore).toFixed(0);
        const classification = row.classification || (row.insufficientData ? "Insufficient data" : "—");
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(ticker)}</span>`;
        return `
        <tr class="conviction-score-row${expanded ? " is-expanded" : ""}" data-conviction-ticker="${escapeHtml(ticker)}">
          <td class="mono num">${startRank + i + 1}</td>
          <td>
            <div class="conviction-score-stock">
              <button type="button" class="btn btn--ghost conviction-score-expand" data-conviction-expand="${escapeHtml(ticker)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "▾" : "▸"}</button>
              <a href="${stockPath(ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(ticker)}">${stockLabel}</a>
            </div>
          </td>
          <td class="mono num">${formatInteger(row.institutionalHolders)}</td>
          <td class="mono num">${escapeHtml(formatConvictionWeight(row.medianPortfolioWeight))}</td>
          <td class="mono num">${formatInteger(row.holdersAbove2Percent)}</td>
          <td class="mono num">${formatInteger(row.institutionsIncreasing)}</td>
          <td class="mono num">${escapeHtml(formatConvictionRatio(row.accumulationRatio))}</td>
          <td class="mono num">${Number(row.averageAccumulationStreak || 0).toFixed(1)}</td>
          <td class="mono num">${escapeHtml(score)}</td>
          <td><span class="${convictionScoreBadgeClass(classification)}">${escapeHtml(classification)}</span></td>
        </tr>
        <tr class="conviction-score-detail-row" ${expanded ? "" : "hidden"}>
          <td colspan="10">${renderConvictionScoreDetail(row)}</td>
        </tr>`;
      })
      .join("");
  }
}

async function loadConvictionScoreHub() {
  if (convictionScoreLoading) {
    renderConvictionScoreHub();
    return;
  }
  convictionScoreLoading = true;
  renderConvictionScoreHub();
  const requestKey = JSON.stringify(convictionScoreQueryParams());
  try {
    lastConvictionScorePayload = await apiJson("/api/signals/conviction-score", convictionScoreQueryParams());
  } catch (err) {
    const body = document.getElementById("conviction-score-body");
    if (body) {
      body.innerHTML = `<tr><td colspan="10" class="trades-table__empty">${escapeHtml(
        err instanceof Error ? err.message : String(err)
      )}</td></tr>`;
    }
  } finally {
    convictionScoreLoading = false;
    if (JSON.stringify(convictionScoreQueryParams()) !== requestKey) {
      void loadConvictionScoreHub();
      return;
    }
    renderConvictionScoreHub();
  }
}

function setupConvictionScoreHub() {
  if (convictionScoreBound) return;
  convictionScoreBound = true;

  document.getElementById("conviction-score-prev")?.addEventListener("click", () => {
    if (convictionScorePage <= 1) return;
    convictionScorePage -= 1;
    void loadConvictionScoreHub();
  });
  document.getElementById("conviction-score-next")?.addEventListener("click", () => {
    convictionScorePage += 1;
    void loadConvictionScoreHub();
  });

  const panel = document.getElementById("signals-conviction-score-hub");
  panel?.addEventListener("click", (e) => {
    const expandBtn = e.target.closest?.("[data-conviction-expand]");
    if (expandBtn) {
      e.preventDefault();
      const ticker = expandBtn.getAttribute("data-conviction-expand");
      if (!ticker) return;
      if (convictionScoreExpanded.has(ticker)) convictionScoreExpanded.delete(ticker);
      else convictionScoreExpanded.add(ticker);
      renderConvictionScoreHub();
      return;
    }
    const sortBtn = e.target.closest?.("[data-conviction-score-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-conviction-score-sort");
      if (!key) return;
      if (convictionScoreSortKey === key) {
        convictionScoreSortDir = convictionScoreSortDir === "desc" ? "asc" : "desc";
      } else {
        convictionScoreSortKey = key;
        convictionScoreSortDir = key === "ticker" || key === "companyName" || key === "classification" ? "asc" : "desc";
      }
      convictionScorePage = 1;
      void loadConvictionScoreHub();
    }
  });

  [
    "conviction-score-quarter",
    "conviction-score-sector",
    "conviction-score-mcap",
    "conviction-score-min-score",
    "conviction-score-min-holders",
    "conviction-score-min-median",
    "conviction-score-min-high",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncConvictionScoreFiltersFromDom();
      convictionScorePage = 1;
      void loadConvictionScoreHub();
    });
  });

  let searchTimer = null;
  const debouncedReload = () => {
    syncConvictionScoreFiltersFromDom();
    convictionScorePage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadConvictionScoreHub(), 250);
  };
  document.getElementById("conviction-score-search")?.addEventListener("input", debouncedReload);
  document.getElementById("conviction-score-compare")?.addEventListener("input", debouncedReload);
}

function discoveryBadgeClass(classification) {
  const c = String(classification || "").toLowerCase();
  if (c.includes("strong")) return "discovery-badge discovery-badge--strong";
  if (c.includes("rapid")) return "discovery-badge discovery-badge--rapid";
  if (c.includes("institutional discovery")) return "discovery-badge discovery-badge--mid";
  if (c.includes("emerging")) return "discovery-badge discovery-badge--emerging";
  if (c.includes("insufficient")) return "discovery-badge discovery-badge--insufficient";
  return "discovery-badge discovery-badge--early";
}

function formatDiscoveryGrowth(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function formatDiscoveryValue(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function institutionalDiscoveryQueryParams() {
  const minGrowthRaw = institutionalDiscoveryFilters.minHolderGrowth;
  const minGrowth =
    minGrowthRaw === "" || minGrowthRaw == null ? undefined : Number(minGrowthRaw);
  return {
    quarter: institutionalDiscoveryFilters.quarter || undefined,
    sector: institutionalDiscoveryFilters.sector || undefined,
    marketCap: institutionalDiscoveryFilters.marketCap || undefined,
    minScore: institutionalDiscoveryFilters.minScore || undefined,
    minNewHolders: institutionalDiscoveryFilters.minNewHolders || undefined,
    minHolderGrowth: Number.isFinite(minGrowth) ? minGrowth : undefined,
    minGrowthStreak: institutionalDiscoveryFilters.minGrowthStreak || undefined,
    search: institutionalDiscoveryFilters.search || undefined,
    page: institutionalDiscoveryPage,
    pageSize: INSTITUTIONAL_DISCOVERY_PAGE_SIZE,
    sort: institutionalDiscoverySortKey,
    sortDir: institutionalDiscoverySortDir,
  };
}

function syncInstitutionalDiscoveryFiltersFromDom() {
  institutionalDiscoveryFilters.quarter =
    document.getElementById("institutional-discovery-quarter")?.value || "";
  institutionalDiscoveryFilters.sector =
    document.getElementById("institutional-discovery-sector")?.value || "";
  institutionalDiscoveryFilters.marketCap =
    document.getElementById("institutional-discovery-mcap")?.value || "";
  institutionalDiscoveryFilters.minScore =
    Number(document.getElementById("institutional-discovery-min-score")?.value || 0) || 0;
  institutionalDiscoveryFilters.minNewHolders =
    Number(document.getElementById("institutional-discovery-min-new")?.value || 0) || 0;
  institutionalDiscoveryFilters.minHolderGrowth =
    document.getElementById("institutional-discovery-min-growth")?.value ?? "";
  institutionalDiscoveryFilters.minGrowthStreak =
    Number(document.getElementById("institutional-discovery-min-streak")?.value || 0) || 0;
  institutionalDiscoveryFilters.search =
    document.getElementById("institutional-discovery-search")?.value || "";
}

function renderInstitutionalDiscoveryFilterOptions(payload) {
  const quarterSelect = document.getElementById("institutional-discovery-quarter");
  if (quarterSelect) {
    const current = institutionalDiscoveryFilters.quarter || payload?.currentQuarter || "";
    const quarters = Array.isArray(payload?.quarters) ? payload.quarters : [];
    quarterSelect.innerHTML =
      quarters.length === 0
        ? `<option value="">Latest</option>`
        : quarters
            .slice()
            .reverse()
            .map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`)
            .join("");
    quarterSelect.value =
      current && quarters.includes(current) ? current : quarters[quarters.length - 1] || "";
    institutionalDiscoveryFilters.quarter = quarterSelect.value;
  }
  const sectorSelect = document.getElementById("institutional-discovery-sector");
  if (sectorSelect) {
    const current = institutionalDiscoveryFilters.sector;
    const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
    sectorSelect.innerHTML =
      `<option value="">All sectors</option>` +
      sectors.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    sectorSelect.value = current;
  }
  const mcap = document.getElementById("institutional-discovery-mcap");
  if (mcap) mcap.value = institutionalDiscoveryFilters.marketCap;
  const minScore = document.getElementById("institutional-discovery-min-score");
  if (minScore) minScore.value = String(institutionalDiscoveryFilters.minScore || 0);
  const minNew = document.getElementById("institutional-discovery-min-new");
  if (minNew) minNew.value = String(institutionalDiscoveryFilters.minNewHolders || 0);
  const minGrowth = document.getElementById("institutional-discovery-min-growth");
  if (
    minGrowth &&
    minGrowth.value !== String(institutionalDiscoveryFilters.minHolderGrowth ?? "")
  ) {
    minGrowth.value = institutionalDiscoveryFilters.minHolderGrowth ?? "";
  }
  const minStreak = document.getElementById("institutional-discovery-min-streak");
  if (minStreak) minStreak.value = String(institutionalDiscoveryFilters.minGrowthStreak || 0);
  const search = document.getElementById("institutional-discovery-search");
  if (search && search.value !== institutionalDiscoveryFilters.search) {
    search.value = institutionalDiscoveryFilters.search;
  }
}

function renderDiscoveryTimeline(history) {
  const points = Array.isArray(history) ? history : [];
  if (points.length < 2) {
    return `<p class="muted small">Need at least two quarters for a discovery timeline.</p>`;
  }
  const recent = points.slice(-6);
  return `<ol class="discovery-timeline">${recent
    .map((h, i) => {
      const prev = i > 0 ? recent[i - 1] : null;
      const delta =
        prev != null ? Number(h.holderCount) - Number(prev.holderCount) : null;
      const deltaHtml =
        delta == null
          ? ""
          : `<span class="discovery-timeline__delta mono">${delta > 0 ? "+" : ""}${delta}</span>`;
      return `<li>
        <span class="discovery-timeline__count mono">${formatInteger(h.holderCount)}</span>
        <span class="muted small">${escapeHtml(h.quarter)}</span>
        ${deltaHtml}
      </li>`;
    })
    .join("")}</ol>`;
}

function renderDiscoveryInstitutionTable(title, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return `<div><h4 class="institution-hub__section-label">${escapeHtml(title)}</h4><p class="muted small">None this quarter.</p></div>`;
  }
  return `<div>
    <h4 class="institution-hub__section-label">${escapeHtml(title)}</h4>
    <div class="table-scroll">
      <table class="trades-table">
        <thead>
          <tr>
            <th>Institution</th>
            <th>First recorded</th>
            <th>Latest quarter</th>
            <th class="num">Shares</th>
            <th class="num">Reported value</th>
            <th class="num">Portfolio weight</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map(
              (inst) => `<tr>
            <td>${escapeHtml(inst.name || inst.cik || "—")}</td>
            <td class="mono">${escapeHtml(inst.firstRecordedQuarter || "—")}</td>
            <td class="mono">${escapeHtml(inst.latestQuarter || "—")}</td>
            <td class="mono num">${formatInteger(inst.shares)}</td>
            <td class="mono num">${escapeHtml(formatDiscoveryValue(inst.valueUsd))}</td>
            <td class="mono num">${
              inst.portfolioWeight == null
                ? "—"
                : `${(Number(inst.portfolioWeight) * 100).toFixed(2)}%`
            }</td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderInstitutionalDiscoveryDetail(row) {
  const history = Array.isArray(row.history) ? row.history : [];
  const historyHtml = history.length
    ? `<ol class="discovery-history">${history
        .map((h) => {
          const delta =
            h.netHolderChange == null
              ? ""
              : ` <span class="mono">(${h.netHolderChange > 0 ? "+" : ""}${h.netHolderChange})</span>`;
          return `<li><span class="mono">${escapeHtml(h.quarter)}</span> · <strong class="mono">${formatInteger(
            h.holderCount
          )}</strong> holders${delta}${
            h.newHolderCount
              ? ` · <span class="mono">+${formatInteger(h.newHolderCount)} new</span>`
              : ""
          }</li>`;
        })
        .join("")}</ol>`
    : `<p class="muted small">No quarterly history yet.</p>`;

  return `
    <div class="discovery-detail">
      <p class="discovery-detail__explain"><strong>Why is this scored?</strong> ${escapeHtml(
        row.explanation || ""
      )}</p>
      <div class="discovery-detail__grid">
        <div>
          <h4 class="institution-hub__section-label">Discovery timeline</h4>
          ${renderDiscoveryTimeline(history)}
        </div>
        <div>
          <h4 class="institution-hub__section-label">Quarterly adoption history</h4>
          ${historyHtml}
          <p class="muted small">Ownership now ${Number(row.institutionalOwnershipPercent || 0).toFixed(
            2
          )}% · Δ ${escapeHtml(formatDiscoveryGrowth(row.ownershipChangePercent))} · exited ${formatInteger(
            row.exitedHolderCount
          )}</p>
        </div>
      </div>
      <div class="discovery-detail__institutions">
        ${renderDiscoveryInstitutionTable("Who discovered this stock?", row.newInstitutions)}
        ${renderDiscoveryInstitutionTable("First recorded positions", row.firstRecordedPositions)}
        ${renderDiscoveryInstitutionTable("Exited institutions", row.exitedInstitutions)}
      </div>
    </div>`;
}

function renderInstitutionalDiscoveryHub() {
  setupInstitutionalDiscoveryHub();
  const payload = lastInstitutionalDiscoveryPayload;
  const body = document.getElementById("institutional-discovery-body");
  const meta = document.getElementById("institutional-discovery-meta");
  const countEl = document.getElementById("institutional-discovery-count");
  const pagination = document.getElementById("institutional-discovery-pagination");
  const pageInfo = document.getElementById("institutional-discovery-page-info");
  const prevBtn = document.getElementById("institutional-discovery-prev");
  const nextBtn = document.getElementById("institutional-discovery-next");
  const loading = document.getElementById("institutional-discovery-loading");

  if (loading) loading.hidden = !institutionalDiscoveryLoading;

  document.querySelectorAll("[data-institutional-discovery-sort]").forEach((btn) => {
    const key = btn.dataset.institutionalDiscoverySort;
    const label = btn.textContent.replace(/\s*[▲▼]\s*$/, "").trim();
    const active = key === institutionalDiscoverySortKey;
    btn.classList.toggle("is-active", active);
    btn.setAttribute(
      "aria-sort",
      active ? (institutionalDiscoverySortDir === "asc" ? "ascending" : "descending") : "none"
    );
    btn.textContent = active
      ? `${label} ${institutionalDiscoverySortDir === "asc" ? "▲" : "▼"}`
      : label;
  });

  const summary = payload?.summary || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("institutional-discovery-discoveries", formatInteger(summary.newDiscoveries ?? 0));
  setText(
    "institutional-discovery-new-positions",
    formatInteger(summary.newInstitutionalPositions ?? 0)
  );
  const fastest = summary.fastestHolderGrowth;
  setText(
    "institutional-discovery-fastest",
    fastest
      ? `${fastest.ticker} · ${formatDiscoveryGrowth(fastest.holderGrowthPercent)}`
      : "—"
  );
  const streak = summary.longestAdoptionStreak;
  setText(
    "institutional-discovery-streak",
    streak ? `${streak.ticker} · ${formatInteger(streak.streak)}q` : "—"
  );

  if (!payload) {
    if (body && !institutionalDiscoveryLoading) {
      body.innerHTML = `<tr><td colspan="10" class="muted">No discovery scores loaded. Run <code class="inline-code">npm run signals:warm-institutional-discovery</code> if needed.</td></tr>`;
    }
    if (meta) meta.textContent = institutionalDiscoveryLoading ? "Loading…" : "—";
    return;
  }

  renderInstitutionalDiscoveryFilterOptions(payload);
  const rows = Array.isArray(payload.signals) ? payload.signals : [];
  const total = Number(payload.total) || rows.length;
  const page = Number(payload.page) || institutionalDiscoveryPage;
  const pageSize = Number(payload.pageSize) || INSTITUTIONAL_DISCOVERY_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (countEl) countEl.textContent = `${formatInteger(total)} stocks`;
  if (meta) {
    meta.textContent = `${payload.currentQuarter || "—"}${
      payload.previousQuarter ? ` vs ${payload.previousQuarter}` : ""
    } · adoption score · explainable components`;
  }
  if (pagination) pagination.hidden = total <= pageSize;
  if (pageInfo) pageInfo.textContent = `Page ${page} of ${pageCount}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= pageCount;

  if (!rows.length) {
    if (body) {
      body.innerHTML = `<tr><td colspan="10" class="muted">No stocks match these filters.</td></tr>`;
    }
    return;
  }

  const startRank = (page - 1) * pageSize;
  if (body) {
    body.innerHTML = rows
      .map((row, i) => {
        const ticker = String(row.ticker || "").toUpperCase();
        const expanded = institutionalDiscoveryExpanded.has(ticker);
        const score =
          row.discoveryScore == null ? "—" : Number(row.discoveryScore).toFixed(0);
        const classification = row.classification || "—";
        const stockLabel = row.companyName
          ? `<span class="most-accumulated-stock__name">${escapeHtml(row.companyName)}</span><span class="most-accumulated-stock__ticker mono muted small">${escapeHtml(ticker)}</span>`
          : `<span class="most-accumulated-stock__name mono">${escapeHtml(ticker)}</span>`;
        return `
        <tr class="discovery-row${expanded ? " is-expanded" : ""}" data-discovery-ticker="${escapeHtml(ticker)}">
          <td class="mono num">${startRank + i + 1}</td>
          <td>
            <div class="discovery-stock">
              <button type="button" class="btn btn--ghost discovery-expand" data-discovery-expand="${escapeHtml(ticker)}" aria-expanded="${expanded ? "true" : "false"}">${expanded ? "▾" : "▸"}</button>
              <a href="${stockPath(ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(ticker)}">${stockLabel}</a>
            </div>
          </td>
          <td class="mono num">${formatInteger(row.currentHolderCount)}</td>
          <td class="mono num">+${formatInteger(row.newHolderCount)}</td>
          <td class="mono num">${escapeHtml(formatDiscoveryGrowth(row.holderGrowthPercent))}</td>
          <td class="mono num">${formatInteger(row.firstTimePositionCount)}</td>
          <td class="mono num">${escapeHtml(formatDiscoveryGrowth(row.ownershipChangePercent))}</td>
          <td class="mono num">${formatInteger(row.currentGrowthStreak)}</td>
          <td class="mono num">${escapeHtml(score)}</td>
          <td><span class="${discoveryBadgeClass(classification)}">${escapeHtml(classification)}</span></td>
        </tr>
        <tr class="discovery-detail-row" ${expanded ? "" : "hidden"}>
          <td colspan="10">${renderInstitutionalDiscoveryDetail(row)}</td>
        </tr>`;
      })
      .join("");
  }
}

async function loadInstitutionalDiscoveryHub() {
  if (institutionalDiscoveryLoading) {
    renderInstitutionalDiscoveryHub();
    return;
  }
  institutionalDiscoveryLoading = true;
  renderInstitutionalDiscoveryHub();
  const requestKey = JSON.stringify(institutionalDiscoveryQueryParams());
  try {
    lastInstitutionalDiscoveryPayload = await apiJson(
      "/api/signals/institutional-discovery",
      institutionalDiscoveryQueryParams()
    );
  } catch (err) {
    const body = document.getElementById("institutional-discovery-body");
    if (body) {
      body.innerHTML = `<tr><td colspan="10" class="trades-table__empty">${escapeHtml(
        err instanceof Error ? err.message : String(err)
      )}</td></tr>`;
    }
  } finally {
    institutionalDiscoveryLoading = false;
    if (JSON.stringify(institutionalDiscoveryQueryParams()) !== requestKey) {
      void loadInstitutionalDiscoveryHub();
      return;
    }
    renderInstitutionalDiscoveryHub();
  }
}

function setupInstitutionalDiscoveryHub() {
  if (institutionalDiscoveryBound) return;
  institutionalDiscoveryBound = true;

  document.getElementById("institutional-discovery-prev")?.addEventListener("click", () => {
    if (institutionalDiscoveryPage <= 1) return;
    institutionalDiscoveryPage -= 1;
    void loadInstitutionalDiscoveryHub();
  });
  document.getElementById("institutional-discovery-next")?.addEventListener("click", () => {
    institutionalDiscoveryPage += 1;
    void loadInstitutionalDiscoveryHub();
  });

  const panel = document.getElementById("signals-institutional-discovery-hub");
  panel?.addEventListener("click", (e) => {
    const expandBtn = e.target.closest?.("[data-discovery-expand]");
    if (expandBtn) {
      e.preventDefault();
      const ticker = expandBtn.getAttribute("data-discovery-expand");
      if (!ticker) return;
      if (institutionalDiscoveryExpanded.has(ticker)) institutionalDiscoveryExpanded.delete(ticker);
      else institutionalDiscoveryExpanded.add(ticker);
      renderInstitutionalDiscoveryHub();
      return;
    }
    const sortBtn = e.target.closest?.("[data-institutional-discovery-sort]");
    if (sortBtn) {
      const key = sortBtn.getAttribute("data-institutional-discovery-sort");
      if (!key) return;
      if (institutionalDiscoverySortKey === key) {
        institutionalDiscoverySortDir = institutionalDiscoverySortDir === "desc" ? "asc" : "desc";
      } else {
        institutionalDiscoverySortKey = key;
        institutionalDiscoverySortDir =
          key === "ticker" || key === "companyName" || key === "classification" ? "asc" : "desc";
      }
      institutionalDiscoveryPage = 1;
      void loadInstitutionalDiscoveryHub();
    }
  });

  [
    "institutional-discovery-quarter",
    "institutional-discovery-sector",
    "institutional-discovery-mcap",
    "institutional-discovery-min-score",
    "institutional-discovery-min-new",
    "institutional-discovery-min-growth",
    "institutional-discovery-min-streak",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      syncInstitutionalDiscoveryFiltersFromDom();
      institutionalDiscoveryPage = 1;
      void loadInstitutionalDiscoveryHub();
    });
  });

  let searchTimer = null;
  document.getElementById("institutional-discovery-search")?.addEventListener("input", () => {
    syncInstitutionalDiscoveryFiltersFromDom();
    institutionalDiscoveryPage = 1;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadInstitutionalDiscoveryHub(), 250);
  });
}

async function loadSmartMoneyHub() {
  const body = document.getElementById("smart-money-hub-body");
  const meta = document.getElementById("smart-money-hub-meta");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">Loading smart money scores…</td></tr>`;
  if (meta) meta.textContent = "Loading…";
  try {
    const data = await apiJson("/api/smart-money/scores", { limit: 100 });
    const rows = Array.isArray(data?.scores) ? data.scores : [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">No smart money scores yet. Run <code class="inline-code">npm run smart-money:warm-cache</code>, then restart the server.</td></tr>`;
      if (meta) meta.textContent = "Requires institutional, insider, and Congress data on the same ticker";
      return;
    }
    if (meta) {
      meta.textContent = `Top ${rows.length} of ${data.count ?? rows.length} tickers · 0–100 conviction`;
    }
    body.innerHTML = rows
      .map(
        (row, i) => `<tr>
        <td class="mono num">${i + 1}</td>
        <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link most-accumulated-stock" data-stock-symbol="${escapeHtml(row.ticker)}"><span class="most-accumulated-stock__name mono">${escapeHtml(row.ticker)}</span></a></td>
        <td class="mono num">${Number(row.smartMoneyConvictionScore).toFixed(1)}</td>
        <td class="mono num">${formatSmartMoneyComponent(row.institutionalScore)}</td>
        <td class="mono num">${formatSmartMoneyComponent(row.insiderScore)}</td>
        <td class="mono num">${formatSmartMoneyComponent(row.politicianScore)}</td>
        <td class="mono num">${row.alignmentScore != null ? `${(Number(row.alignmentScore) * 100).toFixed(0)}%` : "—"}</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));
    body.innerHTML = `<tr><td colspan="7" class="trades-table__empty">${msg}</td></tr>`;
    if (meta) meta.textContent = "Failed to load";
  }
}

/* ===================== Screener ===================== */

let screenerCatalog = null;
let screenerInitialized = false;

const SCREENER_OP_LABELS = {
  greaterThan: ">",
  greaterThanOrEqual: "≥",
  lessThan: "<",
  lessThanOrEqual: "≤",
  equals: "=",
  notEquals: "≠",
  contains: "contains",
  in: "in",
  between: "between",
  isTrue: "is true",
};

function formatScreenerUsd(value) {
  const x = Number(value);
  if (!Number.isFinite(x) || x === 0) return "—";
  const sign = x < 0 ? "−" : "";
  return `${sign}${formatSecFundamentalValue(Math.abs(x))}`;
}

async function initScreenerHub() {
  if (screenerInitialized) return;
  screenerInitialized = true;
  const host = document.getElementById("screener-filters");
  document.getElementById("stocks-screener-back")?.addEventListener("click", () => {
    navigateToStocksHub();
  });
  document.getElementById("screener-run")?.addEventListener("click", () => void runScreenerSearch());
  document.getElementById("screener-reset")?.addEventListener("click", resetScreenerFilters);
  try {
    screenerCatalog = await apiJson("/api/screener/filters");
    renderScreenerFilters();
  } catch (err) {
    if (host) {
      host.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(
        err instanceof Error ? err.message : String(err)
      )}</p>`;
    }
  }
}

function renderScreenerControl(def) {
  const ops = Array.isArray(def.operators) ? def.operators : [];
  const opSelect = (operators) =>
    `<select class="screener-field__op" data-role="op">${operators
      .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(SCREENER_OP_LABELS[o] || o)}</option>`)
      .join("")}</select>`;
  const unitHint = def.unit === "usd" ? "$" : def.unit === "percent" ? "%" : "";

  let control = "";
  if (def.type === "boolean") {
    control = "";
  } else if (def.type === "number") {
    control = `${opSelect(ops.filter((o) => o !== "in"))}
      <input type="number" step="any" class="screener-field__input" data-role="value" placeholder="${escapeHtml(unitHint || "value")}" />`;
  } else if (def.type === "dateRange") {
    control = `<input type="date" class="screener-field__input" data-role="from" />
      <span class="muted small">to</span>
      <input type="date" class="screener-field__input" data-role="to" />`;
  } else if (def.type === "string") {
    control = `<input type="text" class="screener-field__input" data-role="value" placeholder="contains…" />`;
  } else if ((def.type === "enum" || def.type === "institution") && Array.isArray(def.options)) {
    const onlyEquals = ops.length === 1 && ops[0] === "equals";
    const multiple = !onlyEquals && ops.includes("in");
    const size = def.type === "institution" ? 6 : Math.min(6, Math.max(2, def.options.length));
    const opts = def.options
      .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
      .join("");
    control = `<select class="screener-field__select" data-role="value" ${multiple ? `multiple size="${size}"` : ""}>${
      multiple ? "" : `<option value="">Any</option>`
    }${opts}</select>`;
  }

  return `<div class="screener-field" data-screener-filter data-field="${escapeHtml(def.field)}" data-type="${escapeHtml(def.type)}">
    <label class="screener-field__head">
      <input type="checkbox" data-role="enable" />
      <span class="screener-field__label">${escapeHtml(def.label)}${unitHint ? ` <span class="muted">(${unitHint})</span>` : ""}</span>
    </label>
    ${control ? `<div class="screener-field__control">${control}</div>` : ""}
  </div>`;
}

function renderScreenerFilters() {
  const host = document.getElementById("screener-filters");
  if (!host || !screenerCatalog) return;
  const categories = Array.isArray(screenerCatalog.categories) ? screenerCatalog.categories : [];
  const filters = Array.isArray(screenerCatalog.filters) ? screenerCatalog.filters : [];
  host.innerHTML = categories
    .map((category) => {
      const inCat = filters.filter((f) => f.category === category);
      if (!inCat.length) return "";
      return `<details class="screener-group" open>
        <summary class="screener-group__title">${escapeHtml(category)}</summary>
        <div class="screener-group__body">${inCat.map(renderScreenerControl).join("")}</div>
      </details>`;
    })
    .join("");
  host.querySelectorAll("[data-screener-filter] [data-role=enable]").forEach((el) => {
    el.addEventListener("change", updateScreenerActiveCount);
  });
  updateScreenerActiveCount();
}

function collectScreenerFilters() {
  const containers = document.querySelectorAll("#screener-filters [data-screener-filter]");
  const filters = [];
  containers.forEach((container) => {
    const enable = container.querySelector("[data-role=enable]");
    if (!enable || !enable.checked) return;
    const field = container.dataset.field;
    const type = container.dataset.type;

    if (type === "boolean") {
      filters.push({ field, operator: "isTrue", value: true });
      return;
    }
    if (type === "dateRange") {
      const from = container.querySelector("[data-role=from]")?.value;
      const to = container.querySelector("[data-role=to]")?.value;
      if (from && to) filters.push({ field, operator: "between", value: { from, to } });
      return;
    }
    if (type === "number") {
      const operator = container.querySelector("[data-role=op]")?.value || "greaterThan";
      const raw = container.querySelector("[data-role=value]")?.value;
      if (raw !== "" && raw != null) filters.push({ field, operator, value: Number(raw) });
      return;
    }
    if (type === "string") {
      const raw = container.querySelector("[data-role=value]")?.value?.trim();
      if (raw) filters.push({ field, operator: "contains", value: raw });
      return;
    }
    if (type === "enum" || type === "institution") {
      const select = container.querySelector("[data-role=value]");
      if (!select) return;
      if (select.multiple) {
        const values = [...select.selectedOptions].map((o) => o.value).filter(Boolean);
        if (values.length === 1) filters.push({ field, operator: "equals", value: values[0] });
        else if (values.length > 1) filters.push({ field, operator: "in", value: values });
      } else if (select.value) {
        filters.push({ field, operator: "equals", value: select.value });
      }
    }
  });
  return filters;
}

function updateScreenerActiveCount() {
  const el = document.getElementById("screener-active-count");
  if (!el) return;
  const n = document.querySelectorAll("#screener-filters [data-role=enable]:checked").length;
  el.textContent = n ? `${n} active` : "";
}

function resetScreenerFilters() {
  document.querySelectorAll("#screener-filters [data-screener-filter]").forEach((container) => {
    const enable = container.querySelector("[data-role=enable]");
    if (enable) enable.checked = false;
    container.querySelectorAll("input[type=number], input[type=text], input[type=date]").forEach((i) => (i.value = ""));
    container.querySelectorAll("select").forEach((s) => {
      if (s.multiple) [...s.options].forEach((o) => (o.selected = false));
      else s.selectedIndex = 0;
    });
  });
  updateScreenerActiveCount();
  const body = document.getElementById("screener-results-body");
  if (body) body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No results yet — add filters and run the screener.</td></tr>`;
  const meta = document.getElementById("screener-meta");
  if (meta) meta.textContent = "Choose filters and run the screener.";
}

async function runScreenerSearch() {
  const body = document.getElementById("screener-results-body");
  const meta = document.getElementById("screener-meta");
  if (!body) return;
  const filters = collectScreenerFilters();
  body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">Running screener…</td></tr>`;
  if (meta) meta.textContent = "Running…";
  try {
    const res = await fetch("/api/screener", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters, limit: 100 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || res.statusText);
    renderScreenerResults(data);
  } catch (err) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${escapeHtml(
      err instanceof Error ? err.message : String(err)
    )}</td></tr>`;
    if (meta) meta.textContent = "Failed";
  }
}

function renderScreenerResults(data) {
  const body = document.getElementById("screener-results-body");
  const meta = document.getElementById("screener-meta");
  if (!body) return;
  const rows = Array.isArray(data?.results) ? data.results : [];

  if (meta) {
    const parts = [`${data.total ?? rows.length} match${(data.total ?? rows.length) === 1 ? "" : "es"}`];
    if (data.total > rows.length) parts.push(`showing ${rows.length}`);
    if (Array.isArray(data.skippedFilters) && data.skippedFilters.length) {
      parts.push(`${data.skippedFilters.length} filter(s) skipped`);
    }
    meta.textContent = parts.join(" · ");
    meta.title = (data.skippedFilters || []).map((s) => `${s.field}: ${s.reason}`).join("\n");
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">No stocks match these filters.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (row, i) => `<tr>
      <td class="mono num">${i + 1}</td>
      <td><a href="${stockPath(row.ticker)}" class="fundamentals-grid__link" data-stock-symbol="${escapeHtml(row.ticker)}">${escapeHtml(row.ticker)}</a></td>
      <td>${escapeHtml(row.companyName || "—")}</td>
      <td>${escapeHtml(row.sector || "—")}</td>
      <td class="mono num">${row.revenue != null ? formatScreenerUsd(row.revenue) : "—"}</td>
      <td class="mono num">${row.freeCashFlow != null ? formatScreenerUsd(row.freeCashFlow) : "—"}</td>
      <td class="mono num">${row.insiderNetValueUsd != null ? formatScreenerUsd(row.insiderNetValueUsd) : "—"}</td>
      <td class="mono num">${row.institutionCount != null ? row.institutionCount : "—"}</td>
      <td class="mono num">${row.politicianNetAmountUsd != null ? formatScreenerUsd(row.politicianNetAmountUsd) : "—"}</td>
    </tr>`
    )
    .join("");
}

function renderOwnershipIntelligencePanel(data, errMsg) {
  const grid = document.getElementById("overview-ownership-intel-grid");
  const metaEl = document.getElementById("overview-ownership-intel-meta");
  if (!grid) return;

  if (errMsg) {
    grid.classList.add("overview-ownership-intel__grid--empty");
    grid.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(errMsg)}</p>`;
    if (metaEl) metaEl.hidden = true;
    return;
  }

  if (!data) {
    grid.classList.add("overview-ownership-intel__grid--empty");
    grid.innerHTML =
      '<p class="fundamentals-grid__empty">Select a stock to load ownership intelligence.</p>';
    if (metaEl) metaEl.hidden = true;
    return;
  }

  const inst = data.institutional || {};
  const insider = data.insider || {};
  const pol = data.politician || {};
  const sm = data.smartMoney;
  const smWrap = document.getElementById("overview-smart-money");
  const smScore = document.getElementById("overview-smart-money-score");
  const smHint = document.getElementById("overview-smart-money-hint");
  if (smWrap && smScore && smHint) {
    if (sm?.smartMoneyConvictionScore != null) {
      smWrap.hidden = false;
      smScore.textContent = Number(sm.smartMoneyConvictionScore).toFixed(1);
      smScore.className = `overview-smart-money__score mono ${smartMoneyConvictionClass(sm.smartMoneyConvictionScore)}`;
      smHint.textContent = `${smartMoneyConvictionLabel(sm.smartMoneyConvictionScore)} · alignment ${sm.alignmentScore != null ? `${(Number(sm.alignmentScore) * 100).toFixed(0)}%` : "—"}`;
    } else {
      smWrap.hidden = true;
      smScore.textContent = "—";
      smHint.textContent = "";
    }
  }
  const ownershipPct =
    inst.ownershipPct != null ? `${Number(inst.ownershipPct).toFixed(1)}%` : "—";

  grid.classList.remove("overview-ownership-intel__grid--empty");
  grid.innerHTML = [
    renderOwnershipIntelItem("Institutional trend", renderOwnershipIntelTrend(inst.trend)),
    renderOwnershipIntelItem("Institutional ownership", escapeHtml(ownershipPct)),
    renderOwnershipIntelItem(
      "QoQ change of institutions",
      escapeHtml(formatSignedCount(inst.institutionCountChange))
    ),
    renderOwnershipIntelItem(
      "New institutional positions",
      escapeHtml(inst.newPositions != null ? String(inst.newPositions) : "—")
    ),
    renderOwnershipIntelItem("Insider activity", renderOwnershipIntelTrend(insider.trend)),
    renderOwnershipIntelItem(
      "Net insider buying",
      formatOwnershipIntelNetShares(insider.netShares, insider.netValueUsd)
    ),
    renderOwnershipIntelItem("Politician activity", renderOwnershipIntelTrend(pol.trend)),
  ].join("");

  if (metaEl) {
    metaEl.textContent = "";
    metaEl.hidden = true;
  }
}

function neutralBadgeHtml() {
  return '<span class="overview-signal-dot" aria-hidden="true"></span>';
}

function signalBadgeHtml(signal) {
  if (signal === "green") return "🟢";
  if (signal === "yellow") return neutralBadgeHtml();
  return "🔴";
}

function overallRatingClass(rating) {
  return `overview-header__rating--${String(rating || "neutral").toLowerCase()}`;
}

function renderTopSignalRow({ metric, displayMetric, signal, value }) {
  const name = displayMetric || metric;
  const val = formatSignalMetricValue(metric, value);
  return `<li class="overview-top-signal overview-top-signal--${escapeHtml(signal)}">
    <span class="overview-top-signal__badge" aria-hidden="true">${signalBadgeHtml(signal)}</span>
    <span class="overview-top-signal__metric">${escapeHtml(name)}</span>
    <span class="overview-top-signal__value mono">${val}</span>
  </li>`;
}

function renderCategoryDetailRow({ metric, displayMetric, signal, value }) {
  const name = displayMetric || metric;
  const val = formatSignalMetricValue(metric, value);
  return `<div class="overview-category-metric">
    <span class="overview-category-metric__name">${escapeHtml(name)}</span>
    <span class="overview-category-metric__value mono">${val}</span>
    <span class="overview-category-metric__badge" aria-hidden="true">${signalBadgeHtml(signal)}</span>
  </div>`;
}

function renderCategoryCard({ name, score, tone, metrics }) {
  const scoreLabel = score != null ? `${score}/100` : "—";
  const rows =
    metrics.length > 0
      ? metrics.map(renderCategoryDetailRow).join("")
      : `<p class="overview-category__empty muted small">No metrics available.</p>`;
  return `<details class="overview-category overview-category--${escapeHtml(tone)}" open>
    <summary class="overview-category__summary">
      <span class="overview-category__name">${escapeHtml(name)}</span>
      <span class="overview-category__score mono">${scoreLabel}</span>
      <span class="overview-category__badge" aria-hidden="true">${signalBadgeHtml(tone)}</span>
    </summary>
    <div class="overview-category__details">${rows}</div>
  </details>`;
}

function setSignalsCategoriesSource(text) {
  const el = document.getElementById("signals-categories-source");
  if (el) el.textContent = text;
}

function renderCategoryScoresPanel(secFilings, errMsg) {
  const categoriesEl = document.getElementById("signals-categories-grid");
  if (!categoriesEl) return;

  if (errMsg) {
    setSignalsCategoriesSource("SEC Company Facts");
    categoriesEl.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(errMsg)}</p>`;
    return;
  }

  if (!secFilings) {
    setSignalsCategoriesSource("SEC Company Facts");
    categoriesEl.innerHTML = `<p class="fundamentals-grid__empty">Select a stock to score categories.</p>`;
    return;
  }

  const parts = ["SEC Company Facts"];
  if (secFilings.entityName) parts.push(secFilings.entityName);
  if (secFilings.ticker) parts.push(secFilings.ticker);
  setSignalsCategoriesSource(parts.join(" · "));

  const { signals } = generateSignals(filingsFundamentalsToSignalInput(secFilings));
  const categories = getCategoryScores(signals);
  categoriesEl.innerHTML = categories.map(renderCategoryCard).join("");
}

function renderStockOverview(overviewData, errMsg) {
  const panel = document.getElementById("overview-panel");
  const scoreEl = document.getElementById("overview-total-score");
  const ratingEl = document.getElementById("overview-overall-rating");
  const countsEl = document.getElementById("overview-signal-counts");
  const bullishEl = document.getElementById("overview-bullish-list");
  const bearishEl = document.getElementById("overview-bearish-list");
  const keyStatsEl = document.getElementById("overview-key-stats-grid");

  const secFilings = overviewData?.secFilings ?? null;
  const hasOverviewData = Boolean(secFilings);

  if (panel) panel.classList.toggle("overview-panel--empty", !hasOverviewData || !!errMsg);

  if (errMsg) {
    if (scoreEl) scoreEl.textContent = "—";
    if (ratingEl) {
      ratingEl.textContent = "Unavailable";
      ratingEl.className = "overview-header__rating";
    }
    if (countsEl) {
      countsEl.innerHTML = `<span class="overview-count overview-count--green">🟢 <strong>0</strong> Strong</span>
        <span class="overview-count overview-count--neutral">${neutralBadgeHtml()} <strong>0</strong> Neutral</span>
        <span class="overview-count overview-count--red">🔴 <strong>0</strong> Weak</span>`;
    }
    if (bullishEl) bullishEl.innerHTML = `<li class="overview-top-signal__empty muted small">${escapeHtml(errMsg)}</li>`;
    if (bearishEl) bearishEl.innerHTML = "";
    if (keyStatsEl) {
      keyStatsEl.classList.add("overview-key-stats__grid--empty");
      keyStatsEl.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(errMsg)}</p>`;
    }
    return;
  }

  if (!hasOverviewData) {
    if (scoreEl) scoreEl.textContent = "—";
    if (ratingEl) {
      ratingEl.textContent = "—";
      ratingEl.className = "overview-header__rating";
    }
    if (countsEl) {
      countsEl.innerHTML = `<span class="overview-count overview-count--green">🟢 <strong>0</strong> Strong</span>
        <span class="overview-count overview-count--neutral">${neutralBadgeHtml()} <strong>0</strong> Neutral</span>
        <span class="overview-count overview-count--red">🔴 <strong>0</strong> Weak</span>`;
    }
    if (bullishEl) {
      bullishEl.innerHTML = `<li class="overview-top-signal__empty muted small">Select a stock to generate signals.</li>`;
    }
    if (bearishEl) bearishEl.innerHTML = "";
    if (keyStatsEl) {
      keyStatsEl.classList.add("overview-key-stats__grid--empty");
      keyStatsEl.innerHTML = `<p class="fundamentals-grid__empty">Select a stock to load metrics.</p>`;
    }
    return;
  }

  if (!secFilings) {
    if (scoreEl) scoreEl.textContent = "—";
    if (ratingEl) {
      ratingEl.textContent = "Unavailable";
      ratingEl.className = "overview-header__rating";
    }
    if (countsEl) {
      countsEl.innerHTML = `<span class="overview-count overview-count--green">🟢 <strong>0</strong> Strong</span>
        <span class="overview-count overview-count--neutral">${neutralBadgeHtml()} <strong>0</strong> Neutral</span>
        <span class="overview-count overview-count--red">🔴 <strong>0</strong> Weak</span>`;
    }
    if (bullishEl) {
      bullishEl.innerHTML = `<li class="overview-top-signal__empty muted small">SEC filings fundamentals unavailable.</li>`;
    }
    if (bearishEl) bearishEl.innerHTML = "";
  } else {
    const { signals, summary } = generateSignals(filingsFundamentalsToSignalInput(secFilings));
    const rating = getOverallRating(summary.totalScore);
    const bullish = getTopBullishSignals(signals);
    const bearish = getTopBearishSignals(signals);

    const scoreText = `${summary.totalScore >= 0 ? "+" : ""}${summary.totalScore}`;
    if (scoreEl) scoreEl.textContent = scoreText;
    if (ratingEl) {
      ratingEl.textContent = rating;
      ratingEl.className = `overview-header__rating ${overallRatingClass(rating)}`;
    }
    if (countsEl) {
      countsEl.innerHTML = `<span class="overview-count overview-count--green">🟢 <strong>${summary.totalGreen}</strong> Strong</span>
      <span class="overview-count overview-count--neutral">${neutralBadgeHtml()} <strong>${summary.totalYellow}</strong> Neutral</span>
      <span class="overview-count overview-count--red">🔴 <strong>${summary.totalRed}</strong> Weak</span>`;
    }

    if (bullishEl) {
      bullishEl.innerHTML =
        bullish.length > 0
          ? bullish.map(renderTopSignalRow).join("")
          : `<li class="overview-top-signal__empty muted small">No strong bullish signals.</li>`;
    }
    if (bearishEl) {
      bearishEl.innerHTML =
        bearish.length > 0
          ? bearish.map(renderTopSignalRow).join("")
          : `<li class="overview-top-signal__empty muted small">No strong bearish signals.</li>`;
    }
  }

  if (keyStatsEl) {
    if (secFilings && hasOverviewFilingMetrics(secFilings)) {
      keyStatsEl.classList.remove("overview-key-stats__grid--empty");
      keyStatsEl.innerHTML = renderOverviewMetricsGrid(secFilings);
    } else if (secFilings) {
      keyStatsEl.classList.add("overview-key-stats__grid--empty");
      keyStatsEl.innerHTML = `<p class="fundamentals-grid__empty">Metrics unavailable for this ticker.</p>`;
    } else {
      keyStatsEl.classList.add("overview-key-stats__grid--empty");
      keyStatsEl.innerHTML = `<p class="fundamentals-grid__empty">Metrics unavailable.</p>`;
    }
  }
}

function renderOverviewEmpty(msg) {
  setOverviewDataSource("SEC Company Facts");
  renderStockOverview(null);
  renderCategoryScoresPanel(null);
  renderOwnershipIntelligencePanel(null);
  if (msg) {
    const bullishEl = document.getElementById("overview-bullish-list");
    const keyStatsEl = document.getElementById("overview-key-stats-grid");
    const text = escapeHtml(msg);
    if (bullishEl) {
      bullishEl.innerHTML = `<li class="overview-top-signal__empty muted small">${text}</li>`;
    }
    if (keyStatsEl) {
      keyStatsEl.classList.add("overview-key-stats__grid--empty");
      keyStatsEl.innerHTML = `<p class="fundamentals-grid__empty">${text}</p>`;
    }
  }
}


function formatPrice(n, currency = activeCurrency) {
  const code = currency || "USD";
  try {
    return Number(n).toLocaleString(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${Number(n).toFixed(2)} ${code}`;
  }
}

function formatChange(pct) {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchQuote(_symbol) {
  return {
    price: null,
    changePct: 0,
    currency: "USD",
    name: _symbol,
    exchange: "",
    sparkline: [],
  };
}

async function fetchWatchlistEntry(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  let name = sym;
  try {
    const data = await apiJson("/api/stocks/search", { q: sym, limit: 8 });
    const results = Array.isArray(data?.results) ? data.results : [];
    const exact = results.find((r) => String(r.symbol || "").toUpperCase() === sym);
    const hit = exact || results[0];
    name = hit?.name || hit?.description || sym;
  } catch {
    /* keep ticker as name */
  }
  return {
    symbol: sym,
    name,
    price: null,
    changePct: 0,
    currency: "USD",
    exchange: "",
    notifications: [],
    signals: [],
    latestActivity: null,
  };
}

function renderWatchlistNotifications(notifications, status) {
  if (status === "loading") {
    return `<span class="watchlist__notices"><span class="watchlist__notice watchlist__notice--loading">Loading…</span></span>`;
  }
  const list = Array.isArray(notifications) ? notifications : [];
  if (!list.length) {
    return `<span class="watchlist__notices watchlist__notices--empty" aria-hidden="true"></span>`;
  }
  return `<span class="watchlist__notices">${list
    .map((n) => {
      const tone = n?.tone === "buy" || n?.tone === "sell" ? n.tone : "neutral";
      const label = String(n?.label || "").trim();
      if (!label) return "";
      return `<span class="watchlist__notice watchlist__notice--${tone}">${escapeHtml(label)}</span>`;
    })
    .filter(Boolean)
    .join("")}</span>`;
}

let watchlistActivitySeq = 0;

async function loadWatchlistActivity() {
  if (!watchlist.length) return;
  const tickers = watchlist.map((w) => String(w.symbol || "").trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return;
  const seq = ++watchlistActivitySeq;

  watchlist = watchlist.map((w) => ({ ...w, noticesStatus: "loading" }));
  renderWatchlist();

  const queue = [...tickers];
  let failures = 0;

  async function loadOne(ticker) {
    try {
      const data = await apiJson("/api/watchlist/activity", { tickers: ticker });
      if (seq !== watchlistActivitySeq) return;
      const row = Array.isArray(data?.rows) ? data.rows[0] : null;
      watchlist = watchlist.map((w) => {
        if (String(w.symbol || "").toUpperCase() !== ticker) return w;
        return {
          ...w,
          notifications: Array.isArray(row?.notifications) ? row.notifications : [],
          signals: Array.isArray(row?.signals) ? row.signals : [],
          latestActivity: row?.latestActivity || null,
          noticesStatus: "ready",
        };
      });
      renderWatchlist();
    } catch {
      if (seq !== watchlistActivitySeq) return;
      failures += 1;
      watchlist = watchlist.map((w) =>
        String(w.symbol || "").toUpperCase() === ticker
          ? { ...w, noticesStatus: "ready" }
          : w
      );
      renderWatchlist();
    }
  }

  const concurrency = Math.min(4, queue.length);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length && seq === watchlistActivitySeq) {
        const ticker = queue.shift();
        if (!ticker) break;
        await loadOne(ticker);
      }
    })
  );

  if (seq === watchlistActivitySeq && failures === tickers.length && tickers.length) {
    setDashboardStatus("Watchlist activity failed to load. Is the server running?", true);
    setTimeout(() => setDashboardStatus(""), 8000);
  }
}

async function refreshWatchlistFromApi() {
  if (!watchlist.length) return;
  const prevBySymbol = new Map(
    watchlist.map((w) => [String(w.symbol || "").toUpperCase(), w])
  );
  const settled = await Promise.allSettled(watchlist.map((w) => fetchWatchlistEntry(w.symbol)));
  const next = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => {
      const entry = r.value;
      const prev = prevBySymbol.get(String(entry.symbol || "").toUpperCase());
      return {
        ...entry,
        notifications: Array.isArray(prev?.notifications) ? prev.notifications : [],
        signals: Array.isArray(prev?.signals) ? prev.signals : [],
        latestActivity: prev?.latestActivity || null,
        noticesStatus: prev?.noticesStatus || "ready",
      };
    });
  const failed = watchlist.length - next.length;
  if (next.length) {
    watchlist = next;
    if (activeIndex >= 0) {
      activeIndex = Math.min(activeIndex, watchlist.length - 1);
    }
  }
  if (failed) {
    setDashboardStatus(`Some symbols failed to refresh (${failed}).`);
    setTimeout(() => setDashboardStatus(""), 8000);
  }
  updateWatchlistBadge();
  await loadWatchlistActivity();
}

async function searchStocks(query) {
  const q = query.trim();
  if (q.length < 1) return [];
  const u = new URL("/api/stocks/search", window.location.origin);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "20");
  const res = await fetch(u);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const msg = body.message || body.error || text || res.statusText;
    throw new Error(typeof msg === "string" ? msg : res.statusText);
  }
  return Array.isArray(body.results) ? body.results : [];
}

const RANGE_LABELS = {
  "1D": "1D",
  "5D": "5D",
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  YTD: "YTD",
  "1Y": "1Y",
  "5Y": "5Y",
  MAX: "Max",
};

const RANGE_INTERVAL_LABELS = {
  "1D": "5m",
  "5D": "15m",
  "1M": "1h",
  "3M": "1d",
  "6M": "1d",
  YTD: "1d",
  "1Y": "1d",
  "5Y": "1wk",
  MAX: "1mo",
};

async function fetchCandles(_symbol, _range) {
  // Lightweight-charts path retired with Yahoo; TradingView is the live chart.
  return null;
}

function buildCandleDataFromPayload(data) {
  const timestamps = data?.timestamp;
  if (Array.isArray(timestamps) && timestamps.length > 0) {
    return dedupeCandleRows(
      timestamps.map((t, i) => ({
        time: Number(t),
        open: Number(data.open?.[i]),
        high: Number(data.high?.[i]),
        low: Number(data.low?.[i]),
        close: Number(data.close?.[i]),
      }))
    );
  }
  if (Array.isArray(data?.bars) && data.bars.length > 0) {
    return dedupeCandleRows(
      data.bars.map((b) => ({
        time: Number(b.t),
        open: Number(b.o),
        high: Number(b.h),
        low: Number(b.l),
        close: Number(b.c),
      }))
    );
  }
  return [];
}

function dedupeCandleRows(rows) {
  const byTime = new Map();
  for (const row of rows) {
    if (
      !Number.isFinite(row.time) ||
      !Number.isFinite(row.open) ||
      !Number.isFinite(row.high) ||
      !Number.isFinite(row.low) ||
      !Number.isFinite(row.close)
    ) {
      continue;
    }
    byTime.set(row.time, row);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);
}

/**
 * Merge extended history with the visible window so SMAs can be computed
 * using bars before the first displayed candle (Finviz / TradingView behavior).
 */
function buildMaSourceCandleData(displayCandles, historyCandles, warmupBars = MA_WARMUP_MAX) {
  if (!displayCandles.length) return [];
  if (!historyCandles.length) return displayCandles;

  const displayStart = displayCandles[0].time;
  const displayEnd = displayCandles[displayCandles.length - 1].time;
  const historyPool = historyCandles.filter((bar) => bar.time <= displayEnd);
  if (!historyPool.length) return displayCandles;

  let displayIdx = historyPool.findIndex((bar) => bar.time === displayStart);
  if (displayIdx < 0) {
    displayIdx = historyPool.findIndex((bar) => bar.time >= displayStart);
  }
  if (displayIdx < 0) {
    displayIdx = Math.max(0, historyPool.length - displayCandles.length);
  }

  const prefixStart = Math.max(0, displayIdx - warmupBars);
  const prefix = historyPool.slice(prefixStart, displayIdx);
  return dedupeCandleRows([...prefix, ...displayCandles]);
}

/** SMA on extended history, trimmed to the visible chart window only. */
function movingAverageForDisplay(maSourceCandleData, displayCandleData, period) {
  if (!displayCandleData.length || !maSourceCandleData.length) return [];

  const warmupBars = MA_WARMUP_BARS[period] ?? period;
  const displayStart = displayCandleData[0].time;
  let displayIdx = maSourceCandleData.findIndex((bar) => bar.time === displayStart);
  if (displayIdx < 0) {
    displayIdx = maSourceCandleData.findIndex((bar) => bar.time >= displayStart);
  }
  if (displayIdx < 0) {
    displayIdx = Math.max(0, maSourceCandleData.length - displayCandleData.length);
  }

  const calcStart = Math.max(0, displayIdx - warmupBars);
  const calcData = maSourceCandleData.slice(calcStart);
  const fullMa = calculateMovingAverageSeriesData(calcData, period);
  const displayTimes = new Set(displayCandleData.map((bar) => bar.time));

  return fullMa.filter(
    (point) =>
      displayTimes.has(point.time) && point.value != null && Number.isFinite(point.value)
  );
}

function buildVolumeDataFromPayload(data, candleData) {
  const volumesByTime = new Map();
  if (Array.isArray(data?.timestamp) && Array.isArray(data?.volume)) {
    data.timestamp.forEach((t, i) => {
      const time = Number(t);
      const value = Number(data.volume[i]);
      if (Number.isFinite(time)) {
        volumesByTime.set(time, Number.isFinite(value) ? value : 0);
      }
    });
  } else if (Array.isArray(data?.bars)) {
    data.bars.forEach((b) => {
      const time = Number(b.t);
      const value = Number(b.v);
      if (Number.isFinite(time)) {
        volumesByTime.set(time, Number.isFinite(value) ? value : 0);
      }
    });
  }

  return candleData.map((bar) => {
    const value = volumesByTime.get(bar.time) ?? 0;
    const up = bar.close >= bar.open;
    return {
      time: bar.time,
      value,
      color: up ? CHART_UP_VOLUME : CHART_DOWN_VOLUME,
    };
  });
}

async function fetchSecFilings(symbol, limit = 30) {
  const u = new URL("/api/sec/filings", window.location.origin);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const msg = body.message || body.error || text || res.statusText;
    throw new Error(typeof msg === "string" ? msg : res.statusText);
  }
  return body;
}

function getDisplayStock() {
  if (previewStock) return previewStock;
  if (activeIndex >= 0) return watchlist[activeIndex];
  return null;
}

function isInWatchlist(symbol) {
  const s = String(symbol || "").toUpperCase();
  return watchlist.some((w) => w.symbol.toUpperCase() === s);
}

function updateStockAddWatchlistBtn() {
  const btn = document.getElementById("stock-add-watchlist-btn");
  const stock = getDisplayStock();
  if (!btn) return;
  const show = Boolean(stock?.symbol) && !isInWatchlist(stock.symbol);
  btn.hidden = !show;
  if (show) {
    btn.setAttribute("aria-label", `Add ${stock.symbol} to watchlist`);
    btn.title = "Add to watchlist";
  }
}

function setupStockAddWatchlistBtn() {
  const btn = document.getElementById("stock-add-watchlist-btn");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const stock = getDisplayStock();
    if (stock?.symbol) void addToWatchlist(stock.symbol);
  });
}

function closeTopSearch() {
  const ul = document.getElementById("top-search-results");
  if (ul) {
    ul.innerHTML = "";
    ul.hidden = true;
  }
  collapseMobileTopSearch();
}

function expandMobileTopSearch() {
  const wrap = document.querySelector(".topbar-search");
  const input = document.getElementById("top-search-input");
  if (!wrap || !window.matchMedia("(max-width: 900px)").matches) return;
  wrap.classList.add("is-expanded");
  input?.focus();
}

function collapseMobileTopSearch() {
  const wrap = document.querySelector(".topbar-search");
  if (!wrap?.classList.contains("is-expanded")) return;
  wrap.classList.remove("is-expanded");
}

function renderTopSearchResults(results) {
  const ul = document.getElementById("top-search-results");
  if (!ul) return;
  if (!results.length) {
    ul.innerHTML = "";
    ul.hidden = true;
    return;
  }
  ul.hidden = false;
  ul.innerHTML = results
    .map((r) => {
      const sym = String(r.symbol || "");
      return `
    <li>
      <button type="button" class="topbar-search__result" data-symbol="${escapeHtml(sym)}" role="option">
        <span class="topbar-search__sym">${escapeHtml(sym)}</span>
        <span class="topbar-search__name">${escapeHtml(r.description || r.name || sym)}${r.exchange ? ` · ${escapeHtml(r.exchange)}` : ""}</span>
      </button>
    </li>
  `;
    })
    .join("");

  ul.querySelectorAll(".topbar-search__result").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = btn.dataset.symbol;
      if (sym) void openStockPreview(sym);
    });
  });
}

function renderTopInstitutionSearchResults(results) {
  const ul = document.getElementById("top-search-results");
  if (!ul) return;
  if (!results.length) {
    ul.innerHTML = "";
    ul.hidden = true;
    return;
  }
  ul.hidden = false;
  ul.innerHTML = results
    .map((f) => {
      const cik = bareInstitutionCik(f.cik);
      return `
    <li>
      <button type="button" class="topbar-search__result" data-institution-cik="${escapeHtml(cik)}" role="option">
        <span class="topbar-search__sym">${escapeHtml(f.type || "13F")}</span>
        <span class="topbar-search__name">${escapeHtml(f.name)} · CIK ${escapeHtml(cik)}</span>
      </button>
    </li>
  `;
    })
    .join("");

  ul.querySelectorAll("[data-institution-cik]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cik = btn.getAttribute("data-institution-cik");
      if (cik) void openInstitution(cik, "holdings");
    });
  });
}

async function openStockPreview(symbol) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return;
  const req = ++openStockPreviewSeq;
  setViewingSymbol(sym);
  closeStocksOverlays();
  // Always land on Overview when searching a stock from another tab/section.
  setStockTab("overview", { updateUrl: false });
  // Leave /stocks/most-accumulated immediately so route handlers cannot reopen the overlay.
  syncStockUrl(sym);
  setExploreMode("stocks", { navigate: false });
  activeIndex = -1;
  previewStock = makePreviewStockStub(sym);
  resetStockPanelUi(sym);
  renderWatchlist();
  renderHeader();
  setDashboardStatus(`Loading ${sym}…`);
  const panelLoad = loadActiveSymbolPanels(sym);
  try {
    const entry = await fetchWatchlistEntry(sym);
    if (req !== openStockPreviewSeq || getViewingSymbol() !== sym) return;
    previewStock = entry;
    activeCurrency = previewStock.currency || "USD";
    const input = document.getElementById("top-search-input");
    if (input) input.value = sym;
    closeTopSearch();
    renderHeader();
    syncStockUrl(sym);
    await panelLoad;
    if (req !== openStockPreviewSeq || getViewingSymbol() !== sym) return;
    setDashboardStatus("");
  } catch (e) {
    if (req !== openStockPreviewSeq || getViewingSymbol() !== sym) return;
    const msg = e instanceof Error ? e.message : String(e);
    setDashboardStatus(`Could not load ${sym}: ${msg}`, true);
    renderEmptyMain(true);
  }
}

function updateWatchlistBadge() {
  const badge = document.getElementById("watchlist-badge");
  if (badge) badge.textContent = String(watchlist.length);
}

function updateWatchlistAddVisibility() {
  const wrap = document.getElementById("watchlist-add-wrap");
  const body = document.getElementById("watchlist-body");
  if (!wrap) return;
  wrap.hidden = watchlistSearchOpen;
  const hasItems = watchlist.length > 0;
  wrap.classList.toggle("watchlist-add-wrap--compact", hasItems);
  body?.classList.toggle("watchlist-body--empty", !hasItems);
}

function openWatchlistSearch() {
  watchlistSearchOpen = true;
  const panel = document.getElementById("watchlist-search");
  const input = document.getElementById("watchlist-search-input");
  if (panel) panel.hidden = false;
  updateWatchlistAddVisibility();
  if (input) {
    input.value = "";
    input.focus();
  }
  renderSearchResults([]);
  setSearchHint("Type to search US stocks");
}

function closeWatchlistSearch() {
  watchlistSearchOpen = false;
  const panel = document.getElementById("watchlist-search");
  if (panel) panel.hidden = true;
  updateWatchlistAddVisibility();
}

function setSearchHint(text) {
  const el = document.getElementById("watchlist-search-hint");
  if (el) el.textContent = text;
}

function renderSearchResults(results) {
  const ul = document.getElementById("watchlist-search-results");
  if (!ul) return;
  if (!results.length) {
    ul.innerHTML = "";
    return;
  }
  ul.innerHTML = results
    .map((r) => {
      const sym = String(r.symbol || "");
      const added = isInWatchlist(sym);
      return `
    <li>
      <button type="button" class="watchlist-search__result" data-symbol="${escapeHtml(sym)}" ${added ? "disabled" : ""} role="option">
        <span class="watchlist-search__sym">${escapeHtml(sym)}</span>
        <span class="watchlist-search__name">${escapeHtml(r.description || r.name || sym)}${r.exchange ? ` · ${escapeHtml(r.exchange)}` : ""}</span>
        ${added ? '<span class="watchlist-search__tag">Added</span>' : ""}
      </button>
    </li>
  `;
    })
    .join("");

  ul.querySelectorAll(".watchlist-search__result:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sym = btn.dataset.symbol;
      if (sym) void addToWatchlist(sym);
    });
  });
}

async function addToWatchlist(symbol) {
  const sym = String(symbol || "").trim();
  if (!sym) return;
  if (isInWatchlist(sym)) {
    setSearchHint(`${sym} is already on your watchlist.`);
    setDashboardStatus(`${sym} is already on your watchlist.`);
    return;
  }

  setSearchHint(`Adding ${sym}…`);
  setDashboardStatus(`Adding ${sym}…`);
  try {
    const entry = await fetchWatchlistEntry(sym);
    watchlist.push(entry);
    saveWatchlistSymbols();
    previewStock = null;
    activeIndex = watchlist.length - 1;
    setViewingSymbol(normalizeSymbol(sym));
    resetStockPanelUi(normalizeSymbol(sym));
    updateWatchlistBadge();
    closeWatchlistSearch();
    renderWatchlist();
    void loadWatchlistActivity();
    renderHeader();
    renderEmptyMain(false);
    await loadActiveSymbolPanels(sym);
    setDashboardStatus("");
    setSearchHint("");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setSearchHint(`Could not add ${sym}: ${msg}`);
    setDashboardStatus(`Could not add ${sym}: ${msg}`, true);
  }
}

function removeFromWatchlist(index) {
  if (index < 0 || index >= watchlist.length) return;
  const removedSym = watchlist[index].symbol;
  const wasActive = activeIndex === index;

  watchlist.splice(index, 1);
  saveWatchlistSymbols();
  updateWatchlistBadge();

  if (activeIndex > index) activeIndex -= 1;

  if (wasActive) {
    previewStock = null;
    if (!watchlist.length) {
      activeIndex = -1;
      renderWatchlist();
      renderHeader();
      renderEmptyMain(true);
      if (window.location.pathname.startsWith("/stock/")) {
        history.replaceState(null, "", "/stocks");
      }
      setDashboardStatus(`${removedSym} removed from watchlist.`);
      setTimeout(() => setDashboardStatus(""), 3000);
      return;
    }
    activeIndex = Math.min(index, watchlist.length - 1);
    void selectStock(activeIndex);
  } else {
    renderWatchlist();
  }

  setDashboardStatus(`${removedSym} removed from watchlist.`);
  setTimeout(() => setDashboardStatus(""), 3000);
}

function removeFromWatchlistBySymbol(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  const idx = watchlist.findIndex((w) => w.symbol.toUpperCase() === sym);
  if (idx >= 0) removeFromWatchlist(idx);
}

function renderWatchlist() {
  const ul = document.getElementById("watchlist-items");
  if (!ul) return;
  updateWatchlistAddVisibility();
  if (!watchlist.length) {
    ul.innerHTML = "";
    return;
  }
  ul.innerHTML = watchlist
    .map(
      (w, i) => `
    <li class="watchlist__item ${i === activeIndex ? "is-active" : ""}" data-index="${i}">
      <button type="button" class="watchlist__select" data-index="${i}" aria-label="Open ${escapeHtml(w.symbol)}">
        <span class="watchlist__head">
          <span class="watchlist__sym">${escapeHtml(w.symbol)}</span>
          ${renderWatchlistNotifications(w.notifications, w.noticesStatus)}
        </span>
        <span class="watchlist__name">${escapeHtml(w.name)}</span>
      </button>
      <button type="button" class="watchlist__remove" data-remove-index="${i}" aria-label="Remove ${escapeHtml(w.symbol)} from watchlist" title="Remove">×</button>
    </li>
  `
    )
    .join("");

  ul.querySelectorAll(".watchlist__select").forEach((el) => {
    const idx = Number(el.dataset.index);
    el.addEventListener("click", () => void selectStock(idx));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void selectStock(idx);
      }
    });
  });

  ul.querySelectorAll(".watchlist__remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.removeIndex);
      removeFromWatchlist(idx);
    });
  });
}

function renderEmptyMain(empty) {
  const symEl = document.getElementById("active-symbol-label");
  const nameEl = document.getElementById("active-name-label");
  const chartWrap = document.querySelector(".chart-wrap");
  const main = document.querySelector(".main");

  if (empty) {
    if (symEl) symEl.textContent = "—";
    if (nameEl) nameEl.textContent = "Add a stock from your watchlist";
    lastStockClassification = null;
    renderStockClassificationLabel(null);
    destroyChart();
    clearTradingViewWidget();
    clearTradingViewSymbolInfo();
    signalsSymbol = null;
    renderSignalsPanel(null);
    lastSecFilingsForScores = null;
    renderCategoryScoresPanel(null);
    setSignalsSubtitle("Institutional, insider & congressional buying vs selling");
    updateOhlcvPanel(null);
    if (chartWrap) chartWrap.classList.add("chart-wrap--empty");
    if (main) main.classList.add("main--empty");
    setChartFootnote("Select a symbol to view the chart.");
    const secBody = document.getElementById("sec-filings-body");
    if (secBody) {
      secBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">Add a stock to see SEC filings.</td></tr>`;
    }
    renderSecFilingsFundamentalsExtras(null);
    renderOverviewEmpty("Select a stock to load overview metrics.");
    renderOwnershipEmpty("Add a stock to see institutional holders.");
    ownershipExpanded = false;
    secFilingsExpanded = false;
    lastSecFilings = [];
    updateSecFilingsMoreControl();
    setSecSubtitle("data.sec.gov submissions (recent)");
    updateStockAddWatchlistBtn();
    return;
  }

  if (chartWrap) chartWrap.classList.remove("chart-wrap--empty");
  if (main) main.classList.remove("main--empty");
}

function renderHeader() {
  const w = getDisplayStock();
  if (!w) {
    renderEmptyMain(true);
    updateStockTabsVisibility(false);
    updateStocksView();
    return;
  }
  updateStockTabsVisibility(true);
  renderEmptyMain(false);
  updateStocksView();
  activeCurrency = w.currency || activeCurrency;
  document.getElementById("active-symbol-label").textContent = w.symbol;
  document.getElementById("active-name-label").textContent = w.name;
  const sym = normalizeSymbol(w.symbol);
  if (!loadedPanelSymbol || loadedPanelSymbol !== sym) {
    renderStockClassificationLabel(null);
  } else {
    renderStockClassificationLabel(lastStockClassification);
  }
  renderTradingViewSymbolInfo(w.symbol);
  updateStockAddWatchlistBtn();
}

function updateRangeChangeDisplay() {
  const el = document.getElementById("active-range-change-label");
  if (!el) return;
  if (lastPriceSeries && Number.isFinite(lastPriceSeries.rangeChangePct)) {
    const label = RANGE_LABELS[lastPriceSeries.range] || lastPriceSeries.range;
    const pct = lastPriceSeries.rangeChangePct;
    el.textContent = `${formatChange(pct)} (${label})`;
    el.className = `chart-card__change chart-card__change--${pct >= 0 ? "up" : "down"}`;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function renderSecFilingRow(r) {
  const desc = r.description || "—";
  const link = r.href
    ? `<a class="sec-doc-link" href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">View</a>`
    : "—";
  return `
    <tr>
      <td class="mono">${escapeHtml(r.form)}</td>
      <td class="mono">${escapeHtml(r.filingDate)}</td>
      <td class="sec-desc">${escapeHtml(desc)}</td>
      <td class="mono sec-accession">${escapeHtml(r.accessionNumber || "—")}</td>
      <td>${link}</td>
    </tr>
  `;
}

function updateSecFilingsMoreControl() {
  const foot = document.getElementById("sec-filings-foot");
  const btn = document.getElementById("sec-filings-more-btn");
  if (!foot || !btn) return;

  const extra = lastSecFilings.length - SEC_FILINGS_INITIAL_COUNT;
  if (extra <= 0) {
    foot.hidden = true;
    return;
  }

  foot.hidden = false;
  btn.textContent = secFilingsExpanded
    ? "Show fewer filings"
    : `Show more filings (${extra})`;
  btn.setAttribute("aria-expanded", secFilingsExpanded ? "true" : "false");
}

function renderSecFilingsTable() {
  const body = document.getElementById("sec-filings-body");
  if (!body) return;
  if (!lastSecFilings.length) {
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">No rows in SEC filings.recent for this issuer.</td></tr>`;
    updateSecFilingsMoreControl();
    return;
  }

  const visible = secFilingsExpanded
    ? lastSecFilings
    : lastSecFilings.slice(0, SEC_FILINGS_INITIAL_COUNT);

  body.innerHTML = visible.map(renderSecFilingRow).join("");
  updateSecFilingsMoreControl();
}

const FILINGS_FUNDAMENTALS_INCOME_KEYS = [
  ["revenue", "Revenue"],
  ["gross_profit", "Gross profit"],
  ["operating_income", "Operating income"],
  ["net_income", "Net income"],
  ["research_and_development_expense", "R&D expense"],
  ["selling_general_administrative_expense", "SG&A expense"],
  ["interest_expense", "Interest expense"],
  ["income_tax_expense", "Income tax expense"],
  ["eps_basic", "EPS (basic)"],
  ["eps_diluted", "EPS (diluted)"],
  ["weighted_average_diluted_shares", "Wtd avg diluted shares"],
];
const FILINGS_FUNDAMENTALS_BALANCE_KEYS = [
  ["total_assets", "Total assets"],
  ["current_assets", "Current assets"],
  ["total_liabilities", "Total liabilities"],
  ["current_liabilities", "Current liabilities"],
  ["shareholder_equity", "Shareholder equity"],
  ["cash_and_equivalents", "Cash & equivalents"],
  ["accounts_receivable", "Accounts receivable"],
  ["inventory", "Inventory"],
  ["property_plant_equipment", "Property, plant & equipment"],
  ["goodwill", "Goodwill"],
  ["long_term_debt", "Long-term debt"],
  ["commercial_paper", "Commercial paper"],
  ["notes_carrying_amount", "Notes carrying amount"],
  ["debt", "Debt"],
  ["shares_outstanding", "Shares outstanding"],
];
const FILINGS_FUNDAMENTALS_CASHFLOW_KEYS = [
  ["operating_cash_flow", "Operating cash flow"],
  ["investing_cash_flow", "Investing cash flow"],
  ["financing_cash_flow", "Financing cash flow"],
  ["capital_expenditures", "Capital expenditures"],
  ["dividends_paid", "Dividends paid"],
  ["share_repurchases", "Share repurchases"],
  ["free_cash_flow", "Free cash flow (derived)"],
];
// [key, label, format] — format: "pct" | "usd" | "ratio" | "usd_per_share"
const FILINGS_FUNDAMENTALS_DERIVED_KEYS = [
  ["gross_margin", "Gross margin", "pct"],
  ["operating_margin", "Operating margin", "pct"],
  ["net_margin", "Net margin", "pct"],
  ["roe", "ROE", "pct"],
  ["roa", "ROA", "pct"],
  ["free_cash_flow_margin", "Free cash flow margin", "pct"],
  ["revenue_growth_yoy", "Revenue growth YoY", "pct"],
  ["eps_growth_yoy", "EPS growth YoY", "pct"],
  ["ebitda", "EBITDA", "usd"],
  ["total_debt", "Total debt", "usd"],
  ["current_ratio", "Current ratio", "ratio"],
  ["debt_to_equity", "Debt-to-equity", "ratio"],
  ["asset_turnover", "Asset turnover", "ratio"],
  ["book_value_per_share", "Book value / share", "usd_per_share"],
];

function renderStockClassificationLabel(classification) {
  const el = document.getElementById("active-classification-label");
  if (!el) return;
  const sector = classification?.sector ? String(classification.sector).trim() : "";
  const industry = classification?.industry ? String(classification.industry).trim() : "";
  if (!sector && !industry) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  if (sector && industry) {
    el.innerHTML = `<span class="chart-card__classification-sector">${escapeHtml(sector)}</span><span class="chart-card__classification-industry">${escapeHtml(industry)}</span>`;
  } else if (sector) {
    el.innerHTML = `<span class="chart-card__classification-sector">${escapeHtml(sector)}</span>`;
  } else {
    el.innerHTML = `<span class="chart-card__classification-industry">${escapeHtml(industry)}</span>`;
  }
}

async function fetchStockClassification(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  return apiJson(`/api/stocks/${encodeURIComponent(sym)}/classification`);
}

function setFilingsFundamentalsSubtitle(text) {
  const el = document.getElementById("filings-fundamentals-subtitle");
  if (el) el.textContent = text;
}

function formatSecFundamentalValue(value, unit = "USD") {
  const x = Number(value);
  if (!Number.isFinite(x)) return "—";
  const enUs = "en-US";
  if (unit === "shares") {
    return x.toLocaleString(enUs, { maximumFractionDigits: 0 });
  }
  if (String(unit).toLowerCase().includes("shares")) {
    return x.toLocaleString(enUs, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  const compact = formatLargeNumber(x);
  return compact === "—" ? "—" : `$${compact}`;
}

function formatSecFundamentalCell(value, unit = "USD") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return formatSecFundamentalValue(value, unit);
}

function formatSecDerivedPercent(value) {
  const x = Number(value);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(1)}%`;
}

function formatMetricSourceDebug(source) {
  if (!source) return "—";
  const parts = [];
  if (source.gaapTag) parts.push(source.gaapTag);
  if (source.accn) parts.push(source.accn);
  const der = source.derivation;
  if (der?.method === "ytd_minus_prior_ytd" && der.current && der.prior) {
    const curEnd = der.current.end ? String(der.current.end).slice(0, 10) : "";
    const priorEnd = der.prior.end ? String(der.prior.end).slice(0, 10) : "";
    parts.push(
      `derived ${curEnd || "current"} − ${priorEnd || "prior"}${der.prior.accn ? ` (${der.prior.accn})` : ""}`
    );
  }
  return parts.length ? parts.join(" · ") : "—";
}

function renderFilingsFundamentalsSector(classification) {
  const el = document.getElementById("filings-fundamentals-sector");
  if (!el) return;

  const sector = classification?.sector ? String(classification.sector).trim() : "";
  const industry = classification?.industry ? String(classification.industry).trim() : "";
  const sic = classification?.sic ? String(classification.sic).trim() : "";
  const sicDescription = classification?.sicDescription
    ? String(classification.sicDescription).trim()
    : "";

  if (!sector && !industry && !sic) {
    el.classList.add("overview-snapshot-body--empty");
    el.innerHTML = `<p class="fundamentals-grid__empty">No sector classification available for this ticker.</p>`;
    return;
  }

  const items = [
    ["Sector", sector || "—"],
    ["Industry", industry || "—"],
    ["SIC", sic ? `${sic}${sicDescription ? ` · ${sicDescription}` : ""}` : "—"],
  ]
    .map(
      ([label, value]) => `<div class="overview-snapshot-item">
      <span class="overview-snapshot-item__label">${escapeHtml(label)}</span>
      <span class="overview-snapshot-item__value">${escapeHtml(value)}</span>
    </div>`
    )
    .join("");

  el.classList.remove("overview-snapshot-body--empty");
  el.innerHTML = `<div class="overview-snapshot-group__grid">${items}</div>`;
}

function renderFilingsFundamentalsMetricItems(latest, keyList) {
  return keyList
    .map(([key, label]) => {
      const row = latest?.[key];
      const unit =
        key === "eps_basic" || key === "eps_diluted"
          ? "USD/shares"
          : key === "shares_outstanding"
            ? "shares"
            : key.includes("margin") || key.includes("growth")
              ? "pct"
              : "USD";
      let val = "—";
      if (row != null && Number.isFinite(Number(row.value ?? row))) {
        const v = Number(row.value ?? row);
        val =
          unit === "pct"
            ? formatSecDerivedPercent(v)
            : formatSecFundamentalValue(v, row.unit ?? unit);
      }
      const period =
        row?.end || row?.periodLabel || row?.fp
          ? ` <span class="muted small">(${escapeHtml([row.periodLabel || row.fp, row.end].filter(Boolean).join(" · "))})</span>`
          : "";
      return `<div class="overview-snapshot-item">
      <span class="overview-snapshot-item__label">${escapeHtml(label)}</span>
      <span class="overview-snapshot-item__value mono">${val}${period}</span>
    </div>`;
    })
    .join("");
}

function renderFilingsFundamentalsMetricGrid(elId, latest, keyList, emptyMsg) {
  const el = document.getElementById(elId);
  if (!el) return;
  const items = renderFilingsFundamentalsMetricItems(latest, keyList);
  const hasAny = keyList.some(([key]) => latest?.[key] != null);
  if (!hasAny) {
    el.classList.add("overview-snapshot-body--empty");
    el.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(emptyMsg)}</p>`;
    return;
  }
  el.classList.remove("overview-snapshot-body--empty");
  el.innerHTML = `<div class="overview-snapshot-group__grid">${items}</div>`;
}

function cashFlowSectionTitle(bundle, mode) {
  if (mode === "derived") {
    const sample =
      bundle?.operating_cash_flow ||
      bundle?.capital_expenditures ||
      bundle?.free_cash_flow ||
      null;
    const fp = sample?.fp || sample?.periodLabel?.split("·")[0]?.trim() || "Quarter";
    return fp;
  }
  const sample =
    bundle?.operating_cash_flow ||
    bundle?.capital_expenditures ||
    bundle?.free_cash_flow ||
    null;
  return sample?.periodLabel || sample?.fp || "Reported";
}

function renderFilingsFundamentalsCashFlow(cashFlow, emptyMsg) {
  const el = document.getElementById("filings-fundamentals-cashflow");
  if (!el) return;
  const reported = cashFlow?.latest ?? cashFlow ?? {};
  const derived = cashFlow?.latestDerivedQuarter ?? null;
  const hasReported = FILINGS_FUNDAMENTALS_CASHFLOW_KEYS.some(([key]) => reported?.[key] != null);
  const hasDerived = derived
    ? FILINGS_FUNDAMENTALS_CASHFLOW_KEYS.some(([key]) => derived?.[key] != null)
    : false;

  if (!hasReported && !hasDerived) {
    el.classList.add("overview-snapshot-body--empty");
    el.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(emptyMsg)}</p>`;
    return;
  }

  const sections = [];
  if (hasDerived) {
    const title = cashFlowSectionTitle(derived, "derived");
    sections.push(`<section class="overview-snapshot-group filings-fundamentals-cashflow-group" open>
      <div class="overview-snapshot-group__heading">
        <span class="overview-snapshot-group__title">${escapeHtml(title)}</span>
        <span class="muted small overview-snapshot-group__source">derived</span>
      </div>
      <div class="overview-snapshot-group__grid">${renderFilingsFundamentalsMetricItems(derived, FILINGS_FUNDAMENTALS_CASHFLOW_KEYS)}</div>
    </section>`);
  }
  if (hasReported) {
    const title = cashFlowSectionTitle(reported, "reported");
    const end = reported.operating_cash_flow?.end || reported.free_cash_flow?.end || "";
    sections.push(`<section class="overview-snapshot-group filings-fundamentals-cashflow-group" open>
      <div class="overview-snapshot-group__heading">
        <span class="overview-snapshot-group__title">${escapeHtml(title)}</span>
        ${end ? `<span class="muted small overview-snapshot-group__source">${escapeHtml(String(end).slice(0, 10))}</span>` : ""}
      </div>
      <div class="overview-snapshot-group__grid">${renderFilingsFundamentalsMetricItems(reported, FILINGS_FUNDAMENTALS_CASHFLOW_KEYS)}</div>
    </section>`);
  }

  el.classList.remove("overview-snapshot-body--empty");
  el.innerHTML = sections.join("");
}

function formatSecDerivedValue(value, format) {
  const v = Number(value);
  if (value == null || !Number.isFinite(v)) return "—";
  switch (format) {
    case "usd":
      return formatSecFundamentalValue(v, "USD");
    case "usd_per_share": {
      const compact = `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return compact;
    }
    case "ratio":
      return `${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
    case "pct":
    default:
      return formatSecDerivedPercent(v);
  }
}

function renderFilingsFundamentalsDerivedGrid(derived, periodLabels) {
  const el = document.getElementById("filings-fundamentals-derived");
  if (!el) return;
  const labels = periodLabels || {};
  const items = FILINGS_FUNDAMENTALS_DERIVED_KEYS.map(([key, label, format]) => {
    let displayLabel = label;
    if (key === "roe") {
      displayLabel = labels.roe ? `ROE (${labels.roe})` : "ROE";
    } else if (key === "roa") {
      displayLabel = labels.roa ? `ROA (${labels.roa})` : "ROA";
    } else if (key === "asset_turnover") {
      displayLabel = labels.asset_turnover
        ? `Asset turnover (${labels.asset_turnover})`
        : "Asset turnover";
    }
    const val = formatSecDerivedValue(derived?.[key], format);
    return `<div class="overview-snapshot-item">
      <span class="overview-snapshot-item__label">${escapeHtml(displayLabel)}</span>
      <span class="overview-snapshot-item__value mono">${escapeHtml(val)}</span>
    </div>`;
  }).join("");
  const hasAny = FILINGS_FUNDAMENTALS_DERIVED_KEYS.some(([key]) => derived?.[key] != null);
  if (!hasAny) {
    el.classList.add("overview-snapshot-body--empty");
    el.innerHTML = '<p class="fundamentals-grid__empty">No derived metrics for the latest period.</p>';
    return;
  }
  el.classList.remove("overview-snapshot-body--empty");
  el.innerHTML = `<div class="overview-snapshot-group__grid">${items}</div>`;
}

function renderFilingsFundamentalsPeriodRow(row) {
  const m = row.metrics || {};
  const d = row.derived || {};
  const fyLabel = row.fy != null ? `FY${row.fy}` : "—";
  return `
    <tr>
      <td class="mono">${escapeHtml(fyLabel)}</td>
      <td class="mono">${escapeHtml(row.fp || "—")}</td>
      <td class="mono">${escapeHtml(row.end || "—")}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.revenue))}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.operating_income))}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.net_income))}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.eps_diluted, "USD/shares"))}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.total_assets))}</td>
      <td class="mono num">${escapeHtml(formatSecDerivedPercent(d.revenue_growth_yoy))}</td>
    </tr>
  `;
}

const FILINGS_PRIMARY_METRICS = [
  "revenue",
  "operating_income",
  "net_income",
  "eps_diluted",
  "total_assets",
];

function hasFilingsPrimaryMetric(row) {
  const m = row?.metrics || {};
  return FILINGS_PRIMARY_METRICS.some((key) => m[key] != null && Number.isFinite(Number(m[key])));
}

function dedupeFilingsPeriodRows(rows) {
  if (!rows?.length) return [];
  const byKey = new Map();
  for (const row of rows) {
    if (!hasFilingsPrimaryMetric(row)) continue;
    const key = `${row.fy ?? ""}|${row.fp ?? ""}|${row.end ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    const pick =
      FILINGS_PRIMARY_METRICS.filter((k) => row.metrics?.[k] != null).length >=
      FILINGS_PRIMARY_METRICS.filter((k) => existing.metrics?.[k] != null).length
        ? row
        : existing;
    const merge = pick === row ? existing : row;
    byKey.set(key, {
      ...pick,
      metrics: { ...merge.metrics, ...pick.metrics },
      metricSources: { ...merge.metricSources, ...pick.metricSources },
      derived: { ...merge.derived, ...pick.derived },
      inclusionReason: pick.inclusionReason || merge.inclusionReason,
    });
  }
  return [...byKey.values()].sort((a, b) => String(b.end ?? "").localeCompare(String(a.end ?? "")));
}

function renderFilingsFundamentalsPeriodTable(bodyId, rows, emptyMsg) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!rows?.length) {
    body.innerHTML = `<tr><td colspan="9" class="trades-table__empty">${escapeHtml(emptyMsg)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(renderFilingsFundamentalsPeriodRow).join("");
}

function renderFilingsFundamentalsEarningsRow(r) {
  const m = r.metrics || {};
  const source = r.metricSources?.revenue || r.metricSources?.net_income || null;
  const link = r.href
    ? `<a class="sec-doc-link" href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">View</a>`
    : "—";
  return `
    <tr>
      <td class="mono">${escapeHtml(r.filingDate || "—")}</td>
      <td class="mono">${escapeHtml(r.items || "—")}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.revenue))}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.net_income))}</td>
      <td class="mono num">${escapeHtml(formatSecFundamentalCell(m.eps_diluted, "USD/shares"))}</td>
      <td class="mono small filings-fundamentals-debug">${escapeHtml(formatMetricSourceDebug(source))}</td>
      <td>${link}</td>
    </tr>
  `;
}

function renderFilingsFundamentalsEarningsTable(rows) {
  const body = document.getElementById("sec-filings-earnings-body");
  if (!body) return;
  if (!rows?.length) {
    body.innerHTML =
      '<tr><td colspan="7" class="trades-table__empty">No Item 2.02 earnings releases with XBRL metrics found.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(renderFilingsFundamentalsEarningsRow).join("");
}

function renderSecFilingsFundamentalsExtras(data, errMsg) {
  const emptyFiling = (msg) =>
    `<tr><td colspan="5" class="trades-table__empty">${escapeHtml(msg)}</td></tr>`;
  const emptyEarnings = (msg) =>
    `<tr><td colspan="7" class="trades-table__empty">${escapeHtml(msg)}</td></tr>`;

  if (errMsg) {
    const tenK = document.getElementById("sec-filings-10k-body");
    const earnings = document.getElementById("sec-filings-earnings-body");
    if (tenK) tenK.innerHTML = emptyFiling(errMsg);
    if (earnings) earnings.innerHTML = emptyEarnings(errMsg);
    return;
  }

  if (!data) {
    renderFilingsFundamentalsFilingTable("sec-filings-10k-body", [], "Select a stock to load 10-K filings.");
    renderFilingsFundamentalsEarningsTable([]);
    return;
  }

  renderFilingsFundamentalsFilingTable(
    "sec-filings-10k-body",
    data.filings?.["10-K"],
    "No 10-K filings in recent submissions."
  );
  renderFilingsFundamentalsEarningsTable(data.earningsReleases);
}

function renderFilingsFundamentalsFilingRow(r) {
  const link = r.href
    ? `<a class="sec-doc-link" href="${escapeHtml(r.href)}" target="_blank" rel="noopener noreferrer">View</a>`
    : "—";
  const thirdCol = String(r.form || "").toUpperCase().startsWith("8-K")
    ? r.items || r.reportDate || "—"
    : r.reportDate || "—";
  return `
    <tr>
      <td class="mono">${escapeHtml(r.form)}</td>
      <td class="mono">${escapeHtml(r.filingDate || "—")}</td>
      <td class="mono">${escapeHtml(thirdCol)}</td>
      <td class="sec-desc">${escapeHtml(r.description || "—")}</td>
      <td>${link}</td>
    </tr>
  `;
}

function renderFilingsFundamentalsFilingTable(bodyId, rows, emptyMsg) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!rows?.length) {
    body.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${escapeHtml(emptyMsg)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(renderFilingsFundamentalsFilingRow).join("");
}

function renderFilingsFundamentalsPanel(data, errMsg) {
  if (errMsg) {
    setFilingsFundamentalsSubtitle("SEC financials (error)");
    renderFilingsFundamentalsSector(null);
    for (const id of [
      "filings-fundamentals-income",
      "filings-fundamentals-balance",
      "filings-fundamentals-cashflow",
      "filings-fundamentals-derived",
    ]) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add("overview-snapshot-body--empty");
        el.innerHTML = `<p class="fundamentals-grid__empty">${escapeHtml(errMsg)}</p>`;
      }
    }
    const empty = `<tr><td colspan="9" class="trades-table__empty">${escapeHtml(errMsg)}</td></tr>`;
    for (const id of ["filings-fundamentals-annual-body", "filings-fundamentals-quarterly-body"]) {
      const body = document.getElementById(id);
      if (body) body.innerHTML = empty;
    }
    renderSecFilingsFundamentalsExtras(null, errMsg);
    return;
  }

  if (!data) {
    setFilingsFundamentalsSubtitle("SEC Company Facts · XBRL");
    renderFilingsFundamentalsSector(null);
    renderFilingsFundamentalsMetricGrid(
      "filings-fundamentals-income",
      null,
      FILINGS_FUNDAMENTALS_INCOME_KEYS,
      "Select a stock to load income statement metrics."
    );
    renderFilingsFundamentalsMetricGrid(
      "filings-fundamentals-balance",
      null,
      FILINGS_FUNDAMENTALS_BALANCE_KEYS,
      "Select a stock to load balance sheet metrics."
    );
    renderFilingsFundamentalsCashFlow(null, "Select a stock to load cash flow metrics.");
    renderFilingsFundamentalsDerivedGrid(null);
    renderFilingsFundamentalsPeriodTable(
      "filings-fundamentals-annual-body",
      [],
      "Select a stock to load annual SEC financials."
    );
    renderFilingsFundamentalsPeriodTable(
      "filings-fundamentals-quarterly-body",
      [],
      "Select a stock to load quarterly SEC financials."
    );
    renderSecFilingsFundamentalsExtras(null);
    return;
  }

  const parts = ["SEC Company Facts"];
  if (data.entityName) parts.push(data.entityName);
  if (data.cik) parts.push(`CIK ${String(data.cik).replace(/^0+/, "")}`);
  if (data.fundamentalsSourceTicker && data.fundamentalsSourceTicker !== data.ticker) {
    parts.push(`financials from ${data.fundamentalsSourceTicker}`);
  }
  setFilingsFundamentalsSubtitle(parts.join(" · "));

  renderFilingsFundamentalsSector(data.classification);
  if (data.classification) lastStockClassification = data.classification;
  renderStockClassificationLabel(lastStockClassification);

  const income = data.statements?.incomeStatement?.latest ?? data.latest ?? {};
  const balance = data.statements?.balanceSheet?.latest ?? {};
  const cashFlowBundle = data.statements?.cashFlow ?? null;

  renderFilingsFundamentalsMetricGrid(
    "filings-fundamentals-income",
    income,
    FILINGS_FUNDAMENTALS_INCOME_KEYS,
    "No income statement metrics in Company Facts."
  );
  renderFilingsFundamentalsMetricGrid(
    "filings-fundamentals-balance",
    balance,
    FILINGS_FUNDAMENTALS_BALANCE_KEYS,
    "No balance sheet metrics in Company Facts."
  );
  renderFilingsFundamentalsCashFlow(
    cashFlowBundle,
    "No cash flow metrics in Company Facts."
  );
  renderFilingsFundamentalsDerivedGrid(data.derivedLatest, data.derivedPeriodLabels);

  renderFilingsFundamentalsPeriodTable(
    "filings-fundamentals-annual-body",
    dedupeFilingsPeriodRows(data.annual),
    "No annual (10-K / FY) periods found."
  );
  renderFilingsFundamentalsPeriodTable(
    "filings-fundamentals-quarterly-body",
    dedupeFilingsPeriodRows(data.quarterly),
    "No quarterly (10-Q / Q1–Q3) periods found."
  );
  renderSecFilingsFundamentalsExtras(data);
}

async function loadFilingsFundamentalsPanel(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return;
  filingsFundamentalsSymbol = sym;
  lastFilingsFundamentals = null;
  renderFilingsFundamentalsPanel(null, "Loading SEC financials…");
  renderFilingsFundamentalsSector(null);
  renderSecFilingsFundamentalsExtras(null, "Loading SEC financials…");
  try {
    const data = await apiJson(
      `/api/stocks/${encodeURIComponent(sym)}/filings-fundamentals?_=${Date.now()}`
    );
    if (filingsFundamentalsSymbol !== sym) return;
    lastFilingsFundamentals = data;
    renderFilingsFundamentalsPanel(data);
  } catch (err) {
    if (filingsFundamentalsSymbol !== sym) return;
    lastFilingsFundamentals = null;
    const msg = err instanceof Error ? err.message : String(err);
    renderFilingsFundamentalsPanel(null, msg);
    renderSecFilingsFundamentalsExtras(null, msg);
  }
}

function destroyChart() {
  chartExtensions?.onChartDestroy();
  chartIndicatorManager?.onChartDestroy();
  if (chartCrosshairUnsub) {
    chartCrosshairUnsub();
    chartCrosshairUnsub = null;
  }
  chartMainSeries = null;
  chartVolumeSeries = null;
  chartMa20Series = null;
  chartMa50Series = null;
  chartMa200Series = null;
  lastChartConfigKey = null;
  if (chartInstance) {
    chartInstance.remove();
    chartInstance = null;
  }
}

function initChartExtensions() {
  chartIndicatorManager = new IndicatorManager();
  chartExtensions = new ChartExtensions({
    fetchCandles,
    getActiveRange: () => activeRange,
    getPrimarySymbol: () => getDisplayStock()?.symbol || null,
    getPrimaryLineData: () =>
      lastPriceSeries?.candleData?.map((b) => ({ time: b.time, value: b.close })) || [],
    getMainSeries: () => chartMainSeries,
    getChart: () => chartInstance,
    onPercentModeChange: (enabled) => {
      if (enabled && activeChartType !== "line") setChartType("line");
    },
  });
  setupChartToolbar(chartExtensions);
  setChartDrawMenuHooks({
    onToggle: (open) => {
      if (open) chartSettingsOpen = false;
    },
  });
  setChartCompareMenuHooks({
    onToggle: (open) => {
      if (open) chartSettingsOpen = false;
    },
  });
  setChartIndicatorsMenuHooks({
    onToggle: (open) => {
      if (open) chartSettingsOpen = false;
    },
  });
}

/**
 * Compute simple moving average points from in-memory candle closes.
 * Early bars omit `value` until the window is full (per Lightweight Charts convention).
 */
function calculateMovingAverageSeriesData(candleData, period) {
  const maData = [];

  for (let i = 0; i < candleData.length; i++) {
    if (i < period - 1) {
      maData.push({ time: candleData[i].time });
      continue;
    }

    let sum = 0;

    for (let j = 0; j < period; j++) {
      sum += candleData[i - j].close;
    }

    maData.push({
      time: candleData[i].time,
      value: sum / period,
    });
  }

  return maData;
}

function getChartMaSeriesRef(period) {
  if (period === 20) return chartMa20Series;
  if (period === 50) return chartMa50Series;
  if (period === 200) return chartMa200Series;
  return null;
}

function setChartMaSeriesRef(period, series) {
  if (period === 20) chartMa20Series = series;
  else if (period === 50) chartMa50Series = series;
  else if (period === 200) chartMa200Series = series;
}

function isChartMaVisible(period) {
  if (period === 20) return chartMa20Visible;
  if (period === 50) return chartMa50Visible;
  if (period === 200) return chartMa200Visible;
  return false;
}

function setChartMaVisible(period, visible) {
  if (period === 20) chartMa20Visible = visible;
  else if (period === 50) chartMa50Visible = visible;
  else if (period === 200) chartMa200Visible = visible;
}

/** Apply persisted on/off state to each MA LineSeries. */
function applyMovingAverageVisibility() {
  for (const period of CHART_MA_PERIODS) {
    const series = getChartMaSeriesRef(period);
    if (series) {
      series.applyOptions({ visible: isChartMaVisible(period) });
    }
  }
}

/**
 * Create MA LineSeries once per chart instance.
 * Reused across timeframe, symbol, and chart-type updates via setData().
 */
function ensureMovingAverageSeries(LineSeries) {
  if (!chartInstance) return;

  for (const period of CHART_MA_PERIODS) {
    if (getChartMaSeriesRef(period)) continue;
    const series = chartInstance.addSeries(LineSeries, {
      color: CHART_MA_COLORS[period],
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: isChartMaVisible(period),
    });
    setChartMaSeriesRef(period, series);
  }
}

/** Recalculate SMAs from extended history and push values for the visible window only. */
function updateMovingAverageOverlays(displayCandleData, LineSeries) {
  if (!chartInstance || !displayCandleData?.length) return;

  const maSourceCandleData =
    lastPriceSeries?.maSourceCandleData?.length
      ? lastPriceSeries.maSourceCandleData
      : displayCandleData;

  ensureMovingAverageSeries(LineSeries);

  for (const period of CHART_MA_PERIODS) {
    const series = getChartMaSeriesRef(period);
    if (!series) continue;
    if (!isChartMaVisible(period)) {
      series.setData([]);
      continue;
    }
    series.setData(
      movingAverageForDisplay(maSourceCandleData, displayCandleData, period)
    );
  }

  applyMovingAverageVisibility();
}

function setChartMovingAverageVisible(period, visible) {
  const p = Number(period);
  if (!CHART_MA_PERIODS.includes(p)) return;
  setChartMaVisible(p, Boolean(visible));
  const series = getChartMaSeriesRef(p);
  if (series) {
    series.applyOptions({ visible: isChartMaVisible(p) });
  } else if (chartInstance) {
    const data = getChartSeriesData();
    if (data?.candleData?.length) {
      void ensureLightweightCharts().then(({ LineSeries }) => {
        updateMovingAverageOverlays(data.candleData, LineSeries);
      });
    }
  }
  syncChartSettingsUi();
}

function enrichCandlesWithVolume(candleData, volumeData) {
  const volByTime = new Map();
  (volumeData || []).forEach((v) => {
    if (Number.isFinite(v.time)) volByTime.set(v.time, v.value ?? 0);
  });
  return candleData.map((c) => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: volByTime.get(c.time) ?? 0,
  }));
}

function updateTechnicalIndicators(displayCandleData, volumeData, showVolume) {
  if (!chartIndicatorManager || !chartInstance) return;
  const source =
    lastPriceSeries?.maSourceCandleData?.length
      ? lastPriceSeries.maSourceCandleData
      : displayCandleData;
  chartIndicatorManager.update(
    enrichCandlesWithVolume(source, volumeData),
    enrichCandlesWithVolume(displayCandleData, volumeData),
    showVolume
  );
}

function setChartIndicatorVisible(type, visible) {
  if (!(type in chartIndicatorVisible)) return;
  chartIndicatorVisible[type] = Boolean(visible);
  chartIndicatorManager?.setActive(type, chartIndicatorVisible[type]);
  syncChartSettingsUi();
}

function isIntradayChartRange(range = activeRange) {
  const key = String(range || "1D").toUpperCase();
  return key === "1D" || key === "5D";
}

function getChartConfigKey() {
  return `${activeChartType}:${chartShowVolume}`;
}

function shouldShowChartVolume(seriesData) {
  return chartShowVolume && seriesData.hasVolume;
}

function rebuildChartBarIndex(candleData, volumeData) {
  chartBarByTime = new Map();
  candleData.forEach((bar, i) => {
    chartBarByTime.set(bar.time, {
      ...bar,
      volume: volumeData[i]?.value ?? 0,
    });
  });
}

function getBarAtChartTime(time) {
  if (time == null) return null;
  if (typeof time === "number" && Number.isFinite(time)) {
    return chartBarByTime.get(time) ?? null;
  }

  let dayKey = null;
  if (typeof time === "string") {
    dayKey = time.slice(0, 10);
  } else if (typeof time === "object" && time.year && time.month && time.day) {
    dayKey = `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
  }
  if (!dayKey) return null;

  for (const bar of chartBarByTime.values()) {
    const barDay = new Date(bar.time * 1000).toISOString().slice(0, 10);
    if (barDay === dayKey) return bar;
  }
  return null;
}

function getLatestChartBar() {
  if (!lastPriceSeries?.candleData?.length) return null;
  const last = lastPriceSeries.candleData[lastPriceSeries.candleData.length - 1];
  const vol = lastPriceSeries.volumeData?.[lastPriceSeries.volumeData.length - 1]?.value ?? 0;
  return { ...last, volume: vol };
}

function formatChartVolume(value) {
  const x = Number(value);
  if (!Number.isFinite(x)) return "—";
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return Math.round(x).toLocaleString();
}

function formatBarChangePct(open, close) {
  const o = Number(open);
  const c = Number(close);
  if (!Number.isFinite(o) || !Number.isFinite(c) || o === 0) return "—";
  const pct = ((c - o) / o) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function updateOhlcvPanel(bar, currency = activeCurrency) {
  const panel = document.getElementById("chart-ohlcv-panel");
  const oEl = document.getElementById("chart-ohlc-o");
  const hEl = document.getElementById("chart-ohlc-h");
  const lEl = document.getElementById("chart-ohlc-l");
  const cEl = document.getElementById("chart-ohlc-c");
  const vEl = document.getElementById("chart-ohlc-v");
  const chgEl = document.getElementById("chart-ohlc-chg");
  if (!panel || !oEl || !hEl || !lEl || !cEl || !vEl || !chgEl) return;

  if (!bar) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  oEl.textContent = formatPrice(bar.open, currency).replace(/\.\d{2}$/, "");
  hEl.textContent = formatPrice(bar.high, currency).replace(/\.\d{2}$/, "");
  lEl.textContent = formatPrice(bar.low, currency).replace(/\.\d{2}$/, "");
  cEl.textContent = formatPrice(bar.close, currency).replace(/\.\d{2}$/, "");
  vEl.textContent = formatChartVolume(bar.volume);

  const chg = formatBarChangePct(bar.open, bar.close);
  chgEl.textContent = chg;
  chgEl.classList.remove("chart-ohlcv-panel__value--up", "chart-ohlcv-panel__value--down");
  if (bar.close > bar.open) chgEl.classList.add("chart-ohlcv-panel__value--up");
  else if (bar.close < bar.open) chgEl.classList.add("chart-ohlcv-panel__value--down");
}

function attachChartCrosshairHandler() {
  if (!chartInstance) return;
  chartCrosshairUnsub = chartInstance.subscribeCrosshairMove((param) => {
    const currency = lastPriceSeries?.currency || activeCurrency;
    let bar = null;
    if (param.time != null) {
      bar = getBarAtChartTime(param.time);
    }
    if (!bar) bar = getLatestChartBar();
    updateOhlcvPanel(bar, currency);
  });
}

function applyMainSeriesStyle(positive) {
  if (!chartMainSeries) return;
  if (activeChartType === "line") {
    chartMainSeries.applyOptions({
      color: positive ? CHART_UP_COLOR : CHART_DOWN_COLOR,
    });
  } else if (activeChartType === "area") {
    chartMainSeries.applyOptions({
      lineColor: positive ? CHART_UP_COLOR : CHART_DOWN_COLOR,
      topColor: positive ? CHART_UP_FILL : CHART_DOWN_FILL,
      bottomColor: positive ? "rgba(62, 230, 176, 0.02)" : "rgba(255, 107, 122, 0.02)",
    });
  }
}

function applyMainScaleMargins(showVolume) {
  if (!chartMainSeries) return;
  chartMainSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.08, bottom: showVolume ? 0.28 : 0.05 },
  });
}

function resizeChart() {
  if (!chartInstance) return;
  const container = document.getElementById("price-chart");
  if (!container) return;
  const { clientWidth, clientHeight } = container;
  if (clientWidth > 0 && clientHeight > 0) {
    chartInstance.resize(clientWidth, clientHeight);
  }
  chartExtensions?.resize();
  chartIndicatorManager?.renderVolumeProfile();
}

function getChartSeriesData() {
  const stock = getDisplayStock();
  const currency = lastPriceSeries?.currency || stock?.currency || activeCurrency;

  if (lastPriceSeries?.candleData?.length) {
    const positive = lastPriceSeries.positive;
    const lineData = lastPriceSeries.candleData.map((b) => ({
      time: b.time,
      value: b.close,
    }));
    return {
      currency,
      positive,
      lineData,
      candleData: lastPriceSeries.candleData,
      maSourceCandleData: lastPriceSeries.maSourceCandleData || lastPriceSeries.candleData,
      volumeData: lastPriceSeries.volumeData || [],
      hasVolume: (lastPriceSeries.volumeData || []).some((v) => v.value > 0),
    };
  }

  if (stock) {
    const p = stock.price;
    const pc = p * (1 - stock.changePct / 100);
    const now = Math.floor(Date.now() / 1000);
    const candleData = [
      { time: now - 3600, open: pc, high: Math.max(pc, p), low: Math.min(pc, p), close: pc },
      { time: now, open: pc, high: Math.max(pc, p), low: Math.min(pc, p), close: p },
    ];
    const positive = stock.changePct >= 0;
    return {
      currency,
      positive,
      lineData: candleData.map((b) => ({ time: b.time, value: b.close })),
      candleData,
      volumeData: [],
      hasVolume: false,
      fallback: true,
    };
  }

  return null;
}

function createLightweightChartOptions(currency) {
  const intraday = isIntradayChartRange();
  return {
    autoSize: true,
    layout: {
      background: { color: "transparent" },
      textColor: "#8b98ad",
      fontFamily: '"DM Sans", system-ui, sans-serif',
      fontSize: 10,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.04)" },
      horzLines: { color: "rgba(255,255,255,0.04)" },
    },
    rightPriceScale: {
      borderVisible: false,
    },
    timeScale: {
      borderVisible: false,
      timeVisible: intraday,
      secondsVisible: intraday && activeRange === "1D",
    },
    crosshair: {
      vertLine: { color: "rgba(255,255,255,0.18)", labelBackgroundColor: "rgba(18, 24, 34, 0.95)" },
      horzLine: { color: "rgba(255,255,255,0.18)", labelBackgroundColor: "rgba(18, 24, 34, 0.95)" },
    },
    localization: {
      priceFormatter: (price) => formatPrice(price, currency).replace(/\.\d{2}$/, ""),
    },
  };
}

async function createLightweightChart() {
  destroyChart();
  const container = document.getElementById("price-chart");
  const stock = getDisplayStock();
  if (!container || !stock) return;

  const seriesData = getChartSeriesData();
  if (!seriesData) return;

  const { currency, positive, lineData, candleData, volumeData, hasVolume, fallback } = seriesData;
  const showVolume = shouldShowChartVolume(seriesData);
  if (fallback) setChartFootnote("Chart unavailable; showing simplified line.");

  rebuildChartBarIndex(candleData, volumeData);

  const { createChart, LineSeries, AreaSeries, CandlestickSeries, HistogramSeries, createSeriesMarkers } =
    await ensureLightweightCharts();

  chartInstance = createChart(container, createLightweightChartOptions(currency));
  lastChartConfigKey = getChartConfigKey();

  if (activeChartType === "line") {
    chartMainSeries = chartInstance.addSeries(LineSeries, {
      color: positive ? CHART_UP_COLOR : CHART_DOWN_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 4,
    });
    chartMainSeries.setData(lineData);
    applyMainScaleMargins(showVolume);
  } else if (activeChartType === "area") {
    chartMainSeries = chartInstance.addSeries(AreaSeries, {
      lineColor: positive ? CHART_UP_COLOR : CHART_DOWN_COLOR,
      topColor: positive ? CHART_UP_FILL : CHART_DOWN_FILL,
      bottomColor: positive ? "rgba(62, 230, 176, 0.02)" : "rgba(255, 107, 122, 0.02)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 4,
    });
    chartMainSeries.setData(lineData);
    applyMainScaleMargins(showVolume);
  } else {
    chartMainSeries = chartInstance.addSeries(CandlestickSeries, {
      upColor: CHART_UP_COLOR,
      downColor: CHART_DOWN_COLOR,
      borderUpColor: CHART_UP_COLOR,
      borderDownColor: CHART_DOWN_COLOR,
      wickUpColor: CHART_UP_COLOR,
      wickDownColor: CHART_DOWN_COLOR,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    applyMainScaleMargins(showVolume);
    chartMainSeries.setData(candleData);
  }

  // SMA overlays: derived locally from the same candleData (no extra Yahoo fetch).
    updateMovingAverageOverlays(candleData, LineSeries);
    updateTechnicalIndicators(candleData, volumeData, showVolume);

    if (showVolume) {
    chartVolumeSeries = chartInstance.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chartVolumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    chartVolumeSeries.setData(volumeData);
  }

  attachChartCrosshairHandler();
  updateOhlcvPanel(getLatestChartBar(), currency);
  syncChartSettingsUi();
  chartInstance.timeScale().fitContent();
  chartExtensions?.onChartReady({
    chart: chartInstance,
    mainSeries: chartMainSeries,
    LineSeries,
    createSeriesMarkers,
    candleData,
    symbol: stock.symbol,
  });
  chartIndicatorManager?.onChartReady({
    chart: chartInstance,
    mainSeries: chartMainSeries,
    LineSeries,
    HistogramSeries,
    showVolume,
  });
  updateTechnicalIndicators(candleData, volumeData, showVolume);
  resizeChart();
}

async function updateChartSeries() {
  try {
    const seriesData = getChartSeriesData();
    if (!seriesData) {
      destroyChart();
      updateOhlcvPanel(null);
      return;
    }

    rebuildChartBarIndex(seriesData.candleData, seriesData.volumeData);

    const configKey = getChartConfigKey();
    const showVolume = shouldShowChartVolume(seriesData);
    const volumeMismatch = showVolume ? !chartVolumeSeries : !!chartVolumeSeries;

    if (!chartInstance || !chartMainSeries || lastChartConfigKey !== configKey || volumeMismatch) {
      await createLightweightChart();
      return;
    }

    const { lineData, candleData, volumeData, positive } = seriesData;
    const { LineSeries } = await ensureLightweightCharts();

    if (activeChartType === "candlestick") {
      chartMainSeries.setData(candleData);
    } else {
      applyMainSeriesStyle(positive);
      chartMainSeries.setData(lineData);
    }

    // Timeframe / symbol change: refresh MA lines on existing series instances.
    updateMovingAverageOverlays(candleData, LineSeries);
    updateTechnicalIndicators(candleData, volumeData, showVolume);

    if (chartVolumeSeries) chartVolumeSeries.setData(volumeData);

    chartInstance.applyOptions(createLightweightChartOptions(seriesData.currency));
    chartInstance.timeScale().fitContent();
    updateOhlcvPanel(getLatestChartBar(), seriesData.currency);
    syncChartSettingsUi();
    chartExtensions?.onChartUpdate(candleData);
    if (chartExtensions?.seriesManager.hasCompareSymbols()) {
      await chartExtensions.onRangeChange();
    }
    resizeChart();
  } catch (err) {
    console.error("Chart update failed:", err);
    destroyChart();
    updateOhlcvPanel(null);
    setChartFootnote(`Chart error: ${String(err?.message || err)}`);
  }
}

async function renderChart() {
  await updateChartSeries();
}

function setChartType(type) {
  const next = type === "area" || type === "candlestick" ? type : "line";
  if (activeChartType === next) return;
  activeChartType = next;
  destroyChart();
  syncChartSettingsUi();
  void updateChartSeries();
}

function setChartShowVolume(enabled) {
  const next = Boolean(enabled);
  if (chartShowVolume === next) return;
  chartShowVolume = next;
  destroyChart();
  syncChartSettingsUi();
  void updateChartSeries();
}

function setChartSettingsOpen(open) {
  chartSettingsOpen = open;
  if (open) {
    closeChartDrawMenu();
    closeChartCompareMenu();
    closeChartIndicatorsMenu();
  }
  const menu = document.getElementById("chart-settings-menu");
  const btn = document.getElementById("chart-settings-btn");
  if (menu) menu.hidden = !open;
  if (btn) btn.setAttribute("aria-expanded", String(open));
}

function syncChartFullscreenUi() {
  const panel = document.getElementById("chart-panel");
  const btn = document.getElementById("chart-fullscreen-btn");
  const expandIcon = btn?.querySelector(".chart-fullscreen-icon--expand");
  const compressIcon = btn?.querySelector(".chart-fullscreen-icon--compress");
  document.body.classList.toggle("chart-fullscreen-active", chartFullscreenOpen);
  panel?.classList.toggle("chart-card--fullscreen", chartFullscreenOpen);
  if (btn) {
    btn.setAttribute("aria-pressed", String(chartFullscreenOpen));
    btn.setAttribute(
      "aria-label",
      chartFullscreenOpen ? "Exit full screen" : "Full screen"
    );
    btn.title = chartFullscreenOpen ? "Return chart to normal size" : "Expand chart to full size";
    if (expandIcon) expandIcon.hidden = chartFullscreenOpen;
    if (compressIcon) compressIcon.hidden = !chartFullscreenOpen;
  }
}

function setChartFullscreen(open) {
  const next = Boolean(open);
  if (chartFullscreenOpen === next) return;
  chartFullscreenOpen = next;
  if (!next) setChartSettingsOpen(false);
  syncChartFullscreenUi();
  requestAnimationFrame(() => {
    resizeChart();
    requestAnimationFrame(resizeChart);
  });
}

function toggleChartFullscreen() {
  setChartFullscreen(!chartFullscreenOpen);
}

function syncChartSettingsUi() {
  document.querySelectorAll(".chart-settings__option[data-chart-type]").forEach((btn) => {
    const active = btn.dataset.chartType === activeChartType;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", String(active));
  });
  const volInput = document.getElementById("chart-show-volume");
  if (volInput) volInput.checked = chartShowVolume;

  const ma20Input = document.getElementById("chart-show-ma20");
  const ma50Input = document.getElementById("chart-show-ma50");
  const ma200Input = document.getElementById("chart-show-ma200");
  if (ma20Input) ma20Input.checked = chartMa20Visible;
  if (ma50Input) ma50Input.checked = chartMa50Visible;
  if (ma200Input) ma200Input.checked = chartMa200Visible;

  for (const [type, on] of Object.entries(chartIndicatorVisible)) {
    const input = document.getElementById(`chart-show-${type}`);
    if (input) input.checked = on;
  }
}

const TRADINGVIEW_WIDGET_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const TRADINGVIEW_SYMBOL_INFO_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js";
let lastTradingViewSymbol = null;
let lastTradingViewSymbolInfo = null;
/** @type {Map<string, string>} ticker → TradingView exchange prefix (e.g. NASDAQ) */
const tradingViewExchangeBySymbol = new Map();

/** Map SEC / Yahoo-style exchange labels to TradingView prefixes. */
function toTradingViewExchange(raw) {
  const upper = String(raw || "").trim().toUpperCase();
  if (!upper) return "";
  if (upper.includes("NASDAQ")) return "NASDAQ";
  if (upper.includes("NYSE ARCA") || upper === "ARCA") return "NYSEARCA";
  if (upper.includes("NYSE AMERICAN") || upper === "AMEX" || upper.includes("AMERICAN")) return "AMEX";
  if (upper.includes("NYSE")) return "NYSE";
  if (upper.includes("OTC") || upper.includes("PINK")) return "OTC";
  if (upper === "BATS" || upper.includes("CBOE")) return "CBOE";
  return "";
}

function rememberTradingViewExchange(symbol, exchangeRaw) {
  const sym = normalizeSymbol(symbol);
  const ex = toTradingViewExchange(exchangeRaw);
  if (!sym || !ex) return false;
  const prev = tradingViewExchangeBySymbol.get(sym);
  tradingViewExchangeBySymbol.set(sym, ex);
  return prev !== ex;
}

/**
 * Map an internal ticker to a TradingView symbol.
 * Always prefer EXCHANGE:TICKER so EU locales don't auto-resolve broker CFDs
 * (e.g. "NVDA Spot CFD") instead of the US cash equity.
 */
function toTradingViewSymbol(symbol) {
  let s = String(symbol || "").trim().toUpperCase();
  if (!s) return "";
  if (s.includes(":")) return s;
  // Class shares: Yahoo "BRK-B" → TradingView "BRK.B".
  if (/^[A-Z]+-[A-Z]$/.test(s)) s = s.replace("-", ".");
  const exchange = tradingViewExchangeBySymbol.get(s) || "NASDAQ";
  return `${exchange}:${s}`;
}

function clearTradingViewWidget() {
  lastTradingViewSymbol = null;
  const host = document.getElementById("tradingview-chart");
  if (host) host.innerHTML = "";
}

function clearTradingViewSymbolInfo() {
  lastTradingViewSymbolInfo = null;
  const host = document.getElementById("tradingview-symbol-info");
  if (host) host.innerHTML = "";
}

/**
 * Render the TradingView Symbol Info widget (price, change, key stats) in the
 * stock header, replacing the Yahoo-sourced price block. Re-creates the embed
 * only when the symbol actually changes.
 */
function renderTradingViewSymbolInfo(symbol, { force = false } = {}) {
  const host = document.getElementById("tradingview-symbol-info");
  if (!host) return;

  const tvSymbol = toTradingViewSymbol(symbol);
  if (!tvSymbol) {
    clearTradingViewSymbolInfo();
    return;
  }
  if (!force && tvSymbol === lastTradingViewSymbolInfo) return;
  lastTradingViewSymbolInfo = tvSymbol;

  host.innerHTML = "";

  const container = document.createElement("div");
  container.className = "tradingview-widget-container";

  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  container.appendChild(widget);

  const copyright = document.createElement("div");
  copyright.className = "tradingview-widget-copyright";
  copyright.innerHTML = `<a href="https://www.tradingview.com/symbols/${encodeURIComponent(
    tvSymbol
  )}/" rel="noopener nofollow" target="_blank"><span class="blue-text">${escapeHtml(
    tvSymbol
  )} performance</span></a><span class="trademark"> by TradingView</span>`;
  container.appendChild(copyright);

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = TRADINGVIEW_SYMBOL_INFO_SRC;
  script.async = true;
  script.innerHTML = JSON.stringify({
    symbol: tvSymbol,
    colorTheme: "dark",
    isTransparent: true,
    locale: "en",
    width: "100%",
  });
  container.appendChild(script);

  host.appendChild(container);
}

/**
 * Render the TradingView Advanced Chart widget for a symbol. Re-creates the
 * embed only when the symbol actually changes to avoid needless reloads.
 */
function renderTradingViewWidget(symbol, { force = false } = {}) {
  const host = document.getElementById("tradingview-chart");
  if (!host) return;

  const tvSymbol = toTradingViewSymbol(symbol);
  if (!tvSymbol) {
    clearTradingViewWidget();
    return;
  }
  if (!force && tvSymbol === lastTradingViewSymbol) return;
  lastTradingViewSymbol = tvSymbol;

  host.innerHTML = "";

  const container = document.createElement("div");
  container.className = "tradingview-widget-container";
  container.style.height = "100%";
  container.style.width = "100%";

  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container__widget";
  widget.style.height = "calc(100% - 24px)";
  widget.style.width = "100%";
  container.appendChild(widget);

  const copyright = document.createElement("div");
  copyright.className = "tradingview-widget-copyright";
  copyright.innerHTML = `<a href="https://www.tradingview.com/symbols/${encodeURIComponent(
    tvSymbol
  )}/" rel="noopener nofollow" target="_blank"><span class="blue-text">${escapeHtml(
    tvSymbol
  )} chart</span></a><span class="trademark"> by TradingView</span>`;
  container.appendChild(copyright);

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = TRADINGVIEW_WIDGET_SRC;
  script.async = true;
  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  script.innerHTML = JSON.stringify({
    allow_symbol_change: false,
    calendar: false,
    details: false,
    hide_side_toolbar: isMobile,
    hide_top_toolbar: false,
    hide_legend: false,
    hide_volume: false,
    hotlist: false,
    interval: "D",
    locale: "en",
    save_image: true,
    style: "1",
    symbol: tvSymbol,
    theme: "dark",
    timezone: "Etc/UTC",
    backgroundColor: "#0c1017",
    gridColor: "rgba(255, 255, 255, 0.06)",
    watchlist: [],
    withdateranges: !isMobile,
    compareSymbols: [],
    studies: [],
    autosize: true,
  });
  container.appendChild(script);

  host.appendChild(container);
}

async function loadActiveSymbolPanels(forSymbol) {
  const sym = normalizeSymbol(forSymbol || getViewingSymbol());
  if (!sym) return;
  const loadSeq = ++panelLoadSeq;
  const stock = getDisplayStock();
  activeCurrency = stock?.currency || activeCurrency;

  const [secFilRes, ownRes, secRes, insiderRes, intelRes, classRes] = await Promise.allSettled([
    fetchFilingsFundamentals(sym),
    fetchTopHolders(sym),
    fetchSecFilings(sym, 30),
    apiJson(`/api/stocks/${encodeURIComponent(sym)}/insider-transactions`, {
      limit: 200,
      codes: "P,S",
      sort: "date",
    }),
    apiJson(`/api/stocks/${encodeURIComponent(sym)}/ownership-intelligence`),
    fetchStockClassification(sym),
  ]);

  if (isStalePanelLoad(loadSeq, sym)) return;

  loadedPanelSymbol = sym;
  lastFilingsFundamentals = null;
  lastSecFilingsForScores = null;
  filingsFundamentalsSymbol = null;

  const secFilings = secFilRes.status === "fulfilled" ? secFilRes.value : null;
  lastFilingsFundamentals = secFilings;
  lastSecFilingsForScores = secFilings;
  renderCategoryScoresPanel(secFilings);
  renderSecFilingsFundamentalsExtras(secFilings, secFilRes.status === "rejected" ? String(secFilRes.reason?.message || secFilRes.reason) : null);

  if (secFilings) {
    const parts = ["SEC Company Facts"];
    if (secFilings.entityName) parts.push(secFilings.entityName);
    if (secFilings.ticker) parts.push(secFilings.ticker);
    setOverviewDataSource(parts.join(" · "));
    renderStockOverview({ secFilings });
  } else {
    setOverviewDataSource("SEC Company Facts (error)");
    renderStockOverview(null);
  }

  if (intelRes.status === "fulfilled") {
    renderOwnershipIntelligencePanel(intelRes.value);
  } else {
    const msg = String(intelRes.reason?.message || intelRes.reason);
    renderOwnershipIntelligencePanel(null, msg);
  }

  if (classRes.status === "fulfilled") {
    lastStockClassification = classRes.value;
  } else {
    lastStockClassification = null;
  }
  renderStockClassificationLabel(lastStockClassification);

  let ownErr = "";
  if (ownRes.status === "fulfilled") {
    const p = ownRes.value;
    lastOwnershipHolders = Array.isArray(p.holders) ? p.holders : [];
    lastOwnershipCurrency = p.meta?.currency || activeCurrency || "USD";
    lastOwnershipStockPrice =
      p.meta?.stockPrice != null && Number.isFinite(Number(p.meta.stockPrice))
        ? Number(p.meta.stockPrice)
        : getDisplayStock()?.price ?? null;
    lastOwnershipQuarterMeta = {
      currentQuarter: p.meta?.currentQuarter,
      previousQuarter: p.meta?.previousQuarter ?? null,
    };
    const hint = p.meta?.issuerHint;
    const tracked = p.meta?.trackedFundCount;
    const parts = formatOwnershipSubtitle(p.meta, lastOwnershipHolders.length, tracked);
    const livePx = resolveOwnershipStockPrice();
    if (livePx != null) {
      parts.push(`${formatPrice(livePx, lastOwnershipCurrency)} live`);
    }
    if (hint) parts.push(hint);
    setOwnershipSubtitle(parts.join(" · "));
    renderOwnershipTable();
  } else {
    lastOwnershipHolders = [];
    lastOwnershipQuarterMeta = {};
    ownErr = String(ownRes.reason?.message || ownRes.reason);
    setOwnershipSubtitle("13F top holders (error)");
    renderOwnershipHoldersBody(
      `<tr><td colspan="6" class="trades-table__empty">${escapeHtml(ownErr)}</td></tr>`
    );
  }

  let secErr = "";
  if (secRes.status === "fulfilled") {
    const p = secRes.value;
    lastSecFilings = Array.isArray(p.filings) ? p.filings : [];
    chartExtensions?.setSecPayload(p);
    const name = p.entityName ? String(p.entityName) : "";
    const sub = name.length > 72 ? `${name.slice(0, 69)}…` : name;
    setSecSubtitle(sub ? `CIK ${p.cik} · ${sub}` : `CIK ${p.cik} · data.sec.gov submissions`);
    // Pin TradingView to the SEC-listed US equity exchange (avoids broker CFDs).
    if (rememberTradingViewExchange(sym, p.exchange)) {
      renderTradingViewWidget(sym, { force: true });
      renderTradingViewSymbolInfo(sym, { force: true });
    }
  } else {
    lastSecFilings = [];
    secErr = String(secRes.reason?.message || secRes.reason);
    setSecSubtitle("SEC submissions (error)");
  }

  if (insiderRes.status === "fulfilled") {
    chartExtensions?.setInsiderPayload(insiderRes.value);
  }

  if (lastOwnershipHolders.length && resolveOwnershipStockPrice() != null) {
    renderOwnershipTable();
  }

  const secBody = document.getElementById("sec-filings-body");
  if (secErr) {
    secBody.innerHTML = `<tr><td colspan="5" class="trades-table__empty">${escapeHtml(secErr)}</td></tr>`;
  } else {
    renderSecFilingsTable();
  }

  if (activeStockTab === "filings-fundamentals") {
    void loadFilingsFundamentalsPanel(sym);
  } else if (activeStockTab === "signals") {
    void loadSignalsPanel(sym);
  }

  if (isStalePanelLoad(loadSeq, sym)) return;

  void loadStockInsiderCluster(sym);
}

async function selectStock(index) {
  closeStocksOverlays();
  setExploreMode("stocks", { navigate: false });
  previewStock = null;
  activeIndex = index;
  const sym = normalizeSymbol(watchlist[index]?.symbol);
  setViewingSymbol(sym);
  activeCurrency = watchlist[index]?.currency || "USD";
  resetStockPanelUi(sym);
  renderWatchlist();
  renderHeader();
  syncStockUrl(sym || getDisplayStock()?.symbol);
  closeDrawerIfMobile();
  if (sym) await loadActiveSymbolPanels(sym);
}

function closeDrawerIfMobile() {
  clearMobileOverlays({ topbarNav: false });
}

/** Force-clear mobile menu / watchlist dimmers (classes + [hidden] + inline display). */
function clearMobileOverlays({ topbarNav = true, watchlist = true } = {}) {
  if (watchlist) {
    document.getElementById("watchlist-panel")?.classList.remove("is-open");
    document.body.classList.remove("watchlist-drawer-open");
    document.querySelectorAll(".watchlist-toggle").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
      btn.classList.remove("is-active");
    });
  }
  if (topbarNav) {
    if (typeof window.closeMobileTopbarNav === "function") {
      window.closeMobileTopbarNav();
    }
    document.querySelector(".topbar")?.classList.remove("is-nav-open");
    document.body.classList.remove("topbar-nav-open");
    document.body.style.overflow = "";
    const menuBtn = document.getElementById("topbar-menu-btn");
    if (menuBtn) {
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.setAttribute("aria-label", "Open menu");
    }
    const backdrop = document.getElementById("topbar-nav-backdrop");
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.style.removeProperty("display");
    }
  }
}

function setupDrawer() {
  const aside = document.getElementById("watchlist-panel");
  const toggles = [...document.querySelectorAll(".watchlist-toggle")];
  const scrim = document.getElementById("drawer-scrim");
  if (!aside || !toggles.length) return;

  function setOpen(open) {
    aside.classList.toggle("is-open", open);
    document.body.classList.toggle("watchlist-drawer-open", open);
    for (const toggle of toggles) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.classList.toggle("is-active", open);
    }
  }

  for (const toggle of toggles) {
    toggle.addEventListener("click", () => {
      setOpen(!aside.classList.contains("is-open"));
    });
  }

  if (scrim) scrim.addEventListener("click", () => setOpen(false));

  document.addEventListener("click", (e) => {
    if (!window.matchMedia("(max-width: 960px)").matches) return;
    if (!aside.classList.contains("is-open")) return;
    const t = e.target;
    if (aside.contains(t) || toggles.some((btn) => btn.contains(t)) || (scrim && scrim.contains(t))) {
      return;
    }
    setOpen(false);
  });
}

function setupChartFullscreen() {
  document.getElementById("chart-fullscreen-btn")?.addEventListener("click", () => {
    toggleChartFullscreen();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chartFullscreenOpen) {
      setChartFullscreen(false);
    }
  });

  syncChartFullscreenUi();
}

function setupChartSettings() {
  const root = document.getElementById("chart-settings");
  const btn = document.getElementById("chart-settings-btn");
  const menu = document.getElementById("chart-settings-menu");
  const volInput = document.getElementById("chart-show-volume");

  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setChartSettingsOpen(!chartSettingsOpen);
  });

  menu?.querySelectorAll(".chart-settings__option[data-chart-type]").forEach((option) => {
    option.addEventListener("click", () => {
      setChartType(option.dataset.chartType || "line");
      setChartSettingsOpen(false);
    });
  });

  volInput?.addEventListener("change", () => {
    setChartShowVolume(volInput.checked);
  });

  document.getElementById("chart-show-ma20")?.addEventListener("change", (e) => {
    setChartMovingAverageVisible(20, e.target.checked);
  });
  document.getElementById("chart-show-ma50")?.addEventListener("change", (e) => {
    setChartMovingAverageVisible(50, e.target.checked);
  });
  document.getElementById("chart-show-ma200")?.addEventListener("change", (e) => {
    setChartMovingAverageVisible(200, e.target.checked);
  });

  document.querySelectorAll("[data-indicator]").forEach((input) => {
    input.addEventListener("change", () => {
      setChartIndicatorVisible(input.dataset.indicator || "", input.checked);
    });
  });

  document.addEventListener("click", (e) => {
    if (!chartSettingsOpen || !root) return;
    if (root.contains(e.target)) return;
    setChartSettingsOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chartSettingsOpen) setChartSettingsOpen(false);
  });

  syncChartSettingsUi();
}

function setupTabs() {
  document.querySelectorAll(".tabs__btn[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs__btn[data-range]").forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      activeRange = btn.dataset.range;
      const sym = getViewingSymbol();
      if (sym) void loadActiveSymbolPanels(sym);
    });
  });
}

async function handleRouteChange() {
  hideInfoViews();
  const route = parseAppRoute(window.location.pathname);
  if (route.mode === "landing") {
    hideAuthRoute();
    showLandingView(true);
    return;
  }
  if (route.mode === "auth") {
    showLandingView(false);
    showAuthRoute();
    return;
  }
  if (route.mode === "premium") {
    showPremiumView(true);
    return;
  }
  if (route.mode === "faq") {
    showFaqView(true);
    return;
  }
  if (route.mode === "methodology") {
    showMethodologyView(true);
    return;
  }
  if (route.mode === "data-sources") {
    showDataSourcesView(true);
    return;
  }
  if (route.mode === "about") {
    showAboutView(true);
    return;
  }
  if (route.mode === "contact") {
    showContactView(true);
    return;
  }
  if (route.mode === "legal") {
    showLegalView(route.legalKey);
    return;
  }
  hideAuthRoute();
  showLandingView(false);
  if (route.mode === "institutions") {
    closeStocksOverlays();
    await openInstitutionFromRoute(route);
    return;
  }
  if (route.mode === "politicians") {
    closeStocksOverlays();
    activeInstitutionCik = null;
    setExploreMode("politicians", { navigate: false });
    await ensurePoliticiansRecent();
    if (route.politicianHubView) activePoliticianHubView = route.politicianHubView;
    if (route.sectorSlug) activePoliticianSectorSlug = route.sectorSlug;
    if (route.politicianKey) {
      openPoliticianProfile(route.politicianKey, { navigate: false });
    } else {
      closePoliticianProfile({ navigate: false });
      updatePoliticiansView();
    }
    return;
  }
  if (route.mode === "insiders") {
    closeStocksOverlays();
    activeInstitutionCik = null;
    setExploreMode("insiders", { navigate: false });
    if (route.insiderHubView) activeInsiderHubView = route.insiderHubView;
    if (route.insiderKey) {
      openInsiderProfile(route.insiderKey, { navigate: false });
    } else {
      closeInsiderProfile({ navigate: false });
      updateInsidersView();
    }
    return;
  }
  if (route.mode === "signals") {
    closeStocksOverlays();
    activeInstitutionCik = null;
    setExploreMode("signals", { navigate: false });
    if (route.signalsHubView) activeSignalsHubView = route.signalsHubView;
    if (route.doubleSignalTicker) activeDoubleSignalTicker = route.doubleSignalTicker;
    updateSignalsView();
    return;
  }
  if (route.mode === "tools") {
    closeStocksOverlays();
    activeInstitutionCik = null;
    if (route.toolsHubView === "dcf") {
      activeToolsHubView = "dcf";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureDcfCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void dcfCalculator?.loadTicker(ticker);
    } else if (route.toolsHubView === "wacc") {
      activeToolsHubView = "wacc";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureWaccCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void waccCalculator?.loadTicker(ticker);
    } else if (route.toolsHubView === "epv") {
      activeToolsHubView = "epv";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureEpvCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void epvCalculator?.loadTicker(ticker);
    } else if (route.toolsHubView === "ev") {
      activeToolsHubView = "ev";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureEvCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void evCalculator?.loadTicker(ticker);
    } else if (route.toolsHubView === "pe") {
      activeToolsHubView = "pe";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensurePeCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void peCalculator?.loadTicker(ticker);
    } else if (route.toolsHubView === "evebitda") {
      activeToolsHubView = "evebitda";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureEvEbitdaCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void evebitdaCalculator?.loadTicker(ticker);
    } else if (route.toolsHubView === "fcfyield") {
      activeToolsHubView = "fcfyield";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureFcfYieldCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void fcfYieldCalculator?.loadTicker(ticker);
    } else if (route.toolsHubView === "similar") {
      activeToolsHubView = "similar";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureSimilarStocksTool();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void similarStocksTool?.loadTicker(ticker);
    } else {
      activeToolsHubView = "directory";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
    }
    return;
  }
  setExploreMode("stocks", { navigate: false });
  if (route.redirectFrom === "/signals/screener" && window.location.pathname !== "/stocks/screener") {
    history.replaceState({ screener: true }, "", "/stocks/screener");
  }
  if (route.screener) {
    setScreenerVisible(true);
    return;
  }
  if (route.recentlyActive) {
    closeStocksOverlays();
    recentlyActiveOpen = true;
    updateStocksView();
    return;
  }
  if (route.stocksMostAccumulated) {
    closeStocksOverlays();
    stocksMostAccumulatedOpen = true;
    updateStocksView();
    return;
  }
  if (route.stocksOwnershipChanges) {
    closeStocksOverlays();
    stocksOwnershipChangesOpen = true;
    updateStocksView();
    return;
  }
  if (route.stocksHolderOverlap) {
    closeStocksOverlays();
    stocksHolderOverlapOpen = true;
    updateStocksView();
    return;
  }
  if (route.stocksOwnershipHistory) {
    closeStocksOverlays();
    stocksOwnershipHistoryOpen = true;
    updateStocksView();
    return;
  }
  if (route.stocksCompare) {
    const sp = new URLSearchParams(window.location.search);
    stocksCompareSelection.a = String(sp.get("tickerA") || "").trim().toUpperCase();
    stocksCompareSelection.b = String(sp.get("tickerB") || "").trim().toUpperCase();
    stocksCompareSelection.period = String(sp.get("period") || "latest").trim() || "latest";
    closeStocksOverlays();
    stocksCompareOpen = true;
    updateStocksView();
    return;
  }
  closeStocksOverlays();
  if (route.symbol) {
    await openStockFromRoute(route);
    return;
  }
  previewStock = null;
  activeIndex = -1;
  setViewingSymbol(null);
  renderWatchlist();
  renderHeader();
}

function setupStockTabs() {
  document.querySelectorAll(".stock-tabs__btn[data-stock-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setStockTab(btn.dataset.stockTab || "overview");
    });
  });
  document.getElementById("signals-grid")?.addEventListener("click", (e) => {
    const link = e.target.closest?.("[data-signal-hub-link]");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("data-signal-hub-link");
    if (href) {
      history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  });
  window.addEventListener("popstate", () => {
    void handleRouteChange();
  });
}

function setupInstitutionTabs() {
  document.querySelectorAll("[data-institution-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setInstitutionTab(btn.dataset.institutionTab || "holdings");
    });
  });
}

function setupMobileTopbarNav() {
  const topbar = document.querySelector(".topbar");
  const menuBtn = document.getElementById("topbar-menu-btn");
  const backdrop = document.getElementById("topbar-nav-backdrop");
  const nav = document.getElementById("workspace-nav");
  const start = topbar?.querySelector(".topbar__start");
  const brand = start?.querySelector(".topbar__brand");
  if (!topbar || !menuBtn || !nav) return;

  const placeNav = () => {
    const mobile = window.matchMedia("(max-width: 900px)").matches;
    if (mobile) {
      // Keep fixed drawer out of the topbar (backdrop-filter creates a fixed containing block).
      if (nav.parentElement !== topbar.parentElement || nav.previousElementSibling !== topbar) {
        topbar.insertAdjacentElement("afterend", nav);
      }
    } else if (brand && nav.parentElement !== start) {
      brand.insertAdjacentElement("afterend", nav);
    }
  };

  const setOpen = (open) => {
    topbar.classList.toggle("is-nav-open", open);
    document.body.classList.toggle("topbar-nav-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (backdrop) {
      // Prefer [hidden]; CSS forces display:none !important when hidden so the
      // grey fullscreen scrim cannot stick after navigation.
      backdrop.hidden = !open;
      backdrop.style.removeProperty("display");
    }
  };

  const closeNav = () => setOpen(false);

  // Expose for other handlers (subsection clicks use stopPropagation).
  window.closeMobileTopbarNav = closeNav;

  placeNav();

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!topbar.classList.contains("is-nav-open"));
  });

  backdrop?.addEventListener("click", () => closeNav());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && topbar.classList.contains("is-nav-open")) {
      closeNav();
    }
  });

  document.getElementById("logo-home-link")?.addEventListener("click", () => {
    closeNav();
  });

  // Capture phase so we still close when subsection handlers call stopPropagation.
  nav.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest?.(
        ".explore-nav__btn, .workspace-nav__subsection, [data-explore], [data-stocks-view], [data-institutions-view], [data-insiders-view], [data-politicians-view], [data-signals-view], [data-tools-view]"
      );
      if (target && target !== menuBtn) closeNav();
    },
    true
  );

  window.addEventListener("resize", () => {
    placeNav();
    if (window.matchMedia("(min-width: 901px)").matches) closeNav();
  });
}

function setupExploreNav() {
  document.querySelectorAll(".explore-nav__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.explore;
      if (mode === "institutions") {
        void (async () => {
          await ensureInstitutionsIndex();
          activeInstitutionCik = null;
          activeInstitutionHubView = "directory";
          setExploreMode("institutions", { navigate: false });
          if (window.location.pathname !== "/institutions") {
            history.pushState({ explore: "institutions" }, "", "/institutions");
          }
          updateInstitutionsView();
        })();
        return;
      }
      if (mode === "politicians") {
        activePoliticianKey = null;
        activePoliticianHubView = "trades";
        setExploreMode("politicians", { navigate: false });
        if (window.location.pathname !== "/politicians") {
          history.pushState({ explore: "politicians", politicianHubView: "trades" }, "", "/politicians");
        }
        void updatePoliticiansView();
        return;
      }
      if (mode === "insiders") {
        void (async () => {
          setExploreMode("insiders", { navigate: false });
          navigateToInsiderTrades();
        })();
        return;
      }
      if (mode === "signals") {
        setExploreMode("signals", { navigate: false });
        navigateToSignalsHub();
        return;
      }
      if (mode === "tools") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsHub();
        return;
      }
      if (!document.getElementById("view-landing")?.hidden) {
        void enterAppFromLanding("stocks");
        return;
      }
      setExploreMode("stocks", { navigate: false });
      navigateToStocksHub();
    });
  });

  document.querySelectorAll("[data-institutions-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = btn.getAttribute("data-institutions-view");
      if (view === "directory") {
        void (async () => {
          await ensureInstitutionsIndex();
          setExploreMode("institutions", { navigate: false });
          navigateToInstitutionDirectory();
        })();
        return;
      }
      if (view === "performance" || view === "proxy-performance") {
        void (async () => {
          await ensureInstitutionsIndex();
          setExploreMode("institutions", { navigate: false });
          navigateToInstitutionPerformanceRankings();
        })();
        return;
      }
      if (view === "most-accumulated") {
        void (async () => {
          await ensureInstitutionsIndex();
          setExploreMode("institutions", { navigate: false });
          navigateToInstitutionMostAccumulated();
        })();
        return;
      }
      if (view === "new-positions") {
        void (async () => {
          await ensureInstitutionsIndex();
          setExploreMode("institutions", { navigate: false });
          navigateToInstitutionNewPositions();
        })();
        return;
      }
      if (view === "completely-sold") {
        void (async () => {
          await ensureInstitutionsIndex();
          setExploreMode("institutions", { navigate: false });
          navigateToInstitutionCompletelySold();
        })();
        return;
      }
      if (view === "compare") {
        void (async () => {
          await ensureInstitutionsIndex();
          setExploreMode("institutions", { navigate: false });
          navigateToInstitutionCompare();
        })();
        return;
      }
      if (view === "notable-investors") {
        void (async () => {
          await ensureInstitutionsIndex();
          setExploreMode("institutions", { navigate: false });
          navigateToNotableInvestors();
        })();
      }
    });
  });

  document.querySelectorAll("[data-politicians-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = btn.getAttribute("data-politicians-view");
      if (view === "trades") {
        setExploreMode("politicians", { navigate: false });
        navigateToPoliticianTrades();
        return;
      }
      if (view === "most-accumulated") {
        setExploreMode("politicians", { navigate: false });
        navigateToPoliticianMostAccumulated();
        return;
      }
      if (view === "largest-portfolios") {
        setExploreMode("politicians", { navigate: false });
        navigateToPoliticianLargestPortfolios();
        return;
      }
      if (view === "repeat-buyers") {
        setExploreMode("politicians", { navigate: false });
        navigateToPoliticianRepeatBuyers();
        return;
      }
      if (view === "first-time-buyers") {
        setExploreMode("politicians", { navigate: false });
        navigateToPoliticianFirstTimeBuyers();
        return;
      }
      if (view === "heavy-selling") {
        setExploreMode("politicians", { navigate: false });
        navigateToPoliticianHeavySelling();
        return;
      }
      if (view === "sector-exposure") {
        setExploreMode("politicians", { navigate: false });
        navigateToPoliticianSectorExposure();
      }
    });
  });

  document.querySelectorAll("[data-insiders-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = btn.getAttribute("data-insiders-view");
      if (view === "clusters") {
        setExploreMode("insiders", { navigate: false });
        navigateToInsiderClusters();
        return;
      }
      if (view === "conviction-buys") {
        setExploreMode("insiders", { navigate: false });
        navigateToConvictionBuys();
        return;
      }
      if (view === "repeat-buyers") {
        setExploreMode("insiders", { navigate: false });
        navigateToRepeatBuyers();
        return;
      }
      if (view === "sentiment") {
        setExploreMode("insiders", { navigate: false });
        navigateToInsiderSentiment();
        return;
      }
      if (view === "first-time-buyers") {
        setExploreMode("insiders", { navigate: false });
        navigateToFirstTimeBuyers();
        return;
      }
      if (view === "heavy-selling") {
        setExploreMode("insiders", { navigate: false });
        navigateToHeavySelling();
        return;
      }
      if (view === "trades") {
        setExploreMode("insiders", { navigate: false });
        navigateToInsiderTrades();
      }
    });
  });

  document.querySelectorAll("[data-stocks-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = btn.getAttribute("data-stocks-view");
      if (view === "recently-active") {
        setExploreMode("stocks", { navigate: false });
        navigateToStocksRecentlyActive();
        return;
      }
      if (view === "most-accumulated") {
        setExploreMode("stocks", { navigate: false });
        navigateToStocksMostAccumulated();
        return;
      }
      if (view === "ownership-changes") {
        setExploreMode("stocks", { navigate: false });
        navigateToStocksOwnershipChanges();
        return;
      }
      if (view === "holder-overlap") {
        setExploreMode("stocks", { navigate: false });
        navigateToStocksHolderOverlap();
        return;
      }
      if (view === "ownership-history") {
        setExploreMode("stocks", { navigate: false });
        navigateToStocksOwnershipHistory();
        return;
      }
      if (view === "compare" || view === "stock-comparison") {
        setExploreMode("stocks", { navigate: false });
        navigateToStocksCompare();
        return;
      }
      if (view === "screener") {
        setExploreMode("stocks", { navigate: false });
        navigateToStocksScreener();
      }
    });
  });

  document.querySelectorAll("[data-signals-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = btn.getAttribute("data-signals-view");
      if (view === "smart-money") {
        setExploreMode("signals", { navigate: false });
        navigateToSignalsSmartMoney();
        return;
      }
      if (view === "top-institution-entries") {
        setExploreMode("signals", { navigate: false });
        navigateToTopInstitutionNewEntries();
        return;
      }
      if (view === "double-signal") {
        setExploreMode("signals", { navigate: false });
        navigateToDoubleSignal(null);
        return;
      }
      if (view === "triple-signal") {
        setExploreMode("signals", { navigate: false });
        navigateToTripleSignal(null);
        return;
      }
      if (view === "conflict-signals") {
        setExploreMode("signals", { navigate: false });
        navigateToConflictSignals();
        return;
      }
      if (view === "hidden-gems") {
        setExploreMode("signals", { navigate: false });
        navigateToHiddenGems();
        return;
      }
      if (view === "conviction-score") {
        setExploreMode("signals", { navigate: false });
        navigateToConvictionScore();
        return;
      }
      if (view === "institutional-discovery") {
        setExploreMode("signals", { navigate: false });
        navigateToInstitutionalDiscovery();
      }
    });
  });

  document.querySelectorAll("[data-tools-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = btn.getAttribute("data-tools-view");
      if (view === "dcf") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsDcf();
        return;
      }
      if (view === "wacc") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsWacc();
        return;
      }
      if (view === "epv") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsEpv();
        return;
      }
      if (view === "ev") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsEv();
        return;
      }
      if (view === "pe") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsPe();
        return;
      }
      if (view === "evebitda") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsEvEbitda();
        return;
      }
      if (view === "fcfyield") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsFcfYield();
        return;
      }
      if (view === "similar") {
        setExploreMode("tools", { navigate: false });
        navigateToToolsSimilarStocks();
      }
    });
  });
}

function setupLanding() {
  const root = document.getElementById("view-landing");
  root?.addEventListener("click", (e) => {
    const enter = e.target.closest?.("[data-landing-enter]");
    if (enter) {
      void enterAppFromLanding(enter.getAttribute("data-landing-enter"));
      return;
    }
    if (e.target.closest?.("#landing-see-how")) {
      document.getElementById("landing-how")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    }
  });
  document.getElementById("logo-home-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    navigateToLanding();
  });
  initLandingPage();
}

function setupPremiumPage() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href="/pricing"], a[href="/premium"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    history.pushState({}, "", a.getAttribute("href") || "/pricing");
    void handleRouteChange();
  });
}

function setupFaqPage() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.(
      'a[href="/faq"], a[href="/methodology"], a[href="/data-sources"], a[href="/about"], a[href="/contact"], a[href^="/legal/"]'
    );
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    history.pushState({}, "", a.getAttribute("href") || "/faq");
    void handleRouteChange();
  });
}

function setupContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const note = document.getElementById("contact-form-note");
    const name = String(document.getElementById("contact-name")?.value || "").trim();
    const email = String(document.getElementById("contact-email")?.value || "").trim();
    const subject = String(document.getElementById("contact-subject")?.value || "").trim();
    const message = String(document.getElementById("contact-message")?.value || "").trim();

    if (!name || !email || !subject || !message) {
      if (note) {
        note.hidden = false;
        note.textContent = "Please fill in all fields.";
      }
      return;
    }

    const body = [`Name: ${name}`, `Email: ${email}`, "", message].join("\n");
    const mailto = `mailto:contact@tradeatlant.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;

    if (note) {
      note.hidden = false;
      note.textContent =
        "Opening your email app to send the message. If nothing opens, email contact@tradeatlant.com directly.";
    }
  });
}

function setupEntityLinkDelegation() {
  document.addEventListener("click", (e) => {
    const instLink = e.target.closest?.("a.ownership-fund__link[data-institution-cik]");
    if (instLink) {
      e.preventDefault();
      const cik = instLink.getAttribute("data-institution-cik");
      if (cik) void openInstitution(cik, institutionTabFromHref(instLink.getAttribute("href")));
      return;
    }
    const stockLink = e.target.closest?.("a.fundamentals-grid__link[data-stock-symbol], button[data-stock-symbol]");
    if (stockLink) {
      e.preventDefault();
      const sym = stockLink.getAttribute("data-stock-symbol");
      if (sym) void openStockPreview(sym);
      return;
    }
    const polLink = e.target.closest?.("a.politicians-name-link[data-politician-key]");
    if (polLink) {
      e.preventDefault();
      const key = polLink.getAttribute("data-politician-key");
      if (key) openPoliticianProfile(key);
      return;
    }
    const insiderLink = e.target.closest?.("a.insiders-name-link[data-insider-key]");
    if (insiderLink) {
      e.preventDefault();
      const key = insiderLink.getAttribute("data-insider-key");
      if (key) openInsiderProfile(key);
    }
  });
}

function setupTopSearch() {
  const input = document.getElementById("top-search-input");
  const ul = document.getElementById("top-search-results");
  const wrap = document.querySelector(".topbar-search");
  const field = wrap?.querySelector(".topbar-search__field");
  if (!input) return;

  field?.addEventListener("click", (e) => {
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    if (wrap.classList.contains("is-expanded")) return;
    e.preventDefault();
    expandMobileTopSearch();
  });

  input.addEventListener("focus", () => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      wrap?.classList.add("is-expanded");
    }
  });

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(topSearchDebounceTimer);
    if (!q) {
      closeTopSearch();
      if (window.matchMedia("(max-width: 900px)").matches) {
        wrap?.classList.add("is-expanded");
      }
      return;
    }
    const reqId = ++topSearchRequestId;
    topSearchDebounceTimer = setTimeout(() => {
      void (async () => {
        try {
          if (activeExploreMode === "institutions") {
            await ensureInstitutionsIndex();
            const results = searchInstitutions(q);
            if (reqId !== topSearchRequestId) return;
            renderTopInstitutionSearchResults(results);
          } else {
            const results = await searchStocks(q);
            if (reqId !== topSearchRequestId) return;
            renderTopSearchResults(results);
          }
        } catch {
          if (reqId !== topSearchRequestId) return;
          closeTopSearch();
        }
      })();
    }, 280);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      closeTopSearch();
      input.blur();
      collapseMobileTopSearch();
    }
    if (e.key === "Enter") {
      const q = input.value.trim();
      if (!q) return;
      if (activeExploreMode === "institutions") {
        void (async () => {
          await ensureInstitutionsIndex();
          const hits = searchInstitutions(q);
          if (hits[0]) void openInstitution(hits[0].cik, "holdings");
        })();
      } else {
        void openStockPreview(q);
      }
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (wrap?.contains(t) || ul?.contains(t)) return;
    closeTopSearch();
    collapseMobileTopSearch();
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 901px)").matches) {
      wrap?.classList.remove("is-expanded");
    }
  });
}

function setupWatchlistSearch() {
  const addBtn = document.getElementById("watchlist-add-btn");
  const input = document.getElementById("watchlist-search-input");

  if (addBtn) {
    addBtn.addEventListener("click", () => openWatchlistSearch());
  }

  if (input) {
    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearTimeout(searchDebounceTimer);
      if (!q) {
        renderSearchResults([]);
        setSearchHint("Type to search US stocks");
        return;
      }
      setSearchHint("Searching…");
      const reqId = ++searchRequestId;
      searchDebounceTimer = setTimeout(() => {
        void (async () => {
          try {
            const results = await searchStocks(q);
            if (reqId !== searchRequestId) return;
            renderSearchResults(results);
            setSearchHint(results.length ? `${results.length} matches` : "No matches — try another symbol or name");
          } catch (e) {
            if (reqId !== searchRequestId) return;
            renderSearchResults([]);
            const msg = e instanceof Error ? e.message : String(e);
            setSearchHint(msg);
          }
        })();
      }, 280);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeWatchlistSearch();
        addBtn?.focus();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && watchlistSearchOpen) {
      closeWatchlistSearch();
    }
  });
}

window.addEventListener("resize", () => {
  resizeChart();
});

async function init() {
  updateWatchlistBadge();
  renderWatchlist();
  updateWatchlistAddVisibility();
  bindInsiderClusterHubControls();
  bindDoubleSignalHubControls();
  bindTripleSignalHubControls();
  setupConflictSignalsHub();
  setupHiddenGemsHub();
  setupConvictionScoreHub();
  setupInstitutionalDiscoveryHub();
  setupStockComparePage();
  setStockTab("overview", { updateUrl: false });
  showMainEntityView();
  updateTopSearchForMode();

  try {
    await ensureInstitutionsIndex();
  } catch {
    /* institutions search still works after first successful fetch */
  }

  const appRoute = parseAppRoute(window.location.pathname);
  if (appRoute.mode === "landing") {
    showLandingView(true);
    const saved = loadSavedSymbols();
    if (saved.length) {
      setDashboardStatus("Loading watchlist…");
      try {
        const settled = await Promise.allSettled(saved.map((symbol) => fetchWatchlistEntry(symbol)));
        watchlist = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
        saveWatchlistSymbols();
        updateWatchlistBadge();
        renderWatchlist();
        void loadWatchlistActivity();
        setDashboardStatus("");
      } catch {
        setDashboardStatus("");
      }
    }
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.mode === "premium") {
    showPremiumView(true);
    return;
  }

  if (appRoute.mode === "faq") {
    showFaqView(true);
    return;
  }

  if (appRoute.mode === "methodology") {
    showMethodologyView(true);
    return;
  }

  if (appRoute.mode === "data-sources") {
    showDataSourcesView(true);
    return;
  }

  if (appRoute.mode === "about") {
    showAboutView(true);
    return;
  }

  if (appRoute.mode === "contact") {
    showContactView(true);
    return;
  }

  if (appRoute.mode === "legal") {
    showLegalView(appRoute.legalKey);
    return;
  }

  showLandingView(false);

  if (appRoute.mode === "institutions") {
    await openInstitutionFromRoute(appRoute);
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.mode === "politicians") {
    setExploreMode("politicians", { navigate: false });
    await ensurePoliticiansRecent();
    if (appRoute.politicianHubView) activePoliticianHubView = appRoute.politicianHubView;
    if (appRoute.sectorSlug) activePoliticianSectorSlug = appRoute.sectorSlug;
    if (appRoute.politicianKey) {
      openPoliticianProfile(appRoute.politicianKey, { navigate: false });
    } else {
      closePoliticianProfile({ navigate: false });
      updatePoliticiansView();
    }
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.mode === "insiders") {
    setExploreMode("insiders", { navigate: false });
    if (appRoute.insiderHubView) activeInsiderHubView = appRoute.insiderHubView;
    if (appRoute.insiderKey) {
      openInsiderProfile(appRoute.insiderKey, { navigate: false });
    } else {
      closeInsiderProfile({ navigate: false });
      updateInsidersView();
    }
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.mode === "signals") {
    setExploreMode("signals", { navigate: false });
    if (appRoute.signalsHubView) activeSignalsHubView = appRoute.signalsHubView;
    if (appRoute.doubleSignalTicker) activeDoubleSignalTicker = appRoute.doubleSignalTicker;
    updateSignalsView();
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.mode === "tools") {
    if (appRoute.toolsHubView === "dcf") {
      activeToolsHubView = "dcf";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureDcfCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void dcfCalculator?.loadTicker(ticker);
    } else if (appRoute.toolsHubView === "wacc") {
      activeToolsHubView = "wacc";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureWaccCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void waccCalculator?.loadTicker(ticker);
    } else if (appRoute.toolsHubView === "epv") {
      activeToolsHubView = "epv";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureEpvCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void epvCalculator?.loadTicker(ticker);
    } else if (appRoute.toolsHubView === "ev") {
      activeToolsHubView = "ev";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureEvCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void evCalculator?.loadTicker(ticker);
    } else if (appRoute.toolsHubView === "pe") {
      activeToolsHubView = "pe";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensurePeCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void peCalculator?.loadTicker(ticker);
    } else if (appRoute.toolsHubView === "evebitda") {
      activeToolsHubView = "evebitda";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureEvEbitdaCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void evebitdaCalculator?.loadTicker(ticker);
    } else if (appRoute.toolsHubView === "fcfyield") {
      activeToolsHubView = "fcfyield";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureFcfYieldCalculator();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void fcfYieldCalculator?.loadTicker(ticker);
    } else if (appRoute.toolsHubView === "similar") {
      activeToolsHubView = "similar";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
      ensureSimilarStocksTool();
      const sp = new URLSearchParams(window.location.search);
      const ticker = String(sp.get("ticker") || "").trim().toUpperCase();
      if (ticker) void similarStocksTool?.loadTicker(ticker);
    } else {
      activeToolsHubView = "directory";
      setExploreMode("tools", { navigate: false });
      updateToolsView();
    }
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.screener) {
    setExploreMode("stocks", { navigate: false });
    if (appRoute.redirectFrom === "/signals/screener" && window.location.pathname !== "/stocks/screener") {
      history.replaceState({ screener: true }, "", "/stocks/screener");
    }
    setScreenerVisible(true);
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.recentlyActive) {
    setExploreMode("stocks", { navigate: false });
    closeStocksOverlays();
    recentlyActiveOpen = true;
    updateStocksView();
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.stocksMostAccumulated) {
    setExploreMode("stocks", { navigate: false });
    closeStocksOverlays();
    stocksMostAccumulatedOpen = true;
    updateStocksView();
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.stocksOwnershipChanges) {
    setExploreMode("stocks", { navigate: false });
    closeStocksOverlays();
    stocksOwnershipChangesOpen = true;
    updateStocksView();
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.stocksHolderOverlap) {
    setExploreMode("stocks", { navigate: false });
    closeStocksOverlays();
    stocksHolderOverlapOpen = true;
    updateStocksView();
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.stocksOwnershipHistory) {
    setExploreMode("stocks", { navigate: false });
    closeStocksOverlays();
    stocksOwnershipHistoryOpen = true;
    updateStocksView();
    void refreshSidebarMarketPanels();
    return;
  }

  if (appRoute.stocksCompare) {
    setExploreMode("stocks", { navigate: false });
    const sp = new URLSearchParams(window.location.search);
    stocksCompareSelection.a = String(sp.get("tickerA") || "").trim().toUpperCase();
    stocksCompareSelection.b = String(sp.get("tickerB") || "").trim().toUpperCase();
    stocksCompareSelection.period = String(sp.get("period") || "latest").trim() || "latest";
    closeStocksOverlays();
    stocksCompareOpen = true;
    updateStocksView();
    void refreshSidebarMarketPanels();
    return;
  }

  const route = appRoute.mode === "stocks" && appRoute.symbol ? appRoute : parseStockRoute(window.location.pathname);
  const onStocksHubPath = window.location.pathname === "/stocks";
  const saved = loadSavedSymbols();
  if (!saved.length && !route) {
    if (onStocksHubPath) {
      setExploreMode("stocks", { navigate: false });
      navigateToStocksHub();
    } else {
      activeIndex = -1;
      renderHeader();
    }
    setDashboardStatus("");
    void refreshSidebarMarketPanels();
    return;
  }

  setDashboardStatus("Loading watchlist…");
  try {
    const settled = await Promise.allSettled(saved.map((symbol) => fetchWatchlistEntry(symbol)));
    watchlist = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
    saveWatchlistSymbols();
    activeIndex = watchlist.length ? 0 : -1;
    const failed = saved.length - watchlist.length;
    if (failed) {
      setDashboardStatus(`Some saved symbols failed to load (${failed}).`);
      setTimeout(() => setDashboardStatus(""), 8000);
    } else {
      setDashboardStatus("");
    }
    updateWatchlistBadge();
    renderWatchlist();
    void loadWatchlistActivity();
    if (route) {
      await openStockFromRoute(route);
    } else if (onStocksHubPath) {
      previewStock = null;
      activeIndex = -1;
      setExploreMode("stocks", { navigate: false });
      renderHeader();
    } else if (activeIndex >= 0 && activeExploreMode === "stocks") {
      const sym = getViewingSymbol();
      syncStockUrl(sym || undefined);
      if (sym) await loadActiveSymbolPanels(sym);
    } else {
      renderHeader();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setDashboardStatus(`Could not load market data (is the server running?). ${msg}`, true);
    activeIndex = -1;
    renderHeader();
  }

  void refreshSidebarMarketPanels();

  setInterval(() => {
    void (async () => {
      try {
        await refreshWatchlistFromApi();
        renderWatchlist();
        renderHeader();
        if (document.visibilityState === "visible") {
          void refreshSidebarMarketPanels();
        }
        if (document.visibilityState === "visible" && activeExploreMode === "institutions" && activeInstitutionCik) {
          await loadInstitutionPanel(activeInstitutionTab, activeInstitutionCik);
        } else if (document.visibilityState === "visible" && getViewingSymbol()) {
          const refreshSym = getViewingSymbol();
          if (previewStock?.symbol) {
            try {
              previewStock = await fetchWatchlistEntry(previewStock.symbol);
            } catch {
              /* keep previous preview */
            }
          }
          renderHeader();
          await loadActiveSymbolPanels(refreshSym);
        }
      } catch {
        /* ignore interval errors */
      }
    })();
  }, 60_000);
}

function setupOwnershipToggle() {
  const btn = document.getElementById("ownership-more-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      ownershipExpanded = !ownershipExpanded;
      renderOwnershipTable();
    });
  }

  document.querySelectorAll("[data-ownership-holders-sort]").forEach((sortBtn) => {
    sortBtn.addEventListener("click", () => {
      const key = sortBtn.getAttribute("data-ownership-holders-sort") || "valueUsd";
      if (key === ownershipHoldersSortKey) {
        ownershipHoldersSortDir = ownershipHoldersSortDir === "asc" ? "desc" : "asc";
      } else {
        ownershipHoldersSortKey = key;
        ownershipHoldersSortDir = key === "fundName" ? "asc" : "desc";
      }
      ownershipExpanded = false;
      renderOwnershipTable();
    });
  });
}

function setupSecFilingsToggle() {
  const btn = document.getElementById("sec-filings-more-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    secFilingsExpanded = !secFilingsExpanded;
    renderSecFilingsTable();
  });
}

function setupActivityToggles() {
  const buyersBtn = document.getElementById("activity-buyers-more-btn");
  if (buyersBtn) {
    buyersBtn.addEventListener("click", () => {
      activityBuyersExpanded = !activityBuyersExpanded;
      renderActivityTables();
    });
  }
  const sellersBtn = document.getElementById("activity-sellers-more-btn");
  if (sellersBtn) {
    sellersBtn.addEventListener("click", () => {
      activitySellersExpanded = !activitySellersExpanded;
      renderActivityTables();
    });
  }
  const exitsBtn = document.getElementById("activity-exits-more-btn");
  if (exitsBtn) {
    exitsBtn.addEventListener("click", () => {
      activityExitsExpanded = !activityExitsExpanded;
      renderActivityTables();
    });
  }
  const newBtn = document.getElementById("activity-new-more-btn");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      activityNewExpanded = !activityNewExpanded;
      renderActivityTables();
    });
  }
  const fundsBtn = document.getElementById("options-funds-more-btn");
  if (fundsBtn) {
    fundsBtn.addEventListener("click", () => {
      optionsFundsExpanded = !optionsFundsExpanded;
      renderOptionsFundsTable();
    });
  }

  const textDefault = (key) => (key === "fundName" ? "asc" : "desc");
  const sellersDefault = (key) =>
    key === "fundName" ? "asc" : key === "sharesChange" || key === "valueChangeUsd" ? "asc" : "desc";

  bindInstitutionTableSort(
    "data-activity-buyers-sort",
    () => activityBuyersSortKey,
    () => activityBuyersSortDir,
    (k) => {
      activityBuyersSortKey = k;
    },
    (d) => {
      activityBuyersSortDir = d;
    },
    textDefault,
    () => {
      activityBuyersExpanded = false;
      renderActivityTables();
    }
  );
  bindInstitutionTableSort(
    "data-activity-sellers-sort",
    () => activitySellersSortKey,
    () => activitySellersSortDir,
    (k) => {
      activitySellersSortKey = k;
    },
    (d) => {
      activitySellersSortDir = d;
    },
    sellersDefault,
    () => {
      activitySellersExpanded = false;
      renderActivityTables();
    }
  );
  bindInstitutionTableSort(
    "data-activity-exits-sort",
    () => activityExitsSortKey,
    () => activityExitsSortDir,
    (k) => {
      activityExitsSortKey = k;
    },
    (d) => {
      activityExitsSortDir = d;
    },
    textDefault,
    () => {
      activityExitsExpanded = false;
      renderActivityTables();
    }
  );
  bindInstitutionTableSort(
    "data-activity-new-sort",
    () => activityNewSortKey,
    () => activityNewSortDir,
    (k) => {
      activityNewSortKey = k;
    },
    (d) => {
      activityNewSortDir = d;
    },
    textDefault,
    () => {
      activityNewExpanded = false;
      renderActivityTables();
    }
  );
}

setupOwnershipToggle();
setupSecFilingsToggle();
setupActivityToggles();
setupInsiderFilters();
setupStockTabs();
setupStockAddWatchlistBtn();
function setupInstitutionActivityToggles() {
  const rerenderActivity = () => {
    renderInstitutionActivityPanels({
      adds: lastInstitutionAdds,
      trims: lastInstitutionTrims,
      completelySold: lastInstitutionExits,
      newPositions: lastInstitutionNewPositions,
      activity: lastInstitutionActivityAll,
    });
  };

  const addsBtn = document.getElementById("institution-adds-more-btn");
  if (addsBtn) {
    addsBtn.addEventListener("click", () => {
      institutionAddsExpanded = !institutionAddsExpanded;
      rerenderActivity();
    });
  }
  const trimsBtn = document.getElementById("institution-trims-more-btn");
  if (trimsBtn) {
    trimsBtn.addEventListener("click", () => {
      institutionTrimsExpanded = !institutionTrimsExpanded;
      rerenderActivity();
    });
  }
  const exitsBtn = document.getElementById("institution-exits-more-btn");
  if (exitsBtn) {
    exitsBtn.addEventListener("click", () => {
      institutionExitsExpanded = !institutionExitsExpanded;
      rerenderActivity();
    });
  }
  const newBtn = document.getElementById("institution-new-more-btn");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      institutionNewExpanded = !institutionNewExpanded;
      rerenderActivity();
    });
  }
  const holdingsBtn = document.getElementById("institution-holdings-more-btn");
  if (holdingsBtn) {
    holdingsBtn.addEventListener("click", () => {
      institutionHoldingsExpanded = !institutionHoldingsExpanded;
      renderInstitutionHoldingsTable(lastInstitutionHoldings, lastInstitutionHoldingsMeta);
    });
  }
  const optionsBtn = document.getElementById("institution-options-stocks-more-btn");
  if (optionsBtn) {
    optionsBtn.addEventListener("click", () => {
      institutionOptionsStocksExpanded = !institutionOptionsStocksExpanded;
      renderInstitutionOptionsStocksTable();
    });
  }

  const textDefault = (key) => (key === "ticker" || key === "issuer" ? "asc" : "desc");
  bindInstitutionTableSort(
    "data-institution-holdings-sort",
    () => institutionHoldingsSortKey,
    () => institutionHoldingsSortDir,
    (k) => {
      institutionHoldingsSortKey = k;
    },
    (d) => {
      institutionHoldingsSortDir = d;
    },
    () => "desc",
    () => renderInstitutionHoldingsTable(lastInstitutionHoldings, lastInstitutionHoldingsMeta)
  );
  bindInstitutionTableSort(
    "data-institution-adds-sort",
    () => institutionAddsSortKey,
    () => institutionAddsSortDir,
    (k) => {
      institutionAddsSortKey = k;
    },
    (d) => {
      institutionAddsSortDir = d;
    },
    textDefault,
    rerenderActivity
  );
  bindInstitutionTableSort(
    "data-institution-trims-sort",
    () => institutionTrimsSortKey,
    () => institutionTrimsSortDir,
    (k) => {
      institutionTrimsSortKey = k;
    },
    (d) => {
      institutionTrimsSortDir = d;
    },
    (key) => (key === "ticker" || key === "issuer" ? "asc" : key === "valueChangeUsd" || key === "sharesChange" ? "asc" : "desc"),
    rerenderActivity
  );
  bindInstitutionTableSort(
    "data-institution-exits-sort",
    () => institutionExitsSortKey,
    () => institutionExitsSortDir,
    (k) => {
      institutionExitsSortKey = k;
    },
    (d) => {
      institutionExitsSortDir = d;
    },
    textDefault,
    rerenderActivity
  );
  bindInstitutionTableSort(
    "data-institution-new-sort",
    () => institutionNewSortKey,
    () => institutionNewSortDir,
    (k) => {
      institutionNewSortKey = k;
    },
    (d) => {
      institutionNewSortDir = d;
    },
    textDefault,
    rerenderActivity
  );
  bindInstitutionTableSort(
    "data-institution-activity-sort",
    () => institutionActivitySortKey,
    () => institutionActivitySortDir,
    (k) => {
      institutionActivitySortKey = k;
    },
    (d) => {
      institutionActivitySortDir = d;
    },
    textDefault,
    rerenderActivity
  );
  bindInstitutionTableSort(
    "data-institution-options-sort",
    () => institutionOptionsSortKey,
    () => institutionOptionsSortDir,
    (k) => {
      institutionOptionsSortKey = k;
    },
    (d) => {
      institutionOptionsSortDir = d;
    },
    textDefault,
    () => renderInstitutionOptionsStocksTable()
  );
}

setupInstitutionActivityToggles();
setupInstitutionTabs();
setupInstitutionHub();
setupStockHub();
setupRecentlyActiveStocksPage();
setupInstitutionPerformanceRankings();
setupMostAccumulatedPage();
setupNewPositionsPage();
setupCompletelySoldPage();
setupNotableInvestorsPage();
setupInstitutionComparePage();
setupPoliticiansHub();
setupPoliticianAnalyticsPages();
setupPoliticianSectorExposurePage();
setupInsidersHub();
setupExploreNav();
setupMobileTopbarNav();
setupLanding();
setupPremiumPage();
setupFaqPage();
setupContactForm();
setupMarketPulseSidebar();
setupEntityLinkDelegation();
initChartExtensions();
setupChartFullscreen();
setupChartSettings();
setupTabs();
setupDrawer();
setupAuthLoginPanel();
setupTopSearch();
setupWatchlistSearch();
void init();
