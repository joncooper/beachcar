import { normalizeLocationMetadata } from "../../shared/normalize";
import type { AuctionListing, FeedbackExport, Lane, RunSourceCheck, ShadeDossierData } from "../../shared/types";
import {
  BAT_KEYWORD_PAGES,
  BAT_RSS_FEED,
  bringATrailerPagesFromSourceNotes,
  dedupeBringATrailerPages,
  discoverBringATrailerNextPages,
  parseBringATrailerDetailPage,
  parseBringATrailerLiveListings,
  parseBringATrailerRssFeed,
} from "../sources/bringatrailer";
import {
  buildHemmingsSeedPages,
  parseHemmingsDetailPage,
  parseHemmingsListingsPage,
} from "../sources/hemmings";
import type { CandidateDetailEnrichment, SourceCandidate } from "../sources/types";
import type { SourceCacheSearchResult } from "../source-cache";

export {
  parseBringATrailerDetailPage,
  parseBringATrailerLiveListings,
  parseBringATrailerRssFeed,
} from "../sources/bringatrailer";
export type { CandidateDetailEnrichment, SourceCandidate } from "../sources/types";

export const SOURCE_DISCOVERY_PUBLISHER = "cloudflare-workflow-source-discovery";

export interface DiscoveryContext {
  email: string;
  userId?: string;
  niche: string;
  budgetMax: number;
  stretchBudget: number;
  homeRegion: string;
  timezone: string;
  tasteNotes: string;
  avoidNotes: string;
  aiMode: string | null;
  gatewayKeyRef?: string | null;
  enabledSources: string[];
  sourceSettings?: DiscoverySourceSetting[];
  feedbackCount: number;
  feedbackSteering?: FeedbackExport["steering"];
  latestRunId: string | null;
}

export interface DiscoverySourceSetting {
  source: string;
  enabled: boolean;
  settings: Record<string, string | number | boolean | null>;
}

export interface DiscoveryParams {
  runId: string;
  source: "manual" | "schedule";
  reason?: string | null;
}

export type SourceDiscoveryStatus = "ok" | "blocked" | "failed" | "skipped" | "fallback";

export interface SourceDiscoveryCheck extends RunSourceCheck {
  status: SourceDiscoveryStatus;
  checkedAt: string;
}

export interface SourceDiscoveryDraft {
  generatedAt: string;
  listings: AuctionListing[];
  cacheableCandidates: SourceCandidate[];
  reportMarkdown: string;
  checkedSources: SourceDiscoveryCheck[];
  blockedSources: SourceDiscoveryCheck[];
  fallbackUsed: boolean;
  rawCandidateCount: number;
  aiScoring?: CandidateAiScoringResult | null;
}

