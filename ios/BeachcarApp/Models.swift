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
  let selectorHits: [String: Int]?
  let detailAttempts: RunSourceDetailAttempts?
  let blockedUrls: [String]
  let cache: RunSourceCacheDiagnostic?

  enum CodingKeys: String, CodingKey {
    case source
    case site
    case status
    case label
    case message
    case candidateCount
    case selectorHits
    case detailAttempts
    case blockedUrls
    case cache
  }

  init(source: String, site: String, status: String, label: String? = nil, message: String? = nil, candidateCount: Int = 0) {
    self.source = source
    self.site = site
    self.status = status
    self.label = label
    self.message = message
    self.candidateCount = candidateCount
    self.selectorHits = nil
    self.detailAttempts = nil
    self.blockedUrls = []
    self.cache = nil
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    source = try container.decodeIfPresent(String.self, forKey: .source) ?? "source"
    site = try container.decodeIfPresent(String.self, forKey: .site) ?? source
    status = try container.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
    label = try container.decodeIfPresent(String.self, forKey: .label)
    message = try container.decodeIfPresent(String.self, forKey: .message)
    candidateCount = try container.decodeIfPresent(Int.self, forKey: .candidateCount) ?? 0
    selectorHits = try container.decodeIfPresent([String: Int].self, forKey: .selectorHits)
    detailAttempts = try container.decodeIfPresent(RunSourceDetailAttempts.self, forKey: .detailAttempts)
    blockedUrls = try container.decodeIfPresent([String].self, forKey: .blockedUrls) ?? []
    cache = try container.decodeIfPresent(RunSourceCacheDiagnostic.self, forKey: .cache)
  }
}

struct RunRunnerTaskSummary: Codable, Equatable, Identifiable {
  let id: String
  let source: String
  let kind: String
  let status: String
  let mergeStatus: String?
  let normalizedCandidateCount: Int?
  let importedCount: Int?
  let rejectedCount: Int?
  let rejectionReasons: [RunRunnerRejectionSummary]

  enum CodingKeys: String, CodingKey {
    case id
    case source
    case kind
    case status
    case mergeStatus
    case normalizedCandidateCount
    case importedCount
    case rejectedCount
    case rejectionReasons
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decodeIfPresent(String.self, forKey: .id) ?? "runner-task"
    source = try container.decodeIfPresent(String.self, forKey: .source) ?? "source"
    kind = try container.decodeIfPresent(String.self, forKey: .kind) ?? "source_discovery"
    status = try container.decodeIfPresent(String.self, forKey: .status) ?? "queued"
    mergeStatus = try container.decodeIfPresent(String.self, forKey: .mergeStatus)
    normalizedCandidateCount = try container.decodeIfPresent(Int.self, forKey: .normalizedCandidateCount)
    importedCount = try container.decodeIfPresent(Int.self, forKey: .importedCount)
    rejectedCount = try container.decodeIfPresent(Int.self, forKey: .rejectedCount)
    rejectionReasons = try container.decodeIfPresent([RunRunnerRejectionSummary].self, forKey: .rejectionReasons) ?? []
  }
}

struct RunSourceDetailAttempts: Codable, Equatable {
  let attempted: Int
  let enriched: Int
  let blocked: Int
  let failed: Int
  let empty: Int
  let blockedUrls: [String]?
  let failedUrls: [String]?
}

struct RunSourceCacheDiagnostic: Codable, Equatable {
  let status: String?
  let usableCount: Int?
  let searchedTerms: [String]?
  let latestIngestionAt: String?
  let refreshError: String?
}

