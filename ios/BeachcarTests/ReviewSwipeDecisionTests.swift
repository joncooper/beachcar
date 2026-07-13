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
    XCTAssertEqual(ReviewCoachPolicy.stage(primaryLearned: false, strongLearned: false), .new)
    XCTAssertEqual(ReviewCoachPolicy.stage(primaryLearned: true, strongLearned: false), .primaryLearned)
    XCTAssertEqual(ReviewCoachPolicy.stage(primaryLearned: true, strongLearned: true), .mastered)
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