interface DiscoveryOptions {
  fetchImpl?: FetchLike;
  now?: Date;
  aiScorer?: CandidateAiScorer | null;
  requireAiScoring?: boolean;
  allowPlaceholderFallback?: boolean;
  sourceCache?: {
    searchBringATrailer(input: { terms: string[]; limit: number; refresh?: boolean }): Promise<SourceCacheSearchResult>;
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type BringATrailerCacheSearch = NonNullable<DiscoveryOptions["sourceCache"]>["searchBringATrailer"];

export interface AiCandidateScore {
  url: string;
  scoreDelta?: number;
  why?: string;
  concerns?: string;
  lane?: Lane;
  section?: string;
  /** 0..1 CHEAP..RICH meter position; folded into dossier.valueScore. */
  valueScore?: number;
  /** One-line dossier headline (dossier.summary). */
  summary?: string;
  /** Optional one-sentence beach-usability note (dossier.beachUse.body). */
  beachNote?: string;
}

export interface CandidateAiScoringInput {
  context: DiscoveryContext;
  params: DiscoveryParams;
  candidates: ScoredCandidate[];
}

export interface CandidateAiScoringResult {
  status: "ok" | "failed" | "skipped";
  provider: string;
  model?: string | null;
  gatewayId?: string | null;
  gatewayKeyRef?: string | null;
  requestId?: string | null;
  message?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costMicros?: number;
  scores: AiCandidateScore[];
}

export interface CandidateAiScorer {
  scoreCandidates(input: CandidateAiScoringInput): Promise<CandidateAiScoringResult>;
}

export interface ScoredCandidate {
  candidate: SourceCandidate;
  score: number;
  matches: string[];
  penalties: string[];
  ai?: AiCandidateScore;
}

const DEFAULT_SOURCES = ["bringatrailer", "carsandbids"] as const;
const USER_AGENT = "BeachcarSourceDiscovery/0.1 (+https://beachcar.local)";

const PRIORITY_TERMS: Array<[RegExp, string, number, Lane]> = [
  [/\bvw thing\b|\bvolkswagen thing\b|\btype 181\b/, "VW Thing", 34, "family"],
  [/\bmini moke\b|\bmoke\b/, "Mini Moke", 34, "family"],
  [/\bmehari\b|\bcitroen mehari\b/, "Citroen Mehari", 34, "family"],
  [/\bjolly\b|\bfiat jolly\b/, "Fiat Jolly-style", 30, "family"],
  [/\bsamurai\b|\bsidekick\b|\btracker\b|\bamigo\b|\brocky\b/, "small open 4x4", 26, "family"],
  [/\bwrangler\b|\bcj-?\d?\b|\bcj-?8\b|\bscrambler\b|\byj\b|\btj\b|\blj\b|\bjk\b/, "Jeep runabout", 18, "family"],
  [/\b4runner\b|\bmontero\b|\bdelica\b|\bkei truck\b|\bkei van\b/, "compact utility", 18, "family"],
  [/\bbrat\b|\bbaja\b|\bgolf cart\b|\bnev\b|\belectric resort\b/, "quirky utility", 18, "curiosity"],
  [/\bvespa\b|\bscooter\b|\bmonkey\b|\bgrom\b|\btrail\b|\bcub\b|\bsidecar\b/, "solo runabout", 22, "solo"],
  [/\bconvertible\b|\bcabriolet\b|\bair-cooled\b|\bbeetle\b/, "open-air runabout", 10, "family"],
];

const AVOID_TERMS: Array<[RegExp, string, number]> = [
  [/\bsalvage\b|\brebuilt title\b|\bbranded title\b/, "title risk", 14],
  [/\bnon-?running\b|\bdoes not run\b|\bproject\b/, "project risk", 12],
  [/\brust\b|\bcorrosion\b|\bfloor pans\b/, "rust diligence", 7],
  [/\brestomod\b|\bframe-off\b|\bshow-quality\b/, "likely overbuilt", 5],
  [/\blifted\b|\b35\"|\b37\"|\bheavy off-road\b/, "heavy off-road build", 5],
];

export async function discoverAndScoreCandidates(
  context: DiscoveryContext,
  params: DiscoveryParams,
  options: DiscoveryOptions = {},
): Promise<SourceDiscoveryDraft> {
  const generatedAt = (options.now || new Date()).toISOString();
  const fetchImpl = options.fetchImpl || fetch;
  const sources = normalizeSources(context.enabledSources);
  const checkedSources: SourceDiscoveryCheck[] = [];
  const candidates: SourceCandidate[] = [];

  if (sources.includes("bringatrailer")) {
    const result = await discoverBringATrailer(context, fetchImpl, generatedAt, options.sourceCache?.searchBringATrailer);
    checkedSources.push(...result.checks);
    candidates.push(...result.candidates);
  }

  if (sources.includes("carsandbids")) {
    checkedSources.push(await checkCarsAndBids(fetchImpl, generatedAt));
  }

  if (sources.includes("hemmings")) {
    const result = await discoverHemmings(context, fetchImpl, generatedAt);
    checkedSources.push(...result.checks);
    candidates.push(...result.candidates);
  }

  if (sources.includes("marketplace")) {
    checkedSources.push({
      source: "marketplace",
      site: "Marketplace-style sources",
      status: "blocked",
      candidateCount: 0,
      checkedAt: generatedAt,
      message: "Marketplace-style sources need a logged-in browser or container runner; Worker fetch is intentionally not used.",
    });
  }

  for (const source of sources) {
    if (source !== "bringatrailer" && source !== "carsandbids" && source !== "hemmings" && source !== "marketplace") {
      checkedSources.push({
        source,
        site: source,
        status: "skipped",
        candidateCount: 0,
        checkedAt: generatedAt,
        message: "No Worker fetcher is configured for this source yet.",
      });
    }
  }

  let scored = uniqueCandidates(candidates)
    .map((candidate) => scoreCandidate(candidate, context))
    .filter((candidate) => candidate.score >= 12)
    .sort((a, b) => b.score - a.score);
  let aiScoring: CandidateAiScoringResult | null = null;

  if (scored.length) {
    const enriched = await enrichBringATrailerFinalists(scored, fetchImpl, generatedAt);
    scored = enriched.candidates.map((entry) => scoreCandidate(entry.candidate, context)).sort((a, b) => b.score - a.score);
    if (enriched.check) checkedSources.push(enriched.check);
  }

  if (scored.length) {
    const enriched = await enrichHemmingsFinalists(scored, fetchImpl, generatedAt);
    scored = enriched.candidates.map((entry) => scoreCandidate(entry.candidate, context)).sort((a, b) => b.score - a.score);
    if (enriched.check) checkedSources.push(enriched.check);
  }

  scored = scored.slice(0, 8);

  if (scored.length) {
    if (options.requireAiScoring && !options.aiScorer) {
      throw new Error("Managed curation is unavailable because AI Gateway is not configured");
    }
    aiScoring = options.aiScorer
      ? await runAiScoring(options.aiScorer, context, params, scored)
      : {
          status: "skipped",
          provider: "heuristic",
          model: null,
          totalTokens: 0,
          costMicros: 0,
          message: "AI scoring was not requested; heuristic scoring was used.",
          scores: [],
        };
    checkedSources.push(aiScoringCheck(aiScoring, generatedAt));
    if (options.requireAiScoring && aiScoring.status !== "ok") {
      throw new Error(aiScoring.message || "Managed curation failed before a trustworthy shortlist could be produced");
    }
    if (aiScoring.status === "ok") {
      scored = applyAiScoring(scored, aiScoring)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    }
  }

  const fallbackUsed = scored.length === 0;
  const listings = fallbackUsed
    ? options.allowPlaceholderFallback === false
      ? []
      : buildFallbackListings(context, params, generatedAt, sources)
    : scored.map((candidate) => listingFromCandidate(candidate, context));
  const cacheableCandidates = fallbackUsed ? [] : scored.map((candidate) => candidate.candidate);

  if (fallbackUsed) {
    checkedSources.push({
      source: "fallback",
      site: "Manual source checklist",
      status: "fallback",
      candidateCount: listings.length,
      checkedAt: generatedAt,
      message: "No live source candidates cleared the profile threshold, so the run published transparent manual-check tasks.",
    });
  }

  const blockedSources = checkedSources.filter((check) => check.status === "blocked" || check.status === "failed");

  return {
    generatedAt,
    listings,
    cacheableCandidates,
    reportMarkdown: buildReport(context, params, listings, checkedSources, fallbackUsed),
    checkedSources,
    blockedSources,
    fallbackUsed,
    rawCandidateCount: candidates.length,
    aiScoring,
  };
}

function normalizeSources(sources: string[]): string[] {
  const normalized = sources.map((source) => source.trim().toLowerCase()).filter(Boolean);
  const withDefaults = normalized.length ? normalized : [...DEFAULT_SOURCES];
  return [...new Set(withDefaults)];
}

async function discoverBringATrailer(
  context: DiscoveryContext,
  fetchImpl: FetchLike,
  checkedAt: string,
  searchCache?: BringATrailerCacheSearch,
): Promise<{ checks: SourceDiscoveryCheck[]; candidates: SourceCandidate[] }> {
  const checks: SourceDiscoveryCheck[] = [];
  const candidates: SourceCandidate[] = [];
  const pages = dedupeBringATrailerPages([
    ...BAT_KEYWORD_PAGES,
    ...bringATrailerPagesFromSourceNotes(sourceSettingsFor(context, "bringatrailer").searchNotes),
  ]);

  for (const page of pages) {
    try {
      const response = await fetchImpl(page.url, requestInit("text/html"));
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 404) {
          checks.push(skippedCheck("bringatrailer", "Bring a Trailer", page.url, page.label, checkedAt, "Keyword page is not available."));
          continue;
        }
        if (looksLikeChallengeResponse(response, text)) {
          checks.push(blockedCheck("bringatrailer", "Bring a Trailer", page.url, page.label, checkedAt));
          continue;
        }
        checks.push(failedCheck("bringatrailer", "Bring a Trailer", page.url, page.label, checkedAt, `HTTP ${response.status}`));
        continue;
      }
      if (looksLikeBotChallenge(text)) {
        checks.push(blockedCheck("bringatrailer", "Bring a Trailer", page.url, page.label, checkedAt));
        continue;
      }
      const parsed = parseBringATrailerLiveListings(text, page);
      checks.push({
        source: "bringatrailer",
        site: "Bring a Trailer",
        status: "ok",
        label: page.label,
        url: page.url,
        candidateCount: parsed.length,
        checkedAt,
        message: sourceParseMessage(
          parsed,
          "Parsed live keyword-page listing cards.",
          "Keyword page was reachable but had no live listing cards.",
        ),
        selectorHits: selectorHitsForCandidates(parsed, "listing-card"),
      });
      candidates.push(...parsed);
      for (const nextPage of discoverBringATrailerNextPages(text, page, 1)) {
        try {
          const nextResponse = await fetchImpl(nextPage.url, requestInit("text/html"));
          const nextText = await nextResponse.text();
          if (!nextResponse.ok) {
            if (nextResponse.status === 404) {
              checks.push(skippedCheck("bringatrailer", "Bring a Trailer", nextPage.url, nextPage.label, checkedAt, "Keyword pagination page is not available."));
              continue;
            }
            if (looksLikeChallengeResponse(nextResponse, nextText)) {
              checks.push(blockedCheck("bringatrailer", "Bring a Trailer", nextPage.url, nextPage.label, checkedAt));
              continue;
            }
            checks.push(failedCheck("bringatrailer", "Bring a Trailer", nextPage.url, nextPage.label, checkedAt, `HTTP ${nextResponse.status}`));
            continue;
          }
          if (looksLikeBotChallenge(nextText)) {
            checks.push(blockedCheck("bringatrailer", "Bring a Trailer", nextPage.url, nextPage.label, checkedAt));
            continue;
          }
          const nextParsed = parseBringATrailerLiveListings(nextText, nextPage);
          checks.push({
            source: "bringatrailer",
            site: "Bring a Trailer",
            status: "ok",
            label: nextPage.label,
            url: nextPage.url,
            candidateCount: nextParsed.length,
            checkedAt,
            message: sourceParseMessage(
              nextParsed,
              "Parsed bounded keyword-page pagination listing cards.",
              "Keyword pagination page was reachable but had no live listing cards.",
            ),
            selectorHits: selectorHitsForCandidates(nextParsed, "listing-card"),
          });
          candidates.push(...nextParsed);
        } catch (error) {
          checks.push(failedCheck("bringatrailer", "Bring a Trailer", nextPage.url, nextPage.label, checkedAt, errorMessage(error)));
        }
      }
    } catch (error) {
      checks.push(failedCheck("bringatrailer", "Bring a Trailer", page.url, page.label, checkedAt, errorMessage(error)));
    }
  }

  try {
    const response = await fetchImpl(BAT_RSS_FEED, requestInit("application/rss+xml"));
    const text = await response.text();
    if (!response.ok) {
      checks.push(
        looksLikeChallengeResponse(response, text)
          ? blockedCheck("bringatrailer", "Bring a Trailer", BAT_RSS_FEED, "Auctions RSS", checkedAt)
          : failedCheck("bringatrailer", "Bring a Trailer", BAT_RSS_FEED, "Auctions RSS", checkedAt, `HTTP ${response.status}`),
      );
    } else if (looksLikeBotChallenge(text)) {
      checks.push(blockedCheck("bringatrailer", "Bring a Trailer", BAT_RSS_FEED, "Auctions RSS", checkedAt));
    } else {
      const parsed = parseBringATrailerRssFeed(text);
      checks.push({
        source: "bringatrailer",
        site: "Bring a Trailer",
        status: "ok",
        label: "Auctions RSS",
        url: BAT_RSS_FEED,
        candidateCount: parsed.length,
        checkedAt,
        message: sourceParseMessage(parsed, "Parsed public RSS items as a broad source sweep."),
        selectorHits: selectorHitsForCandidates(parsed, "rss-item"),
      });
      candidates.push(...parsed);
    }
  } catch (error) {
    checks.push(failedCheck("bringatrailer", "Bring a Trailer", BAT_RSS_FEED, "Auctions RSS", checkedAt, errorMessage(error)));
  }

  if (candidates.length === 0 && searchCache) {
    const terms = sourceCacheTerms(context);
    try {
      const result = await searchCache({ terms, limit: 16, refresh: true });
      const cached = result.candidates.filter((candidate) => !isOverBudget(candidate, context, 1.8));
      candidates.push(...cached);
      checks.push({
        source: "bringatrailer-cache",
        site: "Bring a Trailer",
        status: cached.length ? "fallback" : "skipped",
        label: "D1 cache fallback",
        url: result.feed,
        candidateCount: cached.length,
        checkedAt,
        message: bringATrailerCacheMessage(result, terms, cached.length),
        cache: {
          status: result.cacheStatus,
          usableCount: cached.length,
          searchedTerms: terms.slice(0, 20),
          latestIngestionAt: result.status.latestIngestion?.finishedAt || null,
          refreshError: result.refreshError || null,
        },
      });
    } catch (error) {
      checks.push(failedCheck("bringatrailer-cache", "Bring a Trailer", BAT_RSS_FEED, "D1 cache fallback", checkedAt, errorMessage(error)));
    }
  }

  return { checks, candidates: candidates.filter((candidate) => !isOverBudget(candidate, context, 1.8)) };
}

function bringATrailerCacheMessage(result: SourceCacheSearchResult, terms: string[], usableCount: number): string {
  const latest = result.status.latestIngestion?.finishedAt ? ` Latest ingestion: ${result.status.latestIngestion.finishedAt}.` : "";
  const refresh = result.refreshError ? ` Refresh failed: ${result.refreshError}.` : "";
  const termText = terms.length ? ` Terms: ${terms.slice(0, 8).join(", ")}.` : "";
  if (usableCount) return `Used ${usableCount} cached BaT candidate(s) because live fetch produced none. Cache status: ${result.cacheStatus}.${termText}${latest}${refresh}`;
  return `BaT cache fallback had no usable candidates. Cache status: ${result.cacheStatus}.${termText}${latest}${refresh}`;
}

function sourceCacheTerms(context: DiscoveryContext): string[] {
  const sourceNotes = sourceSettingsFor(context, "bringatrailer").searchNotes;
  const feedbackTerms = [
    ...(context.feedbackSteering?.prioritizeSimilarTo || []).flatMap((entry) => [entry.title, ...entry.tags]),
    ...(context.feedbackSteering?.notes || []).flatMap((entry) => [entry.title || "", ...entry.tags]),
  ];
  const raw = [
    "thing",
    "samurai",
    "tracker",
    "moke",
    "mehari",
    "wrangler",
    "cj",
    "vespa",
    "monkey",
    "grom",
    sourceNotes,
    context.tasteNotes,
    ...feedbackTerms,
  ].join(" ");
  const stop = new Set(["and", "the", "with", "for", "car", "cars", "beach", "open", "simple", "town", "notes"]);
  const terms = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stop.has(term));
  return [...new Set(terms)].slice(0, 20);
}

