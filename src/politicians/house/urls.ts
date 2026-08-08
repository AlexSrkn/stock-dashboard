export function houseFinancialIndexXmlUrl(year: number): string {
  return `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.xml`;
}

export function houseFinancialIndexZipUrl(year: number): string {
  return `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;
}

export function housePtrPdfUrl(year: number, docId: string): string {
  return `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`;
}

/** Parse direct PTR PDF links like .../ptr-pdfs/2024/20025819.pdf */
export function parseHousePtrPdfUrl(url: string): { year: number; docId: string } | null {
  const m = String(url).match(/\/ptr-pdfs\/(\d{4})\/(\d+)\.pdf(?:\?.*)?$/i);
  if (!m) return null;
  return { year: Number(m[1]), docId: m[2] };
}
