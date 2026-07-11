import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SOURCE_QUALITY_V1_MIGRATION,
  collectWorkerSecrets,
  evaluateCloudflareAccountGate,
  evaluateSourceQualitySchemaGate,
  isSafeSourceQualityMigrationSet,
  missingRequiredWorkerSecrets,
  missingVerificationGateStatus,
  pendingD1MigrationFiles,
  verificationRequirementArgs,
} from "../scripts/lib/cloudflare-rollout";

const productionAccount = "b8873e78bf5e48fcdc91e87f2324cf55";
const otherAccount = "602850f594fe39f0d6b0e21a7da1d66e";

describe("Cloudflare rollout account gate", () => {
  it("fails account selection when CLOUDFLARE_ACCOUNT_ID overrides the configured production account", () => {
    const gate = evaluateCloudflareAccountGate({
      configAccountId: productionAccount,
      env: {
        CLOUDFLARE_ACCOUNT_ID: otherAccount,
        BEACHCAR_EXPECTED_CLOUDFLARE_ACCOUNT_ID: otherAccount,
      },
      authenticatedAccountIds: [productionAccount, otherAccount],
    });

    expect(gate.expectedAccountId).toBe(productionAccount);
    expect(gate.selectedAccountId).toBe(otherAccount);
    expect(gate.selectedMatchesExpected).toBe(false);
    expect(gate.credentialsCanAccessExpected).toBe(true);
  });

  it("fails when authenticated credentials cannot access the configured production account", () => {
    const gate = evaluateCloudflareAccountGate({
      configAccountId: productionAccount,
      authenticatedAccountIds: [otherAccount],
    });

    expect(gate.selectedMatchesExpected).toBe(true);
    expect(gate.credentialsCanAccessExpected).toBe(false);
  });

  it("makes the strict resource checker exit non-zero when Wrangler selects another account", () => {
    const directory = mkdtempSync(join(tmpdir(), "beachcar-wrangler-mock-"));
    const executable = join(directory, "bunx");
    writeFileSync(
      executable,
      `#!/usr/bin/env node
const command = process.argv.slice(3).join(" ");
if (command === "whoami --json") {
  console.log(JSON.stringify({ loggedIn: true, accounts: [{ id: "${productionAccount}" }, { id: "${otherAccount}" }] }));
} else if (command === "d1 list --json") {
  console.log(JSON.stringify([{ name: "beach-car-watch", uuid: "2860a6be-7cf0-4fc0-821f-166e78521154" }]));
} else if (command === "r2 bucket list") {
  console.log("name: beachcar-watch-images");
} else if (command.startsWith("secret list")) {
  console.log(JSON.stringify([{ name: "PUBLISH_TOKEN" }, { name: "CLERK_SECRET_KEY" }, { name: "CLERK_JWT_ISSUER" }]));
} else if (command.startsWith("deployments list")) {
  console.log("[]");
} else {
  console.error("unexpected mock command: " + command);
  process.exit(2);
}
`,
      { mode: 0o700 },
    );
    chmodSync(executable, 0o700);
    try {
      const result = spawnSync("bun", ["scripts/check-cloudflare-resources.mjs", "--json", "--strict"], {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH || ""}`,
          CLOUDFLARE_ACCOUNT_ID: otherAccount,
          BEACHCAR_EXPECTED_CLOUDFLARE_ACCOUNT_ID: "",
        },
      });
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.expectedAccountId).toBe(productionAccount);
      expect(report.accountId).toBe(otherAccount);
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          label: "Wrangler selected account matches expected production account",
          status: "todo",
        }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Cloudflare rollout secret and verifier handling", () => {
  it("collects only real Worker values and never treats the Wrangler API token as a Worker secret", () => {
    const secrets = collectWorkerSecrets({
      PUBLISH_TOKEN: "publish-token-with-at-least-24-characters",
      CLERK_SECRET_KEY: "sk_test_local-fixture",
      CLERK_JWT_ISSUER: "https://fixture.clerk.accounts.dev",
      BEACHCAR_AI_GATEWAY_TOKEN: "<your-gateway-token>",
      CLOUDFLARE_API_TOKEN: "wrangler-auth-fixture",
    });

    expect(Object.keys(secrets).sort()).toEqual(["CLERK_JWT_ISSUER", "CLERK_SECRET_KEY", "PUBLISH_TOKEN"]);
    expect(secrets).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(secrets).not.toHaveProperty("BEACHCAR_AI_GATEWAY_TOKEN");
  });

  it("allows required secrets to be satisfied by the union of remote names and local deploy input", () => {
    expect(missingRequiredWorkerSecrets(["CLERK_SECRET_KEY", "CLERK_JWT_ISSUER"], ["PUBLISH_TOKEN"])).toEqual([]);
    expect(missingRequiredWorkerSecrets(["CLERK_SECRET_KEY"], ["PUBLISH_TOKEN"])).toEqual(["CLERK_JWT_ISSUER"]);
  });

  it("requires only authenticated verifier gates with locally supplied tokens", () => {
    expect(
      verificationRequirementArgs({
        PUBLISH_TOKEN: "publish-token-with-at-least-24-characters",
        BEACHCAR_CLERK_TOKEN: "",
        BEACHCAR_MCP_TOKEN: "",
      }),
    ).toEqual(["--require-publish"]);
    expect(missingVerificationGateStatus(false)).toBe("skip");
    expect(missingVerificationGateStatus(true)).toBe("fail");
  });
});

describe("Cloudflare rollout D1 gates", () => {
  it("accepts only no pending migrations or exactly Source Quality migration 0011", () => {
    expect(isSafeSourceQualityMigrationSet("✅ No migrations to apply!\n")).toBe(true);
    expect(isSafeSourceQualityMigrationSet(`Migrations to be applied:\n${SOURCE_QUALITY_V1_MIGRATION}\n`)).toBe(true);
    expect(isSafeSourceQualityMigrationSet(`0005_multi_user_beta.sql\n${SOURCE_QUALITY_V1_MIGRATION}\n`)).toBe(false);
    expect(isSafeSourceQualityMigrationSet("unexpected output")).toBe(false);
    expect(pendingD1MigrationFiles(`| ${SOURCE_QUALITY_V1_MIGRATION} |`)).toEqual([SOURCE_QUALITY_V1_MIGRATION]);
  });

  it("requires all 12 columns, all 3 indexes, and quick_check=ok", () => {
    const gate = evaluateSourceQualitySchemaGate({
      columns: d1Json({ found_columns: 12 }),
      indexes: d1Json({ found_indexes: 3 }),
      quickCheck: d1Json({ quick_check: "ok" }),
    });
    expect(gate).toEqual({ columnCount: 12, indexCount: 3, quickCheck: "ok", ok: true });

    expect(
      evaluateSourceQualitySchemaGate({
        columns: d1Json({ found_columns: 11 }),
        indexes: d1Json({ found_indexes: 3 }),
        quickCheck: d1Json({ quick_check: "ok" }),
      }).ok,
    ).toBe(false);
  });
});

describe("rollout script invariants", () => {
  it("captures recovery state before migration and deploys supplied secrets atomically", () => {
    const source = readFileSync(resolve("scripts/run-remote-rollout.mjs"), "utf8");
    expect(source).not.toContain('"secret", "bulk"');
    expect(source).toContain('deployCommand.push("--secrets-file", protectedSecretsFile)');
    expect(source.indexOf("captureRolloutSafetyArtifacts()"))
      .toBeLessThan(source.indexOf("const deployResult = await run(deployCommand"));
    expect(source).toContain('"d1", "time-travel", "info"');
    expect(source).toContain('"d1", "export"');
    expect(source).toContain('"d1-before.sql.sha256"');
  });

  it("runs the post-migration schema gate before Worker deploy", () => {
    const source = readFileSync(resolve("scripts/bootstrap-cloudflare-rollout.mjs"), "utf8");
    expect(source.indexOf("await verifySourceQualityD1Schema()"))
      .toBeLessThan(source.indexOf("if (deploy)"));
    expect(source).toContain("The Worker was not deployed.");
  });

  it("keeps public strictness separate from missing optional verifier tokens", () => {
    const source = readFileSync(resolve("scripts/verify-cloudflare-deploy.mjs"), "utf8");
    expect(source).not.toContain("failOnWarn");
    expect(source).toContain('const failed = report.checks.filter((check) => check.status === "fail")');
    expect(source).toContain('hasFlag("--require-publish")');
    expect(source).toContain('hasFlag("--require-clerk")');
    expect(source).toContain('hasFlag("--require-mcp")');
  });

  it("keeps the generated rehearsal plan on the guarded single-deploy path", () => {
    const source = readFileSync(resolve("scripts/plan-cloudflare-deploy.mjs"), "utf8");
    expect(source).not.toContain("wrangler secret put");
    expect(source).not.toContain("d1 migrations apply");
    expect(source).toContain('commands: ["bun run deploy:remote -- --execute --yes"]');
  });
});

function d1Json(row: Record<string, unknown>): string {
  return JSON.stringify([{ results: [row], success: true }]);
}