async function checkCarsAndBids(fetchImpl: FetchLike, checkedAt: string): Promise<SourceDiscoveryCheck> {
  const url = "https://carsandbids.com/auctions/";
  try {
    const response = await fetchImpl(url, requestInit("text/html"));
    const text = await response.text();
    if (!response.ok) {
      return looksLikeChallengeResponse(response, text)
        ? blockedCheck("carsandbids", "Cars & Bids", url, undefined, checkedAt)
        : failedCheck("carsandbids", "Cars & Bids", url, undefined, checkedAt, `HTTP ${response.status}`);
    }
    if (looksLikeBotChallenge(text) || /just a moment/i.test(text)) {
      return blockedCheck("carsandbids", "Cars & Bids", url, undefined, checkedAt);
    }
    return {
      source: "carsandbids",
      site: "Cars & Bids",
      status: "blocked",
      url,
      candidateCount: 0,
      checkedAt,
      message: "Cars & Bids is intentionally handled by a logged-in browser runner; Worker fetch only verifies reachability and queues browser-source work.",
      blockedUrls: [url],
    };
  } catch (error) {
    return failedCheck("carsandbids", "Cars & Bids", url, undefined, checkedAt, errorMessage(error));
  }
}

async function discoverHemmings(
  context: DiscoveryContext,
  fetchImpl: FetchLike,
  checkedAt: string,
): Promise<{ checks: SourceDiscoveryCheck[]; candidates: SourceCandidate[] }> {
  const checks: SourceDiscoveryCheck[] = [];
  const candidates: SourceCandidate[] = [];
  const settings = sourceSettingsFor(context, "hemmings");
  const pages = buildHemmingsSeedPages({ sourceNotes: settings.searchNotes, limit: settings.maxSeedPages || undefined });

  for (const page of pages) {
    try {
      const response = await fetchImpl(page.url, requestInit("text/html"));
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 404) {
          checks.push(skippedCheck("hemmings", "Hemmings", page.url, page.label, checkedAt, "Curated seed page is not available."));
          continue;
        }
        if (looksLikeChallengeResponse(response, text)) {
          checks.push(blockedCheck("hemmings", "Hemmings", page.url, page.label, checkedAt));
          continue;
        }
        checks.push(failedCheck("hemmings", "Hemmings", page.url, page.label, checkedAt, `HTTP ${response.status}`));
        continue;
      }
      if (looksLikeBotChallenge(text)) {
        checks.push(blockedCheck("hemmings", "Hemmings", page.url, page.label, checkedAt));
        continue;
      }
      const parsed = parseHemmingsListingsPage(text, page);
      checks.push({
        source: "hemmings",
        site: "Hemmings",
        status: "ok",
        label: page.label,
        url: page.url,
        candidateCount: parsed.length,
        checkedAt,
        message: sourceParseMessage(
          parsed,
          "Parsed curated Hemmings listing page candidates.",
          "Curated Hemmings page was reachable but had no parseable listing cards.",
        ),
        selectorHits: selectorHitsForCandidates(parsed, "listing-card"),
      });
      candidates.push(...parsed);
    } catch (error) {
      checks.push(failedCheck("hemmings", "Hemmings", page.url, page.label, checkedAt, errorMessage(error)));
    }
  }

  return { checks, candidates: candidates.filter((candidate) => !isOverBudget(candidate, context, 1.4)) };
}

