import SwiftUI

enum ListFilter: String, CaseIterable, Identifiable {
  case all = "All"
  case unreviewed = "Unreviewed"
  case liked = "Liked"
  case loved = "Loved"
  case passed = "Passed"
  case neverAgain = "Never again"
  case family = "Family"
  case solo = "Solo"
  case curiosity = "Curiosity"
  case wildcard = "Wildcard"
  case endingSoon = "Ending"
  case imageReady = "Images"
  case missingLocation = "No location"

  var id: String { rawValue }
}

enum ListSort: String, CaseIterable, Identifiable {
  case rank = "Agent"
  case endingSoon = "Ending soon"
  case bid = "Bid"
  case value = "Value"
  case source = "Source"
  case location = "Location"

  var id: String { rawValue }
}

private struct ListDisplayRow: Identifiable {
  let displayIndex: Int
  let feedIndex: Int?
  let car: AuctionListing

  var id: String { car.id }
}

// "Today's finds" — pulls down from the top edge (follows finger), or via the
// list button. A normal scroll view of rows beneath a fixed header + filter chips.

struct ShadeListOverlay: View {
  @ObservedObject var controller: ShadeController
  let cars: [AuctionListing]
  let feedCars: [AuctionListing]
  let sourceSummary: RunSourceSummary?
  let feedbackByKey: [String: FeedbackRecord]
  let api: AuctionAPI
  let geo: FeedGeometry
  @AccessibilityFocusState private var headerFocused: Bool

  private var pulling: Bool { controller.mode == .list && controller.dragging }

  private var offsetY: CGFloat {
    if controller.listOpen { return 0 }
    if pulling { return -(1 - controller.listPull) * geo.height }
    return -geo.height
  }

  private var rows: [ListDisplayRow] {
    cars.enumerated()
      .map { offset, car in
        let feedIndex = feedCars.firstIndex(where: { $0.key == car.key })
        return ListDisplayRow(
          displayIndex: feedIndex ?? offset,
          feedIndex: feedIndex,
          car: car
        )
      }
      .filter(matchesScanControls)
      .sorted(by: compareRows)
  }

  private var availableSources: [String] {
    Array(Set(cars.map(\.site))).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
  }

  private var searchText: String {
    controller.listSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  private var nLiked: Int { feedbackByKey.values.filter { $0.action == .like }.count }
  private var nStar: Int { feedbackByKey.values.filter { $0.action == .star }.count }

  var body: some View {
    VStack(spacing: 0) {
      header
      filters
      ScrollView {
        LazyVStack(spacing: 7) {
          if rows.isEmpty {
            Text("Nothing here yet — judge a few cars to fill this in.")
              .font(.archivo(14))
              .foregroundStyle(BC.muted)
              .multilineTextAlignment(.center)
              .padding(.horizontal, 24).padding(.vertical, 48)
          } else {
            ForEach(rows, id: \.car.id) { row in
              Button {
                if let feedIndex = row.feedIndex { controller.jump(to: feedIndex) }
              } label: {
                ListRow(car: row.car, index: row.displayIndex, isCurrent: row.feedIndex == controller.idx,
                        sourceHealth: sourceSummary?.health(for: row.car), feedback: feedbackByKey[row.car.key], api: api)
              }
                .buttonStyle(.plain)
                .disabled(row.feedIndex == nil)
                .accessibilityIdentifier("shade-list-row-\(row.car.id)")
            }
          }
        }
        .padding(.horizontal, 14)
        .padding(.top, 2)
        .padding(.bottom, 24)
      }
      .scrollIndicators(.hidden)
    }
    .frame(width: geo.width, height: geo.height, alignment: .top)
    .background(BC.panel)
    .offset(y: offsetY)
    .animation(pulling ? nil : .overlaySpring, value: controller.listOpen)
    .allowsHitTesting(controller.listOpen)
    .accessibilityHidden(!controller.listOpen)
    .accessibilityAddTraits(.isModal)
    .onChange(of: controller.listOpen) { _, open in
      if open { headerFocused = true }
    }
  }

  private var header: some View {
    HStack(alignment: .bottom) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Today's finds")
          .font(.archivo(26, .extrabold))
          .tracking(-0.6)
          .foregroundStyle(BC.white)
          .accessibilityFocused($headerFocused)
        Text(subtitle)
          .font(.mono(11))
          .foregroundStyle(BC.muted)
      }
      Spacer()
      Button(action: controller.closeList) {
        Image(systemName: Icon.closeList)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(BC.white)
          .frame(width: 44, height: 44)
          .background(Color.white.opacity(0.08), in: Circle())
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("shade-list-close")
    }
    .padding(.leading, 20).padding(.trailing, 18)
    .padding(.top, geo.safeTop + 8).padding(.bottom, 12)
  }

