import type { PoliticiansRecentPayload, PoliticianFilingBundle } from "../recent.js";
import type { PoliticianTrade } from "../types.js";
import { politicianKey } from "../politicianKey.js";
import {
  getPoliticianParty,
  parseStateFromSenateOffice,
} from "./party/service.js";
import {
  persistPoliticianParty,
  tryGetCachedPoliticianParty,
} from "../politiciansRepository.js";

export interface EnrichPoliticiansOptions {
  forceRefreshRoster?: boolean;
  persistToDatabase?: boolean;
}

function bundleIdentity(bundle: PoliticianFilingBundle): {
  key: string;
  state: string | null;
  district: string | null;
} {
  const key = politicianKey(bundle.politicianName);
  const state =
    bundle.state?.toUpperCase() ||
    (bundle.chamber === "senate" ? parseStateFromSenateOffice(bundle.office) : null);
  return {
    key,
    state: state || null,
    district: bundle.district ?? null,
  };
}

function applyEnrichmentToBundle(
  bundle: PoliticianFilingBundle,
  fields: {
    politicianKey: string;
    bioguideId?: string | null;
    party?: string | null;
    partySource?: string | null;
    partyLastUpdated?: string | null;
    state?: string | null;
  }
): PoliticianFilingBundle {
  const trades = (bundle.trades || []).map(
    (trade): PoliticianTrade => ({
      ...trade,
      politicianKey: fields.politicianKey,
      bioguideId: fields.bioguideId ?? trade.bioguideId ?? null,
      party: fields.party ?? trade.party ?? null,
      partySource: fields.partySource ?? trade.partySource ?? null,
      partyLastUpdated: fields.partyLastUpdated ?? trade.partyLastUpdated ?? null,
      state: trade.state || fields.state || bundle.state,
    })
  );

  return {
    ...bundle,
    politicianKey: fields.politicianKey,
    bioguideId: fields.bioguideId ?? bundle.bioguideId ?? null,
    party: fields.party ?? bundle.party ?? null,
    partySource: fields.partySource ?? bundle.partySource ?? null,
    partyLastUpdated: fields.partyLastUpdated ?? bundle.partyLastUpdated ?? null,
    state: bundle.state || fields.state || undefined,
    trades,
  };
}

async function enrichBundle(
  bundle: PoliticianFilingBundle,
  options: EnrichPoliticiansOptions
): Promise<PoliticianFilingBundle> {
  const { key, state, district } = bundleIdentity(bundle);

  let lookup = await tryGetCachedPoliticianParty(key, bundle.chamber);
  if (!lookup) {
    lookup = await getPoliticianParty(key, bundle.chamber, state, {
      name: bundle.politicianName,
      district,
      forceRefresh: options.forceRefreshRoster,
    });
  }

  if (!lookup) {
    return applyEnrichmentToBundle(bundle, {
      politicianKey: key,
      state,
    });
  }

  if (options.persistToDatabase !== false) {
    await persistPoliticianParty(lookup, bundle.chamber);
  }

  return applyEnrichmentToBundle(bundle, {
    politicianKey: lookup.politicianKey || key,
    bioguideId: lookup.bioguideId ?? null,
    party: lookup.party,
    partySource: lookup.source,
    partyLastUpdated: lookup.last_updated,
    state: lookup.state || state,
  });
}

/** Attach party and identity fields to scraped PTR bundles (once per politician). */
export async function enrichPoliticiansRecent(
  payload: PoliticiansRecentPayload,
  options: EnrichPoliticiansOptions = {}
): Promise<PoliticiansRecentPayload> {
  const seen = new Map<string, PoliticianFilingBundle>();

  async function enrichList(bundles: PoliticianFilingBundle[]): Promise<PoliticianFilingBundle[]> {
    const out: PoliticianFilingBundle[] = [];
    for (const bundle of bundles) {
      const { key } = bundleIdentity(bundle);
      const dedupeKey = `${bundle.chamber}:${key}`;
      const cached = seen.get(dedupeKey);
      if (cached) {
        out.push(
          applyEnrichmentToBundle(bundle, {
            politicianKey: cached.politicianKey || key,
            bioguideId: cached.bioguideId,
            party: cached.party,
            partySource: cached.partySource,
            partyLastUpdated: cached.partyLastUpdated,
            state: cached.state || bundleIdentity(bundle).state,
          })
        );
        continue;
      }

      const enriched = await enrichBundle(bundle, options);
      seen.set(dedupeKey, enriched);
      out.push(enriched);
    }
    return out;
  }

  const [house, senate] = await Promise.all([
    enrichList(payload.house),
    enrichList(payload.senate),
  ]);

  return {
    ...payload,
    house,
    senate,
  };
}
