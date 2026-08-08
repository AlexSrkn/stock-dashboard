import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getYahooFinance } from "./src/market/yahooClient.ts";
import { tryHandleStockOwnership } from "./src/api/stockOwnership.ts";
import { tryHandleOwnershipIntelligence } from "./src/api/ownershipIntelligence.ts";
import { tryHandleStockInsider } from "./src/api/stockInsider.ts";
import { tryHandleStockActivity } from "./src/api/stockActivity.ts";
import { tryHandleStockFinancials } from "./src/api/stockFinancials.ts";
import { tryHandleStockClassification } from "./src/api/stockClassification.ts";
import { tryHandleStockSignals } from "./src/api/stockSignals.ts";
import { tryHandleScreener, handleScreenerPost } from "./src/api/screener.ts";
import { tryHandleStockSearch } from "./src/api/stockSearch.ts";
import { tryHandleInstitutions } from "./src/api/institutions.ts";
import { tryHandlePoliticians } from "./src/api/politicians.ts";
import { tryHandleInsiders } from "./src/api/insiders.ts";
import { tryHandleSmartMoney } from "./src/api/smartMoney.ts";
import { tryHandleInsiderClusters } from "./src/api/insiderClusters.ts";
import { tryHandleTopInstitutionNewEntries } from "./src/api/topInstitutionNewEntries.ts";
import { tryHandleDoubleSignal } from "./src/api/doubleSignal.ts";
import { tryHandleTripleSignal } from "./src/api/tripleSignal.ts";
import { tryHandleConflictSignals } from "./src/api/conflictSignals.ts";
import { tryHandleHiddenGems } from "./src/api/hiddenGems.ts";
import { tryHandleConvictionScore } from "./src/api/convictionScore.ts";
import { tryHandleInstitutionalDiscovery } from "./src/api/institutionalDiscovery.ts";
import { tryHandleStockCompare } from "./src/api/stockCompare.ts";
import { tryHandleToolsDcf } from "./src/api/toolsDcf.ts";
import { tryHandleToolsWacc } from "./src/api/toolsWacc.ts";
import { tryHandleToolsEpv } from "./src/api/toolsEpv.ts";
import { tryHandleToolsEv } from "./src/api/toolsEv.ts";
import { tryHandleToolsPe } from "./src/api/toolsPe.ts";
import { tryHandleToolsEvEbitda } from "./src/api/toolsEvEbitda.ts";
import { tryHandleToolsFcfYield } from "./src/api/toolsFcfYield.ts";
import { tryHandleToolsSimilarStocks } from "./src/api/toolsSimilarStocks.ts";
import { tryHandleStocksHub } from "./src/api/stocksHub.ts";
import { tryHandleAnalytics } from "./src/api/analytics.ts";
import { ensureReturnsMatrixOnStartup } from "./src/institution/performance/priceCache.ts";
import { ensurePerformanceSummariesOnStartup } from "./src/institution/performance/cache.ts";
import { ensureSmartMoneyCacheOnStartup } from "./src/smartMoney/cache.ts";
import { ensureInsiderClusterCacheOnStartup } from "./src/insiderCluster/cache.ts";
import { ensureConvictionBuysCacheOnStartup } from "./src/insider/convictionBuys/cache.ts";
import { ensureRepeatBuyersCacheOnStartup } from "./src/insider/repeatBuyers/cache.ts";
import { ensureInsiderSentimentCacheOnStartup } from "./src/insider/sentiment/cache.ts";
import { ensureFirstTimeBuyersCacheOnStartup } from "./src/insider/firstTimeBuyers/cache.ts";
import { ensureHeavySellingCacheOnStartup } from "./src/insider/heavySelling/cache.ts";
import { ensureTopInstitutionNewEntriesCacheOnStartup } from "./src/signals/topInstitutionNewEntriesCache.ts";
import { ensureDoubleSignalCacheOnStartup } from "./src/signals/doubleSignal/cache.ts";
import { ensureTripleSignalCacheOnStartup } from "./src/signals/tripleSignal/cache.ts";
import { ensureConflictSignalsCacheOnStartup } from "./src/signals/conflictSignals/cache.ts";
import { ensureHiddenGemsCacheOnStartup } from "./src/signals/hiddenGems/cache.ts";
import { ensureConvictionScoreCacheOnStartup } from "./src/signals/convictionScore/cache.ts";
import { ensureInstitutionalDiscoveryCacheOnStartup } from "./src/signals/institutionalDiscovery/cache.ts";
import { ensureInstitutionalAccumulationCacheOnStartup } from "./src/stocks/institutionalAccumulationCache.ts";
import { ensureMostAccumulatedCacheOnStartup } from "./src/institution/mostAccumulated/cache.ts";
import { ensureNewPositionsCacheOnStartup } from "./src/institution/newPositions/cache.ts";
import { ensureCompletelySoldCacheOnStartup } from "./src/institution/completelySold/cache.ts";
import { ensureOwnershipChangesCacheOnStartup } from "./src/stocks/ownershipChanges/cache.ts";
import { ensureOwnershipHistoryCacheOnStartup } from "./src/stocks/ownershipHistory/cache.ts";
import { MARKET_OVERVIEW } from "./marketOverview.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8787);
const TOKEN = (process.env.FINNHUB_API_KEY || "").trim();
const AV_KEY = (process.env.ALPHAVANTAGE_API_KEY || "").trim();

/** @type {Map<string, { loadedAt: number; data: object }>} */
const fundamentalsCache = new Map();
const FUNDAMENTALS_CACHE_MS = 15 * 60 * 1000;

/** @type {Map<string, { loadedAt: number; data: object }>} */
const earningsCache = new Map();
const EARNINGS_CACHE_MS = 15 * 60 * 1000;

/** @type {{ loadedAt: number; data: object } | null} */
let earningsCalendarCache = null;
let earningsCalendarCacheAt = 0;
const EARNINGS_CALENDAR_CACHE_MS = 20 * 60 * 1000;

/** @type {{ loadedAt: number; data: object } | null} */
let marketMoversCache = null;
let marketMoversCacheAt = 0;
const MARKET_MOVERS_CACHE_MS = 5 * 60 * 1000;

/** SEC requires a descriptive User-Agent with contact info for programmatic access. */
const SEC_USER_AGENT_DEFAULT =
  "Tradepile/1.0 (set SEC_USER_AGENT in .env - see https://www.sec.gov/os/webmaster-faq#developers)";

/** HTTP headers must be visible ASCII only (Node rejects e.g. em dashes, newlines). */
function sanitizeHttpHeader(value, fallback = SEC_USER_AGENT_DEFAULT) {
  const cleaned = String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n/g, " ")
    .replace(/[^\t\x20-\x7E]/g, "")
    .trim();
  return cleaned || fallback;
}

const SEC_USER_AGENT = sanitizeHttpHeader(process.env.SEC_USER_AGENT);

/** @type {{ loadedAt: number; map: Map<string, number> } | null} */
let tickerCache = null;
const TICKER_CACHE_MS = 6 * 60 * 60 * 1000;

