export type EnrichmentChamber = "house" | "senate";

export type NormalizedParty =
  | "Democrat"
  | "Republican"
  | "Independent"
  | "Libertarian"
  | string;

export interface PoliticianPartyLookupResult {
  name: string;
  chamber: "House" | "Senate";
  state: string | null;
  party: NormalizedParty;
  source: string;
  last_updated: string;
  bioguideId?: string | null;
  politicianKey?: string;
  district?: string | null;
}

export interface PoliticianEnrichmentFields {
  politicianKey: string;
  bioguideId?: string | null;
  party?: string | null;
  partySource?: string | null;
  partyLastUpdated?: string | null;
}
