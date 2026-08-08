import {
  buildAcknowledgementBody,
  cookieHeader,
  extractFormAction,
  isAcknowledgementGate,
  storeSetCookies,
} from "../src/politicians/acknowledgementGate.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ORIGIN = "https://efdsearch.senate.gov";
const PTR_URL = `${ORIGIN}/search/view/ptr/727b4eb6-d8c7-4792-aa5b-c651c2d72f9c/`;

const jar = new Map();

async function fetchWithJar(url, init = {}) {
  const headers = { "User-Agent": UA, ...init.headers };
  const cookies = cookieHeader(jar);
  if (cookies) headers.Cookie = cookies;
  const res = await fetch(url, { ...init, headers });
  storeSetCookies(jar, res);
  return res;
}

async function passGate() {
  let res = await fetchWithJar(`${ORIGIN}/search/home/`);
  let html = await res.text();
  if (!isAcknowledgementGate(html)) return;
  const body = buildAcknowledgementBody(html);
  res = await fetchWithJar(extractFormAction(html, `${ORIGIN}/search/home/`), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${ORIGIN}/search/home/`,
      Origin: ORIGIN,
    },
    body,
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    const next = loc.startsWith("http") ? loc : `${ORIGIN}${loc}`;
    res = await fetchWithJar(next, { headers: { Referer: `${ORIGIN}/search/home/` } });
    await res.text();
  }
}

async function main() {
  await passGate();
  const res = await fetchWithJar(PTR_URL, { headers: { Referer: `${ORIGIN}/search/` } });
  const html = await res.text();
  console.log("PTR status:", res.status, "gate?", isAcknowledgementGate(html), "len:", html.length);
  console.log("title:", html.match(/<title>([^<]+)/i)?.[1]);
  console.log("has table:", /<table/i.test(html));
  const name =
    html.match(/Name:\s*<\/[^>]+>\s*<[^>]+>([^<]+)/i)?.[1] ??
    html.match(/Filer Name[^<]*<[^>]+>([^<]+)/i)?.[1] ??
    html.match(/<h1[^>]*>([^<]+)/i)?.[1];
  console.log("filer hint:", name);
  const reportDate = html.match(/Report Date[^<]*<[^>]+>([^<]+)/i)?.[1];
  console.log("report date:", reportDate);
  const rows = [...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)].length;
  console.log("tr count:", rows);
  const firstRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, 5);
  for (const [i, m] of firstRows.entries()) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
    );
    if (cells.length) console.log(`row ${i}:`, cells);
  }
  const textOnly = html.replace(/<[^>]+>/g, "\n").replace(/\s+/g, " ").trim();
  const senator = textOnly.match(/Senator\s+([A-Za-z.'\-\s]+?)\s+State:/i)?.[1];
  console.log("senator:", senator);
  const labels = [...html.matchAll(/<(?:th|td)[^>]*>\s*([^<]{2,40})\s*<\/(?:th|td)>/gi)]
    .map((m) => m[1].trim())
    .filter((s) => /name|filer|senator|office|state/i.test(s))
    .slice(0, 15);
  console.log("label cells:", labels);
  const headerBlock = html.match(/Periodic Transaction Report[\s\S]{0,2000}/i)?.[0]?.replace(/<[^>]+>/g, "|");
  console.log("header block:", headerBlock?.slice(0, 600));
  const { writeFileSync } = await import("fs");
  writeFileSync("tmp-senate-ptr.html", html);
  const plain = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const lines = plain.replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  console.log("first text lines:", lines.slice(0, 30));
}

main().catch(console.error);
