import SwiftUI

// Transient interaction state for the Shade surface. Ports the prototype's
// component logic: feed paging, photo paging, the Shade pull-to-judge gesture,
// the list pull-down, the dossier throw-to-close, and the toast/burst/coach-mark
// choreography. Pure UI state — persistence is delegated to `persist`.

enum DragMode { case cars, photos, shade, list }

struct ToastState: Equatable {
  let action: FeedbackAction
  let id: Int
}

@MainActor
final class ShadeController: ObservableObject {
  // Paging
  @Published var idx = 0
  @Published var photoIndex: [String: Int] = [:]

  // Live drag
  @Published var dragging = false
  @Published var mode: DragMode?
  @Published var translation: CGSize = .zero
  @Published var shade: CGFloat = 0          // 0…1 Shade pull amount
  @Published var shadeAction: FeedbackAction?
  @Published var listPull: CGFloat = 0       // 0…1 list pull amount

  // Overlays
  @Published var dossierOpen = false
  @Published var dThrow: CGSize = .zero      // live dossier drag offset
  @Published var dDragging = false
  @Published var dFly: CGSize?               // dossier exit vector
  @Published var dFlyRotation: Double = 0
  @Published var listOpen = false
  @Published var listFilter: ListFilter = .all

  // Ephemerals
  @Published var toast: ToastState?
  @Published var burst = 0
  @Published var showHint = true
  @Published var note = ""

  // Config (design defaults)
  var commitThreshold: CGFloat = 0.6
  var celebrate = true
  var trayLabels = true

  /// Persist a judgement for the current car. Set by the host view.
  var persist: ((FeedbackAction) -> Void)?
  var carCount = 0

  private var toastWork: DispatchWorkItem?
  private var advanceWork: DispatchWorkItem?
  private var hintWork: DispatchWorkItem?
  private var flyWork: DispatchWorkItem?
  private var dossierTapWork: DispatchWorkItem?
  private var lastTap: Date = .distantPast
  private var lastDossierTap: Date = .distantPast
  private var dossierBodyThrowing = false

  let trayActions: [FeedbackAction] = [.hide, .avoid, .like, .star]

  // MARK: lifecycle

