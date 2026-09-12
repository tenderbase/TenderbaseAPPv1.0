export type JsonRecord = Record<string, unknown>;

export type NormalizedTender = {
  source: string;
  sourceUrl: string;
  ocid: string;
  releaseId: string;
  tenderNumber: string;
  title?: string;
  description?: string;
  organisation?: string;
  category?: string;
  province?: string;
  location?: string;
  valueCents?: bigint;
  publishedDate?: Date;
  closingDate?: Date;
  status?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  procurementType: string;
  raw: JsonRecord;
};

export type IngestionResult = {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
};
