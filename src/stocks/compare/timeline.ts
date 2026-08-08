import type pg from "pg";
import type { InsiderTransactionRow } from "../../db/insiderTransactions.js";
import type { PoliticianTrade } from "../../politicians/types.js";
import { isCongressBuy, isCongressSell } from "../../politicians/byTicker.js";
import { getInstitutionalChartEvents } from "../../ownership/ownershipAnalytics.js";
import type { ComparePeriod, CompareTimelineEvent } from "./types.js";
import { institutionalChartQuarters, periodStartDate } from "./period.js";

function inWindow(iso: string | null, start: string | null): boolean {
  if (!start) return true;
  if (!iso) return false;
  return String(iso).slice(0, 10) >= start;
}

export async function buildCompareTimeline(
  pool: pg.Pool,
  tickerA: string,
  tickerB: string,
  period: ComparePeriod,
  insiderA: InsiderTransactionRow[],
  insiderB: InsiderTransactionRow[],
  polA: PoliticianTrade[],
  polB: PoliticianTrade[]
): Promise<CompareTimelineEvent[]> {
  const start = periodStartDate(period);
  const quarters = institutionalChartQuarters(period);
  const events: CompareTimelineEvent[] = [];

  const loadInst = async (ticker: string, side: "A" | "B") => {
    try {
      const res = await getInstitutionalChartEvents(pool, ticker, { quarters, limit: 80 });
      for (const e of res.events) {
        const date = e.filingDate;
        if (!date || !inWindow(date, start)) continue;
        const type = e.eventType || e.side || "activity";
        events.push({
          date: String(date).slice(0, 10),
          ticker,
          side,
          source: "institutional",
          type: String(type),
          label: `${e.fundName || "Institution"} · ${type}`,
          detail: e.sharesChange != null ? `${e.sharesChange} shares` : null,
        });
      }
    } catch {
      /* missing 13F */
    }
  };

  await Promise.all([loadInst(tickerA, "A"), loadInst(tickerB, "B")]);

  const addInsider = (txs: InsiderTransactionRow[], ticker: string, side: "A" | "B") => {
    for (const t of txs) {
      const date = t.transactionDate || t.filingDate;
      if (!date || !inWindow(date, start)) continue;
      const code = String(t.transactionCode || "").toUpperCase();
      const type = code === "P" || String(t.acquisitionDisposition).toUpperCase() === "A" ? "buy" : "sell";
      events.push({
        date: String(date).slice(0, 10),
        ticker,
        side,
        source: "insider",
        type,
        label: `Insider ${type}: ${t.insiderName}`,
        detail: t.transactionValue != null ? `$${Math.round(t.transactionValue).toLocaleString()}` : null,
      });
    }
  };
  addInsider(insiderA, tickerA, "A");
  addInsider(insiderB, tickerB, "B");

  const addPol = (trades: PoliticianTrade[], ticker: string, side: "A" | "B") => {
    for (const t of trades) {
      const date = t.transactionDate || t.notificationDate || t.filingDate;
      if (!date || !inWindow(date, start)) continue;
      const type = isCongressBuy(t) ? "buy" : isCongressSell(t) ? "sell" : "other";
      events.push({
        date: String(date).slice(0, 10),
        ticker,
        side,
        source: "politician",
        type,
        label: `Politician ${type}: ${t.politicianName}`,
        detail: t.amountRange,
      });
    }
  };
  addPol(polA, tickerA, "A");
  addPol(polB, tickerB, "B");

  events.sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));
  return events.slice(0, 120);
}
