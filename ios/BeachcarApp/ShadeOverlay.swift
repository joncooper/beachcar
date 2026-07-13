import SwiftUI

// Horizontal judgment underlay for the scrolling dossier. The first gate records
// a light preference; the resistant second gate records the stronger signal.

struct ShadeOverlay: View {
  @ObservedObject var controller: ShadeController
  let geo: FeedGeometry

  var body: some View {
    let action = controller.reviewAction
    let color = action.map(Icon.color(for:)) ?? BC.card
    ZStack {
      color.opacity(action == nil ? 0.12 : 0.28)
      if let action {
        HStack {
          if controller.reviewOffset > 0 { actionMark(action); Spacer() }
          else { Spacer(); actionMark(action) }
        }
        .padding(.horizontal, 8)
      } else if controller.showHint {
        HStack {
          edgeCue(.hide)
          Spacer()
          edgeCue(.like)
        }
        .padding(.horizontal, 8)
        .offset(y: -170)
      }
    }
    .frame(width: geo.width)
    .allowsHitTesting(false)
    .zIndex(controller.showHint ? 1 : 0)
  }

  private func actionMark(_ action: FeedbackAction) -> some View {
    VStack(spacing: 9) {
      Image(systemName: Icon.feedback(action))
        .font(.system(size: 31, weight: .black))
      Text(label(action).uppercased())
        .font(.archivo(16, .black))
        .tracking(0.9)
      if let prompt = ReviewCoachPolicy.prompt(
        for: action,
        reviewStage: controller.reviewStage,
        coachStage: controller.coachStage
      ) {
        Text(prompt.uppercased())
          .font(.mono(8.5, bold: true))
          .multilineTextAlignment(.center)
          .foregroundStyle(BC.white.opacity(0.72))
      }
    }
    .foregroundStyle(Icon.color(for: action))
    .frame(width: 112)
  }

  private func edgeCue(_ action: FeedbackAction) -> some View {
    HStack(spacing: 3) {
      if action == .hide { Image(systemName: "chevron.left") }
      Text(action == .hide ? "PASS" : "LIKE")
      if action == .like { Image(systemName: "chevron.right") }
    }
    .font(.mono(9, bold: true))
    .foregroundStyle(Icon.color(for: action).opacity(controller.coachStage == .mastered ? 0.52 : 0.72))
    .padding(.horizontal, 6)
    .frame(minWidth: 54, minHeight: 34)
    .background(Color.black.opacity(0.38), in: Capsule())
    .overlay(Capsule().stroke(Icon.color(for: action).opacity(0.22), lineWidth: 1))
    .accessibilityElement(children: .combine)
    .accessibilityLabel(action == .hide ? "Swipe left to pass" : "Swipe right to like")
    .accessibilityIdentifier(action == .hide ? "shade-swipe-pass-cue" : "shade-swipe-like-cue")
  }

  private func label(_ action: FeedbackAction) -> String {
    switch action {
    case .like: "Like"
    case .star: "Love it"
    case .hide: "Pass"
    case .avoid: "Never again"
    }
  }
}

// MARK: - Toast / flash / burst

struct ShadeToast: View {
  let toast: ToastState

  private var label: String {
    switch toast.action {
    case .like: "Liked"
    case .star: "Loved"
    case .hide: "Passed"
    case .avoid: "Never again"
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
