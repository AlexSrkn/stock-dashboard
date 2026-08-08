import {
  buildAcknowledgementBody,
  cookieHeader,
  extractCsrfToken,
  extractFormAction,
  isAcknowledgementGate,
  storeSetCookies,
} from "../src/politicians/acknowledgementGate.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const jar = new Map();

async function main() {
  let res = await fetch("https://efdsearch.senate.gov/search/home/", {
    headers: { "User-Agent": UA },
  });
  storeSetCookies(jar, res);
  let html = await res.text();
  console.log("GET home", res.status, "gate?", isAcknowledgementGate(html), "csrf?", Boolean(extractCsrfToken(html)));

  const body = buildAcknowledgementBody(html);
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
  console.log("POST agree", res.status, "location", res.headers.get("location"));
  const postHtml = await res.text();
  console.log("POST gate?", isAcknowledgementGate(postHtml), "len", postHtml.length);

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    const nextUrl = loc?.startsWith("http") ? loc : `https://efdsearch.senate.gov${loc}`;
    res = await fetch(nextUrl, {
      headers: { "User-Agent": UA, Cookie: cookieHeader(jar) },
    });
    storeSetCookies(jar, res);
    html = await res.text();
    console.log("FOLLOW", res.status, res.url, "gate?", isAcknowledgementGate(html));
  }

  res = await fetch("https://efdsearch.senate.gov/search/", {
    headers: { "User-Agent": UA, Cookie: cookieHeader(jar) },
  });
  storeSetCookies(jar, res);
  html = await res.text();
  console.log("GET search", res.status, "gate?", isAcknowledgementGate(html), "csrf?", Boolean(extractCsrfToken(html)));
}

main().catch(console.error);