  func startHintTimer() {
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.showHint else { return }
      withAnimation(.easeOut(duration: 0.3)) { self.showHint = false }
    }
    hintWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
  }

  func photo(for key: String) -> Int { photoIndex[key] ?? 0 }

  // MARK: feed drag

  func dragChanged(_ value: DragGesture.Value, geo: FeedGeometry) {
    guard !dossierOpen, !listOpen else { return }
    let dx = value.translation.width
    let dy = value.translation.height
    translation = value.translation
    if !dragging { dragging = true }

    if mode == nil, abs(dx) > 6 || abs(dy) > 6 {
      mode = resolveMode(start: value.startLocation, dx: dx, dy: dy, geo: geo)
    }

    switch mode {
    case .shade:
      shade = clamp(dy / 170, 0, 1)
      let col = Int(clamp(value.location.x / (geo.width / 4), 0, 3))
      shadeAction = trayActions[col]
    case .list:
      listPull = clamp(dy / 180, 0, 1)
    default:
      break
    }
  }

  func dragEnded(_ value: DragGesture.Value, geo: FeedGeometry) {
    guard !dossierOpen, !listOpen else { return }
    defer { resetDrag() }
    guard mode != nil else { return }   // taps are handled by the spatial-tap gesture
    let dx = value.translation.width
    let dy = value.translation.height
    let vx = value.velocity.width
    let vy = value.velocity.height

    switch mode {
    case .cars:
      if dy < -90 || vy < -650 { pageCar(+1) }
      else if dy > 90 || vy > 650 { pageCar(-1) }
    case .photos:
      if dx < -55 || vx < -500 { pagePhoto(+1) }
      else if dx > 55 || vx > 500 { pagePhoto(-1) }
    case .shade:
      if shade >= commitThreshold, let action = shadeAction {
        doAction(action, advance: true)
      }
    case .list:
      if listPull >= 0.4 || vy > 600 { openList() }
    case nil:
      break
    }
  }

  private func resolveMode(start: CGPoint, dx: CGFloat, dy: CGFloat, geo: FeedGeometry) -> DragMode {
    let horizontal = abs(dx) > abs(dy)
    let y = start.y
    if y < geo.listEdge {
      return dy > 0 ? .list : .cars
    }
    if y < geo.photoTop {                       // chrome band
      return dy > 0 ? .shade : .cars
    }
    if y < geo.photoBottom {                     // on the photo
      if horizontal { return .photos }
      if dy > 0, y < geo.shadeBottom { return .shade }
      return .cars
    }
    return .cars                                  // info sheet
  }

  private func resetDrag() {
    dragging = false
    mode = nil
    translation = .zero
    withAnimation(.easeOut(duration: 0.18)) {
      shade = 0
      listPull = 0
    }
    shadeAction = nil
  }

  // MARK: paging

  private func pageCar(_ delta: Int) {
    let next = idx + delta
    guard next >= 0, next < carCount else { return }   // clamp; rubber-band already signalled ends
    withAnimation(.feedSpring) { idx = next }
  }

  /// Wrapping advance used after a judgement so the daily loop continues at the end.
  func advanceWrapping() {
    guard carCount > 0 else { return }
    withAnimation(.feedSpring) { idx = (idx + 1) % carCount }
  }

  func jump(to index: Int) {
    withAnimation(.feedSpring) {
      idx = index
      listOpen = false
    }
  }

  private func pagePhoto(_ delta: Int) {
    setPhoto(delta)
  }

  /// Host injects current car identity so paging/taps can resolve photos.
  var currentCarInfo: (() -> (key: String, count: Int)?)?

  func setPhoto(_ delta: Int) {
    guard let info = currentCarInfo?() else { return }
    let next = clamp(CGFloat((photoIndex[info.key] ?? 0) + delta), 0, CGFloat(info.count - 1))
    withAnimation(.photoSpring) { photoIndex[info.key] = Int(next) }
  }

  // MARK: taps (driven by a spatial-tap gesture on the feed)

  func feedTap(at point: CGPoint, geo: FeedGeometry) {
    guard !dossierOpen, !listOpen else { return }
    // Ignore taps that land on the chrome buttons row.
    if point.y < geo.photoTop { return }
    let now = Date()
    if now.timeIntervalSince(lastTap) < 0.3 {
      lastTap = .distantPast
      dossierTapWork?.cancel()
      doAction(.like, advance: false)
      return
    }
    lastTap = now
    let third = geo.width / 3
    if point.x < third { setPhoto(-1); return }
    if point.x > geo.width - third { setPhoto(+1); return }

    let work = DispatchWorkItem { [weak self] in
      guard let self else { return }
      if Date().timeIntervalSince(self.lastTap) >= 0.28 { self.openDossier() }
    }
    dossierTapWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.29, execute: work)
  }

  // MARK: judging

  func doAction(_ action: FeedbackAction, advance: Bool) {
    persist?(action)
    if showHint { showHint = false }
    let id = (toast?.id ?? 0) + 1
    withAnimation(.spring(duration: 0.3)) { toast = ToastState(action: action, id: id) }
    if celebrate, action == .like || action == .star { burst += 1 }

    toastWork?.cancel()
    let tw = DispatchWorkItem { [weak self] in
      withAnimation(.easeOut(duration: 0.3)) { self?.toast = nil }
    }
    toastWork = tw
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: tw)

    if advance {
      advanceWork?.cancel()
      let aw = DispatchWorkItem { [weak self] in self?.advanceWrapping() }
      advanceWork = aw
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.28, execute: aw)
    }
  }

  // MARK: dossier

  func openDossier() {
    dossierTapWork?.cancel()
    dFly = nil
    dFlyRotation = 0
    dThrow = .zero
    dDragging = false
    dossierBodyThrowing = false
    showHint = false
    withAnimation(.spring(duration: 0.3)) { dossierOpen = true }
  }

  func dossierDragChanged(_ value: DragGesture.Value) {
    dDragging = true
    dThrow = value.translation
  }

  func dossierDragEnded(_ value: DragGesture.Value) {
    dDragging = false
    let intent = dossierThrowIntent(value)
    if intent.shouldClose {
      throwClose(ux: intent.ux, uy: intent.uy, dx: intent.dx)
    } else {
      withAnimation(.spring(duration: 0.3)) { dThrow = .zero }
    }
  }

  func dossierBodyDragChanged(_ value: DragGesture.Value) {
    let dx = value.translation.width
    let dy = value.translation.height
    let dist = hypot(dx, dy)
    if !dossierBodyThrowing {
      let horizontal = abs(dx) > 30 && abs(dx) > abs(dy) * 0.72
      let diagonal = dist > 76 && abs(dx) > 24 && abs(dy) > 24
      let predicted = value.predictedEndTranslation
      let predictedDist = hypot(predicted.width, predicted.height)
      let predictedDiagonal = predictedDist > 190 && abs(predicted.width) > 34 && abs(predicted.height) > 34
      let fastFlick = dossierThrowIntent(value).shouldClose && abs(value.velocity.width) > abs(value.velocity.height) * 0.42
      guard horizontal || diagonal || predictedDiagonal || fastFlick else { return }
      dossierBodyThrowing = true
    }
    dossierDragChanged(value)
  }

  func dossierBodyDragEnded(_ value: DragGesture.Value) {
    guard dossierBodyThrowing else {
      dDragging = false
      withAnimation(.spring(duration: 0.24)) { dThrow = .zero }
      return
    }
    dossierBodyThrowing = false
    dossierDragEnded(value)
  }

  func dossierBodyTap() {
    let now = Date()
    if now.timeIntervalSince(lastDossierTap) < 0.32 {
      lastDossierTap = .distantPast
      throwClose(ux: 0, uy: -1, dx: 0)
    } else {
      lastDossierTap = now
    }
  }

  func throwClose(ux: CGFloat, uy: CGFloat, dx: CGFloat) {
    var nx = ux, ny = uy
    if abs(ny) > 0.9, abs(nx) < 0.25 {            // near-vertical → bias to a diagonal corner
      nx = dx >= 0 ? 0.5 : -0.5
      ny = ny < 0 ? -0.88 : 0.88
      let m = hypot(nx, ny); nx /= m; ny /= m
    }
    let target = CGSize(width: nx * 640, height: ny * 860)
    let rot = Double(nx) * 20 * (ny < 0 ? 1 : -1)
    withAnimation(.timingCurve(0.4, 0, 0.6, 1, duration: 0.3)) {
      dFly = target
      dFlyRotation = rot
      dThrow = .zero
    }
    flyWork?.cancel()
    let fw = DispatchWorkItem { [weak self] in
      self?.dossierOpen = false
      self?.dFly = nil
      self?.dFlyRotation = 0
      self?.dossierBodyThrowing = false
    }
    flyWork = fw
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: fw)
  }

  private func dossierThrowIntent(_ value: DragGesture.Value) -> (shouldClose: Bool, ux: CGFloat, uy: CGFloat, dx: CGFloat) {
    let translation = value.translation
    let predicted = value.predictedEndTranslation
    let velocity = value.velocity
    let dist = hypot(translation.width, translation.height)
    let predictedDist = hypot(predicted.width, predicted.height)
    let speed = hypot(velocity.width, velocity.height)
    let shouldClose = dist > 110 || predictedDist > 185 || speed > 720

    let direction: CGSize
    if predictedDist > max(dist + 28, 48) {
      direction = predicted
    } else if dist > 10 {
      direction = translation
    } else {
      direction = velocity
    }

    let directionDist = max(hypot(direction.width, direction.height), 1)
    return (
      shouldClose: shouldClose,
      ux: direction.width / directionDist,
      uy: direction.height / directionDist,
      dx: direction.width
    )
  }

  // MARK: list

  func openList() {
    showHint = false
    withAnimation(.overlaySpring) {
      listOpen = true
      listPull = 0
    }
  }

  func closeList() {
    withAnimation(.overlaySpring) { listOpen = false }
  }
}

// MARK: - Geometry + helpers

struct FeedGeometry {
  let size: CGSize
  let safeTop: CGFloat
  var width: CGFloat { size.width }
  var height: CGFloat { size.height }

  let chromeHeight: CGFloat = 50
  var photoHeight: CGFloat { clamp(size.height * 0.31, 238, 310) }

  var photoTop: CGFloat { safeTop + chromeHeight }
  var photoBottom: CGFloat { photoTop + photoHeight }
  var listEdge: CGFloat { safeTop + 14 }
  var shadeBottom: CGFloat { photoTop + photoHeight * 0.5 }
}

func clamp<T: Comparable>(_ v: T, _ lo: T, _ hi: T) -> T { min(hi, max(lo, v)) }

extension Animation {
  static let feedSpring = Animation.timingCurve(0.2, 0.9, 0.24, 1, duration: 0.52)
  static let photoSpring = Animation.timingCurve(0.2, 0.9, 0.24, 1, duration: 0.42)
  static let overlaySpring = Animation.timingCurve(0.2, 0.85, 0.22, 1, duration: 0.42)
}
