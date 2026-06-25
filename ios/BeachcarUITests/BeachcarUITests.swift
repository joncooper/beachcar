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

  func testTapLowerCardShowsDetails() throws {
    let card = app.buttons["listing-card-body"].firstMatch
    XCTAssertTrue(card.waitForExistence(timeout: 4))

    card.tap()

    XCTAssertTrue(text(containing: "Market read").waitForExistence(timeout: 2))
  }

  func testInvitedUserSeesInviteGate() throws {
    launch(scenario: "invited")

    XCTAssertTrue(app.otherElements["invite-gate"].waitForExistence(timeout: 4))
    XCTAssertTrue(text(containing: "Invite required").exists)
    XCTAssertTrue(app.textFields["invite-code-field"].exists)
    XCTAssertTrue(app.buttons["accept-invite-button"].exists)
  }

  func testInviteAcceptanceMovesToOnboardingFixture() throws {
    launch(scenario: "invited")

    let field = app.textFields["invite-code-field"]
    XCTAssertTrue(field.waitForExistence(timeout: 4))
    field.tap()
    field.typeText("test-invite")
    app.buttons["accept-invite-button"].tap()

    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 2))
    XCTAssertTrue(text(containing: "Preferences").exists)
  }

  func testOnboardingSaveEntersDeckFixture() throws {
    launch(scenario: "onboarding")

    XCTAssertTrue(app.scrollViews["onboarding-view"].waitForExistence(timeout: 4))
    app.buttons["save-preferences-button"].tap()

    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["mode-list"].exists)
  }

  func testActiveUserEntersDeckFixture() throws {
    launch(scenario: "active")

    XCTAssertTrue(text(containing: "Suzuki Samurai").waitForExistence(timeout: 4))
    XCTAssertTrue(app.otherElements["run-status-banner"].exists)
    XCTAssertTrue(text(containing: "Latest run published").exists)
    XCTAssertTrue(app.buttons["filter-button"].exists)
  }

  func testFilterSoloShowsSoloFixture() throws {
    XCTAssertTrue(app.buttons["filter-button"].waitForExistence(timeout: 4))
    app.buttons["filter-button"].tap()

    let solo = app.buttons["filter-solo"]
    XCTAssertTrue(solo.waitForExistence(timeout: 2))
    solo.tap()
    app.buttons["filters-done"].tap()

    let title = text(containing: "Honda Trail 90")
    XCTAssertTrue(title.waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["filter-summary"].label.contains("1 card"))
  }

  func testListModeOpensDetails() throws {
    XCTAssertTrue(app.buttons["mode-list"].waitForExistence(timeout: 4))
    app.buttons["mode-list"].tap()

    XCTAssertTrue(app.scrollViews["list-mode-view"].waitForExistence(timeout: 2))
    let row = app.buttons["list-row-ui-test-samurai"]
    XCTAssertTrue(row.waitForExistence(timeout: 2))
    row.tap()

    XCTAssertTrue(text(containing: "Market read").waitForExistence(timeout: 2))
    XCTAssertTrue(text(containing: "Back of card").waitForExistence(timeout: 2))
  }

  func testNormalRightSwipeSavesFeedbackAndAdvances() throws {
    let firstTitle = text(containing: "Suzuki Samurai")
    XCTAssertTrue(firstTitle.waitForExistence(timeout: 4))

    let start = firstTitle.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.50))
    let end = firstTitle.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.50))
    start.press(forDuration: 0.06, thenDragTo: end)

    XCTAssertTrue(app.staticTexts["Saved feedback"].waitForExistence(timeout: 2))
    let nextTitle = text(containing: "Honda Trail 90")
    XCTAssertTrue(nextTitle.waitForExistence(timeout: 2))
  }

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
