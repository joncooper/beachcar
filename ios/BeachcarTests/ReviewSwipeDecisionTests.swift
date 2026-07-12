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

  private func action(_ translation: CGFloat) -> FeedbackAction? {
    ReviewSwipeDecision.action(
      translation: translation,
      predicted: translation,
      velocity: 0,
      width: 390
    )
  }
}
