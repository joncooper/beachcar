import Foundation

enum ProductDiagnosticsConsent: String, Codable {
  case undecided
  case enabled
  case disabled
}

enum ProductEventName: String, Codable {
  case reviewSessionStarted = "review_session_started"
  case reviewDragEnded = "review_drag_ended"
  case reviewUndo = "review_undo"
  case coachImpression = "coach_impression"
  case coachDismissed = "coach_dismissed"
  case galleryOpened = "gallery_opened"
  case galleryDismissed = "gallery_dismissed"
  case galleryReopened = "gallery_reopened"
  case tuningChanged = "tuning_changed"
  case experienceFeedbackSubmitted = "experience_feedback_submitted"
}

struct QueuedProductEvent: Codable, Identifiable, Equatable {
  let id: String
  let sessionId: String
  let eventName: String
  let properties: [String: String]
  let clientCreatedAt: String
  let appBuild: String
  let tuningVersion: Int
}

struct ProductEventBatchRequest: Encodable {
  let events: [QueuedProductEvent]
}

struct ProductEventBatchResponse: Decodable {
  let accepted: Int
  let processed: Int
}

struct ProductTuningConfig: Decodable {
  let betaEnabled: Bool
  let forceBalanced: Bool
}

enum ExperienceFeedbackReason: String, Codable, CaseIterable, Identifiable {
  case tooEasy = "too_easy_to_trigger"
  case tooMuchEffort = "takes_too_much_effort"
  case strongHardToReach = "strong_action_hard_to_reach"
  case hapticsFeelOff = "haptics_feel_off"
  case galleryHardToLeave = "gallery_hard_to_leave"
  case somethingElse = "something_else"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .tooEasy: "Too easy to trigger"
    case .tooMuchEffort: "Takes too much effort"
    case .strongHardToReach: "Strong action is hard to reach"
    case .hapticsFeelOff: "Haptics feel weak or heavy"
    case .galleryHardToLeave: "Gallery is hard to leave"
    case .somethingElse: "Something else"
    }
  }
}

struct LocalExperienceFeedback: Codable, Identifiable, Equatable {
  let id: String
  let reasons: [ExperienceFeedbackReason]
  let comment: String?
  let createdAt: String
  let tuningPreset: String
}

@MainActor
final class ProductTelemetry: ObservableObject {
  static let consentKey = "beachcar.productDiagnosticsConsent.v1"
  static let queueKey = "beachcar.productEventQueue.v1"
  static let feedbackKey = "beachcar.localExperienceFeedback.v1"

  @Published private(set) var consent: ProductDiagnosticsConsent
  @Published private(set) var queuedEvents: [QueuedProductEvent]
  @Published private(set) var localFeedback: [LocalExperienceFeedback]
  @Published private(set) var isUploading = false
  @Published private(set) var lastUploadError: String?

  let sessionId = UUID().uuidString.lowercased()

  private let defaults: UserDefaults
  private let consentStorageKey: String
  private let queueStorageKey: String
  private let feedbackStorageKey: String
  private var lastGalleryDismissedAt: Date?

  var shouldPresentDisclosure: Bool {
    AppConfig.isBetaBuild && consent == .undecided
  }

  init(defaults: UserDefaults = .standard, storageScope: String? = nil) {
    self.defaults = defaults
    consentStorageKey = Self.scopedKey(Self.consentKey, scope: storageScope)
    queueStorageKey = Self.scopedKey(Self.queueKey, scope: storageScope)
    feedbackStorageKey = Self.scopedKey(Self.feedbackKey, scope: storageScope)
    if AppEnv.isUITesting {
      consent = Self.uiTestingConsent()
      queuedEvents = []
      localFeedback = []
    } else {
      consent = defaults.string(forKey: consentStorageKey).flatMap(ProductDiagnosticsConsent.init(rawValue:)) ?? .undecided
      queuedEvents = Self.decode([QueuedProductEvent].self, key: queueStorageKey, defaults: defaults) ?? []
      localFeedback = Self.decode([LocalExperienceFeedback].self, key: feedbackStorageKey, defaults: defaults) ?? []
    }
  }

  func setConsent(_ newValue: ProductDiagnosticsConsent) {
    consent = newValue
    guard !AppEnv.isUITesting else { return }
    defaults.set(newValue.rawValue, forKey: consentStorageKey)
    if newValue != .enabled {
      queuedEvents.removeAll()
      persistQueue()
      lastUploadError = nil
    }
  }

  func record(_ name: ProductEventName, properties: [String: String], tuning: InteractionTuningProfile) {
    guard consent == .enabled else { return }
    let boundedProperties = Dictionary(uniqueKeysWithValues: properties.prefix(8).map { key, value in
      (String(key.prefix(64)), String(value.prefix(key == "comment" ? 240 : 120)))
    })
    let event = QueuedProductEvent(
      id: UUID().uuidString.lowercased(),
      sessionId: sessionId,
      eventName: name.rawValue,
      properties: boundedProperties,
      clientCreatedAt: Date().ISO8601Format(),
      appBuild: AppConfig.appBuildLabel,
      tuningVersion: InteractionTuningProfile.currentVersion
    )
    queuedEvents.append(event)
    if queuedEvents.count > 200 { queuedEvents.removeFirst(queuedEvents.count - 200) }
    persistQueue()
  }

