/** Machine-readable roster derived from official congressional records (Congress.gov). */
export const LEGISLATORS_CURRENT_JSON_URL =
  "https://unitedstates.github.io/congress-legislators/legislators-current.json";

export const PARTY_ROSTER_SOURCE =
  "unitedstates/congress-legislators (Congress.gov biographical data)";

/** Refresh cached roster after 30 days unless a new filing triggers refresh. */
export const PARTY_ROSTER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const PARTY_ROSTER_CACHE_PATH = "data/politicians/party-roster-cache.json";
