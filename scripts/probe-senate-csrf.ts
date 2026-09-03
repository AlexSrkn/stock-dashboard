import {
  buildAcknowledgementBody,
  cookieHeader,
  csrfHeader,
  extractCsrfToken,
  extractFormAction,
  isAcknowledgementGate,
  storeSetCookies,
} from "../src/politicians/acknowledgementGate.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const jar = new Map<string, string>();

function log(...args: unknown[]) {
  console.log(...args);
}

async function main() {
  let res = await fetch("https://efdsearch.senate.gov/search/home/", {
    headers: { "User-Agent": UA },
  });
  storeSetCookies(jar, res);
  let html = await res.text();
  log("GET home", {
    status: res.status,
    gate: isAcknowledgementGate(html),
    csrf: extractCsrfToken(html)?.slice(0, 12) ?? null,
    cookieCsrf: csrfHeader(jar)?.slice(0, 12) ?? null,
    setCookies: res.headers.getSetCookie?.() ?? [],
    jarKeys: [...jar.keys()],
    htmlLen: html.length,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim(),
    csrfInput: html.match(/<input[^>]*csrf[^>]*>/i)?.[0] ?? null,
  });

  const body = buildAcknowledgementBody(html);
  log("ack body keys", [...body.keys()]);

  res = await fetch(extractFormAction(html, "https://efdsearch.senate.gov/search/home/"), {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(jar),
      Referer: "https://efdsearch.senate.gov/search/home/",
      Origin: "https://efdsearch.senate.gov",
    },
    body,
    redirect: "manual",
  });
  storeSetCookies(jar, res);
  const postHtml = await res.text();
  log("POST agree", {
    status: res.status,
    location: res.headers.get("location"),
    jarKeys: [...jar.keys()],
    cookieCsrf: csrfHeader(jar)?.slice(0, 12) ?? null,
    postLen: postHtml.length,
    postGate: isAcknowledgementGate(postHtml),
    postTitle: postHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim(),
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    const nextUrl = loc?.startsWith("http") ? loc! : `https://efdsearch.senate.gov${loc}`;
    res = await fetch(nextUrl, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(jar), Referer: "https://efdsearch.senate.gov/search/home/" },
    });
    storeSetCookies(jar, res);
    html = await res.text();
    log("FOLLOW", {
      status: res.status,
      url: res.url,
      gate: isAcknowledgementGate(html),
      csrf: extractCsrfToken(html)?.slice(0, 12) ?? null,
      cookieCsrf: csrfHeader(jar)?.slice(0, 12) ?? null,
      htmlLen: html.length,
      title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim(),
    });
  }

  res = await fetch("https://efdsearch.senate.gov/search/", {
    headers: {
      "User-Agent": UA,
      Cookie: cookieHeader(jar),
      Referer: "https://efdsearch.senate.gov/search/home/",
    },
  });
  storeSetCookies(jar, res);
  html = await res.text();
  log("GET search", {
    status: res.status,
    gate: isAcknowledgementGate(html),
    csrf: extractCsrfToken(html)?.slice(0, 12) ?? null,
    cookieCsrf: csrfHeader(jar)?.slice(0, 12) ?? null,
    jarKeys: [...jar.keys()],
    htmlLen: html.length,
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim(),
    csrfInputs: [...html.matchAll(/<input[^>]*(?:csrf|CSRF)[^>]*>/gi)].map((m) => m[0]).slice(0, 5),
    snippet: html.slice(0, 400).replace(/\s+/g, " "),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
