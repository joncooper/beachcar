import Foundation

enum AppConfig {
  static let appName = "Beachcar"
  static let allowedEmail = "jon.cooper@gmail.com"
  static let auctionBaseURL = URL(string: "https://beachcar-watch.jon-cooper.workers.dev")!
  static let clerkPublishableKey = "pk_test_YnJpZWYtY295b3RlLTQ3LmNsZXJrLmFjY291bnRzLmRldiQ"
  static let clerkCallbackURLScheme = "com.joncooper.beachcar"
  static let clerkRedirectURL = "\(clerkCallbackURLScheme)://callback"

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
