import { getPool, loadEnvFile, closePool } from "../src/db/pool.js";

import { getHolderOverlap } from "../src/stocks/holderOverlap/service.js";



loadEnvFile();



const url = new URL("http://localhost/api/stocks/holder-overlap?ticker=NVDA&mode=weighted&page=1&pageSize=5");

const t0 = Date.now();

try {

  const payload = await getHolderOverlap(url, getPool());

  console.log(

    JSON.stringify(

      {

        ms: Date.now() - t0,

        summary: payload.summary,

        mode: payload.mode,

        total: payload.total,

        stocks: payload.stocks,

        institutions: payload.institutions.slice(0, 3),

        insiders: payload.insiders.slice(0, 2),

        politicians: payload.politicians.slice(0, 2),

      },

      null,

      2

    )

  );

} catch (err) {

  console.error(err);

  process.exitCode = 1;

} finally {

  await closePool();

}


