import SwiftUI

// MARK: - Feed content (stacked, transform-paged car panels)

struct ShadeFeed: View {
  @ObservedObject var controller: ShadeController
  let cars: [AuctionListing]
  let api: AuctionAPI
  let geo: FeedGeometry

  // Live rubber-banded drag delta applied to every panel while paging cars.
  private var dragDelta: CGFloat {
    guard controller.mode == .cars, controller.dragging else { return 0 }
    var d = controller.translation.height
    if (controller.idx == 0 && d > 0) || (controller.idx == cars.count - 1 && d < 0) { d *= 0.34 }
    return d
  }

  private func panelOffset(_ index: Int) -> CGFloat {
    CGFloat(index - controller.idx) * geo.height + dragDelta
  }

  var body: some View {
    // Each panel is positioned by its distance from the current index, so the
    // container's natural size is exactly one screen (no oversized-VStack centering).
    ZStack {
      ForEach(Array(cars.enumerated()), id: \.element.id) { index, car in
        CarPanel(controller: controller, car: car, index: index, api: api, geo: geo)
          .frame(width: geo.width, height: geo.height)
          .offset(y: panelOffset(index))
      }
    }
    .frame(width: geo.width, height: geo.height)
    .clipped()
    .animation(controller.dragging && controller.mode == .cars ? nil : .feedSpring, value: controller.idx)
  }
}

// MARK: - One car panel

private struct CarPanel: View {
  @ObservedObject var controller: ShadeController
  let car: AuctionListing
  let index: Int
  let api: AuctionAPI
  let geo: FeedGeometry

  var body: some View {
    VStack(spacing: 0) {
      Color.clear.frame(height: geo.photoTop)          // status bar + chrome (drawn above)
      PhotoStrip(controller: controller, car: car, index: index, api: api, geo: geo)
        .frame(width: geo.width, height: geo.photoHeight)
      InfoSheet(car: car)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .frame(width: geo.width, height: geo.height)
    .background(BC.bg)
  }
}

// MARK: - Photo strip (ambient glow + horizontal paging + dots)

private struct PhotoStrip: View {
  @ObservedObject var controller: ShadeController
  let car: AuctionListing
  let index: Int
  let api: AuctionAPI
  let geo: FeedGeometry

  private var photoIdx: Int { controller.photo(for: car.key) }
  private var images: [String] { car.displayImages }
  private var count: Int { max(images.count, 1) }
  private var isCurrent: Bool { index == controller.idx }

  private var stripOffset: CGFloat {
    var px = -CGFloat(photoIdx) * geo.width
    if isCurrent, controller.mode == .photos, controller.dragging {
      var d = controller.translation.width
      if (photoIdx == 0 && d > 0) || (photoIdx == count - 1 && d < 0) { d *= 0.34 }
      px += d
    }
    return px
  }

  var body: some View {
    ZStack {
      BC.imageBg

      // Ambient blurred copy behind the sharp photo for a colored glow.
      image(at: photoIdx)
        .scaledToFill()
        .frame(width: geo.width * 1.32, height: geo.photoHeight * 1.32)
        .blur(radius: 32)
        .saturation(1.45)
        .brightness(-0.12)
        .opacity(0.62)
        .allowsHitTesting(false)

      // Sharp horizontal strip.
      HStack(spacing: 0) {
        ForEach(0..<count, id: \.self) { j in
          image(at: j)
            .scaledToFill()
            .frame(width: geo.width, height: geo.photoHeight)
            .clipped()
        }
      }
      .frame(width: geo.width * CGFloat(count), alignment: .leading)
      .offset(x: stripOffset)
      .animation(controller.dragging && controller.mode == .photos && isCurrent ? nil : .photoSpring,
                 value: photoIdx)

      // Bottom blend into the info sheet.
      VStack {
        Spacer()
        LinearGradient(colors: [BC.bg.opacity(0), BC.bg], startPoint: .top, endPoint: .bottom)
          .frame(height: 48)
      }
      .allowsHitTesting(false)

      // Pagination dots.
      if count > 1 {
        VStack {
          Spacer()
          HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { j in
              Capsule(style: .continuous)
                .fill(j == photoIdx ? BC.white : Color.white.opacity(0.5))
                .frame(width: j == photoIdx ? 15 : 5, height: 5)
                .animation(.easeInOut(duration: 0.2), value: photoIdx)
            }
          }
          .padding(.bottom, 10)
        }
        .allowsHitTesting(false)
      }
    }
    .frame(width: geo.width, height: geo.photoHeight)
    .clipped()
  }

