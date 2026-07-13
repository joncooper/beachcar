import XCTest
@testable import Beachcar

final class ReviewSwipeDecisionTests: XCTestCase {
  func testThresholdsScaleAndClampForPhoneWidths() {
    XCTAssertEqual(ReviewSwipeDecision.primaryDistance(for: 390), 124.8, accuracy: 0.01)
    XCTAssertEqual(ReviewSwipeDecision.strongDistance(for: 390), 280.8, accuracy: 0.01)
    XCTAssertEqual(ReviewSwipeDecision.primaryDistance(for: 320), 118, accuracy: 0.01)
    XCTAssertEqual(ReviewSwipeDecision.strongDistance(for: 500), 340, accuracy: 0.01)
  }

  func testPreviewUsesHumanActionLadder() {
    XCTAssertEqual(ReviewSwipeDecision.previewAction(offset: 40, strong: false), .like)
    XCTAssertEqual(ReviewSwipeDecision.previewAction(offset: 300, strong: true), .star)
    XCTAssertEqual(ReviewSwipeDecision.previewAction(offset: -40, strong: false), .hide)
    XCTAssertEqual(ReviewSwipeDecision.previewAction(offset: -300, strong: true), .avoid)
  }

  func testPrimaryAndStrongActionsMapByPhysicalDistance() {
    XCTAssertEqual(action(130), .like)
    XCTAssertEqual(action(-130), .hide)
    XCTAssertEqual(action(290), .star)
    XCTAssertEqual(action(-290), .avoid)
    XCTAssertNil(action(80))
  }

  func testVelocityCanCommitPrimaryButNeverPromotesToStrong() {
    XCTAssertEqual(
      ReviewSwipeDecision.action(translation: 80, predicted: 180, velocity: 900, width: 390),
      .like
    )
    XCTAssertEqual(
      ReviewSwipeDecision.action(translation: -80, predicted: -360, velocity: -1_400, width: 390),
      .hide
    )
  }

  func testSecondGateAddsResistance() {
    let primary = ReviewSwipeDecision.primaryDistance(for: 390)
    XCTAssertEqual(ReviewSwipeDecision.displayOffset(for: 100, primary: primary), 100, accuracy: 0.01)
    XCTAssertLessThan(ReviewSwipeDecision.displayOffset(for: 300, primary: primary), 300)
    XCTAssertGreaterThan(ReviewSwipeDecision.displayOffset(for: 300, primary: primary), primary)
  }

  func testCoachProgressesFromNewThroughPrimaryToMastered() {
    XCTAssertEqual(InteractionCoachState().reviewStage, .new)
    XCTAssertEqual(InteractionCoachState(primaryJudgments: 1).reviewStage, .primaryLearned)
    XCTAssertEqual(InteractionCoachState(primaryJudgments: 1, strongJudgments: 1).reviewStage, .mastered)
  }

  func testGhostNudgeOnlyRunsForMotionEnabledNewUsersBeforeInteraction() {
    XCTAssertTrue(ReviewCoachPolicy.shouldGhost(stage: .new, reduceMotion: false, sessionInteracted: false))
    XCTAssertFalse(ReviewCoachPolicy.shouldGhost(stage: .new, reduceMotion: true, sessionInteracted: false))
    XCTAssertFalse(ReviewCoachPolicy.shouldGhost(stage: .new, reduceMotion: false, sessionInteracted: true))
    XCTAssertFalse(ReviewCoachPolicy.shouldGhost(stage: .primaryLearned, reduceMotion: false, sessionInteracted: false))
  }

  func testStrongCoachNamesDirectionalOutcomeThenPhasesOut() {
    XCTAssertEqual(
      ReviewCoachPolicy.prompt(for: .like, reviewStage: .primary, coachStage: .new),
      "Keep going for Love it"
    )
    XCTAssertEqual(
      ReviewCoachPolicy.prompt(for: .hide, reviewStage: .primary, coachStage: .primaryLearned),
      "Keep going for Never again"
    )
    XCTAssertEqual(
      ReviewCoachPolicy.prompt(for: .star, reviewStage: .strong, coachStage: .primaryLearned),
      "Release to commit"
    )
    XCTAssertNil(ReviewCoachPolicy.prompt(for: .like, reviewStage: .primary, coachStage: .mastered))
  }

  func testUnifiedCoachTracksReviewAndGalleryMastery() {
    let first = Date(timeIntervalSince1970: 1_000)
    let second = Date(timeIntervalSince1970: 2_000)
    var state = InteractionCoachState()

    XCTAssertEqual(state.reviewStage, .new)
    XCTAssertTrue(state.showsGalleryGuidance)
    state.recordReview(.like, at: first)
    XCTAssertEqual(state.reviewStage, .primaryLearned)
    XCTAssertEqual(state.primaryJudgments, 1)
    state.recordReview(.star, at: second)
    XCTAssertEqual(state.reviewStage, .mastered)
    XCTAssertEqual(state.strongJudgments, 1)
    state.recordGalleryDismissal(at: second)
    XCTAssertFalse(state.showsGalleryGuidance)
    XCTAssertEqual(state.lastInteractionAt, second)
  }

