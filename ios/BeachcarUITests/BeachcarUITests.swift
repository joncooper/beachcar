import XCTest

final class BeachcarUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    launch()
  }

  override func tearDownWithError() throws {
    app = nil
  }

  // MARK: Access gates (unchanged surfaces)

  func testInvitedUserSeesInviteGate() throws {
    launch(scenario: "invited")

    XCTAssertTrue(app.otherElements["invite-gate"].waitForExistence(timeout: 15))
    XCTAssertTrue(text(containing: "Invite required").exists)
    XCTAssertTrue(app.textFields["invite-code-field"].exists)
    XCTAssertTrue(app.buttons["accept-invite-button"].exists)
  }

  func testInviteAcceptanceMovesToOnboardingFixture() throws {
    launch(scenario: "invited")

    let field = app.textFields["invite-code-field"]
    XCTAssertTrue(field.waitForExistence(timeout: 15))
    field.tap()
    field.typeText("test-invite")
    app.buttons["accept-invite-button"].tap()

    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 10))
    XCTAssertTrue(text(containing: "Preferences").exists)
  }

  func testOnboardingSaveEntersShadeFeed() throws {
    launch(scenario: "onboarding")

    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 15))
    app.buttons["save-preferences-button"].tap()

    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 10))
    XCTAssertTrue(app.otherElements["shade-surface"].exists)
  }

  // MARK: Shade feed

  func testActiveUserEntersShadeFeed() throws {
    launch(scenario: "active")

    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 15))
    XCTAssertTrue(app.otherElements["shade-surface"].exists)
    XCTAssertTrue(app.buttons["shade-list-button"].exists)
  }

  func testListButtonOpensFindsAndFilters() throws {
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()

    XCTAssertTrue(app.otherElements["shade-list-overlay"].waitForExistence(timeout: 10))
    XCTAssertTrue(text(containing: "Today's finds").exists)

    // Family filter keeps the Samurai (family lane) visible.
    app.buttons["shade-filter-Family"].tap()
    XCTAssertTrue(app.buttons["shade-list-row-ui-test-samurai"].waitForExistence(timeout: 10))
  }

  func testListRowJumpsToCar() throws {
    XCTAssertTrue(app.buttons["shade-list-button"].waitForExistence(timeout: 15))
    app.buttons["shade-list-button"].tap()

    let row = app.buttons["shade-list-row-ui-test-wildcard"]
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.tap()

    // Jumping selects the Citicar and dismisses the list.
    XCTAssertTrue(text(containing: "Citicar").waitForExistence(timeout: 10))
  }

  func testCenterTapOpensDossier() throws {
    let surface = app.otherElements["shade-surface"]
    XCTAssertTrue(surface.waitForExistence(timeout: 15))

    surface.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

    XCTAssertTrue(text(containing: "FULL DOSSIER").waitForExistence(timeout: 12))
    XCTAssertTrue(text(containing: "MARKET READ").exists)
  }

  func testShadePullDownJudgesLike() throws {
    let surface = app.otherElements["shade-surface"]
    XCTAssertTrue(surface.waitForExistence(timeout: 15))

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
