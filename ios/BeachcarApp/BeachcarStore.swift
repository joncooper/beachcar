import Foundation
import SwiftUI

@MainActor
final class BeachcarStore: ObservableObject {
  @Published private(set) var run: RunPayload?
  @Published private(set) var feedbackByKey: [String: FeedbackRecord] = [:]
  @Published private(set) var pendingPreferenceNotes: [PendingPreferenceNote] = []
  @Published private(set) var isLoading = false
  @Published var errorMessage: String?
  @Published var lastUndo: UndoState?

  let api: AuctionAPI
  private let offlineMode: Bool
  private static let pendingPreferenceNotesKey = "beachcar.pendingPreferenceNotes.v1"

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
    self.pendingPreferenceNotes = Self.loadPendingPreferenceNotes()
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
      await retryPendingPreferenceNotes(authToken: token)
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

  func clearUndo(ifListingKey listingKey: String? = nil) {
    guard let lastUndo else { return }
    if listingKey == nil || lastUndo.listingKey == listingKey {
      self.lastUndo = nil
    }
  }

  func submitPreferenceNote(_ note: String, listing: AuctionListing?, tokenProvider: AuctionAPI.TokenProvider) async -> PreferenceNoteResult {
    let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .saved }
    let pending = PendingPreferenceNote(
      id: UUID().uuidString,
      listingKey: listing?.key,
      listingTitle: listing?.title,
      note: trimmed,
      tags: listing.map(tags(for:)) ?? [],
      createdAt: Date().ISO8601Format()
    )
    if offlineMode {
      enqueuePreferenceNote(pending)
      errorMessage = nil
      return .queued
    }
    do {
      let token = try await tokenProvider()
      try await sendPreferenceNote(pending, authToken: token)
      errorMessage = nil
      return .saved
    } catch {
      enqueuePreferenceNote(pending)
      errorMessage = nil
      return .queued
    }
  }

  private func sendPreferenceNote(_ pending: PendingPreferenceNote, authToken: String?) async throws {
    _ = try await api.preferenceEvent(
      listingKey: pending.listingKey,
      eventType: "voice_note",
      note: pending.note,
      transcript: pending.note,
      tags: pending.tags,
      authToken: authToken
    )
  }

  private func enqueuePreferenceNote(_ note: PendingPreferenceNote) {
    if pendingPreferenceNotes.contains(where: { $0.listingKey == note.listingKey && $0.note == note.note }) {
      persistPendingPreferenceNotes()
      return
    }
    pendingPreferenceNotes.append(note)
    persistPendingPreferenceNotes()
  }

  private func retryPendingPreferenceNotes(authToken: String?) async {
    guard !offlineMode, !pendingPreferenceNotes.isEmpty else { return }
    var remaining: [PendingPreferenceNote] = []
    for note in pendingPreferenceNotes {
      do {
        try await sendPreferenceNote(note, authToken: authToken)
      } catch {
        remaining.append(note)
      }
    }
    if remaining.count != pendingPreferenceNotes.count {
      pendingPreferenceNotes = remaining
      persistPendingPreferenceNotes()
    }
  }

  private static func loadPendingPreferenceNotes() -> [PendingPreferenceNote] {
    guard let data = UserDefaults.standard.data(forKey: pendingPreferenceNotesKey) else { return [] }
    return (try? JSONDecoder().decode([PendingPreferenceNote].self, from: data)) ?? []
  }

  private func persistPendingPreferenceNotes() {
    if pendingPreferenceNotes.isEmpty {
      UserDefaults.standard.removeObject(forKey: Self.pendingPreferenceNotesKey)
      return
    }
    if let data = try? JSONEncoder().encode(pendingPreferenceNotes) {
      UserDefaults.standard.set(data, forKey: Self.pendingPreferenceNotesKey)
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
