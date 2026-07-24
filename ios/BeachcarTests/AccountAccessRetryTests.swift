import XCTest
@testable import Beachcar

@MainActor
final class AccountAccessRetryTests: XCTestCase {
  func testRetriesTokenReadinessUntilAccessCheckSucceeds() async throws {
    var attempts = 0
    var slept: [Duration] = []

    let value = try await AccountAccessRetryPolicy.run(
      delays: [.milliseconds(10), .milliseconds(20)],
      sleep: { slept.append($0) }
    ) {
      attempts += 1
      if attempts < 3 {
        throw AccountAccessError.tokenNotReady
      }
      return "active"
    }

    XCTAssertEqual(value, "active")
    XCTAssertEqual(attempts, 3)
    XCTAssertEqual(slept, [.milliseconds(10), .milliseconds(20)])
  }

  func testRetriesTransientAuthenticationResponse() async throws {
    var attempts = 0

    let value = try await AccountAccessRetryPolicy.run(
      delays: [.milliseconds(10)],
      sleep: { _ in }
    ) {
      attempts += 1
      if attempts == 1 {
        throw APIError.http(status: 403, message: "Token is not ready")
      }
      return "active"
    }

    XCTAssertEqual(value, "active")
    XCTAssertEqual(attempts, 2)
  }

  func testDoesNotRetryDefinitiveClientError() async {
    var attempts = 0
    var sleepCount = 0

    do {
      let _: String = try await AccountAccessRetryPolicy.run(
        delays: [.milliseconds(10)],
        sleep: { _ in sleepCount += 1 }
      ) {
        attempts += 1
        throw APIError.http(status: 400, message: "Bad request")
      }
      XCTFail("Expected the access check to fail")
    } catch {
      XCTAssertEqual(attempts, 1)
      XCTAssertEqual(sleepCount, 0)
    }
  }
}