  @ViewBuilder
  private func image(at j: Int) -> some View {
    if images.indices.contains(j) {
      CachedRemoteImage(url: api.resolvedImageURL(images[j], variant: .deck)) { img in
        img.resizable()
      } placeholder: {
        ZStack { BC.imageBg; ProgressView().tint(BC.muted) }
      } failure: {
        ZStack {
          BC.imageBg
          Image(systemName: "photo").font(.system(size: 26)).foregroundStyle(BC.muted)
        }
      }
    } else {
      ZStack {
        BC.imageBg
        Image(systemName: "photo").font(.system(size: 26)).foregroundStyle(BC.muted)
      }
    }
  }
}

// MARK: - Info sheet (pills, title, verdict, bid, value meter)

private struct InfoSheet: View {
  let car: AuctionListing

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // Tag row
      HStack(spacing: 7) {
        TagPill(text: car.kindLabel, fg: BC.accent, bg: BC.accent.opacity(0.14))
        if car.isWildcard {
          TagPill(text: "Wildcard", fg: BC.star, bg: BC.star.opacity(0.16))
        } else {
          TagPill(text: car.lane.label, fg: BC.sub, bg: BC.faint)
        }
        Spacer(minLength: 6)
        Label {
          Text(car.location ?? "—")
        } icon: {
          Image(systemName: Icon.location)
        }
        .labelStyle(.titleAndIcon)
        .font(.mono(11))
        .foregroundStyle(BC.muted)
        .lineLimit(1)
      }

      Text(car.title)
        .font(.archivo(25, .extrabold))
        .tracking(-0.6)
        .lineSpacing(-2)
        .foregroundStyle(BC.white)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 11)

      Text("“\(car.why)”")
        .font(.archivo(14.5, .medium))
        .foregroundStyle(BC.white.opacity(0.86))
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 11)

      Spacer(minLength: 12)

      // Bid row
      HStack(alignment: .bottom) {
        VStack(alignment: .leading, spacing: 3) {
          Text("CURRENT BID")
            .font(.mono(10))
            .tracking(0.6)
            .foregroundStyle(BC.white.opacity(0.5))
          Text(car.bid)
            .font(.archivo(31, .extrabold))
            .foregroundStyle(BC.white)
        }
        Spacer()
        if let upside = car.upsideLabel {
          Text(upside)
            .font(.archivo(13, .extrabold))
            .foregroundStyle(BC.accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(BC.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
      }
      .padding(.top, 18)

      // Value meter
      VStack(alignment: .leading, spacing: 0) {
        MeterScale()
          .padding(.bottom, 8)
        ValueMeter(position: car.valuePosition, trackHeight: 8)
        (Text("Agent confidence: ").foregroundStyle(BC.white.opacity(0.56))
          + Text(car.confidenceLabel).foregroundStyle(BC.white).fontWeight(.heavy))
          .font(.archivo(12.5, .medium))
          .padding(.top, 9)
      }
      .padding(.top, 13)
    }
    .padding(EdgeInsets(top: 15, leading: 20, bottom: 18, trailing: 20))
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(BC.bg)
  }
}

// MARK: - Shared bits

