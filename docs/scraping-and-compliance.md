# Scraping And Compliance

Beachcar is designed for user-operated research automation. The repo provides prompts, contracts, and publishing tools; each operator is responsible for how they access third-party sites.

Practical guardrails:

- Use your own accounts and browser sessions when a source requires login.
- Do not bypass paywalls, CAPTCHAs, anti-bot controls, or access restrictions.
- Keep request volume modest; a daily watchlist should not need aggressive crawling.
- Prefer official APIs, feeds, saved searches, email alerts, or exported data when available.
- Copy images only for your intended private/internal review unless you have rights to republish them.
- If a site blocks scraping, keep the source in the report as `check listing` rather than trying to evade the block.

The daily agent should adapt to page changes by inspecting the live page, not by assuming a fixed DOM structure.

## Cars & Bids Browser Notes

Cars & Bids currently needs a trusted browser session for Beachcar automation. The first-class scraper uses the operator's local Chrome profile through:

```bash
bun run cab:login
bun run cab:scrape:targeted
```

Do not treat a lighter browser as an access-control bypass. A 2026-06-29 Lightpanda spike showed:

- `lightpanda fetch https://carsandbids.com/search?q=jeep%20wrangler` was served a Cloudflare Turnstile challenge and returned a 403 challenge frame.
- A captured signed `/v2/autos/auctions` JSON URL also returned 403 without the browser session.
- Lightpanda supports a CDP server plus cookie/storage options, but it does not replace the current Chrome profile login flow for this source.

Conclusion: keep Cars & Bids on the trusted-session browser runner for now. Revisit Lightpanda only for sources that do not require interactive verification, or if we add an explicit, user-approved cookie handoff that does not evade site restrictions.
