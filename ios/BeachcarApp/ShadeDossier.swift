import SwiftUI

// One listing is one vertically readable dossier. Horizontal movement belongs to
// judgment; every listing photo stays in the vertical dossier.

struct ShadeReviewPage: View {
  @ObservedObject var controller: ShadeController
  let car: AuctionListing
  let listingIndex: Int
  let totalListings: Int
  let sourceSummary: RunSourceSummary?
  let api: AuctionAPI
  let geo: FeedGeometry
  let onNote: (String) -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(spacing: 12) {
          Color.clear.frame(height: 1).id("review-top")
          hero
          quickFacts
          primaryAuctionLink
          sections
          Color.clear.frame(height: max(geo.safeBottom + 28, 44))
        }
      }
      .scrollIndicators(.hidden)
      .onChange(of: controller.scrollResetID) { _, _ in
        proxy.scrollTo("review-top", anchor: .top)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(BC.panel)
    .clipShape(RoundedRectangle(cornerRadius: isLifted ? 24 : 0, style: .continuous))
    .shadow(color: isLifted ? .black.opacity(0.55) : .clear, radius: 24, y: 10)
    .rotationEffect(.degrees(reduceMotion ? 0 : Double(displayOffset / max(geo.width, 1)) * 2.2))
    .offset(x: displayOffset)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("shade-review-page")
    .accessibilityAction(named: "Pass") { controller.doAction(.hide, advance: true) }
    .accessibilityAction(named: "Never again") { controller.doAction(.avoid, advance: true) }
    .accessibilityAction(named: "Like") { controller.doAction(.like, advance: true) }
    .accessibilityAction(named: "Love it") { controller.doAction(.star, advance: true) }
  }

  private var displayOffset: CGFloat { controller.reviewOffset + controller.coachOffset }
  private var isLifted: Bool { controller.reviewIntent == .horizontal || controller.coachOffset != 0 }

  private var primaryAuctionLink: some View {
    Group {
      if let url = URL(string: car.url) {
        Link(destination: url) {
          HStack(spacing: 10) {
            Image(systemName: "arrow.up.right.square.fill")
            Text("Open live auction")
            Spacer()
            Text(car.site).font(.mono(10, bold: true)).foregroundStyle(BC.accentInk.opacity(0.7))
          }
          .font(.archivo(14, .extrabold))
          .foregroundStyle(BC.accentInk)
          .frame(minHeight: 48)
          .padding(.horizontal, 15)
          .background(BC.accent, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
        .accessibilityIdentifier("shade-dossier-open-listing")
      }
    }
    .padding(.horizontal, 16)
  }

  // MARK: hero

  private var hero: some View {
    VStack(alignment: .leading, spacing: 0) {
      ZStack {
        heroImage
        LinearGradient(
          colors: [.clear, Color.black.opacity(car.displayImages.isEmpty ? 0.1 : 0.5)],
          startPoint: .top,
          endPoint: .bottom
        )
      }
      .frame(height: heroHeight)
      .frame(maxWidth: .infinity)
      .clipped()
      .overlay(alignment: .topLeading) { heroBadges.padding(12) }
      .overlay(alignment: .topTrailing) { countdownChip.padding(12) }
      .overlay(alignment: .bottom) {
        photoBadge.padding(12)
      }

      VStack(alignment: .leading, spacing: 7) {
        Text(car.title)
          .font(.archivo(27, .extrabold))
          .tracking(-0.5)
          .foregroundStyle(BC.white)
          .fixedSize(horizontal: false, vertical: true)
        Text("\(Image(systemName: Icon.location)) \(car.displayLocationLabel) · \(car.site)")
          .font(.mono(11, bold: true))
          .foregroundStyle(BC.sub)
      }
      .padding(15)
    }
    .background(BC.card)
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(BC.border, lineWidth: 1))
    .padding(.horizontal, 16)
    .accessibilityIdentifier("shade-review-hero-\(car.id)")
  }

  private var heroHeight: CGFloat {
    car.displayImages.isEmpty ? 126 : clamp(geo.width * 0.61, 218, 282)
  }

  private var heroBadges: some View {
    HStack(spacing: 6) {
      Text(car.kindLabel).font(.archivo(10.5, .extrabold)).foregroundStyle(BC.accent)
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(Color(hex: 0x080a0e).opacity(0.78), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
      if car.isWildcard {
        Text("Wildcard").font(.archivo(10.5, .extrabold)).foregroundStyle(BC.star)
          .padding(.horizontal, 9).padding(.vertical, 5)
          .background(Color(hex: 0x080a0e).opacity(0.78), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
      }
      if let sourceHealth = sourceSummary?.health(for: car) {
        SourceHealthBadge(state: sourceHealth, compact: true)
      }
    }
  }

  private var photoBadge: some View {
    let count = car.displayImages.count
    return HStack(spacing: 6) {
      Image(systemName: count == 0 ? "photo.badge.exclamationmark" : "photo.stack.fill")
      Text(count == 0 ? "NO PHOTOS" : "\(count) PHOTO\(count == 1 ? "" : "S") BELOW")
    }
    .font(.mono(10, bold: true))
    .foregroundStyle(count == 0 ? BC.muted : BC.white)
    .padding(.horizontal, 10)
    .frame(minHeight: 30)
    .background(Color(hex: 0x080a0e).opacity(0.82), in: Capsule())
    .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
    .accessibilityLabel(count == 0 ? "No photos provided" : "\(count) photos in this page. Scroll vertically to see them.")
  }

  @ViewBuilder
  private var heroImage: some View {
    if let firstImage = car.displayImages.first, !firstImage.isEmpty {
      CachedRemoteImage(url: api.resolvedImageURL(firstImage, variant: .deck)) { img in
        img.resizable().scaledToFill()
      } placeholder: {
        BC.imageBg
      } failure: {
        PhotoFailureState(
          title: "Preview unavailable",
          detail: "The listing details are still ready below.",
          compact: false
        )
      }
    } else {
      ZStack {
        BC.imageBg
        PhotoFailureState(
          title: "No listing photos",
          detail: "The written dossier is still ready below.",
          compact: true
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("No photos provided for \(car.title)")
        .accessibilityIdentifier("shade-dossier-no-image-\(car.id)")
      }
    }
  }

  @ViewBuilder
  private var inlinePhotos: some View {
    if car.displayImages.count > 1 {
      VStack(alignment: .leading, spacing: 13) {
        HStack(alignment: .center, spacing: 10) {
          Image(systemName: "photo.stack.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(BC.accentInk)
            .frame(width: 32, height: 32)
            .background(BC.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
          VStack(alignment: .leading, spacing: 2) {
            Text("MORE PHOTOS · \(car.displayImages.count - 1)")
              .font(.mono(10, bold: true))
              .tracking(1.2)
              .foregroundStyle(BC.white)
            Text("Every listing photo, in order.")
              .font(.archivo(12.5, .medium))
              .foregroundStyle(BC.sub)
          }
          Spacer(minLength: 8)
          Text("SCROLL")
            .font(.mono(9, bold: true))
            .tracking(0.8)
            .foregroundStyle(BC.accent)
        }

        VStack(spacing: 16) {
          ForEach(Array(car.displayImages.dropFirst().enumerated()), id: \.offset) { offset, image in
            InlineListingPhoto(
              url: api.resolvedImageURL(image, variant: .deck),
              index: offset + 2,
              total: car.displayImages.count
            )
            .accessibilityIdentifier("shade-inline-photo-\(offset + 1)")
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 8)
      .accessibilityElement(children: .contain)
    }
  }

  private var quickFacts: some View {
    HStack(spacing: 8) {
      quickFact("Bid", car.bid, Icon.bidding, BC.white)
      quickFact("Ends", car.shadeTime, Icon.clock, car.endsSoon ? BC.danger : BC.star)
      quickFact("Location", car.displayLocationLabel, Icon.location, car.hasMissingLocation ? BC.danger : BC.white.opacity(0.86))
    }
    .padding(.horizontal, 16)
  }

  private func quickFact(_ label: String, _ value: String, _ icon: String, _ color: Color) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 5) {
        Image(systemName: icon).font(.system(size: 10, weight: .bold))
        Text(label.uppercased())
          .font(.mono(8.5, bold: true))
          .tracking(0.6)
          .lineLimit(1)
          .minimumScaleFactor(0.62)
      }
      .foregroundStyle(BC.muted)
      Text(value)
        .font(.archivo(13.5, .extrabold))
        .foregroundStyle(color)
        .lineLimit(2)
        .minimumScaleFactor(0.72)
    }
    .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(BC.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(BC.border, lineWidth: 1))
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
    whySection
    marketSection
    watchoutsSection
    biddingSection
    vehicleSection
    inlinePhotos
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
    beachFitSection
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
          marketCol("Fair hammer", conciseMarketValue(car.fair, removing: [" fair hammer", " fair"]), BC.white)
          marketCol("My stop", conciseMarketValue(car.ceiling, removing: ["Stop around ", "Stop "]), BC.danger)
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

  private func conciseMarketValue(_ value: String?, removing phrases: [String]) -> String {
    guard var result = value, !result.isEmpty else { return "—" }
    for phrase in phrases {
      result = result.replacingOccurrences(of: phrase, with: "", options: .caseInsensitive)
    }
    return result.trimmingCharacters(in: .whitespacesAndNewlines)
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

private struct InlineListingPhoto: View {
  let url: URL?
  let index: Int
  let total: Int

  var body: some View {
    VStack(spacing: 0) {
      ZStack {
        BC.imageBg
        CachedRemoteImage(url: url) { image in
          image
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } placeholder: {
          ProgressView().tint(BC.sub)
        } failure: {
          PhotoFailureState(
            title: "Photo unavailable",
            detail: "Open the live auction for the original.",
            compact: false
          )
        }
      }
      .frame(maxWidth: .infinity)
      .aspectRatio(4.0 / 3.0, contentMode: .fit)
      .clipped()

      HStack(spacing: 8) {
        Text("PHOTO \(index)")
          .font(.mono(9.5, bold: true))
          .tracking(0.8)
          .foregroundStyle(BC.white)
        Text("OF \(total)")
          .font(.mono(9.5))
          .foregroundStyle(BC.sub)
        Spacer()
        Text("LISTING IMAGE")
          .font(.mono(9, bold: true))
          .tracking(0.7)
          .foregroundStyle(BC.muted)
      }
      .padding(.horizontal, 13)
      .frame(minHeight: 42)
      .background(BC.card)
    }
    .frame(maxWidth: .infinity)
    .background(BC.card)
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .stroke(Color.white.opacity(0.12), lineWidth: 1)
    )
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Photo \(index) of \(total)")
  }
}

private struct PhotoFailureState: View {
  let title: String
  let detail: String
  let compact: Bool

  var body: some View {
    ZStack {
      LinearGradient(
        colors: [BC.imageBg, BC.card.opacity(0.72)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      VStack(spacing: compact ? 6 : 9) {
        Image(systemName: "photo.badge.exclamationmark")
          .font(.system(size: compact ? 24 : 29, weight: .semibold))
          .foregroundStyle(BC.sub)
          .frame(width: compact ? 42 : 50, height: compact ? 42 : 50)
          .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        Text(title)
          .font(.archivo(compact ? 12 : 13.5, .bold))
          .foregroundStyle(BC.white.opacity(0.78))
        if !compact {
          Text(detail)
            .font(.archivo(11.5, .medium))
            .foregroundStyle(BC.sub)
            .multilineTextAlignment(.center)
        }
      }
      .padding(20)
    }
  }
}

// MARK: - Full-screen photo gallery

struct ShadePhotoGallery: View {
  @ObservedObject var controller: ShadeController
  let car: AuctionListing
  let api: AuctionAPI
  let safeTop: CGFloat
  let safeBottom: CGFloat
  let height: CGFloat
  @ObservedObject var coach: InteractionCoach
  let tuning: InteractionTuningProfile
  let onDismissed: (_ method: String, _ attempts: Int, _ zoomed: Bool) -> Void
  let onCoachImpression: () -> Void
  let photoNamespace: Namespace.ID
  @AccessibilityFocusState private var closeFocused: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
  @State private var dismissOffset: CGFloat = 0
  @State private var crossedDismissThreshold = false
  @State private var chromeVisible = true
  @State private var zoomedPhoto: Int?
  @State private var isClosing = false
  @State private var exitTask: Task<Void, Never>?
  @State private var dismissAttempts = 0

  var body: some View {
    ZStack {
      Color.black.opacity(backdropOpacity).ignoresSafeArea()
      galleryLayer
        .scaleEffect(reduceMotion ? 1 : contentScale)
        .offset(y: dismissOffset)
        .clipShape(RoundedRectangle(cornerRadius: reduceMotion ? 0 : cornerRadius, style: .continuous))
        .shadow(color: .black.opacity(dismissProgress * 0.5), radius: 28, y: 12)
    }
    .contentShape(Rectangle())
    .simultaneousGesture(dismissGesture, including: .all)
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.isModal)
    .accessibilityAction(.escape, closeUsingControl)
    .onAppear {
      closeFocused = true
      controller.selectGalleryPhoto(controller.galleryIndex, for: car.key, count: car.displayImages.count)
      if showsGalleryGuidance { onCoachImpression() }
      #if DEBUG
      if AppEnv.isUITesting, ProcessInfo.processInfo.arguments.contains("--gallery-drag-preview") {
        dismissOffset = 118
      }
      #endif
    }
    .onChange(of: controller.galleryIndex) { _, index in
      zoomedPhoto = nil
      chromeVisible = true
      controller.selectGalleryPhoto(index, for: car.key, count: car.displayImages.count)
    }
    .task(id: controller.galleryIndex) { await prefetchAdjacentPhotos() }
    .onDisappear { exitTask?.cancel() }
  }

  private var galleryLayer: some View {
    ZStack {
      TabView(selection: $controller.galleryIndex) {
        ForEach(Array(car.displayImages.enumerated()), id: \.offset) { index, image in
          ZoomableListingPhoto(
            url: api.resolvedImageURL(image, variant: .full),
            onZoomChanged: { zoomed in
              guard index == controller.galleryIndex else { return }
              zoomedPhoto = zoomed ? index : nil
            },
            onToggleChrome: toggleChrome
          )
          .matchedGeometryEffect(id: photoTransitionID(car.key, index), in: photoNamespace, isSource: false)
          .accessibilityIdentifier("shade-gallery-photo-\(index)")
          .tag(index)
        }
      }
      .tabViewStyle(.page(indexDisplayMode: .never))
      .scrollDisabled(selectedPhotoIsZoomed)

      if effectiveChromeVisible {
        galleryChrome
          .opacity(max(0, 1 - dismissProgress * 1.5))
          .transition(.opacity)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.black)
  }

  private var galleryChrome: some View {
    VStack {
      HStack {
        VStack(alignment: .leading, spacing: 3) {
          Text("PHOTO \(controller.galleryIndex + 1) OF \(max(car.displayImages.count, 1))")
            .font(.mono(11, bold: true))
            .tracking(1)
          Text(car.title)
            .font(.archivo(13, .semibold))
            .lineLimit(1)
        }
        .foregroundStyle(BC.white)
        Spacer()
      }
      .padding(.horizontal, 18)
      .padding(.top, safeTop + 10)
      Spacer()
      galleryExitControl
        .padding(.bottom, safeBottom + 14)
    }
  }

  private var galleryExitControl: some View {
    Button(action: closeUsingControl) {
      Group {
        if showsGalleryGuidance {
          VStack(spacing: 3) {
            Label("Swipe up or down to close", systemImage: "arrow.up.and.down")
              .font(.mono(10, bold: true))
              .tracking(0.35)
            Text("Pinch or double-tap to zoom")
              .font(.archivo(11, .semibold))
              .foregroundStyle(BC.white.opacity(0.58))
          }
        } else {
          Label("Close", systemImage: "arrow.up.and.down")
            .font(.mono(10, bold: true))
            .tracking(0.35)
        }
      }
      .foregroundStyle(BC.white)
      .padding(.horizontal, 15)
      .frame(minHeight: 48)
      .background(Color.black.opacity(0.68), in: Capsule())
      .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Close photo gallery")
    .accessibilityHint("Swipe quickly up or down anywhere on the photo, or double tap this button.")
    .accessibilityFocused($closeFocused)
    .accessibilityIdentifier("shade-gallery-close")
  }

  private var dismissGesture: some Gesture {
    DragGesture(minimumDistance: 16, coordinateSpace: .global)
      .onChanged { value in
        guard !selectedPhotoIsZoomed, !isClosing else { return }
        dismissOffset = GalleryDismissDecision.displayOffset(for: value.translation, height: height, profile: tuning)
        let shouldDismiss = GalleryDismissDecision.shouldDismiss(
          translation: value.translation,
          predictedEndTranslation: value.predictedEndTranslation,
          height: height,
          profile: tuning
        )
        if shouldDismiss && !crossedDismissThreshold {
          InteractionHaptics.fire(.galleryGate, style: tuning.haptics)
        }
        crossedDismissThreshold = shouldDismiss
      }
      .onEnded { value in
        guard !selectedPhotoIsZoomed, !isClosing else {
          crossedDismissThreshold = false
          dismissOffset = 0
          return
        }
        dismissAttempts += 1
        let shouldDismiss = GalleryDismissDecision.shouldDismiss(
          translation: value.translation,
          predictedEndTranslation: value.predictedEndTranslation,
          height: height,
          profile: tuning
        )
        crossedDismissThreshold = false
        if shouldDismiss {
          let projectedY = value.predictedEndTranslation.height
          let directionSource = projectedY == 0 ? value.translation.height : projectedY
          let direction: CGFloat = directionSource < 0 ? -1 : 1
          dismissByGesture(direction: direction)
        } else {
          withAnimation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.82)) {
            dismissOffset = 0
          }
        }
      }
  }

  private var selectedPhotoIsZoomed: Bool { zoomedPhoto == controller.galleryIndex }
  private var showsGalleryGuidance: Bool { coach.showsGalleryGuidance(for: tuning.coaching) }
  private var effectiveChromeVisible: Bool { chromeVisible || voiceOverEnabled }
  private var dismissProgress: CGFloat { GalleryDismissDecision.progress(offset: dismissOffset, height: height) }
  private var backdropOpacity: Double { Double(1 - dismissProgress * 0.78) }
  private var contentScale: CGFloat { 1 - dismissProgress * 0.08 }
  private var cornerRadius: CGFloat { dismissProgress * 30 }

  private func toggleChrome() {
    guard !voiceOverEnabled else { return }
    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
      chromeVisible.toggle()
    }
  }

  private func dismissByGesture(direction: CGFloat) {
    isClosing = true
    onDismissed("vertical_gesture", dismissAttempts, selectedPhotoIsZoomed)
    coach.recordGalleryDismissal()
    guard !reduceMotion else {
      controller.closeGallery()
      return
    }
    withAnimation(.timingCurve(0.2, 0.85, 0.25, 1, duration: 0.24)) {
      dismissOffset = direction * height * 1.05
    }
    exitTask?.cancel()
    exitTask = Task {
      try? await Task.sleep(for: .seconds(0.23))
      guard !Task.isCancelled else { return }
      controller.closeGallery()
    }
  }

  private func closeUsingControl() {
    onDismissed("control", dismissAttempts, selectedPhotoIsZoomed)
    withAnimation(reduceMotion ? nil : .galleryTransition) { controller.closeGallery() }
  }

  private func prefetchAdjacentPhotos() async {
    let indices = GalleryPhotoPolicy.adjacentIndices(
      current: controller.galleryIndex,
      count: car.displayImages.count
    )
    let urls = indices.compactMap { api.resolvedImageURL(car.displayImages[$0], variant: .full) }
    await BeachcarImagePipeline.shared.prefetch(urls)
  }
}

private struct ZoomableListingPhoto: View {
  let url: URL?
  let onZoomChanged: (Bool) -> Void
  let onToggleChrome: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var scale: CGFloat = 1
  @State private var lastScale: CGFloat = 1
  @State private var offset: CGSize = .zero
  @State private var lastOffset: CGSize = .zero

  var body: some View {
    GeometryReader { proxy in
      CachedRemoteImage(url: url) { image in
        image
          .resizable()
          .scaledToFit()
          .frame(width: proxy.size.width, height: proxy.size.height)
          .scaleEffect(scale)
          .offset(offset)
      } placeholder: {
        ProgressView().tint(BC.white)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } failure: {
        VStack(spacing: 10) {
          Image(systemName: "photo.badge.exclamationmark").font(.system(size: 32))
          Text("Photo unavailable").font(.archivo(14, .bold))
        }
        .foregroundStyle(BC.muted)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .contentShape(Rectangle())
      .simultaneousGesture(magnificationGesture(size: proxy.size))
      .simultaneousGesture(panGesture(size: proxy.size))
      .gesture(tapGesture(size: proxy.size))
    }
    .clipped()
    .accessibilityAction(named: "Zoom in or out") { toggleZoom(size: CGSize(width: 390, height: 700)) }
    .accessibilityAction(named: "Show or hide photo controls", onToggleChrome)
    .onDisappear { onZoomChanged(false) }
  }

  private func magnificationGesture(size: CGSize) -> some Gesture {
    MagnificationGesture()
      .onChanged { value in
        scale = clamp(lastScale * value, 1, 4)
        offset = bounded(offset, size: size, scale: scale)
        onZoomChanged(scale > 1.01)
      }
      .onEnded { _ in
        if scale < 1.02 { resetZoom() }
        else {
          lastScale = scale
          lastOffset = bounded(offset, size: size, scale: scale)
        }
      }
  }

  private func panGesture(size: CGSize) -> some Gesture {
    DragGesture(minimumDistance: 3)
      .onChanged { value in
        guard scale > 1.01 else { return }
        let proposed = CGSize(
          width: lastOffset.width + value.translation.width,
          height: lastOffset.height + value.translation.height
        )
        offset = bounded(proposed, size: size, scale: scale)
      }
      .onEnded { _ in
        guard scale > 1.01 else { return }
        lastOffset = bounded(offset, size: size, scale: scale)
      }
  }

  private func tapGesture(size: CGSize) -> some Gesture {
    let doubleTap = TapGesture(count: 2).onEnded { toggleZoom(size: size) }
    let singleTap = TapGesture().onEnded(onToggleChrome)
    return doubleTap.exclusively(before: singleTap)
  }

  private func toggleZoom(size: CGSize) {
    let zoomingIn = scale <= 1.01
    withAnimation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.84)) {
      scale = zoomingIn ? 2 : 1
      lastScale = scale
      offset = zoomingIn ? bounded(offset, size: size, scale: 2) : .zero
      lastOffset = offset
    }
    onZoomChanged(zoomingIn)
  }

  private func resetZoom() {
    scale = 1
    lastScale = 1
    offset = .zero
    lastOffset = .zero
    onZoomChanged(false)
  }

  private func bounded(_ value: CGSize, size: CGSize, scale: CGFloat) -> CGSize {
    GalleryPhotoPolicy.boundedOffset(value, viewport: size, scale: scale)
  }
}

enum GalleryPhotoPolicy {
  static func adjacentIndices(current: Int, count: Int) -> [Int] {
    [current - 1, current, current + 1].filter { $0 >= 0 && $0 < count }
  }

  static func boundedOffset(_ value: CGSize, viewport: CGSize, scale: CGFloat) -> CGSize {
    let maxX = max(viewport.width * (scale - 1) / 2, 0)
    let maxY = max(viewport.height * (scale - 1) / 2, 0)
    return CGSize(
      width: clamp(value.width, -maxX, maxX),
      height: clamp(value.height, -maxY, maxY)
    )
  }
}

private func photoTransitionID(_ listingKey: String, _ index: Int) -> String {
  "gallery-photo-\(listingKey)-\(index)"
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
