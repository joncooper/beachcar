import SwiftUI

// The signature judging overlay: a tray drops from the top carrying four actions,
// the user's horizontal position selects one, and a center ring fills as they pull
// past the commit threshold.

struct ShadeOverlay: View {
  @ObservedObject var controller: ShadeController
  let geo: FeedGeometry

  private var sh: CGFloat { controller.shade }
  private var active: Bool { controller.mode == .shade }
  private var th: CGFloat { controller.commitThreshold }
  private var armed: Bool { sh >= th }
  private var prog: CGFloat { clamp(sh / th, 0, 1) }
  private var action: FeedbackAction? { controller.shadeAction }

  var body: some View {
    if sh > 0.01 || active {
      ZStack {
        // Dim
        Color(hex: 0x05060a).opacity(Double(sh) * 0.66)

        // Armed radial vignette
        if let action {
          RadialGradient(
            colors: [Icon.color(for: action).opacity(0), Icon.color(for: action).opacity(0.36)],
            center: UnitPoint(x: 0.5, y: 0.46), startRadius: geo.width * 0.45, endRadius: geo.width * 0.95
          )
          .opacity(armed ? 1 : 0)
          .animation(.easeOut(duration: 0.14), value: armed)
        }

        // Center commit ring
        if sh > 0.1, let action {
          centerRing(action)
            .frame(maxHeight: .infinity, alignment: .center)
            .offset(y: -geo.height * 0.05)
            .opacity(Double(min(1, sh * 1.4)))
        }

        // Tray
        tray
          .frame(maxHeight: .infinity, alignment: .top)
      }
      .ignoresSafeArea()
      .allowsHitTesting(false)
    }
  }

  // MARK: ring

  private func centerRing(_ action: FeedbackAction) -> some View {
    let color = Icon.color(for: action)
    let armInk = action == .like ? BC.accentInk : Color(hex: 0x15120a)
    return VStack(spacing: 13) {
      ZStack {
        Circle()
          .fill(AngularGradient(
            stops: [
              .init(color: color, location: 0),
              .init(color: color, location: prog),
              .init(color: Color.white.opacity(0.13), location: min(prog + 0.0001, 1)),
              .init(color: Color.white.opacity(0.13), location: 1),
            ],
            center: .center
          ))
          .rotationEffect(.degrees(-90))
          .shadow(color: armed ? color.opacity(0.6) : .clear, radius: 14)

        Circle()
          .fill(armed ? color : Color(hex: 0x0f1117).opacity(0.94))
          .padding(8)
          .overlay(
            Image(systemName: Icon.feedback(action))
              .font(.system(size: 40, weight: .bold))
              .foregroundStyle(armed ? armInk : color)
          )
          .shadow(color: armed ? color.opacity(0.8) : .clear, radius: 25, y: 12)
      }
      .frame(width: 120, height: 120)
      .scaleEffect(0.8 + sh * 0.26)

      Text(label(action).uppercased())
        .font(.archivo(23, .extrabold))
        .tracking(2)
        .foregroundStyle(BC.white)
      Text(armed ? "release to \(label(action).lowercased())" : "keep pulling to commit")
        .font(.mono(11))
        .tracking(0.3)
        .foregroundStyle(armed ? BC.white : BC.white.opacity(0.55))
    }
  }

  // MARK: tray

  private var tray: some View {
    let trayY = -164 + sh * 164
    return VStack(spacing: 14) {
      Text("SLIDE TO CHOOSE · PULL TO COMMIT")
        .font(.mono(9.5))
        .tracking(1.6)
        .foregroundStyle(BC.white.opacity(0.5))
      HStack(spacing: 0) {
        ForEach(controller.trayActions, id: \.self) { k in
          trayAction(k)
            .frame(maxWidth: .infinity)
        }
      }
      .padding(.horizontal, 8)
    }
    .padding(.top, 62 + geo.safeTop)
    .padding(.bottom, 20)
    .frame(maxWidth: .infinity)
    .background(
      LinearGradient(
        stops: [.init(color: Color(hex: 0x0a0c10), location: 0.72), .init(color: Color(hex: 0x0a0c10).opacity(0), location: 1)],
        startPoint: .top, endPoint: .bottom
      )
    )
    .offset(y: trayY)
  }

