import { ETHEKWINI_BASE_URL, ETHEKWINI_SOURCE, fetchEThekwiniOpenTenders } from "../sources/ethekwini.js";
import type { MunicipalityAdapter } from "./types.js";

/** First municipality adapter. The existing scraper remains responsible for site-specific parsing. */
export const ethekwiniAdapter: MunicipalityAdapter = {
  id: ETHEKWINI_SOURCE,
  name: "eThekwini Municipality",
  province: "KwaZulu-Natal",
  sourceUrl: ETHEKWINI_BASE_URL,
  fetchOpenTenders: fetchEThekwiniOpenTenders,
};
