import ClerkKit
import ClerkKitUI
import SwiftUI

struct BeachcarDeckView: View {
  @ObservedObject var store: BeachcarStore
  let tokenProvider: AuctionAPI.TokenProvider

  @State private var showFilters = false
  @State private var filter: DeckFilter = .all
  @State private var showHidden = false
  @State private var searchText = ""
  @State private var viewMode: DeckViewMode = .deck
  @State private var listDetailListing: AuctionListing?
  @State private var undoDismissTask: Task<Void, Never>?

  var body: some View {
    VStack(spacing: 0) {
      header
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 6)

      if let error = store.errorMessage {
        Text(error)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.white)
          .padding(.horizontal, 14)
          .padding(.vertical, 9)
          .background(Color.red.opacity(0.88), in: Capsule())
          .padding(.bottom, 8)
      }

      if !store.pendingPreferenceNotes.isEmpty {
        Label("\(store.pendingPreferenceNotes.count) steering note\(store.pendingPreferenceNotes.count == 1 ? "" : "s") queued", systemImage: "arrow.clockwise.circle.fill")
          .font(.footnote.weight(.bold))
          .foregroundStyle(BeachcarColors.secondary)
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
          .background(.white.opacity(0.76), in: Capsule())
          .padding(.bottom, 8)
      }

