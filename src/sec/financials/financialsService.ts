import { formatSecCik, secThrottle } from "../http.js";
import { downloadSecSubmissionsByTicker, lookupCikFromTicker } from "../submissions.js";
import { mapSicToSectorIndustry } from "../../stocks/sicMapping.js";
import { getStocksRepository } from "../../stocks/stocksRepository.js";
import { fetchCompanyFacts } from "./companyFacts.js";
import { discoverFinancialFilings } from "./discoverFilings.js";
import { pickDerivedLatest } from "./derivedMetrics.js";
import { extractFinancialsFromCompanyFacts } from "./extractFacts.js";
import { tryPersistFinancials } from "./financialsRepository.js";
import { parse8kEarningsReleases } from "./parse8kEarnings.js";
import type { FilingsFundamentalsResponse } from "./types.js";

export interface GetFilingsFundamentalsOptions {
  annualFilingLimit?: number;
  quarterlyFilingLimit?: number;
  currentFilingLimit?: number;
  annualPeriodLimit?: number;
  quarterlyPeriodLimit?: number;
}

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

export async function getFilingsFundamentals(
  ticker: string,
  options: GetFilingsFundamentalsOptions = {}
): Promise<FilingsFundamentalsResponse> {
  const sym = String(ticker || "")
    .trim()
    .toUpperCase();
  if (!sym) throw new Error("Missing ticker");

  const cik = await lookupCikFromTicker(sym);
  const submissions = await downloadSecSubmissionsByTicker({ ticker: sym });
  await secThrottle();
  const companyFacts = await fetchCompanyFacts(cik);
  const extracted = extractFinancialsFromCompanyFacts(companyFacts);
  const filings = discoverFinancialFilings(submissions, cik, {
    annualLimit: options.annualFilingLimit,
    quarterlyLimit: options.quarterlyFilingLimit,
    currentLimit: options.currentFilingLimit,
  });

  const annual = extracted.annual.slice(0, options.annualPeriodLimit ?? 5);
  const quarterly = extracted.quarterly.slice(0, options.quarterlyPeriodLimit ?? 8);
  const earningsReleases = parse8kEarningsReleases(companyFacts, filings["8-K"]);

  const sic = submissions.sic ? String(submissions.sic).trim() : null;
  const sicDescription = submissions.sicDescription
    ? String(submissions.sicDescription).trim()
    : null;
  const { sector, industry } = mapSicToSectorIndustry(sic, sicDescription);
  const companyName = submissions.name ? String(submissions.name).trim() : null;
  await getStocksRepository().upsert({
    ticker: sym,
    companyName,
    sector,
    industry,
    sic,
    sicDescription,
    cik: formatSecCik(cik),
  });
  const stored = await getStocksRepository().getByTicker(sym);

    const derived = pickDerivedLatest(annual, quarterly);

  const response: FilingsFundamentalsResponse = {
    ticker: sym,
    cik: formatSecCik(cik),
    entityName: submissions.name || companyFacts.entityName || "",
    source: "sec-company-facts",
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
    ticker: sym,
    annual,
    quarterly,
    earningsReleases,
    knownAccessions: buildKnownAccessions(filings),
  });

  return response;
}
