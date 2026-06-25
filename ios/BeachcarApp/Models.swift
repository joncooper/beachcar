import Foundation

enum Lane: String, Codable, CaseIterable {
  case family
  case solo
  case curiosity

  var label: String {
    switch self {
    case .family: "Family"
    case .solo: "Solo"
    case .curiosity: "Curiosity"
    }
  }
}

enum FeedbackAction: String, Codable {
  case like
  case star
  case hide
  case avoid

  var label: String {
    switch self {
    case .like: "Liked"
    case .star: "Starred"
    case .hide: "Hidden"
    case .avoid: "Avoid similar"
    }
  }
}

enum UserStatus: String, Codable {
  case invited
  case active
  case disabled
}

struct UserPayload: Decodable, Equatable, Identifiable {
  let id: String
  let email: String
  let displayName: String?
  let status: UserStatus
  let profile: UserProfile?
  let onboarding: UserOnboarding?

  var onboardingCompleted: Bool {
    onboarding?.completed == true || profile?.onboardingCompletedAt != nil
  }
}

struct UserOnboarding: Decodable, Equatable {
  let completed: Bool
  let completedAt: String?
}

struct UserProfile: Decodable, Equatable {
  let userId: String
  let displayName: String?
  let niche: String
  let budgetMin: Int?
  let budgetMax: Int?
  let stretchBudget: Int?
  let homeRegion: String?
  let timezone: String
  let scheduleCron: String
  let onboardingCompletedAt: String?
  let updatedAt: String
}

struct ProfileInput: Encodable, Equatable {
  let displayName: String?
  let niche: String
  let budgetMax: Int?
  let stretchBudget: Int?
  let homeRegion: String?
  let timezone: String
  let profile: ProfilePreferences
  let sourceSettings: SourceSettingsRequest
  let completeOnboarding: Bool
}

struct ProfilePreferences: Encodable, Equatable {
  let tasteNotes: String
  let avoidNotes: String
  let lanes: [String]
  let sources: [String]
  let sourcePreferences: [SourceSettingInput]
  let notifications: NotificationPreferences
}

struct NotificationPreferences: Encodable, Equatable {
  let channel: String
  let runDigest: Bool
  let strongFitAlerts: Bool
  let digestTime: String
}

struct SourceSettingsRequest: Encodable, Equatable {
  let sources: [SourceSettingInput]
}

struct SourceSettingInput: Encodable, Equatable {
  let source: String
  let enabled: Bool
  let settings: SourcePreferenceSettings
}

struct SourcePreferenceSettings: Encodable, Equatable {
  let maxDistanceMiles: Int?
  let maxBudgetCents: Int?
  let noReserveOnly: Bool
  let browserRunner: Bool
  let searchNotes: String?
}

extension UserPayload {
  static var uiTestingInvited: UserPayload {
    UserPayload(
      id: "email:friend@example.com",
      email: "friend@example.com",
      displayName: nil,
      status: .invited,
      profile: nil,
      onboarding: UserOnboarding(completed: false, completedAt: nil)
    )
  }

  static var uiTestingNeedsOnboarding: UserPayload {
    UserPayload(
      id: "email:friend@example.com",
      email: "friend@example.com",
      displayName: "Friend",
      status: .active,
      profile: .uiTesting(completed: false),
      onboarding: UserOnboarding(completed: false, completedAt: nil)
    )
  }

  static var uiTestingActive: UserPayload {
    UserPayload(
      id: "email:friend@example.com",
      email: "friend@example.com",
      displayName: "Friend",
      status: .active,
      profile: .uiTesting(completed: true),
      onboarding: UserOnboarding(completed: true, completedAt: "2026-06-25T12:00:00.000Z")
    )
  }
}

extension UserProfile {
  static func uiTesting(completed: Bool) -> UserProfile {
    UserProfile(
      userId: "email:friend@example.com",
      displayName: "Friend",
      niche: "Beach cars and runabouts",
      budgetMin: nil,
      budgetMax: 30000,
      stretchBudget: 2000,
      homeRegion: "Northeast",
      timezone: "America/New_York",
      scheduleCron: "0 8 * * *",
      onboardingCompletedAt: completed ? "2026-06-25T12:00:00.000Z" : nil,
      updatedAt: "2026-06-25T12:00:00.000Z"
    )
  }
}

struct RunPayload: Codable {
  let id: String?
  let generatedAt: String?
  let sourceSummary: RunSourceSummary?
  let listings: [AuctionListing]
  let feedback: [FeedbackRecord]
}