async function enrichBringATrailerFinalists(
  candidates: ScoredCandidate[],
  fetchImpl: FetchLike,
  checkedAt: string,
): Promise<{ candidates: ScoredCandidate[]; check?: SourceDiscoveryCheck }> {
  const maxDetailPages = 20;
  let attempted = 0;
  let enriched = 0;
  let blocked = 0;
  let failed = 0;
  let empty = 0;
  const blockedUrls: string[] = [];
  const failedUrls: string[] = [];

  const next: ScoredCandidate[] = [];
  for (const scored of candidates) {
    const candidate = scored.candidate;
    if (candidate.source !== "bringatrailer" || attempted >= maxDetailPages) {
      next.push(scored);
      continue;
    }
    attempted += 1;

    try {
      const response = await fetchImpl(candidate.url, requestInit("text/html"));
      const text = await response.text();
      if (!response.ok) {
        failed += 1;
        failedUrls.push(candidate.url);
        next.push(markDetail(scored, "failed", checkedAt, `HTTP ${response.status}`));
        continue;
      }
      if (looksLikeBotChallenge(text)) {
        blocked += 1;
        blockedUrls.push(candidate.url);
        next.push(markDetail(scored, "blocked", checkedAt, "Detail page reached a bot/access challenge."));
        continue;
      }

      const detail = parseBringATrailerDetailPage(text);
      if (hasDetailEnrichment(detail)) {
        enriched += 1;
        next.push(mergeDetail(scored, { ...detail, lastDetailAt: checkedAt, detailStatus: "ok" }));
      } else {
        empty += 1;
        next.push(markDetail(scored, "empty", checkedAt));
      }
    } catch (error) {
      failed += 1;
      failedUrls.push(candidate.url);
      next.push(markDetail(scored, "failed", checkedAt, errorMessage(error)));
    }
  }

  if (!attempted) return { candidates: next };

  const status: SourceDiscoveryStatus = enriched > 0 ? "ok" : blocked > 0 ? "blocked" : failed > 0 ? "failed" : "skipped";
  const suffix = [
    blocked ? `${blocked} blocked` : "",
    failed ? `${failed} failed` : "",
    empty ? `${empty} empty` : "",
  ].filter(Boolean);

  return {
    candidates: next,
    check: {
      source: "bringatrailer-detail",
      site: "Bring a Trailer",
      status,
      label: "Shortlist detail pages",
      url: "https://bringatrailer.com/",
      candidateCount: enriched,
      checkedAt,
      message: `Enriched ${enriched}/${attempted} shortlisted BaT detail page(s) before the final cut.${suffix.length ? ` ${suffix.join(", ")}.` : ""}`,
      detailAttempts: { attempted, enriched, blocked, failed, empty, blockedUrls, failedUrls },
      blockedUrls,
    },
  };
}

