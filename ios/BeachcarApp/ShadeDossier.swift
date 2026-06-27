import SwiftUI

// Full detail for one car. A normal scroll view beneath a fixed header; closed by
// "throwing" the handle/hero off-screen or double-tapping the body. Sections backed
// by data we don't yet receive hide cleanly (see ShadeDossierData).

struct ShadeDossierOverlay: View {
  @ObservedObject var controller: ShadeController
  let car: AuctionListing
  let api: AuctionAPI
  let geo: FeedGeometry
  let onNote: (String) -> Void

  private var dist: CGFloat {
    if let fly = controller.dFly { return hypot(fly.width, fly.height) }
    return hypot(controller.dThrow.width, controller.dThrow.height)
  }
  private var lifted: Bool { controller.dDragging || controller.dFly != nil }

  private var offset: CGSize {
    if let fly = controller.dFly { return fly }
    if controller.dDragging { return controller.dThrow }
    return .zero
  }
  private var rotation: Double {
    if controller.dFly != nil { return controller.dFlyRotation }
    if controller.dDragging { return Double(controller.dThrow.width) * 0.018 }
    return 0
  }
  private var rootOpacity: Double {
    Double(clamp(1 - dist / 1_250, controller.dFly == nil ? 0.5 : 0.14, 1))
  }

  private var throwGesture: some Gesture {
    DragGesture(minimumDistance: 6)
      .onChanged { controller.dossierDragChanged($0) }
      .onEnded { controller.dossierDragEnded($0) }
  }

  private var bodyThrowGesture: some Gesture {
    DragGesture(minimumDistance: 16)
      .onChanged { controller.dossierBodyDragChanged($0) }
      .onEnded { controller.dossierBodyDragEnded($0) }
  }

  var body: some View {
    if controller.dossierOpen || controller.dFly != nil {
      VStack(spacing: 0) {
        headerBar
          .contentShape(Rectangle())
          .gesture(throwGesture)
        ScrollView {
          VStack(spacing: 12) {
            hero
            sections
            Color.clear.frame(height: 44)
          }
        }
        .scrollIndicators(.hidden)
        .simultaneousGesture(TapGesture(count: 2).onEnded { controller.throwClose(ux: 0, uy: -1, dx: 0) })
        .simultaneousGesture(bodyThrowGesture)
      }
      .frame(width: geo.width, height: geo.height)
      .background(Color(hex: 0x0c0d10))
      .clipShape(RoundedRectangle(cornerRadius: lifted ? 28 : 0, style: .continuous))
      .shadow(color: lifted ? .black.opacity(0.8) : .clear, radius: 40, y: 20)
      .rotationEffect(.degrees(rotation))
      .offset(offset)
      .opacity(rootOpacity)
      .transition(.scale(scale: 0.96).combined(with: .opacity))
      .accessibilityIdentifier("shade-dossier")
    }
  }

  // MARK: header