enum AgentRunStatus: String, Decodable, Equatable {
  case queued
  case running
  case published
  case failed
  case cancelled

  var label: String {
    switch self {
    case .queued: "Queued"
    case .running: "Running"
    case .published: "Published"
    case .failed: "Failed"
    case .cancelled: "Cancelled"
    }
  }
}

struct AgentRunRecord: Decodable, Equatable, Identifiable {
  let id: String
  let userId: String
  let workflowInstanceId: String?
  let status: AgentRunStatus
  let error: String?
  let startedAt: String?
  let finishedAt: String?
  let createdAt: String
  let updatedAt: String
}

struct RunSourceSummary: Codable, Equatable {
  let checkedSources: [RunSourceCheck]
  let blockedSources: [RunSourceCheck]
  let runnerTasks: [RunRunnerTaskSummary]
  let rawCandidateCount: Int?
  let feedbackCount: Int?
  let fallbackUsed: Bool?
  let aiScoring: RunAiScoringSummary?

  enum CodingKeys: String, CodingKey {
    case checkedSources
    case blockedSources
    case runnerTasks
    case rawCandidateCount
    case feedbackCount
    case fallbackUsed
    case aiScoring
  }

  init(
    checkedSources: [RunSourceCheck] = [],
    blockedSources: [RunSourceCheck] = [],
    runnerTasks: [RunRunnerTaskSummary] = [],
    rawCandidateCount: Int? = nil,
    feedbackCount: Int? = nil,
    fallbackUsed: Bool? = nil,
    aiScoring: RunAiScoringSummary? = nil
  ) {
    self.checkedSources = checkedSources
    self.blockedSources = blockedSources
    self.runnerTasks = runnerTasks
    self.rawCandidateCount = rawCandidateCount
    self.feedbackCount = feedbackCount
    self.fallbackUsed = fallbackUsed
    self.aiScoring = aiScoring
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    checkedSources = try container.decodeIfPresent([RunSourceCheck].self, forKey: .checkedSources) ?? []
    blockedSources = try container.decodeIfPresent([RunSourceCheck].self, forKey: .blockedSources) ?? []
    runnerTasks = try container.decodeIfPresent([RunRunnerTaskSummary].self, forKey: .runnerTasks) ?? []
    rawCandidateCount = try container.decodeIfPresent(Int.self, forKey: .rawCandidateCount)
    feedbackCount = try container.decodeIfPresent(Int.self, forKey: .feedbackCount)
    fallbackUsed = try container.decodeIfPresent(Bool.self, forKey: .fallbackUsed)
    aiScoring = try container.decodeIfPresent(RunAiScoringSummary.self, forKey: .aiScoring)
  }
}

struct RunSourceCheck: Codable, Equatable, Identifiable {
  var id: String { "\(source):\(label ?? site):\(status)" }
  let source: String
  let site: String
  let status: String
  let label: String?
  let message: String?
  let candidateCount: Int

  enum CodingKeys: String, CodingKey {
    case source
    case site
    case status
    case label
    case message
    case candidateCount
  }

  init(source: String, site: String, status: String, label: String? = nil, message: String? = nil, candidateCount: Int = 0) {
    self.source = source
    self.site = site
    self.status = status
    self.label = label
    self.message = message
    self.candidateCount = candidateCount
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    source = try container.decodeIfPresent(String.self, forKey: .source) ?? "source"
    site = try container.decodeIfPresent(String.self, forKey: .site) ?? source
    status = try container.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
    label = try container.decodeIfPresent(String.self, forKey: .label)
    message = try container.decodeIfPresent(String.self, forKey: .message)
    candidateCount = try container.decodeIfPresent(Int.self, forKey: .candidateCount) ?? 0
  }
}

struct RunRunnerTaskSummary: Codable, Equatable, Identifiable {
  let id: String
  let source: String
  let kind: String
  let status: String
}

struct RunAiScoringSummary: Codable, Equatable {
  let status: String
  let provider: String?
  let model: String?
  let totalTokens: Int?
  let costMicros: Int?
  let message: String?
}

struct AuctionListing: Codable, Identifiable, Hashable {
  let listingKey: String?
  let section: String
  let lane: Lane
  let discoveryKind: String?
  let discoveryReasons: [String]
  let wildcardReason: String?
  let noveltyScore: Double?
  let site: String
  let title: String
  let url: String
  let bid: String
  let total: String
  let location: String?
  let endsAt: String?
  let ends: String?
  let timeLeft: String?
  let bids: String?
  let bidders: String?
  let comments: String?
  let fair: String?
  let ceiling: String?
  let confidence: String?
  let why: String
  let concerns: String
  let currentTake: String?
  let images: [String]
  let feedback: FeedbackRecord?

