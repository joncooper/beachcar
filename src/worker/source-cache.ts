import {
  getSourceCacheStatus,
  recordSourceIngestionRun,
  searchSourceCache,
  upsertSourceCache,
  type SourceCacheStatus,
  type SourceCacheUpsertResult,
} from "./db";
import { parseBringATrailerRssFeed, type SourceCandidate } from "./workflows/source-discovery";

export const bringATrailerRssFeedUrl = "https://bringatrailer.com/auctions/feed/";

const source = "bringatrailer";
const maxRssBytes = 1_000_000;
const staleAfterMs = 15 * 60 * 1000;

export interface SourceCacheSearchResult {
  source: string;
  site: string;
  mode: "d1_cache";
  cacheStatus: "hit" | "miss" | "refreshed" | "stale_refresh_failed";
  feed: string;
  terms: string[];
  candidateCount: number;
  status: SourceCacheStatus;
  ingestion?: SourceCacheUpsertResult | null;
  refreshError?: string | null;
  candidates: SourceCandidate[];
}

export async function ingestBringATrailerRssCache(db: D1Database, fetchImpl: typeof fetch = fetch): Promise<SourceCacheUpsertResult> {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetchImpl(bringATrailerRssFeedUrl, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
        "User-Agent": "BeachcarSourceCache/0.1 (+https://beachcar.local)",
      },
    });
    const text = await readTextWithLimit(response, maxRssBytes);
    if (!response.ok) throw new Error(`Bring a Trailer RSS returned HTTP ${response.status}`);
    const candidates = parseBringATrailerRssFeed(text);
    return upsertSourceCache(db, {
      source,
      sourceUrl: bringATrailerRssFeedUrl,
      candidates,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await recordSourceIngestionRun(db, {
      source,
      sourceUrl: bringATrailerRssFeedUrl,
      status: "failed",
      error: errorMessage(error),
      startedAt,
      finishedAt,
    });
    throw error;
  }
}

export async function searchBringATrailerCache(
  db: D1Database,
  input: { terms: string[]; limit: number; refresh?: boolean },
): Promise<SourceCacheSearchResult> {
  let status = await getSourceCacheStatus(db, source);
  let ingestion: SourceCacheUpsertResult | null = null;
  let refreshError: string | null = null;
  let cacheStatus: SourceCacheSearchResult["cacheStatus"] = status.itemCount > 0 ? "hit" : "miss";

  if (input.refresh !== false && shouldRefresh(status)) {
    try {
      ingestion = await ingestBringATrailerRssCache(db);
      status = await getSourceCacheStatus(db, source);
      cacheStatus = "refreshed";
    } catch (error) {
      refreshError = errorMessage(error);
      cacheStatus = status.itemCount > 0 ? "stale_refresh_failed" : "miss";
    }
  }

  const { candidates, status: freshStatus } = await searchSourceCache(db, {
    source,
    terms: input.terms,
    limit: input.limit,
  });

  return {
    source,
    site: "Bring a Trailer",
    mode: "d1_cache",
    cacheStatus,
    feed: bringATrailerRssFeedUrl,
    terms: input.terms,
    candidateCount: candidates.length,
    status: freshStatus,
    ingestion,
    refreshError,
    candidates,
  };
}

function shouldRefresh(status: SourceCacheStatus): boolean {
  if (status.itemCount === 0 || !status.latestIngestion || status.latestIngestion.status !== "ok") return true;
  return Date.now() - new Date(status.latestIngestion.finishedAt).getTime() > staleAfterMs;
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
