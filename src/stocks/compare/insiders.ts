import type pg from "pg";
import type { InsiderTransactionRow } from "../../db/insiderTransactions.js";
import { getInsiderTransactions } from "../../insider/insiderAnalytics.js";
import { getCachedRepeatBuyers } from "../../insider/repeatBuyers/cache.js";
import { getCachedFirstTimeBuyers } from "../../insider/firstTimeBuyers/cache.js";
import { getCachedHeavySelling } from "../../insider/heavySelling/cache.js";
import { getCachedInsiderClusterForTicker } from "../../insiderCluster/cache.js";
import type { CompareInsiders, OverlapInsider } from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nameKey(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inWindow(iso: string | null, start: string | null): boolean {
  if (!start) return true;
  if (!iso) return false;
  return String(iso).slice(0, 10) >= start;
}

function isBuy(row: InsiderTransactionRow): boolean {
  const code = String(row.transactionCode || "").toUpperCase();
  const ad = String(row.acquisitionDisposition || "").toUpperCase();
  return code === "P" || ad === "A";
}

function isSell(row: InsiderTransactionRow): boolean {
  const code = String(row.transactionCode || "").toUpperCase();
  const ad = String(row.acquisitionDisposition || "").toUpperCase();
  return code === "S" || ad === "D";
}

function isOpenMarketBuy(row: InsiderTransactionRow): boolean {
  return String(row.transactionCode || "").toUpperCase() === "P" && !row.isDerivative;
}

function isOpenMarketSell(row: InsiderTransactionRow): boolean {
  return String(row.transactionCode || "").toUpperCase() === "S" && !row.isDerivative;
}

export async function buildInsiderSide(
  pool: pg.Pool,
  ticker: string,
  periodStart: string | null
): Promise<{ stats: CompareInsiders; transactions: InsiderTransactionRow[] }> {
  const sym = String(ticker).trim().toUpperCase();
  try {
    const { transactions: raw } = await getInsiderTransactions(
      sym,
      { limit: 500, sort: "date" },
      pool
    );
    const transactions = raw.filter((t) =>
      inWindow(t.transactionDate || t.filingDate, periodStart)
    );

    const buys = transactions.filter(isBuy);
    const sells = transactions.filter(isSell);
    const buyers = new Set(buys.map((t) => nameKey(t.insiderName)).filter(Boolean));
    const sellers = new Set(sells.map((t) => nameKey(t.insiderName)).filter(Boolean));

    const buyValue = buys.reduce((s, t) => s + (Number(t.transactionValue) || 0), 0);
    const sellValue = sells.reduce((s, t) => s + (Number(t.transactionValue) || 0), 0);

    const repeatCache = getCachedRepeatBuyers();
    const firstCache = getCachedFirstTimeBuyers();
    const heavyCache = getCachedHeavySelling();
    const cluster = getCachedInsiderClusterForTicker(sym, 90);

    const repeatBuyers =
      repeatCache?.rows?.filter((r) => String(r.ticker).toUpperCase() === sym).length ?? 0;
    const firstTimeBuyers =
      firstCache?.rows?.filter((r) => String(r.ticker).toUpperCase() === sym).length ?? 0;
    const heavySelling =
      (heavyCache?.rows?.some((r) => String(r.ticker).toUpperCase() === sym) ?? false) ||
      null;
    const clusterBuying =
      cluster != null ? Boolean(cluster.clusterAlert || cluster.buyerCount >= 3) : null;

    const available = transactions.length > 0 || repeatBuyers > 0 || firstTimeBuyers > 0;

    return {
      stats: {
        buyTransactions: buys.length,
        sellTransactions: sells.length,
        uniqueBuyers: buyers.size,
        uniqueSellers: sellers.size,
        estimatedBuyValue: buyValue > 0 ? round2(buyValue) : buys.length ? 0 : null,
        estimatedSellValue: sellValue > 0 ? round2(sellValue) : sells.length ? 0 : null,
        openMarketBuys: transactions.filter(isOpenMarketBuy).length,
        openMarketSells: transactions.filter(isOpenMarketSell).length,
        repeatBuyers,
        firstTimeBuyers,
        clusterBuying,
        heavySelling,
        available,
      },
      transactions,
    };
  } catch {
    return {
      stats: {
        buyTransactions: null,
        sellTransactions: null,
        uniqueBuyers: null,
        uniqueSellers: null,
        estimatedBuyValue: null,
        estimatedSellValue: null,
        openMarketBuys: null,
        openMarketSells: null,
        repeatBuyers: null,
        firstTimeBuyers: null,
        clusterBuying: null,
        heavySelling: null,
        available: false,
      },
      transactions: [],
    };
  }
}

export function buildInsiderOverlap(
  txsA: InsiderTransactionRow[],
  txsB: InsiderTransactionRow[]
): { count: number; items: OverlapInsider[] } {
  type Agg = {
    name: string;
    role: string | null;
    buys: number;
    sells: number;
    latest: string | null;
  };
  const mapSide = (txs: InsiderTransactionRow[]) => {
    const m = new Map<string, Agg>();
    for (const t of txs) {
      const key = nameKey(t.insiderName);
      if (!key) continue;
      let g = m.get(key);
      if (!g) {
        g = { name: t.insiderName, role: t.insiderTitle, buys: 0, sells: 0, latest: null };
        m.set(key, g);
      }
      if (isBuy(t)) g.buys += 1;
      if (isSell(t)) g.sells += 1;
      const d = t.transactionDate || t.filingDate;
      if (d && (!g.latest || d > g.latest)) g.latest = d;
      if (!g.role && t.insiderTitle) g.role = t.insiderTitle;
    }
    return m;
  };
  const a = mapSide(txsA);
  const b = mapSide(txsB);
  const items: OverlapInsider[] = [];
  for (const [key, ga] of a) {
    const gb = b.get(key);
    if (!gb) continue;
    const activity = (g: Agg) => {
      const parts = [];
      if (g.buys) parts.push(`${g.buys} buy${g.buys === 1 ? "" : "s"}`);
      if (g.sells) parts.push(`${g.sells} sell${g.sells === 1 ? "" : "s"}`);
      return parts.join(", ") || "Traded";
    };
    const latest =
      ga.latest && gb.latest
        ? ga.latest > gb.latest
          ? ga.latest
          : gb.latest
        : ga.latest || gb.latest;
    items.push({
      name: ga.name,
      role: ga.role || gb.role,
      activityA: activity(ga),
      activityB: activity(gb),
      latestDate: latest,
    });
  }
  items.sort((x, y) => String(y.latestDate || "").localeCompare(String(x.latestDate || "")));
  return { count: items.length, items: items.slice(0, 40) };
}
