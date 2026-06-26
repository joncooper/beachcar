import SwiftUI

struct ListingCardView: View {
  let listing: AuctionListing
  let feedback: FeedbackRecord?
  let api: AuctionAPI
  let tokenProvider: AuctionAPI.TokenProvider
  let onAction: (FeedbackAction) async -> Void
  let onNote: (String) async -> PreferenceNoteResult

  @State private var selectedImage = 0
  @State private var isFlipped = false
  @State private var cardDrag: CGFloat = 0
  @State private var strongHoldStartedAt: Date?
  @State private var hasCrossedCommit = false
  @State private var hasCrossedStrong = false
  @State private var isSaving = false
  @State private var swipeIntent: CardSwipeIntent = .undecided

  var body: some View {
    GeometryReader { proxy in
      let horizontalInset: CGFloat = 12
      let bottomInset: CGFloat = 10
      let contentWidth = max(0, proxy.size.width - horizontalInset * 2)
      let contentHeight = max(0, proxy.size.height - bottomInset)

      ZStack(alignment: .top) {
        if isFlipped {
          ListingDetailBackView(
            listing: listing,
            feedback: feedback,
            api: api,
            selectedImage: $selectedImage,
            onFlip: flip,
            onAction: save,
            onNote: onNote
          )
          .transition(.asymmetric(insertion: .scale(scale: 0.96).combined(with: .opacity), removal: .opacity))
        } else {
          frontCard(availableWidth: contentWidth, availableHeight: contentHeight)
            .transition(.asymmetric(insertion: .opacity, removal: .scale(scale: 0.96).combined(with: .opacity)))
        }
      }
      .frame(width: contentWidth, height: contentHeight, alignment: .top)
      .padding(.horizontal, horizontalInset)
      .padding(.bottom, bottomInset)
    }
  }

  private func frontCard(availableWidth: CGFloat, availableHeight: CGFloat) -> some View {
    let hasImages = !listing.displayImages.isEmpty
    let bodyHeight = hasImages
      ? min(max(availableHeight * 0.34, 306), 382)
      : min(max(availableHeight * 0.50, 382), 452)
    let rawPhotoHeight = availableHeight - bodyHeight - 8
    let photoHeight = hasImages ? max(330, rawPhotoHeight) : min(max(rawPhotoHeight, 210), 285)
    let commitDistance = SwipeDecision.commitDistance(for: availableWidth)
    let strongDistance = SwipeDecision.strongDistance(for: availableWidth)

    return VStack(spacing: 8) {
      PhotoCarousel(
        listing: listing,
        api: api,
        selectedImage: $selectedImage,
        emptyStyle: hasImages ? .standard : .compact
      )
        .frame(height: photoHeight)
        .accessibilityIdentifier("photo-carousel")

      ZStack {
        SwipeActionBackdrop(offset: cardDrag, strongHoldStartedAt: strongHoldStartedAt, commitDistance: commitDistance, strongDistance: strongDistance)
          .opacity(abs(cardDrag) > 18 ? 1 : 0)
          .animation(.snappy(duration: 0.18), value: abs(cardDrag) > 18)

        cardBody
          .offset(x: cardDrag * 0.58, y: abs(cardDrag) * 0.016)
          .rotationEffect(.degrees(clamped(cardDrag / 14, min: -18, max: 18)), anchor: UnitPoint(x: 0.5, y: 0.68))
          .scaleEffect(cardDrag == 0 ? 1 : 0.982)
          .shadow(color: swipeColor.opacity(abs(cardDrag) > commitDistance ? 0.22 : 0.08), radius: abs(cardDrag) > 0 ? 18 : 8, y: 10)
          .overlay(alignment: cardDrag >= 0 ? .topTrailing : .topLeading) {
            SwipeSignal(offset: cardDrag, strongHoldStartedAt: strongHoldStartedAt, commitDistance: commitDistance, strongDistance: strongDistance)
              .padding(14)
          }
          .contentShape(Rectangle())
          .simultaneousGesture(cardDecisionGesture(cardWidth: availableWidth))
          .accessibilityIdentifier("listing-card-body")
      }
      .frame(height: bodyHeight)
    }
    .opacity(isSaving ? 0.75 : 1)
  }

  private var cardBody: some View {
    Button {
      flip()
    } label: {
      cardBodyContent
    }
    .buttonStyle(.plain)
  }

