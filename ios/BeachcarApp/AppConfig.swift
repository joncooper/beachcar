import Foundation

enum AppConfig {
  static let appName = "Beachcar"
  static let auctionBaseURL = URL(string: "https://beachcar-watch.jon-cooper.workers.dev")!
  // Personal beta: every build shares the same Clerk development instance as
  // the Beachcar website and Worker. This avoids a separate custom auth domain.
  static let clerkPublishableKey = "pk_test_YnJpZWYtY295b3RlLTQ3LmNsZXJrLmFjY291bnRzLmRldiQ"
  static let clerkCallbackURLScheme = "com.joncooper.beachcar"
  static let clerkRedirectURL = "\(clerkCallbackURLScheme)://callback"
  static let todayURL = URL(string: "https://beachcar-watch.jon-cooper.workers.dev/today")!

  static var isBetaBuild: Bool {
    #if DEBUG
    true
    #else
    Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    #endif
  }

  static var appBuildLabel: String {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
    return "\(version) (\(build))"
  }
}
