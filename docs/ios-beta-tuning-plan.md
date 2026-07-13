# iOS Beta Tuning Plan

Phase 5 should use a hybrid loop: sparse behavioral telemetry tells us where friction exists, while a beta-only **Tweaks** surface lets people say how the interaction should feel. Neither signal is sufficient alone. Telemetry can show a cancelled swipe but not whether it felt cautious or frustrating; sliders can capture preference but not accidental behavior.

## Product boundary

Interaction tuning must stay separate from auction taste.

- Auction feedback (`like`, `star`, `hide`, `avoid`, and preference notes) continues to steer the research agent.
- Product feedback ("swipes feel too sensitive", gallery dismissal attempts, hint usefulness) belongs to a separate product-learning stream.
- The existing `preference_events` table should **not** be reused. Those records are exported as taste memory and currently accept only `voice_note`, `text_note`, and `viewed`.

## Recommended beta experience

Add **Tweaks** below **Gestures** in the overflow menu for Debug and TestFlight builds. Lead with three human presets rather than raw numbers:

| Preset | Review feel | Gallery feel |
| --- | --- | --- |
| **Quick** | Shorter primary travel and lighter strong resistance | Easier vertical dismissal |
| **Balanced** | Current production defaults | Current production defaults |
| **Deliberate** | More travel before committing and firmer strong resistance | More intentional dismissal |

An Advanced disclosure can expose bounded controls:

- Swipe commitment: roughly 28–38% of screen width; current default is 32%.
- Strong commitment: roughly 64–80%; current default is 72%.
- Gallery dismissal: roughly 10–16% of screen height; current default is 13%.
- Haptics: Off, Soft, Standard, or Strong.
- Coaching: Adaptive, Subtle every session, or Always explain.

The sheet should include a non-destructive practice card, Restore Defaults, and **Share diagnostic snapshot**. Changes should apply to the practice card first and only affect the live review loop after the user taps Apply. Store a versioned local `InteractionTuningProfile`; attach its version and preset name to beta events so outcomes can be compared correctly.

The same surface should ask directly:

- Too easy to trigger
- Takes too much effort
- Strong action is hard to reach
- Haptics feel weak or heavy
- Gallery is hard to leave
- Something else…

Freeform product comments must be labeled as product feedback and must not enter the agent's preference-note pipeline.

## Minimal telemetry

Record completed interaction outcomes, not raw touch streams:

| Event | Useful properties |
| --- | --- |
| `review_session_started` | build, coaching stage, tuning preset |
| `review_drag_ended` | direction, maximum gate reached, committed/cancelled, duration bucket |
| `review_undo` | prior action, seconds since commit bucket |
| `coach_impression` | hint version and surface |
| `coach_dismissed` | scroll, swipe, menu, or replay |
| `gallery_opened` | photo count and remembered index |
| `gallery_dismissed` | vertical gesture or control, attempt count, zoomed/not zoomed |
| `gallery_reopened` | seconds since dismissal bucket |
| `tuning_changed` | from/to preset and changed control names |
| `experience_feedback_submitted` | fixed reason codes plus optional bounded comment |

Do not transmit listing titles, URLs, photos, notes, exact coordinates, complete drag paths, or unbounded device metadata. The server should derive the signed-in user id. VoiceOver or Reduce Motion state should be collected only if it is necessary for an accessibility-specific question and the beta disclosure says so.

## Storage and API

For the small beta, use a dedicated D1 table rather than Cloudflare Analytics Engine so account export and deletion remain straightforward:

```text
product_events
  id
  user_id
  session_id
  event_name
  properties_json
  client_created_at
  received_at
  app_build
  tuning_version
```

Add `POST /api/product-events/batch` with an allowlisted schema, a maximum batch size, strict property-size limits, and normal signed-in authorization. Queue events locally, send opportunistically, and discard after successful upload. Retain raw beta events for 90 days, then keep only aggregate conclusions. Include these rows in account export and deletion from the first migration.

The app should present a one-time beta disclosure with **Share beta diagnostics** enabled by explicit choice. The Tweaks menu and local diagnostic export work even when sharing is off.

## How to choose defaults

Evaluate by app build and tuning preset:

- Median time from first dossier render to first judgment.
- Cancelled-to-committed swipe ratio by direction.
- Undo within ten seconds, especially after strong actions.
- First-attempt gallery dismissal success.
- Gallery reopen rate within thirty seconds.
- Hint impressions versus immediate interaction, replay, or repeated inactivity.
- Direct "too sensitive / too effortful" responses.

Use real-device sessions for haptics; simulator results are not evidence for haptic intensity. Promote a new default only when behavior and direct feedback agree. Keep accessibility cohorts out of blanket threshold changes unless the change is explicitly designed and tested for them.

## Build sequence

1. Add `InteractionTuningProfile`, the local practice-card Tweaks sheet, presets, reset, and diagnostic export. No network dependency.
2. Add the consent disclosure, event queue, D1 migration, batch endpoint, export/delete coverage, and an owner-only aggregate view.
3. Run one TestFlight cycle with unchanged Balanced defaults and observe the baseline.
4. Invite testers to choose Quick or Deliberate, collect fixed reason codes, and compare cohorts.
5. Adjust defaults only after real-device haptic review and at least one full beta cycle; keep the remote kill switch able to return everyone to Balanced.

This makes phase 5 a reversible calibration system rather than a collection of magic numbers.
