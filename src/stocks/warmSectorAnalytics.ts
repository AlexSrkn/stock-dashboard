import { getPool } from "../db/pool.js";
import { loadSectorAccumulation } from "./sectorAccumulation.js";
import { loadSectorBuying } from "./sectorBuying.js";
import { loadSectorSelling } from "./sectorSelling.js";
import { loadSectorFundamentals } from "./sectorFundamentals.js";
import { loadInstitutionalConcentration } from "./institutionalConcentration.js";

let warming = false;

/**
 * Warm heavy sector analytics in the background after boot so the first
 * user click does not wait on multi-minute sec_holding CUSIP scans.
 *
 * Disk-backed caches (accumulation / leaders / selling) hydrate first.
 * Institutional concentration (memory-only, slower) is deferred so it does
 * not block the event loop right after startup.
 */
export function warmSectorAnalyticsOnStartup(): void {
  if (warming) return;
  warming = true;
  void (async () => {
    const pool = getPool();
    const t0 = Date.now();
    console.log("Sector analytics: warming caches in background…");
    try {
      await loadSectorFundamentals(pool);
      console.log("Sector analytics: fundamentals ready");
      await loadSectorAccumulation(pool);
      console.log("Sector analytics: accumulation ready");
      await loadSectorBuying(pool);
      console.log("Sector analytics: leaders (buying) ready");
      await loadSectorSelling(pool);
      console.log("Sector analytics: selling ready");
      console.log(
        `Sector analytics: hot-path caches ready (${Date.now() - t0}ms); concentration deferred`
      );
      setTimeout(() => {
        void loadInstitutionalConcentration(pool)
          .then(() =>
            console.log(
              `Sector analytics: institutional concentration ready (total ${Date.now() - t0}ms)`
            )
          )
          .catch((err) =>
            console.warn(
              "Sector analytics concentration warm failed:",
              err instanceof Error ? err.message : String(err)
            )
          );
      }, 5_000);
    } catch (err) {
      console.warn(
        "Sector analytics warm failed:",
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      warming = false;
    }
  })();
}
