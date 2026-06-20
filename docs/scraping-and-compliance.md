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

