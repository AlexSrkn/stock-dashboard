export type PoliticianChamber = "house" | "senate";

export type PoliticianTransactionCategory = "buy" | "sell" | "exchange" | "other";

export interface PoliticianTrade {
  chamber: PoliticianChamber;
  politicianName: string;
  politicianKey?: string;
  bioguideId?: string | null;
  party?: string | null;
  partySource?: string | null;
  partyLastUpdated?: string | null;
  state?: string;
  district?: string;
  owner?: string;
  assetName: string;
  ticker: string | null;
  assetType: string | null;
  transactionType: string;
  transactionCategory: PoliticianTransactionCategory;
  transactionDate: string | null;
  notificationDate: string | null;
  amountRange: string | null;
  amountMin: number | null;
  amountMax: number | null;
  capitalGainsOver200: boolean | null;
  filingDate: string | null;
  filingId: string;
  sourceUrl: string;
  filingStatus?: string | null;
  ownerDetail?: string | null;
  comment?: string | null;
}

export interface HouseFilingIndexEntry {
  prefix: string;
  lastName: string;
  firstName: string;
  suffix: string;
  filingType: string;
  stateDst: string;
  year: number;
  filingDate: string;
  docId: string;
}