function secGet(host, path) {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://${host}${path}`,
        {
          headers: {
            "User-Agent": SEC_USER_AGENT,
            Accept: "application/json,text/plain,*/*",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode !== 200) {
              reject(new Error(`SEC HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
              return;
            }
            resolve(body);
          });
        }
      )
      .on("error", reject);
  });
}

async function getTickerToCikMap() {
  const now = Date.now();
  if (tickerCache && now - tickerCache.loadedAt < TICKER_CACHE_MS) {
    return tickerCache.map;
  }
  const raw = await secGet("www.sec.gov", "/files/company_tickers.json");
  const data = JSON.parse(raw);
  const map = new Map();
  for (const row of Object.values(data)) {
    if (row && row.ticker != null && row.cik_str != null) {
      map.set(String(row.ticker).toUpperCase(), Number(row.cik_str));
    }
  }
  tickerCache = { loadedAt: now, map };
  return map;
}

function edgarDocumentUrl(cikNum, accessionNumber, primaryDocument) {
  const cikPart = String(Number(cikNum));
  const accFlat = String(accessionNumber).replace(/-/g, "");
  const doc = String(primaryDocument || "").trim();
  if (!doc) {
    const enc = new URLSearchParams({
      action: "view",
      cik: cikPart,
      accession_number: String(accessionNumber),
    });
    return `https://www.sec.gov/cgi-bin/viewer?${enc}`;
  }
  const docPath = doc
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://www.sec.gov/Archives/edgar/data/${cikPart}/${accFlat}/${docPath}`;
}

function parseRecentFilings(sub, limit, cikNumeric) {
  const recent = sub?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const cikForUrl = cikNumeric != null ? cikNumeric : Number(sub.cik || sub.cik_str || 0);
  const n = recent.form.length;
  const cap = Math.min(limit, n);
  const out = [];
  for (let i = 0; i < cap; i++) {
    const accessionNumber = recent.accessionNumber?.[i];
    const primaryDocument = recent.primaryDocument?.[i] || "";
    const href =
      accessionNumber != null && cikForUrl
        ? edgarDocumentUrl(cikForUrl, accessionNumber, primaryDocument)
        : "";
    out.push({
      form: recent.form[i] ?? "",
      filingDate: recent.filingDate?.[i] ?? "",
      accessionNumber: accessionNumber ?? "",
      primaryDocument,
      description: recent.primaryDocDescription?.[i] ?? "",
      href,
    });
  }
  return out;
}

async function buildSecFilingsResponse(symbol, limit) {
  const sym = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!sym) {
    const err = new Error("Missing symbol");
    err.statusCode = 400;
    throw err;
  }
  const map = await getTickerToCikMap();
  const cikNum = map.get(sym);
  if (cikNum == null) {
    const err = new Error(`Unknown ticker for SEC mapping: ${sym}`);
    err.statusCode = 404;
    throw err;
  }
  const cik10 = String(cikNum).padStart(10, "0");
  const raw = await secGet("data.sec.gov", `/submissions/CIK${cik10}.json`);
  const sub = JSON.parse(raw);
  const filings = parseRecentFilings(sub, limit, cikNum);
  return {
    ticker: sym,
    cik: cik10,
    entityName: sub.name || "",
    filings,
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function finnhubGet(finPath, queryParams = {}) {
  return new Promise((resolve, reject) => {
    if (!TOKEN) {
      reject(new Error("FINNHUB_API_KEY is not set"));
      return;
    }
    const q = new URLSearchParams(queryParams);
    q.set("token", TOKEN);
    const finUrl = `https://finnhub.io/api/v1${finPath}?${q}`;
    https
      .get(
        finUrl,
        { headers: { "User-Agent": "tradepile-local/1.0", Accept: "application/json" } },
        (finRes) => {
          const chunks = [];
          finRes.on("data", (c) => chunks.push(c));
          finRes.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if ((finRes.statusCode || 0) < 200 || (finRes.statusCode || 0) >= 300) {
              reject(new Error(`Finnhub HTTP ${finRes.statusCode}: ${body.slice(0, 200)}`));
              return;
            }
            try {
              resolve(body ? JSON.parse(body) : {});
            } catch (err) {
              reject(err);
            }
          });
        }
      )
      .on("error", reject);
  });
}

/** Finnhub /search — avoids /stock/symbol which redirects (HTTP 302) to a signed CDN URL. */
async function searchFinnhubSymbols(query, limit) {
  const q = String(query || "").trim();
  if (!q) return [];
  const raw = await finnhubGet("/search", { q });
  const rows = Array.isArray(raw.result) ? raw.result : [];
  const cap = Math.min(50, Math.max(1, limit || 25));
  return rows
    .filter((row) => row && row.symbol)
    .filter((row) => {
      const t = String(row.type || "").toLowerCase();
      return !t || t.includes("common stock") || t === "equity";
    })
    .slice(0, cap)
    .map((row) => ({
      symbol: String(row.symbol).toUpperCase(),
      description: String(row.description || row.displaySymbol || row.symbol),
      type: String(row.type || ""),
    }));
}

const YAHOO_UA = "Mozilla/5.0 (compatible; Tradepile/1.0; +https://localhost)";

const yahooFinance = getYahooFinance();

function yahooRequest(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": YAHOO_UA, Accept: "application/json" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            reject(new Error(`Yahoo HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function yahooNum(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && "raw" in value) {
    const raw = value.raw;
    return raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function yahooRatio(numerator, denominator) {
  const num = yahooNum(numerator);
  const den = yahooNum(denominator);
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

async function fetchYahooFundamentals(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) {
    const err = new Error("Missing symbol");
    err.statusCode = 400;
    throw err;
  }

  const cacheKey = `yahoo:v3:${sym}`;
  const cached = fundamentalsCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < FUNDAMENTALS_CACHE_MS) {
    return cached.data;
  }

  const data = await yahooFinance.quoteSummary(sym, {
    modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents"],
  });

  const summary = data.summaryDetail || {};
  const stats = data.defaultKeyStatistics || {};
  const fin = data.financialData || {};
  const price = data.price || {};
  const currency = price.currency || summary.currency || "USD";

  const revenueTtm = yahooNum(fin.totalRevenue);
  const grossProfits = yahooNum(fin.grossProfits);
  const freeCashflow = yahooNum(fin.freeCashflow);
  const totalCash = yahooNum(fin.totalCash);
  const totalDebt = yahooNum(fin.totalDebt);
  const currentPrice =
    yahooNum(price.regularMarketPrice) ??
    yahooNum(summary.regularMarketPrice) ??
    yahooNum(summary.previousClose);
  const volume = yahooNum(summary.volume) ?? yahooNum(price.regularMarketVolume);
  const averageVolume = yahooNum(summary.averageVolume) ?? yahooNum(summary.averageVolume10days);
  const fiftyTwoWeekHigh = yahooNum(summary.fiftyTwoWeekHigh);
  const fiftyTwoWeekLow = yahooNum(summary.fiftyTwoWeekLow);
  const dayLow =
    yahooNum(price.regularMarketDayLow) ?? yahooNum(summary.regularMarketDayLow);
  const dayHigh =
    yahooNum(price.regularMarketDayHigh) ?? yahooNum(summary.regularMarketDayHigh);
  const nextEarnings = parseNextEarningsDate(data?.calendarEvents);
  const exDividendRaw = summary.exDividendDate;
  const exDividendDate =
    exDividendRaw instanceof Date && Number.isFinite(exDividendRaw.getTime())
      ? exDividendRaw.toISOString()
      : exDividendRaw
        ? new Date(exDividendRaw).toISOString()
        : null;
  const sharesOutstanding =
    yahooNum(stats.sharesOutstanding) ??
    yahooNum(price.sharesOutstanding) ??
    yahooNum(stats.impliedSharesOutstanding);
  const floatShares = yahooNum(stats.floatShares) ?? yahooNum(summary.floatShares);
  const institutionalHeld = yahooNum(stats.heldPercentInstitutions);
  const insiderHeld = yahooNum(stats.heldPercentInsiders);
  const sharesShort = yahooNum(stats.sharesShort);
  const enterpriseValue = yahooNum(stats.enterpriseValue) ?? yahooNum(summary.enterpriseValue);
  const netIncomeTtm = yahooNum(stats.netIncomeToCommon) ?? yahooNum(fin.netIncomeToCommon);
  const dilutedEps =
    yahooNum(stats.trailingEps) ??
    (netIncomeTtm != null && sharesOutstanding != null && sharesOutstanding !== 0
      ? netIncomeTtm / sharesOutstanding
      : null);
  const enterpriseToRevenue =
    yahooNum(stats.enterpriseToRevenue) ?? yahooRatio(enterpriseValue, revenueTtm);

  const payload = {
    symbol: sym,
    currency,
    price: currentPrice,
    pe: yahooNum(summary.trailingPE) ?? yahooNum(stats.trailingPE),
    forwardPe: yahooNum(summary.forwardPE) ?? yahooNum(stats.forwardPE),
    peg: yahooNum(stats.pegRatio),
    marketCap: yahooNum(price.marketCap) ?? yahooNum(summary.marketCap) ?? yahooNum(stats.marketCap),
    enterpriseValue,
    priceToSales:
      yahooNum(summary.priceToSalesTrailing12Months) ??
      yahooNum(stats.priceToSalesTrailing12Months) ??
      yahooNum(stats.priceToSales),
    enterpriseToRevenue,
    enterpriseToEbitda: yahooNum(stats.enterpriseToEbitda) ?? yahooNum(fin.enterpriseToEbitda),
    dilutedEps,
    trailingEps: dilutedEps,
    ebitda: yahooNum(fin.ebitda),
    revenueGrowth: yahooNum(fin.revenueGrowth),
    earningsGrowth: yahooNum(fin.earningsGrowth),
    revenueTtm,
    netIncomeTtm,
    grossMargin: yahooRatio(grossProfits, revenueTtm) ?? yahooNum(fin.grossMargins),
    operatingMargin: yahooNum(fin.operatingMargins),
    netMargin: yahooNum(fin.profitMargins) ?? yahooNum(stats.profitMargins),
    returnOnEquity: yahooNum(fin.returnOnEquity),
    returnOnAssets: yahooNum(fin.returnOnAssets),
    fcfMargin: yahooRatio(freeCashflow, revenueTtm),
    totalCash,
    totalDebt,
    netCashDebt: totalCash != null && totalDebt != null ? totalCash - totalDebt : null,
    currentRatio: yahooNum(fin.currentRatio),
    freeCashflow,
    debtToEquity: yahooNum(fin.debtToEquity),
    beta: yahooNum(summary.beta) ?? yahooNum(stats.beta),
    volume,
    averageVolume,
    relativeVolume: yahooRatio(volume, averageVolume),
    dayLow,
    dayHigh,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    nextEarningsDate: nextEarnings?.dateLabel ?? null,
    nextEarningsDateLabel: nextEarnings?.label ?? null,
    exDividendDate: Number.isFinite(new Date(exDividendDate).getTime()) ? exDividendDate : null,
    distFrom52WeekHigh:
      currentPrice != null && fiftyTwoWeekHigh != null && fiftyTwoWeekHigh !== 0
        ? ((currentPrice - fiftyTwoWeekHigh) / fiftyTwoWeekHigh) * 100
        : null,
    distFrom52WeekLow:
      currentPrice != null && fiftyTwoWeekLow != null && fiftyTwoWeekLow !== 0
        ? ((currentPrice - fiftyTwoWeekLow) / fiftyTwoWeekLow) * 100
        : null,
    sharesOutstanding,
    floatShares,
    institutionalOwnership: institutionalHeld,
    insiderOwnership: insiderHeld,
    sharesShort,
    shortPercentFloat: yahooNum(stats.shortPercentOfFloat),
    shortRatio: yahooNum(stats.shortRatio),
    impliedSharesOutstanding: yahooNum(stats.impliedSharesOutstanding),
  };

  const hasData = [
    "pe",
    "marketCap",
    "enterpriseValue",
    "priceToSales",
    "priceToBook",
    "enterpriseToEbitda",
    "ebitda",
    "beta",
    "floatShares",
  ].some((k) => payload[k] != null);
  if (!hasData) {
    throw new Error("No fundamental data from Yahoo Finance for this symbol.");
  }

  fundamentalsCache.set(cacheKey, { loadedAt: Date.now(), data: payload });
  return payload;
}

function formatEarningsQuarterLabel(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatEarningsEventDate(startValue, endValue) {
  const start = startValue instanceof Date ? startValue : new Date(startValue);
  const end = endValue instanceof Date ? endValue : new Date(endValue);
  if (!Number.isFinite(start.getTime())) return "—";
  const endDate = Number.isFinite(end.getTime()) ? end : start;
  const startKey = start.toISOString().slice(0, 10);
  const endKey = endDate.toISOString().slice(0, 10);
  if (startKey === endKey) {
    return start.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const startStr = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endStr = endDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startStr} – ${endStr}`;
}

function parseNextEarningsDate(calendarEvents) {
  const earnings = calendarEvents?.earnings;
  if (!earnings || typeof earnings !== "object") return null;

  const dates = (Array.isArray(earnings.earningsDate) ? earnings.earningsDate : [])
    .map((value) => new Date(value))
    .filter((d) => Number.isFinite(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (!dates.length) return null;

  const start = dates[0];
  const end = dates[dates.length - 1];
  const isEstimate = Boolean(earnings.isEarningsDateEstimate);

  return {
    label: isEstimate ? "Earnings Date (est.)" : "Earnings Date",
    isEstimate,
    start: start.toISOString(),
    end: end.toISOString(),
    dateLabel: formatEarningsEventDate(start, end),
    epsEstimate: yahooNum(earnings.earningsAverage),
    epsLow: yahooNum(earnings.earningsLow),
    epsHigh: yahooNum(earnings.earningsHigh),
  };
}

async function fetchYahooEarningsHistory(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) {
    const err = new Error("Missing symbol");
    err.statusCode = 400;
    throw err;
  }

  const cacheKey = `earnings:${sym}`;
  const cached = earningsCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < EARNINGS_CACHE_MS) {
    return cached.data;
  }

  const data = await yahooFinance.quoteSummary(
    sym,
    { modules: ["earningsHistory", "calendarEvents"] },
    { validateResult: false }
  );

  const history = Array.isArray(data?.earningsHistory?.history) ? data.earningsHistory.history : [];
  const quarters = history
    .filter((row) => row?.quarter)
    .sort((a, b) => new Date(a.quarter).getTime() - new Date(b.quarter).getTime())
    .slice(-4)
    .map((row) => ({
      quarter: row.quarter,
      quarterLabel: formatEarningsQuarterLabel(row.quarter),
      currency: row.currency || "USD",
      epsEstimate: yahooNum(row.epsEstimate),
      epsActual: yahooNum(row.epsActual),
      epsDifference: yahooNum(row.epsDifference),
      surprisePercent: yahooNum(row.surprisePercent),
    }));

  const nextEarnings = parseNextEarningsDate(data?.calendarEvents);

  const payload = {
    symbol: sym,
    currency: quarters[0]?.currency || "USD",
    quarters,
    nextEarnings,
  };

  if (quarters.length || nextEarnings) {
    earningsCache.set(cacheKey, { loadedAt: Date.now(), data: payload });
  }

  return payload;
}

async function fetchYahooNextEarnings(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return { symbol: sym, error: true };

  const cacheKey = `earnings:${sym}`;
  const cached = earningsCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < EARNINGS_CACHE_MS && cached.data?.nextEarnings) {
    return { symbol: sym, ...cached.data.nextEarnings };
  }

  try {
    const data = await yahooFinance.quoteSummary(
      sym,
      { modules: ["calendarEvents"] },
      { validateResult: false }
    );
    const next = parseNextEarningsDate(data?.calendarEvents);
    if (!next) return { symbol: sym };

    if (cached?.data) {
      cached.data.nextEarnings = next;
    }

    return { symbol: sym, ...next };
  } catch {
    return { symbol: sym, error: true };
  }
}

async function fetchWatchlistUpcomingEarnings(symbols) {
  const unique = [
    ...new Set(
      (Array.isArray(symbols) ? symbols : String(symbols || "").split(","))
        .map((s) => String(s || "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  if (!unique.length) return { events: [] };

  const rows = await mapPool(
    unique,
    async (sym) => {
      const row = await fetchYahooNextEarnings(sym);
      if (!row?.start || row.error) return null;
      return row;
    },
    3
  );

  const events = rows
    .filter(Boolean)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return { events };
}

const YAHOO_EARNINGS_CALENDAR_FIELDS = [
  "ticker",
  "companyshortname",
  "startdatetime",
  "epsestimate",
  "epsactual",
  "epssurprisepct",
  "dateIsEstimate",
  "fiscalYear",
  "quarter",
  "startDateTimeType",
].join(",");

function easternDateKey(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function utcDayStartSec(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

async function enrichEarningsEventsWithMarketCap(events) {
  const symbols = [...new Set(events.map((e) => e.symbol).filter(Boolean))];
  if (!symbols.length) return events;

  const quoteBySymbol = new Map();
  const chunkSize = 40;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    try {
      const quoteObj = await yahooFinance.quote(
        chunk,
        { return: "object", fields: ["symbol", "marketCap", "shortName", "longName"] },
        { validateResult: false }
      );
      for (const sym of chunk) {
        const q = findMarketQuote(quoteObj, sym);
        quoteBySymbol.set(sym, q);
      }
    } catch {
      /* keep events without enrichment */
    }
  }

  return events.map((event) => {
    const q = quoteBySymbol.get(event.symbol);
    const quoteName = String(q?.shortName || q?.longName || "").trim();
    const currentName = String(event.name || "").trim();
    const resolvedName =
      currentName && currentName.toUpperCase() !== event.symbol.toUpperCase()
        ? currentName
        : quoteName || currentName || event.symbol;
    return {
      ...event,
      name: resolvedName,
      marketCap: yahooNum(q?.marketCap) ?? event.marketCap ?? null,
    };
  });
}

async function fetchYahooEarningsCalendar(days = 14) {
  const span = Math.min(62, Math.max(1, Number(days) || 14));
  if (
    earningsCalendarCache &&
    earningsCalendarCache.days === span &&
    Date.now() - earningsCalendarCacheAt < EARNINGS_CALENDAR_CACHE_MS
  ) {
    return earningsCalendarCache.data;
  }

  const period1 = utcDayStartSec(new Date());
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + span);
  const period2 = utcDayStartSec(end);
  const url =
    `https://query2.finance.yahoo.com/ws/screeners/v1/finance/calendar-events` +
    `?period1=${period1}&period2=${period2}&entityIdType=earnings` +
    `&includeFields=${encodeURIComponent(YAHOO_EARNINGS_CALENDAR_FIELDS)}`;

  const data = await yahooRequest(url);
  const buckets = Array.isArray(data?.finance?.result?.earnings) ? data.finance.result.earnings : [];
  const todayKey = easternDateKey();
  let todayTotalCount = 0;

  const events = [];
  for (const bucket of buckets) {
    const dateKey = String(bucket.timestampString || "");
    if (!dateKey) continue;
    if (dateKey === todayKey) {
      todayTotalCount = Number(bucket.totalCount) || bucket.records?.length || 0;
    }
    if (dateKey < todayKey) continue;

    for (const row of bucket.records || []) {
      const symbol = String(row.ticker || "").trim();
      if (!symbol) continue;
      const epsActual = yahooNum(row.epsActual);
      const reported = epsActual != null;
      events.push({
        symbol,
        name: String(row.companyShortName || row.companyshortname || symbol).trim(),
        dateKey,
        start: row.startDateTime ? new Date(row.startDateTime).toISOString() : null,
        epsEstimate: yahooNum(row.epsEstimate),
        epsActual,
        surprisePercent: yahooNum(row.surprisePercent),
        isEstimate: Boolean(row.dateIsEstimate),
        timing: row.startDateTimeType || null,
        quarter: row.quarter || null,
        fiscalYear: row.fiscalYear || null,
        reported,
      });
    }
  }

  events.sort((a, b) => {
    const byDate = a.dateKey.localeCompare(b.dateKey);
    if (byDate !== 0) return byDate;
    if (a.reported !== b.reported) return a.reported ? -1 : 1;
    return (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.name.localeCompare(b.name);
  });

  const enrichedEvents = await enrichEarningsEventsWithMarketCap(events);
  enrichedEvents.sort((a, b) => {
    const byDate = a.dateKey.localeCompare(b.dateKey);
    if (byDate !== 0) return byDate;
    if (a.reported !== b.reported) return a.reported ? -1 : 1;
    return (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.name.localeCompare(b.name);
  });

  const payload = {
    todayKey,
    todayTotalCount,
    days: span,
    events: enrichedEvents,
    source: "Yahoo Finance",
  };

  earningsCalendarCache = { days: span, data: payload };
  earningsCalendarCacheAt = Date.now();
  return payload;
}

function mapScreenerQuote(row) {
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    name: String(row.shortName || row.longName || symbol).trim(),
    price: yahooNum(row.regularMarketPrice),
    changePct: yahooNum(row.regularMarketChangePercent),
    volume: yahooNum(row.regularMarketVolume),
    currency: row.currency || "USD",
  };
}

async function fetchYahooScreenerList(scrId, count = 15) {
  const cap = Math.min(25, Math.max(1, Number(count) || 15));
  const data = await yahooFinance.screener(scrId, { count: cap }, { validateResult: false });
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  return quotes.map(mapScreenerQuote).filter(Boolean);
}

async function fetchYahooMarketMovers(count = 15) {
  const cap = Math.min(25, Math.max(1, Number(count) || 15));
  if (marketMoversCache && Date.now() - marketMoversCacheAt < MARKET_MOVERS_CACHE_MS) {
    return marketMoversCache.data;
  }

  const [gainers, losers, volume] = await Promise.all([
    fetchYahooScreenerList("day_gainers", cap),
    fetchYahooScreenerList("day_losers", cap),
    fetchYahooScreenerList("most_actives", cap),
  ]);

  const payload = {
    gainers,
    losers,
    volume,
    count: cap,
    source: "Yahoo Finance",
  };

  marketMoversCache = { data: payload };
  marketMoversCacheAt = Date.now();
  return payload;
}

/** Yahoo Finance chart ranges with adaptive intervals. */
function yahooChartParams(range) {
  switch (String(range || "1D").toUpperCase()) {
    case "5D":
      return { range: "5d", interval: "15m" };
    case "1M":
      return { range: "1mo", interval: "1h" };
    case "3M":
      return { range: "3mo", interval: "1d" };
    case "6M":
      return { range: "6mo", interval: "1d" };
    case "YTD":
      return { range: "ytd", interval: "1d" };
    case "1Y":
      return { range: "1y", interval: "1d" };
    case "5Y":
      return { range: "5y", interval: "1wk" };
    case "MAX":
      return { range: "max", interval: "1mo" };
    default:
      // Yahoo often returns an empty payload for range=1d&interval=5m (esp. off-hours).
      // Request 2d and trim to the latest session in fetchYahooChart.
      return { range: "2d", interval: "5m" };
  }
}

/**
 * Keep bars from the most recent regular session (after the last overnight gap).
 * Used when we fetch a longer Yahoo range to populate the 1D chart.
 */
function trimBarsToLastSession(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return bars || [];
  const GAP_SEC = 6 * 3600;
  let cut = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = Number(bars[i - 1]?.t);
    const cur = Number(bars[i]?.t);
    if (Number.isFinite(prev) && Number.isFinite(cur) && cur - prev >= GAP_SEC) {
      cut = i;
    }
  }
  return bars.slice(cut);
}

function rebuildChartSeriesFromBars(bars) {
  const timestamp = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  const volume = [];
  for (const b of bars) {
    timestamp.push(b.t);
    open.push(b.o);
    high.push(b.h);
    low.push(b.l);
    close.push(b.c);
    volume.push(b.v);
  }
  return { timestamp, open, high, low, close, volume, bars };
}

/** Fallback Yahoo range/interval pairs when the primary request yields no OHLC bars. */
function yahooChartFallbackParams(uiRange, attempted) {
  const key = String(uiRange || "1D").toUpperCase();
  const tried = new Set(
    (attempted || []).map((p) => `${p.range}|${p.interval}`)
  );
  const candidates =
    key === "1D"
      ? [
          { range: "2d", interval: "5m" },
          { range: "5d", interval: "5m" },
          { range: "5d", interval: "15m" },
          { range: "1mo", interval: "5m" },
        ]
      : key === "5D"
        ? [
            { range: "5d", interval: "15m" },
            { range: "10d", interval: "15m" },
            { range: "1mo", interval: "1h" },
          ]
        : [
            { range: "1mo", interval: "1d" },
            { range: "3mo", interval: "1d" },
            { range: "1y", interval: "1d" },
          ];
  return candidates.filter((p) => !tried.has(`${p.range}|${p.interval}`));
}


/**
 * Longer Yahoo range for MA warmup (same interval as the visible chart).
 * Keeps display range unchanged while supplying pre-window history for SMA calc.
 */
function yahooChartMaHistoryParams(range) {
  const { interval } = yahooChartParams(range);
  const key = String(range || "1D").toUpperCase();
  const extendedRangeByUi = {
    "1D": "1mo",
    "5D": "3mo",
    "1M": "1y",
    "3M": "2y",
    "6M": "2y",
    YTD: "2y",
    "1Y": "3y",
    "5Y": "max",
    MAX: "max",
  };
  return { range: extendedRangeByUi[key] || "2y", interval };
}

function parseYahooChartData(result) {
  const ts = result?.timestamp;
  const q = result?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) {
    return {
      timestamp: [],
      open: [],
      high: [],
      low: [],
      close: [],
      volume: [],
      bars: [],
    };
  }
  const timestamp = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  const volume = [];
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i];
    if (t == null || o == null || h == null || l == null || c == null) continue;
    timestamp.push(t);
    open.push(Number(o));
    high.push(Number(h));
    low.push(Number(l));
    close.push(Number(c));
    volume.push(v != null && Number.isFinite(Number(v)) ? Number(v) : 0);
    bars.push({ t, o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: volume[volume.length - 1] });
  }
  return { timestamp, open, high, low, close, volume, bars };
}

