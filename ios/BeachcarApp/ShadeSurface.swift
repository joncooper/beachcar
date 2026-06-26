import SwiftUI

// The Shade review surface: full-bleed feed + chrome with the judging overlay,
// list pull-down, and dossier layered on top. Replaces the old deck/list/detail.

struct ShadeSurface: View {
  @ObservedObject var store: BeachcarStore
  let tokenProvider: AuctionAPI.TokenProvider
  var cacheScope: String?

  @StateObject private var controller = ShadeController()
  @AppStorage("shade.coachSeen.v1") private var coachSeen = false

  private var cars: [AuctionListing] { store.run?.listings ?? [] }
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
        safeTop: proxy.safeAreaInsets.top
      )
      ZStack {
        BC.bg

        if store.isLoading && store.run == nil {
          ShadeLoadingView()
        } else if cars.isEmpty {
          ShadeEmptyView(hasRun: store.run != nil) {
            await store.load(tokenProvider: tokenProvider, cacheScope: cacheScope)
          }
        } else {
          feedLayer(geo)
          overlays(geo)
        }
      }
      .frame(width: geo.width, height: geo.height)
      .ignoresSafeArea()
    }
    .onAppear { configure() }
    .onChange(of: cars.count) { _, count in controller.carCount = count }
  }

  // MARK: layers

  private func feedLayer(_ geo: FeedGeometry) -> some View {
    ZStack(alignment: .top) {
      ShadeFeed(controller: controller, cars: cars, api: store.api, geo: geo)
      FeedChrome(controller: controller, cars: cars, geo: geo, onList: controller.openList)
      statusPill(geo)
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
    .accessibilityIdentifier("shade-surface")
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

    ShadeListOverlay(controller: controller, cars: cars, feedbackByKey: store.feedbackByKey, api: store.api, geo: geo)

    if let car = currentCar {
      ShadeDossierOverlay(controller: controller, car: car, api: store.api, geo: geo) { note in
        Task { _ = await store.submitPreferenceNote(note, listing: car, tokenProvider: tokenProvider) }
      }
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

  @ViewBuilder
  private func statusPill(_ geo: FeedGeometry) -> some View {
    if let status = store.agentRun?.status, status == .queued || status == .running || status == .failed {
      HStack(spacing: 7) {
        Image(systemName: status == .failed ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath")
          .font(.system(size: 11, weight: .bold))
        Text(status == .failed ? "Run failed" : (status == .queued ? "Run queued" : "Workflow running"))
          .font(.mono(10.5, bold: true))
      }
      .foregroundStyle(status == .failed ? BC.danger : BC.star)
      .padding(.horizontal, 11).padding(.vertical, 6)
      .background(Color(hex: 0x080a0e).opacity(0.82), in: Capsule())
      .overlay(Capsule().stroke((status == .failed ? BC.danger : BC.star).opacity(0.4), lineWidth: 1))
      .padding(.top, geo.safeTop + geo.chromeHeight + 8)
      .frame(maxHeight: .infinity, alignment: .top)
      .allowsHitTesting(false)
    }
  }

  // MARK: wiring

  private func configure() {
    controller.carCount = cars.count
    controller.currentCarInfo = { [weak store] in
      guard let list = store?.run?.listings, list.indices.contains(controller.idx) else { return nil }
      let car = list[controller.idx]
      return (car.key, max(car.images.count, 1))
    }
    controller.persist = { [weak store] action in
      guard let store, let list = store.run?.listings, list.indices.contains(controller.idx) else { return }
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
