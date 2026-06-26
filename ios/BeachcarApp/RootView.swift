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
  private let isUITesting: Bool
  #if DEBUG
  @State private var didAttemptLaunchTicket = false
  #endif

  init() {
    let isUITesting = ProcessInfo.processInfo.arguments.contains("--ui-testing")
    self.isUITesting = isUITesting
    _store = StateObject(wrappedValue: isUITesting ? BeachcarStore.uiTesting() : BeachcarStore())
    _user = State(initialValue: isUITesting ? Self.uiTestingUser() : nil)
  }

  var body: some View {
    ZStack {
      BeachcarColors.shell.ignoresSafeArea()
      if clerk.user == nil && !isUITesting {
        signedOutView
      } else {
        signedInView
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
          .font(.archivo(48, .black))
          .foregroundStyle(BC.white)
        Text("Review today's beach-car shortlist, save taste signals, and send steering notes back into the next daily run.")
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

      UserButton(signedOutContent: {
        Button {
          authIsPresented = true
        } label: {
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
      })
      Spacer()
    }
    .padding(20)
    .onAppear {
      user = nil
      accountError = nil
    }
  }

  @ViewBuilder
  private var signedInView: some View {
    if accountIsLoading && user == nil {
      AccountLoadingView()
        .task {
          await loadAccountIfNeeded()
        }
    } else if let user {
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
          }
        )
      case .active:
        if user.onboardingCompleted {
          deckView
        } else {
          ProfileOnboardingView(
            user: user,
            isSaving: accountIsLoading,
            error: accountError,
            onSave: { input in
              Task {
                await saveProfile(input)
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

  private func loadAccountIfNeeded() async {
    guard user == nil, !accountIsLoading else { return }
    await refreshAccount()
  }

  private func refreshAccount() async {
    accountIsLoading = true
    defer { accountIsLoading = false }
    do {
      let token = try await token()
      user = try await store.api.me(authToken: token)
      accountError = nil
    } catch {
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
      accountError = error.localizedDescription
    }
  }

  private func saveProfile(_ input: ProfileInput) async {
    if isUITesting {
      user = .uiTestingActive
      accountError = nil
      return
    }
    accountIsLoading = true
    defer { accountIsLoading = false }
    do {
      let token = try await token()
      _ = try await store.api.putProfile(input: input, authToken: token)
      user = try await store.api.putSourceSettings(input: input.sourceSettings, authToken: token)
      accountError = nil
    } catch {
      accountError = error.localizedDescription
    }
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

  var body: some View {
    AccountCard {
      VStack(alignment: .leading, spacing: 16) {
        Image(systemName: "envelope.badge.shield.half.filled")
          .font(.title)
          .foregroundStyle(BeachcarColors.teal)
        Text("Invite required")
          .font(.archivo(32, .black))
          .foregroundStyle(BC.ink)
        Text(email)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(BeachcarColors.secondary)
        TextField("Invite code", text: $inviteCode)
          .accessibilityIdentifier("invite-code-field")
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .font(.headline)
          .padding(14)
          .background(BC.faint, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
              .stroke(BeachcarColors.hairline, lineWidth: 1)
          }
        if let error {
          Text(error)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(BeachcarColors.stop)
        }
        Button(action: onAccept) {
          Label(isSaving ? "Accepting..." : "Accept invite", systemImage: "checkmark.seal")
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("accept-invite-button")
        .buttonStyle(AccountPrimaryButtonStyle())
        .disabled(isSaving)
      }
    }
  }
}

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
  @State private var marketplaceEnabled: Bool
  @State private var maxDistanceMiles: String
  @State private var sourceBudget: String
  @State private var noReserveOnly: Bool
  @State private var browserRunner: Bool
  @State private var emailDigest: Bool
  @State private var strongFitAlerts: Bool

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
    _marketplaceEnabled = State(initialValue: false)
    _maxDistanceMiles = State(initialValue: "750")
    _sourceBudget = State(initialValue: "")
    _noReserveOnly = State(initialValue: false)
    _browserRunner = State(initialValue: true)
    _emailDigest = State(initialValue: true)
    _strongFitAlerts = State(initialValue: true)
  }

  var body: some View {
    ScrollView {
      AccountCard {
        VStack(alignment: .leading, spacing: 16) {
          Text("Preferences")
            .font(.largeTitle.weight(.black))
            .foregroundStyle(BeachcarColors.ink)
          Text(user.email)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(BeachcarColors.secondary)

          AccountField(title: "Name", text: $displayName)
          AccountField(title: "Region", text: $homeRegion)
          AccountField(title: "Budget ceiling", text: $budgetMax, keyboard: .numberPad)
          AccountField(title: "Stretch room", text: $stretchBudget, keyboard: .numberPad)
          AccountTextArea(title: "Prioritize", text: $tasteNotes)
          AccountTextArea(title: "Avoid", text: $avoidNotes)
          AccountPreferenceSection(title: "Sources") {
            Toggle("Bring a Trailer", isOn: $bringATrailerEnabled)
            Toggle("Cars & Bids", isOn: $carsAndBidsEnabled)
            Toggle("Marketplace", isOn: $marketplaceEnabled)
            AccountField(title: "Max miles", text: $maxDistanceMiles, keyboard: .numberPad)
            AccountField(title: "Source cap", text: $sourceBudget, keyboard: .decimalPad)
            Toggle("No-reserve only on BaT", isOn: $noReserveOnly)
            Toggle("Use browser runner", isOn: $browserRunner)
          }
          AccountPreferenceSection(title: "Notifications") {
            Toggle("Daily run digest", isOn: $emailDigest)
            Toggle("Strong-fit alerts", isOn: $strongFitAlerts)
          }

          if let error {
            Text(error)
              .font(.footnote.weight(.semibold))
              .foregroundStyle(BeachcarColors.stop)
          }

          Button {
            onSave(profileInput)
          } label: {
            Label(isSaving ? "Saving..." : "Save preferences", systemImage: "checkmark.circle")
              .frame(maxWidth: .infinity)
          }
          .accessibilityIdentifier("save-preferences-button")
          .buttonStyle(AccountPrimaryButtonStyle())
          .disabled(isSaving)
        }
      }
    }
    .accessibilityIdentifier("onboarding-view")
  }

  private var profileInput: ProfileInput {
    let sourceSettings = sourceSettingsRequest
    return ProfileInput(
      displayName: displayName.trimmedOrNil,
      niche: user.profile?.niche ?? "Beach cars and runabouts",
      budgetMax: Int(budgetMax.trimmingCharacters(in: .whitespacesAndNewlines)),
      stretchBudget: Int(stretchBudget.trimmingCharacters(in: .whitespacesAndNewlines)),
      homeRegion: homeRegion.trimmedOrNil,
      timezone: user.profile?.timezone ?? TimeZone.current.identifier,
      profile: ProfilePreferences(
        tasteNotes: tasteNotes,
        avoidNotes: avoidNotes,
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
