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
