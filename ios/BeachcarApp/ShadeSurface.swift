import SwiftUI

// The Shade review surface: one vertically readable dossier at a time, with
// horizontal judgment and separate list and photo-gallery modes.

struct ShadeSurface: View {
  @ObservedObject var store: BeachcarStore
  let tokenProvider: AuctionAPI.TokenProvider
  var cacheScope: String?

  @StateObject private var controller = ShadeController()
  @StateObject private var interactionCoach = InteractionCoach()
  @State private var undoDismissTask: Task<Void, Never>?
  @Namespace private var photoNamespace
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var cars: [AuctionListing] { store.run?.listings ?? store.visibleListings }
  private var currentCar: AuctionListing? { cars.indices.contains(controller.idx) ? cars[controller.idx] : nil }

  var body: some View {
    GeometryReader { proxy in
      // proxy.size is safe-area-reduced; add the insets back so panels fill the
      // whole screen and safeTop positions the chrome correctly under the status bar.
      let geo = FeedGeometry(
        size: CGSize(
          width: proxy.size.width,
          height: proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
        ),
        safeTop: proxy.safeAreaInsets.top,
        safeBottom: proxy.safeAreaInsets.bottom
      )
      ZStack {
        BC.bg

        if store.isLoading && store.run == nil {
          ShadeLoadingView()
          statusNotices(geo, belowChrome: false)
        } else if cars.isEmpty {
          ShadeEmptyView(hasRun: store.run != nil, error: store.errorMessage) {
            await store.load(tokenProvider: tokenProvider, cacheScope: cacheScope)
          }
          statusNotices(geo, belowChrome: false)
        } else {
          feedLayer(geo)
          overlays(geo)
        }
      }
      .frame(width: geo.width, height: geo.height)
      .ignoresSafeArea()
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("shade-surface")
    }
    .onAppear { configure() }
    .onChange(of: cars.map(\.key)) { _, _ in syncCars() }
    .onChange(of: store.lastUndo?.listingKey) { _, listingKey in scheduleUndoDismiss(listingKey) }
    .onChange(of: reduceMotion) { _, value in controller.updateReduceMotion(value) }
    .sheet(isPresented: $controller.gesturesHelpOpen) {
      GestureHelpSheet {
        interactionCoach.replayHints()
        controller.configureCoach(stage: .new, reduceMotion: reduceMotion)
      }
    }
    .onDisappear {
      undoDismissTask?.cancel()
      controller.endCoachSession()
    }
  }

  // MARK: layers

