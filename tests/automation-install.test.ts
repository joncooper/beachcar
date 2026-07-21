import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { automationBundleMarkdown } from "../src/worker/automation-bundle";
import { defaultAutomationScopes } from "../src/worker/db";

const temporaryDirectories: string[] = [];
const installerPath = resolve("scripts/install-beachcar-codex.sh");
const skillSource = resolve(".agents/skills/beachcar-daily-run");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Beachcar local Codex setup", () => {
  it("generates a recurring-token bundle with a narrow tool policy", () => {
    const bundle = automationBundleMarkdown("https://beachcar.example/mcp");

    expect(defaultAutomationScopes).toEqual(["setup:read", "setup:write", "sources:read", "runs:publish", "events:read"]);
    expect(bundle).toContain("https://beachcar.example/mcp");
    expect(bundle).toContain("setup:read`, `setup:write`, `sources:read`, `runs:publish`, and `events:read");
    expect(bundle).toContain('bearer_token_env_var = "BEACHCAR_MCP_TOKEN"');
    expect(bundle).toContain('default_tools_approval_mode = "approve"');
    expect(bundle).toContain("[mcp_servers.beachcar.tools.save_taste_calibration]");
    expect(bundle).toContain('approval_mode = "prompt"');
    expect(bundle).toContain("access token expires after one hour");
    expect(bundle).toContain("A scheduled run must never call `save_taste_calibration`");
    expect(bundle).toContain("Mac must be awake, Codex must be running");
  });

  it("keeps the recurring token out of Codex arguments and TOML", async () => {
    if (process.platform !== "darwin") return;

    const testRoot = await mkdtemp(join(tmpdir(), "beachcar-codex-install-"));
    temporaryDirectories.push(testRoot);
    const codexDir = join(testRoot, ".codex");
    const fakeBinDir = join(testRoot, "bin");
    const argumentLog = join(testRoot, "codex-arguments.log");
    const fakeCodex = join(fakeBinDir, "codex");
    await mkdir(fakeBinDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, ".env"), "OTHER_SETTING=keep\nexport BEACHCAR_MCP_TOKEN=stale\n", { mode: 0o644 });
    await writeFile(join(codexDir, "config.toml"), '[unrelated]\nkept = "yes"\n', { mode: 0o644 });
    await writeFile(fakeCodex, fakeCodexSource(), { mode: 0o700 });
    await chmod(fakeCodex, 0o700);

    const firstToken = "bcauto_test-first.secret-first";
    const secondToken = "bcauto_test-second.secret-second";
    const firstOutput = await runInstaller(testRoot, codexDir, fakeBinDir, argumentLog, firstToken);
    const secondOutput = await runInstaller(testRoot, codexDir, fakeBinDir, argumentLog, secondToken);

    const envFile = await readFile(join(codexDir, ".env"), "utf8");
    const config = await readFile(join(codexDir, "config.toml"), "utf8");
    const argumentsSeen = await readFile(argumentLog, "utf8");
    const installedSkill = await readFile(join(codexDir, "skills/beachcar-daily-run/SKILL.md"), "utf8");
    const canonicalSkill = await readFile(join(skillSource, "SKILL.md"), "utf8");

    expect(firstOutput).not.toContain(firstToken);
    expect(secondOutput).not.toContain(secondToken);
    expect(envFile).toContain("OTHER_SETTING=keep");
    expect(envFile).not.toContain(firstToken);
    expect(envFile).toContain(`BEACHCAR_MCP_TOKEN=${secondToken}`);
    expect(envFile.match(/^BEACHCAR_MCP_TOKEN=/gm)).toHaveLength(1);
    expect((await stat(join(codexDir, ".env"))).mode & 0o777).toBe(0o600);

    expect(config).toContain('[unrelated]\nkept = "yes"');
    expect(config).toContain('bearer_token_env_var = "BEACHCAR_MCP_TOKEN"');
    expect(config).toContain('default_tools_approval_mode = "approve"');
    expect(config).toContain("[mcp_servers.beachcar.tools.save_taste_calibration]");
    expect(config).toContain('approval_mode = "prompt"');
    expect(config).not.toContain(firstToken);
    expect(config).not.toContain(secondToken);
    expect(config.match(/^\[mcp_servers\.beachcar\]$/gm)).toHaveLength(1);
    expect((await stat(join(codexDir, "config.toml"))).mode & 0o777).toBe(0o600);

    expect(argumentsSeen).toContain("--bearer-token-env-var");
    expect(argumentsSeen).toContain("BEACHCAR_MCP_TOKEN");
    expect(argumentsSeen).not.toContain(firstToken);
    expect(argumentsSeen).not.toContain(secondToken);
    expect(installedSkill).toBe(canonicalSkill);
  });

  it("contains no option that could put the bearer value in argv", async () => {
    const installer = await readFile(installerPath, "utf8");

    expect(installer).toContain("stty -echo");
    expect(installer).toContain("/dev/tty");
    expect(installer).toContain("umask 077");
    expect(installer).toContain("chmod 600");
    expect(installer).toContain("--bearer-token-env-var BEACHCAR_MCP_TOKEN");
    expect(installer).not.toMatch(/--bearer-token(?!-env-var)/);
    expect(installer).not.toMatch(/codex mcp add[^\n]*beachcar_token/);
  });
});

