export interface Form4FilingRef {
  filerCik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  primaryDocument: string;
  filerName: string | null;
}

export interface ParsedForm4Transaction {
  insiderName: string;
  insiderTitle: string | null;
  filingDate: string | null;
  transactionDate: string | null;
  transactionCode: string;
  acquisitionDisposition: string | null;
  shares: number | null;
  pricePerShare: number | null;
  transactionValue: number | null;
  ownershipNature: string | null;
  securityTitle: string | null;
  isDerivative: boolean;
  isHighSignal: boolean;
  /** Dedupe key fragment inputs. */
  rowKey: string;
}

export interface ParsedForm4Document {
  issuerCik: string | null;
  issuerTicker: string | null;
  issuerName: string | null;
  periodOfReport: string | null;
  transactions: ParsedForm4Transaction[];
}
