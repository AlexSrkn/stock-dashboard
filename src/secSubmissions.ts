/**
 * @deprecated Import from `./sec/submissions.js` or `./sec/index.js` instead.
 */
export {
  SecSubmissionsError,
  downloadSecSubmissionsByTicker,
  downloadSecSubmissionsJson,
  lookupCikFromTicker,
  secSubmissionsUrl,
  type DownloadSecSubmissionsByTickerOptions,
  type DownloadSecSubmissionsOptions,
  type SecCompanySubmissions,
  type SecFilingsFileRef,
  type SecFilingsRecent,
} from "./sec/submissions.js";

export {
  DEFAULT_SEC_USER_AGENT as DEFAULT_USER_AGENT,
  formatSecCik,
  sanitizeSecUserAgent,
} from "./sec/http.js";
