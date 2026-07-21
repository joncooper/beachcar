# Devpost submission copy

## Title

Beachcar

## Tagline

your codex - your taste - your car

## Category

Apps for Your Life

## Short description

Beachcar starts with the feeling of the car you want, even when you cannot name it. Your local Codex learns your taste, researches through the browser you already control, and sends a few evidence-backed opinions to Beachcar. I built it for one-to-two-mile family errands in my tiny beach town. After a couple of weeks, it surfaced the strange pink 1960 Willys Surrey I did not know existed. I bought it.

## Inspiration

All summer, I am taking my kids one or two miles at a time: to the beach, camp, friends, and ice cream. I wanted a beach car that was open, simple, weird, and unlike anything else in town. I could describe the feeling, but I could not name a make or model.

Most car sites require the answer before they will help with the search. Beachcar starts with the feeling instead. Its clearest proof is the pink Surrey that is now my actual car.

## What it does

Beachcar remembers qualities and constraints that do not fit neatly into search filters. Local Codex turns that taste into a research plan, uses public or user-authorized pages in the browser the user controls, respects source access and reuse limits, discards weak matches, and calls Beachcar's user-scoped MCP to publish a small shortlist.

The review experience explains why each car fits, what makes it special, what the market suggests, and what could go wrong. Love, Pass, and Never again become explicit steering for the next search. The user remains responsible for logins, browsing access, judgment, and any purchase. Beachcar never bids or buys.

## How Codex and GPT-5.6 are used

GPT-5.6 is the judgment layer inside the user's local Codex. It turns nuanced taste and imperfect marketplace evidence into targeted research, comparisons, concise dossiers, and honest uncertainty. Codex follows the Beachcar skill, uses the user's signed-in browser, reads and writes scoped Beachcar state through MCP, publishes a shortlist, and verifies what Beachcar should show.

Codex with GPT-5.6 was also the primary Build Week collaborator. It helped audit the existing project, choose the local-agent architecture, implement and test the coached setup and MCP loop, run component-level browser and iOS Simulator checks, define consent boundaries, and assemble the submission package. I made the product, privacy, and claim decisions.

## Optional Garage Session

After a successful supervised hunt, the Beachcar skill asks once whether the user wants a separate weekly Garage Session. If the user explicitly opts in, local Codex may prepare one small improvement in an isolated worktree and produce a review packet. The session does not push a branch, create an issue or pull request, deploy, post, or contact anyone. The user sees the exact proposal first and must give fresh approval before any external action.

That consent and review policy is implemented in the skill. A completed weekly session by a clean-slate friend is not claimed as proven.

## Meaningful Build Week extension

Beachcar existed before the challenge, and the Surrey discovery and purchase are treated as a prior case study. The submission claims only the meaningful extension built after the July 13, 2026 9:00 a.m. PT start: coached local-Codex setup, the Beachcar skill, signed-in local-browser research guidance, the scoped MCP workflow, explicit taste calibration and feedback steering, the deterministic judge replay, the consent-first Garage Session policy, and the competition proof package.

The deterministic replay demonstrates the product contract with fixed data. It does not claim to be the original Surrey run, a live scrape, live iPhone/MCP continuity, or a deployed public demo.

## Impact and novelty

Search products are good at finding more of a thing you can already name. Beachcar is for the fuzzier and more human problem: finding the thing that feels right before you know what it is called.

Its success metric is not more listings or more time browsing. It is one unusually good decision. For my family, that decision is now a wonderfully impractical-looking, perfectly practical pink Surrey.

## Submission fields

- Public repository: https://github.com/joncooper/beachcar
- Submitted revision: `[PRE-SUBMISSION: final pushed commit hash]`
- Local working-project instructions: [judge-guide.md](judge-guide.md)
- Working-project access: `[PRE-SUBMISSION: verified hosted URL, or a permanent GitHub link at the final pushed commit to judge-guide.md and its local startup path]`
- Public YouTube demo: `[PRE-UPLOAD: final public YouTube URL]`
- Surrey case study: https://bringatrailer.com/listing/1960-jeep-dj-3a/
- Candidate primary Codex task ID: `019f8178-f7a2-7301-b9be-f5b0af997b70` — `[PRE-SUBMISSION: provisional only; use it in the entry only after /feedback literally accepts or returns this value]`
- Photo credit: `[PRE-UPLOAD: exact dealer/photographer credit, or "none required" only after the terms are confirmed]`
- License: MIT

## YouTube upload kit

### Recommended title

`My Codex Found the Car I Actually Bought | Beachcar`

### Recommended description

