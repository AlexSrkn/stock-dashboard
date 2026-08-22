-- Canonical issuers vs listed securities (ADR, OTC, dual-listed, share classes).
-- Consolidated financials attach to canonical_issuer; 13F positions stay on security/CUSIP.

CREATE TABLE IF NOT EXISTS canonical_issuer (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  primary_cik CHAR(10),
  primary_ticker VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canonical_issuer_normalized
  ON canonical_issuer (normalized_name);

CREATE TABLE IF NOT EXISTS security_listing (
  ticker VARCHAR(16) PRIMARY KEY,
  issuer_id BIGINT NOT NULL REFERENCES canonical_issuer(id) ON DELETE CASCADE,
  cik CHAR(10),
  company_name TEXT,
  listing_kind VARCHAR(32) NOT NULL DEFAULT 'common',
  is_primary_filing BOOLEAN NOT NULL DEFAULT FALSE,
  shares_class VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT security_listing_kind_chk CHECK (
    listing_kind IN ('common', 'adr', 'otc', 'preferred', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_security_listing_issuer ON security_listing (issuer_id);
CREATE INDEX IF NOT EXISTS idx_security_listing_cik ON security_listing (cik);

-- 13F-reported CUSIP → specific security (never merge holdings across CUSIPs).
CREATE TABLE IF NOT EXISTS security_cusip (
  cusip CHAR(9) PRIMARY KEY,
  ticker VARCHAR(16) NOT NULL REFERENCES security_listing(ticker) ON DELETE CASCADE,
  issuer_id BIGINT NOT NULL REFERENCES canonical_issuer(id) ON DELETE CASCADE,
  issuer_name_hint TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_cusip_ticker ON security_cusip (ticker);
CREATE INDEX IF NOT EXISTS idx_security_cusip_issuer ON security_cusip (issuer_id);

-- Extend financial periods with canonical issuer anchor (additive migration).
ALTER TABLE sec_financial_period
  ADD COLUMN IF NOT EXISTS issuer_id BIGINT REFERENCES canonical_issuer(id),
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(32) NOT NULL DEFAULT 'companyfacts';

CREATE INDEX IF NOT EXISTS idx_sec_financial_period_issuer
  ON sec_financial_period (issuer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sec_financial_period_issuer_period
  ON sec_financial_period (issuer_id, fiscal_year, fiscal_period, statement_scope)
  WHERE issuer_id IS NOT NULL;
