import XCTest

@MainActor
final class BeachcarUITests: XCTestCase {
  private var app: XCUIApplication!

  override nonisolated func setUp() {
    continueAfterFailure = false
  }

  // MARK: Access and setup

  func testInvitedUserSeesHelpfulInviteGate() throws {
    launch(scenario: "invited")
    XCTAssertTrue(text(containing: "Invite required").waitForExistence(timeout: 15))
    XCTAssertTrue(text(containing: "invitation email").exists)
    XCTAssertTrue(inviteCodeField().exists)
    XCTAssertTrue(acceptInviteButton().exists)
  }

  func testInviteAcceptanceMovesToGuidedOnboarding() throws {
    launch(scenario: "invited")
    let field = inviteCodeField()
    XCTAssertTrue(field.waitForExistence(timeout: 15))
    field.tap()
    field.typeText("test-invite")
    acceptInviteButton().tap()
    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 10))
    XCTAssertTrue(text(containing: "Where should we look?").exists)
    XCTAssertTrue(text(containing: "1 OF 4").exists)
  }

  func testOnboardingFourStepsHandOffToDesktopCodex() throws {
    launch(scenario: "onboarding")
    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 15))
    continueOnboarding()
    XCTAssertTrue(text(containing: "What feels comfortable?").waitForExistence(timeout: 5))
    continueOnboarding()
    XCTAssertTrue(text(containing: "Calibrate your taste").waitForExistence(timeout: 5))
    continueOnboarding()
    XCTAssertTrue(text(containing: "Choose your rhythm").waitForExistence(timeout: 5))
    XCTAssertTrue(app.switches["Hemmings"].exists)
    app.buttons["save-preferences-button"].tap()
    XCTAssertTrue(identified("desktop-codex-handoff").waitForExistence(timeout: 10))
    XCTAssertTrue(text(containing: "Finish your Codex setup on a desktop").exists)
    XCTAssertTrue(text(containing: "friend@example.com").exists)
    XCTAssertTrue(app.buttons["desktop-codex-handoff-share"].exists)

    let continueToBeachcar = app.buttons["desktop-codex-handoff-continue"]
    XCTAssertTrue(continueToBeachcar.exists)
    continueToBeachcar.tap()
    XCTAssertTrue(identified("deck-view").waitForExistence(timeout: 10))
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 10))
  }


  func testDesktopCodexHandoffCanContinueToDeck() throws {
    launch(scenario: "desktop-handoff")

    XCTAssertTrue(identified("desktop-codex-handoff").waitForExistence(timeout: 15))
    XCTAssertTrue(text(containing: "SEARCH SAVED").exists)
    XCTAssertTrue(text(containing: "Finish your Codex setup on a desktop").exists)
    XCTAssertTrue(app.buttons["desktop-codex-handoff-share"].exists)

    app.buttons["desktop-codex-handoff-continue"].tap()
    XCTAssertTrue(identified("deck-view").waitForExistence(timeout: 10))
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 10))
  }
  // MARK: Scrolling review

  func testActiveUserEntersExplicitScrollingReview() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    XCTAssertTrue(waitForFind(1, of: 3))
    XCTAssertTrue(text(containing: "2 PHOTOS").exists)
    XCTAssertTrue(text(containing: "Open live auction").exists)
  }

  func testDirectionalSwipeCoachTeachesBothActionsThenYieldsToInteraction() throws {
    launch(scenario: "active", coachStage: "new")
    _ = shadeSurface()
    let coach = identified("shade-swipe-coach")
    XCTAssertTrue(coach.waitForExistence(timeout: 5))
    XCTAssertTrue(coach.label.localizedCaseInsensitiveContains("left to pass"))
    XCTAssertTrue(coach.label.localizedCaseInsensitiveContains("right to like"))
    XCTAssertTrue(identified("shade-swipe-pass-cue").exists)
    XCTAssertTrue(identified("shade-swipe-like-cue").exists)

    app.swipeUp(velocity: .slow)
    XCTAssertFalse(coach.waitForExistence(timeout: 1))
    XCTAssertTrue(waitForFind(1, of: 3))
  }

  func testGestureHelpRemainsRecoverableFromOverflowMenu() throws {
    launch(scenario: "active", coachStage: "mastered")
    _ = shadeSurface()
    app.buttons["shade-review-actions"].tap()
    let gestures = app.buttons["Gestures"]
    XCTAssertTrue(gestures.waitForExistence(timeout: 5))
    gestures.tap()
    XCTAssertTrue(identified("shade-gestures-help").waitForExistence(timeout: 5))
    XCTAssertTrue(text(containing: "Swipe left").exists)
    XCTAssertTrue(text(containing: "Pinch or double-tap").exists)
    XCTAssertTrue(app.buttons["shade-replay-gesture-hints"].exists)
  }

  func testBetaTweaksPracticesThenAppliesQuickFeel() throws {
    launch(scenario: "active", coachStage: "mastered")
    _ = shadeSurface()
    app.buttons["shade-review-actions"].tap()
    let tweaks = app.buttons["Tweaks"]
    XCTAssertTrue(tweaks.waitForExistence(timeout: 5))
    tweaks.tap()

    XCTAssertTrue(identified("shade-tweaks-sheet").waitForExistence(timeout: 5))
    XCTAssertTrue(identified("shade-tuning-practice-card").exists)
    identified("shade-tuning-preset-quick").tap()
    let apply = app.buttons["shade-tuning-apply"]
    XCTAssertTrue(apply.waitForExistence(timeout: 5))
    XCTAssertTrue(apply.isEnabled)
    apply.tap()
    XCTAssertFalse(apply.isEnabled)
  }

  func testBetaDiagnosticsDisclosureMakesPrivacyChoiceExplicit() throws {
    launch(scenario: "active", betaDiagnostics: "undecided")
    XCTAssertTrue(identified("shade-beta-diagnostics-disclosure").waitForExistence(timeout: 8))
    XCTAssertTrue(text(containing: "No titles, URLs, photos, auction notes").exists)
    let keepPrivate = app.buttons["shade-beta-diagnostics-private"]
    XCTAssertTrue(keepPrivate.waitForExistence(timeout: 3))
    keepPrivate.tap()
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 5))
  }

  func testVerticalScrollRevealsDeepDossierWithoutJudging() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    XCTAssertTrue(text(containing: "WHY THE AGENT PICKED IT").exists)
    app.swipeUp(velocity: .slow)
    app.swipeUp(velocity: .slow)
    XCTAssertTrue(text(containing: "VEHICLE").waitForExistence(timeout: 8))
    XCTAssertTrue(waitForFind(1, of: 3))
  }

  func testCoverTapOpensSeparatePhotoGallery() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    identified("shade-review-hero-ui-test-samurai").tap()
    XCTAssertTrue(text(containing: "PHOTO 1 OF 2").waitForExistence(timeout: 8))
    XCTAssertTrue(app.buttons["shade-gallery-close"].exists)
    app.swipeLeft()
    XCTAssertTrue(text(containing: "PHOTO 2 OF 2").waitForExistence(timeout: 5))
    app.buttons["shade-gallery-close"].tap()
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 5))
  }

  func testGalleryPreservesSelectedPhotoAcrossCloseAndReopen() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    identified("shade-review-hero-ui-test-samurai").tap()
    XCTAssertTrue(text(containing: "PHOTO 1 OF 2").waitForExistence(timeout: 8))
    app.swipeLeft()
    XCTAssertTrue(text(containing: "PHOTO 2 OF 2").waitForExistence(timeout: 5))
    app.buttons["shade-gallery-close"].tap()
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 5))
    identified("shade-review-hero-ui-test-samurai").tap()
    XCTAssertTrue(text(containing: "PHOTO 2 OF 2").waitForExistence(timeout: 8))
  }

  func testGalleryChromeCanHideAndReturnWithoutClosing() throws {
    launch(scenario: "active", galleryCoach: "mastered")
    _ = shadeSurface()
    identified("shade-review-hero-ui-test-samurai").tap()
    let photo = identified("shade-gallery-photo-0")
    XCTAssertTrue(photo.waitForExistence(timeout: 8))
    let close = app.buttons["shade-gallery-close"]
    XCTAssertTrue(close.waitForExistence(timeout: 5))
    XCTAssertFalse(text(containing: "Swipe up or down to close").exists)
    photo.tap()
    XCTAssertFalse(close.waitForExistence(timeout: 1))
    photo.tap()
    XCTAssertTrue(close.waitForExistence(timeout: 5))
  }

  func testPhotoGalleryDismissesWithDecisiveVerticalSwipes() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    identified("shade-review-hero-ui-test-samurai").tap()
    XCTAssertTrue(text(containing: "PHOTO 1 OF 2").waitForExistence(timeout: 8))
    XCTAssertTrue(text(containing: "Swipe up or down to close").exists)

    app.swipeDown(velocity: .fast)
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 5))

    identified("shade-review-hero-ui-test-samurai").tap()
    XCTAssertTrue(text(containing: "PHOTO 1 OF 2").waitForExistence(timeout: 8))
    app.swipeUp(velocity: .fast)
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 5))
  }

  func testMissingPhotoAndLocationRemainReviewable() throws {
    launch(scenario: "active")
    openList()
    app.buttons["shade-list-row-ui-test-wildcard"].tap()
    XCTAssertTrue(waitForFind(3, of: 3, timeout: 8))
    XCTAssertTrue(text(containing: "NO PHOTOS").exists)
    XCTAssertTrue(text(containing: "Location missing").exists)
  }

  // MARK: Horizontal judgments

  func testRightSwipeLikesAndAdvances() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    swipeReview(fromX: 0.28, toX: 0.72)
    XCTAssertTrue(text(containing: "Liked").waitForExistence(timeout: 8))
    XCTAssertTrue(text(containing: "Honda Trail").waitForExistence(timeout: 8))
  }

  func testFarRightSwipeLoves() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    swipeReview(fromX: 0.08, toX: 0.92)
    XCTAssertTrue(text(containing: "Loved").waitForExistence(timeout: 8))
  }

  func testLeftSwipePassesAndFarLeftAvoidsSimilar() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    swipeReview(fromX: 0.72, toX: 0.28)
    XCTAssertTrue(text(containing: "Passed").waitForExistence(timeout: 8))
    XCTAssertTrue(text(containing: "Honda Trail").waitForExistence(timeout: 8))
    swipeReview(fromX: 0.92, toX: 0.08)
    XCTAssertTrue(text(containing: "Never again").waitForExistence(timeout: 8))
  }

  func testFinalJudgmentShowsDailyCompletion() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    swipeReview(fromX: 0.28, toX: 0.72)
    XCTAssertTrue(text(containing: "Honda Trail").waitForExistence(timeout: 8))
    swipeReview(fromX: 0.28, toX: 0.72)
    XCTAssertTrue(text(containing: "Citicar").waitForExistence(timeout: 8))
    swipeReview(fromX: 0.28, toX: 0.72)
    XCTAssertTrue(identified("shade-completion").waitForExistence(timeout: 8))
    XCTAssertTrue(text(containing: "You’re caught up").exists)
    XCTAssertTrue(identified("shade-completion-open-list").exists)
  }

  func testUndoRestoresPassedListingToDefaultList() throws {
    launch(scenario: "active")
    _ = shadeSurface()
    swipeReview(fromX: 0.72, toX: 0.28)
    let undo = app.buttons["shade-undo-button"]
    XCTAssertTrue(undo.waitForExistence(timeout: 8))
    undo.tap()
    openList()
    XCTAssertTrue(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 5))
  }

  // MARK: Finds and operational states

  func testTodayFindsPreservesTitlesAndConsolidatesControls() throws {
    launch(scenario: "active")
    openList()
    XCTAssertTrue(text(containing: "Today's finds").exists)
    XCTAssertTrue(app.textFields["shade-list-search-field"].exists)
    XCTAssertTrue(app.buttons["shade-list-filter-menu"].exists)
    XCTAssertTrue(app.buttons["shade-list-sort-menu"].exists)
    XCTAssertTrue(text(containing: "1988 Suzuki Samurai").exists)
    XCTAssertTrue(text(containing: "1974 Citicar").exists)
  }

  func testListSearchAndFilterRemainUsable() throws {
    launch(scenario: "active")
    openList()
    let search = app.textFields["shade-list-search-field"]
    search.tap()
    search.typeText("Citicar")
    XCTAssertTrue(app.buttons["shade-list-row-ui-test-wildcard"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 1))
  }

  func testCompletedRunnerHealthRemainsAccessibleInList() throws {
    launch(scenario: "active")
    openList()
    let health = identified("source-health-badge-carsbids")
    XCTAssertTrue(health.waitForExistence(timeout: 8))
    XCTAssertTrue(health.label.contains("1 imported"), "Unexpected health label: \(health.label)")
  }

  func testStatusStatesCollapseIntoOnePrioritizedNotice() throws {
    launch(scenario: "status")
    let status = identified("shade-status-banner")
    XCTAssertTrue(status.waitForExistence(timeout: 15))
    XCTAssertTrue(status.label.contains("Sync issue"))
    XCTAssertTrue(status.label.contains("saved copy"))
    XCTAssertTrue(status.label.contains("1 note queued"))
  }

  func testLoadFailureHasOneSituationAwareExplanation() throws {
    launch(scenario: "empty-error")
    XCTAssertTrue(text(containing: "Couldn’t load today’s finds").waitForExistence(timeout: 15))
    XCTAssertFalse(text(containing: "No run yet").exists)
    XCTAssertTrue(app.buttons["Refresh"].exists)
  }

  // MARK: Helpers

  private func text(containing value: String) -> XCUIElement {
    app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS[c] %@", value))
      .firstMatch
  }

  private func inviteCodeField() -> XCUIElement {
    let identified = app.textFields["invite-code-field"]
    return identified.exists ? identified : app.textFields["Invite code"]
  }

  private func acceptInviteButton() -> XCUIElement {
    let identified = app.buttons["accept-invite-button"]
    return identified.exists ? identified : app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Accept invite")).firstMatch
  }

  private func continueOnboarding() {
    let button = app.buttons["onboarding-continue-button"]
    XCTAssertTrue(button.waitForExistence(timeout: 5))
    button.tap()
  }

  private func shadeSurface() -> XCUIElement {
    XCTAssertTrue(waitForFind(1, of: 3, timeout: 15))
    let surface = identified("shade-review-page")
    return surface.exists ? surface : app.windows.firstMatch
  }

  private func waitForFind(_ index: Int, of total: Int, timeout: TimeInterval = 2) -> Bool {
    let counter = identified("shade-find-counter")
    guard counter.waitForExistence(timeout: timeout) else { return false }
    return counter.label.localizedCaseInsensitiveContains("\(index) of \(total)")
  }

  private func openList() {
    XCTAssertTrue(identified("shade-find-counter").waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()
    XCTAssertTrue(text(containing: "Today's finds").waitForExistence(timeout: 8))
  }

  private func swipeReview(fromX: CGFloat, toX: CGFloat) {
    let page = identified("shade-review-page")
    let surface = page.exists ? page : app.windows.firstMatch
    let start = surface.coordinate(withNormalizedOffset: CGVector(dx: fromX, dy: 0.36))
    let end = surface.coordinate(withNormalizedOffset: CGVector(dx: toX, dy: 0.36))
    start.press(forDuration: 0.18, thenDragTo: end)
  }

  private func identified(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func launch(
    scenario: String? = nil,
    coachStage: String? = nil,
    galleryCoach: String? = nil,
    betaDiagnostics: String? = nil
  ) {
    app = XCUIApplication()
    app.launchArguments = ["--ui-testing"]
    if let scenario { app.launchArguments += ["--ui-testing-scenario", scenario] }
    if let coachStage { app.launchArguments += ["--coach-stage", coachStage] }
    if let galleryCoach { app.launchArguments += ["--gallery-coach", galleryCoach] }
    if let betaDiagnostics { app.launchArguments += ["--beta-diagnostics", betaDiagnostics] }
    app.launch()
  }
}