      if store.isLoading && store.run == nil {
        loadingView
      } else if filteredListings.isEmpty {
        emptyView
      } else {
        switch viewMode {
        case .deck:
          deck
        case .list:
          listView
        }
      }
    }
    .safeAreaInset(edge: .bottom) {
      if let undo = store.lastUndo {
        UndoBar(label: "Saved feedback", undoLabel: undo.previous == nil ? "Clear" : "Undo") {
          Task { await store.undo(tokenProvider: tokenProvider) }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
      }
    }
    .refreshable {
      await store.load(tokenProvider: tokenProvider)
    }
    .sheet(item: $listDetailListing) { listing in
      ListingDetailSheet(
        listing: listing,
        feedback: store.feedbackByKey[listing.key],
        api: store.api,
        tokenProvider: tokenProvider,
        onAction: { action in
          await store.mark(action, listing: listing, tokenProvider: tokenProvider)
        },
        onNote: { note in
          await store.submitPreferenceNote(note, listing: listing, tokenProvider: tokenProvider)
        }
      )
      .presentationDetents([.large])
      .presentationDragIndicator(.visible)
    }
    .onChange(of: store.lastUndo?.listingKey) { _, listingKey in
      undoDismissTask?.cancel()
      guard let listingKey else { return }
      undoDismissTask = Task {
        try? await Task.sleep(for: .seconds(4.5))
        guard !Task.isCancelled else { return }
        await MainActor.run {
          withAnimation(.snappy(duration: 0.22)) {
            store.clearUndo(ifListingKey: listingKey)
          }
        }
      }
    }
    .onDisappear {
      undoDismissTask?.cancel()
    }
  }

  private var header: some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(AppConfig.appName)
          .font(.system(size: 22, weight: .black, design: .rounded))
        Text(headerSummary)
          .font(.caption.weight(.semibold))
          .lineLimit(1)
          .minimumScaleFactor(0.82)
          .foregroundStyle(BeachcarColors.secondary)
          .accessibilityIdentifier("filter-summary")
      }
      Spacer()
      DeckModeToggle(mode: $viewMode)
      Button {
        showFilters = true
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "slider.horizontal.3")
          Text(filtersAreActive ? filter.shortLabel : "Filters")
            .font(.caption2.weight(.black))
        }
        .font(.system(size: 16, weight: .bold))
        .padding(.horizontal, 11)
        .frame(minHeight: 38)
        .background(filterButtonBackground, in: Capsule())
      }
      .foregroundStyle(BeachcarColors.ink)
      .accessibilityIdentifier("filter-button")
      UserButton(signedOutContent: { EmptyView() })
        .frame(width: 38, height: 38)
    }
    .sheet(isPresented: $showFilters) {
      FilterSheet(
        filter: $filter,
        searchText: $searchText,
        showHidden: $showHidden,
        hiddenCount: hiddenCount,
        totalCount: store.run?.listings.count ?? 0,
        visibleCount: filteredListings.count
      )
      .presentationDetents([.height(350), .medium])
      .presentationDragIndicator(.visible)
    }
  }

  private var deck: some View {
    ScrollViewReader { proxy in
      ScrollView(.vertical) {
        LazyVStack(spacing: 14) {
          ForEach(Array(filteredListings.enumerated()), id: \.element.id) { index, listing in
            ListingCardView(
              listing: listing,
              feedback: store.feedbackByKey[listing.key],
              api: store.api,
              tokenProvider: tokenProvider,
              onAction: { action in
                let nextListingId = filteredListings.indices.contains(index + 1) ? filteredListings[index + 1].id : nil
                await store.mark(action, listing: listing, tokenProvider: tokenProvider)
                advance(to: nextListingId, proxy: proxy)
              },
              onNote: { note in
                await store.submitPreferenceNote(note, listing: listing, tokenProvider: tokenProvider)
              }
            )
            .id(listing.id)
            .containerRelativeFrame(.vertical)
          }
        }
        .scrollTargetLayout()
      }
      .scrollIndicators(.hidden)
      .scrollTargetBehavior(.paging)
    }
  }

  private var listView: some View {
    ScrollView {
      LazyVStack(spacing: 10) {
        ForEach(filteredListings) { listing in
          Button {
            listDetailListing = listing
          } label: {
            ListingListRow(
              listing: listing,
              feedback: store.feedbackByKey[listing.key],
              api: store.api
            )
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("list-row-\(listing.id)")
        }
      }
      .padding(.horizontal, 14)
      .padding(.top, 8)
      .padding(.bottom, 24)
    }
    .scrollIndicators(.hidden)
    .accessibilityIdentifier("list-mode-view")
  }

  private func advance(to listingId: String?, proxy: ScrollViewProxy) {
    guard let listingId else { return }
    withAnimation(.snappy(duration: 0.38)) {
      proxy.scrollTo(listingId, anchor: .top)
    }
  }

  private var loadingView: some View {
    VStack(spacing: 16) {
      ProgressView()
        .controlSize(.large)
      Text("Loading today's watch...")
        .font(.headline)
        .foregroundStyle(BeachcarColors.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var emptyView: some View {
    VStack(spacing: 12) {
      Image(systemName: "car.side.lock")
        .font(.system(size: 42, weight: .semibold))
      Text(store.run?.listings.isEmpty == false ? "No cards match" : "No cards to review")
        .font(.title2.bold())
      Text(store.run?.listings.isEmpty == false ? "Adjust filters or show hidden cards." : "Pull to refresh, or check the PWA/admin output if today's run has not published yet.")
        .font(.body)
        .foregroundStyle(BeachcarColors.secondary)
        .multilineTextAlignment(.center)
    }
    .padding(28)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var filteredListings: [AuctionListing] {
    let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return store.orderedListings(includeHidden: showHidden)
      .filter { listing in
        filter.includes(listing: listing, feedback: store.feedbackByKey[listing.key])
      }
      .filter { listing in
        guard !query.isEmpty else { return true }
        return listing.searchBlob.contains(query)
      }
  }

  private var hiddenCount: Int {
    store.feedbackByKey.values.filter { $0.action == .hide || $0.action == .avoid }.count
  }

  private var headerSummary: String {
    guard store.run != nil else { return "No cards loaded" }
    let count = filteredListings.count
    let noun = count == 1 ? "card" : "cards"
    if !filtersAreActive {
      return "\(count) \(noun) - updated \(store.generatedLabel)"
    }
    return "\(count) \(noun) - \(filter.label.lowercased())"
  }

  private var filtersAreActive: Bool {
    filter != .all || showHidden || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private var filterButtonBackground: Color {
    filtersAreActive ? BeachcarColors.mint.opacity(0.34) : .white.opacity(0.78)
  }
}

private enum DeckViewMode: String, CaseIterable, Identifiable {
  case deck
  case list

  var id: String { rawValue }

  var label: String {
    switch self {
    case .deck: "Deck"
    case .list: "List"
    }
  }

  var systemImage: String {
    switch self {
    case .deck: "rectangle.stack"
    case .list: "list.bullet"
    }
  }
}

private struct DeckModeToggle: View {
  @Binding var mode: DeckViewMode

  var body: some View {
    HStack(spacing: 3) {
      ForEach(DeckViewMode.allCases) { option in
        Button {
          mode = option
        } label: {
          Text(option.label)
            .font(.caption.weight(.black))
            .lineLimit(1)
            .minimumScaleFactor(0.86)
            .frame(width: 48, height: 32)
            .background(mode == option ? BeachcarColors.ink : .clear, in: Capsule())
            .foregroundStyle(mode == option ? .white : BeachcarColors.ink)
        }
        .accessibilityIdentifier("mode-\(option.rawValue)")
      }
    }
    .padding(3)
    .background(.white.opacity(0.78), in: Capsule())
  }
}

private enum DeckFilter: String, CaseIterable, Identifiable {
  case all
  case family
  case solo
  case curiosity
  case starred
  case wildcard
  case endingSoon

  var id: String { rawValue }

  var label: String {
    switch self {
    case .all: "All"
    case .family: "Family"
    case .solo: "Solo"
    case .curiosity: "Curiosity"
    case .starred: "Starred"
    case .wildcard: "Wildcard"
    case .endingSoon: "Ending soon"
    }
  }

  var shortLabel: String {
    switch self {
    case .endingSoon: "Soon"
    default: label
    }
  }

  var systemImage: String {
    switch self {
    case .all: "square.grid.2x2"
    case .family: "figure.2.and.child.holdinghands"
    case .solo: "person"
    case .curiosity: "sparkles"
    case .starred: "star.fill"
    case .wildcard: "shuffle"
    case .endingSoon: "timer"
    }
  }

  func includes(listing: AuctionListing, feedback: FeedbackRecord?) -> Bool {
    switch self {
    case .all: true
    case .family: listing.lane == .family
    case .solo: listing.lane == .solo
    case .curiosity: listing.lane == .curiosity
    case .starred: feedback?.action == .star
    case .wildcard: listing.isWildcard
    case .endingSoon: listing.isEndingSoon
    }
  }
}

private struct FilterSheet: View {
  @Binding var filter: DeckFilter
  @Binding var searchText: String
  @Binding var showHidden: Bool
  let hiddenCount: Int
  let totalCount: Int
  let visibleCount: Int
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 12) {
        TextField("Search make, model, place, note...", text: $searchText)
          .textInputAutocapitalization(.never)
          .disableAutocorrection(true)
          .font(.callout.weight(.semibold))
          .padding(.horizontal, 13)
          .padding(.vertical, 12)
          .background(BeachcarColors.shell, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
          ForEach(DeckFilter.allCases) { option in
            Button {
              filter = option
            } label: {
              Label(option.label, systemImage: option.systemImage)
                .font(.subheadline.weight(.black))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                .padding(.horizontal, 12)
                .background(filter == option ? BeachcarColors.teal : .white.opacity(0.74), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .foregroundStyle(filter == option ? .white : BeachcarColors.ink)
            }
            .accessibilityIdentifier("filter-\(option.rawValue)")
          }
        }

        Toggle(isOn: $showHidden) {
          HStack {
            Label("Show hidden and avoided", systemImage: "eye")
              .font(.callout.weight(.bold))
            Spacer()
            Text("\(hiddenCount)")
              .font(.caption.weight(.black))
              .padding(.horizontal, 8)
              .padding(.vertical, 5)
              .background(BeachcarColors.shell, in: Capsule())
          }
        }
        .toggleStyle(.switch)

        HStack {
          Text("\(visibleCount) of \(totalCount) cards")
            .font(.caption.weight(.bold))
            .foregroundStyle(BeachcarColors.secondary)
          Spacer()
          Button("Reset") {
            filter = .all
            searchText = ""
            showHidden = false
          }
          .font(.caption.weight(.black))
          .foregroundStyle(BeachcarColors.teal)
        }
      }
      .padding(16)
      .navigationTitle("Filters")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Done") {
            dismiss()
          }
          .font(.headline)
          .accessibilityIdentifier("filters-done")
        }
      }
    }
    .accessibilityIdentifier("filter-sheet")
  }
}

