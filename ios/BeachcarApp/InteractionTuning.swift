import Foundation
import SwiftUI
import UIKit

enum InteractionTuningPreset: String, Codable, CaseIterable, Identifiable {
  case quick
  case balanced
  case deliberate
  case custom

  var id: String { rawValue }

  var title: String {
    switch self {
    case .quick: "Quick"
    case .balanced: "Balanced"
    case .deliberate: "Deliberate"
    case .custom: "Custom"
    }
  }

  var detail: String {
    switch self {
    case .quick: "Light, responsive gestures"
    case .balanced: "A composed middle ground"
    case .deliberate: "More intentional travel"
    case .custom: "Your own calibrated feel"
    }
  }
}

enum InteractionHapticStyle: String, Codable, CaseIterable, Identifiable {
  case off
  case soft
  case standard
  case strong

  var id: String { rawValue }
  var title: String { rawValue.capitalized }
}

enum InteractionCoachingMode: String, Codable, CaseIterable, Identifiable {
  case adaptive
  case subtleEverySession
  case alwaysExplain

  var id: String { rawValue }

  var title: String {
    switch self {
    case .adaptive: "Adaptive"
    case .subtleEverySession: "Subtle each session"
    case .alwaysExplain: "Always explain"
    }
  }

  var detail: String {
    switch self {
    case .adaptive: "Hints retire as the gestures become familiar."
    case .subtleEverySession: "A compact reminder appears at the start of each session."
    case .alwaysExplain: "Keep directional guidance visible while reviewing."
    }
  }
}

struct InteractionTuningProfile: Codable, Equatable {
  static let currentVersion = 1

  var version = currentVersion
  var preset: InteractionTuningPreset
  var primaryCommitFraction: Double
  var strongCommitFraction: Double
  var galleryDismissFraction: Double
  var haptics: InteractionHapticStyle
  var coaching: InteractionCoachingMode

  static let quick = InteractionTuningProfile(
    preset: .quick,
    primaryCommitFraction: 0.28,
    strongCommitFraction: 0.64,
    galleryDismissFraction: 0.10,
    haptics: .soft,
    coaching: .adaptive
  )

  static let balanced = InteractionTuningProfile(
    preset: .balanced,
    primaryCommitFraction: 0.32,
    strongCommitFraction: 0.72,
    galleryDismissFraction: 0.13,
    haptics: .standard,
    coaching: .adaptive
  )

  static let deliberate = InteractionTuningProfile(
    preset: .deliberate,
    primaryCommitFraction: 0.38,
    strongCommitFraction: 0.80,
    galleryDismissFraction: 0.16,
    haptics: .strong,
    coaching: .adaptive
  )

  static func named(_ preset: InteractionTuningPreset) -> InteractionTuningProfile {
    switch preset {
    case .quick: .quick
    case .balanced, .custom: .balanced
    case .deliberate: .deliberate
    }
  }

  mutating func markCustom() {
    if self == .quick { preset = .quick }
    else if self == .balanced { preset = .balanced }
    else if self == .deliberate { preset = .deliberate }
    else { preset = .custom }
  }

  func normalized() -> InteractionTuningProfile {
    var copy = self
    copy.version = Self.currentVersion
    copy.primaryCommitFraction = clamp(copy.primaryCommitFraction, 0.28, 0.38)
    copy.strongCommitFraction = clamp(copy.strongCommitFraction, 0.64, 0.80)
    copy.galleryDismissFraction = clamp(copy.galleryDismissFraction, 0.10, 0.16)
    copy.markCustom()
    return copy
  }

  func changedControls(comparedWith other: InteractionTuningProfile) -> [String] {
    var changed: [String] = []
    if primaryCommitFraction != other.primaryCommitFraction { changed.append("swipe_commitment") }
    if strongCommitFraction != other.strongCommitFraction { changed.append("strong_commitment") }
    if galleryDismissFraction != other.galleryDismissFraction { changed.append("gallery_dismissal") }
    if haptics != other.haptics { changed.append("haptics") }
    if coaching != other.coaching { changed.append("coaching") }
    return changed
  }
}

@MainActor
final class InteractionTuning: ObservableObject {
  static let storageKey = "shade.interactionTuning.v1"

  @Published private(set) var selectedProfile: InteractionTuningProfile
  @Published private(set) var isRemotelyForcedBalanced = false

  private let defaults: UserDefaults
  private let storageKey: String

  var effectiveProfile: InteractionTuningProfile {
    isRemotelyForcedBalanced ? .balanced : selectedProfile
  }

  init(defaults: UserDefaults = .standard, storageScope: String? = nil) {
    self.defaults = defaults
    storageKey = Self.scopedKey(Self.storageKey, scope: storageScope)
    if AppEnv.isUITesting {
      selectedProfile = Self.uiTestingProfile()
    } else if let data = defaults.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode(InteractionTuningProfile.self, from: data) {
      selectedProfile = decoded.normalized()
    } else {
      selectedProfile = .balanced
    }
    persist()
  }

  func apply(_ profile: InteractionTuningProfile) {
    selectedProfile = profile.normalized()
    persist()
  }

  func restoreDefaults() {
    apply(.balanced)
  }

  func applyRemotePolicy(forceBalanced: Bool) {
    isRemotelyForcedBalanced = forceBalanced
  }

  func coachStage(for learnedStage: ReviewCoachStage) -> ReviewCoachStage {
    switch effectiveProfile.coaching {
    case .adaptive: learnedStage
    case .subtleEverySession, .alwaysExplain: .new
    }
  }

  private func persist() {
    guard !AppEnv.isUITesting, let data = try? JSONEncoder().encode(selectedProfile) else { return }
    defaults.set(data, forKey: storageKey)
  }

  private static func scopedKey(_ key: String, scope: String?) -> String {
    guard let scope, !scope.isEmpty else { return key }
    return "\(key).\(scope)"
  }

  private static func uiTestingProfile() -> InteractionTuningProfile {
    let args = ProcessInfo.processInfo.arguments
    guard let index = args.firstIndex(of: "--tuning-preset"), args.indices.contains(index + 1),
          let preset = InteractionTuningPreset(rawValue: args[index + 1]) else { return .balanced }
    return .named(preset)
  }
}

enum InteractionHapticMoment {
  case primaryGate
  case strongGate
  case committed(strong: Bool)
  case galleryGate
}

@MainActor
enum InteractionHaptics {
  static func fire(_ moment: InteractionHapticMoment, style: InteractionHapticStyle) {
    guard style != .off else { return }
    let multiplier: CGFloat = switch style {
    case .off: 0
    case .soft: 0.55
    case .standard: 0.78
    case .strong: 1
    }
    let generatorStyle: UIImpactFeedbackGenerator.FeedbackStyle = switch moment {
    case .primaryGate: style == .soft ? .soft : .rigid
    case .strongGate: .heavy
    case .committed(let strong): strong ? .heavy : (style == .soft ? .soft : .medium)
    case .galleryGate: style == .strong ? .rigid : .medium
    }
    let baseIntensity: CGFloat = switch moment {
    case .primaryGate: 0.58
    case .strongGate: 0.86
    case .committed(let strong): strong ? 0.94 : 0.76
    case .galleryGate: 0.72
    }
    UIImpactFeedbackGenerator(style: generatorStyle).impactOccurred(intensity: baseIntensity * multiplier)
  }
}
