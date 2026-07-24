import {
  getSourceCacheStatus,
  recordSourceIngestionRun,
  searchSourceCache,
  upsertSourceCache,
  type SourceCacheStatus,
  type SourceCacheUpsertResult,
} from "./db";
import { parseBringATrailerLiveListings, parseBringATrailerRssFeed } from "./sources/bringatrailer";
import type { SourceCandidate } from "./sources/types";

export const bringATrailerRssFeedUrl = "https://bringatrailer.com/auctions/feed/";
export const bringATrailerLivePageUrl = "https://bringatrailer.com/auctions/";

const source = "bringatrailer";
const maxRssBytes = 1_000_000;
const maxLivePageBytes = 4_000_000;
const maxCachedLiveItems = 300;
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
  let sourceUrl = bringATrailerLivePageUrl;
  let candidates: SourceCandidate[] = [];
  let livePageError: string | null = null;

  try {
    const response = await fetchImpl(bringATrailerLivePageUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "User-Agent": "BeachcarSourceCache/0.1 (+https://beachcar.local)",
      },
    });
    const text = await readTextWithLimit(response, maxLivePageBytes);
    if (!response.ok) throw new Error(`Bring a Trailer live page returned HTTP ${response.status}`);
    candidates = parseBringATrailerLiveListings(text, { label: "Live Auctions", url: bringATrailerLivePageUrl });
    if (!candidates.length) throw new Error("Bring a Trailer live page contained no parseable current auctions");
    candidates = candidates.slice(0, maxCachedLiveItems);
  } catch (error) {
    livePageError = errorMessage(error);
  }

  try {
    if (!candidates.length) {
      sourceUrl = bringATrailerRssFeedUrl;
      const response = await fetchImpl(bringATrailerRssFeedUrl, {
        headers: {
          Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
          "User-Agent": "BeachcarSourceCache/0.1 (+https://beachcar.local)",
        },
      });
      const text = await readTextWithLimit(response, maxRssBytes);
      if (!response.ok) throw new Error(`Bring a Trailer RSS returned HTTP ${response.status}`);
      candidates = parseBringATrailerRssFeed(text);
      if (!candidates.length) throw new Error("Bring a Trailer RSS contained no parseable current auctions");
    }

    const finishedAt = new Date().toISOString();
    const result = await upsertSourceCache(db, {
      source,
      sourceUrl,
      candidates,
      startedAt,
      finishedAt,
    });
    await db
      .prepare("UPDATE source_items SET is_live = 0 WHERE source = ? AND is_live IS NOT 0 AND last_seen_at < ?")
      .bind(source, finishedAt)
      .run();
    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const fallbackError = errorMessage(error);
    await recordSourceIngestionRun(db, {
      source,
      sourceUrl,
      status: "failed",
      error: livePageError ? `Live page: ${livePageError}; fallback: ${fallbackError}` : fallbackError,
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
    feed: bringATrailerLivePageUrl,
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
