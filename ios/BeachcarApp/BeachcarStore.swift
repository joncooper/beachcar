import Foundation
import SwiftUI

@MainActor
final class BeachcarStore: ObservableObject {
  @Published private(set) var run: RunPayload?
  @Published private(set) var feedbackByKey: [String: FeedbackRecord] = [:]
  @Published private(set) var isLoading = false
  @Published var errorMessage: String?
  @Published var lastUndo: UndoState?

  let api: AuctionAPI
  private let offlineMode: Bool

  init(
    api: AuctionAPI = AuctionAPI(baseURL: AppConfig.auctionBaseURL),
    initialRun: RunPayload? = nil,
    initialFeedback: [String: FeedbackRecord] = [:],
    offlineMode: Bool = false
  ) {
    self.api = api
    self.run = initialRun
    self.feedbackByKey = initialFeedback
    self.offlineMode = offlineMode
  }

  var generatedLabel: String {
    guard let generatedAt = run?.generatedAt else { return "No run" }
    guard let date = Self.parseISODate(generatedAt) else { return "Updated" }
    if Calendar.current.isDateInToday(date) {
      return date.formatted(date: .omitted, time: .shortened)
    }
    return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
  }

  private static func parseISODate(_ value: String) -> Date? {
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractionalFormatter.date(from: value) {
      return date
    }
    return ISO8601DateFormatter().date(from: value)
  }

  var visibleListings: [AuctionListing] {
    orderedListings(includeHidden: false)
  }

  func orderedListings(includeHidden: Bool) -> [AuctionListing] {
    guard let run else { return [] }
    return run.listings
      .filter { listing in
        let action = feedbackByKey[listing.key]?.action
        return includeHidden || (action != .hide && action != .avoid)
      }
      .sorted { left, right in
        sortScore(left) < sortScore(right)
      }
  }

  func load(tokenProvider: AuctionAPI.TokenProvider) async {
    guard !isLoading else { return }
    isLoading = true
    defer { isLoading = false }
    do {
      let token = try await tokenProvider()
      let payload = try await api.latestRun(authToken: token)
      run = payload
      var overlay = Dictionary(uniqueKeysWithValues: payload.feedback.map { ($0.listingKey, $0) })
      for listing in payload.listings {
        if let feedback = listing.feedback {
          overlay[listing.key] = feedback
        }
      }
      feedbackByKey = overlay
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  func mark(_ action: FeedbackAction, listing: AuctionListing, tokenProvider: AuctionAPI.TokenProvider) async {
    let previous = feedbackByKey[listing.key]
    let optimistic = FeedbackRecord(
      listingKey: listing.key,
      action: action,
      tags: tags(for: listing),
      note: nil,
      updatedAt: Date().ISO8601Format()
    )
    feedbackByKey[listing.key] = optimistic
    lastUndo = UndoState(listingKey: listing.key, previous: previous)
    if offlineMode {
      errorMessage = nil
      return
    }
    do {
      let token = try await tokenProvider()
      let saved = try await api.putFeedback(
        listingKey: listing.key,
        action: action,
        tags: optimistic.tags,
        authToken: token
      )
      feedbackByKey[listing.key] = saved
      errorMessage = nil
    } catch {
      if let previous {
        feedbackByKey[listing.key] = previous
      } else {
        feedbackByKey.removeValue(forKey: listing.key)
      }
      errorMessage = error.localizedDescription
    }
  }

  func undo(tokenProvider: AuctionAPI.TokenProvider) async {
    guard let undo = lastUndo else { return }
    lastUndo = nil
    if offlineMode {
      if let previous = undo.previous {
        feedbackByKey[undo.listingKey] = previous
      } else {
        feedbackByKey.removeValue(forKey: undo.listingKey)
      }
      errorMessage = nil
      return
    }
    do {
      let token = try await tokenProvider()
      if let previous = undo.previous {
        let saved = try await api.putFeedback(
          listingKey: undo.listingKey,
          action: previous.action,
          note: previous.note,
          tags: previous.tags,
          authToken: token
        )
        feedbackByKey[undo.listingKey] = saved
      } else {
        try await api.deleteFeedback(listingKey: undo.listingKey, authToken: token)
        feedbackByKey.removeValue(forKey: undo.listingKey)
      }
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  func submitPreferenceNote(_ note: String, listing: AuctionListing?, tokenProvider: AuctionAPI.TokenProvider) async {
    let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    if offlineMode {
      errorMessage = nil
      return
    }
    do {
      let token = try await tokenProvider()
      _ = try await api.preferenceEvent(
        listingKey: listing?.key,
        eventType: "voice_note",
        note: trimmed,
        transcript: trimmed,
        tags: listing.map(tags(for:)) ?? [],
        authToken: token
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func sortScore(_ listing: AuctionListing) -> Int {
    switch feedbackByKey[listing.key]?.action {
    case nil: 0
    case .star?: 1
    case .like?: 2
    case .hide?, .avoid?: 4
    }
  }

  private func tags(for listing: AuctionListing) -> [String] {
    [listing.lane.rawValue, listing.section, listing.currentTake]
      .compactMap { $0 }
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
  }
}

struct UndoState {
  let listingKey: String
  let previous: FeedbackRecord?
}

extension BeachcarStore {
  static func uiTesting() -> BeachcarStore {
    BeachcarStore(initialRun: .uiTestingFixture, offlineMode: true)
  }
}