/** Short ranges use Yahoo meta chartPreviousClose; longer ranges use first→last close. */
function computeRangeChangePct(uiRange, meta, bars) {
  const key = String(uiRange || "1D").toUpperCase();
  const lastClose = bars.length ? bars[bars.length - 1].c : null;
  const price = Number(meta.regularMarketPrice ?? lastClose);

  if (key === "1D") {
    const base = Number(meta.chartPreviousClose ?? meta.previousClose);
    if (Number.isFinite(base) && base !== 0 && Number.isFinite(price)) {
      return ((price - base) / base) * 100;
    }
  }

  const first = bars.length ? bars[0].c : null;
  if (Number.isFinite(first) && first !== 0 && Number.isFinite(lastClose)) {
    return ((lastClose - first) / first) * 100;
  }
  return 0;
}

let marketOverviewCache = null;
let marketOverviewCacheAt = 0;
const MARKET_OVERVIEW_CACHE_MS = 30_000;

function findMarketQuote(quoteObj, requestSymbol) {
  if (!quoteObj || typeof quoteObj !== "object") return null;
  if (quoteObj[requestSymbol]) return quoteObj[requestSymbol];
  const upper = String(requestSymbol).toUpperCase();
  if (quoteObj[upper]) return quoteObj[upper];
  for (const row of Object.values(quoteObj)) {
    if (!row || typeof row !== "object") continue;
    const sym = String(row.symbol || "");
    if (sym === requestSymbol || sym.toUpperCase() === upper) return row;
  }
  return null;
}

