export function isAcknowledgementGate(html: string): boolean {
  if (!html || html.length < 80) return false;
  const hasAgreementControl =
    /name=['"]prohibition_agreement['"]/i.test(html) ||
    /id=['"]prohibition_agreement['"]/i.test(html);
  const hasSubmit =
    /type=['"]submit['"]/i.test(html) &&
    /(I understand|Continue|Accept)/i.test(html);
  const hasCsrf = /csrfmiddlewaretoken/i.test(html);
  return hasCsrf && (hasAgreementControl || hasSubmit);
}

export function extractCsrfToken(html: string): string | null {
  const m = html.match(/name=['"]csrfmiddlewaretoken['"]\s+value=['"]([^'"]+)['"]/i);
  return m?.[1] ?? null;
}

export function extractFormAction(html: string, pageUrl: string): string {
  const m = html.match(/<form[^>]*action=['"]([^'"]*)['"]/i);
  if (!m?.[1]) return pageUrl;
  const action = m[1];
  if (action.startsWith("http")) return action;
  const base = new URL(pageUrl);
  return new URL(action, base).toString();
}

export function extractHiddenFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /<input[^>]*type=['"]hidden['"][^>]*>/gi;
  for (const tag of html.match(re) ?? []) {
    const name = tag.match(/name=['"]([^'"]+)['"]/i)?.[1];
    const value = tag.match(/value=['"]([^'"]*)['"]/i)?.[1] ?? "";
    if (name) fields[name] = value;
  }
  return fields;
}

export function buildAcknowledgementBody(html: string): URLSearchParams {
  const fields = extractHiddenFormFields(html);
  const csrf = extractCsrfToken(html);
  if (csrf) fields.csrfmiddlewaretoken = csrf;
  fields.prohibition_agreement = "1";
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return body;
}

export function storeSetCookies(jar: Map<string, string>, res: Response): void {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

export function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export function csrfHeader(jar: Map<string, string>): string | undefined {
  return jar.get("csrftoken") || undefined;
}
