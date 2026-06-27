import SwiftUI

enum ListFilter: String, CaseIterable, Identifiable {
  case all = "All"
  case family = "Family"
  case curiosity = "Curiosity"
  case starred = "Starred"

  var id: String { rawValue }
}

// "Today's finds" — pulls down from the top edge (follows finger), or via the
// list button. A normal scroll view of rows beneath a fixed header + filter chips.

struct ShadeListOverlay: View {
  @ObservedObject var controller: ShadeController
  let cars: [AuctionListing]
  let feedbackByKey: [String: FeedbackRecord]
  let api: AuctionAPI
  let geo: FeedGeometry

  private var pulling: Bool { controller.mode == .list && controller.dragging }

  private var offsetY: CGFloat {
    if controller.listOpen { return 0 }
    if pulling { return -(1 - controller.listPull) * geo.height }
    return -geo.height
  }

  private var rows: [(index: Int, car: AuctionListing)] {
    cars.enumerated()
      .map { (index: $0.offset, car: $0.element) }
      .filter { row in
        switch controller.listFilter {
        case .all: true
        case .family: row.car.lane == .family
        case .curiosity: row.car.lane == .curiosity
        case .starred:
          feedbackByKey[row.car.key]?.action == .star || feedbackByKey[row.car.key]?.action == .like
        }
      }
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
              Button { controller.jump(to: row.index) } label: {
                ListRow(car: row.car, index: row.index, isCurrent: row.index == controller.idx,
                        feedback: feedbackByKey[row.car.key], api: api)
              }
                .buttonStyle(.plain)
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
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 16).padding(.bottom, 12)
  }
}

private struct ListRow: View {
  let car: AuctionListing
  let index: Int
  let isCurrent: Bool
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
    if let upside = car.upsideLabel { return upside + " · " + (car.location ?? "") }
    return car.location ?? car.kindLabel
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
      ZStack { Rectangle().fill(BC.imageBg); Image(systemName: "photo").foregroundStyle(BC.muted) }
    }
  }

  private func twoDigit(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
}
