import type { PoliticianTrade } from "../../politicians/types.js";
import {
  getCongressTradesForTicker,
  isCongressBuy,
  isCongressSell,
} from "../../politicians/byTicker.js";
import { politicianKey } from "../../politicians/politicianKey.js";
import { estimatedValue } from "../../politicians/heavySelling/dates.js";
import type { ComparePoliticians, OverlapPolitician } from "./types.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function tradeKey(trade: PoliticianTrade): string {
  return trade.politicianKey || politicianKey(trade.politicianName);
}

function inWindow(iso: string | null, start: string | null): boolean {
  if (!start) return true;
  if (!iso) return false;
  return String(iso).slice(0, 10) >= start;
}

function partyBucket(party: string | null | undefined): "democrat" | "republican" | "other" {
  const p = String(party || "").toLowerCase();
  if (p.includes("democrat")) return "democrat";
  if (p.includes("republican")) return "republican";
  return "other";
}

export function buildPoliticianSide(
  ticker: string,
  periodStart: string | null
): { stats: ComparePoliticians; trades: PoliticianTrade[] } {
  const sym = String(ticker).trim().toUpperCase();
  const { trades: raw } = getCongressTradesForTicker(sym);
  const trades = raw.filter((t) =>
    inWindow(t.transactionDate || t.notificationDate || t.filingDate, periodStart)
  );

  const buys = trades.filter(isCongressBuy);
  const sells = trades.filter(isCongressSell);
  const buyerKeys = new Set(buys.map(tradeKey).filter(Boolean));
  const sellerKeys = new Set(sells.map(tradeKey).filter(Boolean));

  const buyValue = buys.reduce((s, t) => s + estimatedValue(t.amountMin, t.amountMax), 0);
  const sellValue = sells.reduce((s, t) => s + estimatedValue(t.amountMin, t.amountMax), 0);

  const buysByKey = new Map<string, number>();
  for (const t of buys) {
    const k = tradeKey(t);
    if (!k) continue;
    buysByKey.set(k, (buysByKey.get(k) || 0) + 1);
  }
  const repeatBuyers = [...buysByKey.values()].filter((n) => n >= 2).length;
  const firstTimeBuyers = [...buysByKey.values()].filter((n) => n === 1).length;

  const sellsByKey = new Map<string, { n: number; v: number }>();
  for (const t of sells) {
    const k = tradeKey(t);
    if (!k) continue;
    const prev = sellsByKey.get(k) || { n: 0, v: 0 };
    prev.n += 1;
    prev.v += estimatedValue(t.amountMin, t.amountMax);
    sellsByKey.set(k, prev);
  }

  const heavyBuying = [...buysByKey.values()].some((n) => n >= 3);
  const heavySelling = [...sellsByKey.values()].some((x) => x.n >= 2 || x.v >= 50_000);

  const countParty = (list: PoliticianTrade[], bucket: "democrat" | "republican" | "other") => {
    const keys = new Set(
      list.filter((t) => partyBucket(t.party) === bucket).map(tradeKey).filter(Boolean)
    );
    return keys.size;
  };

  const countChamber = (list: PoliticianTrade[], chamber: "senate" | "house") => {
    const keys = new Set(
      list.filter((t) => t.chamber === chamber).map(tradeKey).filter(Boolean)
    );
    return keys.size;
  };

  const latestActivityDate =
    trades
      .map((t) => t.transactionDate || t.notificationDate || t.filingDate)
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null;

  return {
    stats: {
      buyTransactions: buys.length,
      sellTransactions: sells.length,
      uniqueBuyers: buyerKeys.size,
      uniqueSellers: sellerKeys.size,
      estimatedBuyValue: buyValue > 0 ? round2(buyValue) : buys.length ? 0 : null,
      estimatedSellValue: sellValue > 0 ? round2(sellValue) : sells.length ? 0 : null,
      repeatBuyers,
      firstTimeBuyers,
      heavyBuying: buys.length ? heavyBuying : null,
      heavySelling: sells.length ? heavySelling : null,
      democratBuyers: countParty(buys, "democrat"),
      republicanBuyers: countParty(buys, "republican"),
      otherBuyers: countParty(buys, "other"),
      democratSellers: countParty(sells, "democrat"),
      republicanSellers: countParty(sells, "republican"),
      otherSellers: countParty(sells, "other"),
      senatorBuyers: countChamber(buys, "senate"),
      representativeBuyers: countChamber(buys, "house"),
      senatorSellers: countChamber(sells, "senate"),
      representativeSellers: countChamber(sells, "house"),
      latestActivityDate,
      available: trades.length > 0,
    },
    trades,
  };
}

export function buildPoliticianOverlap(
  tradesA: PoliticianTrade[],
  tradesB: PoliticianTrade[]
): { count: number; items: OverlapPolitician[] } {
  type Agg = {
    name: string;
    party: string | null;
    chamber: string | null;
    buys: number;
    sells: number;
    latest: string | null;
  };
  const mapSide = (trades: PoliticianTrade[]) => {
    const m = new Map<string, Agg>();
    for (const t of trades) {
      const key = tradeKey(t);
      if (!key) continue;
      let g = m.get(key);
      if (!g) {
        g = {
          name: t.politicianName,
          party: t.party ?? null,
          chamber: t.chamber,
          buys: 0,
          sells: 0,
          latest: null,
        };
        m.set(key, g);
      }
      if (isCongressBuy(t)) g.buys += 1;
      if (isCongressSell(t)) g.sells += 1;
      const d = t.transactionDate || t.notificationDate || t.filingDate;
      if (d && (!g.latest || d > g.latest)) g.latest = d;
      if (!g.party && t.party) g.party = t.party;
    }
    return m;
  };
  const a = mapSide(tradesA);
  const b = mapSide(tradesB);
  const items: OverlapPolitician[] = [];
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
      party: ga.party || gb.party,
      chamber: ga.chamber || gb.chamber,
      activityA: activity(ga),
      activityB: activity(gb),
      latestTransaction: latest,
    });
  }
  items.sort((x, y) =>
    String(y.latestTransaction || "").localeCompare(String(x.latestTransaction || ""))
  );
  return { count: items.length, items: items.slice(0, 40) };
}