struct TagPill: View {
  let text: String
  let fg: Color
  let bg: Color
  var body: some View {
    Text(text)
      .font(.archivo(11, .extrabold))
      .foregroundStyle(fg)
      .padding(.horizontal, 9)
      .padding(.vertical, 4)
      .background(bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
      .lineLimit(1)
  }
}

struct MeterScale: View {
  var body: some View {
    HStack {
      Text("CHEAP"); Spacer(); Text("FAIR"); Spacer(); Text("RICH")
    }
    .font(.mono(9))
    .tracking(0.5)
    .foregroundStyle(BC.white.opacity(0.44))
  }
}

struct ValueMeter: View {
  let position: Double          // 0…1
  var trackHeight: CGFloat = 8

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(BC.meterGradient).opacity(0.92)
        Circle()
          .fill(BC.white)
          .frame(width: trackHeight + 8, height: trackHeight + 8)
          .overlay(Circle().stroke(BC.bg, lineWidth: 2.5))
          .shadow(color: .black.opacity(0.5), radius: 4, y: 3)
          .offset(x: proxy.size.width * clamp(position, 0, 1) - (trackHeight + 8) / 2)
      }
    }
    .frame(height: trackHeight + 8)
  }
}

// MARK: - Top chrome (status-area progress + wordmark row)

struct FeedChrome: View {
  @ObservedObject var controller: ShadeController
  let cars: [AuctionListing]
  let geo: FeedGeometry
  let onList: () -> Void

  private var current: AuctionListing? { cars.indices.contains(controller.idx) ? cars[controller.idx] : nil }

  var body: some View {
    VStack(spacing: 9) {
      progressBar
      HStack {
        Text("Beachcar")
          .font(.archivo(17, .extrabold))
          .foregroundStyle(BC.white)
        Spacer()
        HStack(spacing: 9) {
          Button(action: onList) {
            Image(systemName: Icon.list)
              .font(.system(size: 12, weight: .semibold))
              .foregroundStyle(BC.white)
              .frame(width: 30, height: 30)
              .background(Color.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
              .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(Color.white.opacity(0.22), lineWidth: 1))
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("shade-list-button")

          if let current, current.endsSoon {
            HStack(spacing: 5) {
              PulsingDot(color: BC.white, size: 5)
              Text(current.shadeTime).font(.mono(10.5, bold: true)).foregroundStyle(BC.white)
            }
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(BC.danger, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
          }

          Text("\(twoDigit(controller.idx + 1)) / \(twoDigit(cars.count))")
            .font(.mono(11))
            .foregroundStyle(BC.white.opacity(0.75))
        }
      }
    }
    .padding(.horizontal, 18)
    .padding(.top, 2)
    .frame(height: geo.chromeHeight, alignment: .top)
    .padding(.top, geo.safeTop)
  }

  @ViewBuilder
  private var progressBar: some View {
    if cars.count <= 8 {
      HStack(spacing: 4) {
        ForEach(cars.indices, id: \.self) { i in
          Capsule()
            .fill(i <= controller.idx ? BC.white : Color.white.opacity(0.3))
            .frame(height: 3)
            .animation(.easeInOut(duration: 0.3), value: controller.idx)
        }
      }
    } else {
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.white.opacity(0.25))
          Capsule().fill(BC.white)
            .frame(width: proxy.size.width * CGFloat(controller.idx + 1) / CGFloat(cars.count))
            .animation(.easeInOut(duration: 0.35), value: controller.idx)
        }
      }
      .frame(height: 3)
    }
  }

  private func twoDigit(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
}

struct PulsingDot: View {
  let color: Color
  var size: CGFloat = 5
  @State private var on = false
  var body: some View {
    Circle()
      .fill(color)
      .frame(width: size, height: size)
      .opacity(on ? 1 : 0.4)
      .animation(AppEnv.isUITesting ? nil : .easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: on)
      .onAppear { on = true }
  }
}
