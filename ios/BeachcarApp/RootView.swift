import ClerkKit
import ClerkKitUI
import SwiftUI
import UIKit

struct RootView: View {
  @Environment(Clerk.self) private var clerk
  @StateObject private var store: BeachcarStore
  @State private var authIsPresented = false
  @State private var user: UserPayload?
  @State private var accountIsLoading = false
  @State private var accountError: String?
  @State private var inviteCode = ""
  @State private var desktopCodexHandoffIsPresentedForTesting: Bool
  @AppStorage("beachcar.desktopCodexHandoffPending") private var desktopCodexHandoffPending = false
  private let isUITesting: Bool
  private let showsSignedOutViewForTesting: Bool
  #if DEBUG
  @State private var didAttemptLaunchTicket = false
  #endif

  init() {
    let arguments = ProcessInfo.processInfo.arguments
    let isUITesting = arguments.contains("--ui-testing")
    let scenario = arguments.firstIndex(of: "--ui-testing-scenario").flatMap { index in
      let valueIndex = arguments.index(after: index)
      return arguments.indices.contains(valueIndex) ? arguments[valueIndex] : nil
    }
    self.isUITesting = isUITesting
    self.showsSignedOutViewForTesting = isUITesting && scenario == "signed-out"
    _store = StateObject(wrappedValue: isUITesting ? BeachcarStore.uiTesting() : BeachcarStore())
    _user = State(initialValue: isUITesting ? Self.uiTestingUser() : nil)
    _desktopCodexHandoffIsPresentedForTesting = State(
      initialValue: isUITesting && scenario == "desktop-handoff"
    )
  }

  var body: some View {
    ZStack {
      BeachcarColors.shell.ignoresSafeArea()
      if showsSignedOutViewForTesting || (clerk.user == nil && !isUITesting) {
        signedOutView
      } else {
        signedInView
      }
    }
    .prefetchClerkImages()
    .sheet(isPresented: $authIsPresented) {
      AuthView()
        .environment(\.clerkTheme, .beachcar)
        .preferredColorScheme(.dark)
        .presentationDragIndicator(.visible)
    }
    .onOpenURL { url in
      guard url.host == AppConfig.todayURL.host, url.path == "/today" else { return }
      if user?.status == .active {
        Task { await store.load(tokenProvider: token, cacheScope: user?.id) }
      }
    }
    #if DEBUG
    .task {
      await signInWithLaunchTicketIfPresent()
    }
    #endif
  }

