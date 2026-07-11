import SwiftUI

enum ListFilter: String, CaseIterable, Identifiable {
  case all = "All"
  case family = "Family"
  case solo = "Solo"
  case curiosity = "Curiosity"
  case saved = "Saved"
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

  private var pulling: Bool { controller.mode == .list && controller.dragging }

  private var offsetY: CGFloat {
    if controller.listOpen { return 0 }
    if pulling { return -(1 - controller.listPull) * geo.height }
    return -geo.height
  }

  private var rows: [ListDisplayRow] {
    cars.enumerated()
      .map { offset, car in
        ListDisplayRow(
          displayIndex: offset,
          feedIndex: feedCars.firstIndex(where: { $0.key == car.key }),
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
  }

  private var header: some View {
    HStack(alignment: .bottom) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Today's finds")
          .font(.archivo(26, .extrabold))
          .tracking(-0.6)
          .foregroundStyle(BC.white)
        Text(subtitle)
          .font(.mono(11))
          .foregroundStyle(BC.muted)
      }
      Spacer()
      Button(action: controller.closeList) {
        Image(systemName: Icon.closeList)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(BC.white)
          .frame(width: 34, height: 34)
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
    if nStar > 0 { tail.append("\(nStar) starred") }
    if !tail.isEmpty { parts += " · " + tail.joined(separator: " · ") }
    return parts
  }

  private var updatedLabel: String {
    "8:00 AM"
  }

  private var filters: some View {
    VStack(spacing: 9) {
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
        .frame(height: 36)
        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(BC.border, lineWidth: 1))
        .accessibilityElement(children: .contain)

        sourceMenu
        sortMenu
        hiddenToggle
      }
      .padding(.horizontal, 16)

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 7) {
          ForEach(ListFilter.allCases) { f in
            let on = controller.listFilter == f
            Button { withAnimation(.easeOut(duration: 0.18)) { controller.listFilter = f } } label: {
              Text(f.rawValue)
                .font(.archivo(12, .extrabold))
                .foregroundStyle(on ? BC.accent : BC.sub)
                .padding(.horizontal, 13).padding(.vertical, 7)
                .background(on ? BC.accent.opacity(0.14) : .clear, in: Capsule())
                .overlay(Capsule().stroke(on ? BC.accent : BC.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("shade-filter-\(f.rawValue)")
          }
        }
        .padding(.horizontal, 16)
      }
      .scrollIndicators(.hidden)
    }
    .padding(.bottom, 12)
  }

  private var sourceMenu: some View {
    Menu {
      Button("All sources") { controller.listSource = "all" }
      ForEach(availableSources, id: \.self) { source in
        Button(source) { controller.listSource = source }
      }
    } label: {
      compactControl(icon: "square.stack.3d.up.fill", text: controller.listSource == "all" ? "Source" : shortSourceLabel(controller.listSource))
    }
    .accessibilityIdentifier("shade-list-source-menu")
  }

  private var sortMenu: some View {
    Menu {
      ForEach(ListSort.allCases) { sort in
        Button(sort.rawValue) { controller.listSort = sort }
      }
    } label: {
      compactControl(icon: "arrow.up.arrow.down", text: controller.listSort.rawValue)
    }
    .accessibilityIdentifier("shade-list-sort-menu")
  }

  private var hiddenToggle: some View {
    Button {
      controller.listIncludeHidden.toggle()
    } label: {
      Image(systemName: controller.listIncludeHidden ? "eye.fill" : "eye")
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(controller.listIncludeHidden ? BC.accent : BC.sub)
        .frame(width: 36, height: 36)
        .background(controller.listIncludeHidden ? BC.accent.opacity(0.14) : Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(controller.listIncludeHidden ? BC.accent.opacity(0.45) : BC.border, lineWidth: 1))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(controller.listIncludeHidden ? "Hide hidden listings" : "Show hidden listings")
    .accessibilityIdentifier("shade-list-show-hidden")
  }

  private func compactControl(icon: String, text: String) -> some View {
    HStack(spacing: 5) {
      Image(systemName: icon)
        .font(.system(size: 11, weight: .bold))
      Text(text)
        .font(.mono(9.5, bold: true))
        .lineLimit(1)
        .minimumScaleFactor(0.72)
    }
    .foregroundStyle(BC.sub)
    .frame(width: 74, height: 36)
    .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(BC.border, lineWidth: 1))
  }

  private func shortSourceLabel(_ source: String) -> String {
    source
      .replacingOccurrences(of: "Bring a Trailer", with: "BaT")
      .replacingOccurrences(of: "Cars & Bids", with: "C&B")
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
    case .family:
      return car.lane == .family
    case .solo:
      return car.lane == .solo
    case .curiosity:
      return car.lane == .curiosity
    case .saved:
      return feedbackByKey[car.key]?.action == .star || feedbackByKey[car.key]?.action == .like
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
    HStack(spacing: 13) {
      Text(twoDigit(index + 1))
        .font(.mono(12, bold: true))
        .foregroundStyle(isCurrent ? BC.accent : BC.muted)
        .frame(width: 20)

      thumbnail
        .frame(width: 66, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(alignment: .topLeading) {
          if let feedback {
            Image(systemName: Icon.feedback(feedback.action))
              .font(.system(size: 10, weight: .bold))
              .foregroundStyle(Color(hex: 0x0c0d10))
              .frame(width: 18, height: 18)
              .background(Icon.color(for: feedback.action).opacity(0.92), in: Circle())
              .padding(4)
          }
        }

      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 7) {
          Text(car.shortTitle)
            .font(.archivo(15, .extrabold))
            .foregroundStyle(BC.white)
            .lineLimit(1)
          if let sourceHealth {
            SourceHealthBadge(state: sourceHealth, compact: true)
          }
          if car.endsSoon {
            Text(car.shadeTime)
              .font(.mono(9, bold: true))
              .foregroundStyle(BC.white)
              .padding(.horizontal, 6).padding(.vertical, 2)
              .background(BC.danger, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
          }
        }
        Text(secondary)
          .font(.mono(11, bold: feedback != nil))
          .foregroundStyle(secondaryColor)
          .lineLimit(1)
      }

      Spacer(minLength: 4)

      VStack(alignment: .trailing, spacing: 2) {
        Text(car.bid).font(.archivo(15, .extrabold)).foregroundStyle(BC.white)
        Text(car.kindLabel).font(.mono(9)).foregroundStyle(BC.muted)
      }
    }
    .padding(10)
    .background(isCurrent ? BC.accent.opacity(0.08) : BC.listRow, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(isCurrent ? BC.accent.opacity(0.45) : Color.white.opacity(0.05), lineWidth: 1)
    )
    .opacity(dimmed ? 0.5 : 1)
    .contentShape(Rectangle())
  }

  private var secondary: String {
    if let feedback { return feedback.action.label }
    if let upside = car.upsideLabel, let location = car.displayLocation { return upside + " · " + location }
    if car.hasMissingLocation { return "Location missing" }
    return car.displayLocation ?? car.kindLabel
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
