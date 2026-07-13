# Native iOS App

Beachcar includes a native SwiftUI app in `ios/` for an iPhone-first review loop.

## UX Model

- One listing is one vertically scrolling dossier. Reading never changes the current listing.
- A horizontal swipe anywhere on the dossier records feedback and advances to the next unreviewed find:
  - Right past the first gate: Like (`like` in the API)
  - Far right past the second gate: Love it (`star` in the API)
  - Left past the first gate: Pass (`hide` in the API)
  - Far left past the second gate: Never again (`avoid` in the API)
- Distance, underlay labels, color, and two haptic gates make the stronger actions deliberate. Flick velocity can commit a primary action but cannot accidentally commit a strong action.
- A versioned interaction coach teaches direction first, names the stronger outcome only after the primary gate, respects Reduce Motion, and retires learned instructions. The overflow menu keeps a replayable Gestures sheet available after mastery.
- Tapping the cover opens a separate full-screen, horizontally paged photo gallery with selected-photo continuity and a matched transition. Pinch or double-tap zooms, zoomed photos pan within bounds, and a single tap hides or restores chrome. Adjacent full-resolution photos prefetch as the selection changes.
- A decisive swipe up or down shrinks and rounds the gallery while fading its backdrop to reveal the dossier, then dismisses it. The first-use instruction retires after a successful gesture; a compact bottom safe-area control remains as a tap and VoiceOver fallback without competing with system chrome.
- `FIND x OF y` always counts listings; `PHOTO x OF y` appears only in the gallery. No-image listings use a compact fallback rather than an empty hero.
- Today's Finds provides search, judgment and lane filters, sorting, source health, and direct navigation without changing the review order.
- After every listing has a judgment, a completion summary replaces the dossier and keeps Today's Finds available.
- The dossier includes voice/text feedback that posts preference notes to the Worker for the next AI run.

## Auth

The app uses Clerk native iOS auth:

- `ClerkKit`
- `ClerkKitUI`
- prebuilt `AuthView()` in a sheet
- `UserButton(signedOutContent:)`
- Google auth through Clerk

The Worker uses `BOOTSTRAP_OWNER_EMAILS` or legacy `ALLOWED_EMAIL` only to bootstrap owner accounts. Other signed-in users are created as `invited` and must accept an invite code before they can load runs, save feedback, or submit preference notes.

The native app checks `/api/me` after sign-in:

- `invited` users see an invite-code gate.
- `active` users without completed onboarding see the preferences setup screen.
- active users with completed onboarding enter the scrolling review surface.
- `disabled` users are blocked before deck load.

## Run Status

- After loading `/api/runs/latest`, the store also reads `/api/agent-runs/latest`.
- The deck shows a compact status banner for queued, running, failed, and published runs.
- The banner also uses `sourceSummary` from the latest run for source-check counts, raw candidate counts, and browser/container runner-task counts.
- If the Agent-run status request fails, listing review still works from the latest run or cached run.

## Offline Cache And Images

- Latest-run JSON is cached in `UserDefaults` with the signed-in user id in the cache key.
- If `/api/runs/latest` fails and a cached run exists for that user, the deck falls back to the cached run.
- Listing images use `CachedRemoteImage`, which reads through a decoded in-memory image cache and `URLCache`.
- After a run loads, the store prefetches bounded `deck` and `thumb` image variants for the first listings so the next cards are already warm.
- While the gallery is open, it additionally prefetches the current photo's immediate `full`-resolution neighbors.

## Beta Interaction Tuning

The proposed real-device telemetry, Tweaks menu, privacy boundary, metrics, and rollout sequence are documented in [`ios-beta-tuning-plan.md`](ios-beta-tuning-plan.md). Product-interaction diagnostics stay separate from auction preference memory.

Clerk quickstart prerequisites:

- Enable Clerk Native API in the Clerk dashboard.
- Add the native application in Clerk with bundle ID `com.joncooper.beachcar`.
- Add Associated Domains for `webcredentials:brief-coyote-47.clerk.accounts.dev`.

