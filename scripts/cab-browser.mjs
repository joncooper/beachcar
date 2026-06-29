#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const chromeUserAgent =
  process.env.CAB_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export async function launchCarsAndBidsContext(input = {}) {
  const profileDir = resolve(process.env.CAB_PROFILE_DIR || ".cab-profile");
  const browserChannel = process.env.CAB_BROWSER_CHANNEL || "chrome";
  const useSandbox = process.env.CAB_CHROMIUM_SANDBOX !== "0";
  const options = buildLaunchOptions({ ...input, browserChannel, useSandbox });

  await mkdir(profileDir, { recursive: true });

  try {
    return await chromium.launchPersistentContext(profileDir, options);
  } catch (error) {
    if (looksLikeProfileInUseFailure(error)) {
      throw new Error(
        `Cars & Bids browser profile is already in use: ${profileDir}. Close the C&B login Chrome window or press Enter in the cab:login terminal, then rerun the scraper.`,
      );
    }

    if (!useSandbox || process.env.CAB_CHROMIUM_SANDBOX_FALLBACK === "0" || !looksLikeSandboxFailure(error)) {
      throw error;
    }

    console.warn("Chrome sandbox launch failed; retrying with CAB_CHROMIUM_SANDBOX=0. This may reintroduce Chrome's --no-sandbox warning.");
    return chromium.launchPersistentContext(profileDir, buildLaunchOptions({ ...input, browserChannel, useSandbox: false }));
  }
}

function buildLaunchOptions({ browserChannel, headless = true, useSandbox }) {
  return {
    channel: browserChannel,
    headless,
    chromiumSandbox: useSandbox,
    ignoreDefaultArgs: process.env.CAB_KEEP_AUTOMATION_FLAG === "1" ? undefined : ["--enable-automation"],
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent: chromeUserAgent,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-search-engine-choice-screen",
      "--lang=en-US",
      "--window-size=1400,1000",
    ],
  };
}

function looksLikeSandboxFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /sandbox|setuid|namespace|operation not permitted/i.test(message);
}

function looksLikeProfileInUseFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ProcessSingleton|SingletonLock|profile directory.*in use|profile is already in use/i.test(message);
}