  private var signedOutView: some View {
    VStack(spacing: 22) {
      Spacer()
      VStack(alignment: .leading, spacing: 14) {
        Image("BeachcarSurrey")
          .resizable()
          .scaledToFit()
          .frame(maxWidth: .infinity)
          .frame(height: 190)
          .padding(.horizontal, 4)
          .background(
            Capsule()
              .fill(BC.brandPink.opacity(0.12))
              .frame(height: 62)
              .offset(y: 48)
          )
          .accessibilityHidden(true)
        HStack(spacing: 8) {
          Circle().fill(BC.brandPink).frame(width: 7, height: 7)
          Text("FOUND BY BEACHCAR · BOUGHT FOR REAL")
        }
          .font(.caption.weight(.bold))
          .tracking(1.6)
          .foregroundStyle(BC.brandPink)
        Text(AppConfig.appName)
          .font(.archivo(48, .black))
          .foregroundStyle(BC.white)
        Text("A private Codex-powered auction scout that learns your taste. It found this pink 1960 Willys Surrey—and its owner bought it.")
          .font(.archivo(15))
          .foregroundStyle(BeachcarColors.secondary)
          .lineSpacing(3)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(24)
      .background(BC.card, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
          .stroke(BC.border, lineWidth: 1)
      }
      .shadow(color: .black.opacity(0.5), radius: 24, y: 16)
      .accessibilityIdentifier("signed-out-brand-card")

      HStack(spacing: 8) {
        signedOutFeature("sparkles", "Curated")
        signedOutFeature("chart.line.uptrend.xyaxis", "Value read")
        signedOutFeature("hand.thumbsup.fill", "Learns taste")
      }

      if showsSignedOutViewForTesting {
        Button(action: {}) {
          signedOutSignInLabel
        }
      } else {
        UserButton(signedOutContent: {
          Button {
            authIsPresented = true
          } label: {
            signedOutSignInLabel
          }
        })
      }
      Spacer()
    }
    .padding(20)
    .onAppear {
      user = nil
      accountError = nil
    }
  }

  private var signedOutSignInLabel: some View {
    HStack(spacing: 10) {
      Image(systemName: "person.crop.circle.badge.checkmark")
      Text("Sign in")
    }
    .font(.archivo(16, .bold))
    .frame(maxWidth: .infinity)
    .padding(.vertical, 16)
    .background(BC.accent, in: Capsule())
    .foregroundStyle(BC.accentInk)
  }

  private func signedOutFeature(_ icon: String, _ label: String) -> some View {
    VStack(spacing: 7) {
      Image(systemName: icon).foregroundStyle(BC.accent)
      Text(label).font(.mono(9.5, bold: true)).foregroundStyle(BC.sub)
    }
    .frame(maxWidth: .infinity, minHeight: 66)
    .background(BC.faint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(BC.border, lineWidth: 1))
  }

  @ViewBuilder
  private var signedInView: some View {
    if let user {
      switch user.status {
      case .disabled:
        DisabledAccountView(email: user.email, error: accountError)
      case .invited:
        InviteGateView(
          email: user.email,
          inviteCode: $inviteCode,
          isSaving: accountIsLoading,
          error: accountError,
          onAccept: {
            Task {
              await acceptInvite()
            }
          },
          onSignOut: {
            Task { await signOut() }
          }
        )
      case .active:
        if user.onboardingCompleted {
          if shouldShowDesktopCodexHandoff {
            DesktopCodexHandoffView(email: user.email) {
              dismissDesktopCodexHandoff()
            }
          } else {
            deckView
          }
        } else {
          FriendOnboardingView(
            user: user,
            isSaving: accountIsLoading,
            error: accountError,
            onSave: { input in
              Task {
                await completeExternalOnboarding(input)
              }
            }
          )
        }
      }
    } else if let accountError {
      AccountRetryView(error: accountError) {
        Task {
          await refreshAccount()
        }
      }
    } else {
      AccountLoadingView()
        .task {
          await loadAccountIfNeeded()
        }
    }
  }

  private var deckView: some View {
    ShadeSurface(store: store, tokenProvider: token, cacheScope: user?.id)
      .accessibilityIdentifier("deck-view")
      .task {
        if !isUITesting {
          await store.load(tokenProvider: token, cacheScope: user?.id)
        }
      }
  }

  private var shouldShowDesktopCodexHandoff: Bool {
    isUITesting ? desktopCodexHandoffIsPresentedForTesting : desktopCodexHandoffPending
  }

  private func dismissDesktopCodexHandoff() {
    if isUITesting {
      desktopCodexHandoffIsPresentedForTesting = false
    } else {
      desktopCodexHandoffPending = false
    }
  }

  private func loadAccountIfNeeded() async {
    guard user == nil, !accountIsLoading else { return }
    await refreshAccount()
  }

  private func refreshAccount() async {
    accountIsLoading = true
    defer { accountIsLoading = false }
    do {
      user = try await AccountAccessRetryPolicy.run {
        let authToken = try await token()
        return try await store.api.me(authToken: authToken)
      }
      accountError = nil
    } catch {
      guard !Self.isCancellation(error) else {
        accountError = nil
        return
      }
      accountError = error.localizedDescription
    }
  }

  private func acceptInvite() async {
    let code = inviteCode.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !code.isEmpty else {
      accountError = "Invite code is required"
      return
    }
    if isUITesting {
      user = .uiTestingNeedsOnboarding
      inviteCode = ""
      accountError = nil
      return
    }
    accountIsLoading = true
    defer { accountIsLoading = false }
    do {
      let token = try await token()
      user = try await store.api.acceptInvite(code: code, authToken: token)
      inviteCode = ""
      accountError = nil
    } catch {
      guard !Self.isCancellation(error) else { return }
      accountError = error.localizedDescription
    }
  }

  private func completeExternalOnboarding(_ input: ExternalOnboardingInput) async {
    if isUITesting {
      user = .uiTestingActive
      desktopCodexHandoffIsPresentedForTesting = true
      accountError = nil
      return
    }
    accountIsLoading = true
    defer { accountIsLoading = false }
    do {
      let authToken = try await token()
      user = try await store.api.completeExternalOnboarding(input: input, displayName: user?.displayName, authToken: authToken)
      desktopCodexHandoffPending = true
      accountError = nil
    } catch {
      guard !Self.isCancellation(error) else { return }
      accountError = error.localizedDescription
    }
  }

  private func signOut() async {
    do {
      try await clerk.auth.signOut()
      user = nil
      inviteCode = ""
      accountError = nil
    } catch {
      accountError = error.localizedDescription
    }
  }

  private func token() async throws -> String? {
    if isUITesting {
      return nil
    }
    guard let token = try await clerk.auth.getToken(), !token.isEmpty else {
      throw AccountAccessError.tokenNotReady
    }
    return token
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

  private static func isCancellation(_ error: Error) -> Bool {
    if error is CancellationError {
      return true
    }
    let nsError = error as NSError
    return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
  }
}

private extension RootView {
  static func uiTestingUser() -> UserPayload {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "--ui-testing-scenario") else {
      return .uiTestingActive
    }
    let valueIndex = arguments.index(after: index)
    guard arguments.indices.contains(valueIndex) else {
      return .uiTestingActive
    }
    switch arguments[valueIndex] {
    case "invited":
      return .uiTestingInvited
    case "onboarding":
      return .uiTestingNeedsOnboarding
    default:
      return .uiTestingActive
    }
  }
}

private struct AccountLoadingView: View {
  var body: some View {
    VStack(spacing: 12) {
      ProgressView()
        .controlSize(.large)
      Text("Checking access")
        .font(.headline)
        .foregroundStyle(BeachcarColors.ink)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct AccountRetryView: View {
  let error: String
  let onRetry: () -> Void

  var body: some View {
    AccountCard {
      VStack(alignment: .leading, spacing: 14) {
        Image(systemName: "wifi.exclamationmark")
          .font(.title)
          .foregroundStyle(BeachcarColors.stop)
        Text("Could not check access")
          .font(.archivo(32, .black))
          .foregroundStyle(BC.ink)
        Text(error)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(BeachcarColors.secondary)
        Button(action: onRetry) {
          Label("Try again", systemImage: "arrow.clockwise")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(AccountPrimaryButtonStyle())
      }
    }
  }
}

private struct DisabledAccountView: View {
  let email: String
  let error: String?

  var body: some View {
    AccountCard {
      VStack(alignment: .leading, spacing: 14) {
        Image(systemName: "lock.trianglebadge.exclamationmark")
          .font(.title)
          .foregroundStyle(BeachcarColors.stop)
        Text("Access disabled")
          .font(.archivo(32, .black))
          .foregroundStyle(BC.ink)
        Text(email)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(BeachcarColors.secondary)
        if let error {
          Text(error)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(BeachcarColors.stop)
        }
      }
    }
  }
}

private struct InviteGateView: View {
  let email: String
  @Binding var inviteCode: String
  let isSaving: Bool
  let error: String?
  let onAccept: () -> Void
  let onSignOut: () -> Void
  @State private var legacyInviteOpen = false

  var body: some View {
    AccountCard {
      VStack(alignment: .leading, spacing: 16) {
        Image(systemName: "envelope.badge.shield.half.filled")
          .font(.title)
          .foregroundStyle(BeachcarColors.teal)
        Text("This email wasn’t invited")
          .font(.archivo(32, .black))
          .foregroundStyle(BC.ink)
        Text(email)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(BeachcarColors.secondary)
        Text("Beachcar is a small private beta. Sign out and use the address where your TestFlight invitation arrived, or contact the person who invited you.")
          .font(.archivo(14, .medium))
          .foregroundStyle(BC.sub)
          .lineSpacing(3)
          .fixedSize(horizontal: false, vertical: true)
        if let error {
          Text(error)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(BeachcarColors.stop)
        }
        Button(action: onSignOut) {
          Label("Sign out and try another email", systemImage: "rectangle.portrait.and.arrow.right")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(AccountPrimaryButtonStyle())
        .disabled(isSaving)

        DisclosureGroup("Have an older invite code?", isExpanded: $legacyInviteOpen) {
          VStack(spacing: 12) {
            TextField("Invite code", text: $inviteCode)
              .accessibilityIdentifier("invite-code-field")
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .font(.headline)
              .padding(14)
              .background(BC.faint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            Button(action: onAccept) {
              Label(isSaving ? "Accepting…" : "Accept older invite", systemImage: "checkmark.seal")
                .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("accept-invite-button")
            .buttonStyle(AccountPrimaryButtonStyle())
            .disabled(isSaving)
          }
          .padding(.top, 12)
        }
        .font(.archivo(13, .semibold))
        .foregroundStyle(BC.sub)
      }
    }
  }
}

private struct DesktopCodexHandoffView: View {
  let email: String
  let onContinue: () -> Void

  var body: some View {
    ScrollView {
      VStack(spacing: 18) {
        VStack(alignment: .leading, spacing: 16) {
          Image("BeachcarSurrey")
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .padding(.horizontal, 8)
            .background(BC.brandPink.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .accessibilityHidden(true)
          Label("SEARCH SAVED", systemImage: "checkmark.seal.fill")
            .font(.mono(11, bold: true))
            .foregroundStyle(BC.accent)
          Text("Finish your Codex setup on a desktop.")
            .font(.archivo(32, .black))
            .foregroundStyle(BC.white)
          Text("On your desktop, open Beachcar and sign in as \(email). Beachcar will walk you through downloading its skill, adding a reduced-scope recurring token, and starting your first local run.")
            .font(.archivo(15, .medium))
            .foregroundStyle(BC.sub)
            .lineSpacing(3)
          VStack(alignment: .leading, spacing: 10) {
            Text("1. Open beachcar-watch.jon-cooper.workers.dev on your desktop")
            Text("2. Sign in with this same email")
            Text("3. Follow the Codex coach — no Beachcar AI or browser credentials are needed")
          }
          .font(.archivo(13.5, .bold))
          .foregroundStyle(BC.white.opacity(0.86))
        }
        .padding(22)
        .background(BC.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(BC.border, lineWidth: 1))

        ShareLink(item: AppConfig.auctionBaseURL) {
          Label("Send myself the desktop link", systemImage: "square.and.arrow.up")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(AccountPrimaryButtonStyle())
        .accessibilityIdentifier("desktop-codex-handoff-share")

        Button("Continue to Beachcar") {
          onContinue()
        }
        .accessibilityIdentifier("desktop-codex-handoff-continue")
        .font(.archivo(15, .bold))
        .foregroundStyle(BC.sub)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(BC.faint, in: Capsule())
      }
      .padding(20)
    }
    .scrollIndicators(.hidden)
    .accessibilityIdentifier("desktop-codex-handoff")
  }
}

private struct FriendOnboardingView: View {
  let user: UserPayload
  let isSaving: Bool
  let error: String?
  let onSave: (ExternalOnboardingInput) -> Void

  @AppStorage("beachcar.onboarding.step") private var step = 0
  @AppStorage("beachcar.onboarding.location") private var location = ""
  @AppStorage("beachcar.onboarding.distance") private var pickupDistance = "750"
  @AppStorage("beachcar.onboarding.ceiling") private var comfortableCeiling = "30000"
  @AppStorage("beachcar.onboarding.stretch") private var stretchRoom = "2000"
  @AppStorage("beachcar.onboarding.showMore") private var selectedTasteValue = "open-air,simple,kid-plausible"
  @AppStorage("beachcar.onboarding.avoid") private var selectedAvoidValue = "rust,salvage,heavy-project"
  @AppStorage("beachcar.onboarding.notes") private var notes = ""

  private var firstName: String {
    let name = user.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return name.split(separator: " ").first.map(String.init) ?? "there"
  }

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        AccountCard {
          VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
              Text(stepTitles[step])
                .font(.archivo(30, .black))
                .foregroundStyle(BC.white)
              Text(stepSubtitles[step])
                .font(.archivo(14, .medium))
                .foregroundStyle(BC.sub)
                .lineSpacing(3)
            }
            content
            if let error {
              Text(error)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(BeachcarColors.stop)
            }
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .accessibilityIdentifier("onboarding-view")
      navigation
    }
    .onAppear {
      if ProcessInfo.processInfo.arguments.contains("--reset-onboarding") {
        step = 0
        location = ""
      }
      step = min(max(step, 0), 2)
      if location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        location = user.profile?.homeRegion ?? ""
      }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("WELCOME, \(firstName.uppercased())")
          .font(.mono(10.5, bold: true))
          .tracking(1.3)
          .foregroundStyle(BC.accent)
        Spacer()
        Text("\(step + 1) OF 3")
          .font(.mono(10.5, bold: true))
          .foregroundStyle(BC.sub)
      }
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule().fill(BC.faint)
          Capsule().fill(BC.accent).frame(width: proxy.size.width * CGFloat(step + 1) / 3)
        }
      }
      .frame(height: 5)
    }
    .padding(.horizontal, 22)
    .padding(.top, 18)
    .padding(.bottom, 4)
  }

  @ViewBuilder
  private var content: some View {
    switch step {
    case 0:
      AccountField(title: "City and state or ZIP", text: $location)
      AccountField(title: "Pickup distance (miles)", text: $pickupDistance, keyboard: .numberPad)
      CurrencyAccountField(title: "Comfortable ceiling", text: $comfortableCeiling)
      CurrencyAccountField(title: "Stretch room", text: $stretchRoom)
      Text("Beachcar uses this to rank pickup practicality and price—not to hide an exceptional find.")
        .font(.archivo(12.5, .medium)).foregroundStyle(BC.muted)
    case 1:
      CalibrationGrid(title: "Show me more", choices: tasteChoices, selection: selectedTaste, tint: BC.accent)
      CalibrationGrid(title: "Help me avoid", choices: avoidChoices, selection: selectedAvoid, tint: BC.danger)
      AccountTextArea(title: "Anything else? (optional)", text: $notes)
    default:
      VStack(alignment: .leading, spacing: 12) {
        Label("Finish on your desktop", systemImage: "laptopcomputer.and.arrow.down")
          .font(.archivo(16, .extrabold)).foregroundStyle(BC.accent)
        Text("Beachcar will save your search and taste now. Then it will guide you through connecting your own local Codex on a desktop computer. Beachcar will not start a paid research run.")
          .font(.archivo(13.5, .medium)).foregroundStyle(BC.white.opacity(0.78)).lineSpacing(3)
        Text("\(location.isEmpty ? "Your area" : location) · \(pickupDistance) mi · around $\(comfortableCeiling)")
          .font(.mono(10.5, bold: true)).foregroundStyle(BC.sub)
      }
      .padding(16)
      .background(BC.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
  }

  private var navigation: some View {
    HStack(spacing: 10) {
      if step > 0 {
        Button("Back") { withAnimation(.easeOut(duration: 0.2)) { step -= 1 } }
          .font(.archivo(14, .bold))
          .foregroundStyle(BC.sub)
          .frame(width: 82, height: 50)
          .background(BC.faint, in: Capsule())
      }
      Button {
        if step < 2 { withAnimation(.easeOut(duration: 0.2)) { step += 1 } }
        else { onSave(input) }
      } label: {
        Label(
          step == 2 ? (isSaving ? "Saving…" : "Continue on desktop") : "Continue",
          systemImage: step == 2 ? "laptopcomputer" : "arrow.right"
        )
        .frame(maxWidth: .infinity)
      }
      .accessibilityIdentifier(step == 2 ? "save-preferences-button" : "onboarding-continue-button")
      .buttonStyle(AccountPrimaryButtonStyle())
      .disabled(isSaving || !stepIsValid)
    }
    .padding(.horizontal, 20)
    .padding(.top, 10)
    .padding(.bottom, 16)
    .background(BC.bg)
  }

  private var stepIsValid: Bool {
    if step != 0 { return true }
    return !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && integer(pickupDistance) != nil
      && integer(comfortableCeiling) != nil
      && integer(stretchRoom) != nil
  }

  private var input: ExternalOnboardingInput {
    ExternalOnboardingInput(
      search: ManagedSearchInput(
        location: location.trimmingCharacters(in: .whitespacesAndNewlines),
        pickupDistanceMiles: integer(pickupDistance) ?? 750,
        comfortableCeiling: integer(comfortableCeiling) ?? 30000,
        stretchRoom: integer(stretchRoom) ?? 2000
      ),
      taste: ManagedTasteInput(
        showMore: selectedValues(selectedTasteValue),
        avoid: selectedValues(selectedAvoidValue),
        notes: notes.trimmedOrNil
      ),
      timezone: TimeZone.current.identifier
    )
  }

  private var selectedTaste: Binding<Set<String>> { selectedBinding($selectedTasteValue) }
  private var selectedAvoid: Binding<Set<String>> { selectedBinding($selectedAvoidValue) }

  private func selectedBinding(_ value: Binding<String>) -> Binding<Set<String>> {
    Binding(
      get: { Set(selectedValues(value.wrappedValue)) },
      set: { value.wrappedValue = $0.sorted().joined(separator: ",") }
    )
  }

  private func selectedValues(_ value: String) -> [String] {
    value.split(separator: ",").map(String.init).filter { !$0.isEmpty }
  }

  private func integer(_ value: String) -> Int? {
    let digits = value.filter(\.isNumber)
    return digits.isEmpty ? nil : Int(digits)
  }

  private var stepTitles: [String] { ["Your search", "Your taste", "Set up Codex"] }
  private var stepSubtitles: [String] { [
    "Tell us where to look and what price range feels comfortable.",
    "A few instincts make the first shortlist feel much more like you.",
    "You will finish the secure local Codex connection on your desktop.",
  ] }

  private var tasteChoices: [CalibrationChoice] { [
    .init(id: "open-air", label: "Open-air", detail: "Convertibles, targas, and door-off 4x4s"),
    .init(id: "simple", label: "Simple", detail: "Easy parts and light electronics"),
    .init(id: "kid-plausible", label: "Kid-plausible", detail: "Rear seats and relaxed errands"),
    .init(id: "small-4x4", label: "Small 4x4", detail: "Samurai, Tracker, Thing, and friends"),
    .init(id: "no-reserve", label: "No reserve", detail: "Low-drama auctions worth watching"),
    .init(id: "quirky-clean", label: "Quirky clean", detail: "Unusual, tidy, and charming"),
  ] }

  private var avoidChoices: [CalibrationChoice] { [
    .init(id: "rust", label: "Rust", detail: "Structural corrosion or vague undersides"),
    .init(id: "salvage", label: "Salvage", detail: "Rebuilt, bonded, or title-story cars"),
    .init(id: "heavy-project", label: "Heavy project", detail: "Non-runners and missing major parts"),
    .init(id: "overbuilt", label: "Overbuilt", detail: "Extreme lifts and irreversible mods"),
    .init(id: "fragile", label: "Fragile", detail: "Scarce parts or specialist ownership"),
    .init(id: "price-chasing", label: "Price chase", detail: "Already beyond the sensible budget"),
  ] }
}

#if false
private struct ProfileOnboardingView: View {
  let user: UserPayload
  let isSaving: Bool
  let error: String?
  let onSave: (ProfileInput) -> Void

  @State private var displayName: String
  @State private var homeRegion: String
  @State private var budgetMax: String
  @State private var stretchBudget: String
  @State private var tasteNotes: String
  @State private var avoidNotes: String
  @State private var bringATrailerEnabled: Bool
  @State private var carsAndBidsEnabled: Bool
  @State private var hemmingsEnabled: Bool
  @State private var marketplaceEnabled: Bool
  @State private var maxDistanceMiles: String
  @State private var sourceBudget: String
  @State private var noReserveOnly: Bool
  @State private var browserRunner: Bool
  @State private var emailDigest: Bool
  @State private var strongFitAlerts: Bool
  @State private var step = 0
  @State private var selectedTaste: Set<String>
  @State private var selectedAvoid: Set<String>

  init(user: UserPayload, isSaving: Bool, error: String?, onSave: @escaping (ProfileInput) -> Void) {
    self.user = user
    self.isSaving = isSaving
    self.error = error
    self.onSave = onSave
    _displayName = State(initialValue: user.profile?.displayName ?? user.displayName ?? "")
    _homeRegion = State(initialValue: user.profile?.homeRegion ?? "Northeast")
    _budgetMax = State(initialValue: user.profile?.budgetMax.map(String.init) ?? "30000")
    _stretchBudget = State(initialValue: user.profile?.stretchBudget.map(String.init) ?? "2000")
    _tasteNotes = State(initialValue: "Open-air, charming, beach-town practical, kid-plausible when possible.")
    _avoidNotes = State(initialValue: "Major rust, salvage titles, huge lifts, fragile projects, or over-budget icons.")
    _bringATrailerEnabled = State(initialValue: true)
    _carsAndBidsEnabled = State(initialValue: true)
    _hemmingsEnabled = State(initialValue: false)
    _marketplaceEnabled = State(initialValue: false)
    _maxDistanceMiles = State(initialValue: "750")
    _sourceBudget = State(initialValue: "")
    _noReserveOnly = State(initialValue: false)
    _browserRunner = State(initialValue: true)
    _emailDigest = State(initialValue: true)
    _strongFitAlerts = State(initialValue: true)
    _selectedTaste = State(initialValue: ["open-air", "simple", "kid-plausible"])
    _selectedAvoid = State(initialValue: ["rust", "salvage", "heavy-project"])
  }

  var body: some View {
    VStack(spacing: 0) {
      onboardingHeader
      ScrollView {
        AccountCard {
          VStack(alignment: .leading, spacing: 18) {
            stepHeading
            stepContent
            if let error {
              Text(error)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(BeachcarColors.stop)
            }
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .accessibilityIdentifier("onboarding-view")
      onboardingNavigation
    }
  }

  private var onboardingHeader: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("SET UP YOUR SEARCH")
          .font(.mono(10.5, bold: true))
          .tracking(1.3)
          .foregroundStyle(BC.accent)
        Spacer()
        Text("\(step + 1) OF 4")
          .font(.mono(10.5, bold: true))
          .foregroundStyle(BC.sub)
      }
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule().fill(BC.faint)
          Capsule().fill(BC.accent).frame(width: proxy.size.width * CGFloat(step + 1) / 4)
        }
      }
      .frame(height: 5)
    }
    .padding(.horizontal, 22)
    .padding(.top, 18)
    .padding(.bottom, 4)
  }

  private var stepHeading: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(stepTitles[step])
        .font(.archivo(30, .black))
        .foregroundStyle(BC.white)
      Text(stepSubtitles[step])
        .font(.archivo(14, .medium))
        .foregroundStyle(BC.sub)
        .lineSpacing(3)
    }
  }

  @ViewBuilder
  private var stepContent: some View {
    switch step {
    case 0:
      AccountField(title: "Your name", text: $displayName)
      AccountField(title: "Home region", text: $homeRegion)
      AccountField(title: "How far should Beachcar look?", text: $maxDistanceMiles, keyboard: .numberPad)
      Text("We’ll use this to rank pickup practicality—not to exclude an exceptional find.")
        .font(.archivo(12.5, .medium)).foregroundStyle(BC.muted)
    case 1:
      CurrencyAccountField(title: "Comfortable ceiling", text: $budgetMax)
      CurrencyAccountField(title: "Stretch room", text: $stretchBudget)
      Toggle("Prioritize no-reserve auctions", isOn: $noReserveOnly)
        .font(.archivo(14, .semibold)).tint(BC.accent)
      budgetPreview
    case 2:
      CalibrationGrid(title: "Show me more", choices: tasteChoices, selection: $selectedTaste, tint: BC.accent)
      CalibrationGrid(title: "Help me avoid", choices: avoidChoices, selection: $selectedAvoid, tint: BC.danger)
      AccountTextArea(title: "Anything else? (optional)", text: $tasteNotes)
    default:
      AccountPreferenceSection(title: "Auction sources") {
        Toggle("Bring a Trailer", isOn: $bringATrailerEnabled)
        Toggle("Cars & Bids", isOn: $carsAndBidsEnabled)
        Toggle("Hemmings", isOn: $hemmingsEnabled)
        Toggle("Local marketplace", isOn: $marketplaceEnabled)
      }
      AccountPreferenceSection(title: "Keep me posted") {
        Toggle("Daily shortlist", isOn: $emailDigest)
        Toggle("Strong-fit alerts", isOn: $strongFitAlerts)
      }
      shortlistPreview
    }
  }

  private var onboardingNavigation: some View {
    HStack(spacing: 10) {
      if step > 0 {
        Button("Back") { withAnimation(.easeOut(duration: 0.2)) { step -= 1 } }
          .font(.archivo(14, .bold))
          .foregroundStyle(BC.sub)
          .frame(width: 82, height: 50)
          .background(BC.faint, in: Capsule())
      }
      Button {
        if step < 3 { withAnimation(.easeOut(duration: 0.2)) { step += 1 } }
        else { onSave(profileInput) }
      } label: {
        Label(
          step == 3 ? (isSaving ? "Saving…" : "Save my search") : "Continue",
          systemImage: step == 3 ? "sparkles" : "arrow.right"
        )
        .frame(maxWidth: .infinity)
      }
      .accessibilityIdentifier(step == 3 ? "save-preferences-button" : "onboarding-continue-button")
      .buttonStyle(AccountPrimaryButtonStyle())
      .disabled(isSaving)
    }
    .padding(.horizontal, 20)
    .padding(.top, 10)
    .padding(.bottom, 16)
    .background(BC.bg)
  }

  private var budgetPreview: some View {
    HStack(spacing: 10) {
      Image(systemName: "gauge.with.dots.needle.50percent")
        .font(.system(size: 22, weight: .bold)).foregroundStyle(BC.accent)
      VStack(alignment: .leading, spacing: 3) {
        Text("Your buying lane").font(.archivo(13, .bold)).foregroundStyle(BC.white)
        Text("Beachcar will distinguish a fair buy from a tempting stretch.")
          .font(.archivo(12, .medium)).foregroundStyle(BC.sub)
      }
    }
    .padding(14)
    .background(BC.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
  }

  private var shortlistPreview: some View {
    VStack(alignment: .leading, spacing: 9) {
      Label("Your search is ready", systemImage: "checkmark.seal.fill")
        .font(.archivo(16, .extrabold)).foregroundStyle(BC.accent)
      Text("Beachcar will research \(homeRegion.isEmpty ? "your region" : homeRegion), publish the best finds, and learn from every swipe.")
        .font(.archivo(13.5, .medium)).foregroundStyle(BC.white.opacity(0.78)).lineSpacing(3)
    }
    .padding(16)
    .background(BC.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
  }

  private var stepTitles: [String] { ["Where should we look?", "What feels comfortable?", "Calibrate your taste", "Choose your rhythm"] }
  private var stepSubtitles: [String] { [
    "A little context helps rank local practicality against a truly special car.",
    "Set the line between a confident buy and a worthwhile stretch.",
    "Start with a few instincts. You can teach Beachcar more with every daily run.",
    "Choose the sources and alerts your connected agent should use. Beachcar keeps the brief and review history in sync.",
  ] }

  private var tasteChoices: [CalibrationChoice] { [
    .init(id: "open-air", label: "Open-air", detail: "Convertibles, targas, and door-off 4x4s"),
    .init(id: "simple", label: "Simple", detail: "Easy parts and light electronics"),
    .init(id: "kid-plausible", label: "Kid-plausible", detail: "Rear seats and relaxed errands"),
    .init(id: "small-4x4", label: "Small 4x4", detail: "Samurai, Tracker, Thing, and friends"),
    .init(id: "no-reserve", label: "No reserve", detail: "Low-drama auctions worth watching"),
    .init(id: "quirky-clean", label: "Quirky clean", detail: "Unusual, tidy, and charming"),
  ] }

  private var avoidChoices: [CalibrationChoice] { [
    .init(id: "rust", label: "Rust", detail: "Structural corrosion or vague undersides"),
    .init(id: "salvage", label: "Salvage", detail: "Rebuilt, bonded, or title-story cars"),
    .init(id: "heavy-project", label: "Heavy project", detail: "Non-runners and missing major parts"),
    .init(id: "overbuilt", label: "Overbuilt", detail: "Extreme lifts and irreversible mods"),
    .init(id: "fragile", label: "Fragile", detail: "Scarce parts or specialist ownership"),
    .init(id: "price-chasing", label: "Price chase", detail: "Already beyond the sensible budget"),
  ] }

  private func calibratedNotes(base: String, selected: Set<String>, choices: [CalibrationChoice], prefix: String) -> String {
    let details = choices.filter { selected.contains($0.id) }.map(\.detail)
    let trimmed = base.trimmingCharacters(in: .whitespacesAndNewlines)
    return [trimmed, details.isEmpty ? "" : "\(prefix): \(details.joined(separator: "; "))."]
      .filter { !$0.isEmpty }
      .joined(separator: " ")
  }

  private func currencyValue(_ text: String) -> Int? {
    let cleaned = text.filter(\.isNumber)
    return cleaned.isEmpty ? nil : Int(cleaned)
  }

  private var profileInput: ProfileInput {
    let sourceSettings = sourceSettingsRequest
    return ProfileInput(
      displayName: displayName.trimmedOrNil,
      niche: user.profile?.niche ?? "Beach cars and runabouts",
      budgetMax: currencyValue(budgetMax),
      stretchBudget: currencyValue(stretchBudget),
      homeRegion: homeRegion.trimmedOrNil,
      timezone: user.profile?.timezone ?? TimeZone.current.identifier,
      profile: ProfilePreferences(
        tasteNotes: calibratedNotes(base: tasteNotes, selected: selectedTaste, choices: tasteChoices, prefix: "Selected tastes"),
        avoidNotes: calibratedNotes(base: avoidNotes, selected: selectedAvoid, choices: avoidChoices, prefix: "Selected avoids"),
        lanes: ["family", "solo", "curiosity"],
        sources: sourceSettings.sources.filter(\.enabled).map(\.source),
        sourcePreferences: sourceSettings.sources,
        notifications: NotificationPreferences(
          channel: emailDigest || strongFitAlerts ? "email" : "none",
          runDigest: emailDigest,
          strongFitAlerts: strongFitAlerts,
          digestTime: "08:00"
        )
      ),
      sourceSettings: sourceSettings,
      completeOnboarding: true
    )
  }

  private var sourceSettingsRequest: SourceSettingsRequest {
    SourceSettingsRequest(
      sources: [
        sourceSetting(source: "bringatrailer", enabled: bringATrailerEnabled, noReserveOnly: noReserveOnly, browserRunner: false, maxDistanceMiles: maxDistanceValue),
        sourceSetting(source: "carsandbids", enabled: carsAndBidsEnabled, noReserveOnly: false, browserRunner: browserRunner, maxDistanceMiles: maxDistanceValue),
        sourceSetting(source: "hemmings", enabled: hemmingsEnabled, noReserveOnly: false, browserRunner: browserRunner, maxDistanceMiles: maxDistanceValue),
        sourceSetting(source: "marketplace", enabled: marketplaceEnabled, noReserveOnly: false, browserRunner: browserRunner, maxDistanceMiles: maxDistanceValue ?? 150),
      ]
    )
  }

  private var maxDistanceValue: Int? {
    let value = maxDistanceMiles.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : Int(value)
  }

  private var sourceBudgetCents: Int? {
    let cleaned = sourceBudget
      .replacingOccurrences(of: "$", with: "")
      .replacingOccurrences(of: ",", with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleaned.isEmpty, let dollars = Decimal(string: cleaned) else { return nil }
    return NSDecimalNumber(decimal: dollars * Decimal(100)).intValue
  }

  private func sourceSetting(
    source: String,
    enabled: Bool,
    noReserveOnly: Bool,
    browserRunner: Bool,
    maxDistanceMiles: Int?
  ) -> SourceSettingInput {
    SourceSettingInput(
      source: source,
      enabled: enabled,
      settings: SourcePreferenceSettings(
        maxDistanceMiles: maxDistanceMiles,
        maxBudgetCents: sourceBudgetCents,
        noReserveOnly: noReserveOnly,
        browserRunner: browserRunner,
        searchNotes: nil
      )
    )
  }
}
#endif

private struct CalibrationChoice: Identifiable {
  let id: String
  let label: String
  let detail: String
}

private struct CalibrationGrid: View {
  let title: String
  let choices: [CalibrationChoice]
  @Binding var selection: Set<String>
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title).font(.mono(10.5, bold: true)).tracking(0.8).foregroundStyle(BC.sub)
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 138), spacing: 9)], spacing: 9) {
        ForEach(choices) { choice in
          let selected = selection.contains(choice.id)
          Button {
            if selected { selection.remove(choice.id) }
            else { selection.insert(choice.id) }
          } label: {
            VStack(alignment: .leading, spacing: 5) {
              HStack {
                Text(choice.label).font(.archivo(13.5, .extrabold))
                Spacer(minLength: 4)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
              }
              Text(choice.detail)
                .font(.archivo(11.5, .medium))
                .foregroundStyle(selected ? BC.white.opacity(0.72) : BC.muted)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            }
            .foregroundStyle(selected ? tint : BC.sub)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
            .padding(12)
            .background(selected ? tint.opacity(0.1) : BC.faint, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(selected ? tint.opacity(0.5) : BC.border, lineWidth: 1))
          }
          .buttonStyle(.plain)
          .accessibilityValue(selected ? "Selected" : "Not selected")
        }
      }
    }
  }
}

