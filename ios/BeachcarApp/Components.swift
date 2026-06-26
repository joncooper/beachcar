import SwiftUI

// Mapped onto the dark Shade tokens (see ShadeTheme.BC) so the screens outside the
// Shade redesign — sign-in, invite gate, onboarding — render in the same dark
// language. Semantic names are preserved so existing call sites keep working.
enum BeachcarColors {
  static let shell = BC.bg
  static let ink = BC.ink
  static let secondary = BC.sub
  static let muted = BC.muted
  static let mint = BC.accent
  static let teal = BC.accent
  static let sand = BC.star
  static let gold = BC.star
  static let stop = BC.danger
  static let hairline = BC.border
}

enum ChipStyle {
  case accent
  case mint
  case sand
  case neutral
}

func compactTime(_ value: String?) -> String {
  guard let value, !value.isEmpty else { return "check" }
  return value
    .replacingOccurrences(of: #"(?i)\bdays?\b"#, with: "d", options: .regularExpression)
    .replacingOccurrences(of: #"(?i)\bhours?\b"#, with: "h", options: .regularExpression)
    .replacingOccurrences(of: #"(?i)\bminutes?\b"#, with: "m", options: .regularExpression)
    .replacingOccurrences(of: ",", with: "")
    .replacingOccurrences(of: "  ", with: " ")
}

struct PhotoCarousel: View {
  let listing: AuctionListing
  let api: AuctionAPI
  @Binding var selectedImage: Int
  var showsPhotoBadge = true
  var showsThumbnails = true
  var emptyStyle: PhotoEmptyStyle = .standard

  var body: some View {
    ZStack(alignment: .topTrailing) {
      if listing.images.isEmpty {
        PhotoPlaceholder(style: emptyStyle)
      } else {
        TabView(selection: $selectedImage) {
          ForEach(Array(listing.images.enumerated()), id: \.offset) { index, image in
            CachedRemoteImage(url: api.resolvedImageURL(image, variant: .deck)) { image in
              image
                .resizable()
                .scaledToFill()
            } placeholder: {
                ZStack {
                  Rectangle().fill(.white.opacity(0.68))
                  ProgressView()
                }
            } failure: {
                ZStack {
                  Rectangle().fill(.white.opacity(0.72))
                  Image(systemName: "photo.badge.exclamationmark")
                    .font(.title2)
                    .foregroundStyle(BeachcarColors.muted)
                }
            }
            .id("\(listing.key)-photo-\(index)-\(image)")
            .tag(index)
          }
        }
        .id("\(listing.key)-carousel")
        .tabViewStyle(.page(indexDisplayMode: .never))
      }

      if showsPhotoBadge && !listing.images.isEmpty {
        HStack(spacing: 8) {
          Text("Photo \(selectedImage + 1)/\(listing.images.count)")
            .font(.caption.weight(.black))
          HStack(spacing: 4) {
            ForEach(0..<min(listing.images.count, 5), id: \.self) { index in
              Circle()
                .fill(index == selectedImage ? .white : .white.opacity(0.35))
                .frame(width: 5, height: 5)
            }
          }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(.black.opacity(0.48), in: Capsule())
        .foregroundStyle(.white)
        .padding(10)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay(alignment: .bottomLeading) {
      if showsThumbnails && listing.images.count > 1 {
        HStack(spacing: 7) {
          ForEach(Array(listing.images.prefix(5).enumerated()), id: \.element) { index, image in
            CachedRemoteImage(url: api.resolvedImageURL(image, variant: .thumb)) { image in
              image.resizable().scaledToFill()
            } placeholder: {
              Rectangle().fill(.white.opacity(0.75))
            } failure: {
              Rectangle().fill(.white.opacity(0.75))
            }
            .frame(width: 48, height: 36)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
              RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(index == selectedImage ? BeachcarColors.teal : .white.opacity(0.55), lineWidth: index == selectedImage ? 2 : 1)
            }
            .onTapGesture {
              selectedImage = index
            }
          }
        }
        .padding(10)
      }
    }
    .shadow(color: .black.opacity(0.08), radius: 14, y: 8)
    .onChange(of: listing.key) { _, _ in
      selectedImage = 0
    }
    .onChange(of: listing.images.count) { _, count in
      if count == 0 {
        selectedImage = 0
      } else if selectedImage >= count {
        selectedImage = count - 1
      }
    }
  }
}

enum PhotoEmptyStyle {
  case standard
  case compact
}

private struct PhotoPlaceholder: View {
  let style: PhotoEmptyStyle

  var body: some View {
    RoundedRectangle(cornerRadius: 26, style: .continuous)
      .fill(.white.opacity(0.72))
      .overlay {
        VStack(spacing: style == .compact ? 5 : 8) {
          Image(systemName: "photo")
            .font(.system(size: style == .compact ? 22 : 32, weight: .semibold))
          Text("No image yet")
            .font((style == .compact ? Font.caption2 : Font.footnote).weight(.bold))
        }
        .foregroundStyle(BeachcarColors.muted)
      }
      .overlay(alignment: .bottomLeading) {
        if style == .standard {
          Label("Using listing details while images cache", systemImage: "arrow.down.right.and.arrow.up.left")
            .font(.caption2.weight(.bold))
            .foregroundStyle(BeachcarColors.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.white.opacity(0.62), in: Capsule())
            .padding(10)
        }
      }
  }
}

struct Chip: View {
  let text: String
  var style: ChipStyle = .neutral

  var body: some View {
    Text(text)
      .font(.caption2.weight(.black))
      .lineLimit(1)
      .padding(.horizontal, 9)
      .padding(.vertical, 6)
      .background(background, in: Capsule())
      .foregroundStyle(foreground)
  }

  private var background: Color {
    switch style {
    case .accent: BeachcarColors.teal.opacity(0.13)
    case .mint: BeachcarColors.mint.opacity(0.22)
    case .sand: BeachcarColors.sand.opacity(0.42)
    case .neutral: .white.opacity(0.74)
    }
  }

  private var foreground: Color {
    switch style {
    case .accent, .mint: BeachcarColors.teal
    case .sand: BeachcarColors.ink
    case .neutral: BeachcarColors.ink
    }
  }
}

func compactMarketCopy(_ value: String?) -> String {
  guard let value, !value.isEmpty else { return "Check" }
  return value
    .replacingOccurrences(of: #"(?i)\s*/\s*about.*$"#, with: "", options: .regularExpression)
    .replacingOccurrences(of: #"(?i)\s+hammer\b"#, with: "", options: .regularExpression)
    .replacingOccurrences(of: #"(?i)\s+fair\b"#, with: " fair", options: .regularExpression)
    .replacingOccurrences(of: "Stop around ", with: "Stop ")
}

struct MetricTile: View {
  enum Tone {
    case normal
    case stop
  }

  let label: String
  let value: String
  var tone: Tone = .normal

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(label)
        .font(.caption2.weight(.bold))
        .textCase(.uppercase)
        .foregroundStyle(BeachcarColors.muted)
      Text(value)
        .font(.footnote.weight(.black))
        .foregroundStyle(tone == .stop ? BeachcarColors.stop : BeachcarColors.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.68)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 10)
  }
}

struct StatPill: View {
  let systemImage: String
  let text: String

  var body: some View {
    Label(text, systemImage: systemImage)
      .font(.caption2.weight(.bold))
      .lineLimit(1)
      .minimumScaleFactor(0.72)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 8)
      .background(.white.opacity(0.58))
      .foregroundStyle(BeachcarColors.secondary)
  }
}

struct SwipeActionBackdrop: View {
  let offset: CGFloat
  let strongHoldStartedAt: Date?
  let commitDistance: CGFloat
  let strongDistance: CGFloat

  var body: some View {
    TimelineView(.animation) { context in
      let action = state(now: context.date)
      ZStack(alignment: offset >= 0 ? .leading : .trailing) {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .fill(action.color.opacity(action.isStrong ? 0.18 : 0.11))
        HStack {
          if offset < 0 { Spacer() }
          VStack(alignment: offset >= 0 ? .leading : .trailing, spacing: 7) {
            Label(action.title, systemImage: action.symbol)
              .font(.system(size: 18, weight: .black, design: .rounded))
            Text(action.subtitle)
              .font(.caption2.weight(.bold))
              .foregroundStyle(action.color.opacity(0.76))
            progressTrack(progress: action.progress, color: action.color)
              .frame(width: 112)
          }
          .foregroundStyle(action.color)
          .padding(.horizontal, 16)
          if offset >= 0 { Spacer() }
        }
      }
      .overlay {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .stroke(action.color.opacity(action.isStrong ? 0.38 : 0.16), lineWidth: action.isStrong ? 2 : 1)
      }
    }
  }

  private func progressTrack(progress: CGFloat, color: Color) -> some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(color.opacity(0.13))
        Capsule()
          .fill(color.opacity(0.82))
          .frame(width: max(7, proxy.size.width * progress))
      }
    }
    .frame(height: 5)
  }

  private func state(now: Date) -> SwipeSignalState {
    let distance = abs(offset)
    let isRight = offset >= 0
    let holdProgress = SwipeDecision.strongHoldProgress(startedAt: strongHoldStartedAt, now: now)
    let commitProgress = min(1, distance / commitDistance)
    let strongProgress = min(1, max(0, (distance - commitDistance) / (strongDistance - commitDistance)))

    if distance >= strongDistance {
      if holdProgress >= 1 {
        return SwipeSignalState(
          title: isRight ? "Star" : "Avoid",
          subtitle: isRight ? "release to favorite" : "release to block similar",
          symbol: isRight ? "star.fill" : "nosign",
          color: isRight ? BeachcarColors.teal : BeachcarColors.stop,
          progress: 1,
          isStrong: true
        )
      }
      return SwipeSignalState(
        title: isRight ? "Hold for star" : "Hold to avoid",
        subtitle: isRight ? "let go now = like" : "let go now = hide",
        symbol: isRight ? "star" : "hand.raised",
        color: isRight ? BeachcarColors.teal : BeachcarColors.stop,
        progress: max(strongProgress, holdProgress),
        isStrong: true
      )
    }

    return SwipeSignalState(
      title: isRight ? "Like" : "Hide",
      subtitle: distance >= commitDistance ? "release to mark" : "keep swiping",
      symbol: isRight ? "heart.fill" : "xmark",
      color: isRight ? BeachcarColors.teal : BeachcarColors.stop,
      progress: commitProgress,
      isStrong: false
    )
  }
}

struct SwipeSignal: View {
  let offset: CGFloat
  let strongHoldStartedAt: Date?
  let commitDistance: CGFloat
  let strongDistance: CGFloat

  var body: some View {
    if abs(offset) > 34 {
      TimelineView(.animation) { context in
        let action = signal(now: context.date)
        VStack(alignment: offset >= 0 ? .trailing : .leading, spacing: 7) {
          Label(action.title, systemImage: action.symbol)
            .font(.system(size: 19, weight: .black, design: .rounded))
            .textCase(.uppercase)
          Text(action.subtitle)
            .font(.caption2.weight(.black))
            .foregroundStyle(action.color.opacity(0.72))
          progressTrack(progress: action.progress, color: action.color)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(width: 154, alignment: offset >= 0 ? .trailing : .leading)
        .background(.white.opacity(0.88), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 18, style: .continuous)
            .stroke(action.color.opacity(action.isStrong ? 0.65 : 0.28), lineWidth: action.isStrong ? 2 : 1)
        }
        .foregroundStyle(action.color)
        .shadow(color: action.color.opacity(0.18), radius: 14, y: 8)
        .rotationEffect(.degrees(offset >= 0 ? -7 : 7))
      }
    }
  }

  private func progressTrack(progress: CGFloat, color: Color) -> some View {
    GeometryReader { proxy in
      ZStack(alignment: offset >= 0 ? .leading : .trailing) {
        Capsule().fill(color.opacity(0.13))
        Capsule()
          .fill(color.opacity(0.84))
          .frame(width: max(8, proxy.size.width * progress))
      }
    }
    .frame(height: 5)
  }

  private func signal(now: Date) -> SwipeSignalState {
    let distance = abs(offset)
    let isRight = offset >= 0
    let commitProgress = min(1, distance / commitDistance)
    let strongProgress = min(1, max(0, (distance - commitDistance) / (strongDistance - commitDistance)))
    let holdProgress = SwipeDecision.strongHoldProgress(startedAt: strongHoldStartedAt, now: now)

    if distance >= strongDistance {
      if holdProgress >= 1 {
        return SwipeSignalState(
          title: isRight ? "Star" : "Avoid",
          subtitle: isRight ? "release to save favorite" : "release to block similar",
          symbol: isRight ? "star.fill" : "nosign",
          color: isRight ? BeachcarColors.teal : BeachcarColors.stop,
          progress: 1,
          isStrong: true
        )
      }
      return SwipeSignalState(
        title: isRight ? "Hold for star" : "Hold to avoid",
        subtitle: "release now = \(isRight ? "like" : "hide")",
        symbol: isRight ? "star" : "hand.raised",
        color: isRight ? BeachcarColors.teal : BeachcarColors.stop,
        progress: max(strongProgress, holdProgress),
        isStrong: true
      )
    }

    return SwipeSignalState(
      title: isRight ? "Like" : "Hide",
      subtitle: distance >= commitDistance ? "release to mark" : "keep swiping",
      symbol: isRight ? "heart.fill" : "xmark",
      color: isRight ? BeachcarColors.teal : BeachcarColors.stop,
      progress: commitProgress,
      isStrong: false
    )
  }
}

private struct SwipeSignalState {
  let title: String
  let subtitle: String
  let symbol: String
  let color: Color
  let progress: CGFloat
  let isStrong: Bool
}

struct Panel<Content: View>: View {
  let title: String
  let systemImage: String
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(title, systemImage: systemImage)
        .font(.caption2.weight(.black))
        .textCase(.uppercase)
        .tracking(0.7)
        .foregroundStyle(BeachcarColors.muted)
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(.white.opacity(0.74), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(BeachcarColors.hairline, lineWidth: 1)
    }
  }
}

struct MarketMeter: View {
  let confidence: String

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack {
        Text("Cheap")
        Spacer()
        Text("Fair")
        Spacer()
        Text("Rich")
      }
      .font(.caption2.weight(.bold))
      .foregroundStyle(BeachcarColors.muted)
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule().fill(BeachcarColors.sand.opacity(0.45))
          Capsule()
            .fill(LinearGradient(colors: [BeachcarColors.mint, BeachcarColors.sand, BeachcarColors.stop.opacity(0.65)], startPoint: .leading, endPoint: .trailing))
            .frame(width: proxy.size.width)
          Circle()
            .fill(.white)
            .frame(width: 18, height: 18)
            .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
            .offset(x: proxy.size.width * 0.32)
        }
      }
      .frame(height: 12)
      Text("Confidence: \(confidence)")
        .font(.caption.weight(.semibold))
        .foregroundStyle(BeachcarColors.secondary)
    }
  }
}

