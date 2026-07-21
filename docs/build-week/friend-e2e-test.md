# Beachcar two-round end-to-end acceptance guide

Use this guide twice, in order:

1. The owner rehearses from a clean Beachcar account and a clean local Codex connection.
2. A friend repeats the journey from TestFlight, then finishes setup in Codex on their own Mac.

These are two participant journeys, not just two API calls. The owner round proves the core path before another person sees it. The friend round proves that the handoff, language, permissions, and recurring behavior are understandable without the builder filling in missing steps.

## The product promise being tested

The accepted path is:

`iPhone onboarding -> desktop coach -> local Codex -> user's signed-in local browser -> hosted Beachcar MCP -> verified shortlist on iPhone -> feedback -> next plan`

The current hosted MCP is shown by the signed-in desktop coach. For this build it should be the Beachcar Worker endpoint ending in `/mcp`, not any Dockett infrastructure.

Beachcar does not run authenticated cloud-browser scraping and does not pay for AI in this path. Codex may read Beachcar's small public auction-feed cache before using the tester's own browser session. The tester uses their own Codex subscription. Beachcar stores taste, feedback, automation events, and published runs. It must not receive the tester's auction-site password, MFA code, browser cookies, OpenAI credential, or any other provider key.

The recurring credential must be a `bcauto_...` token with exactly these permissions:

- `setup:read`
- `setup:write`
- `sources:read`
- `runs:publish`
- `events:read`

It must not include `usage:write`. It cannot bid, buy, delete an account, start paid research, or record local Codex work as Beachcar AI usage.

## What counts as a pass

The owner must pass the core gates before the friend is invited. The friend round repeats those gates and adds the required recurring proof:

- The tester starts with no Beachcar profile, feedback, runs, or active automation token for the test identity.
- iPhone onboarding saves region, all-in ceiling, practical needs, things to seek, and things to avoid.
- The desktop page recognizes the same email and coaches the tester into local Codex setup.
- Codex asks a short taste interview and shows its proposed summary before the tester approves the taste write.
- Research happens in local Codex. Authenticated or rendered pages use the tester's local browser after the tester signs in.
- `publish_run` succeeds, then `verify_latest_run` returns the exact same run ID and listing count.
- The latest iPhone shortlist contains that verified set of listings.
- The run identifies its execution as `local-codex-browser`, names any blocked sources, and adds no Beachcar AI usage.
- The tester records one positive and one negative preference signal, and the next plan can explain how both changed its steering.
- In the friend round, a near-term recurring run works while the Mac is awake and Codex is running.
- Revoking the token prevents another MCP call.
- No screenshot, recording, transcript, email, or issue contains a raw token or login secret.

## Evidence packet

Create one private evidence packet for each round. Do not put it in the public repository. Record:

- Round: owner or friend
- Tester email used for both iPhone and desktop
- TestFlight build number and Beachcar web origin
- Name and checksum of the `Beachcar-Codex-Setup.zip` package
- macOS and Codex versions
- Start and finish times, including time zone
- Automation token record label or non-secret record ID, never the `bcauto_...` value
- Published run ID
- Verified run ID
- Published and verified listing counts
- Titles of the first two verified listings
- Recurring follow-up run ID and scheduled/actual times
- Any blocked source and the exact user-visible explanation
- Beachcar AI usage immediately before and after the run, or an account export showing that no AI usage event was added
- Whether operator help was required, what it was, and when

Collect these screenshots or short recordings:

1. Fresh iPhone welcome/onboarding screen.
2. Completed iPhone search summary before saving.
3. iPhone desktop handoff with the tester's email.
4. Desktop Codex coach showing the Beachcar MCP endpoint and the five reduced scopes.
5. The recurring-token list after the one-time secret has been hidden. Crop out the raw token if it was still visible.
6. The opened setup ZIP, installer completion, and Codex restart message, with no secret visible.
7. Codex's proposed taste summary and the tester's explicit approval.
8. The moment Codex pauses for source login, MFA, CAPTCHA, or browser permission, if one occurs. Never capture the credential entry itself.
9. Codex's final receipt showing the publish result, verification result, matching run ID, matching count, and `local-codex-browser` execution.
10. The iPhone shortlist showing the same first listings and count.
11. One Love and one Never again action, followed by the next plan explaining both signals.
12. Beachcar's recent automation events showing the setup/read, research, publish, and verify sequence, plus before/after proof that no Beachcar AI usage was added.
13. The near-term recurring run and its matching verification receipt.
14. The token shown as revoked, followed by Codex reporting that the revoked connection is unauthorized.

The same-run-ID receipt is the primary acceptance evidence. A nice shortlist without that receipt is not enough.

## Before round 1: prepare a real clean slate

Use a dedicated owner test identity or an owner-controlled email alias. Do not erase the owner's only working account just to simulate a new user.

1. Export any data that needs to be retained.
2. Revoke every active Beachcar automation token for the test identity.
3. Remove any previous Beachcar recurring task from Codex.
4. Remove the previous local Beachcar MCP connection, installed Beachcar skill, and `BEACHCAR_MCP_TOKEN` secret from that test Mac, then restart Codex.
5. Remove and reinstall the TestFlight app so local onboarding state is gone.
6. Confirm on the Beachcar server that the identity has no profile, source settings, runs, feedback, automation events, or active token.
7. Confirm the TestFlight invitation and the Beachcar invitation use the same email.

Important: the current self-service **Delete account** action deletes the user's Beachcar data and leaves that identity disabled. Normal sign-in does not automatically reactivate a disabled identity. Do not use it as a quick reset if the same email must immediately onboard again. For repeat testing, use a fresh invited alias or have the operator perform an explicit test-account reactivation/re-invite before the round begins.

Write down the clean-slate confirmation and time. If old listings or preferences appear later, the round fails even if the rest of the flow works.

## Round 1: owner rehearsal

### A. Onboard on iPhone

1. Install the intended TestFlight build and sign in with the clean owner test identity.
2. Complete onboarding as a real buyer. Enter an actual region, a realistic all-in ceiling, intended passengers/use, at least two positive taste signals, and at least two avoids.
3. Choose **Connect your own agent**. Do not choose managed research.
4. Save the search and stop on the desktop Codex handoff.
5. Use **Send myself the desktop link** and open it on the Mac. Sign in with the same email.

Accept when the desktop coach displays the saved email/search and waits for Codex to save taste. Fail if a run begins in the cloud, a payment prompt appears, or Beachcar asks for an OpenAI key or auction password.

### B. Connect local Codex

The desktop coach provides the MCP endpoint, recurring token, and starter prompt. The supported desktop delivery is `Beachcar-Codex-Setup.zip`. It contains a plain-language README, release `VERSION.txt`, a double-click **Install Beachcar.command** launcher, the installer, and the adjacent Beachcar skill. The frozen checksum lives in `docs/build-week/artifact-manifest.md`.

1. Download the setup ZIP from the trusted Beachcar handoff and confirm its package name/checksum against the release note.
2. Open the ZIP, read its README, and double-click **Install Beachcar.command**. If macOS asks, Control-click the launcher, choose **Open**, and confirm it may open in Terminal.
3. Create one recurring token in the Beachcar desktop coach. Copy it once into the installer's hidden prompt; do not paste it into a Codex chat, email, note, screenshot, or configuration text.
4. Wait for **Beachcar is connected to local Codex**. The installer should hide the pasted token, store it in Codex's private local environment, install the skill, and configure only the Beachcar MCP tools.
5. Fully quit and restart Codex.
6. Start a new Codex task with the coach's starter prompt.

Accept when Codex can reach Beachcar and explains that it will use local Codex, the local signed-in browser, Beachcar's public-feed cache, and the hosted Beachcar MCP. Fail if it proposes authenticated cloud-browser scraping, Beachcar-managed research, an OpenAI API key, OAuth for the recurring credential, or a local replacement server.