function downsampleSparkline(values, maxPoints = 48) {
  if (!values?.length) return [];
  if (values.length <= maxPoints) return values;
  const out = [];
  const step = (values.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(values[Math.round(i * step)]);
  }
  return out;
}

async function mapPool(items, mapper, concurrency = 3) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

async function fetchMarketSparkline(symbol) {
  try {
    const sym = encodeURIComponent(String(symbol || "").trim());
    if (!sym) return [];
    // Yahoo's range=1d&interval=5m often returns an empty series; 2d is reliable.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=2d&interval=5m&includePrePost=false`;
    const data = await yahooRequest(url);
    const result = data?.chart?.result?.[0];
    const parsed = parseYahooChartData(result);
    const sessionBars = trimBarsToLastSession(parsed.bars);
    const values = (sessionBars.length ? sessionBars : parsed.bars).map((b) => Number(b.c)).filter((c) =>
      Number.isFinite(c)
    );
    return downsampleSparkline(values);
  } catch {
    return [];
  }
}

async function fetchMarketOverviewQuotes() {
  if (marketOverviewCache && Date.now() - marketOverviewCacheAt < MARKET_OVERVIEW_CACHE_MS) {
    return marketOverviewCache;
  }

  const symbols = MARKET_OVERVIEW.map((item) => item.symbol);
  const quoteObj = await yahooFinance.quote(
    symbols,
    {
      return: "object",
      fields: ["symbol", "regularMarketPrice", "regularMarketChangePercent", "currency"],
    },
    { validateResult: false }
  );

  const sparklines = await mapPool(
    MARKET_OVERVIEW,
    (item) => fetchMarketSparkline(item.symbol),
    3
  );

  const markets = MARKET_OVERVIEW.map((item, i) => {
    const q = findMarketQuote(quoteObj, item.symbol);
    const sparkline = Array.isArray(sparklines[i]) ? sparklines[i] : [];

    if (!q) {
      return {
        label: item.label,
        shortLabel: item.shortLabel,
        symbol: item.symbol,
        requestSymbol: item.symbol,
        sparkline,
        error: true,
      };
    }
    const price = yahooNum(q.regularMarketPrice);
    const changePct = yahooNum(q.regularMarketChangePercent);
    return {
      label: item.label,
      shortLabel: item.shortLabel,
      symbol: item.symbol,
      requestSymbol: item.symbol,
      price,
      changePct: changePct ?? 0,
      currency: q.currency || "USD",
      sparkline,
      error: price == null,
    };
  });

  const hasSparkData = markets.some((m) => m.sparkline?.length >= 2);
  if (hasSparkData) {
    marketOverviewCache = markets;
    marketOverviewCacheAt = Date.now();
  }
  return markets;
}

