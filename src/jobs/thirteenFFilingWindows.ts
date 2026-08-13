/**
 * SEC 13F-HR filing windows (period-end → filing deadline).
 * Dates match the public calendar you specified (e.g. Q2 2026: Jun 30 – Aug 14).
 * Windows are year-generic so the daily job keeps working past 2026.
 */

export type ThirteenFFilingWindow = {
  /** e.g. "Q2 2026" */
  label: string;
  /** Inclusive YYYY-MM-DD (period end / window open) */
  start: string;
  /** Inclusive YYYY-MM-DD (filing deadline / window close) */
  end: string;
  periodYear: number;
  quarter: 1 | 2 | 3 | 4;
};

const DEFAULT_TZ = "America/New_York";

/** Calendar date YYYY-MM-DD in a given IANA timezone. */
export function calendarDateInTz(date: Date = new Date(), timeZone: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Filing windows for a given calendar year’s quarter period-ends. */
export function thirteenFFilingWindowsForPeriodYear(periodYear: number): ThirteenFFilingWindow[] {
  return [
    {
      label: `Q1 ${periodYear}`,
      periodYear,
      quarter: 1,
      start: `${periodYear}-03-31`,
      end: `${periodYear}-05-15`,
    },
    {
      label: `Q2 ${periodYear}`,
      periodYear,
      quarter: 2,
      start: `${periodYear}-06-30`,
      end: `${periodYear}-08-14`,
    },
    {
      label: `Q3 ${periodYear}`,
      periodYear,
      quarter: 3,
      start: `${periodYear}-09-30`,
      end: `${periodYear}-11-16`,
    },
    {
      label: `Q4 ${periodYear}`,
      periodYear,
      quarter: 4,
      start: `${periodYear}-12-31`,
      end: `${periodYear + 1}-02-16`,
    },
  ];
}

/**
 * Active 13F scrape window for a calendar day (US Eastern by default).
 * Checks prior + current period-year so Q4 spillover into Jan/Feb is covered.
 */
export function getActiveThirteenFFilingWindow(
  date: Date = new Date(),
  timeZone: string = DEFAULT_TZ
): ThirteenFFilingWindow | null {
  const ymd = calendarDateInTz(date, timeZone);
  const year = Number(ymd.slice(0, 4));
  const windows = [
    ...thirteenFFilingWindowsForPeriodYear(year - 1),
    ...thirteenFFilingWindowsForPeriodYear(year),
  ];
  return windows.find((w) => ymd >= w.start && ymd <= w.end) ?? null;
}

export function isInsideThirteenFFilingWindow(
  date: Date = new Date(),
  timeZone: string = DEFAULT_TZ
): boolean {
  return getActiveThirteenFFilingWindow(date, timeZone) != null;
}