async function runInstaller(
  testRoot: string,
  codexDir: string,
  fakeBinDir: string,
  argumentLog: string,
  token: string,
): Promise<string> {
  const endpoint = "https://beachcar.example/mcp";
  const expectPath = join(testRoot, "drive-installer.exp");
  await writeFile(
    expectPath,
    `set timeout 10
spawn /bin/sh {${installerPath}}
expect "Beachcar token: "
send -- "${token}\\r"
expect eof
set status [wait]
exit [lindex $status 3]
`,
    { mode: 0o600 },
  );
  const child = spawn("/usr/bin/expect", [expectPath], {
    cwd: testRoot,
    env: {
      ...process.env,
      BEACHCAR_CODEX_DIR: codexDir,
      BEACHCAR_SKILL_SOURCE: skillSource,
      BEACHCAR_MCP_ENDPOINT: endpoint,
      BEACHCAR_CODEX_TEST_LOG: argumentLog,
      PATH: `${fakeBinDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const collectOutput = (chunk: Buffer) => {
    output += chunk.toString("utf8");
  };
  child.stdout.on("data", collectOutput);
  child.stderr.on("data", collectOutput);

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Installer timed out. Output:\n${output}`));
    }, 10_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });

  expect(output).toContain("Beachcar token:");
  expect(exitCode, output).toBe(0);
  return output;
}

function fakeCodexSource(): string {
  return `#!/bin/sh
set -eu
printf '%s\\n' "$@" >> "$BEACHCAR_CODEX_TEST_LOG"
if [ "\${1:-}" = "mcp" ] && [ "\${2:-}" = "remove" ]; then
  config="$BEACHCAR_CODEX_DIR/config.toml"
  filtered="$config.filtered"
  awk '
    BEGIN { skip = 0 }
    /^\\[mcp_servers\\.beachcar(\\]|\\.)/ { skip = 1; next }
    skip && /^\\[/ { skip = 0 }
    !skip { print }
  ' "$config" > "$filtered"
  mv "$filtered" "$config"
elif [ "\${1:-}" = "mcp" ] && [ "\${2:-}" = "add" ]; then
  printf '%s\\n' '' '[mcp_servers.beachcar]' 'url = "https://beachcar.example/mcp"' 'bearer_token_env_var = "BEACHCAR_MCP_TOKEN"' >> "$BEACHCAR_CODEX_DIR/config.toml"
elif [ "\${1:-}" = "mcp" ] && [ "\${2:-}" = "get" ]; then
  printf '%s\\n' '{}'
fi
`;
}
