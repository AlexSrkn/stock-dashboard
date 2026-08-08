/**
 * Precompute insider conviction cluster signals.
 * Usage: npm run insider-clusters:warm-cache
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import {
  DEFAULT_CLUSTER_LOOKBACK_DAYS,
  getInsiderClusterService,
  saveInsiderClusterSignalsToDisk,
  type ClusterLookbackDays,
} from "../src/insiderCluster/index.js";

loadEnvFile();

const service = getInsiderClusterService();
const windows: ClusterLookbackDays[] = [30, 60, 90];

for (const days of windows) {
  const signals = await service.computeAll(days);
  if (!signals.length) {
    console.warn(`No insider cluster signals for ${days}d window.`);
    continue;
  }
  saveInsiderClusterSignalsToDisk(signals, days);
  const alerts = signals.filter((s) => s.clusterAlert).length;
  console.log(
    `Insider cluster cache saved (${days}d): ${signals.length} tickers, ${alerts} alerts → data/cache/insider-cluster-signals-${days}d.json`
  );
}

console.log(`Default window: ${DEFAULT_CLUSTER_LOOKBACK_DAYS} days`);
await closePool();
