import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Clerk browser loader", () => {
  it("uses Clerk's hosted major-version channel instead of the React wrapper version", async () => {
    const source = await readFile(resolve("src/client/clerk-browser.ts"), "utf8");

    expect(source).toContain('const clerkBrowserMajorVersion = "6";');
    expect(source).toContain("@clerk/clerk-js@${clerkBrowserMajorVersion}/dist/clerk.browser.js");
    expect(source).toContain("signIn.authenticateWithRedirect({");
    expect(source).not.toContain("clerk.authenticateWithRedirect({");
    expect(source).not.toContain('const clerkBrowserVersion = "6.10.4";');
  });

  it("does not mount optional Clerk UI from the core-only browser bundle", async () => {
    const appSource = await readFile(resolve("src/client/App.tsx"), "utf8");

    expect(appSource).not.toContain("mountUserButton");
    expect(appSource).toContain('className="mini-signout"');
  });
});
