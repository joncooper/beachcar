# Beachcar

<p align="center">
  <img src="assets/brand/beachcar-icon.png" alt="Beachcar app icon" width="104">
</p>

<h3 align="center">An AI auction scout that researches the market, explains its judgment, and learns your taste.</h3>

<p align="center">
  <em>SwiftUI + Cloudflare Agents, Workflows, Durable Objects, Containers, D1, R2, Clerk, and a React PWA.</em>
</p>

Beachcar is a private AI auction scout I built for people who love charming, unusual cars but do not want auction hunting to become a second job.

Each day it searches live marketplaces, reconciles messy listing data, evaluates candidates against one person's budget, location, taste, and prior feedback, then publishes a deliberately small shortlist. Every pick arrives with an opinionated dossier: why it fits, what the market says, what could go wrong, and where to stop bidding.

This is an end-to-end agentic product—not a chat wrapper. By default, a person connects the agent they already trust—Codex, Claude, or another MCP client—and Beachcar becomes that agent's durable taste memory, research workspace, and publishing surface. An optional managed tier runs Beachcar's hosted Agent, Workflow, browser runner, and AI Gateway scorer for subscribers. Both paths produce the same inspectable private product in native iOS and on the web.

## The product

<table>
  <tr>
    <td align="center" width="33%"><img src="docs/screenshots/ios-taste-onboarding.png" alt="Beachcar taste onboarding in the iPhone simulator" width="290"></td>
    <td align="center" width="33%"><img src="docs/screenshots/ios-agent-dossier.png" alt="Beachcar AI listing dossier in the iPhone simulator" width="290"></td>
    <td align="center" width="33%"><img src="docs/screenshots/ios-todays-finds.png" alt="Beachcar daily shortlist in the iPhone simulator" width="290"></td>
  </tr>
  <tr>
    <td valign="top"><strong>1. Teach it what matters.</strong><br>Region, radius, budget, use case, sources, and taste become durable research context.</td>
    <td valign="top"><strong>2. Get judgment, not links.</strong><br>Each pick includes fit reasoning, valuation, bid discipline, watch-outs, and a source-backed dossier.</td>
    <td valign="top"><strong>3. Review a shortlist, not a feed.</strong><br>Listings and photos have distinct navigation, with search, filters, and explicit progress.</td>
  </tr>
</table>

<p align="center"><sub>Real captures from the current SwiftUI app running in the iPhone simulator; listing media was loaded from the project's live-source research output.</sub></p>

The interaction model is intentionally fast and physical. Swipe right to **Like**, farther right to **Love it**; swipe left to **Pass**, farther left for **Never again**. Scroll down to read the full dossier. Tap a photo to enter a separate zoomable gallery, then swipe decisively up or down to return. Those judgment gestures do more than organize the current deck—they become preference memory for the next research run.

## Why I built it

Auction alerts are good at finding matches and bad at exercising judgment. A keyword can locate every old 4x4; it cannot tell whether a particular one is charming rather than compromised, fairly priced rather than merely cheap, or plausible for school runs and beach days.

Beachcar explores a more useful relationship between a person and an agent:

- The person defines taste, constraints, and risk tolerance.
- The agent does open-ended research and narrows the field.
- The product exposes evidence and uncertainty instead of presenting magic.
- Lightweight feedback compounds into better future decisions.

The goal is not maximum engagement. It is a few unusually good decisions, delivered at the right time.

## Two ways to use it

| Agent-connected | Managed Research |
| --- | --- |
| **Included by default.** Connect a personal Codex automation, Claude, or any OAuth-capable MCP client. The agent reads the profile and feedback, researches with its own tools, and publishes through Beachcar. | **Planned launch price: $29/month.** Beachcar runs the hosted research loop: schedules, source monitoring, browser handoffs, required AI Gateway judgment, publication, and cost controls. |
| The user controls the model, tools, cadence, and AI spend. Beachcar stores no provider key. | Beachcar pays the inference and infrastructure bill. The `managed_research` Clerk feature gates every manual, scheduled, and in-flight hosted run. |

The agent-connected path has no Beachcar-managed AI fee and is not a degraded recommendation engine. It is the default architecture: bring a capable agent and let Beachcar specialize in memory, evidence, feedback, and a highly crafted review experience. The paid tier buys convenience, not access to one's own data.

## What makes it agentic

```mermaid
flowchart LR
    A["Taste, budget, feedback"] --> M["Beachcar memory + MCP"]
    X["Your Codex, Claude, or MCP agent"] <--> M
    X --> R["Research with agent-owned tools"]
    S["Managed subscriber"] --> B["Beachcar Agent + durable Workflow"]
    B --> R2["Source adapters + browser runner + AI Gateway"]
    R --> P["Publish evidence + dossiers"]
    R2 --> P
    P --> I["SwiftUI app"]
    P --> J["React PWA"]
    I --> L["Like · Love · Pass · Avoid"]
    J --> L
    L --> A
```