  private var cardBodyContent: some View {
    VStack(alignment: .leading, spacing: 9) {
      HStack(spacing: 8) {
        HStack(spacing: 6) {
          Chip(text: feedback?.action.label ?? "New", style: feedback == nil ? .accent : .neutral)
          Chip(text: listing.lane.label, style: .mint)
          if listing.isWildcard {
            Chip(text: "Wildcard", style: .sand)
          }
        }
        .layoutPriority(1)
        Spacer()
        HStack(spacing: 6) {
          Text(compactTime(listing.timeLeft ?? listing.ends))
            .font(.footnote.weight(.black))
            .foregroundStyle(BeachcarColors.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.white.opacity(0.76), in: Capsule())
          Text(listing.total)
            .font(.footnote.weight(.black))
            .lineLimit(1)
            .minimumScaleFactor(0.82)
        }
      }

      VStack(alignment: .leading, spacing: 6) {
        Text(listing.title)
          .font(.system(size: 24, weight: .black, design: .rounded))
          .foregroundStyle(BeachcarColors.ink)
          .lineLimit(2)
          .minimumScaleFactor(0.78)
          .fixedSize(horizontal: false, vertical: true)
          .layoutPriority(3)
          .accessibilityIdentifier("listing-title")
        HStack(spacing: 8) {
          Label(locationLabel, systemImage: "mappin.and.ellipse")
            .lineLimit(1)
          Spacer(minLength: 6)
          Text(listing.site)
            .fontWeight(.black)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(BeachcarColors.secondary)
      }

      Text(listing.currentTake ?? listing.why)
        .font(.callout)
        .lineLimit(1)
        .minimumScaleFactor(0.78)
        .foregroundStyle(BeachcarColors.secondary)

      HStack(spacing: 8) {
        Label("Details", systemImage: "arrow.triangle.2.circlepath")
          .font(.caption.weight(.black))
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .background(BeachcarColors.teal.opacity(0.12), in: Capsule())
          .foregroundStyle(BeachcarColors.teal)
        Spacer()
        if let wildcardReason = listing.wildcardReason, listing.isWildcard {
          Text(wildcardReason)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .foregroundStyle(BeachcarColors.secondary)
        } else if listing.displayImages.isEmpty {
          Text("image pending")
            .font(.caption.weight(.semibold))
            .foregroundStyle(BeachcarColors.muted)
        }
      }

      HStack(spacing: 0) {
        MetricTile(label: "Current", value: listing.bid)
        Divider().opacity(0.35)
        MetricTile(label: "Fair", value: compactMarketCopy(listing.fair))
        Divider().opacity(0.35)
        MetricTile(label: "Stop", value: compactMarketCopy(listing.ceiling), tone: .stop)
      }
      .frame(height: 58)
      .background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(BeachcarColors.hairline, lineWidth: 1)
      }

      HStack(spacing: 0) {
        StatPill(systemImage: "hammer", text: "\(listing.bids ?? "check") bids")
        StatPill(systemImage: "person.3", text: "\(listing.bidders ?? "check") bidders")
        StatPill(systemImage: "bubble.left", text: "\(listing.comments ?? "check") comments")
      }
    }
    .padding(13)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .stroke(.white.opacity(0.65), lineWidth: 1)
    }
  }

  private func cardDecisionGesture(cardWidth: CGFloat) -> some Gesture {
    DragGesture(minimumDistance: 24)
      .onChanged { value in
        let width = value.translation.width
        let height = value.translation.height
        let distance = abs(width)
        let verticalDistance = abs(height)
        if swipeIntent == .undecided {
          if verticalDistance > 16 && verticalDistance > distance * 0.72 {
            swipeIntent = .vertical
          } else if distance >= SwipeDecision.intentDistance && distance > verticalDistance * 1.9 {
            swipeIntent = .horizontal
          } else {
            cardDrag = 0
            return
          }
        }

        guard swipeIntent == .horizontal else {
          cardDrag = 0
          return
        }

        cardDrag = width
        let commitDistance = SwipeDecision.commitDistance(for: cardWidth)
        let strongDistance = SwipeDecision.strongDistance(for: cardWidth)
        updateSwipeMilestones(distance: distance, commitDistance: commitDistance, strongDistance: strongDistance)
        if distance >= strongDistance {
          if strongHoldStartedAt == nil {
            strongHoldStartedAt = Date()
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
          }
        } else {
          strongHoldStartedAt = nil
        }
      }
      .onEnded { value in
        guard swipeIntent == .horizontal else {
          resetSwipeState()
          return
        }
        let width = value.translation.width
        let action = SwipeDecision.action(
          offset: width,
          cardWidth: cardWidth,
          strongHoldStartedAt: strongHoldStartedAt,
          endedAt: Date()
        )
        guard let action else {
          resetSwipeState()
          return
        }
        UIImpactFeedbackGenerator(style: action == .star || action == .avoid ? .heavy : .medium).impactOccurred()
        let direction: CGFloat = action == .hide || action == .avoid ? -1 : 1
        withAnimation(.spring(response: 0.32, dampingFraction: 0.78)) {
          cardDrag = direction * 540
          strongHoldStartedAt = nil
        }
        Task {
          await save(action)
          await MainActor.run {
            cardDrag = 0
            clearSwipeMilestones()
          }
        }
      }
  }

  private var swipeColor: Color {
    cardDrag >= 0 ? BeachcarColors.teal : BeachcarColors.stop
  }

  private var locationLabel: String {
    listing.location ?? "Location check"
  }

  private func save(_ action: FeedbackAction) async {
    guard !isSaving else { return }
    isSaving = true
    await onAction(action)
    isSaving = false
  }

  private func flip() {
    guard abs(cardDrag) < 8, swipeIntent != .horizontal else { return }
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) {
      isFlipped.toggle()
    }
  }

  private func updateSwipeMilestones(distance: CGFloat, commitDistance: CGFloat, strongDistance: CGFloat) {
    if distance >= commitDistance && !hasCrossedCommit {
      UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.55)
      hasCrossedCommit = true
    } else if distance < commitDistance {
      hasCrossedCommit = false
    }

    if distance >= strongDistance && !hasCrossedStrong {
      UIImpactFeedbackGenerator(style: .heavy).impactOccurred(intensity: 0.72)
      hasCrossedStrong = true
    } else if distance < strongDistance {
      hasCrossedStrong = false
    }
  }

  private func resetSwipeState() {
    withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
      cardDrag = 0
      strongHoldStartedAt = nil
    }
    clearSwipeMilestones()
    swipeIntent = .undecided
  }

  private func clearSwipeMilestones() {
    strongHoldStartedAt = nil
    hasCrossedCommit = false
    hasCrossedStrong = false
    swipeIntent = .undecided
  }

  private func clamped(_ value: CGFloat, min minimum: CGFloat, max maximum: CGFloat) -> CGFloat {
    Swift.min(maximum, Swift.max(minimum, value))
  }
}

