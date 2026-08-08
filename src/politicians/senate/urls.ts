const EFD_ORIGIN = "https://efdsearch.senate.gov";

export function senatePtrViewUrl(reportId: string): string {
  const id = reportId.replace(/^\/+|\/+$/g, "");
  return `${EFD_ORIGIN}/search/view/ptr/${id}/`;
}

export function parseSenatePtrUrl(url: string): { reportId: string; sourceUrl: string } | null {
  const m = url.match(/\/search\/view\/ptr\/([a-f0-9-]+)\/?/i);
  if (!m?.[1]) return null;
  return { reportId: m[1], sourceUrl: senatePtrViewUrl(m[1]) };
}

export function normalizeSenatePtrUrl(url: string): string {
  return parseSenatePtrUrl(url)?.sourceUrl ?? url;
}