### C. Calibrate taste with consent

Codex should load the saved setup, then ask about what the tester wants more of, what to avoid, intended use/passengers, absolute all-in ceiling, and one memorable yes and no example.

It must present a concise calibration for confirmation before saving it. The tester may correct it. Only after the tester approves should Codex save taste. The desktop coach should notice the saved taste and leave its waiting state without a manual refresh.

Accept when the saved result reflects the tester's words without inventing sensitive preferences, location, budget, or risk tolerance. Fail if Codex saves before approval or if scheduled automation is used to perform calibration.

### D. Run, publish, and verify

1. Let Codex create the research plan from the saved setup and feedback.
2. Let it use Beachcar's source cache first where available.
3. When a source needs a rendered or authenticated page, let Codex open the local browser.
4. The tester personally completes sign-in, password-manager, MFA, CAPTCHA, consent, and browser-control prompts. Resume Codex afterward.
5. Codex submits a small, evidence-backed candidate set, publishes one final shortlist, and immediately verifies the latest run.

Copy the non-secret receipt into the evidence packet:

- `publish_run` run ID
- `verify_latest_run` run ID
- Submitted/published listing count
- Verified listing count
- First two listing titles
- `sourceSummary.execution`
- Blocked sources or incomplete details

Accept only if both IDs and both counts match exactly, execution is `local-codex-browser`, and the first listings are the expected ones. Then open Beachcar on iPhone and confirm the same shortlist appears.

If verification sees a different latest run, stop. Do not refresh until the mismatch is recorded. Check for the wrong Beachcar email, a second active token, or an overlapping automation before trying again.

### E. Prove learning

On iPhone, mark one listing **Love** and a meaningfully different listing **Never again**. Ask Codex for the next plan without publishing another owner shortlist. Save the explanation of how both signals changed the plan.

Accept when the explanation is specific and traceable to the two actions. Generic claims that the system "learned your taste" do not pass.

### F. Owner gate

Revoke the owner test token in Beachcar. Ask Codex to perform a harmless Beachcar read. It must report that the connection is unauthorized. Remove the owner recurring task and local secret before moving to the friend round.

If all owner checks pass, freeze the exact TestFlight build, web deployment, repository revision, installer, and skill used for the friend. Do not change one component without restarting the owner round.

## Round 2: friend journey

The friend should use their own iPhone, Mac, Codex account, browser profile, and fresh Beachcar identity. The owner may observe and take notes, but should not drive the screens except for a login, MFA, CAPTCHA, consent, or secret-exposure safety intervention.

### A. Send only what a new user should receive

Send the friend:

- The TestFlight invitation.
- A short note to use the same email on iPhone and desktop.
- The Beachcar invitation, if the build is invite-gated.
- The desktop link from the iPhone handoff.
- The matching release-tagged `Beachcar-Codex-Setup.zip` and its checksum.

Do not send a token, password, API key, prefilled Codex configuration, or auction credential. The friend must create their own Beachcar token after signing in.

### B. Observe without coaching ahead

Ask the friend to think aloud and follow the product's words. Record:

- Where they hesitate.
- Which screen or email they expect next.
- Whether they understand that the flow continues on a Mac.
- Whether they understand who pays for Codex and where browser login lives.
- Whether they know they must restart Codex after setup.
- Whether they know a sleeping Mac or closed Codex cannot run the task.

Only intervene for a login/MFA/CAPTCHA takeover or to prevent exposure of a secret. Count every other intervention as an onboarding defect, even if the journey later succeeds.

### C. Repeat the supervised path

The friend repeats the iPhone onboarding, desktop coach, installer, Codex restart, confirmed taste interview, local browser research, publish, verify, and iPhone review from round 1.

