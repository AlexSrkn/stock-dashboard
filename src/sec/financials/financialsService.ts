import { formatSecCik, SecHttpError, secThrottle } from "../http.js";
import { downloadSecSubmissionsByTicker, lookupCikFromTicker } from "../submissions.js";
import { mapSicToSectorIndustry } from "../../stocks/sicMapping.js";
import { getStocksRepository } from "../../stocks/stocksRepository.js";
import { fetchCompanyFacts } from "./companyFacts.js";
import { discoverFinancialFilings } from "./discoverFilings.js";
import { pickDerivedLatest } from "./derivedMetrics.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import { tryPersistFinancials } from "./financialsRepository.js";
import { parse8kEarningsReleases } from "./parse8kEarnings.js";
import {
  rankFinancialSixKFilings,
  shouldSupplementFromSixK,
} from "./foreignFiler.js";
import { supplementQuarterlyFromLatestSixK } from "./sixK/extractSixKFinancials.js";
import type { FilingsFundamentalsResponse } from "./types.js";

export interface GetFilingsFundamentalsOptions {
  annualFilingLimit?: number;
  quarterlyFilingLimit?: number;
  currentFilingLimit?: number;
  annualPeriodLimit?: number;
  quarterlyPeriodLimit?: number;
}

/**
 * Dual-listed / OTC siblings that appear in SEC company_tickers but have no
 * companyfacts XBRL of their own. Fundamentals live on the related listing.
 */
const FUNDAMENTALS_FACTS_TICKER_ALIASES: Record<string, string> = {
  // Rio Tinto Ltd (ASX/OTC) → Rio Tinto PLC (NYSE ADR) 20-F companyfacts
  RTNTF: "RIO",
};

function buildKnownAccessions(
  filings: FilingsFundamentalsResponse["filings"]
): Set<string> {
  const set = new Set<string>();
  for (const group of Object.values(filings)) {
    for (const row of group) {
      if (row.accessionNumber) set.add(row.accessionNumber);
    }
  }
  return set;
}

function companyFactsMissingMessage(ticker: string, cik: string): string {
  return (
    `No SEC Company Facts XBRL for ${ticker} (CIK ${cik.replace(/^0+/, "")}). ` +
    `This listing may not file structured financials in EDGAR.`
  );
}

async function loadCompanyFactsWithAlias(
  requestedTicker: string,
  ownCik: number
): Promise<{ facts: Awaited<ReturnType<typeof fetchCompanyFacts>>; sourceTicker: string | null; factsCik: number }> {
  try {
    const facts = await fetchCompanyFacts(ownCik);
    return { facts, sourceTicker: null, factsCik: ownCik };
  } catch (err) {
    const isMissing =
      err instanceof SecHttpError &&
      (err.statusCode === 404 || /NoSuchKey/i.test(err.message));
    if (!isMissing) throw err;

    const alias = FUNDAMENTALS_FACTS_TICKER_ALIASES[requestedTicker];
    if (!alias || alias === requestedTicker) {
      throw new SecHttpError(
        companyFactsMissingMessage(requestedTicker, formatSecCik(ownCik)),
        404,
        err instanceof SecHttpError ? err.url : ""
      );
    }

    await secThrottle();
    const factsCik = await lookupCikFromTicker(alias);
    try {
      const facts = await fetchCompanyFacts(factsCik);
      return { facts, sourceTicker: alias, factsCik };
    } catch (aliasErr) {
      if (aliasErr instanceof SecHttpError && aliasErr.statusCode === 404) {
        throw new SecHttpError(
          companyFactsMissingMessage(requestedTicker, formatSecCik(ownCik)),
          404,
          aliasErr.url
        );
      }
      throw aliasErr;
    }
  }
}

