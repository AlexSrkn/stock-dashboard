import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadIssuerSecuritiesSchemaSql } from "../db/schema.js";
import { normalizeIssuerName, slugFromNormalizedName } from "./normalize.js";
import { ISSUER_GROUP_SEEDS } from "./seeds.js";
import type {
  CanonicalIssuer,
  IssuerSecurityContext,
  SecurityCusipMapping,
  SecurityListing,
  SecurityListingKind,
} from "./types.js";

function mapIssuer(row: {
  id: number;
  slug: string;
  name: string;
  normalized_name: string;
  primary_cik: string | null;
  primary_ticker: string | null;
}): CanonicalIssuer {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    primaryCik: row.primary_cik ? String(row.primary_cik) : null,
    primaryTicker: row.primary_ticker ? String(row.primary_ticker) : null,
  };
}

function mapListing(row: {
  ticker: string;
  issuer_id: number;
  cik: string | null;
  company_name: string | null;
  listing_kind: string;
  is_primary_filing: boolean;
  shares_class: string | null;
}): SecurityListing {
  return {
    ticker: String(row.ticker).toUpperCase(),
    issuerId: Number(row.issuer_id),
    cik: row.cik ? String(row.cik) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    listingKind: row.listing_kind as SecurityListingKind,
    isPrimaryFiling: Boolean(row.is_primary_filing),
    sharesClass: row.shares_class ? String(row.shares_class) : null,
  };
}

