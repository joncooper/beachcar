import SwiftUI

struct ListingDetailBackView: View {
  let listing: AuctionListing
  let feedback: FeedbackRecord?
  let api: AuctionAPI
  @Binding var selectedImage: Int
  let onFlip: () -> Void
  let onAction: (FeedbackAction) async -> Void
  let onNote: (String) async -> PreferenceNoteResult

  @State private var note = ""

  var body: some View {
    VStack(spacing: 0) {
      topBar
      ScrollView {
        VStack(alignment: .leading, spacing: 11) {
          detailHeader
          valuationPanel
          practicalPanel
          notePanel
          diligencePanel
          activityPanel
          VoiceFeedbackComposer(text: $note) {
            await onNote(note)
          }
        }
        .padding(12)
        .padding(.bottom, 72)
      }

      actionRail
    }
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 24, style: .continuous)
        .stroke(.white.opacity(0.7), lineWidth: 1)
    }
    .accessibilityIdentifier("listing-detail-back")
  }

  private var topBar: some View {
    HStack {
      Button(action: onFlip) {
        Label("Front", systemImage: "chevron.left")
          .font(.callout.weight(.black))
          .padding(.horizontal, 12)
          .frame(height: 38)
          .background(.white.opacity(0.76), in: Capsule())
      }
      .foregroundStyle(BeachcarColors.ink)

      Spacer()

      Label("Back of card", systemImage: "arrow.uturn.backward")
        .font(.caption.weight(.bold))
        .foregroundStyle(BeachcarColors.muted)

      Spacer()

      if let url = URL(string: listing.url) {
        Link(destination: url) {
          Image(systemName: "ellipsis")
            .font(.headline.weight(.black))
            .frame(width: 38, height: 38)
            .background(.white.opacity(0.76), in: Circle())
        }
        .foregroundStyle(BeachcarColors.ink)
      } else {
        Color.clear.frame(width: 38, height: 38)
      }
    }
    .padding(.horizontal, 12)
    .padding(.top, 10)
    .padding(.bottom, 4)
  }

  private var detailHeader: some View {
    VStack(alignment: .leading, spacing: 8) {
      ZStack(alignment: .top) {
        PhotoCarousel(
          listing: listing,
          api: api,
          selectedImage: $selectedImage,
          showsPhotoBadge: false,
          showsThumbnails: listing.images.count > 1,
          emptyStyle: .compact
        )
        .frame(height: listing.images.isEmpty ? 150 : 218)

        HStack(spacing: 8) {
          Chip(text: listing.site, style: .neutral)
          Spacer()
          Chip(text: compactTime(listing.timeLeft ?? listing.ends), style: .sand)
        }
        .padding(10)
      }
      HStack(spacing: 8) {
        Chip(text: "Details", style: .accent)
        Chip(text: listing.lane.label, style: .mint)
        if listing.isWildcard {
          Chip(text: "Wildcard", style: .sand)
        }
        Spacer()
        Text(listing.total)
          .font(.headline.weight(.black))
      }
      Text(listing.title)
        .font(.system(size: 24, weight: .black, design: .rounded))
        .lineLimit(2)
        .minimumScaleFactor(0.74)
        .fixedSize(horizontal: false, vertical: true)
      Label(listing.location ?? "Location check", systemImage: "mappin.and.ellipse")
        .font(.footnote.weight(.semibold))
        .foregroundStyle(BeachcarColors.secondary)
    }
  }

  private var valuationPanel: some View {
    Panel(title: "Market read", systemImage: "chart.line.uptrend.xyaxis") {
      VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 0) {
          MetricTile(label: "Current", value: listing.bid)
          Divider().opacity(0.3)
          MetricTile(label: "Fair", value: compactMarketCopy(listing.fair))
          Divider().opacity(0.3)
          MetricTile(label: "My stop", value: compactMarketCopy(listing.ceiling), tone: .stop)
        }
        .frame(height: 68)
        MarketMeter(confidence: listing.confidence ?? "medium")
      }
    }
  }

  private var practicalPanel: some View {
    Panel(title: "Use case", systemImage: "figure.2.and.child.holdinghands") {
      LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
        DetailBadge(systemImage: "beach.umbrella", title: "Beach run", value: listing.lane == .family ? "Family lane" : listing.lane.label)
        DetailBadge(systemImage: "location", title: "Nearness", value: listing.location ?? "Check")
        DetailBadge(systemImage: "person.2", title: "Kids", value: "Confirm belts")
        DetailBadge(systemImage: "doc.text.magnifyingglass", title: "CT", value: "Title/registration")
      }
    }
  }

  private var notePanel: some View {
    Panel(title: "Why I picked it", systemImage: "sparkles") {
      VStack(alignment: .leading, spacing: 7) {
        Text(listing.why)
          .font(.callout)
          .foregroundStyle(BeachcarColors.ink)
          .fixedSize(horizontal: false, vertical: true)
        if let wildcardReason = listing.wildcardReason, listing.isWildcard {
          Label(wildcardReason, systemImage: "shuffle")
            .font(.caption.weight(.bold))
            .foregroundStyle(BeachcarColors.teal)
        }
      }
    }
  }

  private var diligencePanel: some View {
    Panel(title: "Check before bidding", systemImage: "checklist") {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(diligenceItems, id: \.self) { item in
          Label(item, systemImage: "circle")
            .font(.callout.weight(.semibold))
            .foregroundStyle(BeachcarColors.secondary)
        }
      }
    }
  }

  private var activityPanel: some View {
    Panel(title: "Auction activity", systemImage: "dot.radiowaves.left.and.right") {
      HStack(spacing: 10) {
        DetailBadge(systemImage: "hammer", title: "Bids", value: listing.bids ?? "check")
        DetailBadge(systemImage: "person.3", title: "Bidders", value: listing.bidders ?? "check")
        DetailBadge(systemImage: "bubble.left", title: "Comments", value: listing.comments ?? "check")
      }
    }
  }

  private var actionRail: some View {
    HStack(spacing: 10) {
      RailButton(systemImage: "hand.thumbsdown", title: "Hide", selected: feedback?.action == .hide) {
        await onAction(.hide)
      }
      RailButton(systemImage: "nosign", title: "Avoid", selected: feedback?.action == .avoid, role: .destructive) {
        await onAction(.avoid)
      }
      RailButton(systemImage: "heart", title: "Like", selected: feedback?.action == .like) {
        await onAction(.like)
      }
      RailButton(systemImage: "star", title: "Star", selected: feedback?.action == .star, role: .positive) {
        await onAction(.star)
      }
      if let url = URL(string: listing.url) {
        Link(destination: url) {
          VStack(spacing: 3) {
            Image(systemName: "arrow.up.right.square")
            Text("Open")
              .font(.caption2.weight(.bold))
          }
          .frame(maxWidth: .infinity, minHeight: 54)
          .background(BeachcarColors.mint.opacity(0.18), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .foregroundStyle(BeachcarColors.ink)
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(.white.opacity(0.78))
  }

  private var diligenceItems: [String] {
    let parsed = listing.concerns
      .split { character in
        character == "," || character == ";" || character == "."
      }
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    if parsed.isEmpty {
      return ["VIN/title history", "Rust/underbody", "Seat belts and local legality"]
    }
    return Array(parsed.prefix(4))
  }
}
