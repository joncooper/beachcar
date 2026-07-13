import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_CONNECTED_SUBSCRIPTIONS_MIGRATION,
  SOURCE_QUALITY_V1_MIGRATION,
  PRODUCT_EVENTS_V1_MIGRATION,
  collectWorkerSecrets,
  collectRolloutWorkerSecrets,
  evaluateCloudflareAccountGate,
  evaluateD1IdentityGate,
  evaluateDurableObjectRollbackGate,
  evaluateSourceQualitySchemaGate,
  guardedWorkerDeployArgs,
  isSafeSourceQualityMigrationSet,
  missingRequiredWorkerSecrets,
  missingVerificationGateStatus,
  pendingD1MigrationFiles,
  verificationRequirementArgs,
  workerMigrationTagFromServiceMetadata,
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
  console.log(JSON.stringify([{ name: "PUBLISH_TOKEN" }, { name: "CLERK_SECRET_KEY" }, { name: "CLERK_JWT_ISSUER" }, { name: "CLERK_WEBHOOK_SIGNING_SECRET" }]));
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
  }, 15_000);
});

describe("Cloudflare rollout D1 identity gate", () => {
  it("requires the configured name and id to resolve to the same database", () => {
    const configuredId = "2860a6be-7cf0-4fc0-821f-166e78521154";
    expect(
      evaluateD1IdentityGate({
        configuredName: "beach-car-watch",
        configuredId,
        databases: [{ name: "beach-car-watch", uuid: configuredId }],
      }),
    ).toMatchObject({ exactMatch: true, remoteNameMatchId: configuredId, remoteIdMatchName: "beach-car-watch" });

    expect(
      evaluateD1IdentityGate({
        configuredName: "beach-car-watch",
        configuredId,
        databases: [
          { name: "beach-car-watch", uuid: "11111111-1111-1111-1111-111111111111" },
          { name: "other-database", uuid: configuredId },
        ],
      }),
    ).toMatchObject({ exactMatch: false, remoteNameMatchId: "11111111-1111-1111-1111-111111111111", remoteIdMatchName: "other-database" });
  });

  it("makes strict resource inspection fail when name and id identify different databases", () => {
    const directory = mkdtempSync(join(tmpdir(), "beachcar-wrangler-d1-mock-"));
    const executable = join(directory, "bunx");
    writeFileSync(
      executable,
      `#!/usr/bin/env node
const command = process.argv.slice(3).join(" ");
if (command === "whoami --json") {
  console.log(JSON.stringify({ loggedIn: true, accounts: [{ id: "${productionAccount}" }] }));
} else if (command === "d1 list --json") {
  console.log(JSON.stringify([
    { name: "beach-car-watch", uuid: "11111111-1111-1111-1111-111111111111" },
    { name: "other-database", uuid: "2860a6be-7cf0-4fc0-821f-166e78521154" }
  ]));
} else if (command === "r2 bucket list") {
  console.log("name: beachcar-watch-images");
} else if (command.startsWith("secret list")) {
  console.log(JSON.stringify([{ name: "PUBLISH_TOKEN" }, { name: "CLERK_SECRET_KEY" }, { name: "CLERK_JWT_ISSUER" }, { name: "CLERK_WEBHOOK_SIGNING_SECRET" }]));
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
          CLOUDFLARE_ACCOUNT_ID: productionAccount,
        },
      });
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          label: "Configured D1 name and database_id identify the same remote database",
          status: "todo",
        }),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

describe("Cloudflare rollout secret and verifier handling", () => {
  it("collects only real Worker values and never treats the Wrangler API token as a Worker secret", () => {
    const secrets = collectWorkerSecrets({
      PUBLISH_TOKEN: "publish-token-with-at-least-24-characters",
      CLERK_SECRET_KEY: "sk_test_local-fixture",
      CLERK_JWT_ISSUER: "https://fixture.clerk.accounts.dev",
      CLERK_WEBHOOK_SIGNING_SECRET: "whsec_local-fixture",
      BEACHCAR_AI_GATEWAY_TOKEN: "<your-gateway-token>",
      CLOUDFLARE_API_TOKEN: "wrangler-auth-fixture",
    });

    expect(Object.keys(secrets).sort()).toEqual([
      "CLERK_JWT_ISSUER",
      "CLERK_SECRET_KEY",
      "CLERK_WEBHOOK_SIGNING_SECRET",
      "PUBLISH_TOKEN",
    ]);
    expect(secrets).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
    expect(secrets).not.toHaveProperty("BEACHCAR_AI_GATEWAY_TOKEN");
  });

  it("allows required secrets to be satisfied by the union of remote names and local deploy input", () => {
    expect(
      missingRequiredWorkerSecrets(["CLERK_SECRET_KEY", "CLERK_JWT_ISSUER", "CLERK_WEBHOOK_SIGNING_SECRET"], ["PUBLISH_TOKEN"]),
    ).toEqual([]);
    expect(missingRequiredWorkerSecrets(["CLERK_SECRET_KEY"], ["PUBLISH_TOKEN"])).toEqual([
      "CLERK_JWT_ISSUER",
      "CLERK_WEBHOOK_SIGNING_SECRET",
    ]);
  });

  it("never admits an ambient OpenAI key and requires deliberate codex container input", () => {
    const ambient = {
      PUBLISH_TOKEN: "publish-token-with-at-least-24-characters",
      OPENAI_API_KEY: "personal-ambient-key",
      BEACHCAR_RUNNER_MODE: "codex",
    };
    expect(
      collectRolloutWorkerSecrets({
        deployFileEnv: { BEACHCAR_RUNNER_MODE: "deterministic" },
        ambientEnv: ambient,
        runnerMode: "deterministic",
        deployContainers: false,
      }),
    ).toMatchObject({
      PUBLISH_TOKEN: "publish-token-with-at-least-24-characters",
      BEACHCAR_RUNNER_MODE: "deterministic",
    });
    expect(
      collectRolloutWorkerSecrets({
        deployFileEnv: { BEACHCAR_RUNNER_MODE: "codex", OPENAI_API_KEY: "deliberate-deploy-file-key" },
        ambientEnv: ambient,
        runnerMode: "codex",
        deployContainers: true,
      }).OPENAI_API_KEY,
    ).toBe("deliberate-deploy-file-key");
    expect(
      collectRolloutWorkerSecrets({
        deployFileEnv: { BEACHCAR_RUNNER_MODE: "codex" },
        ambientEnv: ambient,
        runnerMode: "codex",
        deployContainers: true,
      }),
    ).not.toHaveProperty("OPENAI_API_KEY");
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

  it("uses strict deploys while preserving audited dashboard-only vars and existing secrets", () => {
    expect(
      guardedWorkerDeployArgs({
        dryRun: true,
        secretsFile: "/private/tmp/worker-secrets.json",
        skipContainerRollout: true,
      }),
    ).toEqual([
      "deploy",
      "--strict",
      "--keep-vars",
      "--dry-run",
      "--secrets-file",
      "/private/tmp/worker-secrets.json",
      "--containers-rollout",
      "none",
    ]);
    expect(guardedWorkerDeployArgs()).toEqual(["deploy", "--strict", "--keep-vars"]);
  });
});

describe("Cloudflare rollout D1 gates", () => {
  it("accepts only no pending migrations or the reviewed 0011/0012/0013 migrations", () => {
    expect(isSafeSourceQualityMigrationSet("✅ No migrations to apply!\n")).toBe(true);
    expect(isSafeSourceQualityMigrationSet(`Migrations to be applied:\n${SOURCE_QUALITY_V1_MIGRATION}\n`)).toBe(true);
    expect(isSafeSourceQualityMigrationSet(`Migrations to be applied:\n${PRODUCT_EVENTS_V1_MIGRATION}\n`)).toBe(true);
    expect(isSafeSourceQualityMigrationSet(`Migrations to be applied:\n${AGENT_CONNECTED_SUBSCRIPTIONS_MIGRATION}\n`)).toBe(true);
    expect(
      isSafeSourceQualityMigrationSet(
        `${SOURCE_QUALITY_V1_MIGRATION}\n${PRODUCT_EVENTS_V1_MIGRATION}\n${AGENT_CONNECTED_SUBSCRIPTIONS_MIGRATION}\n`,
      ),
    ).toBe(true);
    expect(isSafeSourceQualityMigrationSet(`0005_multi_user_beta.sql\n${SOURCE_QUALITY_V1_MIGRATION}\n`)).toBe(false);
    expect(isSafeSourceQualityMigrationSet("unexpected output")).toBe(false);
    expect(pendingD1MigrationFiles(`| ${SOURCE_QUALITY_V1_MIGRATION} |`)).toEqual([SOURCE_QUALITY_V1_MIGRATION]);
  });

  it("requires every reviewed migration schema and quick_check=ok", () => {
    const gate = evaluateSourceQualitySchemaGate({
      columns: d1Json({ found_columns: 12 }),
      indexes: d1Json({ found_indexes: 3 }),
      productColumns: d1Json({ found_product_columns: 9 }),
      productIndexes: d1Json({ found_product_indexes: 3 }),
      researchColumns: d1Json({ found_research_columns: 4 }),
      billingColumns: d1Json({ found_billing_columns: 7 }),
      billingIndexes: d1Json({ found_billing_indexes: 1 }),
      quickCheck: d1Json({ quick_check: "ok" }),
    });
    expect(gate).toEqual({
      columnCount: 12,
      indexCount: 3,
      productColumnCount: 9,
      productIndexCount: 3,
      researchColumnCount: 4,
      billingColumnCount: 7,
      billingIndexCount: 1,
      quickCheck: "ok",
      ok: true,
    });

    expect(
      evaluateSourceQualitySchemaGate({
        columns: d1Json({ found_columns: 11 }),
        indexes: d1Json({ found_indexes: 3 }),
        productColumns: d1Json({ found_product_columns: 9 }),
        productIndexes: d1Json({ found_product_indexes: 3 }),
        researchColumns: d1Json({ found_research_columns: 4 }),
        billingColumns: d1Json({ found_billing_columns: 7 }),
        billingIndexes: d1Json({ found_billing_indexes: 1 }),
        quickCheck: d1Json({ quick_check: "ok" }),
      }).ok,
    ).toBe(false);
  });
});

describe("Cloudflare Worker rollback gate", () => {
  it("requires one active version at full traffic and the already-applied final DO migration tag", () => {
    const ready = evaluateDurableObjectRollbackGate({
      deploymentStatus: { versions: [{ version_id: "version-before", percentage: 100 }] },
      expectedMigrationTag: "v2",
      remoteMigrationTag: "v2",
    });
    expect(ready).toMatchObject({
      ok: true,
      activeVersionId: "version-before",
      activePercentage: 100,
      expectedMigrationTag: "v2",
      remoteMigrationTag: "v2",
    });

    expect(
      evaluateDurableObjectRollbackGate({
        deploymentStatus: { versions: [{ version_id: "version-before", percentage: 100 }] },
        expectedMigrationTag: "v2",
        remoteMigrationTag: "v1",
      }),
    ).toMatchObject({ ok: false, remoteMigrationTag: "v1" });

    expect(
      evaluateDurableObjectRollbackGate({
        deploymentStatus: {
          versions: [
            { version_id: "old", percentage: 50 },
            { version_id: "new", percentage: 50 },
          ],
        },
        expectedMigrationTag: "v2",
        remoteMigrationTag: "v2",
      }),
    ).toMatchObject({ ok: false, activeVersionCount: 2 });
  });

  it("reads only the migration tag needed from Worker service metadata", () => {
    expect(
      workerMigrationTagFromServiceMetadata({
        default_environment: { script: { migration_tag: "v2", vars: { SHOULD_NOT_BE_PERSISTED: "value" } } },
      }),
    ).toBe("v2");
  });
});

describe("rollout script invariants", () => {
  it("applies the credential-safe referrer policy to Worker static assets", () => {
    const headers = readFileSync(resolve("public/_headers"), "utf8");
    expect(headers).toContain("/*");
    expect(headers).toContain("Referrer-Policy: no-referrer");
  });

  it("captures recovery state before migration and deploys supplied secrets atomically", () => {
    const source = readFileSync(resolve("scripts/run-remote-rollout.mjs"), "utf8");
    expect(source).not.toContain('"secret", "bulk"');
    expect(source).toContain("secretsFile: protectedSecretsFile");
    expect(source).toContain('mkdtemp(join(tmpdir(), "beachcar-worker-secrets-")');
    expect(source).toContain("never part of the recovery bundle");
    expect(source).not.toContain("writeProtectedSecretsFile(artifactDirectory");
    expect(source).toContain("rm(directory, { recursive: true, force: true })");
    expect(source.indexOf("captureRolloutSafetyArtifacts(resourceReport)"))
      .toBeLessThan(source.indexOf("Strictly validate the exact Worker"));
    expect(source.indexOf("Strictly validate the exact Worker"))
      .toBeLessThan(source.indexOf('["bunx", "wrangler", "d1", "migrations", "apply"'));
    expect(source.indexOf('["bunx", "wrangler", "d1", "migrations", "apply"'))
      .toBeLessThan(source.indexOf("await verifyRemoteSourceQualitySchema()"));
    expect(source.indexOf("await verifyRemoteSourceQualitySchema()"))
      .toBeLessThan(source.indexOf("const deployResult = await run"));
    expect(source).toContain('"d1", "time-travel", "info"');
    expect(source).toContain('"d1", "export"');
    expect(source).toContain('"d1-before.sql.sha256"');
    expect(source).toContain('"rollback-gate.json"');
    expect(source).toContain("minimalWorkerServiceRollbackEvidence");
    expect(source).toContain("requires a real local PUBLISH_TOKEN");
    expect(source).toContain('childEnv.WRANGLER_WRITE_LOGS = "false"');
    expect(source).toContain('{ headers, redirect: "error" }');
    expect(source).toContain('new URL(response.url).origin !== "https://api.cloudflare.com"');
    expect(source).not.toContain("JSON.stringify(workerServiceMetadata");
    expect(source).not.toContain('"versions", "view"');
  });

  it("runs the post-migration schema gate before Worker deploy", () => {
    const source = readFileSync(resolve("scripts/run-remote-rollout.mjs"), "utf8");
    expect(source.indexOf("await verifyRemoteSourceQualitySchema()"))
      .toBeLessThan(source.indexOf("const deployResult = await run"));
    expect(source).toContain("The Worker was not deployed.");
  });

  it("refuses direct bootstrap and direct remote-migration bypasses before Wrangler can mutate", () => {
    const bootstrap = spawnSync("bun", ["scripts/bootstrap-cloudflare-rollout.mjs", "--yes", "--migrate", "--dry-run-deploy"], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    expect(bootstrap.status).toBe(1);
    expect(bootstrap.stderr).toContain("Direct remote Cloudflare mutations are disabled");

    const migration = spawnSync("bun", ["scripts/apply-d1-migrations.mjs", "--remote"], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    expect(migration.status).toBe(1);
    expect(migration.stderr).toContain("Direct remote D1 migration is disabled");

    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    expect(packageJson.scripts).not.toHaveProperty("db:migrate:remote");
    expect(packageJson.scripts).not.toHaveProperty("deploy");
  });

  it("keeps public strictness separate from missing optional verifier tokens", () => {
    const source = readFileSync(resolve("scripts/verify-cloudflare-deploy.mjs"), "utf8");
    expect(source).not.toContain("failOnWarn");
    expect(source).toContain('const failed = report.checks.filter((check) => check.status === "fail")');
    expect(source).toContain('hasFlag("--require-publish")');
    expect(source).toContain('hasFlag("--require-publish") || Boolean(expectedRunnerMode)');
    expect(source).toContain('hasFlag("--require-clerk")');
    expect(source).toContain('hasFlag("--require-mcp")');
    expect(source).toContain('redirect: "error"');
    expect(source).toContain("new URL(response.url).origin");
    expect(source.indexOf("const publicOriginFailed"))
      .toBeLessThan(source.indexOf("await checkAdminSurface()"));
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