async function enrichHemmingsFinalists(
  candidates: ScoredCandidate[],
  fetchImpl: FetchLike,
  checkedAt: string,
): Promise<{ candidates: ScoredCandidate[]; check?: SourceDiscoveryCheck }> {
  const maxDetailPages = 4;
  let attempted = 0;
  let enriched = 0;
  let blocked = 0;
  let failed = 0;
  let empty = 0;
  const blockedUrls: string[] = [];
  const failedUrls: string[] = [];

  const next: ScoredCandidate[] = [];
  for (const scored of candidates) {
    const candidate = scored.candidate;
    if (candidate.source !== "hemmings" || attempted >= maxDetailPages) {
      next.push(scored);
      continue;
    }
    attempted += 1;

    try {
      const response = await fetchImpl(candidate.url, requestInit("text/html"));
      const text = await response.text();
      if (!response.ok) {
        failed += 1;
        failedUrls.push(candidate.url);
        next.push(markDetail(scored, "failed", checkedAt, `HTTP ${response.status}`));
        continue;
      }
      if (looksLikeBotChallenge(text)) {
        blocked += 1;
        blockedUrls.push(candidate.url);
        next.push(markDetail(scored, "blocked", checkedAt, "Detail page reached a bot/access challenge."));
        continue;
      }

      const detail = parseHemmingsDetailPage(text);
      if (hasDetailEnrichment(detail)) {
        enriched += 1;
        next.push(mergeDetail(scored, { ...detail, lastDetailAt: checkedAt, detailStatus: "ok" }));
      } else {
        empty += 1;
        next.push(markDetail(scored, "empty", checkedAt));
      }
    } catch (error) {
      failed += 1;
      failedUrls.push(candidate.url);
      next.push(markDetail(scored, "failed", checkedAt, errorMessage(error)));
    }
  }

  if (!attempted) return { candidates: next };

  const status: SourceDiscoveryStatus = enriched > 0 ? "ok" : blocked > 0 ? "blocked" : failed > 0 ? "failed" : "skipped";
  const suffix = [
    blocked ? `${blocked} blocked` : "",
    failed ? `${failed} failed` : "",
    empty ? `${empty} empty` : "",
  ].filter(Boolean);

  return {
    candidates: next,
    check: {
      source: "hemmings-detail",
      site: "Hemmings",
      status,
      label: "Finalist detail pages",
      url: "https://www.hemmings.com/",
      candidateCount: enriched,
      checkedAt,
      message: `Enriched ${enriched}/${attempted} shortlisted Hemmings finalist detail page(s).${suffix.length ? ` ${suffix.join(", ")}.` : ""}`,
      detailAttempts: { attempted, enriched, blocked, failed, empty, blockedUrls, failedUrls },
      blockedUrls,
    },
  };
}

function selectorHitsForCandidates(candidates: SourceCandidate[], rootSelector: string): Record<string, number> {
  const missingLocationCount = candidates.filter((candidate) => normalizeLocationMetadata(candidate).locationStatus === "missing").length;
  return {
    [rootSelector]: candidates.length,
    "candidate-with-location": candidates.filter((candidate) => !!candidate.location).length,
    "candidate-missing-location": missingLocationCount,
    "candidate-with-image": candidates.filter((candidate) => candidate.imageUrls.length > 0).length,
    "candidate-with-bid": candidates.filter((candidate) => typeof candidate.bidNum === "number").length,
  };
}

function sourceParseMessage(candidates: SourceCandidate[], okMessage: string, emptyMessage?: string): string {
  const base = candidates.length ? okMessage : emptyMessage || okMessage;
  const missingLocationCount = candidates.filter((candidate) => normalizeLocationMetadata(candidate).locationStatus === "missing").length;
  if (!candidates.length || missingLocationCount === 0) return base;
  return `${base} ${missingLocationCount}/${candidates.length} candidate(s) missing source location.`;
}

function mergeDetail(scored: ScoredCandidate, detail: CandidateDetailEnrichment): ScoredCandidate {
  const candidate = scored.candidate;
  return {
    ...scored,
    candidate: {
      ...candidate,
      ...(detail.location ? { location: detail.location } : {}),
      ...(preferDetail(detail.bids, candidate.bids) ? { bids: detail.bids } : {}),
      ...(preferDetail(detail.bidders, candidate.bidders) ? { bidders: detail.bidders } : {}),
      ...(preferDetail(detail.comments, candidate.comments) ? { comments: detail.comments } : {}),
      ...(detail.lastDetailAt ? { lastDetailAt: detail.lastDetailAt } : {}),
      ...(detail.detailStatus ? { detailStatus: detail.detailStatus } : {}),
      ...(detail.detailError ? { detailError: detail.detailError } : {}),
      ...(detail.noReserve !== undefined ? { noReserve: detail.noReserve } : {}),
      imageUrls: mergeImageUrls(candidate.imageUrls, detail.imageUrls || []),
      dossier: mergeDossier(candidate.dossier, detail.dossier),
    },
  };
}

function markDetail(scored: ScoredCandidate, status: string, checkedAt: string, error?: string): ScoredCandidate {
  return mergeDetail(scored, {
    lastDetailAt: checkedAt,
    detailStatus: status,
    ...(error ? { detailError: error.slice(0, 240) } : {}),
  });
}

function hasDetailEnrichment(detail: CandidateDetailEnrichment): boolean {
  return Boolean(
    detail.location ||
      detail.bids ||
      detail.bidders ||
      detail.comments ||
      detail.imageUrls?.length ||
      detail.noReserve !== undefined ||
      (detail.dossier && Object.keys(detail.dossier).length),
  );
}

function preferDetail(detail: unknown, current: unknown): boolean {
  if (detail === undefined || detail === null || detail === "") return false;
  if (current === undefined || current === null || current === "") return true;
  return typeof current === "string" && /^check listing$/i.test(current);
}

function mergeImageUrls(primary: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...primary, ...extra]) {
    if (!raw) continue;
    const canonical = raw.replace(/\?.*$/, "");
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(raw);
  }
  return out.slice(0, 8);
}

function mergeDossier(base: ShadeDossierData | undefined, detail: ShadeDossierData | undefined): ShadeDossierData | undefined {
  if (!base) return detail;
  if (!detail) return base;
  return {
    ...base,
    ...detail,
    specs: mergeRecords(base.specs, detail.specs),
    listing: detail.listing?.length ? detail.listing : base.listing,
    equipment: detail.equipment?.length ? detail.equipment : base.equipment,
    service: detail.service?.length ? detail.service : base.service,
    bidLog: detail.bidLog?.length ? detail.bidLog : base.bidLog,
    comments: detail.comments?.length ? detail.comments : base.comments,
    beachUse: mergeRecords(base.beachUse, detail.beachUse),
  };
}

function mergeRecords<T extends Record<string, string> | undefined>(base: T, detail: T): T {
  if (!base) return detail;
  if (!detail) return base;
  return { ...base, ...detail } as T;
}