struct DetailBadge: View {
  let systemImage: String
  let title: String
  let value: String

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Label(title, systemImage: systemImage)
        .font(.caption2.weight(.black))
        .foregroundStyle(BeachcarColors.muted)
      Text(value)
        .font(.caption.weight(.bold))
        .foregroundStyle(BeachcarColors.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.74)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(9)
    .background(BeachcarColors.shell.opacity(0.8), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
  }
}

enum RailRole {
  case normal
  case destructive
  case positive
}

struct RailButton: View {
  let systemImage: String
  let title: String
  let selected: Bool
  var role: RailRole = .normal
  let action: () async -> Void

  var body: some View {
    Button {
      Task { await action() }
    } label: {
      VStack(spacing: 3) {
        Image(systemName: systemImage)
          .font(.system(size: 17, weight: .bold))
        Text(title)
          .font(.caption2.weight(.black))
      }
      .frame(maxWidth: .infinity, minHeight: 48)
      .background(background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .foregroundStyle(foreground)
    }
  }

  private var background: Color {
    if selected {
      switch role {
      case .destructive: return BeachcarColors.stop.opacity(0.17)
      case .positive: return BeachcarColors.mint.opacity(0.34)
      case .normal: return BeachcarColors.teal.opacity(0.13)
      }
    }
    return .white.opacity(0.72)
  }

  private var foreground: Color {
    switch role {
    case .destructive: BeachcarColors.stop
    case .positive: BeachcarColors.teal
    case .normal: BeachcarColors.ink
    }
  }
}

struct VoiceFeedbackComposer: View {
  @Binding var text: String
  let onSubmit: () async -> PreferenceNoteResult
  @StateObject private var recorder = SpeechFeedbackRecorder()
  @State private var sendState: VoiceSendState = .idle
  @State private var isSubmitting = false

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        Button {
          Task {
            await recorder.toggle()
            if !recorder.transcript.isEmpty {
              text = recorder.transcript
            }
            sendState = .idle
          }
        } label: {
          Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
            .font(.system(size: 18, weight: .black))
            .frame(width: 44, height: 44)
            .background(recorder.isRecording ? BeachcarColors.stop : BeachcarColors.teal, in: Circle())
            .foregroundStyle(.white)
        }
        TextField("Tell Beachcar: more like this, less rust, closer to CT...", text: $text, axis: .vertical)
          .font(.callout)
          .lineLimit(1...4)
          .padding(.horizontal, 10)
          .padding(.vertical, 11)
          .background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        Button {
          Task { await submit() }
        } label: {
          Image(systemName: isSubmitting ? "hourglass" : "paperplane.fill")
            .font(.system(size: 17, weight: .bold))
            .frame(width: 42, height: 42)
            .background(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? BeachcarColors.hairline : BeachcarColors.ink, in: Circle())
            .foregroundStyle(.white)
        }
        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
      }
      if recorder.isRecording || recorder.errorMessage != nil || sendState != .idle {
        HStack(spacing: 8) {
          if recorder.isRecording {
            Image(systemName: "waveform")
              .symbolEffect(.variableColor.iterative)
            Text("Listening...")
          } else if let error = recorder.errorMessage {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(error)
          } else {
            Image(systemName: sendState.systemImage)
            Text(sendState.message)
          }
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(statusColor)
      }
    }
    .padding(12)
    .background(BeachcarColors.teal.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .onChange(of: recorder.transcript) { _, transcript in
      if !transcript.isEmpty {
        text = transcript
        sendState = .idle
      }
    }
  }

