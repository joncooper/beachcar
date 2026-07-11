import type { LocationStatus, ShadeDossierData } from "../../shared/types";

export interface SourceCandidate {
  source: string;
  site: string;
  sourceQuery: string;
  title: string;
  url: string;
  bid: string;
  bidNum?: number;
  bidCents?: number;
  total: string;
  location?: string;
  locationRaw?: string;
  locationCity?: string;
  locationRegion?: string;
  locationCountry?: string;
  distanceMiles?: number;
  locationStatus?: LocationStatus;
  missingData?: string[];
  endsAt?: string;
  timeLeft?: string;
  bids?: string | number;
  bidders?: string | number;
  comments?: string | number;
  imageUrls: string[];
  summary: string;
  noReserve?: boolean;
  isLive?: boolean;
  sourceUrl: string;
  publishedAt?: string;
  lastDetailAt?: string;
  detailStatus?: string;
  detailError?: string;
  dossier?: ShadeDossierData;
}

export interface CandidateDetailEnrichment {
  location?: string;
  bids?: string | number;
  bidders?: string | number;
  comments?: string | number;
  imageUrls?: string[];
  lastDetailAt?: string;
  detailStatus?: string;
  detailError?: string;
  noReserve?: boolean;
  dossier?: ShadeDossierData;
}
