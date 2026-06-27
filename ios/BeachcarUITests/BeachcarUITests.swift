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
    app.buttons["save-preferences-button"].tap()

    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["shade-list-button"].exists)
  }

  // MARK: Shade feed

  func testActiveUserEntersShadeFeed() throws {
    launch(scenario: "active")

    _ = shadeSurface()
  }

  func testListButtonOpensFindsAndFilters() throws {
    launch(scenario: "active")
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()

    XCTAssertTrue(text(containing: "Today's finds").waitForExistence(timeout: 10))

    // Family filter keeps the Samurai (family lane) visible.
    app.buttons["shade-filter-Family"].tap()
    XCTAssertTrue(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 10))
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