private struct ListingListRow: View {
  let listing: AuctionListing
  let feedback: FeedbackRecord?
  let api: AuctionAPI

  var body: some View {
    HStack(spacing: 10) {
      thumbnail
        .frame(width: 74, height: 66)
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))

      VStack(alignment: .leading, spacing: 5) {
        HStack(spacing: 6) {
          Chip(text: feedback?.action.label ?? listing.lane.label, style: feedback == nil ? .mint : .neutral)
          if listing.isWildcard {
            Chip(text: "Wildcard", style: .sand)
          }
          Spacer(minLength: 4)
          Text(compactTime(listing.timeLeft ?? listing.ends))
            .font(.caption.weight(.black))
            .foregroundStyle(BeachcarColors.ink)
        }

        Text(listing.title)
          .font(.system(size: 16, weight: .black, design: .rounded))
          .lineLimit(2)
          .minimumScaleFactor(0.78)
          .foregroundStyle(BeachcarColors.ink)

        HStack(spacing: 8) {
          Label(listing.location ?? "Location check", systemImage: "mappin.and.ellipse")
            .lineLimit(1)
          Spacer(minLength: 4)
          Text(listing.total)
            .fontWeight(.black)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(BeachcarColors.secondary)

        if let currentTake = listing.currentTake {
          Text(currentTake)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(BeachcarColors.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.78)
        }
      }
    }
    .padding(9)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .stroke(.white.opacity(0.64), lineWidth: 1)
    }
  }

  @ViewBuilder
  private var thumbnail: some View {
    if let firstImage = listing.images.first {
      AsyncImage(url: api.resolvedImageURL(firstImage)) { phase in
        switch phase {
        case .success(let image):
          image.resizable().scaledToFill()
        case .failure:
          Rectangle()
            .fill(.white.opacity(0.72))
            .overlay(Image(systemName: "photo.badge.exclamationmark"))
        default:
          Rectangle()
            .fill(.white.opacity(0.72))
            .overlay(ProgressView())
        }
      }
    } else {
      Rectangle()
        .fill(.white.opacity(0.72))
        .overlay(Image(systemName: "photo").foregroundStyle(BeachcarColors.muted))
    }
  }
}

