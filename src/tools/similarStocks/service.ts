import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { getHolderOverlap } from "../../stocks/holderOverlap/service.js";
import type { HolderOverlapInstitution } from "../../stocks/holderOverlap/types.js";
import {
  SIMILAR_STOCKS_METHODOLOGY,
  SIMILAR_STOCKS_WEIGHTS,
  buildMatchReasons,
  matchingInsiderMetrics,
  matchingPoliticianMetrics,
  matchingSignalLabels,
  minMaxNormalize,
  scoreHolderOverlap,
  scoreInsiderActivity,
  scoreInstitutionalActivity,
  scoreInstitutionalProfile,
  scorePoliticianActivity,
  scoreSignalsActivity,
  weightedSimilarityScore,
} from "./score.js";
import {
  activeSignalLabelsForProfile,
  buildSimilarStocksLookups,
  buildTickerProfile,
} from "./profile.js";
import type {
  SharedInstitution,
  SimilarStockMatch,
  SimilarStocksFilters,
  SimilarStocksResponse,
  SimilarStocksSort,
} from "./types.js";

export class SimilarStocksError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SHARED_INSTITUTIONS_SQL = `
WITH target_holders AS (
  SELECT institution_cik, institution_name, institution_type
  FROM ownership_holding
  WHERE ticker = UPPER(BTRIM($1::text))
)
SELECT
  oh.ticker,
  oh.institution_cik AS cik,
  COALESCE(oh.institution_name, th.institution_name) AS name,
  COALESCE(oh.institution_type, th.institution_type) AS institution_type,
  oh.shares::float8 AS shares
FROM ownership_holding oh
INNER JOIN target_holders th ON th.institution_cik = oh.institution_cik
WHERE oh.ticker = ANY($2::text[])
ORDER BY oh.ticker ASC, oh.shares DESC NULLS LAST
`;

function parseSort(raw: string | null | undefined): SimilarStocksSort {
  if (
    raw === "institutional_overlap" ||
    raw === "shared_holders" ||
    raw === "institutional_discovery" ||
    raw === "conviction"
  ) {
    return raw;
  }
  return "similarity";
}

function parseFilters(url: URL): SimilarStocksFilters {
  const minScore = Number(url.searchParams.get("minScore") || "0");
  const minSharedHolders = Number(url.searchParams.get("minSharedHolders") || "1");
  const marketCapRaw = String(url.searchParams.get("marketCap") || "").trim();
  const marketCap =
    marketCapRaw === "mega" ||
    marketCapRaw === "large" ||
    marketCapRaw === "mid" ||
    marketCapRaw === "small"
      ? marketCapRaw
      : "";
  return {
    minScore: Number.isFinite(minScore) ? Math.max(0, Math.min(100, minScore)) : 0,
    sector: String(url.searchParams.get("sector") || "").trim(),
    marketCap,
    minSharedHolders: Number.isFinite(minSharedHolders)
      ? Math.max(1, Math.floor(minSharedHolders))
      : 1,
    requireInsiderActivity: url.searchParams.get("requireInsider") === "1",
    requirePoliticianActivity: url.searchParams.get("requirePolitician") === "1",
    requireActiveSignals: url.searchParams.get("requireSignals") === "1",
    sort: parseSort(url.searchParams.get("sort")),
    limit: Math.min(
      100,
      Math.max(5, Number(url.searchParams.get("limit") || "40") || 40)
    ),
  };
}

async function loadSharedInstitutions(
  pool: pg.Pool,
  targetTicker: string,
  candidateTickers: string[]
): Promise<Map<string, SharedInstitution[]>> {
  const map = new Map<string, SharedInstitution[]>();
  if (!candidateTickers.length) return map;
  try {
    const res = await pool.query<{
      ticker: string;
      cik: string;
      name: string;
      institution_type: string | null;
      shares: number;
    }>(SHARED_INSTITUTIONS_SQL, [targetTicker, candidateTickers]);
    for (const row of res.rows) {
      const sym = String(row.ticker).toUpperCase();
      const list = map.get(sym) || [];
      if (list.length >= 12) continue;
      if (list.some((x) => x.cik === String(row.cik))) continue;
      list.push({
        cik: String(row.cik),
        name: row.name,
        institution_type: row.institution_type,
      });
      map.set(sym, list);
    }
  } catch {
    /* optional enrichment */
  }
  return map;
}

function sortResults(rows: SimilarStockMatch[], sort: SimilarStocksSort): SimilarStockMatch[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (sort === "shared_holders") return b.shared_holder_count - a.shared_holder_count;
    if (sort === "institutional_overlap") {
      return (
        (b.components.institutional_holder_overlap ?? -1) -
        (a.components.institutional_holder_overlap ?? -1)
      );
    }
    if (sort === "institutional_discovery") {
      return (b.institutional_discovery_score ?? -1) - (a.institutional_discovery_score ?? -1);
    }
    if (sort === "conviction") {
      return (b.conviction_score ?? -1) - (a.conviction_score ?? -1);
    }
    return b.similarity_score - a.similarity_score;
  });
  return copy;
}