function scoreCandidate(candidate: SourceCandidate, context: DiscoveryContext): ScoredCandidate {
  const detailText = [
    candidate.dossier?.summary,
    ...(candidate.dossier?.listing || []),
    ...(candidate.dossier?.equipment || []),
  ].join(" ");
  const text = `${candidate.title} ${candidate.summary} ${candidate.sourceQuery} ${detailText}`.toLowerCase();
  const settings = sourceSettingsFor(context, candidate.source);
  let score = 0;
  const matches: string[] = [];
  const penalties: string[] = [];

  const feedback = feedbackAdjustment(candidate, context.feedbackSteering);
  score += feedback.scoreDelta;
  matches.push(...feedback.matches);
  penalties.push(...feedback.penalties);

  for (const [pattern, label, weight] of PRIORITY_TERMS) {
    if (pattern.test(text)) {
      score += weight;
      matches.push(label);
    }
  }

  if (/no reserve/i.test(candidate.summary) || candidate.noReserve) {
    score += 4;
    matches.push("no reserve");
  }

  if (settings.noReserveOnly && !candidate.noReserve) {
    score -= 18;
    penalties.push("not no-reserve");
  }

  if (candidate.bidNum) {
    const ceiling = settings.maxBudgetCents ? settings.maxBudgetCents / 100 : context.budgetMax + context.stretchBudget;
    if (candidate.bidNum <= ceiling) {
      score += 5;
      matches.push(settings.maxBudgetCents ? "inside source cap" : "inside current budget screen");
    } else if (candidate.bidNum > ceiling * 1.2) {
      score -= 12;
      penalties.push(settings.maxBudgetCents ? "current bid is beyond source cap" : "current bid is beyond saved budget");
    }
  }

  const modernJeep = modernJeepLocality(candidate, context);
  if (modernJeep === "nearby") {
    score += 3;
    matches.push("nearby modern Jeep");
  } else if (modernJeep === "unknown") {
    score -= 20;
    penalties.push("modern Jeep without a clear local location");
  } else if (modernJeep === "far") {
    score -= 28;
    penalties.push("modern Jeep outside the local driving radius");
  }

  for (const [pattern, label, weight] of AVOID_TERMS) {
    if (pattern.test(text)) {
      score -= weight;
      penalties.push(label);
    }
  }

  if (!candidate.imageUrls.length) score -= 1;
  if (candidate.sourceQuery && text.includes(candidate.sourceQuery.toLowerCase().split(" ")[0] || "")) score += 2;
  if (settings.searchNotes && textIncludesAnyTerm(text, settings.searchNotes)) {
    score += 4;
    matches.push("source search notes");
  }

  return { candidate, score, matches: [...new Set(matches)], penalties: [...new Set(penalties)] };
}

function feedbackAdjustment(
  candidate: SourceCandidate,
  steering: FeedbackExport["steering"] | undefined,
): { scoreDelta: number; matches: string[]; penalties: string[] } {
  if (!steering) return { scoreDelta: 0, matches: [], penalties: [] };

  const candidateUrl = canonicalFeedbackUrl(candidate.url);
  const suppressedUrls = new Set(steering.suppressExactUrls.map(canonicalFeedbackUrl));
  if (candidateUrl && suppressedUrls.has(candidateUrl)) {
    return { scoreDelta: -100, matches: [], penalties: ["hidden by feedback"] };
  }

  const avoidExact = steering.avoidSimilarTo.some((entry) => canonicalFeedbackUrl(entry.url) === candidateUrl);
  if (candidateUrl && avoidExact) {
    return { scoreDelta: -100, matches: [], penalties: ["avoided by feedback"] };
  }

  const candidateTerms = feedbackTerms(`${candidate.title} ${candidate.summary} ${candidate.sourceQuery || ""}`);
  const prioritized = bestFeedbackSimilarity(candidateTerms, steering.prioritizeSimilarTo);
  const avoided = bestFeedbackSimilarity(candidateTerms, steering.avoidSimilarTo);
  let scoreDelta = 0;
  const matches: string[] = [];
  const penalties: string[] = [];

  if (prioritized >= 0.5) {
    scoreDelta += prioritized >= 0.75 ? 14 : 9;
    matches.push("feedback priority");
  }
  if (avoided >= 0.5) {
    scoreDelta -= avoided >= 0.75 ? 30 : 20;
    penalties.push("feedback avoid-similar");
  }

  return { scoreDelta, matches, penalties };
}

function bestFeedbackSimilarity(
  candidateTerms: Set<string>,
  entries: Array<{ title: string; tags: string[] }>,
): number {
  let best = 0;
  for (const entry of entries) {
    const entryTerms = feedbackTerms(`${entry.title} ${entry.tags.join(" ")}`);
    if (!entryTerms.size) continue;
    let overlap = 0;
    for (const term of entryTerms) if (candidateTerms.has(term)) overlap += 1;
    if (overlap < 2) continue;
    best = Math.max(best, overlap / Math.min(4, entryTerms.size));
  }
  return Math.min(1, best);
}

function feedbackTerms(value: string): Set<string> {
  const stop = new Set([
    "and",
    "auction",
    "beach",
    "bring",
    "cars",
    "from",
    "look",
    "model",
    "more",
    "similar",
    "that",
    "the",
    "this",
    "trailer",
    "vehicle",
    "with",
  ]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3 && !stop.has(term) && !/^\d{4}$/.test(term)),
  );
}

function canonicalFeedbackUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return value.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function modernJeepLocality(candidate: SourceCandidate, context: DiscoveryContext): "nearby" | "far" | "unknown" | "not-modern-jeep" {
  const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
  if (!/\bjeep\b|\bwrangler\b|\bgladiator\b/.test(text)) return "not-modern-jeep";
  const year = Number((candidate.title.match(/\b(19|20)\d{2}\b/) || [])[0]);
  if (!Number.isFinite(year) || year < 2007) return "not-modern-jeep";
  if (!candidate.location) return "unknown";
  return isClearlyNearDrivingRadius(candidate.location, context.homeRegion) ? "nearby" : "far";
}

function isClearlyNearDrivingRadius(location: string, homeRegion: string): boolean {
  const normalizedLocation = ` ${location.toLowerCase()} `;
  const normalizedHome = homeRegion.toLowerCase();
  if (!/connecticut|\bct\b|northeast|new england|nyc|new york/i.test(normalizedHome)) {
    return normalizedHome.length >= 3 && normalizedLocation.includes(normalizedHome);
  }

  return [
    /\bct\b|connecticut/i,
    /\bri\b|rhode island/i,
    /\bma\b|massachusetts/i,
    /\bny\b|new york/i,
    /\bnj\b|new jersey/i,
    /\bpa\b|pennsylvania/i,
    /\bvt\b|vermont/i,
    /\bnh\b|new hampshire/i,
    /\bme\b|maine/i,
    /\bde\b|delaware/i,
    /\bmd\b|maryland/i,
    /\bdc\b|district of columbia/i,
  ].some((pattern) => pattern.test(normalizedLocation));
}

async function runAiScoring(
  aiScorer: CandidateAiScorer,
  context: DiscoveryContext,
  params: DiscoveryParams,
  candidates: ScoredCandidate[],
): Promise<CandidateAiScoringResult> {
  try {
    return await aiScorer.scoreCandidates({
      context,
      params,
      candidates,
    });
  } catch (error) {
    return {
      status: "failed",
      provider: "ai-gateway",
      message: errorMessage(error),
      scores: [],
    };
  }
}

function aiScoringCheck(result: CandidateAiScoringResult, checkedAt: string): SourceDiscoveryCheck {
  const heuristic = result.provider === "heuristic";
  return {
    source: heuristic ? "heuristic-scoring" : "ai-gateway",
    site: heuristic ? "Beachcar heuristic scoring" : "Cloudflare AI Gateway",
    status: result.status === "ok" ? "ok" : result.status,
    label: result.model || undefined,
    candidateCount: result.scores.length,
    checkedAt,
    message: result.message || (result.status === "ok" ? "AI rerank applied to source candidates." : "AI rerank was not applied."),
  };
}

