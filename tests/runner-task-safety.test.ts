import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("remote runner task safety", () => {
  const source = readFileSync(resolve("scripts/run-runner-task-local.mjs"), "utf8");

  it("requires a remote execution to be scoped to an exact task or Agent run", () => {
    expect(source).toContain('if (!isLocalUrl(baseUrl) && !targetTaskId && !targetAgentRunId)');
    expect(source).toContain("Remote runner execution requires --task-id or --agent-run-id");
  });

  it("preflights the selected task before claiming it", () => {
    const preflight = source.indexOf("/api/admin/runner-tasks/next?");
    const claim = source.indexOf('fetch(`${baseUrl}/api/admin/runner-tasks/claim`');
    expect(preflight).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(preflight);
    expect(source).toContain("targetSource && normalizeSource(preview.source) !== targetSource");
  });

  it("uses a unique default owner and refuses a claim response without exact ownership", () => {
    expect(source).toContain("`local-codex-${process.pid}-${randomUUID()}`");
    expect(source).toContain('body.task.status !== "running" || body.task.runnerId !== runnerId');
  });
});