export async function getSimilarStocks(
  tickerRaw: string,
  url: URL,
  pool: pg.Pool = getPool()
): Promise<SimilarStocksResponse> {
  const ticker = String(tickerRaw || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    throw new SimilarStocksError(400, "invalid_ticker", "Enter a valid ticker symbol.");
  }

  const filters = parseFilters(url);
  const overlapUrl = new URL("http://local/api/stocks/holder-overlap");
  overlapUrl.searchParams.set("ticker", ticker);
  overlapUrl.searchParams.set("mode", "weighted");
  overlapUrl.searchParams.set("page", "1");
  overlapUrl.searchParams.set("pageSize", "100");
  overlapUrl.searchParams.set("minInstitutions", String(filters.minSharedHolders || 1));
  if (filters.sector) overlapUrl.searchParams.set("sector", filters.sector);
  if (filters.marketCap) overlapUrl.searchParams.set("marketCap", filters.marketCap);

  const overlap = await getHolderOverlap(overlapUrl, pool);
  if (!overlap.summary.holderCount) {
    throw new SimilarStocksError(
      404,
      "not_found",
      `No institutional holder data found for ${ticker}.`
    );
  }

  const lookups = buildSimilarStocksLookups();
  const targetProfile = buildTickerProfile(ticker, lookups);
  const weightedValues = overlap.stocks.map((s) => s.weightedScore);
  const minWeighted = Math.min(...weightedValues, 0);
  const maxWeighted = Math.max(...weightedValues, 0);

  const scored: SimilarStockMatch[] = [];
  for (const row of overlap.stocks) {
    const candidateTicker = String(row.ticker).toUpperCase();
    if (candidateTicker === ticker) continue;
    const candidateProfile = buildTickerProfile(candidateTicker, lookups);

    if (filters.requireInsiderActivity && !candidateProfile.hasInsiderActivity) continue;
    if (filters.requirePoliticianActivity && !candidateProfile.hasPoliticianActivity) continue;
    if (filters.requireActiveSignals && !candidateProfile.hasActiveSignals) continue;

    const normalizedWeighted = minMaxNormalize(row.weightedScore, minWeighted, maxWeighted);
    const overlapScore = scoreHolderOverlap({
      overlapPercentage: row.overlapPercentage,
      normalizedWeightedScore: normalizedWeighted,
    });
    const institutionalProfile = scoreInstitutionalProfile(targetProfile, candidateProfile);
    const institutionalActivity = scoreInstitutionalActivity(targetProfile, candidateProfile);
    const insiderActivity = scoreInsiderActivity(targetProfile, candidateProfile);
    const politicianActivity = scorePoliticianActivity(targetProfile, candidateProfile);
    const signals = scoreSignalsActivity(targetProfile, candidateProfile);

    const components = {
      institutional_profile: institutionalProfile,
      institutional_holder_overlap: overlapScore,
      institutional_activity: institutionalActivity,
      insider_activity: insiderActivity,
      politician_activity: politicianActivity,
      signals,
    };
    const similarity = weightedSimilarityScore(components);
    if (similarity == null) continue;
    if (filters.minScore != null && similarity < filters.minScore) continue;

    const matchingSignals = matchingSignalLabels(targetProfile, candidateProfile);
    const matchingInsider = matchingInsiderMetrics(targetProfile, candidateProfile);
    const matchingPolitician = matchingPoliticianMetrics(targetProfile, candidateProfile);

    scored.push({
      ticker: candidateTicker,
      company_name: row.companyName,
      sector: row.sector,
      similarity_score: similarity,
      components,
      shared_holder_count: row.overlapCount,
      overlap_percentage: row.overlapPercentage,
      weighted_overlap_score: row.weightedScore,
      institutional_discovery_score: candidateProfile.discoveryScore,
      conviction_score: candidateProfile.convictionScore,
      reasons: buildMatchReasons({
        sharedHolderCount: row.overlapCount,
        discoverySimilarity: institutionalProfile,
        insiderSimilarity: insiderActivity,
        politicianSimilarity: politicianActivity,
        signalsSimilarity: signals,
        activitySimilarity: institutionalActivity,
        matchingSignals,
      }),
      matching_signals: matchingSignals,
      matching_insider_metrics: matchingInsider,
      matching_politician_metrics: matchingPolitician,
      shared_institutions: [],
      has_insider_activity: candidateProfile.hasInsiderActivity,
      has_politician_activity: candidateProfile.hasPoliticianActivity,
      has_active_signals: candidateProfile.hasActiveSignals,
    });
  }

  const sorted = sortResults(scored, filters.sort || "similarity").slice(
    0,
    filters.limit || 40
  );

  const sharedMap = await loadSharedInstitutions(
    pool,
    ticker,
    sorted.map((r) => r.ticker)
  );
  for (const row of sorted) {
    row.shared_institutions = sharedMap.get(row.ticker) || [];
  }

  const targetInstitutions: HolderOverlapInstitution[] = overlap.institutions;
  void targetInstitutions;

  return {
    computed_at: new Date().toISOString(),
    methodology: SIMILAR_STOCKS_METHODOLOGY,
    weights: SIMILAR_STOCKS_WEIGHTS,
    target: {
      ticker,
      company_name: overlap.summary.targetCompanyName,
      sector: null,
      holder_count: overlap.summary.holderCount,
      institutional_discovery_score: targetProfile.discoveryScore,
      conviction_score: targetProfile.convictionScore,
      active_signals: activeSignalLabelsForProfile(targetProfile),
    },
    filters,
    results: sorted,
    sectors: overlap.sectors,
    total_candidates: overlap.total,
  };
}