function applyAiScoring(candidates: ScoredCandidate[], result: CandidateAiScoringResult): ScoredCandidate[] {
  const scoresByUrl = new Map(result.scores.map((score) => [score.url, score]));
  return candidates.map((candidate) => {
    const ai = scoresByUrl.get(candidate.candidate.url);
    if (!ai) return candidate;
    return {
      ...candidate,
      ai,
      score: candidate.score + clampNumber(ai.scoreDelta, -20, 20),
    };
  });
}

function listingFromCandidate(scored: ScoredCandidate, context: DiscoveryContext): AuctionListing {
  const candidate = scored.candidate;
  const lane = validLane(scored.ai?.lane) || laneForCandidate(scored);
  const ceiling = context.budgetMax + context.stretchBudget;
  const matchText = scored.matches.length ? scored.matches.join(", ") : "beach-car profile";
  const penaltyText = scored.penalties.length ? ` Watch: ${scored.penalties.join(", ")}.` : "";
  const aiWhy = scored.ai?.why ? ` AI fit note: ${scored.ai.why}` : "";
  const aiConcerns = scored.ai?.concerns ? ` AI caution: ${scored.ai.concerns}` : "";
  const location = normalizeLocationMetadata(candidate);

  return {
    section: scored.ai?.section || (scored.score >= 30 ? "Strong fits" : "Worth a look"),
    lane,
    site: candidate.site,
    title: candidate.title,
    url: candidate.url,
    bid: candidate.bid,
    bidNum: candidate.bidNum,
    bidCents: candidate.bidCents,
    total: candidate.total,
    ...location,
    endsAt: candidate.endsAt,
    timeLeft: candidate.timeLeft,
    bids: candidate.bids,
    bidders: candidate.bidders,
    comments: candidate.comments,
    fair: candidate.bidNum ? fairBand(candidate.bidNum) : "Check comparable sales before bidding",
    ceiling: `Keep total under $${ceiling.toLocaleString()} unless unusually clean.`,
    conf: `source-score-${Math.round(scored.score)}`,
    why: listingFitText(candidate, matchText, context, aiWhy),
    concerns: `Verify title, rust, underside, driving video, seating/restraint practicality, and final buyer-fee total.${penaltyText}${aiConcerns} Saved avoid notes: ${context.avoidNotes}`,
    currentTake: currentTakeText(scored),
    images: candidate.imageUrls,
    dossier: dossierFromCandidate(scored),
  };
}

function listingFitText(candidate: SourceCandidate, matchText: string, context: DiscoveryContext, aiWhy: string): string {
  const sourceDetail = firstUsefulSentence(candidate.dossier?.summary || candidate.summary);
  const route = sourceRouteText(candidate);
  const detail = sourceDetail ? ` Source notes: ${sourceDetail}` : "";
  return `${candidate.title} matched ${matchText} from ${route}; ${context.tasteNotes}.${detail}${aiWhy}`;
}

function sourceRouteText(candidate: SourceCandidate): string {
  const site = candidate.site || candidate.source || "source";
  const query = String(candidate.sourceQuery || "").trim();
  if (!query) return site;
  if (query.toLowerCase().includes(site.toLowerCase())) return query;
  const cleanedQuery = query.replace(/^bat\s+/i, "").replace(/^bring a trailer\s+/i, "").trim();
  return cleanedQuery ? `${site} ${cleanedQuery}` : site;
}

function currentTakeText(scored: ScoredCandidate): string {
  const candidate = scored.candidate;
  const parts: string[] = [];
  if (candidate.noReserve) parts.push("no reserve");
  if (candidate.bidNum) parts.push(candidate.source === "hemmings" ? `${candidate.bid} asking` : `${candidate.bid} current`);
  if (candidate.timeLeft && !/^check\b/i.test(candidate.timeLeft)) parts.push(candidate.timeLeft);
  if (scored.matches.includes("nearby modern Jeep")) parts.push("nearby Jeep exception");
  if (scored.penalties.some((penalty) => /budget|cap/i.test(penalty))) parts.push("watch budget");
  if (parts.length) return parts.join(" / ");
  return scored.score >= 30 ? "strong source match" : "worth a closer look";
}

function firstUsefulSentence(value: string | undefined): string {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const sentence = normalized.match(/^.{45,220}?(?:[.!?](?:\s|$)|$)/)?.[0] || normalized.slice(0, 220);
  return sentence.length > 220 ? `${sentence.slice(0, 217).trim()}...` : sentence.trim();
}

/**
 * Position of the current bid on the 0..1 CHEAP..RICH meter, mirroring the
 * `fairBand()` comp window (low = max(1000, bid*0.9), high = bid*1.18). This is
 * the authoritative server-side value; the iOS client only derives its own when
 * the run omits one.
 */
function deterministicValueScore(bidNum: number | undefined): number | undefined {
  if (!bidNum || bidNum <= 0) return undefined;
  const low = Math.max(1000, Math.round(bidNum * 0.9));
  const high = Math.round(bidNum * 1.18);
  if (high <= low) return 0.5;
  return Math.max(0, Math.min(1, (bidNum - low) / (high - low)));
}

/**
 * Assembles the optional dossier the built-in workflow can produce from public
 * source data: a value-meter position (AI override > deterministic), a one-line
 * summary (AI headline > source excerpt), seller/lot specs, and an optional
 * AI beach-use note. Richer sections (full writeup, equipment, service, bid log,
 * comment threads) come from the runner/operator modes. Returns undefined when
 * nothing beyond the trivial specs is available.
 */
function dossierFromCandidate(scored: ScoredCandidate): ShadeDossierData | undefined {
  const candidate = scored.candidate;
  const ai = scored.ai;
  const detail = candidate.dossier;

  const valueScore = typeof ai?.valueScore === "number" ? ai.valueScore : deterministicValueScore(candidate.bidNum);
  const summary = ai?.summary || detail?.summary || (candidate.summary ? candidate.summary.slice(0, 280) : undefined);
  const beachUse = ai?.beachNote ? { body: ai.beachNote } : undefined;

  const dossier: ShadeDossierData = {
    ...detail,
    specs: {
      seller: candidate.site,
      lot: candidate.sourceQuery,
      ...(detail?.specs || {}),
    },
    ...(summary ? { summary } : {}),
    ...(valueScore !== undefined ? { valueScore } : {}),
    ...(beachUse ? { beachUse: mergeRecords(detail?.beachUse, beachUse) } : {}),
  };

  const meaningful = dossier.summary || dossier.valueScore !== undefined || dossier.beachUse;
  return meaningful ? dossier : undefined;
}