  @MainActor
  func testUnifiedCoachMigratesLegacyFlagsAndPersistsReplay() {
    let suiteName = "InteractionCoachTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suiteName)!
    defer { defaults.removePersistentDomain(forName: suiteName) }
    defaults.set(true, forKey: "shade.swipeCoach.primaryLearned.v2")
    defaults.set(true, forKey: "shade.swipeCoach.strongLearned.v2")

    let migrated = InteractionCoach(defaults: defaults)
    XCTAssertEqual(migrated.state.reviewStage, .mastered)
    XCTAssertEqual(migrated.state.hintVersion, InteractionCoachState.currentHintVersion)

    migrated.replayHints()
    let restored = InteractionCoach(defaults: defaults)
    XCTAssertEqual(restored.state.reviewStage, .new)
    XCTAssertTrue(restored.state.showsGalleryGuidance)
  }

  func testGalleryDismissPhysicsRevealUnderlyingDossierProgressively() {
    let offset = GalleryDismissDecision.displayOffset(
      for: CGSize(width: 8, height: 180),
      height: 844
    )
    XCTAssertEqual(offset, 93.6, accuracy: 0.01)
    XCTAssertGreaterThan(GalleryDismissDecision.progress(offset: offset, height: 844), 0.35)
    XCTAssertEqual(GalleryDismissDecision.progress(offset: 900, height: 844), 1, accuracy: 0.01)
  }

  func testGalleryPrefetchesNeighborsAndBoundsPan() {
    XCTAssertEqual(GalleryPhotoPolicy.adjacentIndices(current: 0, count: 3), [0, 1])
    XCTAssertEqual(GalleryPhotoPolicy.adjacentIndices(current: 1, count: 3), [0, 1, 2])
    XCTAssertEqual(GalleryPhotoPolicy.adjacentIndices(current: 2, count: 3), [1, 2])

    let bounded = GalleryPhotoPolicy.boundedOffset(
      CGSize(width: 1_000, height: -1_000),
      viewport: CGSize(width: 390, height: 700),
      scale: 2
    )
    XCTAssertEqual(bounded.width, 195, accuracy: 0.01)
    XCTAssertEqual(bounded.height, -350, accuracy: 0.01)
  }

  func testGalleryDismissAcceptsDecisiveVerticalSwipesInEitherDirection() {
    XCTAssertTrue(galleryDismisses(y: 130, predictedY: 150))
    XCTAssertTrue(galleryDismisses(y: -130, predictedY: -150))
    XCTAssertTrue(galleryDismisses(y: 58, predictedY: 240))
    XCTAssertTrue(galleryDismisses(y: -58, predictedY: -240))
  }

  func testGalleryDismissRejectsShortOrHorizontalSwipes() {
    XCTAssertFalse(galleryDismisses(x: 8, y: 38, predictedY: 80))
    XCTAssertFalse(galleryDismisses(x: 190, y: 70, predictedX: 240, predictedY: 120))
    XCTAssertEqual(
      GalleryDismissDecision.displayOffset(for: CGSize(width: 160, height: 50)),
      0,
      accuracy: 0.01
    )
  }

  func testNamedTuningPresetsChangeRealGestureGatesAndResistance() {
    XCTAssertEqual(ReviewSwipeDecision.primaryDistance(for: 390, profile: .quick), 109.2, accuracy: 0.01)
    XCTAssertEqual(ReviewSwipeDecision.primaryDistance(for: 390, profile: .deliberate), 148.2, accuracy: 0.01)
    XCTAssertEqual(ReviewSwipeDecision.strongDistance(for: 390, profile: .quick), 249.6, accuracy: 0.01)
    XCTAssertEqual(ReviewSwipeDecision.strongDistance(for: 390, profile: .deliberate), 312, accuracy: 0.01)
    XCTAssertGreaterThan(
      ReviewSwipeDecision.displayOffset(for: 300, primary: 120, profile: .quick),
      ReviewSwipeDecision.displayOffset(for: 300, primary: 120, profile: .deliberate)
    )
    XCTAssertEqual(GalleryDismissDecision.distance(for: 844, profile: .quick), 84.4, accuracy: 0.01)
    XCTAssertEqual(GalleryDismissDecision.distance(for: 844, profile: .balanced), 109.72, accuracy: 0.01)
    XCTAssertEqual(GalleryDismissDecision.distance(for: 844, profile: .deliberate), 135.04, accuracy: 0.01)
    XCTAssertEqual(GalleryDismissDecision.distance(for: 667, profile: .balanced), 96, accuracy: 0.01)
    XCTAssertEqual(GalleryDismissDecision.distance(for: 667, profile: .quick), 72, accuracy: 0.01)
  }