  private var statusColor: Color {
    if recorder.errorMessage != nil {
      return BeachcarColors.stop
    }
    switch sendState {
    case .idle, .saved:
      return BeachcarColors.teal
    case .queued:
      return BeachcarColors.secondary
    }
  }

  private func submit() async {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    isSubmitting = true
    let result = await onSubmit()
    text = ""
    recorder.transcript = ""
    isSubmitting = false
    withAnimation(.snappy(duration: 0.18)) {
      sendState = result == .saved ? .saved : .queued
    }
  }
}

private enum VoiceSendState: Equatable {
  case idle
  case saved
  case queued

  var message: String {
    switch self {
    case .idle: ""
    case .saved: "Saved for the next run"
    case .queued: "Queued locally; will retry"
    }
  }

  var systemImage: String {
    switch self {
    case .idle: "circle"
    case .saved: "checkmark.circle.fill"
    case .queued: "arrow.clockwise.circle.fill"
    }
  }
}

struct UndoBar: View {
  let label: String
  let undoLabel: String
  let undo: () -> Void

  var body: some View {
    HStack {
      Text(label)
        .font(.subheadline.weight(.bold))
      Spacer()
      Button(undoLabel, action: undo)
        .font(.subheadline.weight(.black))
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(.black.opacity(0.86), in: Capsule())
    .foregroundStyle(.white)
  }
}