  private var headerBar: some View {
    VStack(spacing: 0) {
      Capsule().fill(Color.white.opacity(0.28)).frame(width: 42, height: 5)
      HStack {
        Text("FULL DOSSIER").font(.mono(10.5, bold: true)).tracking(1.4).foregroundStyle(BC.accent)
        Spacer()
        Text("throw · or double-tap to close").font(.mono(9.5)).foregroundStyle(BC.muted)
      }
      .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 10)
    }
    .padding(.top, geo.safeTop + 12)
    .frame(maxWidth: .infinity)
    .background(Color(hex: 0x0c0d10))
  }

  // MARK: hero

  private var hero: some View {
    ZStack(alignment: .bottomLeading) {
      CachedRemoteImage(url: api.resolvedImageURL(car.displayImages.first ?? "", variant: .deck)) { img in
        img.resizable().scaledToFill()
      } placeholder: {
        BC.imageBg
      } failure: {
        ZStack { BC.imageBg; Image(systemName: "photo").foregroundStyle(BC.muted) }
      }
      .frame(height: 208)
      .frame(maxWidth: .infinity)
      .clipped()

      LinearGradient(
        stops: [.init(color: .black.opacity(0.1), location: 0), .init(color: .black.opacity(0), location: 0.38), .init(color: .black.opacity(0.86), location: 1)],
        startPoint: .top, endPoint: .bottom
      )

      VStack(alignment: .leading, spacing: 5) {
        Text(car.title).font(.archivo(23, .extrabold)).tracking(-0.4).foregroundStyle(BC.white)
          .fixedSize(horizontal: false, vertical: true)
        Text("\(Image(systemName: Icon.location)) \(car.location ?? "—") · \(car.site)")
          .font(.mono(11)).foregroundStyle(BC.white.opacity(0.72))
      }
      .padding(14)
    }
    .frame(height: 208)
    .overlay(alignment: .topLeading) {
      HStack(spacing: 6) {
        Text(car.kindLabel).font(.archivo(10.5, .extrabold)).foregroundStyle(BC.accent)
          .padding(.horizontal, 9).padding(.vertical, 4)
          .background(Color(hex: 0x080a0e).opacity(0.7), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        if car.isWildcard {
          Text("Wildcard").font(.archivo(10.5, .extrabold)).foregroundStyle(BC.star)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Color(hex: 0x080a0e).opacity(0.7), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
      }
      .padding(12)
    }
    .overlay(alignment: .topTrailing) { countdownChip.padding(12) }
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .padding(.horizontal, 16)
    .contentShape(Rectangle())
    .highPriorityGesture(throwGesture)
  }

  private var countdownChip: some View {
    HStack(spacing: 5) {
      if car.endsSoon { PulsingDot(color: BC.white, size: 5) }
      else { Image(systemName: Icon.clock).font(.system(size: 10)) }
      Text(car.shadeTime).font(.mono(11, bold: true))
    }
    .foregroundStyle(BC.white)
    .padding(.horizontal, 9).padding(.vertical, 4)
    .background(car.endsSoon ? BC.danger : Color(hex: 0x080a0e).opacity(0.7), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
  }

  // MARK: sections

  @ViewBuilder
  private var sections: some View {
    vehicleSection
    if let listing = car.dossier?.listing, !listing.isEmpty {
      DossierSection(glyph: Icon.listingBody, label: "FROM THE LISTING") {
        VStack(alignment: .leading, spacing: 13) {
          ForEach(Array(listing.enumerated()), id: \.offset) { _, p in
            Text(p).font(.archivo(13.5, .medium)).foregroundStyle(BC.white.opacity(0.82)).lineSpacing(4)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }
    if let equipment = car.dossier?.equipment, !equipment.isEmpty {
      DossierSection(glyph: Icon.equipment, label: "EQUIPMENT & HIGHLIGHTS") {
        twoColumn(equipment) { item in
          HStack(alignment: .top, spacing: 8) {
            Image(systemName: Icon.bullet).font(.system(size: 10, weight: .heavy)).foregroundStyle(BC.accent)
            Text(item).font(.archivo(12.5, .semibold)).foregroundStyle(BC.white.opacity(0.82))
          }
        }
      }
    }
    if let service = car.dossier?.service, !service.isEmpty {
      DossierSection(glyph: Icon.service, label: "RECENT SERVICE") {
        VStack(alignment: .leading, spacing: 10) {
          ForEach(Array(service.enumerated()), id: \.offset) { _, item in
            HStack(alignment: .top, spacing: 9) {
              Circle().fill(BC.accent.opacity(0.7)).frame(width: 6, height: 6).padding(.top, 6)
              Text(item).font(.archivo(13, .medium)).foregroundStyle(BC.white.opacity(0.8))
            }
          }
        }
      }
    }
    whySection
    marketSection
    beachFitSection
    watchoutsSection
    biddingSection
    commentsSection
    teachSection
  }

  @ViewBuilder
  private var vehicleSection: some View {
    let specs = car.dossier?.specs
    let specPairs: [(String, String)] = [
      ("Odometer", specs?.odometer), ("Engine", specs?.engine), ("Transmission", specs?.transmission),
      ("Drivetrain", specs?.drivetrain), ("Exterior", specs?.exterior), ("Interior", specs?.interior),
    ].compactMap { label, value in value.map { (label, $0) } }
    let metaPairs: [(String, String)] = [
      ("Title", specs?.title), ("Seller", specs?.seller), ("Listing", specs?.lot),
    ].compactMap { label, value in value.map { (label, $0) } }

    if car.dossier?.summary != nil || !specPairs.isEmpty || !metaPairs.isEmpty {
      DossierSection(glyph: Icon.vehicle, label: "VEHICLE") {
        VStack(alignment: .leading, spacing: 0) {
          if let summary = car.dossier?.summary {
            Text(summary).font(.archivo(13.5, .medium)).foregroundStyle(BC.white.opacity(0.82)).lineSpacing(3)
              .fixedSize(horizontal: false, vertical: true).padding(.bottom, 15)
          }
          if !specPairs.isEmpty {
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 14) {
              ForEach(Array(specPairs.enumerated()), id: \.offset) { _, pair in
                specCell(pair.0, pair.1)
              }
            }
          }
          if !metaPairs.isEmpty {
            Rectangle().fill(BC.border).frame(height: 1).padding(.vertical, 14)
            HStack(spacing: 10) {
              ForEach(Array(metaPairs.enumerated()), id: \.offset) { _, pair in
                VStack(alignment: .leading, spacing: 4) {
                  Text(pair.0.uppercased()).font(.mono(9)).tracking(0.5).foregroundStyle(BC.muted)
                  Text(pair.1).font(.archivo(12.5, .bold)).foregroundStyle(BC.white).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
              }
            }
          }
        }
      }
    }
  }

  private func specCell(_ label: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label.uppercased()).font(.mono(9)).tracking(0.5).foregroundStyle(BC.muted)
      Text(value).font(.archivo(14, .bold)).foregroundStyle(BC.white)
    }
  }

  private var whySection: some View {
    DossierSection(glyph: Icon.why, label: "WHY THE AGENT PICKED IT", accentTint: true) {
      VStack(alignment: .leading, spacing: 11) {
        Text(car.why).font(.archivo(17, .semibold)).foregroundStyle(BC.white).lineSpacing(4).tracking(-0.2)
          .fixedSize(horizontal: false, vertical: true)
        if let take = car.currentTake, !take.isEmpty {
          Text(take).font(.mono(10.5)).tracking(0.3).foregroundStyle(BC.white.opacity(0.55))
        }
      }
    }
  }

  private var marketSection: some View {
    DossierSection(glyph: Icon.market, label: "MARKET READ") {
      VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 8) {
          marketCol("Current", car.bid, BC.white)
          marketCol("Fair hammer", car.fair ?? "—", BC.white)
          marketCol("My stop", car.ceiling ?? "—", BC.danger)
        }
        VStack(alignment: .leading, spacing: 0) {
          MeterScale().padding(.bottom, 7)
          ValueMeter(position: car.valuePosition, trackHeight: 9)
          HStack {
            (Text("Confidence: ").foregroundStyle(BC.white.opacity(0.58)) + Text(car.confidenceLabel).foregroundStyle(BC.white).fontWeight(.heavy))
              .font(.archivo(12, .medium))
            Spacer()
            if let upside = car.upsideLabel {
              Text(upside).font(.archivo(12, .extrabold)).foregroundStyle(BC.accent)
            }
          }
          .padding(.top, 11)
        }
      }
    }
  }

  private func marketCol(_ label: String, _ value: String, _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label).font(.mono(9)).tracking(0.5).foregroundStyle(BC.muted)
      Text(value).font(.archivo(16.5, .extrabold)).tracking(-0.3).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var beachFitSection: some View {
    if let use = car.dossier?.beachUse {
      let cells: [(String, String)] = [
        ("Body", use.body), ("Where", use.location), ("People", use.people), ("Paperwork", use.paperwork),
      ].compactMap { label, value in value.map { (label, $0) } }
      if !cells.isEmpty {
        DossierSection(glyph: Icon.beachFit, label: "BEACH-USE FIT") {
          LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
              VStack(alignment: .leading, spacing: 4) {
                Text(cell.0).font(.mono(9)).tracking(0.5).foregroundStyle(BC.muted)
                Text(cell.1).font(.archivo(14, .extrabold)).foregroundStyle(BC.white)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(.horizontal, 13).padding(.vertical, 12)
              .background(BC.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            }
          }
        }
      }
    }
  }

  @ViewBuilder
  private var watchoutsSection: some View {
    let concerns = car.concernList
    if !concerns.isEmpty {
      DossierSection(glyph: Icon.watchouts, label: "WATCH-OUTS") {
        VStack(alignment: .leading, spacing: 9) {
          ForEach(Array(concerns.prefix(5).enumerated()), id: \.offset) { _, item in
            HStack(alignment: .top, spacing: 9) {
              Circle().fill(BC.danger.opacity(0.8)).frame(width: 6, height: 6).padding(.top, 6)
              Text(item).font(.archivo(13.5, .medium)).foregroundStyle(BC.white.opacity(0.78))
            }
          }
        }
      }
    }
  }

  private var biddingSection: some View {
    DossierSection(glyph: Icon.bidding, label: "BIDDING") {
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .bottom) {
          VStack(alignment: .leading, spacing: 4) {
            Text("CURRENT BID\(bidCountSuffix)").font(.mono(9)).tracking(0.5).foregroundStyle(BC.muted)
            Text(car.bid).font(.archivo(26, .extrabold)).tracking(-0.4).foregroundStyle(BC.white)
          }
          Spacer()
          VStack(alignment: .trailing, spacing: 5) {
            Text("ENDS IN").font(.mono(9)).tracking(0.5).foregroundStyle(BC.muted)
            countdownChip
          }
        }
        if let bidLog = car.dossier?.bidLog, !bidLog.isEmpty {
          VStack(spacing: 0) {
            ForEach(Array(bidLog.enumerated()), id: \.offset) { i, entry in
              HStack(spacing: 11) {
                Circle().fill(i == 0 ? BC.accent : Color.white.opacity(0.22)).frame(width: 6, height: 6)
                Text(entry.bidder).font(.mono(12.5)).foregroundStyle(i == 0 ? BC.white : BC.white.opacity(0.7)).lineLimit(1)
                Spacer()
                Text(entry.amount).font(.archivo(14, .extrabold)).foregroundStyle(i == 0 ? BC.accent : BC.white)
                Text(entry.ago ?? "").font(.mono(10)).foregroundStyle(BC.muted).frame(width: 34, alignment: .trailing)
              }
              .padding(.vertical, 9)
              .overlay(alignment: .bottom) {
                if i < bidLog.count - 1 { Rectangle().fill(BC.border).frame(height: 1) }
              }
            }
          }
          .padding(.top, 15)
          .overlay(alignment: .top) { Rectangle().fill(BC.border).frame(height: 1) }
        } else if let url = URL(string: car.url) {
          Link(destination: url) {
            HStack(spacing: 9) {
              Image(systemName: "chart.line.uptrend.xyaxis").font(.system(size: 13, weight: .bold)).foregroundStyle(BC.accent)
              Text("Detailed bid history was not published in this run. Open the live listing.")
                .font(.archivo(12.5, .semibold))
                .foregroundStyle(BC.white.opacity(0.74))
              Spacer(minLength: 8)
              Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .bold)).foregroundStyle(BC.accent)
            }
            .padding(.top, 15)
            .overlay(alignment: .top) { Rectangle().fill(BC.border).frame(height: 1) }
          }
        }
      }
    }
  }

  private var bidCountSuffix: String {
    var parts: [String] = []
    if let bids = car.bids { parts.append("\(bids) bids") }
    if let bidders = car.bidders { parts.append("\(bidders) bidders") }
    return parts.isEmpty ? "" : " · " + parts.joined(separator: " · ")
  }

  private var commentsSection: some View {
    let count = car.comments ?? "0"
    return DossierSection(glyph: Icon.comments, label: "COMMENTS · \(count)") {
      VStack(alignment: .leading, spacing: 15) {
        if let thread = car.dossier?.comments, !thread.isEmpty {
          ForEach(Array(thread.enumerated()), id: \.offset) { _, c in
            commentRow(c)
          }
          if let url = URL(string: car.url) {
            Link(destination: url) {
              Text("View all \(count) comments →").font(.archivo(12.5, .extrabold)).foregroundStyle(BC.accent)
                .frame(maxWidth: .infinity).padding(.top, 13)
                .overlay(alignment: .top) { Rectangle().fill(BC.border).frame(height: 1) }
            }
          }
        } else if let url = URL(string: car.url) {
          Link(destination: url) {
            HStack {
              Text("Comment excerpts were not published in this run. Read \(count) comments on \(car.site).").font(.archivo(13, .semibold)).foregroundStyle(BC.white.opacity(0.8))
              Spacer()
              Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .bold)).foregroundStyle(BC.accent)
            }
          }
        }
      }
    }
  }

  private func commentRow(_ c: CommentEntry) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Text(String(c.user.prefix(1)).uppercased())
        .font(.archivo(12, .extrabold))
        .foregroundStyle((c.seller ?? false) ? BC.accentInk : BC.white)
        .frame(width: 28, height: 28)
        .background((c.seller ?? false) ? BC.accent : Color.white.opacity(0.1), in: Circle())
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 7) {
          Text(c.user).font(.archivo(12.5, .extrabold)).foregroundStyle((c.seller ?? false) ? BC.accent : BC.white).lineLimit(1)
          if c.seller ?? false {
            Text("SELLER").font(.mono(8.5, bold: true)).foregroundStyle(BC.accentInk)
              .padding(.horizontal, 5).padding(.vertical, 1)
              .background(BC.accent, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
          }
          Spacer()
          Text(c.ago ?? "").font(.mono(10)).foregroundStyle(BC.muted)
        }
        Text(c.body).font(.archivo(13, .medium)).foregroundStyle(BC.white.opacity(0.82)).lineSpacing(3)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var teachSection: some View {
    DossierSection(glyph: Icon.teach, label: "TEACH THE AGENT") {
      VStack(alignment: .leading, spacing: 11) {
        Text("A note here steers tomorrow's picks — say what you love or want to avoid.")
          .font(.archivo(12.5, .medium)).foregroundStyle(BC.white.opacity(0.6)).lineSpacing(2)
        HStack(spacing: 8) {
          TextField("", text: $controller.note, prompt: Text("e.g. love the open top, skip projects…").foregroundColor(BC.muted))
            .font(.archivo(13, .medium))
            .foregroundStyle(BC.white)
            .padding(.horizontal, 13).padding(.vertical, 11)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(BC.border, lineWidth: 1))
            .accessibilityIdentifier("shade-teach-field")
          Button {
            let trimmed = controller.note.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            onNote(trimmed)
            controller.note = ""
          } label: {
            Image(systemName: Icon.send)
              .font(.system(size: 17, weight: .bold))
              .foregroundStyle(noteActive ? BC.accentInk : BC.muted)
              .frame(width: 44, height: 44)
              .background(noteActive ? BC.accent : BC.faint, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("shade-teach-send")
        }
      }
    }
  }

  private var noteActive: Bool { !controller.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  // MARK: layout helpers

  private func twoColumn<T, RowContent: View>(_ items: [T], @ViewBuilder row: @escaping (T) -> RowContent) -> some View {
    LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], alignment: .leading, spacing: 11) {
      ForEach(Array(items.enumerated()), id: \.offset) { _, item in row(item) }
    }
  }
}

// MARK: - Section card

struct DossierSection<Content: View>: View {
  let glyph: String
  let label: String
  var accentTint: Bool = false
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 13) {
      HStack(spacing: 8) {
        Image(systemName: glyph).font(.system(size: 12)).foregroundStyle(accentTint ? BC.accent : BC.sub)
        Text(label).font(.mono(10, bold: true)).tracking(1.3).foregroundStyle(accentTint ? BC.accent : BC.sub)
      }
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(EdgeInsets(top: 16, leading: 17, bottom: 16, trailing: 17))
    .background(accentTint ? BC.accent.opacity(0.1) : BC.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(accentTint ? BC.accent.opacity(0.2) : BC.border, lineWidth: 1))
    .padding(.horizontal, 16)
  }
}
