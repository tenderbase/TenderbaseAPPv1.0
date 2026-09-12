import type { NormalisedTender } from "../normalise.js";

/** Common contract for every municipal procurement source. */
export interface MunicipalityAdapter {
  /** Stable source key used for ingestion runs and tender identity. */
  id: string;
  /** Human-readable municipality name. */
  name: string;
  /** South African province. */
  province: string;
  /** Official municipal procurement landing page. */
  sourceUrl: string;
  /** Fetch and parse the municipality's currently published procurement opportunities. */
  fetchOpenTenders(): Promise<{ tenders: NormalisedTender[]; pages: number }>;
}
