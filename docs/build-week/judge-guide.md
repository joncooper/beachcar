# Beachcar judge guide

This guide gives judges a fast, free path through the Build Week extension. It contains no credentials or secrets.

## 60-second tour

Final public replay URL: **added after Pass 2 deployment**

The read-only replay requires no login, writes no data, and does not pretend to be a live run. It walks through five deterministic scenes:

1. **Proof** — Beachcar found the pink Surrey; its creator bought it.
2. **Teach** — region, all-in ceiling, practical constraints, and nuanced taste.
3. **Research** — GPT-5.6 Codex, signed-in local browser, and the exact MCP tool trace.
4. **Review** — a tiny iPhone shortlist with evidence, valuation, risks, and source links.
5. **Learn** — Love and Never again become visible steering in the next plan.

Keyboard controls in the final replay: left/right arrows, number keys 1–5, and `R` to reset. Each scene also has a stable deep link.

## Full working-product path

Final TestFlight and test-account instructions: **provided privately in the Devpost judging fields after Pass 2 validation**

The expected real-product sequence is:

1. Sign into Beachcar on iPhone.
2. Complete the short taste calibration.
3. Continue on desktop and connect local Codex with the Beachcar skill and scoped MCP token.
4. Let the user sign into auction sources in their own browser when needed.
5. Run the first research task and verify the published run.
6. Open the exact shortlist on iPhone.
7. Love one candidate and mark another Never again.
8. Ask Codex for the next plan and inspect both feedback signals.

No purchase, bid, paid plan, OpenAI API key, or Beachcar-funded AI is required. For a scheduled recurring task, the computer must be awake and Codex running.

## Local repository verification

```bash
bun install
bun run typecheck
bun run test
VITE_CLERK_PUBLISHABLE_KEY=pk_test_build_validation bun run build
bun run ios:build
```

After Pass 2, the no-secret replay runs locally at:

```text
http://127.0.0.1:5173/demo
```

## What to inspect

- [README](../../README.md): product thesis, architecture, Build Week boundary, and setup.
- [Beachcar daily-run skill](../../.agents/skills/beachcar-daily-run/SKILL.md): canonical local research behavior.
- [Challenge changelog](changelog.md): before/after and commit evidence.
- [Submission plan](submission-plan.md): criteria mapping and claim boundary.
- `src/worker/mcp.ts`: user-scoped setup, taste, candidate, publication, and verification tools.
- `tests/`: Worker/web contracts, feedback learning, and golden-path proof.
- `ios/BeachcarApp/`: native onboarding, review, dossiers, and feedback experience.

## Access and privacy

- Judge access will remain free and available through at least August 12, 2026.
- Marketplace logins remain in the user's local browser.
- OpenAI credentials remain with Codex.
- Beachcar stores neither credential.
- Any credentials placed in private Devpost fields must not be copied into issues, screenshots, or the public repository.

## Known boundaries

- OAuth is suitable only for interactive evaluation until the consent/refresh path has passed a real deployed expiry test.
- The recurring path uses a hashed, revocable, reduced-scope Beachcar automation token stored in the user's Codex environment.
- The public replay is deterministic evidence from a verified run, clearly labeled as such.
- Third-party auction photography is excluded unless written permission is obtained.
