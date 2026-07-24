import Foundation

enum AccountAccessError: LocalizedError {
  case tokenNotReady

  var errorDescription: String? {
    switch self {
    case .tokenNotReady:
      "Beachcar is still finishing your sign-in. Please try again."
    }
  }
}

enum AccountAccessRetryPolicy {
  static let standardDelays: [Duration] = [
    .milliseconds(250),
    .milliseconds(750),
    .milliseconds(1_500),
  ]

  @MainActor
  static func run<Value>(
    delays: [Duration] = standardDelays,
    sleep: (Duration) async throws -> Void = { delay in
      try await Task<Never, Never>.sleep(for: delay)
    },
    operation: () async throws -> Value
  ) async throws -> Value {
    var delayIterator = delays.makeIterator()

    while true {
      do {
        return try await operation()
      } catch {
        guard shouldRetry(error), let delay = delayIterator.next() else {
          throw error
        }
        try Task.checkCancellation()
        try await sleep(delay)
      }
    }
  }

  static func shouldRetry(_ error: Error) -> Bool {
    if error is AccountAccessError {
      return true
    }

    if let apiError = error as? APIError {
      switch apiError {
      case let .http(status, _):
        return status == 401 || status == 403 || status == 408 || status == 429 || status >= 500
      case .transport:
        return true
      }
    }

    let urlError = error as NSError
    guard urlError.domain == NSURLErrorDomain else { return false }
    return [
      NSURLErrorTimedOut,
      NSURLErrorCannotFindHost,
      NSURLErrorCannotConnectToHost,
      NSURLErrorNetworkConnectionLost,
      NSURLErrorDNSLookupFailed,
      NSURLErrorNotConnectedToInternet,
      NSURLErrorInternationalRoamingOff,
      NSURLErrorCallIsActive,
      NSURLErrorDataNotAllowed,
      NSURLErrorRequestBodyStreamExhausted,
    ].contains(urlError.code)
  }
}
