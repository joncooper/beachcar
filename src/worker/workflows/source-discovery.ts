import type { AuctionListing, Lane } from "../../shared/types";

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

export interface SourceDiscoveryCheck {
  source: string;
  site: string;
  status: SourceDiscoveryStatus;
  label?: string;
  url?: string;
  candidateCount: number;
  checkedAt: string;
  message?: string;
}

export interface SourceDiscoveryDraft {
  generatedAt: string;
  listings: AuctionListing[];
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
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SourceCandidate {
  source: string;
  site: string;
  sourceQuery: string;
  title: string;
  url: string;
  bid: string;
  bidNum?: number;
  total: string;
  location?: string;
  endsAt?: string;
  timeLeft?: string;
  bids?: string | number;
  bidders?: string | number;
  comments?: string | number;
  imageUrls: string[];
  summary: string;
  noReserve?: boolean;
  sourceUrl: string;
  publishedAt?: string;
}

export interface AiCandidateScore {
  url: string;
  scoreDelta?: number;
  why?: string;
  concerns?: string;
  lane?: Lane;
  section?: string;
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

const BAT_KEYWORD_PAGES: Array<{ label: string; url: string }> = [
  { label: "Volkswagen Thing", url: "https://bringatrailer.com/volkswagen/thing/" },
  { label: "Suzuki Samurai", url: "https://bringatrailer.com/suzuki/samurai/" },
  { label: "Geo Tracker", url: "https://bringatrailer.com/geo/tracker/" },
  { label: "Jeep Wrangler", url: "https://bringatrailer.com/jeep/wrangler/" },
  { label: "Mitsubishi Delica", url: "https://bringatrailer.com/mitsubishi/delica/" },
  { label: "Mini Moke", url: "https://bringatrailer.com/mini/moke/" },
  { label: "Citroen Mehari", url: "https://bringatrailer.com/citroen/mehari/" },
  { label: "Honda Monkey", url: "https://bringatrailer.com/honda/monkey/" },
  { label: "Vespa", url: "https://bringatrailer.com/vespa/" },
];

const BAT_RSS_FEED = "https://bringatrailer.com/auctions/feed/";

const PRIORITY_TERMS: Array<[RegExp, string, number, Lane]> = [
  [/\bvw thing\b|\bvolkswagen thing\b|\btype 181\b/, "VW Thing", 34, "family"],
  [/\bmini moke\b|\bmoke\b/, "Mini Moke", 34, "family"],
  [/\bmehari\b|\bcitroen mehari\b/, "Citroen Mehari", 34, "family"],
  [/\bjolly\b|\bfiat jolly\b/, "Fiat Jolly-style", 30, "family"],
  [/\bsamurai\b|\bsidekick\b|\btracker\b|\bamigo\b|\brocky\b/, "small open 4x4", 26, "family"],
  [/\bwrangler\b|\bcj-?\d?\b|\byj\b|\btj\b|\blj\b|\bjk\b/, "Jeep runabout", 18, "family"],
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
    const result = await discoverBringATrailer(context, fetchImpl, generatedAt);
    checkedSources.push(...result.checks);
    candidates.push(...result.candidates);
  }

