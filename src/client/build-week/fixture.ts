export const BUILD_WEEK_SCENE_IDS = ["proof", "teach", "research", "review", "learn"] as const;

export type BuildWeekSceneId = (typeof BUILD_WEEK_SCENE_IDS)[number];

export const BEACHCAR_MCP_TOOL_SEQUENCE = [
  "get_setup_context",
  "save_taste_calibration",
  "plan_daily_research",
  "submit_candidates",
  "publish_run",
  "verify_latest_run",
] as const;

export type BeachcarMcpTool = (typeof BEACHCAR_MCP_TOOL_SEQUENCE)[number];

export type RecordedRunEvent = {
  at: string;
  kind: "codex" | "browser" | "mcp";
  label: string;
  detail: string;
  tool?: BeachcarMcpTool;
};

export type BuildWeekScene = {
  id: BuildWeekSceneId;
  eyebrow: string;
  title: string;
  summary: string;
};

export type RecordedFeedback = {
  action: "love" | "never_again";
  listingTitle: string;
  listingUrl: string;
  signals: readonly string[];
};

export type LearnedTaste = {
  prioritizeSimilarTo: readonly string[];
  avoidSimilarTo: readonly string[];
  suppressExactUrls: readonly string[];
};

export const buildWeekDemoFixture = {
  run: {
    id: "demo_replay_surrey_path",
    label: "DETERMINISTIC REPLAY",
    date: "PRE-PURCHASE PATH",
    startedAt: "STEP 01",
    finishedAt: "STEP 10",
    model: "GPT-5.6",
    beachcarAiCost: "$0",
    sourcesRead: 3,
    mcpSteps: 6,
    candidatesPublished: 5,
  },
  caseStudy: {
    title: "1960 Willys DJ-3A Surrey",
    url: "https://bringatrailer.com/listing/1960-jeep-dj-3a/",
    outcome: "Beachcar found it. Jon bought it.",
    note: "The purchase outcome is real. This fixed replay shows the mechanism without claiming a captured production log.",
    imageSrc: "/icon-512.png",
  },
  taste: {
    prompt: "A joyful beach-town oddball: open-air, tiny, characterful, and usable at 25 mph.",
    mustHave: ["Open-air charm", "Small footprint", "Memorable color", "Mechanical simplicity"],
    avoid: ["Anonymous luxury", "Huge modern SUVs", "Dealer-stock sameness"],
  },
  scenes: [
    {
      id: "proof",
      eyebrow: "01 · REAL-WORLD PROOF",
      title: "It found the one.",
      summary: "A personal agent that learned a peculiar taste, searched the live web, and surfaced the car its user actually bought.",
    },
    {
      id: "teach",
      eyebrow: "02 · TEACH IT ONCE",
      title: "Taste becomes a research brief.",
      summary: "Codex interviews the user in plain language, then saves structured taste through Beachcar's MCP.",
    },
    {
      id: "research",
      eyebrow: "03 · LOCAL, AUTHENTICATED RESEARCH",
      title: "Your Codex does the legwork.",
      summary: "GPT-5.6 plans the search, reads auction sites in the user's signed-in browser, and publishes evidence instead of guesses.",
    },
    {
      id: "review",
      eyebrow: "04 · FIVE, NOT FIVE HUNDRED",
      title: "A shortlist worth opening.",
      summary: "Beachcar turns a noisy market into a small, auditable deck with reasons, caveats, and source links.",
    },
    {
      id: "learn",
      eyebrow: "05 · TOMORROW GETS BETTER",
      title: "Love it. Or: never again.",
      summary: "Every decisive reaction becomes explicit memory that changes the next research plan.",
    },
  ] satisfies readonly BuildWeekScene[],
  timeline: [
    {
      at: "STEP 01",
      kind: "codex",
      label: "Local Codex · GPT-5.6",
      detail: "Started the deterministic Beachcar replay.",
    },
    {
      at: "STEP 02",
      kind: "mcp",
      label: "get_setup_context",
      detail: "Loaded the user's lanes, prior feedback, and source settings.",
      tool: "get_setup_context",
    },
    {
      at: "STEP 03",
      kind: "mcp",
      label: "save_taste_calibration",
      detail: "Saved the interview as durable, structured taste.",
      tool: "save_taste_calibration",
    },
    {
      at: "STEP 04",
      kind: "mcp",
      label: "plan_daily_research",
      detail: "Created targeted queries and a source-by-source plan.",
      tool: "plan_daily_research",
    },
    {
      at: "STEP 05",
      kind: "browser",
      label: "Signed-in browser · Bring a Trailer",
      detail: "Read current results and listing evidence with the user's access.",
    },
    {
      at: "STEP 06",
      kind: "browser",
      label: "Signed-in browser · Cars & Bids",
      detail: "Compared listing evidence, comments, location, and auction timing.",
    },
    {
      at: "STEP 07",
      kind: "browser",
      label: "Signed-in browser · Hemmings",
      detail: "Cross-checked inventory and filtered weak matches.",
    },
    {
      at: "STEP 08",
      kind: "mcp",
      label: "submit_candidates",
      detail: "Advanced five fixed fixture candidates to the publication step.",
      tool: "submit_candidates",
    },
    {
      at: "STEP 09",
      kind: "mcp",
      label: "publish_run",
      detail: "Bound the fixed shortlist to the replay's fixture run id.",
      tool: "publish_run",
    },
    {
      at: "STEP 10",
      kind: "mcp",
      label: "verify_latest_run",
      detail: "Read the same fixture run id and five-card replay state back.",
      tool: "verify_latest_run",
    },
  ] satisfies readonly RecordedRunEvent[],
  reviewCards: [
    {
      rank: 1,
      title: "1960 Willys DJ-3A Surrey",
      fit: 97,
      lane: "JOY RIDE",
      why: "Open-air, compact, mechanically simple, and impossible to mistake for anyone else's car.",
      caveat: "Low-speed use only; inspect the older restoration closely.",
      market: "Published case-study result: $38,000.",
      sourceLabel: "BaT case study",
    },
    {
      rank: 2,
      title: "1991 Nissan Figaro",
      fit: 89,
      lane: "CURIOUS",
      why: "Tiny convertible with joyful color and serious character.",
      caveat: "Right-hand drive and more complexity than the Surrey.",
      market: "Price omitted in this fixed replay.",
      sourceLabel: "Illustrative fixture",
    },
    {
      rank: 3,
      title: "1974 Volkswagen Thing",
      fit: 86,
      lane: "BEACH",
      why: "Simple, open, friendly, and built for slow adventures.",
      caveat: "Condition and corrosion vary dramatically.",
      market: "Price omitted in this fixed replay.",
      sourceLabel: "Illustrative fixture",
    },
  ] as const,
  feedback: {
    love: {
      action: "love",
      listingTitle: "1960 Willys DJ-3A Surrey",
      listingUrl: "https://bringatrailer.com/listing/1960-jeep-dj-3a/",
      signals: ["open-air microcar", "playful factory color", "slow-car charm"],
    },
    neverAgain: {
      action: "never_again",
      listingTitle: "2025 Luxury Performance SUV",
      listingUrl: "https://example.com/recorded-demo/luxury-performance-suv",
      signals: ["oversized modern SUV", "anonymous specification", "high-speed focus"],
    },
  } satisfies Record<"love" | "neverAgain", RecordedFeedback>,
} as const;