Use the same acceptance rule: `publish_run` and `verify_latest_run` must return the exact same run ID and listing count. The iPhone must show that verified set. The run must say `local-codex-browser`, disclose blocked sources, and add zero Beachcar AI usage.

The friend then records one Love and one Never again signal and asks Codex to explain how the next plan changes.

### D. Schedule the near-term recurring proof

Only after the friend's supervised run has passed:

1. Create a recurring Codex automation using the installed Beachcar skill.
2. Schedule its first occurrence 10 to 20 minutes in the future, in the friend's current time zone.
3. Keep the Mac plugged in and awake, Codex running, the network connected, and the required marketplace browser sessions signed in.
4. Do not let the scheduled task call taste calibration. It must use the already confirmed taste.
5. Do not touch the app while waiting except to keep the device awake if needed.
6. After the scheduled time, capture its publish and verification receipt and open the refreshed shortlist on iPhone.

Accept when the scheduled task starts without owner assistance, publishes a new run, verifies that exact run ID and count, and appears on iPhone. A schedule that fires only after Codex is manually opened does not pass the unattended-ready claim.

If a login, MFA, CAPTCHA, consent, or expired session interrupts the scheduled run, the correct outcome is a visible blocked-source explanation and a request for a supervised session. It must not bypass the challenge, invent data, switch to a cloud scraper, or silently claim success.

### E. Revoke and prove revocation

1. Revoke the friend's token in Beachcar.
2. Refresh the token list and capture its revoked state.
3. Ask Codex to list Beachcar setup context or events.
4. Confirm the call is rejected as unauthorized.
5. Cancel the recurring automation so it does not continue producing failed attempts.

Fail the security gate if a revoked token still works. Do not create a replacement until the failure has been investigated.

## Fast diagnosis by symptom

| Symptom | Most likely place to look | Correct response |
| --- | --- | --- |
| Friend cannot enter onboarding | TestFlight build, Beachcar invitation, or email mismatch | Confirm the TestFlight and Beachcar invitations use the exact sign-in email. Do not bypass the invite gate. |
| Desktop shows a different or empty search | iPhone and desktop used different identities, or onboarding did not finish saving | Compare the signed-in emails and return to iPhone to confirm the saved search. |
| Desktop stays on "Waiting for Codex to save your taste" | Taste was not confirmed/saved, MCP is using the wrong user token, or Codex was not restarted | Inspect the Codex result and active token label. Save only after user confirmation; then let the page poll again. |
| Codex cannot see Beachcar tools | Installer/skill delivery, Codex restart, or MCP endpoint | Confirm setup came from the same frozen build and restart Codex. Do not create a local substitute MCP. |
| Token is rejected immediately | Secret was copied incompletely, revoked, or replaced by a short-lived OAuth token | Revoke the bad record and create one new reduced-scope `bcauto_...` token. Never send it through chat or email. |
| Browser page asks for sign-in, MFA, CAPTCHA, or consent | Expected local-user boundary | Pause Codex. The tester completes the prompt privately, then resumes. Never bypass it. |
| One source remains blocked | Session/access control or source availability | Record the source and reason in the run. Continue only with permitted, verifiable sources. |
| Publish succeeds but verification ID/count differs | Wrong user scope, overlapping run, or incomplete publish | Record both receipts, stop, and remove overlapping automation before retrying. Never present the shortlist as verified. |
| Verification matches but iPhone shows old data | Wrong iPhone identity, stale connection, or refresh delay | Confirm the email, reopen/refresh Beachcar, and compare the first titles. Keep the MCP receipt as source of truth while diagnosing. |
| Scheduled run never starts | Mac asleep, Codex closed, wrong time zone, or no network | Correct the prerequisite and schedule a new near-term occurrence. Do not claim cloud reliability. |
| Scheduled run stops at a source | Browser session expired or needs human verification | Mark the source blocked and resume later in a supervised session. |
| Beachcar AI usage changes during the local run | Managed mode or usage recording was invoked incorrectly | Fail the round. Confirm **Connect your own agent**, the reduced scopes, and no `record_usage` call before retrying. |
| A secret appears in evidence | Screenshot/transcript handling failure | Stop sharing, delete the exposed copy, revoke the Beachcar token, and rotate any exposed login credential before continuing. |
| Revoked token still works | Revocation or environment isolation failure | Cancel the automation, preserve the minimal non-secret evidence, and treat as a release blocker. |

