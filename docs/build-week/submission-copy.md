# Devpost submission copy

## Title

Beachcar

## Tagline

Your Codex. Your taste. The one.

## Category

Apps for Your Life

## Short description

Beachcar turns your local Codex and the auction sites you already sign into into a private auction scout. GPT-5.6 researches, reasons, and publishes a tiny evidence-backed shortlist to iPhone. Every Love, Pass, and Never again becomes durable taste memory for the next run. After two weeks, it found the pink 1960 Willys Surrey I bought.

## Inspiration

Auction alerts can match year, make, and price. They cannot understand “open-air, mechanically simple, charming rather than precious, and plausible for family beach days.” They also cannot reconcile messy listings, explain risk, or know when one strange car deserves attention.

I wanted a personal agent measured by decisions, not engagement: a few unusually good finds, each with enough evidence to act confidently. The clearest proof arrived during the project itself. Beachcar surfaced a pink 1960 Willys DJ-3A Surrey I did not know to search for. I bought it.

## What it does

Beachcar captures a person's constraints and hard-to-filter taste in a native iPhone app. A desktop handoff connects the user's local Codex to Beachcar's hosted MCP. Codex runs GPT-5.6, reads the saved taste and feedback, and uses the user's already signed-in browser to research auction sources. It compares evidence, reasons about fit, value, distance, practicality, and risk, then publishes only the strongest few candidates.

The iPhone experience presents judgment rather than a transcript: why a car fits, market context, bid discipline, watch-outs, confidence, uncertainty, and source evidence. Swipe right to Like or Love; left to Pass or Never again. Those signals return through MCP and visibly steer the next run.

## How it is built

- Native SwiftUI app for taste onboarding, dossiers, galleries, and feedback.
- React desktop coach/PWA for Codex setup and a deterministic judge replay.
- Cloudflare Worker and D1 for identity and user-scoped memory, runs, and events.
- Streamable HTTP MCP for setup context, taste calibration, research planning, candidate submission, publication, verification, and feedback history.
- A Beachcar Codex skill that defines the local-browser research contract.
- Clerk authentication plus hashed, revocable, reduced-scope tokens for recurring tasks.

The architecture deliberately keeps auction credentials in the user's browser and OpenAI credentials with Codex. Beachcar pays no cloud inference or scraping cost for this path and stores neither secret.

## How Codex and GPT-5.6 are used

Inside the product, GPT-5.6 is the judgment engine in the user's local Codex. It turns nuanced taste and imperfect marketplace evidence into a research plan, candidate comparisons, concise dossiers, and explicit uncertainty. Codex orchestrates the browser and Beachcar MCP, then verifies that the published run is exactly what appears on the phone.

During Build Week, I also used Codex with GPT-5.6 as the primary development partner. It audited the pre-existing repository, exposed contradictions between the product and its story, implemented the local-agent onboarding and MCP workflow, drove the iOS simulator and browser, strengthened tests, created the Surrey-led identity, and assembled the submission package. I made the key product decisions and claim boundaries; Codex turned those decisions into tested artifacts.

## Meaningful Build Week extension

Beachcar existed before the event. The judged extension begins from commit `e8321d0`, created before July 13 at 9:00 a.m. PT. During Build Week I turned an existing technical agent option into a coached local-Codex product: iPhone-to-desktop onboarding, downloadable skill, taste interview and confirmation, signed-in local browser research, MCP publication and verification, visible feedback learning, a deterministic judge experience, and the Surrey proof identity.

## Impact and novelty

Most shopping agents own the inference, browser, and experience. Beachcar separates them. The user's Codex owns open-ended intelligence and authenticated browsing; Beachcar owns durable taste, inspectable evidence, and an unusually focused decision surface. That makes the product more private, cheaper to operate, and more personal over time.

Its success metric is not clicks. It is whether the agent finds something the person could not have known to ask for. Beachcar already did.

## Links and required fields

- Repository: https://github.com/joncooper/beachcar
- Working demo: **add after Pass 2**
- Public YouTube demo: **add after Pass 3**
- Primary Codex task ID for `/feedback`: `019f8178-f7a2-7301-b9be-f5b0af997b70`
- Category: Apps for Your Life
- License: MIT

## Final submission checklist

- [ ] Public YouTube video is 2:40–2:55 and includes clear audio.
- [ ] Video explicitly shows/explains Codex and GPT-5.6.
- [ ] One run ID matches across publish, verify, and iPhone.
- [ ] Repository is public and the final commit range is documented.
- [ ] `/feedback` session ID is submitted.
- [ ] Public demo and free judge access are live through at least August 12.
- [ ] TestFlight/test account instructions are in private judging fields.
- [ ] All screenshots and footage are free of secrets and personal notifications.
- [ ] Music, auction photography, and third-party marks are owned or permission-cleared.
- [ ] Video says “Beachcar found it; I bought it,” never that the agent bid or purchased.
