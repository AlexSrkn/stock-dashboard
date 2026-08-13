/**
 * Staging table for 13f.info manager candidates (input universe for a later EDGAR scrape).
 * Do NOT treat this as the verified institution directory — that remains `institution`.
 */

CREATE TABLE IF NOT EXISTS thirteen_f_manager_candidates (
  id TEXT PRIMARY KEY,
  manager_name TEXT NOT NULL,
  location TEXT,
  latest_filing_quarter TEXT NOT NULL,
  latest_filing_date DATE,
  source_url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '13f.info',
  minimum_quarter TEXT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thirteen_f_manager_candidates_quarter
  ON thirteen_f_manager_candidates (latest_filing_quarter);

CREATE INDEX IF NOT EXISTS idx_thirteen_f_manager_candidates_name
  ON thirteen_f_manager_candidates (manager_name);
