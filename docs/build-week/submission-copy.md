# Devpost submission copy

## Title

Beachcar

## Tagline

your codex - your taste - your car

## Category

Apps for Your Life

## Short description

Beachcar starts with the feeling of the car you want, even when you cannot name it. Your local Codex becomes your taste agent: it searches in the browser you already use and sends Beachcar a handful of cars worth opening, with reasons, risks, and source links. I built it for one- or two-mile trips with my kids in our tiny beach town. Two weeks later, Beachcar found a ridiculous pink 1960 Willys DJ-3A Surrey I did not know existed. I bought it.

## Inspiration

Every summer, I drive my kids one or two miles at a time—to the beach, camp, friends, and ice cream. I wanted a beach car that was open, simple, weird, and unlike anything else in town. I could describe the feeling, but I could not name a make or model.

Most car sites require the answer before they will help with the search. Beachcar starts with the feeling instead. Its clearest proof is the pink Surrey that is now my actual car.

## What it does

Beachcar remembers the qualities that do not fit neatly into search filters. Local Codex turns that taste into a plan, searches public or user-authorized pages in the browser the user already uses, skips weak matches, and sends a small shortlist back through Beachcar's remote MCP.

Each pick says why it fits, what makes it special, what the market suggests, what could go wrong, and where it came from. Love, Pass, and Never again change the next hunt. The user stays responsible for logins, judgment, and any purchase. Beachcar never bids or buys.

## How Codex and GPT-5.6 are used

GPT-5.6 helps the user's local Codex make sense of nuanced taste and messy marketplace listings. Codex follows the Beachcar skill, works in the user's signed-in browser, uses Beachcar's MCP to remember the brief and feedback, publishes a shortlist, and checks what Beachcar should show.

Codex with GPT-5.6 was also my primary Build Week collaborator. It helped me choose the local-agent architecture, build and test the coached setup and MCP loop, check the browser and iPhone experience, define the consent boundaries, and make this submission. I made the product, privacy, and claim decisions.

## Optional Garage Session

After a successful supervised hunt, the Beachcar skill asks once whether the user wants a separate weekly Garage Session. If the user explicitly opts in, local Codex may prepare one small improvement in an isolated worktree and produce a review packet. The session does not push a branch, create an issue or pull request, deploy, post, or contact anyone. The user sees the exact proposal first and must give fresh approval before any external action.

That consent and review policy is implemented in the skill. A completed weekly session by a clean-slate friend is not claimed as proven.

## Meaningful Build Week extension

Beachcar existed before Build Week; the Surrey is the real-world case study. During Build Week, I made that experience repeatable for someone else: coached Codex setup, the Beachcar skill and MCP, feedback that sharpens the next hunt, a no-login demo, and the opt-in Garage Session.

The deterministic replay demonstrates the product contract with fixed data and is publicly hosted as a no-login static judge experience. It does not claim to be the original Surrey run, a live scrape, or live iPhone/MCP continuity.

## Impact and novelty

Search products are good at finding more of a thing you can already name. Beachcar is for the fuzzier and more human problem: finding the thing that feels right before you know what it is called.

Its success metric is not more listings or more time browsing. It is one unusually good decision. For my family, that decision is now a wonderfully impractical-looking, perfectly practical pink Surrey.

## Submission fields

- Public submission branch: https://github.com/joncooper/beachcar/tree/codex/agent-connected-subscriptions
- Submitted revision: use the exact commit URL attached to the Devpost entry
- Local working-project instructions: [judge-guide.md](judge-guide.md)
- Working-project access: https://beachcar-build-week-demo.jon-cooper.workers.dev/demo
- Public YouTube demo: https://youtu.be/hE89cMBgJCw
- Surrey case study: https://bringatrailer.com/listing/1960-jeep-dj-3a/
- Primary Codex task/session ID: `019f8178-f7a2-7301-b9be-f5b0af997b70` — confirmed from the active task metadata on July 21; this is the identifier to enter in the `/feedback` Session ID field
- Photo credit: none required; selected car photography used with the selling dealer's permission, as confirmed by the owner
- License: MIT

## YouTube upload kit

### Recommended title

`My Codex Found the Car I Actually Bought | Beachcar`

### Recommended description

