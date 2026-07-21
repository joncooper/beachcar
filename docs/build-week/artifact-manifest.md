# Build Week artifact manifest

Release-candidate freeze: **2026-07-21 EDT**. Hash the exact files again if any artifact is rebuilt, resized, re-exported, or repackaged.

## Submission artifacts

| Artifact | Bytes | SHA-256 | Release status |
| --- | ---: | --- | --- |
| `Beachcar-Codex-Setup.zip` | 13,577 | `7cd9d161b0d0e7783b832b91d3d3899afe00be327798b0986a8435f6295f5ac7` | Tracked friend/judge package. Contains the current skill, installer, README, and version record; contains no token. Two independent package builds produced the same hash. |
| `Beachcar-Build-Week-final.pptx` | 1,841,571 | `c41079c6d8568a8770a07b99de117f22ba953ab48032e69d62221a79d9216250` | Tracked 10-slide real-photo judge deck. Render, overflow, template-fidelity, placeholder, hidden-slide, stale-copy, and embedded-media provenance checks passed. Slide 6 is explicitly a replay contract, not a live marketplace run. |
| `Beachcar-Build-Week-final.mp4` | 97,302,183 | `1d8246ac15ecdfd815898d3fb73b38d4aaef4c368b121b902fb6367aeae30f5f` | Frozen local YouTube master; intentionally ignored by Git and not a repository download. Creator-tier ElevenLabs Chris narration; no music. The replay uses the capture's own deterministic label so its page copy remains unobstructed. Upload this exact verified file and use its public YouTube URL in the entry. |
| `Beachcar-Build-Week-final.srt` | 2,303 | `9909d34e4a581bad9affa163b3c8f9025c050aee708076da3ddfe364ae92925a` | Tracked 26-cue timing reference and localization companion. It may accompany a separately exported captionless master; do not enable it alongside the burned-caption MP4. |
| `Beachcar-Build-Week-thumbnail.jpg` | 171,623 | `96522ea7ce4a69c950533b5f04e7bbbcaf183b8455380708c86c0ff69d28b502` | Tracked 1280×720 YouTube thumbnail made from the approved real studio hero. Its cold-read headline is `CODEX FOUND IT. / I BOUGHT IT.` and remains legible at 160×90. |

## Real-photo identity derivatives

| Artifact | Bytes | SHA-256 | Basis |
| --- | ---: | --- | --- |
| `public/beachcar-surrey-real.webp` | 107,996 | `9bd3e01f2f59ee4bfe4cb34e0f83f4fab3e6e03b1a24229d66b48b45393d526e` | Deterministic web resize of the selected real studio photograph. |
| `public/beachcar-wheel-real.webp` | 35,154 | `b12e26fd095977ed1a526335abb4e66fd5214d93cc19d77153827d6d76886281` | Deterministic web crop of the selected real wheel photograph. |
| `assets/brand/beachcar-icon.png` | 977,879 | `b444419b95754b40d05396451b58880fbcfdd223ebe6f8f788743bc66d2be856` | Deterministic real-wheel icon source used for generated web/iOS sizes. |

The film, thumbnail, deck, repository/site/demo identity, and selected derivative assets are releasable on the owner's confirmation that the selling dealer granted permission for those uses, including crops and animation, with no credit required. The written permission itself was not independently inspected for this public record. See [photo-permissions.md](photo-permissions.md).

## Final master media facts

- Duration: **100.833333 seconds**.
- Video: H.264 High, 1920×1080, progressive 8-bit `yuv420p`, limited-range Rec.709, 3,023 frames, CFR 30 fps (`vfrdet` 0/3022).
- Audio: AAC-LC mono, 48 kHz, approximately 167.6 kb/s; **-16.7 LUFS**, **-1.4 dBTP**, 3.2 LU LRA.
- The approximately 4.03-second silent tail is the intentional end card.
- Full strict decode passed with no errors.
- The complete Surrey first appears at 55.500 seconds; the captioned reveal begins at 55.258 seconds.
- “I bought it.” is captioned from 62.963 to 64.618 seconds; the new real-car angle, safe-area label, and caption land together at approximately 62.967 seconds.
- The fixed local replay visibly changes from Teach to Research from approximately 71.882 to 78.773 seconds, with a cursor/ripple cue and the capture's own `DETERMINISTIC REPLAY` disclosure. No added label covers the page copy.
- No generated car, auction-page capture, dummy email, password, token, notification, music, or private browser data appears in the final master.
- Captions are burned into the MP4. The SRT is not an additional track for that upload; it is retained for timing, localization, or a separate captionless export.

## Retired artifacts

The synthetic-era deck, rough cut, old internal-review captions, and their obsolete builder/narration sources were removed from the judge-facing tracked tree. Local backups are retained under ignored `.tmp/build-week-retired/`, and every removed file remains recoverable from Git history. They are not submission candidates.

## Release fields and fixed identifiers

The public release values remain open until publication; the local artifact and task identifiers are already fixed:

- Public submission branch: `https://github.com/joncooper/beachcar/tree/codex/agent-connected-subscriptions`
- Submitted Git revision: use the exact commit URL attached to the Devpost entry
- Public film access: `[PRE-UPLOAD: public, signed-out-verified YouTube URL; the ignored local MP4 path is not a submission link]`
- Working-project access: `https://beachcar-build-week-demo.jon-cooper.workers.dev/demo` — verified signed out on static Worker version `91ede9db-4ec2-458b-984f-6ecd0bdd37c5`; root redirect and all five scenes return the expected HTML experience
- Previous audited implementation commit: `bb7645d5ae52da946baa5f16e0f9736841d0ec45`; the Devpost entry points to the final release commit
- Primary Codex task/session ID for the `/feedback` field: `019f8178-f7a2-7301-b9be-f5b0af997b70` — confirmed from the active task metadata on July 21
- TestFlight build and owner/friend evidence: `[UNCLAIMED UNTIL A REAL CLEAN-SLATE PASS]`

Do not replace the remaining release fields with an unpushed commit, private URL, or unverified deployment.