## Command-Line Workflow

Install dependencies:

```bash
bun install
```

Generate the Xcode project:

```bash
bun run ios:generate
```

Resolve packages:

```bash
bun run ios:resolve
```

Build without opening Xcode:

```bash
bun run ios:build
```

Run on simulator:

```bash
bun run ios:sim
```

You can override the simulator destination:

```bash
IOS_DESTINATION='platform=iOS Simulator,name=iPhone 16 Pro Max' bun run ios:sim
```

Run UI tests:

```bash
bun run ios:test-ui
```

The UI tests launch local fixtures with `--ui-testing`; `--ui-testing-scenario invited|onboarding|active` covers invite, onboarding, and active deck entry without Clerk or Worker access.

## Simulator Runtime

If `ios:sim` cannot find a compatible iOS runtime, install the current platform from the command line:

```bash
xcodebuild -downloadPlatform iOS
```

The run script auto-creates an `iPhone 16 Pro Max` simulator when the runtime is available.

## Non-Interactive Dev Login

For unattended simulator testing, create a Clerk sign-in token and store it in `.env.local`:

```bash
bun scripts/create-clerk-dev-token.mjs
bun run ios:sim
```

When `CLERK_DEV_SIGN_IN_TOKEN` is present, `ios:sim` launches the DEBUG build with `--clerk-ticket`, signs in through ClerkKit, and then loads the production Worker with the native Clerk session token. This is for local DEBUG testing only; normal users still sign in with Google through Clerk.

## TestFlight Publishing

The command-line TestFlight path uses Xcode automatic signing and App Store Connect API-key authentication. It does not require opening Xcode for normal builds.

One-time Apple setup:

1. In App Store Connect, create an app named `Beachcar` with bundle ID `com.joncooper.beachcar`, platform `iOS`, SKU `beachcar-ios`, and primary locale `en-US`.
2. In App Store Connect > Users and Access > Integrations, create an API key with access sufficient for app upload and signing. Download the `.p8` file once.
3. Store the key at `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`.
4. Copy `.env.apple.example` to `.env.apple.local` and fill in `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, and ideally `APPLE_TEAM_ID`.
5. In Clerk, keep the native application bundle ID set to `com.joncooper.beachcar`.

Build an App Store Connect archive:

```bash
bun run ios:archive
```

Upload the latest archive to TestFlight:

```bash
bun run ios:testflight
```

Or do both in one command:

```bash
bun run ios:release
```

The scripts write outputs under `build/ios/` and record the latest archive path in `build/ios/latest-archive-path`.

By default, `ios:testflight` also assigns the uploaded build to `TESTFLIGHT_BETA_GROUP_NAME` so internal testers see the new build after Apple processing completes. App Store Connect can lag after accepting an upload, so the assignment script polls for the new build before attaching it. If App Store Connect already grants the group access to all builds, the assignment step is a no-op.

### Build Numbers

`IOS_BUILD_NUMBER` must increase for every upload. If it is omitted, `ios:archive` uses a timestamp build number like `202606231425`.

To force a version/build:

```bash
IOS_MARKETING_VERSION=0.1.0 IOS_BUILD_NUMBER=202606231425 bun run ios:release
```

### Internal-Only Builds

By default, `TESTFLIGHT_INTERNAL_ONLY=YES`, so uploaded builds are meant for internal TestFlight testing. Change it to `NO` only when the build should be eligible for external testers or App Review workflows.

### Common Failures

- `No profiles for com.joncooper.beachcar`: confirm the bundle ID exists in the Apple Developer account and rerun with `-allowProvisioningUpdates` through the provided scripts.
- `No Accounts`: use an App Store Connect API key in `.env.apple.local`, or add the Apple account in Xcode once.
- Missing app record: create the iOS app record in App Store Connect before upload.
- App icon validation: run `bun run ios:icons`; the release scripts run this automatically.