| Agent capability | How Beachcar uses it |
| --- | --- |
| **Autonomy** | A connected personal agent can plan and publish through MCP; subscribers can also use time-zone-aware schedules and signed-in “Run now” requests. |
| **Tool use** | Source modules inspect auction feeds and pages; browser-heavy work can hand off to an isolated Cloudflare Container runner. |
| **Durable execution** | Cloudflare Workflows coordinate discovery, scoring, publication, image warming, and terminal status across long-running work. |
| **Memory** | Per-user feedback and preference events are loaded into later runs, changing both ranking and suppression. |
| **Judgment** | Candidates are assessed for fit, value, practical constraints, risk, novelty, and confidence—not only keyword similarity. |
| **Observability** | Users and operators can inspect source checks, candidate counts, runner handoffs, failures, usage, and the exact published result. |
| **Interoperability** | A hosted Streamable HTTP MCP surface with OAuth makes Codex, Claude, and other capable agents first-class clients of the same user-scoped product state. |

That traceability is deliberate. Source failure is not the same as “nothing worth showing,” missing location is not silently treated as local, and a runner handoff is not reported as a completed run. Every run retains its workflow identity, source diagnostics, candidate funnel, final publication, and human-readable errors.

## Design decisions I care about

- **A shortlist beats a feed.** Scarcity keeps the agent accountable for each recommendation.
- **Reasons belong beside the recommendation.** Fit, market context, confidence, and watch-outs are part of the core object—not an expandable AI garnish.
- **Taste is richer than filters.** “Open-air, charming, kid-plausible” is useful context even when it cannot be reduced to a checkbox.
- **Missing data should look missing.** The UI distinguishes no photo, failed loading, unknown location, and weak valuation evidence.
- **The default should preserve agency.** Users bring the agent and tools they already pay for; Beachcar does not force everyone onto a mediocre shared inference path.
- **Convenience should be an honest upgrade.** The managed tier pays for hosted research and required model-backed judgment. If that scorer is unavailable, Beachcar fails the run instead of publishing deterministic filler.
- **Agent access should still feel productized.** OAuth, scoped tokens, setup context, publishing tools, verification, and event history make MCP a polished path rather than an integration appendix.

## Built as a real product

Beachcar spans the product surface, agent runtime, data plane, authentication, operations, and release pipeline.

| Surface | Implementation |
| --- | --- |
| **Native app** | SwiftUI, Clerk authentication, offline run cache, progressive gesture coaching, bounded zoom/pan, matched photo transitions, beta gesture calibration, privacy-gated diagnostics, accessibility-aware layouts, and internal TestFlight distribution. |
| **Web app** | Mobile-first React PWA for onboarding, review, preferences, run history, status, account controls, administration, and aggregated beta calibration analysis. |
| **Agent runtime** | Cloudflare Agents + Durable Objects for per-user state, Workflows for durable orchestration, and Containers for browser/Codex-backed jobs. |
| **Data + media** | D1 for user-scoped product and run state; R2 plus Cloudflare Images for cached `thumb`, `deck`, and `full` photo variants. |
| **Identity + privacy** | Invite-only Clerk access, pilot and future subscription entitlements, verified billing-webhook support, user-scoped reads and writes, hashed automation tokens, OAuth metadata, export and deletion, plus an explicit boundary between auction-taste memory and short-lived product diagnostics. |
| **Operations** | Guarded D1 migrations, private recovery artifacts, staged container rollout, strict configuration checks, production smoke tests, and managed-path verification. |

The current verification suite includes **163 Vitest tests** across the web/Worker surface and **44 native tests**: 24 end-to-end XCUITests plus 20 gesture, coaching, tuning, privacy, persistence, and gallery-policy unit tests.

## A typical daily run

1. By default, a connected agent loads setup context and feedback through MCP, researches with its own tools, submits candidates, and publishes a verified run.
2. For a subscriber, a schedule or signed-in request starts Beachcar's per-user Agent and durable Workflow after rechecking the `managed_research` entitlement and AI budget.
3. Source adapters gather candidates; browser-dependent work can move to the isolated Container runner.
4. Managed runs require successful AI Gateway judgment before publication. Failed or unavailable scoring cannot silently become heuristic recommendations.
5. Beachcar publishes the run to D1, mirrors and warms image variants in R2, and records source-by-source diagnostics.
6. The person reviews in iOS or the PWA; that feedback becomes memory for whichever agent runs next.

## System map: runtime architecture

The earlier loop describes the product behavior. This view shows the runtime boundaries and the repository area that owns each moving part.

