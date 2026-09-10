import type http from "node:http";
import { loadEnvFile, getPool } from "../db/pool.js";
import {
  loadInstitutionalSectorFlows,
  loadInstitutionalSectorOwnership,
  loadSectorSummaries,
} from "../stocks/sectorAnalytics.js";
import {
  loadIndustryAccumulation,
  loadSectorAccumulation,
} from "../stocks/sectorAccumulation.js";
import { loadSectorBuying } from "../stocks/sectorBuying.js";
import { loadSectorSelling } from "../stocks/sectorSelling.js";
import {
  loadInstitutionalConcentration,
  loadInstitutionalConcentrationStocks,
} from "../stocks/institutionalConcentration.js";
import {
  loadIndustryDetail,
  loadSectorDetail,
  loadSectorOverview,
} from "../stocks/sectorOverview.js";
import { loadSectorFundamentals } from "../stocks/sectorFundamentals.js";

loadEnvFile();

const ROUTE_SECTORS_RE = /^\/api\/analytics\/sectors\/?$/;
const ROUTE_SECTOR_OVERVIEW_RE = /^\/api\/analytics\/sectors\/overview\/?$/;
const ROUTE_SECTOR_ACCUMULATION_RE = /^\/api\/analytics\/sectors\/accumulation\/?$/;
const ROUTE_SECTOR_BUYING_RE = /^\/api\/analytics\/sectors\/buying\/?$/;
const ROUTE_SECTOR_SELLING_RE = /^\/api\/analytics\/sectors\/selling\/?$/;
const ROUTE_SECTOR_FUNDAMENTALS_RE = /^\/api\/analytics\/sectors\/fundamentals\/?$/;
const ROUTE_INSTITUTIONAL_CONCENTRATION_RE =
  /^\/api\/analytics\/sectors\/institutional-concentration\/?$/;
const ROUTE_INSTITUTIONAL_CONCENTRATION_STOCKS_RE =
  /^\/api\/analytics\/sectors\/institutional-concentration\/stocks\/?$/;
const ROUTE_INDUSTRY_ACCUMULATION_RE = /^\/api\/analytics\/industries\/accumulation\/?$/;
const ROUTE_SECTOR_DETAIL_RE = /^\/api\/analytics\/sectors\/([^/]+)\/?$/;
const ROUTE_INDUSTRY_DETAIL_RE = /^\/api\/analytics\/sectors\/([^/]+)\/industries\/([^/]+)\/?$/;
const ROUTE_SECTOR_OWNERSHIP_RE = /^\/api\/analytics\/institutional-sector-ownership\/?$/;
const ROUTE_SECTOR_FLOWS_RE = /^\/api\/analytics\/institutional-sector-flows\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 300) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `private, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function tryHandleAnalytics(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  const path = url.pathname;
  const isAnalytics =
    ROUTE_SECTORS_RE.test(path) ||
    ROUTE_SECTOR_OVERVIEW_RE.test(path) ||
    ROUTE_SECTOR_ACCUMULATION_RE.test(path) ||
    ROUTE_SECTOR_BUYING_RE.test(path) ||
    ROUTE_SECTOR_SELLING_RE.test(path) ||
    ROUTE_SECTOR_FUNDAMENTALS_RE.test(path) ||
    ROUTE_INSTITUTIONAL_CONCENTRATION_RE.test(path) ||
    ROUTE_INSTITUTIONAL_CONCENTRATION_STOCKS_RE.test(path) ||
    ROUTE_INDUSTRY_ACCUMULATION_RE.test(path) ||
    ROUTE_INDUSTRY_DETAIL_RE.test(path) ||
    ROUTE_SECTOR_DETAIL_RE.test(path) ||
    ROUTE_SECTOR_OWNERSHIP_RE.test(path) ||
    ROUTE_SECTOR_FLOWS_RE.test(path);
  if (!isAnalytics) return false;

  try {
    if (ROUTE_SECTOR_OVERVIEW_RE.test(path)) {
      json(res, 200, await loadSectorOverview(getPool()));
      return true;
    }
    if (ROUTE_SECTOR_ACCUMULATION_RE.test(path)) {
      json(res, 200, await loadSectorAccumulation(getPool()), 600);
      return true;
    }
    if (ROUTE_SECTOR_BUYING_RE.test(path)) {
      json(res, 200, await loadSectorBuying(getPool()), 600);
      return true;
    }
    if (ROUTE_SECTOR_SELLING_RE.test(path)) {
      json(res, 200, await loadSectorSelling(getPool()), 600);
      return true;
    }
    if (ROUTE_SECTOR_FUNDAMENTALS_RE.test(path)) {
      json(res, 200, await loadSectorFundamentals(getPool()), 600);
      return true;
    }
    if (ROUTE_INSTITUTIONAL_CONCENTRATION_STOCKS_RE.test(path)) {
      const cik = String(url.searchParams.get("cik") || "").trim();
      const sectorSlug = String(url.searchParams.get("sector") || "").trim();
      const industrySlug = String(url.searchParams.get("industry") || "").trim() || null;
      if (!cik || !sectorSlug) {
        json(res, 400, { error: "bad_request", message: "cik and sector are required" });
        return true;
      }
      const payload = await loadInstitutionalConcentrationStocks(
        cik,
        sectorSlug,
        industrySlug,
        getPool()
      );
      if (!payload) {
        json(res, 404, { error: "not_found", message: "No concentration stocks for this selection" });
        return true;
      }
      json(res, 200, payload, 600);
      return true;
    }
    if (ROUTE_INSTITUTIONAL_CONCENTRATION_RE.test(path)) {
      json(res, 200, await loadInstitutionalConcentration(getPool()), 600);
      return true;
    }
    if (ROUTE_INDUSTRY_ACCUMULATION_RE.test(path)) {
      json(res, 200, await loadIndustryAccumulation(getPool()), 600);
      return true;
    }

    const industryMatch = path.match(ROUTE_INDUSTRY_DETAIL_RE);
    if (industryMatch) {
      const payload = await loadIndustryDetail(
        decodeParam(industryMatch[1]!),
        decodeParam(industryMatch[2]!),
        getPool()
      );
      if (!payload) {
        json(res, 404, { error: "not_found", message: "Unknown sector or industry" });
        return true;
      }
      json(res, 200, payload);
      return true;
    }

    const sectorMatch = path.match(ROUTE_SECTOR_DETAIL_RE);
    if (
      sectorMatch &&
      sectorMatch[1] !== "overview" &&
      sectorMatch[1] !== "accumulation" &&
      sectorMatch[1] !== "buying" &&
      sectorMatch[1] !== "selling" &&
      sectorMatch[1] !== "fundamentals" &&
      sectorMatch[1] !== "institutional-concentration"
    ) {
      if (!ROUTE_SECTORS_RE.test(path)) {
        const payload = await loadSectorDetail(decodeParam(sectorMatch[1]!), getPool());
        if (!payload) {
          json(res, 404, { error: "not_found", message: "Unknown sector" });
          return true;
        }
        json(res, 200, payload);
        return true;
      }
    }

    if (ROUTE_SECTORS_RE.test(path)) {
      json(res, 200, await loadSectorSummaries(getPool()));
      return true;
    }
    if (ROUTE_SECTOR_OWNERSHIP_RE.test(path)) {
      json(res, 200, await loadInstitutionalSectorOwnership(getPool()));
      return true;
    }
    if (ROUTE_SECTOR_FLOWS_RE.test(path)) {
      json(res, 200, await loadInstitutionalSectorFlows(getPool()));
      return true;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL") || message.includes("does not exist")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "analytics_error", message });
    return true;
  }

  return false;
}
