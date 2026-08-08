export type SimilarStocksSort =
  | "similarity"
  | "institutional_overlap"
  | "shared_holders"
  | "institutional_discovery"
  | "conviction";

export type MarketCapBucket = "" | "mega" | "large" | "mid" | "small";

export interface SimilarStocksFilters {
  minScore?: number;
  sector?: string;
  marketCap?: MarketCapBucket;
  minSharedHolders?: number;
  requireInsiderActivity?: boolean;
  requirePoliticianActivity?: boolean;
  requireActiveSignals?: boolean;
  sort?: SimilarStocksSort;
  limit?: number;
}

export interface SimilarStocksComponentScores {
  institutional_profile: number | null;
  institutional_holder_overlap: number | null;
  institutional_activity: number | null;
  insider_activity: number | null;
  politician_activity: number | null;
  signals: number | null;
}

export interface SharedInstitution {
  cik: string;
  name: string;
  institution_type: string | null;
}

export interface SimilarStockMatch {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  similarity_score: number;
  components: SimilarStocksComponentScores;
  shared_holder_count: number;
  overlap_percentage: number;
  weighted_overlap_score: number;
  institutional_discovery_score: number | null;
  conviction_score: number | null;
  reasons: string[];
  matching_signals: string[];
  matching_insider_metrics: string[];
  matching_politician_metrics: string[];
  shared_institutions: SharedInstitution[];
  has_insider_activity: boolean;
  has_politician_activity: boolean;
  has_active_signals: boolean;
}

export interface SimilarStocksTargetSummary {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  holder_count: number;
  institutional_discovery_score: number | null;
  conviction_score: number | null;
  active_signals: string[];
}

export interface SimilarStocksResponse {
  computed_at: string;
  methodology: string;
  weights: Record<keyof SimilarStocksComponentScores, number>;
  target: SimilarStocksTargetSummary;
  filters: SimilarStocksFilters;
  results: SimilarStockMatch[];
  sectors: string[];
  total_candidates: number;
}