export function isBuildWeekSceneId(value: string | null | undefined): value is BuildWeekSceneId {
  return BUILD_WEEK_SCENE_IDS.includes(value as BuildWeekSceneId);
}

export function sceneFromSearch(search: string, fallback: BuildWeekSceneId = "proof"): BuildWeekSceneId {
  const scene = new URLSearchParams(search).get("scene");
  return isBuildWeekSceneId(scene) ? scene : fallback;
}

export function sceneSearch(scene: BuildWeekSceneId, currentSearch = ""): string {
  const params = new URLSearchParams(currentSearch);
  params.set("scene", scene);
  return `?${params.toString()}`;
}

export function moveScene(scene: BuildWeekSceneId, offset: number): BuildWeekSceneId {
  const currentIndex = BUILD_WEEK_SCENE_IDS.indexOf(scene);
  const nextIndex = Math.min(BUILD_WEEK_SCENE_IDS.length - 1, Math.max(0, currentIndex + offset));
  return BUILD_WEEK_SCENE_IDS[nextIndex];
}

export function sceneForShortcut(scene: BuildWeekSceneId, key: string): BuildWeekSceneId | null {
  if (key === "ArrowLeft") return moveScene(scene, -1);
  if (key === "ArrowRight") return moveScene(scene, 1);
  if (key.toLowerCase() === "r") return "proof";

  const directIndex = Number.parseInt(key, 10) - 1;
  return Number.isInteger(directIndex) && directIndex >= 0 && directIndex < BUILD_WEEK_SCENE_IDS.length
    ? BUILD_WEEK_SCENE_IDS[directIndex]
    : null;
}

export function mcpToolsFromTimeline(events: readonly RecordedRunEvent[]): BeachcarMcpTool[] {
  return events.flatMap((event) => (event.kind === "mcp" && event.tool ? [event.tool] : []));
}

export function learnFromRecordedFeedback(
  love: RecordedFeedback,
  neverAgain: RecordedFeedback,
): LearnedTaste {
  return {
    prioritizeSimilarTo: [...love.signals],
    avoidSimilarTo: [...neverAgain.signals],
    suppressExactUrls: [neverAgain.listingUrl],
  };
}

export const recordedLearnedTaste = learnFromRecordedFeedback(
  buildWeekDemoFixture.feedback.love,
  buildWeekDemoFixture.feedback.neverAgain,
);
