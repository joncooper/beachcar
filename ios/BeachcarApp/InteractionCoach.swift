import SwiftUI

struct InteractionCoachState: Codable, Equatable {
  static let currentHintVersion = 3

  var hintVersion = currentHintVersion
  var primaryJudgments = 0
  var strongJudgments = 0
  var galleryDismissals = 0
  var lastInteractionAt: Date?

  var reviewStage: ReviewCoachStage {
    if strongJudgments > 0 { return .mastered }
    if primaryJudgments > 0 { return .primaryLearned }
    return .new
  }

  var showsGalleryGuidance: Bool { galleryDismissals == 0 }

  mutating func recordReview(_ action: FeedbackAction, at date: Date) {
    primaryJudgments = min(primaryJudgments + 1, 999)
    if action == .star || action == .avoid {
      strongJudgments = min(strongJudgments + 1, 999)
    }
    lastInteractionAt = date
  }

  mutating func recordGalleryDismissal(at date: Date) {
    galleryDismissals = min(galleryDismissals + 1, 999)
    lastInteractionAt = date
  }
}

@MainActor
final class InteractionCoach: ObservableObject {
  static let storageKey = "shade.interactionCoach.v3"

  @Published private(set) var state: InteractionCoachState
  @Published private(set) var sessionCueAppeared = false

  private let defaults: UserDefaults
  private var sessionStarted = false

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    if AppEnv.isUITesting {
      state = Self.uiTestingState()
    } else if let data = defaults.data(forKey: Self.storageKey),
       var decoded = try? JSONDecoder().decode(InteractionCoachState.self, from: data) {
      decoded.hintVersion = InteractionCoachState.currentHintVersion
      state = decoded
    } else {
      state = Self.migrateLegacyState(from: defaults)
    }
    persist()
  }

  func beginSession() {
    guard !sessionStarted else { return }
    sessionStarted = true
    sessionCueAppeared = true
  }

  func recordReview(_ action: FeedbackAction, at date: Date = Date()) {
    state.recordReview(action, at: date)
    persist()
  }

  func recordGalleryDismissal(at date: Date = Date()) {
    state.recordGalleryDismissal(at: date)
    persist()
  }

  func recordInteraction(at date: Date = Date()) {
    state.lastInteractionAt = date
    persist()
  }

  func replayHints() {
    state.primaryJudgments = 0
    state.strongJudgments = 0
    state.galleryDismissals = 0
    sessionCueAppeared = true
    persist()
  }

  private func persist() {
    guard let data = try? JSONEncoder().encode(state) else { return }
    defaults.set(data, forKey: Self.storageKey)
  }

  private static func migrateLegacyState(from defaults: UserDefaults) -> InteractionCoachState {
    let primaryLearned = defaults.bool(forKey: "shade.swipeCoach.primaryLearned.v2")
      || defaults.bool(forKey: "shade.coachSeen.v1")
    let strongLearned = defaults.bool(forKey: "shade.swipeCoach.strongLearned.v2")
    return InteractionCoachState(
      primaryJudgments: primaryLearned ? 1 : 0,
      strongJudgments: strongLearned ? 1 : 0
    )
  }

  private static func uiTestingState() -> InteractionCoachState {
    let args = ProcessInfo.processInfo.arguments
    let galleryMastered: Bool
    if let index = args.firstIndex(of: "--gallery-coach"), args.indices.contains(index + 1) {
      galleryMastered = args[index + 1] == "mastered"
    } else {
      galleryMastered = false
    }
    return InteractionCoachState(galleryDismissals: galleryMastered ? 1 : 0)
  }
}