private struct CurrencyAccountField: View {
  let title: String
  @Binding var text: String
  @FocusState private var focused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Text(title).font(.caption.weight(.bold)).foregroundStyle(BeachcarColors.secondary)
      HStack(spacing: 9) {
        Text("$").font(.archivo(20, .extrabold)).foregroundStyle(BC.accent)
        TextField("30,000", text: $text)
          .keyboardType(.numberPad)
          .focused($focused)
          .font(.archivo(19, .bold))
      }
      .padding(13)
      .background(BC.faint, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(BeachcarColors.hairline, lineWidth: 1))
    }
    .onAppear { format() }
    .onChange(of: focused) { _, isFocused in
      if isFocused { text = text.filter(\.isNumber) }
      else { format() }
    }
  }

  private func format() {
    let digits = text.filter(\.isNumber)
    guard let value = Int(digits) else { return }
    text = value.formatted(.number.grouping(.automatic))
  }
}

private struct AccountCard<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(22)
      .background(BC.card, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
          .stroke(BC.border, lineWidth: 1)
      }
      .shadow(color: .black.opacity(0.5), radius: 22, y: 14)
      .padding(20)
      .frame(maxWidth: 560, maxHeight: .infinity)
  }
}

private struct AccountField: View {
  let title: String
  @Binding var text: String
  var keyboard: UIKeyboardType = .default

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Text(title)
        .font(.caption.weight(.bold))
        .foregroundStyle(BeachcarColors.secondary)
      TextField(title, text: $text)
        .keyboardType(keyboard)
        .textInputAutocapitalization(.words)
        .autocorrectionDisabled()
        .font(.headline)
        .padding(13)
        .background(BC.faint, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 15, style: .continuous)
            .stroke(BeachcarColors.hairline, lineWidth: 1)
        }
    }
  }
}

