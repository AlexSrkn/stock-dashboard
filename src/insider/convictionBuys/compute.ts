import type pg from "pg";
import { getPool } from "../../db/pool.js";
import { loadOpenMarketBuys, loadSharesOutstandingMap } from "./queries.js";
import { convictionRoleLabel, convictionRoleWeight } from "./roleWeights.js";
import {
  computeConvictionScore,
  convictionLabel,
  ownershipIncreaseToScore,
  parseDateMs,
  percentileScores,
  repeatBuyComposite,
  roleScoreFromWeight,
  round1,
  round2,
} from "./score.js";
import type { ConvictionBuyRow, ConvictionBuysCachePayload, RawOpenMarketBuy } from "./types.js";

const MS_PER_DAY = 86_400_000;
const LOOKBACK_12M_MS = 365 * MS_PER_DAY;

function insiderKey(row: Pick<RawOpenMarketBuy, "ticker" | "insiderName">): string {
  return `${row.ticker}::${row.insiderName.trim().toLowerCase()}`;
}

function sortChronological(a: RawOpenMarketBuy, b: RawOpenMarketBuy): number {
  const da = parseDateMs(a.transactionDate) || parseDateMs(a.filingDate) || 0;
  const db = parseDateMs(b.transactionDate) || parseDateMs(b.filingDate) || 0;
  if (da !== db) return da - db;
  return a.id - b.id;
}

/**
 * Estimate ownership increase using cumulative prior open-market purchases
 * for the same insider+ticker (Form 4 post-transaction shares are not ingested).
 * First observed buy → 100% increase (new / establishing position).
 */
function attachOwnershipAndRepeat(rows: RawOpenMarketBuy[]): Array<
  RawOpenMarketBuy & {
    ownershipIncreasePercent: number;
    purchasesLast12Months: number;
    amountInvestedLast12Months: number;
  }
> {
  const sorted = [...rows].sort(sortChronological);
  const priorShares = new Map<string, number>();
  const history = new Map<string, Array<{ t: number; value: number }>>();

  const out: Array<
    RawOpenMarketBuy & {
      ownershipIncreasePercent: number;
      purchasesLast12Months: number;
      amountInvestedLast12Months: number;
    }
  > = [];

  for (const row of sorted) {
    const key = insiderKey(row);
    const prior = priorShares.get(key) ?? 0;
    const ownershipIncreasePercent =
      prior > 0 ? round2((row.shares / prior) * 100) : 100;

    const t =
      parseDateMs(row.transactionDate) || parseDateMs(row.filingDate) || Date.now();
    const hist = history.get(key) ?? [];
    const windowStart = t - LOOKBACK_12M_MS;
    let purchasesLast12Months = 0;
    let amountInvestedLast12Months = 0;
    for (const h of hist) {
      if (h.t >= windowStart && h.t <= t) {
        purchasesLast12Months += 1;
        amountInvestedLast12Months += h.value;
      }
    }
    // Include this purchase in the 12m window.
    purchasesLast12Months += 1;
    amountInvestedLast12Months += row.valueUsd;

    out.push({
      ...row,
      ownershipIncreasePercent,
      purchasesLast12Months,
      amountInvestedLast12Months: round2(amountInvestedLast12Months),
    });

    priorShares.set(key, prior + row.shares);
    hist.push({ t, value: row.valueUsd });
    history.set(key, hist);
  }

  return out;
}

export async function computeConvictionBuys(
  pool: pg.Pool = getPool()
): Promise<ConvictionBuysCachePayload> {
  const [rawBuys, sharesOutstanding] = await Promise.all([
    loadOpenMarketBuys(pool),
    loadSharesOutstandingMap(pool),
  ]);

  const enriched = attachOwnershipAndRepeat(rawBuys);
  const sizeScores = percentileScores(enriched.map((r) => r.valueUsd));
  const countScores = percentileScores(enriched.map((r) => r.purchasesLast12Months));
  const amountScores = percentileScores(enriched.map((r) => r.amountInvestedLast12Months));

  const rows: ConvictionBuyRow[] = enriched.map((row, i) => {
    const roleWeight = convictionRoleWeight(row.insiderTitle);
    const role = convictionRoleLabel(row.insiderTitle);
    const purchaseSizeScore = sizeScores[i] ?? 0;
    const ownershipIncreaseScore = ownershipIncreaseToScore(row.ownershipIncreasePercent);
    const roleScore = roleScoreFromWeight(roleWeight);
    const repeatBuyScore = repeatBuyComposite(countScores[i] ?? 0, amountScores[i] ?? 0);
    const convictionScore = computeConvictionScore({
      purchaseSizeScore,
      ownershipIncreaseScore,
      roleScore,
      repeatBuyScore,
    });

    const so = sharesOutstanding.get(row.ticker);
    const px =
      row.pricePerShare != null && row.pricePerShare > 0
        ? row.pricePerShare
        : row.shares > 0
          ? row.valueUsd / row.shares
          : null;
    const marketCapUsd =
      so != null && px != null && px > 0 ? round2(so * px) : null;

    return {
      id: row.id,
      ticker: row.ticker,
      companyName: row.companyName,
      sector: row.sector,
      marketCapUsd,
      insiderName: row.insiderName,
      insiderTitle: row.insiderTitle,
      role,
      filingDate: row.filingDate,
      transactionDate: row.transactionDate,
      shares: round2(row.shares),
      pricePerShare: row.pricePerShare != null ? round2(row.pricePerShare) : null,
      valueUsd: round2(row.valueUsd),
      ownershipIncreasePercent: row.ownershipIncreasePercent,
      purchasesLast12Months: row.purchasesLast12Months,
      amountInvestedLast12Months: row.amountInvestedLast12Months,
      convictionScore,
      convictionLabel: convictionLabel(convictionScore),
      purchaseSizeScore: round1(purchaseSizeScore),
      ownershipIncreaseScore: round1(ownershipIncreaseScore),
      roleScore: round1(roleScore),
      repeatBuyScore: round1(repeatBuyScore),
      roleWeight,
    };
  });

  rows.sort(
    (a, b) =>
      b.convictionScore - a.convictionScore ||
      b.valueUsd - a.valueUsd ||
      b.id - a.id
  );

  const sectors = [
    ...new Set(rows.map((r) => r.sector).filter((s): s is string => Boolean(s))),
  ].sort((a, b) => a.localeCompare(b));

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    rows,
    sectors,
  };
}