  private func feedLayer(_ geo: FeedGeometry) -> some View {
    VStack(spacing: 0) {
      ReviewChrome(
        index: controller.idx,
        total: cars.count,
        controller: controller,
        safeTop: geo.safeTop
      )
      ZStack {
        ShadeOverlay(controller: controller, geo: geo)
        if controller.completionOpen {
          ShadeCompletionView(
            feedback: store.feedbackByKey,
            total: cars.count,
            onOpenList: controller.openList,
            onReviewAgain: controller.reviewAgain
          )
          .transition(.opacity.combined(with: .scale(scale: 0.98)))
        } else if let car = currentCar {
          ShadeReviewPage(
            controller: controller,
            car: car,
            listingIndex: controller.idx,
            totalListings: cars.count,
            sourceSummary: store.run?.sourceSummary,
            api: store.api,
            geo: geo,
            photoNamespace: photoNamespace
          ) { note in
            Task { _ = await store.submitPreferenceNote(note, listing: car, tokenProvider: tokenProvider) }
          }
          .id(car.key)
          .transition(.opacity.combined(with: .scale(scale: 0.99)))
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .contentShape(Rectangle())
      .simultaneousGesture(
        DragGesture(minimumDistance: 8)
          .onChanged { controller.reviewDragChanged($0, width: geo.width) }
          .onEnded { controller.reviewDragEnded($0, width: geo.width, reduceMotion: reduceMotion) },
        including: .all
      )
    }
    .frame(width: geo.width, height: geo.height, alignment: .top)
    .clipped()
    .accessibilityElement(children: .contain)
    .accessibilityHidden(controller.listOpen || controller.galleryOpen)
  }

  @ViewBuilder
  private func overlays(_ geo: FeedGeometry) -> some View {
    statusNotices(geo)

    if let toast = controller.toast {
      if !reduceMotion { ShadeFlash(toast: toast).id(toast.id) }
      ShadeToast(toast: toast).id(toast.id)
    }
    if !reduceMotion, controller.burst > 0, let action = currentCar.flatMap({ store.feedbackByKey[$0.key]?.action }) {
      ShadeBurst(action: action).id(controller.burst)
    }

    ShadeListOverlay(
      controller: controller,
      cars: controller.listIncludeHidden ? store.orderedListings(includeHidden: true) : store.visibleListings,
      feedCars: cars,
      sourceSummary: store.run?.sourceSummary,
      feedbackByKey: store.feedbackByKey,
      api: store.api,
      geo: geo
    )

    if controller.galleryOpen, let car = currentCar {
      ShadePhotoGallery(
        controller: controller,
        car: car,
        api: store.api,
        safeTop: geo.safeTop,
        safeBottom: geo.safeBottom,
        height: geo.height,
        coach: interactionCoach,
        photoNamespace: photoNamespace
      )
        .transition(.opacity)
        .zIndex(20)
    }

    if store.lastUndo != nil {
      VStack {
        Spacer()
        UndoBar(label: "Saved feedback", undoLabel: "Undo") {
          Task { await store.undo(tokenProvider: tokenProvider) }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, max(geo.safeBottom + 12, 22))
      }
      .transition(.move(edge: .bottom).combined(with: .opacity))
    }
  }

  private func statusNotices(_ geo: FeedGeometry, belowChrome: Bool = true) -> some View {
    VStack {
      if let summary = statusSummary {
        statusNotice(summary.text, icon: summary.icon, color: summary.color, identifier: "shade-status-banner")
      }
    }
    .padding(.horizontal, 12)
    .padding(.top, geo.safeTop + (belowChrome ? geo.chromeHeight + 8 : 16))
    .frame(maxHeight: .infinity, alignment: .top)
    .allowsHitTesting(false)
  }

  private var statusSummary: (text: String, icon: String, color: Color)? {
    let queued = store.pendingPreferenceNotes.count
    let cachedTail = store.isUsingCachedRun ? " · saved copy" : ""
    let queuedTail = queued > 0 ? " · \(queued) note\(queued == 1 ? "" : "s") queued" : ""
    if let error = store.errorMessage, !error.isEmpty {
      return ("Sync issue\(cachedTail)\(queuedTail) · \(error)", "exclamationmark.triangle.fill", BC.danger)
    }
    if store.agentRun?.status == .failed {
      return ("Run failed\(cachedTail)\(queuedTail)", "exclamationmark.triangle.fill", BC.danger)
    }
    if store.isUsingCachedRun {
      return ("Offline · showing saved copy\(queuedTail)", "wifi.slash", BC.star)
    }
    if queued > 0 {
      return ("\(queued) steering note\(queued == 1 ? "" : "s") queued", "arrow.clockwise.circle.fill", BC.sub)
    }
    if let status = store.agentRun?.status, status == .queued || status == .running {
      return (status == .queued ? "Next run queued" : "Building the next shortlist", "arrow.triangle.2.circlepath", BC.star)
    }
    return nil
  }

  private func statusNotice(_ text: String, icon: String, color: Color, identifier: String) -> some View {
    HStack(spacing: 7) {
      Image(systemName: icon)
        .font(.system(size: 11, weight: .bold))
      Text(text)
        .font(.mono(10.5, bold: true))
        .lineLimit(2)
        .minimumScaleFactor(0.82)
    }
    .foregroundStyle(color)
    .padding(.horizontal, 11)
    .padding(.vertical, 6)
    .background(Color(hex: 0x080a0e).opacity(0.88), in: Capsule())
    .overlay(Capsule().stroke(color.opacity(0.4), lineWidth: 1))
    .accessibilityElement(children: .combine)
    .accessibilityLabel(text)
    .accessibilityIdentifier(identifier)
  }

  // MARK: wiring

  private func configure() {
    syncCars()
    controller.currentCarInfo = { [weak store] in
      guard let store else { return nil }
      let list = store.run?.listings ?? store.visibleListings
      guard list.indices.contains(controller.idx) else { return nil }
      let car = list[controller.idx]
      return (car.key, max(car.displayImages.count, 1))
    }
    controller.persist = { [weak store] action in
      guard let store else { return }
      let list = store.run?.listings ?? store.visibleListings
      guard list.indices.contains(controller.idx) else { return }
      let car = list[controller.idx]
      Task { await store.mark(action, listing: car, tokenProvider: tokenProvider) }
    }
    controller.onSwipeCompleted = { action in
      interactionCoach.recordReview(action)
      controller.updateCoachStage(interactionCoach.state.reviewStage)
    }
    controller.onCoachInteraction = { interactionCoach.recordInteraction() }
    interactionCoach.beginSession()

    let debugStage = debugCoachStage
    controller.configureCoach(
      stage: debugStage ?? interactionCoach.state.reviewStage,
      reduceMotion: reduceMotion
    )

    #if DEBUG
    // Debug-only hook to launch straight into an overlay for visual QA, e.g.
    // `--ui-testing --shade-open list|gallery|swipe`. No effect in release builds.
    if AppEnv.isUITesting {
      let args = ProcessInfo.processInfo.arguments
      if let i = args.firstIndex(of: "--shade-open"), args.indices.contains(i + 1) {
        switch args[i + 1] {
        case "list": controller.listOpen = true
        case "gallery": controller.openGallery()
        case "gestures": controller.gesturesHelpOpen = true
        case "swipe", "shade":
          controller.reviewRawOffset = geoPreviewWidth * 0.4
          controller.reviewOffset = geoPreviewWidth * 0.34
          controller.reviewIntent = .horizontal
          controller.reviewStage = .primary
          controller.reviewAction = .like
          controller.showHint = false
        default: break
        }
      }
    }
    #endif
  }

  private func syncCars() {
    controller.configureReview(keys: cars.map(\.key), reviewed: Set(store.feedbackByKey.keys))
    if cars.isEmpty {
      controller.idx = 0
    } else if controller.idx >= cars.count {
      controller.idx = cars.count - 1
    }
  }

  private var geoPreviewWidth: CGFloat { 390 }

  private var debugCoachStage: ReviewCoachStage? {
    #if DEBUG
    guard AppEnv.isUITesting else { return nil }
    let args = ProcessInfo.processInfo.arguments
    guard let index = args.firstIndex(of: "--coach-stage"), args.indices.contains(index + 1) else { return nil }
    switch args[index + 1] {
    case "new": return .new
    case "primary": return .primaryLearned
    case "mastered": return .mastered
    default: return nil
    }
    #else
    return nil
    #endif
  }

  private func scheduleUndoDismiss(_ listingKey: String?) {
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
}

// MARK: - Review chrome / completion

private struct ReviewChrome: View {
  let index: Int
  let total: Int
  @ObservedObject var controller: ShadeController
  let safeTop: CGFloat

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 10) {
        Text("Beachcar")
          .font(.archivo(22, .black))
          .foregroundStyle(BC.white)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Spacer()
        Button(action: controller.openList) {
          Image(systemName: Icon.list)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(BC.white)
            .frame(width: 44, height: 44)
            .background(BC.faint, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(BC.border, lineWidth: 1))
        }
        .accessibilityLabel("Open today's finds")
        .accessibilityIdentifier("shade-list-button")

        Text("FIND \(min(index + 1, max(total, 1))) OF \(max(total, 1))")
          .font(.mono(10.5, bold: true))
          .tracking(0.7)
          .foregroundStyle(BC.sub)
          .accessibilityIdentifier("shade-find-counter")
          .accessibilityLabel("Find \(min(index + 1, max(total, 1))) of \(max(total, 1))")

        Menu {
          Button("Pass", systemImage: Icon.hide) { controller.doAction(.hide, advance: true) }
          Button("Never again", systemImage: Icon.avoid) { controller.doAction(.avoid, advance: true) }
          Button("Like", systemImage: Icon.like) { controller.doAction(.like, advance: true) }
          Button("Love it", systemImage: Icon.star) { controller.doAction(.star, advance: true) }
          Divider()
          Button("Gestures", systemImage: "hand.draw") { controller.gesturesHelpOpen = true }
        } label: {
          Image(systemName: "ellipsis")
            .font(.system(size: 15, weight: .black))
            .foregroundStyle(BC.white)
            .frame(width: 44, height: 44)
            .background(BC.faint, in: Circle())
        }
        .accessibilityLabel("More review actions")
        .accessibilityIdentifier("shade-review-actions")
      }

      if controller.showHint, controller.coachStage != .mastered {
        HStack(spacing: 8) {
          Text("← PASS")
          Text("·")
          Text("LIKE →")
          Text("· SCROLL TO READ")
        }
        .font(.mono(10, bold: true))
        .foregroundStyle(BC.accent)
        .frame(minHeight: 28)
        .padding(.horizontal, 11)
        .background(BC.accent.opacity(0.1), in: Capsule())
        .overlay(Capsule().stroke(BC.accent.opacity(0.24), lineWidth: 1))
        .transition(.opacity.combined(with: .move(edge: .top)))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Swipe left to pass, right to like. Scroll to read.")
        .accessibilityIdentifier("shade-swipe-coach")
      }
    }
    .padding(.horizontal, 14)
    .padding(.top, safeTop + 4)
    .padding(.bottom, 8)
    .background(BC.bg)
  }
}

