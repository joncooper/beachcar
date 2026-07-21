import { describe, expect, it } from "vitest";
import {
  BEACHCAR_MCP_TOOL_SEQUENCE,
  BUILD_WEEK_SCENE_IDS,
  buildWeekDemoFixture,
  learnFromRecordedFeedback,
  mcpToolsFromTimeline,
  moveScene,
  recordedLearnedTaste,
  sceneForShortcut,
  sceneFromSearch,
  sceneSearch,
} from "../src/client/build-week/fixture";

describe("Build Week recorded demo fixture", () => {
  it("keeps the five-scene story in its intended order", () => {
    expect(BUILD_WEEK_SCENE_IDS).toEqual(["proof", "teach", "research", "review", "learn"]);
    expect(buildWeekDemoFixture.scenes.map((scene) => scene.id)).toEqual(BUILD_WEEK_SCENE_IDS);
  });

  it("deep-links scenes without dropping unrelated query parameters", () => {
    expect(sceneFromSearch("?scene=research")).toBe("research");
    expect(sceneFromSearch("?scene=unknown")).toBe("proof");
    expect(sceneFromSearch("?scene=unknown", "review")).toBe("review");

    const nextSearch = sceneSearch("learn", "?judge=1&scene=proof");
    expect(new URLSearchParams(nextSearch).get("scene")).toBe("learn");
    expect(new URLSearchParams(nextSearch).get("judge")).toBe("1");
  });

  it("supports bounded arrows, direct number keys, and reset", () => {
    expect(moveScene("proof", -1)).toBe("proof");
    expect(moveScene("learn", 1)).toBe("learn");
    expect(sceneForShortcut("teach", "ArrowRight")).toBe("research");
    expect(sceneForShortcut("review", "ArrowLeft")).toBe("research");
    expect(sceneForShortcut("proof", "5")).toBe("learn");
    expect(sceneForShortcut("learn", "R")).toBe("proof");
    expect(sceneForShortcut("proof", "6")).toBeNull();
  });

  it("records the exact Beachcar MCP contract in order", () => {
    expect(mcpToolsFromTimeline(buildWeekDemoFixture.timeline)).toEqual(BEACHCAR_MCP_TOOL_SEQUENCE);
    expect(BEACHCAR_MCP_TOOL_SEQUENCE).toEqual([
      "get_setup_context",
      "save_taste_calibration",
      "plan_daily_research",
      "submit_candidates",
      "publish_run",
      "verify_latest_run",
    ]);
  });

  it("keeps browser reads as evidence without inserting them into the MCP sequence", () => {
    const browserReads = buildWeekDemoFixture.timeline.filter((event) => event.kind === "browser");
    expect(browserReads.map((event) => event.label)).toEqual([
      "Signed-in browser · Bring a Trailer",
      "Signed-in browser · Cars & Bids",
      "Signed-in browser · Hemmings",
    ]);
    expect(mcpToolsFromTimeline(buildWeekDemoFixture.timeline)).toHaveLength(6);
  });

  it("turns Love and Never Again into explicit next-run controls", () => {
    const learned = learnFromRecordedFeedback(
      buildWeekDemoFixture.feedback.love,
      buildWeekDemoFixture.feedback.neverAgain,
    );

    expect(learned).toEqual(recordedLearnedTaste);
    expect(learned.prioritizeSimilarTo).toContain("open-air microcar");
    expect(learned.avoidSimilarTo).toContain("oversized modern SUV");
    expect(learned.suppressExactUrls).toEqual([buildWeekDemoFixture.feedback.neverAgain.listingUrl]);
  });

  it("is an explicitly reconstructed, zero-Beachcar-AI-cost Surrey case study", () => {
    expect(buildWeekDemoFixture.run).toMatchObject({
      label: "DETERMINISTIC REPLAY",
      date: "PRE-PURCHASE PATH",
      startedAt: "STEP 01",
      finishedAt: "STEP 10",
      model: "GPT-5.6",
      beachcarAiCost: "$0",
    });
    expect(buildWeekDemoFixture.caseStudy.note).toContain("without claiming a captured production log");
    expect(buildWeekDemoFixture.caseStudy.title).toBe("1960 Willys DJ-3A Surrey");
    expect(buildWeekDemoFixture.caseStudy.url).toBe("https://bringatrailer.com/listing/1960-jeep-dj-3a/");
    expect(buildWeekDemoFixture.caseStudy.imageSrc).toBe("/icon-512.png");
  });
});