```text
I wanted a tiny beach-town car for one-to-two-mile trips with my kids. I could describe the feeling - open, simple, weird, joyful - but I could not name the car.

So I built Beachcar. My local Codex learns my taste, researches through the browser I already control, and uses Beachcar's MCP to turn a noisy market into a few evidence-backed opinions.

After a couple of weeks, it surfaced a pink 1960 Willys DJ-3A Surrey I did not know existed. I made the decision and bought it. Beachcar did not bid or purchase the car.

GPT-5.6 supplies the judgment inside Codex, and Codex also helped me build the Build Week extension: coached setup, the local-agent skill, the scoped MCP workflow, explicit feedback learning, the judge replay, and the opt-in Garage Session review gate.

Beachcar existed before Build Week, and the Surrey is a prior real-world case study. The competition work is the meaningful local-Codex product extension and proof package described in the repository.

Project repository: https://github.com/joncooper/beachcar
Working project: [PRE-UPLOAD: VERIFIED HOSTED URL, OR https://github.com/joncooper/beachcar/blob/<FINAL_PUSHED_COMMIT>/docs/build-week/judge-guide.md]
Car case study: https://bringatrailer.com/listing/1960-jeep-dj-3a/
Photo credit: [PRE-UPLOAD: EXACT REQUIRED CREDIT, OR "NONE REQUIRED" ONLY AFTER CONFIRMATION]

Built for OpenAI Build Week 2026 - Apps for Your Life.
```

### Chapters for the 1:40.80 cut

```text
00:00 Tiny beach-town problem
00:20 Search starts with feeling
00:32 Your Codex hunts
00:55 The car it found
01:08 Built with Codex and GPT-5.6
01:27 Now find yours
```

These rounded chapter boundaries keep every chapter at least 10 seconds long and follow the finished picture cut. The narration begins the reveal thought at 00:48.034, but the complete Surrey first appears at 00:55.500, so the car chapter begins at 00:55. The other boundaries track the 00:20.671, 00:31.505, 01:07.671, and 01:26.812 section changes.

### Local upload assets

- Thumbnail master: local production file `docs/build-week/Beachcar-Build-Week-thumbnail.jpg` (not a public repository link until tracked and pushed)
- Video master: local production file `docs/build-week/Beachcar-Build-Week-final.mp4` (intentionally ignored by Git; upload it to YouTube and use the verified public YouTube URL in the entry)
- SRT companion: `docs/build-week/Beachcar-Build-Week-final.srt` is a timing reference and localization source. The MP4 already has burned-in captions, so do **not** attach the SRT to that upload. Use the SRT only with a separately exported captionless master.
- Working-project fallback: if there is no verified hosted experience, use a permanent final-commit GitHub permalink to `docs/build-week/judge-guide.md`; the local MP4 path is neither a film URL nor working-project access.
- Before upload, inspect the thumbnail and every video frame for required credit, uncleared auction chrome, private data, and generated-car imagery.

### Tags

`OpenAI Build Week, Codex, GPT-5.6, MCP, personal agent, local AI, car search, car auctions, iPhone app, Beachcar, 1960 Willys Surrey, Willys DJ-3A, Apps for Your Life`

## Deadline-aware final checklist

The submission deadline is **July 21, 2026 at 5:00 p.m. PDT / 8:00 p.m. EDT**.

- [ ] Watch the exact 100.80-second master from beginning to end with sound and captions.
- [ ] Confirm the cut visibly demonstrates the working project, not only the story or static editorial boards. If it does not, add real replay or product interaction footage before upload.
- [ ] Resolve the exact covered real-car files, uses, edits, and required credit from the private permission record before any public push or upload that contains them; otherwise substitute cleared media.
- [ ] Upload the burned-caption master to YouTube as **Public**, add the chapters, leave YouTube's SRT track disabled, and confirm picture, sound, and captions in a signed-out window. Attach the SRT only if a captionless master is exported instead.
- [ ] Replace every `[PRE-UPLOAD: ...]` and `[PRE-SUBMISSION: ...]` field; do not guess a URL or credit line.
- [ ] Push or merge the complete Build Week branch, confirm the repository is public, and verify that a fresh clone of the submitted revision contains `/demo`, setup, and tests.
- [ ] Either verify a working-project URL for the submitted revision or use the exact local judge path without implying a hosted `/demo` exists.
- [ ] Verify that the candidate task ID is the literal value accepted or returned by `/feedback`, then include it and select **Apps for Your Life**.
- [ ] Explain in audio what was built, how Codex helped build it, and how GPT-5.6 works inside the product.
- [ ] Keep the eligibility boundary visible in the written entry: existing project and Surrey case study before the event; meaningful local-agent extension after the start.
- [ ] State only that Beachcar surfaced the Surrey and Jon bought it. Never say the agent bid or purchased.
- [ ] Do not claim a friend TestFlight end-to-end pass, live run continuity, recurring OAuth, a deployed extension, or a public `/demo` until separately verified.
- [ ] Keep the public disclosure accurate: this repository review records the owner's representation of dealer permission and did not independently inspect the written license or credit terms.
- [ ] Submit before 5:00 p.m. PDT and reopen the public entry once to verify every link.