```mermaid
flowchart TB
    subgraph surfaces["Product surfaces"]
        IOS["Native SwiftUI app<br/>ios/BeachcarApp"]
        WEB["React PWA<br/>src/client"]
        CLIENT["Codex, Claude, or MCP client<br/>default curation path"]
    end

    subgraph edge["Cloudflare Worker · src/worker"]
        ASSETS["PWA assets"]
        API["JSON API<br/>auth + user scoping"]
        MCP["Hosted MCP + OAuth"]
        TRIGGER["Subscriber schedule + Run now"]
        DOMAIN["User-scoped domain + image services"]
    end

    subgraph runtime["Stateful agent runtime · src/worker"]
        AGENT["Per-user Beachcar Agent<br/>Durable Object"]
        FLOW["Beachcar Run Workflow<br/>durable orchestration"]
        SOURCES["Source adapters<br/>discovery + normalization"]
        RUNNER["Browser / Codex runner<br/>runner/ · Container"]
    end

    subgraph storage["Cloudflare data plane"]
        D1[("D1<br/>users · runs · listings · memory · beta diagnostics")]
        R2[("R2<br/>private image cache")]
        IMAGES["Image transforms<br/>thumb · deck · full"]
    end

    subgraph services["External services"]
        CLERK["Clerk<br/>identity + billing"]
        MARKETS["Auction sources<br/>BaT · Cars & Bids · Hemmings"]
        MODEL["AI Gateway / model<br/>required for managed judgment"]
    end

    IOS --> API
    WEB --> ASSETS
    WEB --> API
    CLIENT --> MCP
    IOS -. sign in .-> CLERK
    WEB -. sign in .-> CLERK
    API -. verifies tokens .-> CLERK
    CLERK -. feature + webhook .-> API
    API --> DOMAIN
    MCP --> DOMAIN
    CLIENT --> MARKETS
    API --> TRIGGER
    TRIGGER --> AGENT
    AGENT --> FLOW
    FLOW --> SOURCES
    FLOW --> RUNNER
    FLOW --> DOMAIN
    SOURCES --> MARKETS
    RUNNER --> MARKETS
    RUNNER --> MODEL
    FLOW --> MODEL
    DOMAIN --> D1
    DOMAIN -->|mirror originals| R2
    DOMAIN -->|prewarm + serve| IMAGES
    IMAGES <--> R2
```

The Worker is the trust boundary: it verifies identity, scopes every read and write to a user, and exposes the same product state to iOS, the PWA, and MCP clients. The default agent-connected path reaches that state through OAuth and scoped MCP tools. The managed branch additionally checks Clerk's feature claim at request time, persists webhook-backed entitlement state for background schedules, and rechecks access inside the Workflow before spending inference budget.

## Run it locally

The web and Worker code use Bun; the native app uses XcodeGen so the Xcode project remains reproducible.

```bash
bun install
cp .env.example .env.local
```

Add the Clerk values described in `.env.example`, then verify the web and Worker surfaces:

```bash
bun run typecheck
bun run test
bun run build
```

Run the local Worker integration preflight:

```bash
bun run preflight:local
```

Build and launch the iOS app:

```bash
bun run ios:generate
bun run ios:build
bun run ios:sim
```

For configuration details, see the focused guides instead of treating this README as an operator manual:

- [Native iOS development and TestFlight](docs/ios.md)
- [Cloudflare architecture and guarded deployment](docs/cloudflare.md)
- [Publishing contract and dossier schema](docs/publishing.md)
- [Hosted MCP and bring-your-own-agent path](docs/remote-mcp-friend-automation.md)
- [Managed Research pricing and unit economics](docs/pricing.md)
- [Scraping and compliance notes](docs/scraping-and-compliance.md)

## Repository map

```text
ios/                 Native SwiftUI app, unit tests, and XCUITests
src/client/          React PWA
src/worker/          API, Agent, Workflow, MCP, and data layer
runner/              Isolated browser / Codex Container runner
migrations/          D1 schema history
automation/          Research and operator fallback playbooks
scripts/             Build, release, migration, and verification tooling
docs/                Architecture and operations guides
```

## Project status

Beachcar is running as a private friend beta: the Worker/PWA is deployed and the native app is distributed through internal TestFlight. Agent-connected curation through MCP is the product default. Managed Research is entering a free, allowlisted pilot with checkout intentionally disabled; the future subscription boundary is implemented but will not be activated until real-user quality and cost evidence justify it. The default niche is beach cars and runabouts, but the profile, feedback, orchestration, and publication model are deliberately reusable for other high-consideration searches.

## Responsible use

Auction sites are living systems with their own terms and rate limits. Beachcar uses explicit source modules, conservative access patterns, operator-owned credentials where required, and a private image cache. Anyone adapting the project is responsible for respecting access controls, marketplace terms, and image rights.
