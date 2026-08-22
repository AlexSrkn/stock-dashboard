export type SecurityListingKind = "common" | "adr" | "otc" | "preferred" | "other";

export interface CanonicalIssuer {
  id: number;
  slug: string;
  name: string;
  normalizedName: string;
  primaryCik: string | null;
  primaryTicker: string | null;
}

export interface SecurityListing {
  ticker: string;
  issuerId: number;
  cik: string | null;
  companyName: string | null;
  listingKind: SecurityListingKind;
  isPrimaryFiling: boolean;
  sharesClass: string | null;
}

export interface SecurityCusipMapping {
  cusip: string;
  ticker: string;
  issuerId: number;
  issuerNameHint: string | null;
}

/** Resolved view for a user-facing ticker. */
export interface IssuerSecurityContext {
  requestedTicker: string;
  listing: SecurityListing;
  issuer: CanonicalIssuer;
  /** CIK/ticker used for SEC Company Facts + 20-F/6-K filing history. */
  filingTicker: string;
  filingCik: string | null;
}

/** 13F row identity — security-specific, not merged across listings. */
export interface ReportedSecurityIdentity {
  cusip: string;
  reportedTicker: string | null;
  canonicalIssuer: CanonicalIssuer | null;
}