function validLane(value: string | undefined): Lane | null {
  return value === "family" || value === "solo" || value === "curiosity" ? value : null;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function sourceSettingsFor(
  context: DiscoveryContext,
  source: string,
): { maxBudgetCents: number | null; noReserveOnly: boolean; searchNotes: string; maxSeedPages: number | null } {
  const settings = context.sourceSettings?.find((setting) => setting.source === source)?.settings || {};
  return {
    maxBudgetCents: positiveNumber(settings.maxBudgetCents),
    noReserveOnly: settings.noReserveOnly === true,
    searchNotes: typeof settings.searchNotes === "string" ? settings.searchNotes.trim() : "",
    maxSeedPages: positiveNumber(settings.maxSeedPages),
  };
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function textIncludesAnyTerm(text: string, notes: string): boolean {
  return notes
    .split(/[,;\n]+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3)
    .some((term) => text.includes(term));
}

function laneForCandidate(scored: ScoredCandidate): Lane {
  const text = `${scored.candidate.title} ${scored.candidate.summary}`.toLowerCase();
  const solo = PRIORITY_TERMS.find(([pattern, , , lane]) => lane === "solo" && pattern.test(text));
  if (solo) return "solo";
  if (/\bbaja\b|\bbrat\b|\bkei\b|\bdelica\b|\bjolly\b/.test(text)) return "curiosity";
  return "family";
}

function buildFallbackListings(
  context: DiscoveryContext,
  params: DiscoveryParams,
  generatedAt: string,
  sources: string[],
): AuctionListing[] {
  const ceiling = context.budgetMax + context.stretchBudget;
  return [
    {
      section: "Manual source checks",
      lane: "family",
      site: "Bring a Trailer",
      title: `Manual check: Volkswagen Thing and Suzuki Samurai live searches`,
      url: "https://bringatrailer.com/volkswagen/thing/",
      bid: "Check listing",
      total: "Check listing",
      ...normalizeLocationMetadata({ location: context.homeRegion }),
      endsAt: generatedAt,
      timeLeft: "manual check",
      bids: "check listing",
      bidders: "check listing",
      comments: "check listing",
      fair: "Compare recent BaT sales before bidding",
      ceiling: `Keep total under $${ceiling.toLocaleString()}`,
      conf: "fallback-source-check",
      why: `No live Worker-parsed candidate cleared the threshold for run ${params.runId}; start with high-intent BaT pages and saved sources: ${sourceSummaryText(sources)}.`,
      concerns: `This is a transparent fallback task, not a discovered listing. Apply saved avoid notes before bidding: ${context.avoidNotes}`,
      currentTake: "manual source-check fallback",
      images: [],
    },
    {
      section: "Manual source checks",
      lane: "solo",
      site: "Source checklist",
      title: "Manual check: scooter, small bike, and marketplace-style solo lane",
      url: "https://bringatrailer.com/auctions/",
      bid: "Check listing",
      total: "Check listing",
      ...normalizeLocationMetadata({ location: context.homeRegion }),
      endsAt: generatedAt,
      timeLeft: "manual check",
      bids: "check listing",
      bidders: "check listing",
      comments: "check listing",
      fair: "Keep solo lane cheap unless unusually clean",
      ceiling: "Keep total under $5k for the solo lane by default",
      conf: "fallback-source-check",
      why: "The solo lane often needs marketplace or logged-in browsing; this placeholder keeps the Workflow output actionable without inventing a listing.",
      concerns: `Marketplace/Cars & Bids may require a container or browser-session runner. Enabled sources: ${sourceSummaryText(sources)}.`,
      currentTake: "manual source-check fallback",
      images: [],
    },
  ];
}

function buildReport(
  context: DiscoveryContext,
  params: DiscoveryParams,
  listings: AuctionListing[],
  checks: SourceDiscoveryCheck[],
  fallbackUsed: boolean,
): string {
  const sourceLines = checks.map((check) => {
    const label = check.label ? ` ${check.label}` : "";
    const message = check.message ? ` - ${check.message}` : "";
    return `- ${check.site}${label}: ${check.status}, ${check.candidateCount} candidate(s)${message}`;
  });
  const listingLines = listings.map((listing) => `- ${listing.title} (${listing.site})`);
  return [
    `Cloudflare Workflow source discovery for ${context.email}.`,
    `Run source: ${params.source}${params.reason ? `; reason: ${params.reason}` : ""}.`,
    fallbackUsed ? "No live candidate cleared the threshold; transparent manual-check fallback was used." : "Live source candidates were parsed and scored against the saved profile.",
    "",
    "Sources:",
    ...sourceLines,
    "",
    "Published shortlist:",
    ...listingLines,
  ].join("\n");
}

function uniqueCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  const seen = new Set<string>();
  const unique: SourceCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.url || `${candidate.site}:${candidate.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function isOverBudget(candidate: SourceCandidate, context: DiscoveryContext, multiplier: number): boolean {
  if (!candidate.bidNum) return false;
  return candidate.bidNum > (context.budgetMax + context.stretchBudget) * multiplier;
}

function fairBand(bid: number): string {
  const low = Math.max(1000, Math.round(bid * 0.9));
  const high = Math.round(bid * 1.18);
  return `$${low.toLocaleString()}-$${high.toLocaleString()} current comp screen`;
}

function requestInit(accept: string): RequestInit {
  return {
    headers: {
      Accept: accept,
      "User-Agent": USER_AGENT,
    },
  };
}

function failedCheck(
  source: string,
  site: string,
  url: string,
  label: string | undefined,
  checkedAt: string,
  message: string,
): SourceDiscoveryCheck {
  return {
    source,
    site,
    status: "failed",
    label,
    url,
    candidateCount: 0,
    checkedAt,
    message,
  };
}

function skippedCheck(
  source: string,
  site: string,
  url: string,
  label: string | undefined,
  checkedAt: string,
  message: string,
): SourceDiscoveryCheck {
  return {
    source,
    site,
    status: "skipped",
    label,
    url,
    candidateCount: 0,
    checkedAt,
    message,
  };
}

function blockedCheck(source: string, site: string, url: string, label: string | undefined, checkedAt: string): SourceDiscoveryCheck {
  return {
    source,
    site,
    status: "blocked",
    label,
    url,
    candidateCount: 0,
    checkedAt,
    message: "Fetch reached a bot/access challenge; use a logged-in browser or container runner for this source.",
    blockedUrls: [url],
  };
}

function looksLikeBotChallenge(text: string): boolean {
  return /cf-chl|cf_chl|Just a moment|enable javascript|checking your browser/i.test(text);
}

function looksLikeChallengeResponse(response: Response, text: string): boolean {
  return /challenge/i.test(response.headers.get("cf-mitigated") || "") || looksLikeBotChallenge(text);
}

function sourceSummaryText(sources: string[]): string {
  return sources.length ? sources.join(", ") : "default public sources";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
