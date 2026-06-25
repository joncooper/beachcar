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

## Workflow

1. Call \`get_setup_context\` to load profile, source settings, feedback steering, latest run, and AI budget state.
2. Call \`plan_daily_research\` to get the run constraints and source checklist.
3. Gather candidates with MCP source tools first. Use \`search_bat_cache\` for Bring a Trailer public RSS candidates.
4. Use browser-capable cloud-agent tools only when a source requires rendered pages or user/session access.
5. Normalize candidates into the Beachcar listing shape. Call \`submit_candidates\` before publishing if the data came from scraping or manual extraction.
6. Record model/tool usage with \`record_usage\` after every meaningful AI call. Include provider, model, token counts, status, and estimated cost when available.
7. Publish the final shortlist with \`publish_run\`. Include reportMarkdown, sourceSummary, and useful source image URLs.
8. Call \`verify_latest_run\` and confirm the published run id, listing count, and first listings.
9. Call \`list_automation_events\` when the user asks what happened or when debugging a failed run.

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
`;
}
