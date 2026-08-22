import { FINANCIAL_METRIC_DEFINITIONS } from "../metrics.js";
import type { FinancialMetricKey } from "../types.js";

export interface InlineXbrlContext {
  id: string;
  end: string | null;
  start: string | null;
  instant: string | null;
  fy: number | null;
  fp: string | null;
}

export interface InlineXbrlFact {
  tag: string;
  namespace: string;
  localName: string;
  contextRef: string;
  unitRef: string | null;
  scale: number;
  decimals: number | null;
  value: number;
  sign: number;
}

export interface ParsedInlineXbrl {
  contexts: Map<string, InlineXbrlContext>;
  facts: InlineXbrlFact[];
}

function parseNumeric(raw: string, scale: number, sign: number): number | null {
  const cleaned = raw.replace(/[,\s$£€()]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const scaled = scale ? n * 10 ** scale : n;
  return scaled * sign;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = tag.match(re);
  return m ? m[1] : null;
}

function parseContexts(html: string): Map<string, InlineXbrlContext> {
  const contexts = new Map<string, InlineXbrlContext>();
  const blockRe =
    /<(?:xbrli:)?context[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html))) {
    const id = m[1];
    const body = m[2];
    const end =
      body.match(/<(?:xbrli:)?endDate[^>]*>([^<]+)</i)?.[1]?.trim() ??
      body.match(/<(?:xbrli:)?instant[^>]*>([^<]+)</i)?.[1]?.trim() ??
      null;
    const start = body.match(/<(?:xbrli:)?startDate[^>]*>([^<]+)</i)?.[1]?.trim() ?? null;
    const instant = body.match(/<(?:xbrli:)?instant[^>]*>([^<]+)</i)?.[1]?.trim() ?? null;
    contexts.set(id, { id, end, start, instant, fy: null, fp: null });
  }
  return contexts;
}

function parseFacts(html: string): InlineXbrlFact[] {
  const facts: InlineXbrlFact[] = [];
  const tagRe = /<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>|<ix:nonFraction\b[^/>]*\/>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const name = attr(tag, "name");
    const contextRef = attr(tag, "contextRef");
    if (!name || !contextRef) continue;
    const [namespace, localName] = name.includes(":")
      ? (name.split(":") as [string, string])
      : ["", name];
    const scale = Number(attr(tag, "scale") ?? "0");
    const decimalsRaw = attr(tag, "decimals");
    const decimals = decimalsRaw != null ? Number(decimalsRaw) : null;
    const sign = /sign\s*=\s*["']-["']/i.test(tag) ? -1 : 1;
    const inner = tag.match(/>([^<]*)</)?.[1] ?? "";
    const value = parseNumeric(inner, Number.isFinite(scale) ? scale : 0, sign);
    if (value == null) continue;
    facts.push({
      tag: name,
      namespace,
      localName,
      contextRef,
      unitRef: attr(tag, "unitRef"),
      scale: Number.isFinite(scale) ? scale : 0,
      decimals: Number.isFinite(decimals as number) ? (decimals as number) : null,
      value,
      sign,
    });
  }
  return facts;
}

/** Parse inline XBRL from a 6-K exhibit HTML document. */
export function parseInlineXbrl(html: string): ParsedInlineXbrl {
  return {
    contexts: parseContexts(html),
    facts: parseFacts(html),
  };
}

/** Map inline XBRL facts to metric keys per XBRL context. */
export function mapInlineFactsToMetrics(
  parsed: ParsedInlineXbrl
): Map<
  string,
  Partial<Record<FinancialMetricKey, { value: number; tag: string; contextRef: string }>>
> {
  const byContext = new Map<
    string,
    Partial<Record<FinancialMetricKey, { value: number; tag: string; contextRef: string }>>
  >();

  for (const fact of parsed.facts) {
    for (const def of FINANCIAL_METRIC_DEFINITIONS) {
      const hit = def.tags.find(
        (t) => t === fact.localName || fact.tag.endsWith(`:${t}`) || fact.tag === t
      );
      if (!hit) continue;
      const ctx = fact.contextRef;
      const bucket = byContext.get(ctx) ?? {};
      if (bucket[def.key] != null) continue;
      bucket[def.key] = { value: fact.value, tag: hit, contextRef: ctx };
      byContext.set(ctx, bucket);
      break;
    }
  }
  return byContext;
}