struct RunRunnerRejectionSummary: Codable, Equatable {
  let reason: String
  let count: Int
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
  let bidCents: Int?
  let location: String?
  let locationRaw: String?
  let locationCity: String?
  let locationRegion: String?
  let locationCountry: String?
  let distanceMiles: Double?
  let locationStatus: String?
  let missingData: [String]
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
  let originalImages: [String]
  let imageStatus: [ListingImageStatus]
  let feedback: FeedbackRecord?
  /// Rich detail for the dossier. Optional and forward-compatible: today's runs
  /// don't include it, so dossier sections backed by it hide gracefully. When the
  /// agent/import contract starts emitting a `dossier` object per listing, these
  /// sections light up with no further client changes.
  let dossier: ShadeDossierData?

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
    case bidCents
    case location
    case locationRaw
    case locationCity
    case locationRegion
    case locationCountry
    case distanceMiles
    case locationStatus
    case missingData
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
    case originalImages
    case imageStatus
    case feedback
    case dossier
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
    bidCents = try container.decodeIfPresent(Int.self, forKey: .bidCents)
    location = AuctionListing.displayableLocation(try container.decodeLossyStringIfPresent(forKey: .location))
    locationRaw = AuctionListing.displayableLocation(try container.decodeLossyStringIfPresent(forKey: .locationRaw))
    locationCity = AuctionListing.displayableLocation(try container.decodeLossyStringIfPresent(forKey: .locationCity))
    locationRegion = AuctionListing.displayableLocation(try container.decodeLossyStringIfPresent(forKey: .locationRegion))
    locationCountry = AuctionListing.displayableLocation(try container.decodeLossyStringIfPresent(forKey: .locationCountry))
    distanceMiles = try container.decodeIfPresent(Double.self, forKey: .distanceMiles)
    locationStatus = try container.decodeLossyStringIfPresent(forKey: .locationStatus)
    missingData = try container.decodeIfPresent([String].self, forKey: .missingData) ?? []
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
    originalImages = try container.decodeIfPresent([String].self, forKey: .originalImages) ?? []
    imageStatus = try container.decodeIfPresent([ListingImageStatus].self, forKey: .imageStatus) ?? []
    feedback = try container.decodeIfPresent(FeedbackRecord.self, forKey: .feedback)
    dossier = try container.decodeIfPresent(ShadeDossierData.self, forKey: .dossier)
  }

  static func displayableLocation(_ value: String?) -> String? {
    guard let value else { return nil }
    let text = value
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    guard !text.isEmpty else { return nil }
    let lower = text.lowercased()
    if lower == "check" || lower == "location check" || lower == "check listing" || lower == "check the listing" { return nil }
    if lower.hasPrefix("check listing") || lower.hasPrefix("check the listing") { return nil }
    return text
  }

  var displayLocation: String? {
    AuctionListing.displayableLocation(location)
      ?? AuctionListing.displayableLocation(locationRaw)
      ?? structuredLocation
      ?? AuctionListing.displayableLocation(dossier?.beachUse?.location)
  }

  var displayLocationLabel: String {
    if let displayLocation { return displayLocation }
    if hasMissingLocation { return "Location missing" }
    return "Location pending"
  }

  var hasMissingLocation: Bool {
    guard displayLocation == nil else { return false }
    return locationStatus?.lowercased() == "missing"
      || missingData.contains(where: { $0.lowercased() == "location" })
  }

  private var structuredLocation: String? {
    let city = AuctionListing.displayableLocation(locationCity)
    let region = AuctionListing.displayableLocation(locationRegion)
    let country = AuctionListing.displayableLocation(locationCountry)
    let parts = [city, region, country].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: ", ")
  }

  var displayImages: [String] {
    let cached = imageStatus
      .filter { $0.copied || $0.status == "copied" }
      .map(\.url)
      .filter { !$0.isEmpty }
    return cached.isEmpty ? images : cached
  }

  var isWildcard: Bool {
    discoveryKind?.lowercased() == "wildcard"
  }
}

struct ListingImageStatus: Codable, Hashable {
  let imageKey: String
  let sourceUrl: String
  let url: String
  let copied: Bool
  let status: String
  let error: String?
}

// MARK: - Rich dossier payload (forward-compatible)
//
// Shape the agent/import contract can grow into. Every field is optional so the
// dossier degrades gracefully when a run omits it. See ShadeDossierView for how
// each maps to a section.