export async function getFilingsFundamentals(
  ticker: string,
  options: GetFilingsFundamentalsOptions = {}
): Promise<FilingsFundamentalsResponse> {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) throw new Error("Missing ticker");

  const ownCik = await lookupCikFromTicker(sym);
  const submissions = await downloadSecSubmissionsByTicker({ ticker: sym });
  await secThrottle();

  const { facts: companyFacts, sourceTicker, factsCik } = await loadCompanyFactsWithAlias(
    sym,
    ownCik
  );

  // Use the facts issuer's submissions for filing lists when we aliased
  // (Ltd may have little/no 20-F history).
  const filingsSubmissions =
    sourceTicker != null
      ? await downloadSecSubmissionsByTicker({ ticker: sourceTicker })
      : submissions;
  const filingsCik = sourceTicker != null ? factsCik : ownCik;

  const extracted = extractFinancialsFromCompanyFacts(companyFacts);
  const filings = discoverFinancialFilings(filingsSubmissions, filingsCik, {
    annualLimit: options.annualFilingLimit,
    quarterlyLimit: options.quarterlyFilingLimit,
    currentLimit: options.currentFilingLimit,
  });

  let quarterlyRows = extracted.quarterly;
  const sixKFilings = filings["10-Q"].filter((row) =>
    String(row.form || "").toUpperCase().includes("6-K")
  );
  if (shouldSupplementFromSixK(filingsSubmissions, companyFacts, quarterlyRows, sixKFilings)) {
    quarterlyRows = await supplementQuarterlyFromLatestSixK(
      filingsCik,
      rankFinancialSixKFilings(sixKFilings),
      quarterlyRows,
      { maxFilings: 3, annualRows: extracted.annual }
    );
  }

  const annual = extracted.annual.slice(0, options.annualPeriodLimit ?? 5);
  const quarterly = quarterlyRows.slice(0, options.quarterlyPeriodLimit ?? 8);
  const earningsReleases = parse8kEarningsReleases(companyFacts, filings["8-K"]);

  const sic = submissions.sic ? String(submissions.sic).trim() : null;
  const sicDescription = submissions.sicDescription
    ? String(submissions.sicDescription).trim()
    : null;
  const { sector, industry } = mapSicToSectorIndustry(sic, sicDescription);
  const companyName = submissions.name ? String(submissions.name).trim() : null;
  // Keep the requested listing's own CIK on the stocks row (identity), not the alias.
  await getStocksRepository().upsert({
    ticker: sym,
    companyName,
    sector,
    industry,
    sic,
    sicDescription,
    cik: formatSecCik(ownCik),
  });
  const stored = await getStocksRepository().getByTicker(sym);

  const derived = pickDerivedLatest(annual, quarterly);

  const response: FilingsFundamentalsResponse = {
    ticker: sym,
    cik: formatSecCik(factsCik),
    entityName: submissions.name || companyFacts.entityName || "",
    source: "sec-company-facts",
    fundamentalsSourceTicker: sourceTicker,
    classification: stored
      ? {
          sector: stored.sector,
          industry: stored.industry,
          sic: stored.sic,
          sicDescription: stored.sicDescription,
        }
      : sector || industry || sic
        ? { sector, industry, sic, sicDescription }
        : null,
    latest: extracted.latest,
    annual,
    quarterly,
    statements: {
      incomeStatement: {
        ...extracted.statements.incomeStatement,
        annual: extracted.statements.incomeStatement.annual.slice(0, options.annualPeriodLimit ?? 5),
        quarterly: extracted.statements.incomeStatement.quarterly.slice(
          0,
          options.quarterlyPeriodLimit ?? 8
        ),
      },
      balanceSheet: {
        ...extracted.statements.balanceSheet,
        annual: extracted.statements.balanceSheet.annual.slice(0, options.annualPeriodLimit ?? 5),
        quarterly: extracted.statements.balanceSheet.quarterly.slice(
          0,
          options.quarterlyPeriodLimit ?? 8
        ),
      },
      cashFlow: {
        ...extracted.statements.cashFlow,
        annual: extracted.statements.cashFlow.annual.slice(0, options.annualPeriodLimit ?? 5),
        quarterly: extracted.statements.cashFlow.quarterly.slice(
          0,
          options.quarterlyPeriodLimit ?? 8
        ),
      },
    },
    derivedLatest: derived.values,
    derivedPeriodLabels: derived.periodLabels,
    earningsReleases,
    filings,
  };

  await tryPersistFinancials({
    cik: response.cik,
    ticker: sourceTicker ?? sym,
    annual,
    quarterly,
    earningsReleases,
    knownAccessions: buildKnownAccessions(filings),
  });

  return response;
}