private struct AccountTextArea: View {
  let title: String
  @Binding var text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Text(title)
        .font(.caption.weight(.bold))
        .foregroundStyle(BeachcarColors.secondary)
      TextEditor(text: $text)
        .font(.headline)
        .frame(minHeight: 92)
        .scrollContentBackground(.hidden)
        .padding(9)
        .background(BC.faint, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 15, style: .continuous)
            .stroke(BeachcarColors.hairline, lineWidth: 1)
        }
    }
  }
}

private struct AccountPreferenceSection<Content: View>: View {
  let title: String
  let content: Content

  init(title: String, @ViewBuilder content: () -> Content) {
    self.title = title
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.caption.weight(.bold))
        .foregroundStyle(BeachcarColors.secondary)
      VStack(alignment: .leading, spacing: 12) {
        content
      }
      .font(.headline)
      .padding(14)
      .background(BC.faint, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 15, style: .continuous)
          .stroke(BeachcarColors.hairline, lineWidth: 1)
      }
    }
    .tint(BC.accent)
  }
}

private struct AccountPrimaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.archivo(16, .bold))
      .padding(.vertical, 15)
      .background(BC.accent.opacity(configuration.isPressed ? 0.82 : 1), in: Capsule())
      .foregroundStyle(BC.accentInk)
  }
}

private extension String {
  var trimmedOrNil: String? {
    let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

@MainActor
private extension ClerkTheme {
  static let beachcar = ClerkTheme(
    colors: .init(
      primary: BC.accent,
      background: BC.panel,
      input: BC.card,
      danger: BC.danger,
      success: BC.accent,
      warning: BC.star,
      foreground: BC.white,
      mutedForeground: BC.sub,
      primaryForeground: BC.accentInk,
      inputForeground: BC.white,
      neutral: BC.sub,
      ring: BC.accent,
      muted: BC.faint,
      shadow: Color.black,
      border: BC.white
    ),
    fonts: .init(fontFamily: "ArchivoRoman-Regular"),
    design: .init(borderRadius: 16)
  )
}
