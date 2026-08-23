import { FINANCIAL_METRIC_DEFINITIONS } from "../metrics.js";
import type { FinancialMetricKey } from "../types.js";

export interface XbrlContext {
  id: string;
  end: string | null;
  start: string | null;
  instant: string | null;
}

export interface XbrlFact {
  tag: string;
  namespace: string;
  localName: string;
  contextRef: string;
  scale: number;
  value: number;
  sign: number;
}

export interface ParsedXbrlDocument {
  contexts: Map<string, XbrlContext>;
  facts: XbrlFact[];
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

function parseContexts(html: string): Map<string, XbrlContext> {
  const contexts = new Map<string, XbrlContext>();
  const blockRe =
    /<(?:xbrli:)?context[^>]*id\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html))) {
    const id = match[1];
    const body = match[2];
    const end =
      body.match(/<(?:xbrli:)?endDate[^>]*>([^<]+)/i)?.[1]?.trim() ??
      body.match(/<endDate[^>]*>([^<]+)/i)?.[1]?.trim() ??
      body.match(/<(?:xbrli:)?instant[^>]*>([^<]+)/i)?.[1]?.trim() ??
      body.match(/<instant[^>]*>([^<]+)/i)?.[1]?.trim() ??
      null;
    const start =
      body.match(/<(?:xbrli:)?startDate[^>]*>([^<]+)/i)?.[1]?.trim() ??
      body.match(/<startDate[^>]*>([^<]+)/i)?.[1]?.trim() ??
      null;
    const instant =
      body.match(/<(?:xbrli:)?instant[^>]*>([^<]+)/i)?.[1]?.trim() ??
      body.match(/<instant[^>]*>([^<]+)/i)?.[1]?.trim() ??
      null;
    contexts.set(id, { id, end, start, instant });
  }
  return contexts;
}

function parseInlineFacts(html: string): XbrlFact[] {
  const facts: XbrlFact[] = [];
  const tagRe = /<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>|<ix:nonFraction\b[^/>]*\/>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    const tag = match[0];
    const name = attr(tag, "name");
    const contextRef = attr(tag, "contextRef");
    if (!name || !contextRef) continue;
    const [namespace, localName] = name.includes(":")
      ? (name.split(":") as [string, string])
      : ["", name];
    const scale = Number(attr(tag, "scale") ?? "0");
    const sign = /sign\s*=\s*["']-["']/i.test(tag) ? -1 : 1;
    const inner = tag.match(/>([^<]*)</)?.[1] ?? "";
    const value = parseNumeric(inner, Number.isFinite(scale) ? scale : 0, sign);
    if (value == null) continue;
    facts.push({
      tag: name,
      namespace,
      localName,
      contextRef,
      scale: Number.isFinite(scale) ? scale : 0,
      value,
      sign,
    });
  }
  return facts;
}

function parseStandaloneFacts(xml: string): XbrlFact[] {
  const facts: XbrlFact[] = [];
  const tagRe =
    /<([a-zA-Z0-9-]+):([A-Za-z0-9]+)\b([^>]*contextRef="([^"]+)"[^>]*)>([^<]*)<\/\1:\2>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(xml))) {
    const namespace = match[1];
    const localName = match[2];
    const attrs = match[3];
    const contextRef = match[4];
    const rawValue = match[5];
    const scale = Number(attrs.match(/\bscale="([^"]+)"/i)?.[1] ?? "0");
    const sign = /sign="-"|contextRef="[^"]*-"/i.test(attrs) ? -1 : 1;
    const value = parseNumeric(rawValue, Number.isFinite(scale) ? scale : 0, sign);
    if (value == null) continue;
    facts.push({
      tag: `${namespace}:${localName}`,
      namespace,
      localName,
      contextRef,
      scale: Number.isFinite(scale) ? scale : 0,
      value,
      sign,
    });
  }
  return facts;
}

/** Parse inline or standalone XBRL from a 6-K document. */
export function parseXbrlDocument(content: string): ParsedXbrlDocument {
  const contexts = parseContexts(content);
  const facts = content.includes("ix:nonFraction")
    ? parseInlineFacts(content)
    : parseStandaloneFacts(content);
  return { contexts, facts };
}

/** Map XBRL facts to metric keys per context. */
export function mapFactsToMetrics(
  parsed: ParsedXbrlDocument
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
        (tag) => tag === fact.localName || fact.tag.endsWith(`:${tag}`) || fact.tag === tag
      );
      if (!hit) continue;
      const bucket = byContext.get(fact.contextRef) ?? {};
      if (bucket[def.key] != null) continue;
      bucket[def.key] = { value: fact.value, tag: hit, contextRef: fact.contextRef };
      byContext.set(fact.contextRef, bucket);
      break;
    }
  }
  return byContext;
}