```text
I wanted a tiny beach-town car for one-to-two-mile trips with my kids. I could describe the feeling - open, simple, weird, joyful - but I could not name the car.

So I built Beachcar. My local Codex becomes my taste agent: it searches in the browser I already use, while Beachcar's remote MCP remembers my taste and feedback. Instead of another feed, I get a handful of cars worth opening, with reasons, risks, and source links.

After a couple of weeks, Beachcar found a pink 1960 Willys DJ-3A Surrey I did not know existed. I made the decision and bought it. Beachcar did not bid or purchase the car.

GPT-5.6 helps my local Codex make sense of taste and messy listings. For Build Week, Codex also helped me build and test the coached setup, local skill, remote MCP loop, and feedback that changes the next hunt. There is also an opt-in path where a user's Codex can propose one small Beachcar improvement; nothing is shared until that user approves it.

The Surrey discovery happened before Build Week; it is the real-world case study behind this extension.

Submission branch: https://github.com/joncooper/beachcar/tree/codex/agent-connected-subscriptions
Fixed no-login judge replay: https://beachcar-build-week-demo.jon-cooper.workers.dev/demo
Car case study: https://bringatrailer.com/listing/1960-jeep-dj-3a/
Selected car photography used with the selling dealer's permission; no credit required.
Narration uses the ElevenLabs Chris voice.

Built for OpenAI Build Week 2026 - Apps for Your Life.
```

### Chapters for the 1:40.83 cut

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

- Thumbnail master: tracked production file `docs/build-week/Beachcar-Build-Week-thumbnail.jpg`; the same artwork is serving on the public YouTube video
- Video master: local production file `docs/build-week/Beachcar-Build-Week-final.mp4` (intentionally ignored by Git); the exact audited master is public at https://youtu.be/hE89cMBgJCw
- SRT companion: `docs/build-week/Beachcar-Build-Week-final.srt` is a timing reference and localization source. The MP4 already has burned-in captions, so do **not** attach the SRT to that upload. Use the SRT only with a separately exported captionless master.
- Working-project fallback: the hosted replay above is verified; a permanent final-commit GitHub permalink to `docs/build-week/judge-guide.md` remains the local-run fallback. The local MP4 path is neither a film URL nor working-project access.
- Final inspection found no required credit, uncleared auction chrome, private data, generated-car imagery, or overlapping on-screen copy.

### Tags

`OpenAI Build Week, Codex, GPT-5.6, MCP, personal agent, local AI, car search, car auctions, iPhone app, Beachcar, 1960 Willys Surrey, Willys DJ-3A, Apps for Your Life`

## Deadline-aware final checklist

The submission deadline is **July 21, 2026 at 5:00 p.m. PDT / 8:00 p.m. EDT**.

- [x] Watch and independently audit the exact 100.83-second master from beginning to end with sound and captions.
- [x] Confirm the cut visibly demonstrates the working project through the privacy-scrubbed Teach → Research interaction.
- [x] Confirm the selected real-car files, public video/thumbnail/deck/repository/site/demo uses, cropped or animated derivatives, and that no credit is required.
- [x] Upload the burned-caption master to YouTube as **Public**, add the chapters and custom thumbnail, leave YouTube's SRT track disabled, and verify the public video without the signed-in Studio session.
- [x] Replace every pre-upload field with the verified public URL.
- [x] Push the complete Build Week branch and confirm its release revision is publicly reachable; the exact final metadata commit goes in Devpost.
- [x] Verify the isolated working-project URL, root redirect, all five scene URLs, and exact real-photo asset signed out.
- [x] Confirm the primary task/session ID from the active Codex task metadata; enter `019f8178-f7a2-7301-b9be-f5b0af997b70` and select **Apps for Your Life**.
- [x] Explain in audio what was built, how Codex helped build it, and how GPT-5.6 works inside the product.
- [x] Keep the eligibility boundary visible in the written entry: existing project and Surrey case study before the event; meaningful local-agent extension after the start.
- [x] State only that Beachcar found the Surrey and Jon bought it. Never say the agent bid or purchased.
- [x] Do not claim a friend TestFlight end-to-end pass, live run continuity, recurring OAuth, or a deployed Garage Session extension; the separate static `/demo` is now verified.
- [x] Keep the public disclosure accurate: this repository review records the owner's representation of dealer permission and did not independently inspect the written license or credit terms.
- [ ] Submit before 5:00 p.m. PDT and reopen the public entry once to verify every link.