private struct ListingDetailSheet: View {
  let listing: AuctionListing
  let feedback: FeedbackRecord?
  let api: AuctionAPI
  let tokenProvider: AuctionAPI.TokenProvider
  let onAction: (FeedbackAction) async -> Void
  let onNote: (String) async -> PreferenceNoteResult

  @Environment(\.dismiss) private var dismiss
  @State private var selectedImage = 0

  var body: some View {
    ListingDetailBackView(
      listing: listing,
      feedback: feedback,
      api: api,
      selectedImage: $selectedImage,
      onFlip: { dismiss() },
      onAction: onAction,
      onNote: onNote
    )
    .padding(12)
    .background(BeachcarColors.shell.ignoresSafeArea())
  }
}

private extension AuctionListing {
  var searchBlob: String {
    [
      title,
      site,
      section,
      lane.rawValue,
      discoveryKind,
      wildcardReason,
      location,
      currentTake,
      why,
      concerns,
    ]
      .compactMap { $0 }
      .joined(separator: " ")
      .lowercased()
  }

  var isEndingSoon: Bool {
    if let endsAt, let date = Self.isoDate(endsAt) {
      let interval = date.timeIntervalSince(Date())
      return interval > 0 && interval <= 48 * 60 * 60
    }
    let value = (timeLeft ?? ends ?? "").lowercased()
    return value.contains("today")
      || value.contains("minute")
      || value.contains("hour")
      || value.contains("h")
      || value.hasPrefix("1 day")
  }

  static func isoDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
}