struct ShadeDossierData: Codable, Hashable {
  let summary: String?          // one-paragraph VEHICLE summary
  let specs: VehicleSpecs?
  let listing: [String]?        // FROM THE LISTING — full multi-paragraph writeup
  let equipment: [String]?      // EQUIPMENT & HIGHLIGHTS
  let service: [String]?        // RECENT SERVICE
  let bidLog: [BidEntry]?       // BIDDING history
  let comments: [CommentEntry]? // COMMENTS thread
  let beachUse: BeachUse?       // BEACH-USE FIT
  let valueScore: Double?       // 0…1 position on the value meter
}

struct VehicleSpecs: Codable, Hashable {
  let odometer: String?
  let engine: String?
  let transmission: String?
  let drivetrain: String?
  let exterior: String?
  let interior: String?
  let title: String?
  let seller: String?
  let lot: String?
}

struct BidEntry: Codable, Hashable {
  let bidder: String
  let amount: String
  let ago: String?
}

struct CommentEntry: Codable, Hashable {
  let user: String
  let body: String
  let ago: String?
  let seller: Bool?
}

struct BeachUse: Codable, Hashable {
  let body: String?
  let location: String?
  let people: String?
  let paperwork: String?
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
            "status": "completed",
            "mergeStatus": "merged",
            "normalizedCandidateCount": 1,
            "importedCount": 1,
            "rejectedCount": 0
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
          "images": [],
          "dossier": {
            "summary": "Two-owner Samurai wearing a fresh soft top, with recent brakes, tires, and a rebuilt carburetor. Sold on a clean Connecticut title with service records.",
            "specs": {
              "odometer": "74,210 mi",
              "engine": "1.3L inline-4",
              "transmission": "5-speed manual",
              "drivetrain": "4WD, low range",
              "exterior": "Forest Green",
              "interior": "Black vinyl",
              "title": "Clean · CT",
              "seller": "sand_dollar_42",
              "lot": "BaT #142,883"
            },
            "listing": [
              "This 1988 Suzuki Samurai convertible is finished in Forest Green over a black vinyl interior. Power comes from a 1.3-liter inline-four paired with a five-speed manual and a dual-range transfer case.",
              "The removable soft top was re-skinned with new canvas in 2023, and a set of 15-inch alloys is mounted with recent all-terrain tires. Work under current ownership includes a carburetor rebuild, a new fuel pump, fresh brake hydraulics, and an oil service.",
              "The truck is offered on a clean Connecticut title with a partial service history, a tool roll, and the owner's manual. Noted flaws are limited to minor surface rust on the rear bumper and a small tear in the driver's seat bolster."
            ],
            "equipment": [
              "Removable soft top + bikini top",
              "15\\" alloy wheels, A/T tires",
              "Dual-range 4WD transfer case",
              "Aftermarket lap belts, all seats"
            ],
            "service": [
              "2023 — new soft-top canvas",
              "2022 — carburetor rebuild, fuel pump",
              "2022 — brake hydraulics refreshed",
              "2021 — clutch replaced"
            ],
            "bidLog": [
              { "bidder": "mudterrain_mike", "amount": "$3,000", "ago": "2h" },
              { "bidder": "k_wagen", "amount": "$2,800", "ago": "5h" },
              { "bidder": "Opening bid", "amount": "$2,000", "ago": "1d" }
            ],
            "comments": [
              { "user": "carl_b", "body": "Underbody looks honest in the extra photos. GLWTA.", "ago": "3h" },
              { "user": "sand_dollar_42", "body": "Frame is all there, new canvas last summer.", "ago": "2h", "seller": true }
            ],
            "beachUse": {
              "body": "Open 4x4",
              "location": "New Canaan, CT",
              "people": "Confirm belts",
              "paperwork": "Title / history"
            },
            "valueScore": 0.12
          }
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
          "locationStatus": "missing",
          "missingData": ["location", "image"],
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
