-- Extend sec_filing / sec_holding for multi-quarter ingest and separated security types.
-- Safe to re-run.

ALTER TABLE sec_filing ADD COLUMN IF NOT EXISTS total_value BIGINT;

ALTER TABLE sec_holding ADD COLUMN IF NOT EXISTS ticker VARCHAR(16);
ALTER TABLE sec_holding ADD COLUMN IF NOT EXISTS value BIGINT;
ALTER TABLE sec_holding ADD COLUMN IF NOT EXISTS security_type VARCHAR(8);
ALTER TABLE sec_holding ADD COLUMN IF NOT EXISTS option_type VARCHAR(8);
ALTER TABLE sec_holding ADD COLUMN IF NOT EXISTS discretion VARCHAR(8);
ALTER TABLE sec_holding ADD COLUMN IF NOT EXISTS title_of_class TEXT;

-- Backfill new columns from legacy fields where present.
UPDATE sec_holding
SET
  value = COALESCE(value, value_usd_thousands),
  security_type = COALESCE(security_type, shares_type),
  option_type = COALESCE(option_type, put_call)
WHERE value IS NULL OR security_type IS NULL OR option_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_sec_holding_security_type ON sec_holding (security_type);
CREATE INDEX IF NOT EXISTS idx_sec_holding_option_type ON sec_holding (option_type);
CREATE INDEX IF NOT EXISTS idx_sec_holding_filer_quarter_cusip_opt
  ON sec_holding (filer_cik, quarter, cusip, option_type, security_type);
