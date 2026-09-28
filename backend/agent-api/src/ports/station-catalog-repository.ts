import type { StationLineCatalog } from "@raiquora/train/station";
export interface StationCatalogRepository { load(): Promise<StationLineCatalog> }