private struct GestureHelpSheet: View {
  let onReplayHints: () -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 6) {
            Text("A small vocabulary")
              .font(.archivo(25, .extrabold))
              .foregroundStyle(BC.white)
            Text("The dossier scrolls vertically. Decisions move sideways. Photos get their own canvas.")
              .font(.archivo(14, .medium))
              .foregroundStyle(BC.sub)
              .lineSpacing(3)
          }

          helpSection("REVIEW") {
            gestureRow(symbol: "arrow.left", title: "Swipe left", detail: "Pass · keep going for Never again", color: Icon.color(for: .hide))
            gestureRow(symbol: "arrow.right", title: "Swipe right", detail: "Like · keep going for Love it", color: Icon.color(for: .like))
            gestureRow(symbol: "arrow.up.and.down", title: "Scroll", detail: "Read the complete dossier", color: BC.accent)
          }

          helpSection("PHOTOS") {
            gestureRow(symbol: "hand.pinch", title: "Pinch or double-tap", detail: "Zoom in; drag to inspect details", color: BC.star)
            gestureRow(symbol: "arrow.up.and.down.circle", title: "Swipe decisively up or down", detail: "Return to the dossier", color: BC.accent)
            gestureRow(symbol: "hand.tap", title: "Tap once", detail: "Hide or reveal the photo controls", color: BC.sub)
          }

          Text("Every decision is also available from the ••• menu and through VoiceOver actions.")
            .font(.archivo(12.5, .medium))
            .foregroundStyle(BC.muted)
            .lineSpacing(2)

          Button {
            onReplayHints()
            dismiss()
          } label: {
            Label("Replay gesture hints", systemImage: "arrow.counterclockwise")
              .font(.archivo(14, .bold))
              .foregroundStyle(BC.accentInk)
              .frame(maxWidth: .infinity, minHeight: 48)
              .background(BC.accent, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("shade-replay-gesture-hints")
        }
        .padding(20)
      }
      .background(BC.panel)
      .navigationTitle("Gestures")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
    .preferredColorScheme(.dark)
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
    .accessibilityIdentifier("shade-gestures-help")
  }

  private func helpSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title).font(.mono(10, bold: true)).tracking(1.2).foregroundStyle(BC.muted)
      VStack(spacing: 0) { content() }
        .background(BC.card, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(BC.border, lineWidth: 1))
    }
  }

  private func gestureRow(symbol: String, title: String, detail: String, color: Color) -> some View {
    HStack(spacing: 13) {
      Image(systemName: symbol)
        .font(.system(size: 17, weight: .bold))
        .foregroundStyle(color)
        .frame(width: 38, height: 38)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.archivo(14, .bold)).foregroundStyle(BC.white)
        Text(detail).font(.archivo(12.5, .medium)).foregroundStyle(BC.sub)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 13)
    .frame(minHeight: 62)
  }
}