  var id: String { listingKey ?? url }
  var key: String { listingKey ?? url }

  enum CodingKeys: String, CodingKey {
    case listingKey
    case section
    case lane
    case discoveryKind
    case discoveryReasons
    case wildcardReason
    case noveltyScore
    case site
    case title
    case url
    case bid
    case total
    case location
    case endsAt
    case ends
    case timeLeft
    case bids
    case bidders
    case comments
    case fair
    case ceiling
    case confidence = "conf"
    case why
    case concerns
    case currentTake
    case images
    case feedback
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    listingKey = try container.decodeIfPresent(String.self, forKey: .listingKey)
    section = try container.decodeIfPresent(String.self, forKey: .section) ?? "Worth a look"
    lane = try container.decodeIfPresent(Lane.self, forKey: .lane) ?? .family
    discoveryKind = try container.decodeLossyStringIfPresent(forKey: .discoveryKind)
    discoveryReasons = try container.decodeIfPresent([String].self, forKey: .discoveryReasons) ?? []
    wildcardReason = try container.decodeLossyStringIfPresent(forKey: .wildcardReason)
    noveltyScore = try container.decodeIfPresent(Double.self, forKey: .noveltyScore)
    site = try container.decodeIfPresent(String.self, forKey: .site) ?? "Unknown"
    title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Untitled listing"
    url = try container.decodeIfPresent(String.self, forKey: .url) ?? ""
    bid = try container.decodeLossyStringIfPresent(forKey: .bid) ?? "Check listing"
    total = try container.decodeLossyStringIfPresent(forKey: .total) ?? "Check listing"
    location = try container.decodeLossyStringIfPresent(forKey: .location)
    endsAt = try container.decodeLossyStringIfPresent(forKey: .endsAt)
    ends = try container.decodeLossyStringIfPresent(forKey: .ends)
    timeLeft = try container.decodeLossyStringIfPresent(forKey: .timeLeft)
    bids = try container.decodeLossyStringIfPresent(forKey: .bids)
    bidders = try container.decodeLossyStringIfPresent(forKey: .bidders)
    comments = try container.decodeLossyStringIfPresent(forKey: .comments)
    fair = try container.decodeLossyStringIfPresent(forKey: .fair)
    ceiling = try container.decodeLossyStringIfPresent(forKey: .ceiling)
    confidence = try container.decodeLossyStringIfPresent(forKey: .confidence)
    why = try container.decodeIfPresent(String.self, forKey: .why) ?? ""
    concerns = try container.decodeIfPresent(String.self, forKey: .concerns) ?? ""
    currentTake = try container.decodeLossyStringIfPresent(forKey: .currentTake)
    images = try container.decodeIfPresent([String].self, forKey: .images) ?? []
    feedback = try container.decodeIfPresent(FeedbackRecord.self, forKey: .feedback)
  }

  var isWildcard: Bool {
    discoveryKind?.lowercased() == "wildcard"
  }
}

struct FeedbackRecord: Codable, Hashable {
  let listingKey: String
  let action: FeedbackAction
  let tags: [String]
  let note: String?
  let updatedAt: String
}

struct PreferenceEvent: Decodable {
  let id: String
  let listingKey: String?
  let eventType: String
  let note: String?
  let transcript: String?
  let tags: [String]
  let createdAt: String
}

struct PendingPreferenceNote: Codable, Identifiable, Equatable {
  let id: String
  let listingKey: String?
  let listingTitle: String?
  let note: String
  let tags: [String]
  let createdAt: String
}

enum PreferenceNoteResult: Equatable {
  case saved
  case queued
}

private extension KeyedDecodingContainer {
  func decodeLossyStringIfPresent(forKey key: Key) throws -> String? {
    if let value = try? decodeIfPresent(String.self, forKey: key) {
      return value
    }
    if let value = try? decodeIfPresent(Int.self, forKey: key) {
      return String(value)
    }
    if let value = try? decodeIfPresent(Double.self, forKey: key) {
      return value.rounded() == value ? String(Int(value)) : String(value)
    }
    if let value = try? decodeIfPresent(Bool.self, forKey: key) {
      return String(value)
    }
    return nil
  }
}