  func recordGalleryOpened(photoCount: Int, rememberedIndex: Int, tuning: InteractionTuningProfile) {
    let properties = [
      "photoCountBucket": Self.countBucket(photoCount),
      "rememberedIndex": rememberedIndex == 0 ? "first" : "remembered",
      "tuningPreset": tuning.preset.rawValue,
    ]
    record(.galleryOpened, properties: properties, tuning: tuning)
    if let lastGalleryDismissedAt {
      record(
        .galleryReopened,
        properties: [
          "secondsBucket": Self.secondsBucket(Date().timeIntervalSince(lastGalleryDismissedAt)),
          "tuningPreset": tuning.preset.rawValue,
        ],
        tuning: tuning
      )
    }
  }

  func recordGalleryDismissed(
    method: String,
    attempts: Int,
    zoomed: Bool,
    tuning: InteractionTuningProfile
  ) {
    record(
      .galleryDismissed,
      properties: [
        "method": method,
        "attemptCountBucket": Self.countBucket(attempts),
        "zoomed": zoomed ? "true" : "false",
        "tuningPreset": tuning.preset.rawValue,
      ],
      tuning: tuning
    )
    lastGalleryDismissedAt = Date()
  }

  func submitFeedback(
    reasons: Set<ExperienceFeedbackReason>,
    comment: String,
    tuning: InteractionTuningProfile
  ) {
    let trimmed = String(comment.trimmingCharacters(in: .whitespacesAndNewlines).prefix(240))
    let record = LocalExperienceFeedback(
      id: UUID().uuidString.lowercased(),
      reasons: reasons.sorted { $0.rawValue < $1.rawValue },
      comment: trimmed.isEmpty ? nil : trimmed,
      createdAt: Date().ISO8601Format(),
      tuningPreset: tuning.preset.rawValue
    )
    localFeedback.append(record)
    if localFeedback.count > 20 { localFeedback.removeFirst(localFeedback.count - 20) }
    persistFeedback()

    self.record(
      .experienceFeedbackSubmitted,
      properties: [
        "reasonCodes": record.reasons.map(\.rawValue).joined(separator: ","),
        "hasComment": record.comment == nil ? "false" : "true",
        "comment": record.comment ?? "",
        "tuningPreset": tuning.preset.rawValue,
      ],
      tuning: tuning
    )
  }

  func flush(api: AuctionAPI, tokenProvider: AuctionAPI.TokenProvider) async {
    guard consent == .enabled, !isUploading, !queuedEvents.isEmpty else { return }
    isUploading = true
    defer { isUploading = false }
    do {
      let token = try await tokenProvider()
      while consent == .enabled, !queuedEvents.isEmpty {
        let batch = Array(queuedEvents.prefix(40))
        _ = try await api.postProductEvents(batch, authToken: token)
        let sent = Set(batch.map(\.id))
        queuedEvents.removeAll { sent.contains($0.id) }
        persistQueue()
      }
      lastUploadError = nil
    } catch {
      lastUploadError = "Waiting for the next connection"
    }
  }

  func diagnosticSnapshot(
    tuning: InteractionTuning,
    coach: InteractionCoachState
  ) -> String {
    let snapshot = ProductDiagnosticSnapshot(
      generatedAt: Date().ISO8601Format(),
      appBuild: AppConfig.appBuildLabel,
      consent: consent.rawValue,
      queuedEventCount: queuedEvents.count,
      selectedTuning: tuning.selectedProfile,
      effectiveTuning: tuning.effectiveProfile,
      remotelyForcedBalanced: tuning.isRemotelyForcedBalanced,
      coach: coach,
      recentExperienceFeedback: localFeedback
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(snapshot) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
  }

  static func durationBucket(_ seconds: TimeInterval) -> String {
    if seconds < 0.6 { return "under_0_6s" }
    if seconds < 1.5 { return "0_6_to_1_5s" }
    return "over_1_5s"
  }

  static func secondsBucket(_ seconds: TimeInterval) -> String {
    if seconds < 10 { return "under_10s" }
    if seconds < 30 { return "10_to_30s" }
    if seconds < 120 { return "30_to_120s" }
    return "over_120s"
  }

  private static func countBucket(_ count: Int) -> String {
    switch count {
    case ...0: "none"
    case 1: "one"
    case 2...3: "two_to_three"
    default: "four_plus"
    }
  }

  private func persistQueue() {
    guard !AppEnv.isUITesting else { return }
    Self.encode(queuedEvents, key: queueStorageKey, defaults: defaults)
  }

  private func persistFeedback() {
    guard !AppEnv.isUITesting else { return }
    Self.encode(localFeedback, key: feedbackStorageKey, defaults: defaults)
  }

  private static func encode<T: Encodable>(_ value: T, key: String, defaults: UserDefaults) {
    if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
  }

  private static func decode<T: Decodable>(_ type: T.Type, key: String, defaults: UserDefaults) -> T? {
    guard let data = defaults.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }

  private static func uiTestingConsent() -> ProductDiagnosticsConsent {
    let args = ProcessInfo.processInfo.arguments
    guard let index = args.firstIndex(of: "--beta-diagnostics"), args.indices.contains(index + 1) else { return .disabled }
    return ProductDiagnosticsConsent(rawValue: args[index + 1]) ?? .disabled
  }

  private static func scopedKey(_ key: String, scope: String?) -> String {
    guard let scope, !scope.isEmpty else { return key }
    return "\(key).\(scope)"
  }
}

private struct ProductDiagnosticSnapshot: Encodable {
  let generatedAt: String
  let appBuild: String
  let consent: String
  let queuedEventCount: Int
  let selectedTuning: InteractionTuningProfile
  let effectiveTuning: InteractionTuningProfile
  let remotelyForcedBalanced: Bool
  let coach: InteractionCoachState
  let recentExperienceFeedback: [LocalExperienceFeedback]
}
