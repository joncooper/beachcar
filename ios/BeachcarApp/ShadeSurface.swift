import SwiftUI

// The Shade review surface: full-bleed feed + chrome with the judging overlay,
// list pull-down, and dossier layered on top. Replaces the old deck/list/detail.

struct ShadeSurface: View {
  @ObservedObject var store: BeachcarStore
  let tokenProvider: AuctionAPI.TokenProvider
  var cacheScope: String?

  @StateObject private var controller = ShadeController()
  @AppStorage("shade.coachSeen.v1") private var coachSeen = false
  @State private var undoDismissTask: Task<Void, Never>?

  private var cars: [AuctionListing] { store.visibleListings }
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
          ShadeEmptyView(hasRun: store.run != nil) {
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
    .onDisappear { undoDismissTask?.cancel() }
  }

  // MARK: layers

  private func feedLayer(_ geo: FeedGeometry) -> some View {
    ZStack(alignment: .top) {
      ShadeFeed(controller: controller, cars: cars, sourceSummary: store.run?.sourceSummary, api: store.api, geo: geo)
      FeedChrome(controller: controller, cars: cars, geo: geo, onList: controller.openList)
      statusNotices(geo)
      if controller.showHint { coachMark(geo) }
    }
    // .top alignment pins the oversized paging column to the top (no center shift);
    // clip hides the off-screen panels.
    .frame(width: geo.width, height: geo.height, alignment: .top)
    .clipped()
    .contentShape(Rectangle())
    .simultaneousGesture(
      DragGesture(minimumDistance: 6)
        .onChanged { controller.dragChanged($0, geo: geo) }
        .onEnded { controller.dragEnded($0, geo: geo) }
    )
    .simultaneousGesture(
      SpatialTapGesture().onEnded { controller.feedTap(at: $0.location, geo: geo) }
    )
    // Keep child text/controls visible to the accessibility tree (and XCUITest)
    // even though the container owns the feed gestures.
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder
  private func overlays(_ geo: FeedGeometry) -> some View {
    ShadeOverlay(controller: controller, geo: geo)

    if let toast = controller.toast {
      ShadeFlash(toast: toast).id(toast.id)
      ShadeToast(toast: toast).id(toast.id)
    }
    if controller.burst > 0, let action = currentCar.flatMap({ store.feedbackByKey[$0.key]?.action }) {
      ShadeBurst(action: action).id(controller.burst)
    }

    ShadeListOverlay(
      controller: controller,
      cars: controller.listIncludeHidden ? store.orderedListings(includeHidden: true) : cars,
      feedCars: cars,
      sourceSummary: store.run?.sourceSummary,
      feedbackByKey: store.feedbackByKey,
      api: store.api,
      geo: geo
    )

    if let car = currentCar {
      ShadeDossierOverlay(controller: controller, car: car, sourceSummary: store.run?.sourceSummary, api: store.api, geo: geo) { note in
        Task { _ = await store.submitPreferenceNote(note, listing: car, tokenProvider: tokenProvider) }
      }
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

  // MARK: coach mark

  private func coachMark(_ geo: FeedGeometry) -> some View {
    VStack(spacing: 7) {
      HStack(spacing: 8) {
        Circle().fill(BC.accent).frame(width: 7, height: 7)
        Text("Pull down from the top to judge").font(.mono(10.5)).tracking(0.3).foregroundStyle(BC.white)
      }
      .padding(.horizontal, 13).padding(.vertical, 7)
      .background(Color(hex: 0x080a0e).opacity(0.72), in: Capsule())
      .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1))
      .shadow(color: .black.opacity(0.6), radius: 12, y: 6)
      BobbingHandle()
    }
    .padding(.top, geo.photoTop + 8)
    .frame(maxHeight: .infinity, alignment: .top)
    .allowsHitTesting(false)
    .transition(.opacity)
  }

  private func statusNotices(_ geo: FeedGeometry, belowChrome: Bool = true) -> some View {
    VStack(spacing: 6) {
      if store.isUsingCachedRun {
        statusNotice(
          "Showing saved copy",
          icon: "wifi.slash",
          color: BC.star,
          identifier: "shade-cached-banner"
        )
      }

      if let error = store.errorMessage, !error.isEmpty {
        statusNotice(
          "Sync issue · \(error)",
          icon: "exclamationmark.triangle.fill",
          color: BC.danger,
          identifier: "shade-error-banner"
        )
      }

      let queuedCount = store.pendingPreferenceNotes.count
      if queuedCount > 0 {
        statusNotice(
          "\(queuedCount) steering note\(queuedCount == 1 ? "" : "s") queued",
          icon: "arrow.clockwise.circle.fill",
          color: BC.sub,
          identifier: "shade-queued-notes-banner"
        )
      }

      if let status = store.agentRun?.status, status == .queued || status == .running || status == .failed {
        statusNotice(
          status == .failed ? "Run failed" : (status == .queued ? "Run queued" : "Workflow running"),
          icon: status == .failed ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath",
          color: status == .failed ? BC.danger : BC.star,
          identifier: "shade-run-status-banner"
        )
      }
    }
    .padding(.horizontal, 12)
    .padding(.top, geo.safeTop + (belowChrome ? geo.chromeHeight + 8 : 16))
    .frame(maxHeight: .infinity, alignment: .top)
    .allowsHitTesting(false)
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
      guard let list = store?.visibleListings, list.indices.contains(controller.idx) else { return nil }
      let car = list[controller.idx]
      return (car.key, max(car.displayImages.count, 1))
    }
    controller.persist = { [weak store] action in
      guard let store else { return }
      let list = store.visibleListings
      guard list.indices.contains(controller.idx) else { return }
      let car = list[controller.idx]
      Task { await store.mark(action, listing: car, tokenProvider: tokenProvider) }
      coachSeen = true
    }
    controller.showHint = !coachSeen
    if !coachSeen { controller.startHintTimer() }

    #if DEBUG
    // Debug-only hook to launch straight into an overlay for visual QA, e.g.
    // `--ui-testing --shade-open list|dossier`. No effect in release builds.
    if AppEnv.isUITesting {
      let args = ProcessInfo.processInfo.arguments
      if let i = args.firstIndex(of: "--shade-open"), args.indices.contains(i + 1) {
        switch args[i + 1] {
        case "list": controller.listOpen = true
        case "dossier": controller.dossierOpen = true
        case "shade":
          controller.mode = .shade
          controller.shadeAction = .like
          controller.shade = 0.7
          controller.showHint = false
        default: break
        }
      }
    }
    #endif
  }

  private func syncCars() {
    controller.carCount = cars.count
    if cars.isEmpty {
      controller.idx = 0
    } else if controller.idx >= cars.count {
      controller.idx = cars.count - 1
    }
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
  let reload: () async -> Void

  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: "car.side.lock").font(.system(size: 42, weight: .semibold)).foregroundStyle(BC.muted)
      Text(hasRun ? "No cars to review" : "No run yet")
        .font(.archivo(22, .extrabold)).foregroundStyle(BC.white)
      Text(hasRun ? "Today's shortlist is empty." : "Pull to refresh, or check back after the next daily run.")
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

private struct BobbingHandle: View {
  @State private var down = false
  var body: some View {
    Capsule().fill(Color.white.opacity(0.5)).frame(width: 30, height: 4)
      .offset(y: down ? 6 : 0)
      .animation(AppEnv.isUITesting ? nil : .easeInOut(duration: 1.2).repeatForever(autoreverses: true), value: down)
      .onAppear { down = true }
  }
}
