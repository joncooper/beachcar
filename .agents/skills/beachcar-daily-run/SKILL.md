---
name: beachcar-daily-run
description: Run a user's local Beachcar auction research automation with their signed-in browser and the hosted Beachcar MCP. Use when Codex needs to calibrate Beachcar taste, research listings from a user-authorized local browser session, publish a shortlist, verify it, or prepare a recurring local Codex task. Do not use for Beachcar-managed cloud research.
---

# Beachcar Daily Run

Use the hosted Beachcar remote MCP server as the system of record. Codex runs locally; Beachcar stores taste, feedback, runs, images, and the review experience.

The user owns their browser login and Codex subscription. Do not enable Beachcar Managed Research, deploy a cloud scraper, or create a Beachcar AI Gateway usage event for this path.

## MCP Setup

- For any recurring task, use a revocable `bcauto_...` automation token with exactly these scopes: `setup:read`, `setup:write`, `sources:read`, `runs:publish`, and `events:read`. Do not grant `usage:write`; local Codex work is not Beachcar-managed AI usage.
- Run `scripts/install-beachcar-codex.sh` from the Beachcar package. It reads the token without echo from `/dev/tty`, stores it as `BEACHCAR_MCP_TOKEN` in `~/.codex/.env` with mode `0600`, installs this skill, and configures the hosted MCP without putting the secret in an argument or TOML file.
- The resulting server configuration is intentionally limited to Beachcar's setup, source, publish, verification, and event tools:

  ```toml
  [mcp_servers.beachcar]
  url = "<Beachcar MCP endpoint>"
  bearer_token_env_var = "BEACHCAR_MCP_TOKEN"
  enabled_tools = ["get_setup_context", "plan_daily_research", "save_taste_calibration", "search_bat_cache", "submit_candidates", "publish_run", "verify_latest_run", "list_automation_events"]
  default_tools_approval_mode = "approve"

  [mcp_servers.beachcar.tools.save_taste_calibration]
  approval_mode = "prompt"
  ```

- Restart Codex after installation so the app loads the new environment file, skill, and MCP server. Never put the token in this skill, source control, a prompt, shell history, or `config.toml`.
- OAuth authorization-code + PKCE is available only for a supervised interactive preview. Its access token expires after one hour and Beachcar does not yet issue refresh tokens, so do not use `codex mcp login beachcar` for a recurring task.
- If hosted MCP tools are unavailable in the current environment, stop and tell the user the agent needs MCP tool access. Do not replace MCP publishing with a local server or an untracked API call.

## Recurring Automation

1. Complete one supervised run first: calibrate taste, research with the user's signed-in browser, publish, and verify.
2. Create a recurring Codex automation only after that run succeeds. Use this skill's workflow as the task prompt. A scheduled run must never call `save_taste_calibration`; if setup is incomplete, stop and request a supervised run.
3. At the scheduled time, the user's Mac must be awake, Codex must be running, and the needed marketplace sessions must still be signed in. A sleeping Mac or closed Codex app cannot perform browser research.
4. If a session, MFA prompt, CAPTCHA, or consent screen appears, pause that source and ask the user to complete it during an interactive run. Do not silently replace the blocked source.

## First-Run Taste Interview

1. Call `get_setup_context`. If the user has not completed Beachcar setup, direct them to finish the app onboarding with **Connect your own agent**, their region, and their budget before continuing.
2. Ask a short conversational interview: what they want more of, what they want to avoid, intended use/passengers, absolute all-in ceiling, and two memorable examples (one yes, one no).
3. Map the answer to the supported `showMore` ids: `open-air`, `simple`, `kid-plausible`, `small-4x4`, `no-reserve`, `quirky-clean`; and `avoid` ids: `rust`, `salvage`, `heavy-project`, `overbuilt`, `fragile`, `price-chasing`.
4. Present the resulting calibration and freeform notes for confirmation. Only after confirmation, call `save_taste_calibration`.
5. Call `get_setup_context` again and use the saved calibration, freeform notes, source settings, and feedback as the research brief.

Do not infer a sensitive preference, location, budget, or risk tolerance. Ask when it is unclear.

## Workflow

1. Call `get_setup_context` to load profile, source settings, feedback steering, latest run, and AI budget state.
2. Call `plan_daily_research` to get run constraints and source checklist.
3. Gather candidates with MCP source tools first. Use `search_bat_cache` for Bring a Trailer public RSS candidates.
4. Use Codex's local browser only for rendered pages or sources where the user has already logged in.
   - Let the user complete all sign-in, password, MFA, CAPTCHA, and permission prompts themselves.
   - Never bypass bot protections, paywalls, rate limits, or a site's access controls. If a source blocks the session, record the block and move on.