  private func trayAction(_ k: FeedbackAction) -> some View {
    let color = Icon.color(for: k)
    let on = controller.shadeAction == k && sh > 0.32
    let ink = k == .like ? BC.accentInk : Color(hex: 0x15120a)
    return VStack(spacing: 7) {
      Image(systemName: Icon.feedback(k))
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(on ? ink : color)
        .frame(width: 56, height: 56)
        .background(on ? color : Color.white.opacity(0.07), in: Circle())
        .overlay(Circle().stroke(on ? color : Color.white.opacity(0.14), lineWidth: 1.5))
        .shadow(color: on ? color.opacity(0.75) : .clear, radius: 15, y: 8)
        .scaleEffect(on ? 1.16 : 1)
        .animation(.easeOut(duration: 0.14), value: on)
      if controller.trayLabels {
        Text(label(k))
          .font(.mono(10))
          .foregroundStyle(on ? BC.white : BC.white.opacity(0.5))
      }
    }
    .opacity(sh > 0.18 ? 1 : Double(sh * 5))
  }

  private func label(_ action: FeedbackAction) -> String {
    switch action {
    case .like: "Like"
    case .star: "Star"
    case .hide: "Hide"
    case .avoid: "Avoid"
    }
  }
}

// MARK: - Toast / flash / burst

struct ShadeToast: View {
  let toast: ToastState

  private var label: String {
    switch toast.action {
    case .like: "Liked"
    case .star: "Starred"
    case .hide: "Hidden"
    case .avoid: "Avoiding similar"
    }
  }

  var body: some View {
    let color = Icon.color(for: toast.action)
    HStack(spacing: 9) {
      Image(systemName: Icon.feedback(toast.action))
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(color)
        .frame(width: 26, height: 26)
        .background(color.opacity(0.18), in: Circle())
      Text(label)
        .font(.archivo(13.5, .extrabold))
        .foregroundStyle(BC.white)
    }
    .padding(.leading, 11).padding(.trailing, 15).padding(.vertical, 9)
    .background(Color(hex: 0x0c0e12).opacity(0.9), in: Capsule())
    .overlay(Capsule().stroke(color.opacity(0.45), lineWidth: 1))
    .shadow(color: .black.opacity(0.6), radius: 15, y: 8)
    .frame(maxHeight: .infinity, alignment: .bottom)
    .padding(.bottom, 300)
    .transition(.scale(scale: 0.85).combined(with: .opacity))
  }
}

struct ShadeFlash: View {
  let toast: ToastState
  @State private var shown = false

  var body: some View {
    let color = Icon.color(for: toast.action)
    RadialGradient(colors: [color.opacity(0), color.opacity(0.3)], center: .center, startRadius: 60, endRadius: 360)
      .ignoresSafeArea()
      .opacity(shown ? 0 : 1)
      .allowsHitTesting(false)
      .onAppear { withAnimation(.easeOut(duration: 0.5)) { shown = true } }
  }
}

struct ShadeBurst: View {
  let action: FeedbackAction
  @State private var scale: CGFloat = 0.3
  @State private var opacity: Double = 0

  var body: some View {
    let color = Icon.color(for: action == .star ? .star : .like)
    Image(systemName: Icon.feedback(action == .star ? .star : .like))
      .font(.system(size: 110, weight: .bold))
      .foregroundStyle(color)
      .shadow(color: color.opacity(0.6), radius: 30)
      .scaleEffect(scale)
      .opacity(opacity)
      .frame(maxHeight: .infinity, alignment: .center)
      .offset(y: -40)
      .allowsHitTesting(false)
      .onAppear {
        opacity = 1
        withAnimation(.easeOut(duration: 0.6)) { scale = 1.7; opacity = 0 }
      }
  }
}
