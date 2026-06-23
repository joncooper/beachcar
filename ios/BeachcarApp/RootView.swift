import ClerkKit
import ClerkKitUI
import SwiftUI

struct RootView: View {
  @Environment(Clerk.self) private var clerk
  @StateObject private var store: BeachcarStore
  @State private var authIsPresented = false
  private let isUITesting: Bool
  #if DEBUG
  @State private var didAttemptLaunchTicket = false
  #endif

  init() {
    let isUITesting = ProcessInfo.processInfo.arguments.contains("--ui-testing")
    self.isUITesting = isUITesting
    _store = StateObject(wrappedValue: isUITesting ? BeachcarStore.uiTesting() : BeachcarStore())
  }

  var body: some View {
    ZStack {
      BeachcarColors.shell.ignoresSafeArea()
      if clerk.user == nil && !isUITesting {
        signedOutView
      } else {
        BeachcarDeckView(store: store, tokenProvider: token)
          .task {
            if !isUITesting {
              await store.load(tokenProvider: token)
            }
          }
      }
    }
    .prefetchClerkImages()
    .sheet(isPresented: $authIsPresented) {
      AuthView()
        .presentationDragIndicator(.visible)
    }
    #if DEBUG
    .task {
      await signInWithLaunchTicketIfPresent()
    }
    #endif
  }

  private var signedOutView: some View {
    VStack(spacing: 20) {
      Spacer()
      VStack(alignment: .leading, spacing: 14) {
        Text("PRIVATE AUCTION WATCH")
          .font(.caption.weight(.bold))
          .tracking(1.6)
          .foregroundStyle(BeachcarColors.muted)
        Text(AppConfig.appName)
          .font(.system(size: 48, weight: .black, design: .rounded))
          .foregroundStyle(BeachcarColors.ink)
        Text("Review today's beach-car shortlist, save taste signals, and send steering notes back into the next daily run.")
          .font(.body)
          .foregroundStyle(BeachcarColors.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(24)
      .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
          .stroke(.white.opacity(0.65), lineWidth: 1)
      }
      .shadow(color: .black.opacity(0.08), radius: 24, y: 16)

      UserButton(signedOutContent: {
        Button {
          authIsPresented = true
        } label: {
          HStack(spacing: 10) {
            Image(systemName: "person.crop.circle.badge.checkmark")
            Text("Sign in")
          }
          .font(.headline)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 16)
          .background(BeachcarColors.ink, in: Capsule())
          .foregroundStyle(.white)
        }
      })
      Spacer()
    }
    .padding(20)
  }

  private func token() async throws -> String? {
    if isUITesting {
      return nil
    }
    return try await clerk.session?.getToken()
  }

  #if DEBUG
  private func signInWithLaunchTicketIfPresent() async {
    guard !didAttemptLaunchTicket else { return }
    didAttemptLaunchTicket = true
    guard clerk.user == nil, let ticket = launchTicket else { return }
    do {
      let signIn = try await clerk.auth.signInWithTicket(ticket)
      if let sessionId = signIn.createdSessionId {
        try await clerk.auth.setActive(sessionId: sessionId)
      }
    } catch {
      // Keep the normal signed-out UI available if the local test ticket is missing or expired.
    }
  }

  private var launchTicket: String? {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "--clerk-ticket") else { return nil }
    let valueIndex = arguments.index(after: index)
    guard arguments.indices.contains(valueIndex) else { return nil }
    let value = arguments[valueIndex].trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }
  #endif
}
