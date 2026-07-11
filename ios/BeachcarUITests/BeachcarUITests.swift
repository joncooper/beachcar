import XCTest

final class BeachcarUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = nil
  }

  override func tearDownWithError() throws {
    app = nil
  }

  // MARK: Access gates (unchanged surfaces)

  func testInvitedUserSeesInviteGate() throws {
    launch(scenario: "invited")

    XCTAssertTrue(text(containing: "Invite required").waitForExistence(timeout: 15))
    XCTAssertTrue(inviteCodeField().exists)
    XCTAssertTrue(acceptInviteButton().exists)
  }

  func testInviteAcceptanceMovesToOnboardingFixture() throws {
    launch(scenario: "invited")

    let field = inviteCodeField()
    XCTAssertTrue(field.waitForExistence(timeout: 15))
    field.tap()
    field.typeText("test-invite")
    acceptInviteButton().tap()

    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 10))
    XCTAssertTrue(text(containing: "Preferences").exists)
  }

  func testOnboardingSaveEntersShadeFeed() throws {
    launch(scenario: "onboarding")

    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.switches["Hemmings"].exists)
    app.buttons["save-preferences-button"].tap()

    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["shade-list-button"].exists)
  }

  // MARK: Shade feed

  func testActiveUserEntersShadeFeed() throws {
    launch(scenario: "active")

    _ = shadeSurface()
  }

  func testKnownAndMissingLocationAndNoImageStatesRemainReviewable() throws {
    launch(scenario: "active")

    XCTAssertTrue(identified("shade-location-known-ui-test-samurai").waitForExistence(timeout: 15))
    XCTAssertTrue(identified("shade-no-image-ui-test-samurai").waitForExistence(timeout: 10))

    app.buttons["shade-list-button"].tap()
    let missingRow = app.buttons["shade-list-row-ui-test-wildcard"]
    XCTAssertTrue(missingRow.waitForExistence(timeout: 10))
    missingRow.tap()

    XCTAssertTrue(identified("shade-location-missing-ui-test-wildcard").waitForExistence(timeout: 10))
    XCTAssertTrue(text(containing: "Location missing").waitForExistence(timeout: 5))
    XCTAssertTrue(identified("shade-no-image-ui-test-wildcard").waitForExistence(timeout: 5))
  }

  func testCompletedRunnerHealthOverridesEarlierBlockedCheck() throws {
    launch(scenario: "active")
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()

    let health = identified("source-health-badge-carsandbids")
    XCTAssertTrue(health.waitForExistence(timeout: 10))
    XCTAssertTrue(health.label.contains("1 imported"), "Unexpected source-health label: \(health.label)")
  }

  func testShadeReportsCachedErrorAndQueuedNoteStates() throws {
    launch(scenario: "status")

    XCTAssertTrue(identified("shade-cached-banner").waitForExistence(timeout: 15))
    XCTAssertTrue(identified("shade-error-banner").waitForExistence(timeout: 10))
    XCTAssertTrue(identified("shade-queued-notes-banner").waitForExistence(timeout: 10))
  }

  func testShadeReportsLoadErrorWithoutACachedRun() throws {
    launch(scenario: "empty-error")

    XCTAssertTrue(identified("shade-error-banner").waitForExistence(timeout: 15))
    XCTAssertTrue(text(containing: "No run yet").waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Refresh"].exists)
  }

  func testListButtonOpensFindsAndFilters() throws {
    launch(scenario: "active")
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()

    XCTAssertTrue(text(containing: "Today's finds").waitForExistence(timeout: 10))
    XCTAssertTrue(app.textFields["shade-list-search-field"].exists)
    XCTAssertTrue(app.buttons["shade-list-source-menu"].exists)
    XCTAssertTrue(app.buttons["shade-list-sort-menu"].exists)
    XCTAssertTrue(app.buttons["shade-list-show-hidden"].exists)

    // Family filter keeps the Samurai (family lane) visible.
    app.buttons["shade-filter-Family"].tap()
    XCTAssertTrue(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 10))
  }

  func testListSearchNarrowsFinds() throws {
    launch(scenario: "active")
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()

    let search = app.textFields["shade-list-search-field"]
    XCTAssertTrue(search.waitForExistence(timeout: 10))
    search.tap()
    search.typeText("Citicar")

    XCTAssertTrue(app.buttons["shade-list-row-ui-test-wildcard"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 1))
  }

  func testShowHiddenRestoresHiddenListingInList() throws {
    launch(scenario: "active")
    let surface = shadeSurface()

    surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    let hide = app.buttons["shade-dossier-action-hide"]
    XCTAssertTrue(hide.waitForExistence(timeout: 12))
    hide.tap()

    XCTAssertTrue(text(containing: "Honda Trail").waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 10))
    app.buttons["shade-list-button"].tap()

    XCTAssertFalse(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 1))
    app.buttons["shade-list-show-hidden"].tap()
    XCTAssertTrue(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 5))
  }

  func testListRowJumpsToCar() throws {
    launch(scenario: "active")
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()

    let row = app.buttons["shade-list-row-ui-test-wildcard"]
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()

    // Jumping selects the Citicar and dismisses the list.
    XCTAssertTrue(text(containing: "Citicar").waitForExistence(timeout: 10))
  }

  func testCenterTapOpensDossier() throws {
    launch(scenario: "active")
    let surface = shadeSurface()

    surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

    XCTAssertTrue(text(containing: "FULL DOSSIER").waitForExistence(timeout: 12))
    XCTAssertTrue(text(containing: "MARKET READ").exists)
    XCTAssertTrue(identified("source-health-badge-bringatrailer").waitForExistence(timeout: 5))
    XCTAssertTrue(identified("shade-dossier-no-image-ui-test-samurai").waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["shade-dossier-close"].exists)
    XCTAssertTrue(elementExists("shade-dossier-open-listing"))
    XCTAssertTrue(app.buttons["shade-dossier-action-hide"].exists)
    XCTAssertTrue(app.buttons["shade-dossier-action-avoid"].exists)
    XCTAssertTrue(app.buttons["shade-dossier-action-like"].exists)
    XCTAssertTrue(app.buttons["shade-dossier-action-star"].exists)
  }

  func testDossierCloseButtonClosesToFeed() throws {
    launch(scenario: "active")
    let surface = shadeSurface()

    surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    let dossier = text(containing: "FULL DOSSIER")
    XCTAssertTrue(dossier.waitForExistence(timeout: 12))

    app.buttons["shade-dossier-close"].tap()

    XCTAssertTrue(dossier.waitForNonExistence(timeout: 5))
    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 5))
  }

  func testDossierThrowClosesToFeed() throws {
    launch(scenario: "active")
    let surface = shadeSurface()

    surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

    let title = text(containing: "FULL DOSSIER")
    XCTAssertTrue(title.waitForExistence(timeout: 12))

    let window = app.windows.firstMatch
    let start = window.coordinate(withNormalizedOffset: CGVector(dx: 0.52, dy: 0.16))
    let end = window.coordinate(withNormalizedOffset: CGVector(dx: 0.13, dy: 0.04))
    start.press(forDuration: 0.05, thenDragTo: end)

    XCTAssertTrue(title.waitForNonExistence(timeout: 5))
    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 5))
  }

  func testShadePullDownJudgesLike() throws {
    launch(scenario: "active")
    let surface = shadeSurface()

    // Pull down within the photo zone, ending in the "Like" column (3rd of 4),
    // far enough to cross the commit threshold.
    let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.16))
    let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.62, dy: 0.46))
    start.press(forDuration: 0.05, thenDragTo: end)

    XCTAssertTrue(app.staticTexts["Liked"].waitForExistence(timeout: 10))
  }

  func testUndoRestoresAHiddenListing() throws {
    launch(scenario: "active")
    let surface = shadeSurface()

    surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    let hide = app.buttons["shade-dossier-action-hide"]
    XCTAssertTrue(hide.waitForExistence(timeout: 12))
    hide.tap()

    XCTAssertTrue(text(containing: "Honda Trail").waitForExistence(timeout: 5))
    XCTAssertTrue(identified("shade-undo-message").waitForExistence(timeout: 5))
    let undo = app.buttons["shade-undo-button"]
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    undo.tap()

    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 5))
    XCTAssertTrue(identified("shade-undo-message").waitForNonExistence(timeout: 5))
  }

  // MARK: helpers

  private func text(containing value: String) -> XCUIElement {
    app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
  }

  private func inviteCodeField() -> XCUIElement {
    let identified = app.textFields["invite-code-field"]
    return identified.exists ? identified : app.textFields["Invite code"]
  }

  private func acceptInviteButton() -> XCUIElement {
    let identified = app.buttons["accept-invite-button"]
    if identified.exists { return identified }
    return app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Accept invite")).firstMatch
  }

  private func shadeSurface() -> XCUIElement {
    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 15))
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 10))
    let identifiedSurface = app.otherElements["shade-surface"]
    return identifiedSurface.exists ? identifiedSurface : app.windows.firstMatch
  }

  private func elementExists(_ identifier: String) -> Bool {
    app.buttons[identifier].exists
      || app.links[identifier].exists
      || app.otherElements[identifier].exists
      || app.staticTexts[identifier].exists
      || app.images[identifier].exists
      || app.textFields[identifier].exists
  }

  private func identified(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  private func launch(scenario: String? = nil) {
    if app != nil {
      app.terminate()
    }
    app = XCUIApplication()
    app.launchArguments = ["--ui-testing"]
    if let scenario {
      app.launchArguments += ["--ui-testing-scenario", scenario]
    }
    app.launch()
  }
}
