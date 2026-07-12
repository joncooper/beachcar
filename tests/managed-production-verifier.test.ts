import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN,
  atomicReplacePrivateFile,
  beachcarUserIdForEmail,
  evaluateManagedAiProof,
  evaluateRunProvenance,
  evaluateSourceProof,
  extractClerkPublishableKeys,
  isClerkPublishableKey,
  jwtSubject,
  listingsHaveExplicitLocationStatus,
  prepareTicketRedemption,
  redactSensitive,
  sameOriginDeckImageUrl,
  validManagedScheduleStatus,
} from "../scripts/lib/managed-production-verifier";

const target = "https://beachcar-watch.jon-cooper.workers.dev";

describe("managed verifier protected-file replacement", () => {
  it("atomically replaces a private file and preserves the original when rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "beachcar-managed-verifier-"));
    const path = join(directory, ".env.local");
    try {
      await writeFile(path, "ORIGINAL=retained\n", { mode: 0o600 });
      await expect(
        atomicReplacePrivateFile(path, "REPLACEMENT=never-installed\n", async () => {
          throw new Error("injected rename failure");
        }),
      ).rejects.toThrow("injected rename failure");
      expect(await readFile(path, "utf8")).toBe("ORIGINAL=retained\n");

      await atomicReplacePrivateFile(path, "REPLACEMENT=installed\n");
      expect(await readFile(path, "utf8")).toBe("REPLACEMENT=installed\n");
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("managed verifier schedule proof", () => {
  const user = {
    id: "user-fixture",
    profile: { scheduleCron: "0 8 * * *", timezone: "America/New_York" },
  };
  const expectedNextRunAt = "2026-07-12T12:00:00.000Z";
  const baseStatus = {
    userId: "user-fixture",
    scheduleCron: "0 8 * * *",
    scheduleTimezone: "America/New_York",
    scheduleId: "schedule-fixture",
    nextRunAt: expectedNextRunAt,
    phase: "scheduled",
    schedules: [
      {
        id: "schedule-fixture",
        callback: "queueScheduledRun",
        type: "scheduled",
        nextRunAt: expectedNextRunAt,
      },
    ],
  };

  it("rejects a future alarm that is not the next saved timezone occurrence", () => {
    expect(
      validManagedScheduleStatus({
        status: baseStatus,
        user,
        expectedNextRunAt,
        now: new Date("2026-07-11T18:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      validManagedScheduleStatus({
        status: {
          ...baseStatus,
          nextRunAt: "2026-07-13T12:00:00.000Z",
          schedules: [{ ...baseStatus.schedules[0], nextRunAt: "2026-07-13T12:00:00.000Z" }],
        },
        user,
        expectedNextRunAt,
        now: new Date("2026-07-11T18:00:00.000Z"),
      }),
    ).toBe(false);
  });
});

describe("managed verifier ticket and target gates", () => {
  it("keeps Beachcar email ids distinct from Clerk subject ids", () => {
    expect(beachcarUserIdForEmail(" Pilot@Example.COM ")).toBe("email:pilot@example.com");
  });

  it("extracts only the trusted legacy ticket and redeems it on the current production origin", () => {
    const result = prepareTicketRedemption({
      storedSignInUrl: `${DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN}/?__clerk_ticket=ticket-fixture-secret`,
      targetUrl: target,
      configuredDeployUrl: `${target}/`,
      trustedLegacyOrigins: [DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN],
    });

    expect(result).toMatchObject({
      storedOrigin: DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN,
      targetOrigin: target,
      ticket: "ticket-fixture-secret",
      rebased: true,
    });
    const redemption = new URL(result.redemptionUrl);
    expect(redemption.origin).toBe(target);
    expect([...redemption.searchParams.keys()]).toEqual(["__clerk_ticket"]);
    expect(redemption.searchParams.get("__clerk_ticket")).toBe("ticket-fixture-secret");
  });

  it("rejects untrusted siblings, target drift, extra query data, and non-HTTPS origins", () => {
    const common = {
      targetUrl: target,
      configuredDeployUrl: target,
      trustedLegacyOrigins: [DEFAULT_TRUSTED_LEGACY_TICKET_ORIGIN],
    };
    expect(() =>
      prepareTicketRedemption({ ...common, storedSignInUrl: "https://other.jon-cooper.workers.dev/?__clerk_ticket=x" }),
    ).toThrow(/trusted-origin allowlist/);
    expect(() =>
      prepareTicketRedemption({ ...common, targetUrl: "https://preview.example.com", storedSignInUrl: `${target}/?__clerk_ticket=x` }),
    ).toThrow(/exactly match/);
    expect(() =>
      prepareTicketRedemption({ ...common, storedSignInUrl: `${target}/?__clerk_ticket=x&next=bad` }),
    ).toThrow(/exactly one/);
    expect(() =>
      prepareTicketRedemption({ ...common, storedSignInUrl: "http://beachcar-watch.jon-cooper.workers.dev/?__clerk_ticket=x" }),
    ).toThrow(/HTTPS/);
  });

  it("finds exactly the Clerk build marker without treating arbitrary text as a key", () => {
    expect(extractClerkPublishableKeys("a pk_test_fixture123 b pk_test_fixture123")).toEqual(["pk_test_fixture123"]);
    expect(isClerkPublishableKey("pk_live_fixture_ABC-123")).toBe(true);
    expect(isClerkPublishableKey("not-a-clerk-key")).toBe(false);
  });
});

describe("managed verifier exact run proof", () => {
  const expected = {
    agentRunId: "agent-run-exact",
    userId: "email:pilot@example.com",
    workflowInstanceId: "workflow-agent-run-exact",
    reason: "source-quality-v1-production-verification:fixture",
  };
  const summary = {
    publisher: "cloudflare-workflow-source-discovery",
    agentRunId: expected.agentRunId,
    userId: expected.userId,
    workflowInstanceId: expected.workflowInstanceId,
    source: "manual",
    reason: expected.reason,
    fallbackUsed: false,
  };

  it("requires every provenance field and an explicit false fallback flag", () => {
    expect(evaluateRunProvenance(summary, expected)).toEqual({
      publisher: true,
      agentRunId: true,
      userId: true,
      workflowInstanceId: true,
      source: true,
      reason: true,
      directDiscovery: true,
    });
    expect(evaluateRunProvenance({ ...summary, fallbackUsed: undefined }, expected).directDiscovery).toBe(false);
    expect(evaluateRunProvenance({ ...summary, agentRunId: "another-run" }, expected).agentRunId).toBe(false);
  });

  it("proves the three-source snapshot and distinguishes handoff from accepted terminal merge", () => {
    const userSourceSettings = [
      { source: "bringatrailer", enabled: true },
      { source: "carsandbids", enabled: true },
      { source: "hemmings", enabled: true },
    ];
    const checkedSources = [
      { source: "bringatrailer", status: "ok" },
      { source: "carsandbids", status: "blocked" },
      { source: "hemmings", status: "blocked" },
    ];
    const queued = evaluateSourceProof({
      userSourceSettings,
      summaryEnabledSources: ["bringatrailer", "carsandbids", "hemmings"],
      checkedSources,
      runnerTasks: [
        { id: "cab", source: "carsandbids", status: "queued" },
        { id: "hemmings", source: "hemmings", status: "queued" },
      ],
    });
    expect(queued.enabledSourcesMatch).toBe(true);
    expect(queued.requiredSourcesEnabled).toBe(true);
    expect(queued.diagnostics).toEqual({ bringatrailer: true, carsandbids: true, hemmings: true });
    expect(queued.runnerHandoffs).toMatchObject({ carsandbids: true, hemmings: true });
    expect(queued.runnerMerges).toMatchObject({ carsandbids: false, hemmings: false });

    const terminal = evaluateSourceProof({
      userSourceSettings,
      summaryEnabledSources: ["bringatrailer", "carsandbids", "hemmings"],
      checkedSources,
      runnerTasks: [
        {
          id: "cab",
          source: "carsandbids",
          status: "completed",
          mergeStatus: "merged",
          resultStatus: "ok",
          importedCount: 1,
        },
        {
          id: "hemmings",
          source: "hemmings",
          status: "completed",
          mergeStatus: "empty",
          resultStatus: "blocked",
        },
      ],
    });
    expect(terminal.runnerMerges).toMatchObject({ carsandbids: true, hemmings: true });
  });

  it("never accepts failed C&B or Hemmings tasks as merge proof", () => {
    const proof = evaluateSourceProof({
      userSourceSettings: [
        { source: "bringatrailer", enabled: true },
        { source: "carsandbids", enabled: true },
        { source: "hemmings", enabled: true },
      ],
      summaryEnabledSources: ["bringatrailer", "carsandbids", "hemmings"],
      checkedSources: [],
      runnerTasks: [
        { source: "carsandbids", status: "failed", mergeStatus: "merged", resultStatus: "ok", importedCount: 2 },
        { source: "hemmings", status: "failed", mergeStatus: "empty", resultStatus: "blocked" },
      ],
    });
    expect(proof.runnerMerges).toMatchObject({ carsandbids: false, hemmings: false });
  });
});

describe("managed verifier AI, image, and redaction proof", () => {
  const user = { aiSettings: { mode: "managed", status: "active" } };

  it("requires explicit heuristic provenance and no run-scoped model event by default", () => {
    const proof = evaluateManagedAiProof({
      user,
      sourceSummary: { aiScoring: { status: "skipped", provider: "heuristic" } },
      usage: { summary: { budgetExceeded: false }, events: [] },
      agentRunId: "agent-run-exact",
    });
    expect(proof).toEqual({ settings: true, scoring: true, budgetHealthy: true, usageEvent: true, mode: "heuristic" });

    expect(
      evaluateManagedAiProof({
        user,
        sourceSummary: { aiScoring: null },
        usage: { summary: { budgetExceeded: false }, events: [] },
        agentRunId: "agent-run-exact",
      }).scoring,
    ).toBe(false);
  });

  it("requires the exact successful usage event in AI Gateway mode and fails an exceeded budget", () => {
    const proof = evaluateManagedAiProof({
      user,
      sourceSummary: { aiScoring: { status: "ok", provider: "cloudflare-ai-gateway" } },
      usage: {
        summary: { budgetExceeded: true },
        events: [
          {
            agentRunId: "agent-run-exact",
            operation: "candidate_scoring",
            mode: "managed",
            provider: "cloudflare-ai-gateway",
            status: "ok",
          },
        ],
      },
      agentRunId: "agent-run-exact",
      requireAiGateway: true,
    });
    expect(proof).toMatchObject({ scoring: true, usageEvent: true, budgetHealthy: false, mode: "ai-gateway" });
  });

  it("selects only an exact same-origin Beachcar image endpoint", () => {
    const listings = [
      { images: ["https://attacker.example/api/images/fake?variant=deck"] },
      { images: ["/api/images/real-key?variant=deck"] },
    ];
    expect(sameOriginDeckImageUrl(listings, target)).toBe(`${target}/api/images/real-key?variant=deck`);
    expect(sameOriginDeckImageUrl([{ images: ["https://attacker.example/api/images/fake"] }], target)).toBe("");
  });

  it("requires every listing to state either a usable or explicit missing location", () => {
    expect(
      listingsHaveExplicitLocationStatus([
        { locationStatus: "ok", location: "Hudson, NY" },
        { locationStatus: "missing", missingData: ["location"] },
      ]),
    ).toBe(true);
    expect(listingsHaveExplicitLocationStatus([{ locationStatus: "ok", location: "" }])).toBe(false);
    expect(listingsHaveExplicitLocationStatus([{ locationStatus: "missing", missingData: [] }])).toBe(false);
  });

  it("checks JWT subject and removes exact or patterned credentials from errors", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user_fixture" })).toString("base64url");
    expect(jwtSubject(`header.${payload}.signature`)).toBe("user_fixture");
    const secret = "opaque-ticket-fixture";
    expect(redactSensitive(new Error(`failed ${secret} ?__clerk_ticket=${secret}`), [secret])).not.toContain(secret);
  });
});

describe("managed verifier executable lifecycle invariants", () => {
  const source = readFileSync(resolve("scripts/verify-managed-production.mjs"), "utf8");
  const helperSource = readFileSync(resolve("scripts/lib/managed-production-verifier.ts"), "utf8");
  const appSource = readFileSync(resolve("src/client/App.tsx"), "utf8");

  it("clears the consumed ticket before any managed run request and has no fresh-process resume flag", () => {
    expect(source.indexOf('"/api/admin/runtime"'))
      .toBeLessThan(source.indexOf("await markTicketConsumed()"));
    expect(source).toContain('aiProofMode: requireAiGatewayFlag ? "ai-gateway" : requireHeuristicFlag ? "heuristic" : "auto-preflight"');
    expect(source).toContain("entry?.id === expectedBeachcarUserId");
    expect(source).toContain("jwtSubject(initialToken) === expectedClerkUserId");
    expect(source).toContain("meResult.body?.id === expectedBeachcarUserId");
    expect(source.indexOf("const preflight = await runPublicPreflight()"))
      .toBeLessThan(source.indexOf("await markTicketConsumed()"));
    expect(source.indexOf("await markTicketConsumed()"))
      .toBeLessThan(source.indexOf('"/api/agent-runs"'));
    expect(source).toContain("CLERK_DEV_SIGN_IN_TOKEN: \"\"");
    expect(source).toContain("CLERK_DEV_SIGN_IN_URL: \"\"");
    expect(source).toContain("CLERK_DEV_APP_SIGN_IN_URL: \"\"");
    expect(source).toContain("CLERK_DEV_SIGN_IN_CONSUMED_AT");
    expect(source).not.toContain("--resume-run-id");
  });

  it("checkpoints runner ids before merge waiting and keeps UI proof before final schedule sync", () => {
    expect(source).toContain('const requireRunnerMerge = !allowRunnerHandoffOnly');
    expect(source).toContain('--allow-runner-handoff-only');
    expect(source.indexOf('stage: requireRunnerMerge ? "waiting-runner-merges"'))
      .toBeLessThan(source.indexOf("await pollRequiredRunnerMerges"));
    expect(source.indexOf("await verifySignedInDom(listings)"))
      .toBeLessThan(source.indexOf('"/api/agent-schedule/sync"'));
    expect(source.indexOf('"/api/agent-schedule/sync"'))
      .toBeLessThan(source.indexOf('"/api/agent-schedule"'));
    expect(helperSource).toContain('status.phase === "scheduled"');
    expect(helperSource).toContain('schedule?.type === "scheduled"');
    expect(helperSource).toContain('!("payload" in (schedule || {}))');
  });

  it("binds signed-in DOM proof to the exact Agent, Workflow, and published run", () => {
    expect(appSource).toContain("data-agent-run-id");
    expect(appSource).toContain("data-workflow-instance-id");
    expect(appSource).toContain("data-published-run-id");
    expect(appSource).toContain("data-run-generated-at");
    expect(source).toContain("renderedRun.agentRunId === expectedRun.agentRunId");
    expect(source).toContain("renderedRun.workflowInstanceId === expectedRun.workflowInstanceId");
    expect(source).toContain("renderedRun.publishedRunId === expectedRun.publishedRunId");
    expect(source).toContain("renderedRun.generatedAt === expectedRun.generatedAt");
  });
});
