import type { PoliticianPartyLookupResult } from "../types.js";
import { isBioguideId, politicianKey } from "../../politicianKey.js";
import { PARTY_ROSTER_SOURCE } from "./constants.js";
import {
  ensurePartyRoster,
  lookupPartyInRoster,
  setPartyRosterIndex,
  type PartyRosterIndex,
  type RosterMember,
} from "./roster.js";

export interface GetPoliticianPartyOptions {
  name?: string | null;
  district?: string | null;
  forceRefresh?: boolean;
  roster?: PartyRosterIndex;
}

function toDisplayChamber(chamber: "house" | "senate"): "House" | "Senate" {
  return chamber === "house" ? "House" : "Senate";
}

function memberToResult(
  member: RosterMember,
  index: PartyRosterIndex,
  key: string
): PoliticianPartyLookupResult {
  return {
    name: member.name,
    chamber: toDisplayChamber(member.chamber),
    state: member.state,
    party: member.party,
    source: index.source || PARTY_ROSTER_SOURCE,
    last_updated: index.fetchedAt.slice(0, 10),
    bioguideId: member.bioguideId,
    politicianKey: key,
    district: member.district,
  };
}

/**
 * Resolve current party affiliation for a member of Congress.
 *
 * `politicianId` may be a bioguide ID (preferred) or the scraper's slug key.
 * When only a slug is available, pass `options.name` for name-based matching.
 */
export async function getPoliticianParty(
  politicianId: string | null | undefined,
  chamber: "house" | "senate",
  state: string | null | undefined,
  options: GetPoliticianPartyOptions = {}
): Promise<PoliticianPartyLookupResult | null> {
  const index = options.roster ?? (await ensurePartyRoster({ forceRefresh: options.forceRefresh }));

  const id = String(politicianId || "").trim();
  const lookup = {
    bioguideId: isBioguideId(id) ? id : null,
    name: options.name ?? null,
    chamber,
    state: state ?? null,
    district: options.district ?? null,
  };

  let member = lookupPartyInRoster(index, lookup);

  if (!member && id && !isBioguideId(id) && options.name) {
    member = lookupPartyInRoster(index, {
      ...lookup,
      bioguideId: null,
    });
  }

  if (!member) return null;

  const key = isBioguideId(id) ? politicianKey(member.name) : id || politicianKey(member.name);
  return memberToResult(member, index, key);
}

/** Parse two-letter state from Senate EFD office field when present. */
export function parseStateFromSenateOffice(office: string | null | undefined): string | null {
  const text = String(office || "").trim();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  const match = text.match(/\b([A-Z]{2})\b/);
  return match ? match[1]! : null;
}

export function clearPartyRosterMemoryCache(): void {
  setPartyRosterIndex(null);
}