5. Normalize candidates into the Beachcar listing shape. Call `submit_candidates` before publishing if data came from scraping or manual extraction.
   - For every shortlisted listing where the detail page is reachable, collect enough rich detail to populate `dossier.summary`, `dossier.bidLog`, and `dossier.comments`. These fields power the first-screen read and the native dossier. Omit only fields that are absent, blocked, or unverifiable.
6. Keep the local Codex/browser work out of Beachcar's managed AI accounting. State `execution: "local-codex-browser"` and any blocked sources in `sourceSummary`. The recurring token intentionally cannot call `record_usage`.
7. Publish the final shortlist with `publish_run`. Include `reportMarkdown`, `sourceSummary`, and useful source image URLs.
8. Call `verify_latest_run` and confirm the published run id, listing count, and first listings.
9. Call `list_automation_events` when the user asks what happened or when debugging a failed run.

## Source Strategy

- Use `search_bat_cache` before browsing Bring a Trailer directly; it reads Beachcar's D1-backed public RSS cache and refreshes stale/empty cache rows.
- For Cars & Bids, use the user's logged-in local Codex browser session when available. The user must establish that session themselves. For other rendered marketplace pages, use the local browser only when the user and environment allow it.
- Do not use Lightpanda as a drop-in Cars & Bids replacement. A 2026-06-29 spike hit Cloudflare Turnstile/403 on C&B search pages and 403 on a captured signed C&B JSON endpoint without the trusted browser session. Reconsider it only for sources that do not require interactive verification.
- If a source blocks access, record that in `sourceSummary.blockedSources` or `sourceSummary.notes`; do not invent candidate data.
- Prefer fewer, better-validated listings over broad scraped lists. Confirm title, URL, location, price/bid, time left, and image URLs before publishing.

## Listing Shape

Each published listing should include:

```json
{
  "section": "Strong fits",
  "lane": "family",
  "site": "Bring a Trailer",
  "title": "1974 Volkswagen Thing",
  "url": "https://example.com/listing",
  "bid": "$12,500",
  "total": "$13,125 incl. buyer fee estimate",
  "location": "Northeast",
  "timeLeft": "2 days",
  "why": "Matched saved beach-car preferences...",
  "concerns": "Verify title, rust, underside, and final buyer-fee total.",
  "images": ["https://example.com/photo.jpg"]
}
```

Valid lanes are `family`, `solo`, and `curiosity`.

### Optional `dossier` (rich detail)

When you read the listing's detail page, attach an optional `dossier` object to power the app's full detail view. Every field is optional — include what you can verify, omit the rest. Prioritize a concise `summary`, recent `bidLog`, and representative `comments` for every final pick because the app has dedicated UI for those fields. The shape:

```json
"dossier": {
  "summary": "One-paragraph vehicle summary.",
  "specs": { "odometer": "62,400 mi", "engine": "1.6L flat-4", "transmission": "4-speed manual", "drivetrain": "RWD", "exterior": "Texas Yellow", "interior": "Black vinyl", "title": "Clean · SC", "seller": "username", "lot": "Example #88,412" },
  "listing": ["Paragraph 1 of the seller writeup.", "Paragraph 2."],
  "equipment": ["New soft top", "Removable doors"],
  "service": ["2024 — new soft top", "2023 — brakes renewed"],
  "bidLog": [{ "bidder": "username", "amount": "$8,500", "ago": "2h" }],
  "comments": [{ "user": "username", "body": "Floors look honest.", "ago": "3h", "seller": false }],
  "beachUse": { "body": "Open 2WD", "location": "Charleston, SC", "people": "Confirm belts", "paperwork": "Clean title" },
  "valueScore": 0.18
}
```

`valueScore` is a 0..1 position on the CHEAP..RICH meter (0 = cheap for what it is, 1 = priced rich). Do not invent dossier facts — only include detail actually present on the listing page. See a full worked example in `examples/daily-run.sample.json`.

## Guardrails

- Do not ask for raw API keys or browser credentials. The user logs into sites directly and keeps their credentials in the browser/password manager.
- Do not start a Beachcar Managed Research run. This skill publishes only the local Codex research the user requested.
- Do not publish invented listings. If a source blocks access, publish a transparent manual-check item only when the user asked for a fallback.
- Respect source terms, rate limits, and access controls. Do not bypass bot challenges or paywalls.
- Keep user data scoped to the active automation token. Do not reuse one friend's token for another friend.
- Prefer cached/variant-friendly image URLs from listing pages; Beachcar will mirror and serve thumb/deck/full variants after publish.

## Done Definition

- `publish_run` returned `ok: true`.
- `verify_latest_run` shows the same run id and the expected listing count.
- `sourceSummary` identifies the local Codex browser execution and any blocked source or incomplete detail page.
- Any blocked sources, missing fields, or manual-check caveats are visible in `sourceSummary`.