  if (sources.includes("carsandbids")) {
    checkedSources.push(await checkCarsAndBids(fetchImpl, generatedAt));
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
    if (source !== "bringatrailer" && source !== "carsandbids" && source !== "marketplace") {
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
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  let aiScoring: CandidateAiScoringResult | null = null;

  if (options.aiScorer && scored.length) {
    aiScoring = await runAiScoring(options.aiScorer, context, params, scored);
    checkedSources.push(aiScoringCheck(aiScoring, generatedAt));
    if (aiScoring.status === "ok") {
      scored = applyAiScoring(scored, aiScoring)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    }
  }

  const fallbackUsed = scored.length === 0;
  const listings = fallbackUsed
    ? buildFallbackListings(context, params, generatedAt, sources)
    : scored.map((candidate) => listingFromCandidate(candidate, context));

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
    reportMarkdown: buildReport(context, params, listings, checkedSources, fallbackUsed),
    checkedSources,
    blockedSources,
    fallbackUsed,
    rawCandidateCount: candidates.length,
    aiScoring,
  };
}

export function parseBringATrailerLiveListings(html: string, page: { label: string; url: string }): SourceCandidate[] {
  const liveHtml = liveListingsSection(html);
  if (!liveHtml) return [];

  return liveHtml
    .split(/<div class="listing-card\b/)
    .slice(1)
    .map((card) => candidateFromBatCard(card, page))
    .filter((candidate): candidate is SourceCandidate => candidate !== null);
}

export function parseBringATrailerRssFeed(xml: string): SourceCandidate[] {
  const items = Array.from(xml.matchAll(/<item>[\s\S]*?<\/item>/gi)).slice(0, 60);
  return items
    .map((match): SourceCandidate | null => {
      const block = match[0];
      const title = textFromXmlTag(block, "title");
      const url = textFromXmlTag(block, "link");
      if (!title || !url) return null;
      const summary = stripHtml(textFromXmlTag(block, "description") || textFromXmlTag(block, "content:encoded") || "");
      const publishedAt = isoDateOrUndefined(textFromXmlTag(block, "pubDate") || textFromXmlTag(block, "dc:date"));
      return {
        source: "bringatrailer",
        site: "Bring a Trailer",
        sourceQuery: "BaT auctions feed",
        title: decodeHtml(title),
        url: decodeHtml(url),
        bid: "Check listing",
        total: "Check listing",
        timeLeft: "check listing",
        bids: "check listing",
        bidders: "check listing",
        comments: "check listing",
        imageUrls: imageUrlsFromText(block).slice(0, 4),
        summary,
        sourceUrl: BAT_RSS_FEED,
        publishedAt,
      } satisfies SourceCandidate;
    })
    .filter((candidate): candidate is SourceCandidate => candidate !== null);
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
): Promise<{ checks: SourceDiscoveryCheck[]; candidates: SourceCandidate[] }> {
  const checks: SourceDiscoveryCheck[] = [];
  const candidates: SourceCandidate[] = [];

  for (const page of BAT_KEYWORD_PAGES) {
    try {
      const response = await fetchImpl(page.url, requestInit("text/html"));
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 404) {
          checks.push(skippedCheck("bringatrailer", "Bring a Trailer", page.url, page.label, checkedAt, "Keyword page is not available."));
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
        message: parsed.length ? "Parsed live keyword-page listing cards." : "Keyword page was reachable but had no live listing cards.",
      });
      candidates.push(...parsed);
    } catch (error) {
      checks.push(failedCheck("bringatrailer", "Bring a Trailer", page.url, page.label, checkedAt, errorMessage(error)));
    }
  }

  try {
    const response = await fetchImpl(BAT_RSS_FEED, requestInit("application/rss+xml"));
    const text = await response.text();
    if (!response.ok) {
      checks.push(failedCheck("bringatrailer", "Bring a Trailer", BAT_RSS_FEED, "Auctions RSS", checkedAt, `HTTP ${response.status}`));
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
        message: "Parsed public RSS items as a broad source sweep.",
      });
      candidates.push(...parsed);
    }
  } catch (error) {
    checks.push(failedCheck("bringatrailer", "Bring a Trailer", BAT_RSS_FEED, "Auctions RSS", checkedAt, errorMessage(error)));
  }

  return { checks, candidates: candidates.filter((candidate) => !isOverBudget(candidate, context, 1.8)) };
}

async function checkCarsAndBids(fetchImpl: FetchLike, checkedAt: string): Promise<SourceDiscoveryCheck> {
  const url = "https://carsandbids.com/auctions/";
  try {
    const response = await fetchImpl(url, requestInit("text/html"));
    const text = await response.text();
    if (!response.ok) {
      return failedCheck("carsandbids", "Cars & Bids", url, undefined, checkedAt, `HTTP ${response.status}`);
    }
    if (looksLikeBotChallenge(text) || /just a moment/i.test(text)) {
      return blockedCheck("carsandbids", "Cars & Bids", url, undefined, checkedAt);
    }
    return {
      source: "carsandbids",
      site: "Cars & Bids",
      status: "skipped",
      url,
      candidateCount: 0,
      checkedAt,
      message: "The page was reachable, but a Cars & Bids parser is not implemented in the Worker path yet.",
    };
  } catch (error) {
    return failedCheck("carsandbids", "Cars & Bids", url, undefined, checkedAt, errorMessage(error));
  }
}

function liveListingsSection(html: string): string | null {
  const start = html.indexOf("listings-live");
  if (start < 0) return null;
  const completed = html.indexOf("auctions-completed", start);
  const end = completed > start ? completed : html.length;
  return html.slice(start, end);
}

