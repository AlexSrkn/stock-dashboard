export type ComparePeriod = "latest" | "2q" | "4q" | "12m" | "all";

export interface CompareTopHolder {
  rank: number;
  institution: string;
  filerCik: string | null;
  portfolioWeight: number | null;
  shares: number;
  valueUsd: number | null;
  qoqChangePct: number | null;
}

export interface CompareInstitutional {
  holderCount: number | null;
  newPositions: number | null;
  increasingPositions: number | null;
  decreasingPositions: number | null;
  exitedPositions: number | null;
  ownershipPercentage: number | null;
  ownershipChange: number | null;
  total13fValue: number | null;
  latestQuarter: string | null;
  previousQuarter: string | null;
  topHolders: CompareTopHolder[];
  /** Wider holder set used for overlap (not always rendered). */
  holdersForOverlap?: CompareTopHolder[];
  available: boolean;
}

export interface CompareInsiders {
  buyTransactions: number | null;
  sellTransactions: number | null;
  uniqueBuyers: number | null;
  uniqueSellers: number | null;
  estimatedBuyValue: number | null;
  estimatedSellValue: number | null;
  openMarketBuys: number | null;
  openMarketSells: number | null;
  repeatBuyers: number | null;
  firstTimeBuyers: number | null;
  clusterBuying: boolean | null;
  heavySelling: boolean | null;
  available: boolean;
}

export interface ComparePoliticians {
  buyTransactions: number | null;
  sellTransactions: number | null;
  uniqueBuyers: number | null;
  uniqueSellers: number | null;
  estimatedBuyValue: number | null;
  estimatedSellValue: number | null;
  repeatBuyers: number | null;
  firstTimeBuyers: number | null;
  heavyBuying: boolean | null;
  heavySelling: boolean | null;
  democratBuyers: number | null;
  republicanBuyers: number | null;
  otherBuyers: number | null;
  democratSellers: number | null;
  republicanSellers: number | null;
  otherSellers: number | null;
  senatorBuyers: number | null;
  representativeBuyers: number | null;
  senatorSellers: number | null;
  representativeSellers: number | null;
  latestActivityDate: string | null;
  available: boolean;
}

export type CompareSignalValue =
  | { kind: "score"; score: number; label?: string | null; href: string }
  | { kind: "active"; active: boolean; href: string }
  | { kind: "missing"; href: string };

export interface CompareSignals {
  smartMoney: CompareSignalValue | null;
  doubleSignal: CompareSignalValue | null;
  tripleSignal: CompareSignalValue | null;
  hiddenGem: CompareSignalValue | null;
  conflictSignal: CompareSignalValue | null;
  institutionalDiscovery: CompareSignalValue | null;
  convictionScore: CompareSignalValue | null;
}

export interface CompareStockSide {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  institutional: CompareInstitutional;
  insiders: CompareInsiders;
  politicians: ComparePoliticians;
  signals: CompareSignals;
  summary: {
    institutionalHolders: number | null;
    newPositions: number | null;
    insiderBuyers: number | null;
    politicianBuyers: number | null;
    activeSignals: string[];
    highlightScore: { name: string; score: number } | null;
  };
}

export interface OverlapInstitution {
  cik: string;
  name: string;
  weightA: number | null;
  weightB: number | null;
  sharesA: number | null;
  sharesB: number | null;
  valueA: number | null;
  valueB: number | null;
}

export interface OverlapInsider {
  name: string;
  role: string | null;
  activityA: string;
  activityB: string;
  latestDate: string | null;
}

export interface OverlapPolitician {
  name: string;
  party: string | null;
  chamber: string | null;
  activityA: string;
  activityB: string;
  latestTransaction: string | null;
}

export interface CompareOverlap {
  institutions: {
    count: number;
    items: OverlapInstitution[];
  };
  insiders: {
    count: number;
    items: OverlapInsider[];
  };
  politicians: {
    count: number;
    items: OverlapPolitician[];
  };
}

export interface CompareTimelineEvent {
  date: string;
  ticker: string;
  side: "A" | "B";
  source: "institutional" | "insider" | "politician";
  type: string;
  label: string;
  detail: string | null;
}

export interface StockComparePayload {
  computedAt: string;
  period: ComparePeriod;
  stockA: CompareStockSide;
  stockB: CompareStockSide;
  overlap: CompareOverlap;
  timeline: CompareTimelineEvent[];
}