private struct ShadeCompletionView: View {
  let feedback: [String: FeedbackRecord]
  let total: Int
  let onOpenList: () -> Void
  let onReviewAgain: () -> Void

  private func count(_ action: FeedbackAction) -> Int {
    feedback.values.filter { $0.action == action }.count
  }

  var body: some View {
    VStack(spacing: 22) {
      ZStack {
        Circle().fill(BC.accent.opacity(0.12)).frame(width: 104, height: 104)
        Image(systemName: "checkmark.seal.fill")
          .font(.system(size: 48, weight: .bold))
          .foregroundStyle(BC.accent)
      }
      VStack(spacing: 8) {
        Text("You’re caught up")
          .font(.archivo(32, .black))
          .foregroundStyle(BC.white)
          .accessibilityIdentifier("shade-completion")
        Text("Today’s \(total) find\(total == 1 ? "" : "s") are reviewed. Your choices will shape the next shortlist.")
          .font(.archivo(15, .medium))
          .foregroundStyle(BC.sub)
          .multilineTextAlignment(.center)
          .lineSpacing(3)
      }
      HStack(spacing: 8) {
        completionCount("Passed", count(.hide), .hide)
        completionCount("Never", count(.avoid), .avoid)
        completionCount("Liked", count(.like), .like)
        completionCount("Loved", count(.star), .star)
      }
      Button(action: onOpenList) {
        Label("Open today’s finds", systemImage: Icon.list)
          .font(.archivo(15, .extrabold))
          .foregroundStyle(BC.accentInk)
          .frame(maxWidth: .infinity, minHeight: 50)
          .background(BC.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
      .buttonStyle(.plain)
      .accessibilityIdentifier("shade-completion-open-list")
      Button("Review from the beginning", action: onReviewAgain)
        .font(.archivo(13, .bold))
        .foregroundStyle(BC.sub)
        .frame(minHeight: 44)
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(BC.panel)
  }

  private func completionCount(_ label: String, _ value: Int, _ action: FeedbackAction) -> some View {
    VStack(spacing: 6) {
      Image(systemName: Icon.feedback(action)).foregroundStyle(Icon.color(for: action))
      Text("\(value)").font(.archivo(19, .black)).foregroundStyle(BC.white)
      Text(label).font(.mono(8.5, bold: true)).foregroundStyle(BC.muted)
    }
    .frame(maxWidth: .infinity, minHeight: 76)
    .background(BC.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

// MARK: - Loading / empty

private struct ShadeLoadingView: View {
  var body: some View {
    VStack(spacing: 16) {
      ProgressView().controlSize(.large).tint(BC.accent)
      Text("Loading today's finds…").font(.archivo(15, .semibold)).foregroundStyle(BC.sub)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct ShadeEmptyView: View {
  let hasRun: Bool
  let error: String?
  let reload: () async -> Void

  private var hasLoadFailure: Bool { !hasRun && !(error ?? "").isEmpty }

  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: "car.side.lock").font(.system(size: 42, weight: .semibold)).foregroundStyle(BC.muted)
      Text(hasLoadFailure ? "Couldn’t load today’s finds" : (hasRun ? "No cars to review" : "No run yet"))
        .font(.archivo(22, .extrabold)).foregroundStyle(BC.white)
      Text(hasLoadFailure ? "Check your connection and try again." : (hasRun ? "Today's shortlist is empty." : "The next daily shortlist hasn’t been published yet."))
        .font(.archivo(14)).foregroundStyle(BC.sub).multilineTextAlignment(.center)
      Button { Task { await reload() } } label: {
        Label("Refresh", systemImage: "arrow.clockwise")
          .font(.archivo(14, .bold)).foregroundStyle(BC.accentInk)
          .padding(.horizontal, 18).padding(.vertical, 11)
          .background(BC.accent, in: Capsule())
      }
      .buttonStyle(.plain)
    }
    .padding(28)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