function candidateFromBatCard(card: string, page: { label: string; url: string }): SourceCandidate | null {
  const title = decodeHtml(firstMatch(card, /<a class="image-overlay"[^>]*title="([^"]+)"/i) || firstMatch(card, /<h3>\s*<a [^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i));
  const url = decodeHtml(firstMatch(card, /<a class="image-overlay"[^>]*href="([^"]+)"/i) || firstMatch(card, /<h3>\s*<a href="([^"]+)"/i));
  if (!title || !url) return null;

  const timestamp = Number(firstMatch(card, /data-timestamp_end="(\d+)"/i) || "");
  const endsAt = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : undefined;
  const bid = decodeHtml(stripHtml(firstMatch(card, /<span class="bid-formatted bold">([\s\S]*?)<\/span>/i) || "")) || "Check listing";
  const bidNum = parseMoney(bid);
  const image = decodeHtml(firstMatch(card, /<img src="([^"]+)"[^>]*alt=/i));
  const excerpt = decodeHtml(stripHtml(firstMatch(card, /<div class="item-excerpt">([\s\S]*?)<\/div>/i) || ""));

  return {
    source: "bringatrailer",
    site: "Bring a Trailer",
    sourceQuery: page.label,
    title,
    url,
    bid,
    bidNum,
    total: bidNum ? `$${Math.round(bidNum * 1.05).toLocaleString()} incl. buyer fee estimate` : "Check listing",
    location: "Check listing",
    endsAt,
    timeLeft: "check listing",
    bids: "check listing",
    bidders: "check listing",
    comments: "check listing",
    imageUrls: image ? [image] : [],
    summary: excerpt,
    noReserve: /item-tag-noreserve/i.test(card),
    sourceUrl: page.url,
  };
}

function scoreCandidate(candidate: SourceCandidate, context: DiscoveryContext): ScoredCandidate {
  const text = `${candidate.title} ${candidate.summary} ${candidate.sourceQuery}`.toLowerCase();
  const settings = sourceSettingsFor(context, candidate.source);
  let score = 0;
  const matches: string[] = [];
  const penalties: string[] = [];

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
  return {
    source: "ai-gateway",
    site: "Cloudflare AI Gateway",
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

  return {
    section: scored.ai?.section || (scored.score >= 30 ? "Strong fits" : "Worth a look"),
    lane,
    site: candidate.site,
    title: candidate.title,
    url: candidate.url,
    bid: candidate.bid,
    bidNum: candidate.bidNum,
    total: candidate.total,
    location: candidate.location,
    endsAt: candidate.endsAt,
    timeLeft: candidate.timeLeft,
    bids: candidate.bids,
    bidders: candidate.bidders,
    comments: candidate.comments,
    fair: candidate.bidNum ? fairBand(candidate.bidNum) : "Check comparable sales before bidding",
    ceiling: `Keep total under $${ceiling.toLocaleString()} unless unusually clean.`,
    conf: `source-score-${Math.round(scored.score)}`,
    why: `Found on ${candidate.site} via ${candidate.sourceQuery}; matched ${matchText}. Saved taste: ${context.tasteNotes}.${aiWhy}`,
    concerns: `Verify title, rust, underside, driving video, seating/restraint practicality, and final buyer-fee total.${penaltyText}${aiConcerns} Saved avoid notes: ${context.avoidNotes}`,
    currentTake: "source-discovery candidate from public source data",
    images: candidate.imageUrls,
  };
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
): { maxBudgetCents: number | null; noReserveOnly: boolean; searchNotes: string } {
  const settings = context.sourceSettings?.find((setting) => setting.source === source)?.settings || {};
  return {
    maxBudgetCents: positiveNumber(settings.maxBudgetCents),
    noReserveOnly: settings.noReserveOnly === true,
    searchNotes: typeof settings.searchNotes === "string" ? settings.searchNotes.trim() : "",
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
      location: context.homeRegion || "Check listing",
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
      location: context.homeRegion || "Check listing",
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
  };
}

function looksLikeBotChallenge(text: string): boolean {
  return /cf-chl|cf_chl|Just a moment|enable javascript|checking your browser/i.test(text);
}

function sourceSummaryText(sources: string[]): string {
  return sources.length ? sources.join(", ") : "default public sources";
}

function imageUrlsFromText(text: string): string[] {
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>]*)?/gi)).map((match) => decodeHtml(match[0]));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    const canonical = url.replace(/\?.*$/, "");
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    unique.push(url);
  }
  return unique;
}

function textFromXmlTag(xml: string, tagName: string): string | null {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${escaped}>`, "i"));
  return match ? match[1] || match[2] || null : null;
}

function firstMatch(value: string, pattern: RegExp): string {
  const match = value.match(pattern);
  return match ? match[1] || "" : "";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: "\"",
    apos: "'",
    "#039": "'",
    nbsp: " ",
    lt: "<",
    gt: ">",
    ndash: "-",
    mdash: "-",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, raw: string) => String.fromCharCode(Number.parseInt(raw, 10)))
    .replace(/&([a-zA-Z0-9#]+);/g, (entity, name: string) => named[name] || entity)
    .trim();
}

function isoDateOrUndefined(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function parseMoney(value: string): number | undefined {
  const match = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