async function fetchYahooChart(symbol, range, options = {}) {
  const sym = encodeURIComponent(String(symbol || "").trim());
  if (!sym) {
    const err = new Error("Missing symbol");
    err.statusCode = 400;
    throw err;
  }
  const uiRange = String(range || "1D").toUpperCase();
  const primary = options.maHistory
    ? yahooChartMaHistoryParams(range)
    : yahooChartParams(range);

  const attempted = [];
  let lastMeta = {};
  let parsed = {
    timestamp: [],
    open: [],
    high: [],
    low: [],
    close: [],
    volume: [],
    bars: [],
  };
  let used = primary;

  const tryParams = [primary, ...yahooChartFallbackParams(uiRange, [primary])];
  for (const params of tryParams) {
    attempted.push(params);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${params.range}&interval=${params.interval}&includePrePost=false`;
    const data = await yahooRequest(url);
    const result = data?.chart?.result?.[0];
    if (!result) continue;
    lastMeta = result.meta || {};
    parsed = parseYahooChartData(result);
    used = params;
    if (parsed.bars.length) break;
  }

  let { timestamp, open, high, low, close, volume, bars } = parsed;

  // 1D display should show the latest session only (we may have fetched 2d/5d).
  if (!options.maHistory && uiRange === "1D" && bars.length) {
    const session = trimBarsToLastSession(bars);
    if (session.length) {
      ({ timestamp, open, high, low, close, volume, bars } = rebuildChartSeriesFromBars(session));
    }
  }

  if (!bars.length) throw new Error("No OHLC bars in Yahoo response");
  const meta = lastMeta;
  const rangeChangePct = options.maHistory ? null : computeRangeChangePct(uiRange, meta, bars);
  return {
    symbol: meta.symbol || decodeURIComponent(sym),
    currency: meta.currency || "USD",
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    interval: used.interval,
    range: used.range,
    uiRange,
    rangeChangePct,
    maHistory: Boolean(options.maHistory),
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    bars,
  };
}

async function searchYahooSymbols(query, limit) {
  const q = String(query || "").trim();
  if (!q) return [];
  const cap = Math.min(50, Math.max(1, limit || 25));
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${cap}&newsCount=0`;
  const data = await yahooRequest(url);
  const quotes = Array.isArray(data.quotes) ? data.quotes : [];
  const allowed = new Set(["EQUITY", "ETF", "MUTUALFUND", "INDEX", "CURRENCY"]);
  return quotes
    .filter((row) => row?.symbol && allowed.has(String(row.quoteType || "")))
    .slice(0, cap)
    .map((row) => ({
      symbol: String(row.symbol),
      description: String(row.longname || row.shortname || row.symbol),
      exchange: String(row.exchDisp || row.exchange || ""),
      type: String(row.quoteType || ""),
    }));
}

function toAlphaVantageSymbol(symbol) {
  let s = String(symbol || "")
    .trim()
    .toUpperCase();
  if (!s) return s;
  if (s.includes(".")) s = s.split(".")[0];
  return s.replace(/-/g, ".");
}

function alphaVantageGet(params) {
  return new Promise((resolve, reject) => {
    if (!AV_KEY) {
      reject(new Error("ALPHAVANTAGE_API_KEY is not set in .env"));
      return;
    }
    const q = new URLSearchParams({ ...params, apikey: AV_KEY });
    const url = `https://www.alphavantage.co/query?${q}`;
    https
      .get(url, { headers: { "User-Agent": "tradepile-local/1.0", Accept: "application/json" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            reject(new Error(`Alpha Vantage HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function formatOverviewField(raw) {
  if (raw == null || raw === "" || raw === "None" || raw === "-") return null;
  return raw;
}

async function fetchAlphaVantageFundamentals(symbol) {
  const sym = toAlphaVantageSymbol(symbol);
  if (!sym) {
    const err = new Error("Missing symbol");
    err.statusCode = 400;
    throw err;
  }

  const cacheKey = sym;
  const cached = fundamentalsCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < FUNDAMENTALS_CACHE_MS) {
    return cached.data;
  }

  const raw = await alphaVantageGet({ function: "OVERVIEW", symbol: sym });
  if (raw.Note || raw.Information) {
    throw new Error(String(raw.Note || raw.Information));
  }
  if (!raw.Symbol) {
    throw new Error(
      "No company overview from Alpha Vantage (US ticker required, or API rate limit)."
    );
  }

  const shortPct = formatOverviewField(raw.ShortPercentFloat);
  const sharesShort = formatOverviewField(raw.SharesShort);
  let shortInterest = null;
  if (shortPct != null) shortInterest = shortPct;
  else if (sharesShort != null) shortInterest = sharesShort;

  const payload = {
    symbol: String(raw.Symbol),
    requestedSymbol: String(symbol || "").trim(),
    marketCap: formatOverviewField(raw.MarketCapitalization),
    pe: formatOverviewField(raw.PERatio),
    revenueGrowth:
      formatOverviewField(raw.QuarterlyRevenueGrowthYOY) ||
      formatOverviewField(raw.QuarterlyEarningsGrowthYOY),
    institutionalOwnership: formatOverviewField(raw.PercentInstitutions),
    insiderOwnership: formatOverviewField(raw.PercentInsiders),
    shortInterest,
    shortPercentFloat: shortPct,
    sharesShort,
    float: formatOverviewField(raw.SharesFloat),
    sector: formatOverviewField(raw.Sector),
    industry: formatOverviewField(raw.Industry),
  };

  fundamentalsCache.set(cacheKey, { loadedAt: Date.now(), data: payload });
  return payload;
}

function finnhubProxy(clientReq, clientRes, finPath) {
  if (!TOKEN) {
    clientRes.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    clientRes.end(
      JSON.stringify({
        error: "missing_token",
        message: "Set FINNHUB_API_KEY in the environment and restart the server.",
      })
    );
    return;
  }

  const u = new URL(clientReq.url, "http://127.0.0.1");
  const q = new URLSearchParams(u.search);
  q.set("token", TOKEN);
  const finUrl = `https://finnhub.io/api/v1${finPath}?${q}`;

  https
    .get(
      finUrl,
      { headers: { "User-Agent": "tradepile-local/1.0", Accept: "application/json" } },
      (finRes) => {
        const headers = {
          "Content-Type": finRes.headers["content-type"] || "application/json; charset=utf-8",
          "Cache-Control": "private, max-age=15",
        };
        clientRes.writeHead(finRes.statusCode || 502, headers);
        finRes.pipe(clientRes);
      }
    )
    .on("error", (err) => {
      clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      clientRes.end(JSON.stringify({ error: "proxy_error", message: String(err.message) }));
    });
}

function sendFile(clientRes, absPath) {
  fs.readFile(absPath, (err, buf) => {
    if (err) {
      clientRes.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      clientRes.end("Not found");
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    clientRes.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    clientRes.end(buf);
  });
}

http
  .createServer((req, clientRes) => {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (u.pathname.startsWith("/finnhub/v1")) {
      const finPath = u.pathname.slice("/finnhub/v1".length) || "/";
      return finnhubProxy(req, clientRes, finPath);
    }

    if (u.pathname === "/api/screener" && req.method === "POST") {
      void handleScreenerPost(req, clientRes);
      return;
    }

    if (u.pathname === "/api/tools/dcf/calculate" && req.method === "POST") {
      void tryHandleToolsDcf(u, req, clientRes);
      return;
    }

    if (u.pathname === "/api/tools/wacc/calculate" && req.method === "POST") {
      void tryHandleToolsWacc(u, req, clientRes);
      return;
    }

    if (u.pathname === "/api/tools/epv/calculate" && req.method === "POST") {
      void tryHandleToolsEpv(u, req, clientRes);
      return;
    }

    if (u.pathname === "/api/tools/ev/calculate" && req.method === "POST") {
      void tryHandleToolsEv(u, req, clientRes);
      return;
    }

    if (u.pathname === "/api/tools/pe/calculate" && req.method === "POST") {
      void tryHandleToolsPe(u, req, clientRes);
      return;
    }

    if (u.pathname === "/api/tools/ev-ebitda/calculate" && req.method === "POST") {
      void tryHandleToolsEvEbitda(u, req, clientRes);
      return;
    }

    if (u.pathname === "/api/tools/fcf-yield/calculate" && req.method === "POST") {
      void tryHandleToolsFcfYield(u, req, clientRes);
      return;
    }

    if (u.pathname === "/api/symbols") {
      const q = u.searchParams.get("q") || "";
      const limit = Math.min(50, Math.max(1, Number(u.searchParams.get("limit") || "25") || 25));
      void (async () => {
        try {
          const results = await searchYahooSymbols(q, limit);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=60",
          });
          clientRes.end(JSON.stringify({ results }));
        } catch (e) {
          clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "symbols_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/candles") {
      const symbol = u.searchParams.get("symbol") || "";
      const range = u.searchParams.get("range") || "1D";
      const maHistory = u.searchParams.get("maHistory") === "1";
      void (async () => {
        try {
          const payload = await fetchYahooChart(symbol, range, { maHistory });
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=30",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          const status = e.statusCode && Number.isFinite(e.statusCode) ? e.statusCode : 502;
          clientRes.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(JSON.stringify({ error: "yahoo_candles_error", message: String(e.message || e) }));
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/quote") {
      const symbol = u.searchParams.get("symbol") || "";
      void (async () => {
        try {
          const chart = await fetchYahooChart(symbol, "1D");
          const bars = chart.bars;
          const last = bars[bars.length - 1];
          const prev = bars.length > 1 ? bars[bars.length - 2].c : bars[0].o;
          const price = last.c;
          const changePct = prev ? ((price - prev) / prev) * 100 : 0;
          const sparkline = downsampleSparkline(
            bars.map((b) => b.c).filter((c) => Number.isFinite(c))
          );
          const search = await searchYahooSymbols(chart.symbol, 5).catch(() => []);
          const match = search.find((s) => s.symbol === chart.symbol);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=15",
          });
          clientRes.end(
            JSON.stringify({
              symbol: chart.symbol,
              name: match?.description || chart.symbol,
              price,
              changePct,
              currency: chart.currency,
              exchange: chart.exchange,
              sparkline,
            })
          );
        } catch (e) {
          const status = e.statusCode && Number.isFinite(e.statusCode) ? e.statusCode : 502;
          clientRes.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(JSON.stringify({ error: "yahoo_quote_error", message: String(e.message || e) }));
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/market-overview") {
      void (async () => {
        try {
          const markets = await fetchMarketOverviewQuotes();
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=30",
          });
          clientRes.end(JSON.stringify({ markets }));
        } catch (e) {
          clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "market_overview_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/fundamentals") {
      const symbol = u.searchParams.get("symbol") || "";
      void (async () => {
        try {
          const payload = await fetchYahooFundamentals(symbol);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=900",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          const status = e.statusCode && Number.isFinite(e.statusCode) ? e.statusCode : 502;
          clientRes.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "yahoo_fundamentals_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/earnings") {
      const symbol = u.searchParams.get("symbol") || "";
      void (async () => {
        try {
          const payload = await fetchYahooEarningsHistory(symbol);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=900",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          const status = e.statusCode && Number.isFinite(e.statusCode) ? e.statusCode : 502;
          clientRes.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "yahoo_earnings_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/earnings-calendar") {
      const days = Math.min(62, Math.max(1, Number(u.searchParams.get("days") || "14") || 14));
      void (async () => {
        try {
          const payload = await fetchYahooEarningsCalendar(days);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=600",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "yahoo_earnings_calendar_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/market-movers") {
      const count = Math.min(25, Math.max(1, Number(u.searchParams.get("count") || "15") || 15));
      void (async () => {
        try {
          const payload = await fetchYahooMarketMovers(count);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=300",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "yahoo_market_movers_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/yahoo/upcoming-earnings") {
      const symbolsParam = u.searchParams.get("symbols") || "";
      const symbols = symbolsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      void (async () => {
        try {
          const payload = await fetchWatchlistUpcomingEarnings(symbols);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=900",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "yahoo_upcoming_earnings_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/alphavantage/fundamentals") {
      const symbol = u.searchParams.get("symbol") || "";
      void (async () => {
        try {
          const payload = await fetchAlphaVantageFundamentals(symbol);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=900",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          const status = e.statusCode && Number.isFinite(e.statusCode) ? e.statusCode : 502;
          clientRes.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(
            JSON.stringify({ error: "alphavantage_fundamentals_error", message: String(e.message || e) })
          );
        }
      })();
      return;
    }

    if (u.pathname === "/api/sec/filings") {
      const symbol = u.searchParams.get("symbol") || "";
      const limit = Math.min(100, Math.max(1, Number(u.searchParams.get("limit") || "25") || 25));
      void (async () => {
        try {
          const payload = await buildSecFilingsResponse(symbol, limit);
          clientRes.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "private, max-age=120",
          });
          clientRes.end(JSON.stringify(payload));
        } catch (e) {
          const status = e.statusCode && Number.isFinite(e.statusCode) ? e.statusCode : 502;
          clientRes.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
          clientRes.end(JSON.stringify({ error: "sec_filings_error", message: String(e.message || e) }));
        }
      })();
      return;
    }

    void (async () => {
      if (await tryHandleStockSearch(u, clientRes)) return;
      if (await tryHandleStockCompare(u, clientRes)) return;
      if (await tryHandleToolsDcf(u, req, clientRes)) return;
      if (await tryHandleToolsWacc(u, req, clientRes)) return;
      if (await tryHandleToolsEpv(u, req, clientRes)) return;
      if (await tryHandleToolsEv(u, req, clientRes)) return;
      if (await tryHandleToolsPe(u, req, clientRes)) return;
      if (await tryHandleToolsEvEbitda(u, req, clientRes)) return;
      if (await tryHandleToolsFcfYield(u, req, clientRes)) return;
      if (await tryHandleToolsSimilarStocks(u, req, clientRes)) return;
      if (await tryHandleStocksHub(u, clientRes)) return;
      if (await tryHandleStockActivity(u, clientRes)) return;
      if (await tryHandleAnalytics(u, clientRes)) return;
      if (await tryHandleStockOwnership(u, clientRes)) return;
      if (await tryHandleOwnershipIntelligence(u, clientRes)) return;
      if (await tryHandleStockInsider(u, clientRes)) return;
      if (await tryHandleScreener(u, clientRes)) return;
      if (await tryHandleStockClassification(u, clientRes)) return;
      if (await tryHandleStockSignals(u, clientRes)) return;
      if (await tryHandleStockFinancials(u, clientRes)) return;
      if (await tryHandleInstitutions(u, clientRes)) return;
      if (await tryHandlePoliticians(u, clientRes)) return;
      if (await tryHandleInsiders(u, clientRes)) return;
      if (await tryHandleSmartMoney(u, clientRes)) return;
      if (await tryHandleInsiderClusters(u, clientRes)) return;
      if (await tryHandleTopInstitutionNewEntries(u, clientRes)) return;
      if (await tryHandleDoubleSignal(u, clientRes)) return;
      if (await tryHandleTripleSignal(u, clientRes)) return;
      if (await tryHandleConflictSignals(u, clientRes)) return;
      if (await tryHandleHiddenGems(u, clientRes)) return;
      if (await tryHandleConvictionScore(u, clientRes)) return;
      if (await tryHandleInstitutionalDiscovery(u, clientRes)) return;

      const rel = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
      if (
        u.pathname === "/stock" ||
        u.pathname.startsWith("/stock/") ||
        u.pathname === "/stocks" ||
        u.pathname.startsWith("/stocks/") ||
        u.pathname === "/earnings-calendar" ||
        u.pathname.startsWith("/earnings-calendar/") ||
        u.pathname === "/market-movers" ||
        u.pathname.startsWith("/market-movers/") ||
        u.pathname === "/institutions" ||
        u.pathname.startsWith("/institutions/") ||
        u.pathname === "/insiders" ||
        u.pathname.startsWith("/insiders/") ||
        u.pathname === "/politicians" ||
        u.pathname.startsWith("/politicians/") ||
        u.pathname === "/signals" ||
        u.pathname.startsWith("/signals/") ||
        u.pathname === "/tools" ||
        u.pathname.startsWith("/tools/") ||
        u.pathname === "/institution" ||
        u.pathname.startsWith("/institution/")
      ) {
        sendFile(clientRes, path.join(__dirname, "index.html"));
        return;
      }
      const abs = path.resolve(__dirname, rel);
      if (!abs.startsWith(path.resolve(__dirname))) {
        clientRes.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        clientRes.end("Forbidden");
        return;
      }

      sendFile(clientRes, abs);
    })();
  })
  .listen(PORT, () => {
    console.log(`Tradepile: http://localhost:${PORT}`);
    console.log("Market data & fundamentals: Yahoo Finance");
    console.log("Ownership API: /api/stocks/:ticker/{top-holders,ownership-changes,new-positions,sold-out,institutional-options,institutional-transactions}");
    console.log("Stocks activity API: /api/stocks/recently-active, /api/stocks/most-accumulated, /api/stocks/ownership-changes, /api/stocks/holder-overlap, /api/stocks/ownership-history");
    console.log("Insider API: /api/stocks/:ticker/insider-transactions");
    console.log("Institutions API: /api/institutions, /api/institutions/performance-rankings, /api/institutions/most-accumulated, /api/institutions/new-positions, /api/institutions/completely-sold, /api/institutions/compare, /api/institutions/:cik/{holdings,activity,history,performance}");
    ensureReturnsMatrixOnStartup();
    ensurePerformanceSummariesOnStartup();
    ensureSmartMoneyCacheOnStartup();
    ensureInsiderClusterCacheOnStartup();
    ensureConvictionBuysCacheOnStartup();
    ensureRepeatBuyersCacheOnStartup();
    ensureInsiderSentimentCacheOnStartup();
    ensureFirstTimeBuyersCacheOnStartup();
    ensureHeavySellingCacheOnStartup();
    ensureTopInstitutionNewEntriesCacheOnStartup();
    ensureDoubleSignalCacheOnStartup();
    ensureTripleSignalCacheOnStartup();
    ensureConflictSignalsCacheOnStartup();
    ensureHiddenGemsCacheOnStartup();
    ensureConvictionScoreCacheOnStartup();
    ensureInstitutionalDiscoveryCacheOnStartup();
    ensureInstitutionalAccumulationCacheOnStartup();
    ensureMostAccumulatedCacheOnStartup();
    ensureNewPositionsCacheOnStartup();
    ensureCompletelySoldCacheOnStartup();
    ensureOwnershipChangesCacheOnStartup();
    ensureOwnershipHistoryCacheOnStartup();
    console.log("Politicians API: /api/politicians/recent, /api/politicians/most-accumulated, /api/politicians/largest-portfolios, /api/politicians/repeat-buyers, /api/politicians/first-time-buyers, /api/politicians/sector-exposure, /api/politicians/profile/:key/sector-exposure");
    console.log("Insiders API: /api/insiders/recent, /api/insiders/conviction-buys, /api/insiders/repeat-buyers, /api/insiders/sentiment, /api/insiders/first-time-buyers, /api/insiders/heavy-selling");
    if (!AV_KEY) console.warn("Tip: ALPHAVANTAGE_API_KEY optional (/api/alphavantage/fundamentals).");
    if (!TOKEN) console.warn("Tip: FINNHUB_API_KEY optional (finnhub proxy still available if set).");
    const rawSecUa = (process.env.SEC_USER_AGENT || "").trim();
    if (!rawSecUa) {
      console.warn("Tip: set SEC_USER_AGENT in .env (name + email) per SEC fair-access policy for data.sec.gov.");
    } else if (SEC_USER_AGENT !== rawSecUa) {
      console.warn(
        "Tip: SEC_USER_AGENT contained non-ASCII characters; sanitized for SEC requests. Use plain ASCII (name + email)."
      );
    }
  });