extension RunPayload {
  static var uiTestingFixture: RunPayload {
    let json = """
    {
      "id": "ui-test-run",
      "generatedAt": "2026-06-23T12:00:00.000Z",
      "sourceSummary": {
        "checkedSources": [
          {
            "source": "bringatrailer",
            "site": "Bring a Trailer",
            "status": "ok",
            "label": "Volkswagen Thing",
            "candidateCount": 1,
            "message": "Parsed live keyword-page listing cards."
          },
          {
            "source": "carsandbids",
            "site": "Cars & Bids",
            "status": "blocked",
            "candidateCount": 0,
            "message": "Fetch reached a bot/access challenge."
          }
        ],
        "blockedSources": [
          {
            "source": "carsandbids",
            "site": "Cars & Bids",
            "status": "blocked",
            "candidateCount": 0,
            "message": "Fetch reached a bot/access challenge."
          }
        ],
        "runnerTasks": [
          {
            "id": "runner-task-browser-source-carsandbids-ui-test",
            "source": "carsandbids",
            "kind": "browser_source",
            "status": "queued"
          }
        ],
        "rawCandidateCount": 12,
        "feedbackCount": 4,
        "fallbackUsed": false,
        "aiScoring": {
          "status": "skipped",
          "provider": "ai-gateway",
          "totalTokens": 0,
          "costMicros": 0,
          "message": "AI rerank was not applied."
        }
      },
      "feedback": [],
      "listings": [
        {
          "listingKey": "ui-test-samurai",
          "section": "Strong fits",
          "lane": "family",
          "discoveryKind": "core",
          "discoveryReasons": ["open-air", "kid-plausible"],
          "site": "BaT",
          "title": "1988 Suzuki Samurai Convertible 5-Speed",
          "url": "https://example.com/samurai",
          "bid": "$3,000",
          "total": "$3,250",
          "location": "New Canaan, CT",
          "timeLeft": "1 day, 4h",
          "bids": "4",
          "bidders": "3",
          "comments": "12",
          "fair": "$8k-$13k fair hammer",
          "ceiling": "Stop around $12k",
          "conf": "medium",
          "why": "Open-air, light, local-beach friendly, and usable for short school runs with diligence on belts.",
          "concerns": "Rust, title status, rear belts, highway manners",
          "currentTake": "bargain watch",
          "images": []
        },
        {
          "listingKey": "ui-test-trail",
          "section": "Solo runabouts",
          "lane": "solo",
          "discoveryKind": "adjacent",
          "discoveryReasons": ["small Honda", "solo town run"],
          "site": "BaT",
          "title": "1971 Honda Trail 90",
          "url": "https://example.com/trail90",
          "bid": "$2,200",
          "total": "$2,310",
          "location": "Brooklyn, NY",
          "timeLeft": "6h",
          "bids": "8",
          "bidders": "5",
          "comments": "7",
          "fair": "$3k-$4k",
          "ceiling": "Stop around $3.5k",
          "conf": "medium",
          "why": "Small, cheerful solo runabout for quick errands where the Tuareg is too much.",
          "concerns": "Registration, lighting, tire age",
          "currentTake": "tiny errand bike",
          "images": []
        },
        {
          "listingKey": "ui-test-wildcard",
          "section": "Curiosities/stretch listings",
          "lane": "curiosity",
          "discoveryKind": "wildcard",
          "discoveryReasons": ["road-legal oddball", "cheap weirdness"],
          "wildcardReason": "A road-legal oddball that still has a plausible beach-town use case.",
          "noveltyScore": 0.86,
          "site": "Cars & Bids",
          "title": "1974 Citicar Electric Runabout",
          "url": "https://example.com/citicar",
          "bid": "$6,100",
          "total": "$6,405",
          "location": "Providence, RI",
          "timeLeft": "3 days",
          "bids": "11",
          "bidders": "6",
          "comments": "20",
          "fair": "$7k-$10k",
          "ceiling": "Stop around $8.5k",
          "conf": "low",
          "why": "Too weird to ignore, but only if charging, title, and local-road practicality check out.",
          "concerns": "Battery health, charger, CT registration, crash protection",
          "currentTake": "wildcard weirdness",
          "images": []
        }
      ]
    }
    """
    let data = Data(json.utf8)
    return try! JSONDecoder().decode(RunPayload.self, from: data)
  }
}

extension AgentRunRecord {
  static var uiTestingPublished: AgentRunRecord {
    AgentRunRecord(
      id: "agent-run-ui-test",
      userId: "email:friend@example.com",
      workflowInstanceId: "workflow-agent-run-ui-test",
      status: .published,
      error: nil,
      startedAt: "2026-06-23T12:00:00.000Z",
      finishedAt: "2026-06-23T12:02:00.000Z",
      createdAt: "2026-06-23T12:00:00.000Z",
      updatedAt: "2026-06-23T12:02:00.000Z"
    )
  }
}
