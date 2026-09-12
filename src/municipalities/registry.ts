import type { MunicipalityAdapter } from "./types.js";
import { ethekwiniAdapter } from "./ethekwini.js";

const adapters: MunicipalityAdapter[] = [ethekwiniAdapter];

/** Return all enabled municipal procurement adapters. */
export function listMunicipalityAdapters(): MunicipalityAdapter[] {
  return [...adapters];
}

/** Resolve a municipality by its stable source id. */
export function getMunicipalityAdapter(id: string): MunicipalityAdapter | undefined {
  return adapters.find((adapter) => adapter.id.toUpperCase() === id.toUpperCase());
}
