/** Presentational helpers for Institutions → 13F Portfolio Performance Proxy. */

import { PORTFOLIO_PROXY_DISCLAIMER } from "./types.js";

export function portfolioProxyPageTitle(): string {
  return "Performance";
}

export function portfolioProxyDisclaimer(): string {
  return PORTFOLIO_PROXY_DISCLAIMER;
}