  private var subtitle: String {
    var parts = "\(cars.count) cars · updated \(updatedLabel)"
    var tail: [String] = []
    if nLiked > 0 { tail.append("\(nLiked) liked") }
    if nStar > 0 { tail.append("\(nStar) loved") }
    if !tail.isEmpty { parts += " · " + tail.joined(separator: " · ") }
    return parts
  }

  private var updatedLabel: String {
    "8:00 AM"
  }

  private var filters: some View {
    VStack(spacing: 8) {
      HStack(spacing: 8) {
        HStack(spacing: 7) {
          Image(systemName: "magnifyingglass")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(BC.muted)
          TextField("Search", text: $controller.listSearch)
            .font(.archivo(13, .semibold))
            .foregroundStyle(BC.white)
            .textInputAutocapitalization(.never)
            .disableAutocorrection(true)
            .accessibilityLabel("Search listings")
            .accessibilityIdentifier("shade-list-search-field")
          if !controller.listSearch.isEmpty {
            Button {
              controller.listSearch = ""
            } label: {
              Image(systemName: "xmark.circle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(BC.muted)
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 11)
        .frame(height: 44)
        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(BC.border, lineWidth: 1))
        .accessibilityElement(children: .contain)

        filterMenu
        sortMenu
      }
      .padding(.horizontal, 16)

      if hasActiveFilters {
        HStack(spacing: 7) {
          Image(systemName: "line.3.horizontal.decrease.circle.fill")
          Text(activeFilterSummary)
            .lineLimit(1)
          Spacer()
          Button("Clear") {
            controller.listFilter = .all
            controller.listSource = "all"
            controller.listIncludeHidden = false
          }
          .foregroundStyle(BC.accent)
          .frame(minHeight: 32)
        }
        .font(.mono(10, bold: true))
        .foregroundStyle(BC.sub)
        .padding(.horizontal, 17)
      }
    }
    .padding(.bottom, 12)
  }

  private var filterMenu: some View {
    Menu {
      Section("Review") {
        filterButton(.all)
        filterButton(.unreviewed)
        filterButton(.liked)
        filterButton(.loved)
        filterButton(.passed, includeHidden: true)
        filterButton(.neverAgain, includeHidden: true)
      }
      Section("Use") {
        filterButton(.family)
        filterButton(.solo)
        filterButton(.curiosity)
        filterButton(.wildcard)
      }
      Section("Listing") {
        filterButton(.endingSoon)
        filterButton(.imageReady)
        filterButton(.missingLocation)
      }
      Menu("Source") {
        Button("All sources") { controller.listSource = "all" }
        ForEach(availableSources, id: \.self) { source in
          Button(source) { controller.listSource = source }
        }
      }
      Divider()
      Button(controller.listIncludeHidden ? "Hide passed listings" : "Include passed listings") {
        controller.listIncludeHidden.toggle()
      }
    } label: {
      squareControl(icon: "line.3.horizontal.decrease", active: hasActiveFilters)
    }
    .accessibilityLabel("Filter listings")
    .accessibilityIdentifier("shade-list-filter-menu")
  }

  private func filterButton(_ filter: ListFilter, includeHidden: Bool = false) -> some View {
    Button {
      controller.listFilter = filter
      if includeHidden { controller.listIncludeHidden = true }
    } label: {
      if controller.listFilter == filter { Label(filter.rawValue, systemImage: "checkmark") }
      else { Text(filter.rawValue) }
    }
    .accessibilityIdentifier("shade-filter-\(filter.rawValue)")
  }

  private var sortMenu: some View {
    Menu {
      ForEach(ListSort.allCases) { sort in
        Button(sort.rawValue) { controller.listSort = sort }
      }
    } label: {
      squareControl(icon: "arrow.up.arrow.down", active: controller.listSort != .rank)
    }
    .accessibilityLabel("Sort listings, \(controller.listSort.rawValue)")
    .accessibilityIdentifier("shade-list-sort-menu")
  }

  private func squareControl(icon: String, active: Bool) -> some View {
    Image(systemName: icon)
      .font(.system(size: 14, weight: .bold))
      .foregroundStyle(active ? BC.accent : BC.sub)
      .frame(width: 44, height: 44)
      .background(active ? BC.accent.opacity(0.12) : Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(active ? BC.accent.opacity(0.35) : BC.border, lineWidth: 1))
  }

  private var hasActiveFilters: Bool {
    controller.listFilter != .all || controller.listSource != "all" || controller.listIncludeHidden
  }

  private var activeFilterSummary: String {
    var values: [String] = []
    if controller.listFilter != .all { values.append(controller.listFilter.rawValue) }
    if controller.listSource != "all" { values.append(controller.listSource) }
    if controller.listIncludeHidden { values.append("including passed") }
    return values.joined(separator: " · ")
  }

  private func matchesScanControls(_ row: ListDisplayRow) -> Bool {
    let car = row.car
    if controller.listSource != "all", car.site != controller.listSource { return false }
    if !searchText.isEmpty {
      let text = "\(car.title) \(car.site) \(car.displayLocationLabel) \(car.why) \(car.currentTake ?? "")".lowercased()
      if !text.contains(searchText) { return false }
    }

    switch controller.listFilter {
    case .all:
      return true
    case .unreviewed:
      return feedbackByKey[car.key] == nil
    case .liked:
      return feedbackByKey[car.key]?.action == .like
    case .loved:
      return feedbackByKey[car.key]?.action == .star
    case .passed:
      return feedbackByKey[car.key]?.action == .hide
    case .neverAgain:
      return feedbackByKey[car.key]?.action == .avoid
    case .family:
      return car.lane == .family
    case .solo:
      return car.lane == .solo
    case .curiosity:
      return car.lane == .curiosity
    case .wildcard:
      return car.isWildcard
    case .endingSoon:
      return car.endsSoon
    case .imageReady:
      return !car.displayImages.isEmpty
    case .missingLocation:
      return car.hasMissingLocation
    }
  }

  private func compareRows(_ left: ListDisplayRow, _ right: ListDisplayRow) -> Bool {
    switch controller.listSort {
    case .rank:
      return left.displayIndex < right.displayIndex
    case .endingSoon:
      return compareOptionalText(endSortValue(left.car), endSortValue(right.car), left.displayIndex, right.displayIndex)
    case .bid:
      let leftBid = left.car.bidNumber ?? Int.max
      let rightBid = right.car.bidNumber ?? Int.max
      if leftBid != rightBid { return leftBid < rightBid }
      return left.displayIndex < right.displayIndex
    case .value:
      if left.car.valuePosition != right.car.valuePosition {
        return left.car.valuePosition < right.car.valuePosition
      }
      return left.displayIndex < right.displayIndex
    case .source:
      let sourceOrder = left.car.site.localizedCaseInsensitiveCompare(right.car.site)
      if sourceOrder != .orderedSame { return sourceOrder == .orderedAscending }
      return left.displayIndex < right.displayIndex
    case .location:
      if let leftDistance = left.car.distanceMiles, let rightDistance = right.car.distanceMiles, leftDistance != rightDistance {
        return leftDistance < rightDistance
      }
      if left.car.distanceMiles != nil { return true }
      if right.car.distanceMiles != nil { return false }
      return compareOptionalText(left.car.displayLocation, right.car.displayLocation, left.displayIndex, right.displayIndex)
    }
  }

  private func endSortValue(_ car: AuctionListing) -> String? {
    car.endsAt ?? car.ends
  }

  private func compareOptionalText(_ left: String?, _ right: String?, _ leftIndex: Int, _ rightIndex: Int) -> Bool {
    switch (left, right) {
    case let (l?, r?) where l != r:
      return l.localizedCaseInsensitiveCompare(r) == .orderedAscending
    case (_?, nil):
      return true
    case (nil, _?):
      return false
    default:
      return leftIndex < rightIndex
    }
  }
}

private struct ListRow: View {
  let car: AuctionListing
  let index: Int
  let isCurrent: Bool
  let sourceHealth: SourceHealthState?
  let feedback: FeedbackRecord?
  let api: AuctionAPI

  private var dimmed: Bool { feedback?.action == .hide || feedback?.action == .avoid }

  var body: some View {
    HStack(spacing: 12) {
      thumbnail
        .frame(width: 76, height: 70)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay(alignment: .topLeading) {
          Text(twoDigit(index + 1))
            .font(.mono(9.5, bold: true))
            .foregroundStyle(isCurrent ? BC.accentInk : BC.white)
            .frame(width: 25, height: 20)
            .background(isCurrent ? BC.accent : Color.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .padding(5)
        }
        .overlay(alignment: .bottomTrailing) {
          if let feedback {
            Image(systemName: Icon.feedback(feedback.action))
              .font(.system(size: 10, weight: .bold))
              .foregroundStyle(Color(hex: 0x0c0d10))
              .frame(width: 22, height: 22)
              .background(Icon.color(for: feedback.action).opacity(0.92), in: Circle())
              .padding(5)
          }
        }

      VStack(alignment: .leading, spacing: 5) {
        Text(car.title)
          .font(.archivo(15.5, .extrabold))
          .foregroundStyle(BC.white)
          .lineLimit(2)
          .multilineTextAlignment(.leading)
        HStack(spacing: 5) {
          if let sourceHealth {
            Image(systemName: "checkmark.circle.fill")
              .foregroundStyle(BC.accent)
              .accessibilityLabel("\(sourceHealth.label), \(sourceHealth.detail)")
              .accessibilityIdentifier("source-health-badge-\(car.site.lowercased().filter(\.isLetter))")
          }
          Text(car.site)
          Text("·")
          Text(car.displayLocationLabel)
        }
          .font(.mono(10, bold: true))
          .foregroundStyle(BC.muted)
          .lineLimit(1)
        Text(secondary)
          .font(.archivo(11.5, .bold))
          .foregroundStyle(secondaryColor)
          .lineLimit(1)
      }

      Spacer(minLength: 2)

      VStack(alignment: .trailing, spacing: 6) {
        Text(car.bid).font(.archivo(15.5, .extrabold)).foregroundStyle(BC.white).lineLimit(1)
        Text(car.shadeTime)
          .font(.mono(9.5, bold: true))
          .foregroundStyle(car.endsSoon ? BC.white : BC.star)
          .padding(.horizontal, 7)
          .frame(minHeight: 25)
          .background(car.endsSoon ? BC.danger : BC.star.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        Text(car.kindLabel).font(.mono(9, bold: true)).foregroundStyle(BC.muted).lineLimit(1)
      }
    }
    .padding(11)
    .frame(minHeight: 96)
    .background(isCurrent ? BC.accent.opacity(0.08) : BC.listRow, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(isCurrent ? BC.accent.opacity(0.45) : Color.white.opacity(0.05), lineWidth: 1)
    )
    .opacity(dimmed ? 0.5 : 1)
    .contentShape(Rectangle())
  }

  private var secondary: String {
    if let feedback {
      switch feedback.action {
      case .like: return "Liked"
      case .star: return "Loved"
      case .hide: return "Passed"
      case .avoid: return "Never again"
      }
    }
    return car.upsideLabel ?? car.kindLabel
  }

  private var secondaryColor: Color {
    guard let feedback else { return BC.muted }
    return Icon.color(for: feedback.action)
  }

  @ViewBuilder
  private var thumbnail: some View {
    if let first = car.displayImages.first {
      CachedRemoteImage(url: api.resolvedImageURL(first, variant: .thumb)) { img in
        img.resizable().scaledToFill()
      } placeholder: {
        Rectangle().fill(BC.imageBg)
      } failure: {
        ZStack { Rectangle().fill(BC.imageBg); Image(systemName: "photo").foregroundStyle(BC.muted) }
      }
    } else {
      ZStack {
        Rectangle().fill(BC.imageBg)
        Image(systemName: "photo.badge.exclamationmark").foregroundStyle(BC.muted)
      }
      .accessibilityElement(children: .combine)
      .accessibilityLabel("No listing image")
    }
  }

  private func twoDigit(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
}
