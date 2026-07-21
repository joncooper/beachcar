import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Beachcar Codex friend setup package", () => {
  it("contains the installer, skill, metadata, and plain-language guide without a token", async () => {
    if (process.platform !== "darwin") return;

    const testRoot = await mkdtemp(join(tmpdir(), "beachcar-codex-package-test-"));
    temporaryDirectories.push(testRoot);
    const archivePath = join(testRoot, "Beachcar-Codex-Setup.zip");
    const secondArchivePath = join(testRoot, "Beachcar-Codex-Setup-second.zip");

    await execFileAsync(resolve("scripts/build-codex-setup-package.sh"), [archivePath]);
    await execFileAsync(resolve("scripts/build-codex-setup-package.sh"), [secondArchivePath]);
    const { stdout: listing } = await execFileAsync("/usr/bin/unzip", ["-l", archivePath]);
    const { stdout: guide } = await execFileAsync("/usr/bin/unzip", ["-p", archivePath, "Beachcar-Codex-Setup/README.txt"]);
    const { stdout: packagedText } = await execFileAsync("/usr/bin/unzip", ["-p", archivePath]);
    const archive = await readFile(archivePath);
    const secondArchive = await readFile(secondArchivePath);

    expect(listing).toContain("Beachcar-Codex-Setup/Install Beachcar.command");
    expect(listing).toContain("Beachcar-Codex-Setup/scripts/install-beachcar-codex.sh");
    expect(listing).toContain("Beachcar-Codex-Setup/.agents/skills/beachcar-daily-run/SKILL.md");
    expect(listing).toContain("Beachcar-Codex-Setup/.agents/skills/beachcar-daily-run/agents/openai.yaml");
    expect(listing).toContain("Beachcar-Codex-Setup/VERSION.txt");
    expect(listing).not.toContain("__MACOSX");
    expect(guide).toMatch(/same email you used on the\s+iPhone/);
    expect(guide).toContain("cannot bid, buy, delete the account, start paid research, or write AI usage");
    expect(packagedText).not.toMatch(/bcauto_[A-Za-z0-9_-]{8,}/);
    expect(archive.length).toBeGreaterThan(0);
    expect(secondArchive.equals(archive)).toBe(true);
  });
});