## Privacy and secret-handling rules

- The token is shown once. Paste it only into the local installer's hidden prompt.
- Never paste the token into Codex chat, a terminal command, TOML, email, Messages, a bug report, or this evidence packet.
- Never ask for auction-site or OpenAI passwords. The tester signs in directly in their own browser or Codex app.
- Pause screen recording before password-manager, MFA, CAPTCHA, or consent interaction.
- Redact personal email, location, budget, saved examples, and listing notes before sharing evidence outside the private test team unless the tester explicitly consents.
- Do not reuse the owner's token for the friend or the friend's token on another machine.
- Do not use OAuth for recurring automation. The current OAuth access is short-lived and has no refresh-token path.
- Revoke the token immediately if the Mac is lost, the evidence packet leaks, or the tester stops participating.

## Rollback and reset after either round

1. Cancel the Beachcar recurring automation in Codex.
2. Revoke every active Beachcar token created for the round and confirm it is marked revoked.
3. Remove the Beachcar MCP connection and installed Beachcar skill from the test Codex profile.
4. Remove `BEACHCAR_MCP_TOKEN` from Codex's local secret environment and restart Codex.
5. Sign out of any marketplace sessions created only for testing; do not disturb the tester's normal browser profile without permission.
6. Export the Beachcar account if the evidence needs to be retained.
7. Remove the TestFlight app if another local clean-slate run is planned.
8. For a full server reset, use a disposable identity or coordinate an explicit operator reset/re-invite. Remember that self-service account deletion disables the current identity instead of making it instantly reusable.

Record each rollback action in the private evidence packet. A clean teardown is part of acceptance, not optional housekeeping.

## Competition judge path versus friend UX

These are deliberately different today:

### Competition judge path

The public `/demo` replay is the fastest, no-login evaluation path. It is deterministic, read-only, clearly labeled `DETERMINISTIC REPLAY`, and requires no TestFlight build, browser account, token, purchase, or paid AI. Judges can inspect the repository, tests, skill, MCP contract, and same-run-ID proof. Optional real-product judging can use a private TestFlight account plus the same versioned Beachcar Codex Setup ZIP used in the friend round.

Do not describe the replay as a live scrape. Do not ask a judge to expose an auction login. Do not include third-party auction photographs without permission.

### Friend UX

The friend journey is live and personal: TestFlight onboarding, a same-email desktop handoff, the versioned Beachcar Codex Setup ZIP, local Codex, the friend's browser login, the hosted Beachcar MCP, and a recurring task on the friend's Mac.

The ZIP is the friend-facing installation artifact. Its README explains prerequisites and the first task; **Install Beachcar.command** launches the hidden-token installer; the included skill and installer stay together. Distribute the ZIP only from the trusted Beachcar handoff, publish its version/checksum with the build, and test the exact artifact rather than asking the friend to clone the repository or assemble configuration by hand.

## Final release decision

The friend round passes only if all core and security gates pass and every intervention is documented. Classify the result:

- **Ship to the next friend:** matching run IDs/counts, correct local execution, zero Beachcar AI usage, understandable handoff, setup ZIP completed without builder help, recurring proof, successful revocation, and no secret leakage.
- **Fix and repeat owner round:** any core failure, unclear handoff, unexpected operator rescue, stale identity/data, schedule prerequisite not understood, or app/MCP mismatch.
- **Release blocker:** authenticated cloud-browser scraping or managed AI invoked, run claimed verified with mismatched IDs/counts, cross-user data, a revoked token still works, or any credential is exposed.