private enum CardSwipeIntent {
  case undecided
  case horizontal
  case vertical
}

enum SwipeDecision {
  static let intentDistance: CGFloat = 44
  static let strongHoldDuration: TimeInterval = 1.2

  static func commitDistance(for cardWidth: CGFloat) -> CGFloat {
    min(max(cardWidth * 0.42, 168), 232)
  }

  static func strongDistance(for cardWidth: CGFloat) -> CGFloat {
    min(max(cardWidth * 0.92, 340), cardWidth * 0.98)
  }

  static func action(offset: CGFloat, cardWidth: CGFloat, strongHoldStartedAt: Date?, endedAt: Date) -> FeedbackAction? {
    let commitDistance = commitDistance(for: cardWidth)
    let strongDistance = strongDistance(for: cardWidth)
    if offset >= strongDistance {
      if hasCompletedStrongHold(strongHoldStartedAt, endedAt: endedAt) {
        return .star
      }
      return .like
    }
    if offset <= -strongDistance {
      if hasCompletedStrongHold(strongHoldStartedAt, endedAt: endedAt) {
        return .avoid
      }
      return .hide
    }
    if offset >= commitDistance {
      return .like
    }
    if offset <= -commitDistance {
      return .hide
    }
    return nil
  }

  static func strongHoldProgress(startedAt: Date?, now: Date) -> CGFloat {
    guard let startedAt else { return 0 }
    let elapsed = now.timeIntervalSince(startedAt)
    return min(1, max(0, elapsed / strongHoldDuration))
  }

  private static func hasCompletedStrongHold(_ startedAt: Date?, endedAt: Date) -> Bool {
    guard let startedAt else { return false }
    return endedAt.timeIntervalSince(startedAt) >= strongHoldDuration
  }
}