export class IssuerRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(loadIssuerSecuritiesSchemaSql());
  }

  async upsertIssuer(input: {
    slug: string;
    name: string;
    primaryCik?: string | null;
    primaryTicker?: string | null;
  }): Promise<CanonicalIssuer> {
    const normalized = normalizeIssuerName(input.name);
    const res = await this.pool.query(
      `INSERT INTO canonical_issuer (slug, name, normalized_name, primary_cik, primary_ticker, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         normalized_name = EXCLUDED.normalized_name,
         primary_cik = COALESCE(EXCLUDED.primary_cik, canonical_issuer.primary_cik),
         primary_ticker = COALESCE(EXCLUDED.primary_ticker, canonical_issuer.primary_ticker),
         updated_at = NOW()
       RETURNING id, slug, name, normalized_name, primary_cik, primary_ticker`,
      [
        input.slug,
        input.name,
        normalized,
        input.primaryCik ?? null,
        input.primaryTicker ?? null,
      ]
    );
    return mapIssuer(res.rows[0]);
  }

  async upsertListing(input: {
    ticker: string;
    issuerId: number;
    cik?: string | null;
    companyName?: string | null;
    listingKind?: SecurityListingKind;
    isPrimaryFiling?: boolean;
    sharesClass?: string | null;
  }): Promise<SecurityListing> {
    const ticker = String(input.ticker).trim().toUpperCase();
    const res = await this.pool.query(
      `INSERT INTO security_listing (
         ticker, issuer_id, cik, company_name, listing_kind, is_primary_filing, shares_class, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (ticker) DO UPDATE SET
         issuer_id = EXCLUDED.issuer_id,
         cik = COALESCE(EXCLUDED.cik, security_listing.cik),
         company_name = COALESCE(EXCLUDED.company_name, security_listing.company_name),
         listing_kind = EXCLUDED.listing_kind,
         is_primary_filing = EXCLUDED.is_primary_filing,
         shares_class = COALESCE(EXCLUDED.shares_class, security_listing.shares_class),
         updated_at = NOW()
       RETURNING ticker, issuer_id, cik, company_name, listing_kind, is_primary_filing, shares_class`,
      [
        ticker,
        input.issuerId,
        input.cik ?? null,
        input.companyName ?? null,
        input.listingKind ?? "common",
        input.isPrimaryFiling ?? false,
        input.sharesClass ?? null,
      ]
    );
    return mapListing(res.rows[0]);
  }

  async upsertCusipMapping(input: {
    cusip: string;
    ticker: string;
    issuerId: number;
    issuerNameHint?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO security_cusip (cusip, ticker, issuer_id, issuer_name_hint, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (cusip) DO UPDATE SET
         ticker = EXCLUDED.ticker,
         issuer_id = EXCLUDED.issuer_id,
         issuer_name_hint = COALESCE(EXCLUDED.issuer_name_hint, security_cusip.issuer_name_hint),
         updated_at = NOW()`,
      [input.cusip, input.ticker.toUpperCase(), input.issuerId, input.issuerNameHint ?? null]
    );
  }

  async getListingByTicker(ticker: string): Promise<SecurityListing | null> {
    const sym = ticker.trim().toUpperCase();
    const res = await this.pool.query(
      `SELECT ticker, issuer_id, cik, company_name, listing_kind, is_primary_filing, shares_class
       FROM security_listing WHERE ticker = $1`,
      [sym]
    );
    return res.rows[0] ? mapListing(res.rows[0]) : null;
  }

  async getIssuerById(id: number): Promise<CanonicalIssuer | null> {
    const res = await this.pool.query(
      `SELECT id, slug, name, normalized_name, primary_cik, primary_ticker
       FROM canonical_issuer WHERE id = $1`,
      [id]
    );
    return res.rows[0] ? mapIssuer(res.rows[0]) : null;
  }

  async getCusipMapping(cusip: string): Promise<SecurityCusipMapping | null> {
    const res = await this.pool.query<{
      cusip: string;
      ticker: string;
      issuer_id: number;
      issuer_name_hint: string | null;
    }>(`SELECT cusip, ticker, issuer_id, issuer_name_hint FROM security_cusip WHERE cusip = $1`, [
      cusip,
    ]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      cusip: String(row.cusip),
      ticker: String(row.ticker).toUpperCase(),
      issuerId: Number(row.issuer_id),
      issuerNameHint: row.issuer_name_hint ? String(row.issuer_name_hint) : null,
    };
  }

  async seedKnownGroups(): Promise<number> {
    let count = 0;
    for (const group of ISSUER_GROUP_SEEDS) {
      const issuer = await this.upsertIssuer({
        slug: group.slug,
        name: group.name,
        primaryCik: group.primaryCik,
        primaryTicker: group.primaryTicker,
      });
      for (const listing of group.listings) {
        await this.upsertListing({
          ticker: listing.ticker,
          issuerId: issuer.id,
          cik: listing.cik,
          companyName: listing.companyName,
          listingKind: listing.listingKind,
          isPrimaryFiling: listing.isPrimaryFiling,
        });
        count++;
      }
    }
    return count;
  }

  async findOrCreateIssuerFromName(
    companyName: string,
    primaryCik?: string | null,
    primaryTicker?: string | null
  ): Promise<CanonicalIssuer> {
    const normalized = normalizeIssuerName(companyName);
    const existing = await this.pool.query(
      `SELECT id, slug, name, normalized_name, primary_cik, primary_ticker
       FROM canonical_issuer WHERE normalized_name = $1 LIMIT 1`,
      [normalized]
    );
    if (existing.rows[0]) return mapIssuer(existing.rows[0]);
    return this.upsertIssuer({
      slug: slugFromNormalizedName(normalized) || "unknown",
      name: companyName.trim(),
      primaryCik: primaryCik ?? null,
      primaryTicker: primaryTicker ?? null,
    });
  }
}

let defaultRepo: IssuerRepository | null = null;

export function getIssuerRepository(): IssuerRepository {
  if (!defaultRepo) defaultRepo = new IssuerRepository();
  return defaultRepo;
}

export async function resolveIssuerSecurityContext(
  ticker: string,
  pool: pg.Pool = getPool()
): Promise<IssuerSecurityContext | null> {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return null;

  const repo = new IssuerRepository(pool);
  let listing = await repo.getListingByTicker(sym);

  if (!listing) {
    await repo.ensureSchema();
    await repo.seedKnownGroups();
    listing = await repo.getListingByTicker(sym);
  }

  if (!listing) {
    const stock = await pool.query<{ company_name: string | null; cik: string | null }>(
      `SELECT company_name, cik FROM stocks WHERE ticker = $1`,
      [sym]
    );
    const row = stock.rows[0];
    if (!row?.company_name) return null;
    const issuer = await repo.findOrCreateIssuerFromName(row.company_name, row.cik, sym);
    listing = await repo.upsertListing({
      ticker: sym,
      issuerId: issuer.id,
      cik: row.cik,
      companyName: row.company_name,
      isPrimaryFiling: issuer.primaryTicker == null || issuer.primaryTicker === sym,
    });
  }

  const issuer = await repo.getIssuerById(listing.issuerId);
  if (!issuer) return null;

  const primaryRes = await pool.query<{ ticker: string; cik: string | null }>(
    `SELECT ticker, cik FROM security_listing
     WHERE issuer_id = $1 AND is_primary_filing = TRUE
     ORDER BY ticker LIMIT 1`,
    [issuer.id]
  );
  const primary = primaryRes.rows[0];
  const filingTicker = primary?.ticker
    ? String(primary.ticker).toUpperCase()
    : issuer.primaryTicker ?? sym;
  const filingCik = primary?.cik ? String(primary.cik) : issuer.primaryCik ?? listing.cik;

  return {
    requestedTicker: sym,
    listing,
    issuer,
    filingTicker,
    filingCik: filingCik ?? null,
  };
}
