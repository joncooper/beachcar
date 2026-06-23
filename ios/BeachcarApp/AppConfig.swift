import Foundation

enum AppConfig {
  static let appName = "Beachcar"
  static let allowedEmail = "jon.cooper@gmail.com"
  static let auctionBaseURL = URL(string: "https://beach-car-watch.jon-cooper.workers.dev")!
  static let clerkPublishableKey = "pk_test_YnJpZWYtY295b3RlLTQ3LmNsZXJrLmFjY291bnRzLmRldiQ"
  static let clerkCallbackURLScheme = "com.joncooper.beachcar"
  static let clerkRedirectURL = "\(clerkCallbackURLScheme)://callback"
}
