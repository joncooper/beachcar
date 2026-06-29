#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { launchCarsAndBidsContext } from "./cab-browser.mjs";

const profileDir = resolve(process.env.CAB_PROFILE_DIR || ".cab-profile");
const startUrl = process.env.CAB_START_URL || "https://carsandbids.com/auctions/";

await mkdir(profileDir, { recursive: true });

const context = await launchCarsAndBidsContext({ headless: false });

const page = context.pages()[0] || (await context.newPage());
await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });

console.log(`Opened Cars & Bids with persistent profile: ${profileDir}`);
console.log("Complete Cloudflare verification and sign in to your Cars & Bids account in the browser window.");
console.log("When the auctions page is usable, return here and press Enter. The browser profile will be reused by daily scraping.");

const rl = createInterface({ input, output });
await rl.question("");
rl.close();

await context.storageState({ path: resolve(profileDir, "storage-state.json") }).catch(() => {});
await context.close();
console.log("Saved Cars & Bids browser session.");
