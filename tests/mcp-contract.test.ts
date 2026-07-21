import { describe, expect, it } from "vitest";
import { localCodexExecutionPolicy, localCodexResearchSteps, mcpToolDefinitions } from "../src/worker/mcp";

describe("Beachcar MCP contract", () => {
  it("makes local Codex and the user's signed-in browser the stable execution policy", () => {
    expect(localCodexExecutionPolicy).toEqual({
      id: "local-codex-browser-v1",
      executor: "local-codex",
      browserSession: "user-signed-in-local-browser",
      cloudAgent: false,
      managedAiAccounting: "none",
      usageAccounting: "explicit-known-external-cost-only",
    });

    const instructions = localCodexResearchSteps.join(" ");
    expect(instructions).toContain("signed-in local Codex browser");
    expect(instructions).toContain("Never hand browsing or research to a cloud agent");
    expect(instructions).toContain("Do not call record_usage for local Codex or local browser work");
    expect(instructions).not.toContain("browser-capable cloud agent");
    expect(instructions).not.toContain("record_usage for every");
  });

  it("advertises explicit safety annotations for every tool", () => {
    for (const tool of mcpToolDefinitions) {
      expect(tool.annotations.readOnlyHint, `${tool.name} readOnlyHint`).toBeTypeOf("boolean");
      expect(tool.annotations.destructiveHint, `${tool.name} destructiveHint`).toBeTypeOf("boolean");
    }

    const tools = new Map(mcpToolDefinitions.map((tool) => [tool.name, tool]));
    expect(tools.get("get_setup_context")?.annotations.readOnlyHint).toBe(true);
    expect(tools.get("plan_daily_research")?.annotations.readOnlyHint).toBe(true);
    expect(tools.get("submit_candidates")?.annotations.readOnlyHint).toBe(true);
    expect(tools.get("submit_candidates")?.description).toContain("Images are optional");
    expect(tools.get("publish_run")?.annotations.readOnlyHint).toBe(false);
    expect(tools.get("publish_run")?.annotations.destructiveHint).toBe(false);
    expect(tools.get("record_usage")?.description).toContain("Never use this for local Codex or local browser work");
  });
});
