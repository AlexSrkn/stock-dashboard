import { loadEnvFile } from "../src/db/pool.js";
import { getFilingsFundamentals } from "../src/sec/financials/financialsService.js";

loadEnvFile();

const ticker = process.argv[2] || "AAPL";
const data = await getFilingsFundamentals(ticker);
console.log(
  JSON.stringify(
    {
      ticker: data.ticker,
      entityName: data.entityName,
      latestKeys: Object.keys(data.latest),
      revenue: data.latest.revenue?.value,
      annualPeriods: data.annual.length,
      quarterlyPeriods: data.quarterly.length,
      earningsReleases: data.earningsReleases?.length ?? 0,
      derivedLatest: data.derivedLatest,
      filings10K: data.filings["10-K"].length,
      filings10Q: data.filings["10-Q"].length,
      filings8K: data.filings["8-K"].length,
    },
    null,
    2
  )
);
