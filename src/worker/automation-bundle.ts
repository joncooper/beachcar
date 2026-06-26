export function automationBundleMarkdown(mcpEndpoint: string): string {
  return `---
name: beachcar-daily-run
description: Drive a Beachcar friend's daily auction research automation through the hosted remote MCP endpoint. Use when a user asks Codex, Claude, or another cloud agent to gather auction candidates, validate them against Beachcar preferences, publish a run, verify the app, or record AI usage for Beachcar. This skill assumes no local MCP server and no coding/shell access.
---

# Beachcar Daily Run

Use the hosted Beachcar remote MCP server, not a local MCP process.

Remote MCP endpoint:

\`\`\`
${mcpEndpoint}
\`\`\`

Authenticate with the Beachcar automation token as a Bearer token. The token is shown once in Beachcar Preferences > Connect Automation.

## MCP Setup

- Connect to the hosted \`/mcp\` endpoint supplied by Beachcar or by the downloaded skill bundle.
- Send the Beachcar automation token as \`Authorization: Bearer <token>\`.
- If the client supports OAuth protected-resource discovery, use the \`WWW-Authenticate\` metadata challenge from \`/mcp\`; the current preview still authenticates with the scoped token.
- If hosted MCP tools are unavailable in the current environment, stop and tell the user the agent needs MCP tool access. Do not replace MCP publishing with a local server or an untracked API call.

## Workflow

1. Call \`get_setup_context\` to load profile, source settings, feedback steering, latest run, and AI budget state.
2. Call \`plan_daily_research\` to get the run constraints and source checklist.
3. Gather candidates with MCP source tools first. Use \`search_bat_cache\` for Bring a Trailer public RSS candidates.
4. Use browser-capable cloud-agent tools only when a source requires rendered pages or user/session access.
5. Normalize candidates into the Beachcar listing shape. Call \`submit_candidates\` before publishing if the data came from scraping or manual extraction.
6. Record model/tool usage with \`record_usage\` after every meaningful AI or browser-harness call. Include provider, model/tool name, token counts, status, and estimated cost when available. Use \`status: "cached"\` and zero cost for deterministic MCP cache reads.
7. Publish the final shortlist with \`publish_run\`. Include reportMarkdown, sourceSummary, and useful source image URLs.
8. Call \`verify_latest_run\` and confirm the published run id, listing count, and first listings.
9. Call \`list_automation_events\` when the user asks what happened or when debugging a failed run.

## Source Strategy

- Use \`search_bat_cache\` before browsing Bring a Trailer directly; it reads Beachcar's D1-backed public RSS cache and refreshes stale/empty cache rows.
- For Cars & Bids or rendered marketplace pages, use a browser-capable cloud-agent tool only if the user and environment allow it.
- If a source blocks access, record that in \`sourceSummary.blockedSources\` or \`sourceSummary.notes\`; do not invent candidate data.
- Prefer fewer, better-validated listings over broad scraped lists. Confirm title, URL, location, price/bid, time left, and image URLs before publishing.

## Listing Shape

Each published listing should include:

\`\`\`json
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
\`\`\`

Valid lanes are \`family\`, \`solo\`, and \`curiosity\`.

## Guardrails

- Do not ask the friend for raw OpenAI keys inside the agent conversation. Beachcar tracks AI mode and budget separately.
- Do not publish invented listings. If a source blocks access, publish a transparent manual-check item only when the user asked for a fallback.
- Respect source terms, rate limits, and access controls. Do not bypass bot challenges or paywalls.
- Keep user data scoped to the active automation token. Do not reuse one friend's token for another friend.
- Prefer cached/variant-friendly image URLs from listing pages; Beachcar will mirror and serve thumb/deck/full variants after publish.

## Done Definition

- \`publish_run\` returned \`ok: true\`.
- \`verify_latest_run\` shows the same run id and the expected listing count.
- \`record_usage\` was called for any AI/browser work that incurred or could incur cost.
- Any blocked sources, missing fields, or manual-check caveats are visible in \`sourceSummary\`.
`;
}
