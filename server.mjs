import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getPool } from "./src/db/pool.ts";
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
import { tryHandleWatchlistActivity } from "./src/api/watchlistActivity.ts";
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
import { ensureStocksMostAccumulatedCacheOnStartup } from "./src/stocks/mostAccumulated/cache.ts";
import { ensureNewPositionsCacheOnStartup } from "./src/institution/newPositions/cache.ts";
import { ensureCompletelySoldCacheOnStartup } from "./src/institution/completelySold/cache.ts";
import { ensureOwnershipChangesCacheOnStartup } from "./src/stocks/ownershipChanges/cache.ts";
import { ensureOwnershipHistoryCacheOnStartup } from "./src/stocks/ownershipHistory/cache.ts";

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

// Prefer IPv4 for SEC — some VPS IPv6 routes get HTML 403 pages.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* Node < 17 */
}

const PORT = Number(process.env.PORT || 8787);
const TOKEN = (process.env.FINNHUB_API_KEY || "").trim();
const AV_KEY = (process.env.ALPHAVANTAGE_API_KEY || "").trim();

/** @type {Map<string, { loadedAt: number; data: object }>} */
const fundamentalsCache = new Map();
const FUNDAMENTALS_CACHE_MS = 15 * 60 * 1000;


/** @type {{ loadedAt: number; data: object } | null} */

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

/** Resolve on each request so a restarted process always picks up .env. */
function resolveSecUserAgent() {
  return sanitizeHttpHeader(process.env.SEC_USER_AGENT);
}

function isDefaultSecUserAgent(ua = resolveSecUserAgent()) {
  return !process.env.SEC_USER_AGENT?.trim() || ua === SEC_USER_AGENT_DEFAULT;
}

/** @type {{ loadedAt: number; map: Map<string, number> } | null} */
let tickerCache = null;
const TICKER_CACHE_MS = 6 * 60 * 60 * 1000;

function secGetViaCurl(host, pathname, userAgent) {
  const url = `https://${host}${pathname}`;
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      ["-4", "-sS", "-L", "--max-time", "30", "-H", `User-Agent: ${userAgent}`, "-H", "Accept: application/json", url],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`SEC curl failed (${host}${pathname}): ${err.message}${stderr ? ` ${String(stderr).slice(0, 120)}` : ""}`));
          return;
        }
        const text = String(stdout || "");
        if (!text.trim() || text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) {
          reject(new Error(`SEC curl returned non-JSON (${host}${pathname}): ${text.slice(0, 200)}`));
          return;
        }
        resolve(text);
      }
    );
  });
}

function secGet(host, pathname) {
  const userAgent = resolveSecUserAgent();
  const url = `https://${host}${pathname}`;
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          family: 4,
          headers: {
            "User-Agent": userAgent,
            Accept: "application/json",
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            void (async () => {
              const body = Buffer.concat(chunks).toString("utf8");
              if (res.statusCode === 200) {
                resolve(body);
                return;
              }
              // www.sec.gov often 403s Node's TLS stack on VPS while curl works — fall back.
              if (res.statusCode === 403) {
                try {
                  resolve(await secGetViaCurl(host, pathname, userAgent));
                  return;
                } catch (curlErr) {
                  const uaHint = isDefaultSecUserAgent(userAgent)
                    ? "default"
                    : `custom:${userAgent.split(/\s+/)[0]}`;
                  reject(
                    new Error(
                      `SEC HTTP 403 (${host}${pathname}, ua=${uaHint}); curl fallback failed: ${
                        curlErr instanceof Error ? curlErr.message : String(curlErr)
                      }`
                    )
                  );
                  return;
                }
              }
              reject(new Error(`SEC HTTP ${res.statusCode} (${host}${pathname}): ${body.slice(0, 200)}`));
            })();
          });
        }
      )
      .on("error", (err) => {
        void secGetViaCurl(host, pathname, userAgent).then(resolve, (curlErr) => {
          reject(
            new Error(
              `SEC request failed (${host}${pathname}): ${err.message}; curl fallback: ${
                curlErr instanceof Error ? curlErr.message : String(curlErr)
              }`
            )
          );
        });
      });
  });
}

/** Prefer local stocks.cik so filings work even when www.sec.gov blocks Node. */
async function lookupCikFromDb(symbol) {
  try {
    const pool = getPool();
    const res = await pool.query(
      `SELECT cik
       FROM stocks
       WHERE UPPER(BTRIM(ticker)) = $1
         AND cik IS NOT NULL
         AND BTRIM(cik) <> ''
       LIMIT 1`,
      [symbol]
    );
    const raw = res.rows[0]?.cik;
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;
    return Number(digits);
  } catch {
    return null;
  }
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

  let cikNum = await lookupCikFromDb(sym);
  if (cikNum == null) {
    const map = await getTickerToCikMap();
    const aliases = { "BRK.B": "BRK-B", "BF.B": "BF-B" };
    cikNum = map.get(aliases[sym] || sym) ?? null;
  }
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
      clientRes.writeHead(410, { "Content-Type": "application/json; charset=utf-8" });
      clientRes.end(JSON.stringify({ error: "gone", message: "Use /api/stocks/search" }));
      return;
    }

    if (u.pathname === "/api/yahoo/candles" || u.pathname === "/api/yahoo/quote" || u.pathname === "/api/yahoo/fundamentals") {
      clientRes.writeHead(410, { "Content-Type": "application/json; charset=utf-8" });
      clientRes.end(JSON.stringify({ error: "gone", message: "Yahoo Finance endpoints removed" }));
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
      if (await tryHandleWatchlistActivity(u, clientRes)) return;
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
    console.log(`TradeAtlant: http://localhost:${PORT}`);
    console.log("Market data: SEC + TradingView (Yahoo Finance removed)");
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
    ensureStocksMostAccumulatedCacheOnStartup();
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
    } else if (isDefaultSecUserAgent()) {
      console.warn(
        "Tip: SEC_USER_AGENT contained non-ASCII characters; sanitized for SEC requests. Use plain ASCII (name + email)."
      );
    } else {
      console.log(`SEC_USER_AGENT loaded (${rawSecUa.split(/\s+/)[0]} …)`);
    }
  });