  @MainActor
  func testTuningPersistsCustomValuesAndHonorsRemoteBalancedSafeguard() {
    let suiteName = "InteractionTuningTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suiteName)!
    defer { defaults.removePersistentDomain(forName: suiteName) }
    var custom = InteractionTuningProfile.quick
    custom.primaryCommitFraction = 0.31
    custom.preset = .custom

    let tuning = InteractionTuning(defaults: defaults)
    tuning.apply(custom)
    XCTAssertEqual(tuning.selectedProfile.preset, .custom)
    XCTAssertEqual(tuning.selectedProfile.primaryCommitFraction, 0.31, accuracy: 0.001)

    let restored = InteractionTuning(defaults: defaults)
    XCTAssertEqual(restored.selectedProfile, tuning.selectedProfile)
    restored.applyRemotePolicy(forceBalanced: true)
    XCTAssertEqual(restored.effectiveProfile, .balanced)
    XCTAssertEqual(restored.selectedProfile.preset, .custom)
  }

  @MainActor
  func testProductDiagnosticsRequireConsentAndOptOutClearsQueuedEvents() {
    let suiteName = "ProductTelemetryTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suiteName)!
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let telemetry = ProductTelemetry(defaults: defaults)

    telemetry.record(.reviewSessionStarted, properties: ["coachingStage": "new", "tuningPreset": "balanced"], tuning: .balanced)
    XCTAssertTrue(telemetry.queuedEvents.isEmpty)

    telemetry.setConsent(.enabled)
    telemetry.record(.reviewSessionStarted, properties: ["coachingStage": "new", "tuningPreset": "balanced"], tuning: .balanced)
    XCTAssertEqual(telemetry.queuedEvents.count, 1)

    telemetry.setConsent(.disabled)
    XCTAssertTrue(telemetry.queuedEvents.isEmpty)
    XCTAssertEqual(defaults.string(forKey: ProductTelemetry.consentKey), ProductDiagnosticsConsent.disabled.rawValue)
  }

  @MainActor
  func testProductDiagnosticsAndTuningAreIsolatedBySignedInUser() {
    let suiteName = "ProductScopeTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suiteName)!
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let userA = ProductTelemetry(defaults: defaults, storageScope: "user-a")
    userA.setConsent(.enabled)
    userA.record(.reviewSessionStarted, properties: ["coachingStage": "new", "tuningPreset": "quick"], tuning: .quick)
    let tuningA = InteractionTuning(defaults: defaults, storageScope: "user-a")
    tuningA.apply(.quick)

    let userB = ProductTelemetry(defaults: defaults, storageScope: "user-b")
    let tuningB = InteractionTuning(defaults: defaults, storageScope: "user-b")
    XCTAssertEqual(userB.consent, .undecided)
    XCTAssertTrue(userB.queuedEvents.isEmpty)
    XCTAssertEqual(tuningB.selectedProfile, .balanced)
    XCTAssertEqual(InteractionTuning(defaults: defaults, storageScope: "user-a").selectedProfile, .quick)
  }

  @MainActor
  func testProductFeedbackRemainsLocalWhenDiagnosticsArePrivate() {
    let suiteName = "ProductFeedbackTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suiteName)!
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let telemetry = ProductTelemetry(defaults: defaults)
    telemetry.setConsent(.disabled)
    telemetry.submitFeedback(reasons: [.tooEasy], comment: "A little abrupt", tuning: .quick)

    XCTAssertTrue(telemetry.queuedEvents.isEmpty)
    XCTAssertEqual(telemetry.localFeedback.first?.reasons, [.tooEasy])
    XCTAssertEqual(telemetry.localFeedback.first?.comment, "A little abrupt")
  }

  @MainActor
  func testGalleryCoachingRespectsAdaptiveSessionAndAlwaysModes() {
    let suiteName = "GalleryCoachingTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suiteName)!
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let coach = InteractionCoach(defaults: defaults)

    XCTAssertTrue(coach.showsGalleryGuidance(for: .adaptive))
    XCTAssertTrue(coach.showsGalleryGuidance(for: .subtleEverySession))
    coach.recordGalleryDismissal()
    XCTAssertFalse(coach.showsGalleryGuidance(for: .adaptive))
    XCTAssertFalse(coach.showsGalleryGuidance(for: .subtleEverySession))
    XCTAssertTrue(coach.showsGalleryGuidance(for: .alwaysExplain))
  }

  private func action(_ translation: CGFloat) -> FeedbackAction? {
    ReviewSwipeDecision.action(
      translation: translation,
      predicted: translation,
      velocity: 0,
      width: 390
    )
  }

  private func galleryDismisses(
    x: CGFloat = 0,
    y: CGFloat,
    predictedX: CGFloat = 0,
    predictedY: CGFloat
  ) -> Bool {
    GalleryDismissDecision.shouldDismiss(
      translation: CGSize(width: x, height: y),
      predictedEndTranslation: CGSize(width: predictedX, height: predictedY),
      height: 844
    )
  }
}
