import ClerkKit
import SwiftUI

@main
struct BeachcarApp: App {
  init() {
    Clerk.configure(
      publishableKey: AppConfig.clerkPublishableKey,
      options: .init(
        redirectConfig: .init(
          redirectUrl: AppConfig.clerkRedirectURL,
          callbackUrlScheme: AppConfig.clerkCallbackURLScheme
        )
      )
    )
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(Clerk.shared)
    }
  }
}
