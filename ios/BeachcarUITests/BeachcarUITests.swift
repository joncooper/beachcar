import XCTest

final class BeachcarUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments = ["--ui-testing"]
    app.launch()
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
}
