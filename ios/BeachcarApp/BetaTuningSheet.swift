import SwiftUI

struct BetaTuningSheet: View {
  @ObservedObject var tuning: InteractionTuning
  @ObservedObject var telemetry: ProductTelemetry
  let coachState: InteractionCoachState
  let onNeedsFlush: () -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var draft: InteractionTuningProfile
  @State private var selectedReasons: Set<ExperienceFeedbackReason> = []
  @State private var comment = ""
  @State private var feedbackSaved = false
  @State private var advancedOpen = false

  init(
    tuning: InteractionTuning,
    telemetry: ProductTelemetry,
    coachState: InteractionCoachState,
    onNeedsFlush: @escaping () -> Void
  ) {
    self.tuning = tuning
    self.telemetry = telemetry
    self.coachState = coachState
    self.onNeedsFlush = onNeedsFlush
    _draft = State(initialValue: tuning.selectedProfile)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          introduction
          if tuning.isRemotelyForcedBalanced { remoteSafeguard }
          presetSection
          practiceSection
          advancedSection
          feedbackSection
          diagnosticsSection
          applySection
        }
        .padding(20)
      }
      .background(BC.panel)
      .navigationTitle("Tweaks")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
    .preferredColorScheme(.dark)
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
    .accessibilityIdentifier("shade-tweaks-sheet")
  }

  private var introduction: some View {
    VStack(alignment: .leading, spacing: 7) {
      Text("Make it feel like yours")
        .font(.archivo(27, .extrabold))
        .foregroundStyle(BC.white)
      Text("Calibrate the gestures here first. Nothing changes in your live review until you tap Apply.")
        .font(.archivo(14, .medium))
        .foregroundStyle(BC.sub)
        .lineSpacing(3)
    }
  }

  private var remoteSafeguard: some View {
    Label("Balanced is temporarily enforced for this beta build. Your preferences are still saved.", systemImage: "shield.lefthalf.filled")
      .font(.archivo(12.5, .semibold))
      .foregroundStyle(BC.star)
      .padding(13)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(BC.star.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(BC.star.opacity(0.25), lineWidth: 1))
  }

  private var presetSection: some View {
    tuningSection("FEEL") {
      HStack(spacing: 8) {
        ForEach([InteractionTuningPreset.quick, .balanced, .deliberate]) { preset in
          Button {
            withAnimation(.snappy(duration: 0.2)) { draft = .named(preset) }
          } label: {
            VStack(spacing: 5) {
              Image(systemName: presetSymbol(preset))
                .font(.system(size: 17, weight: .bold))
              Text(preset.title)
                .font(.archivo(12, .bold))
            }
            .foregroundStyle(draft.preset == preset ? BC.accentInk : BC.sub)
            .frame(maxWidth: .infinity, minHeight: 68)
            .background(draft.preset == preset ? BC.accent : BC.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(draft.preset == preset ? BC.accent : BC.border, lineWidth: 1))
          }
          .buttonStyle(.plain)
          .accessibilityLabel("\(preset.title), \(preset.detail)")
          .accessibilityAddTraits(draft.preset == preset ? .isSelected : [])
          .accessibilityIdentifier("shade-tuning-preset-\(preset.rawValue)")
        }
      }
      Text(draft.preset.detail)
        .font(.archivo(12.5, .medium))
        .foregroundStyle(BC.muted)
        .frame(maxWidth: .infinity, alignment: .center)
    }
  }

  private var practiceSection: some View {
    tuningSection("TRY IT") {
      TuningPracticeCard(profile: draft)
      Text("This card never records a judgment. It resets after every gesture.")
        .font(.archivo(11.5, .medium))
        .foregroundStyle(BC.muted)
    }
  }

  private var advancedSection: some View {
    DisclosureGroup(isExpanded: $advancedOpen) {
      VStack(spacing: 20) {
        tuningSlider(
          title: "Swipe commitment",
          value: primaryBinding,
          range: 0.28...0.38,
          format: { "\(Int($0 * 100))% of the screen" }
        )
        tuningSlider(
          title: "Strong commitment",
          value: strongBinding,
          range: 0.64...0.80,
          format: { "\(Int($0 * 100))% of the screen" }
        )
        tuningSlider(
          title: "Gallery dismissal",
          value: galleryBinding,
          range: 0.10...0.16,
          format: { "\(Int($0 * 100))% of the screen" }
        )

        VStack(alignment: .leading, spacing: 9) {
          Text("HAPTICS").font(.mono(9.5, bold: true)).tracking(1).foregroundStyle(BC.muted)
          Picker("Haptics", selection: hapticsBinding) {
            ForEach(InteractionHapticStyle.allCases) { style in Text(style.title).tag(style) }
          }
          .pickerStyle(.segmented)
          .accessibilityIdentifier("shade-tuning-haptics")
        }

        VStack(alignment: .leading, spacing: 8) {
          Text("COACHING").font(.mono(9.5, bold: true)).tracking(1).foregroundStyle(BC.muted)
          Picker("Coaching", selection: coachingBinding) {
            ForEach(InteractionCoachingMode.allCases) { mode in Text(mode.title).tag(mode) }
          }
          .pickerStyle(.menu)
          .tint(BC.accent)
          Text(draft.coaching.detail)
            .font(.archivo(11.5, .medium))
            .foregroundStyle(BC.muted)
        }
      }
      .padding(.top, 18)
    } label: {
      VStack(alignment: .leading, spacing: 4) {
        Text("Advanced")
          .font(.archivo(15, .bold))
          .foregroundStyle(BC.white)
        Text(draft.preset == .custom ? "Custom calibration" : "Fine-tune the \(draft.preset.title.lowercased()) preset")
          .font(.archivo(11.5, .medium))
          .foregroundStyle(BC.muted)
      }
    }
    .tint(BC.accent)
    .padding(16)
    .background(BC.card, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(BC.border, lineWidth: 1))
    .accessibilityIdentifier("shade-tuning-advanced")
  }

  private var feedbackSection: some View {
    tuningSection("HOW DOES IT FEEL?") {
      VStack(spacing: 8) {
        ForEach(ExperienceFeedbackReason.allCases) { reason in
          Button {
            if selectedReasons.contains(reason) { selectedReasons.remove(reason) }
            else { selectedReasons.insert(reason) }
            feedbackSaved = false
          } label: {
            HStack(spacing: 10) {
              Image(systemName: selectedReasons.contains(reason) ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(selectedReasons.contains(reason) ? BC.accent : BC.muted)
              Text(reason.title)
                .font(.archivo(13, .semibold))
                .foregroundStyle(BC.white)
              Spacer()
            }
            .frame(minHeight: 42)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }

      TextField("Optional product feedback", text: $comment, axis: .vertical)
        .font(.archivo(13, .medium))
        .lineLimit(2...5)
        .padding(12)
        .background(BC.faint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(BC.border, lineWidth: 1))
        .onChange(of: comment) { _, value in
          if value.count > 240 { comment = String(value.prefix(240)) }
          feedbackSaved = false
        }
        .accessibilityIdentifier("shade-tuning-feedback-comment")

      HStack {
        Text("Product feedback only—not auction taste.")
          .font(.archivo(10.5, .medium))
          .foregroundStyle(BC.muted)
        Spacer()
        Text("\(comment.count)/240")
          .font(.mono(9.5, bold: true))
          .foregroundStyle(BC.muted)
      }

      Button(action: saveFeedback) {
        Label(
          feedbackSaved ? "Feedback saved" : (telemetry.consent == .enabled ? "Send feedback" : "Save for diagnostic snapshot"),
          systemImage: feedbackSaved ? "checkmark" : (telemetry.consent == .enabled ? "paperplane.fill" : "tray.and.arrow.down.fill")
        )
          .font(.archivo(13.5, .bold))
          .foregroundStyle(BC.white)
          .frame(maxWidth: .infinity, minHeight: 46)
          .background(BC.faint, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
      }
      .buttonStyle(.plain)
      .disabled(selectedReasons.isEmpty && comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      .opacity(selectedReasons.isEmpty && comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.45 : 1)
      .accessibilityIdentifier("shade-tuning-submit-feedback")

      if telemetry.consent != .enabled {
        Text("Diagnostics are private, so this stays on your device unless you share a snapshot below.")
          .font(.archivo(10.5, .medium))
          .foregroundStyle(BC.muted)
      }
    }
  }

  private var diagnosticsSection: some View {
    tuningSection("BETA DIAGNOSTICS") {
      Toggle(isOn: diagnosticsBinding) {
        VStack(alignment: .leading, spacing: 3) {
          Text("Share beta diagnostics")
            .font(.archivo(14, .bold))
            .foregroundStyle(BC.white)
          Text("Completed outcomes and coarse timing buckets only")
            .font(.archivo(11.5, .medium))
            .foregroundStyle(BC.muted)
        }
      }
      .tint(BC.accent)
      .accessibilityIdentifier("shade-beta-diagnostics-toggle")

      Text("Never includes listing titles, URLs, photos, preference notes, exact coordinates, or touch paths. Raw beta events expire after 90 days.")
        .font(.archivo(11.5, .medium))
        .foregroundStyle(BC.muted)
        .lineSpacing(2)

      ShareLink(
        item: telemetry.diagnosticSnapshot(tuning: tuning, coach: coachState),
        subject: Text("Beachcar beta diagnostic snapshot")
      ) {
        Label("Share diagnostic snapshot", systemImage: "square.and.arrow.up")
          .font(.archivo(13.5, .bold))
          .foregroundStyle(BC.accent)
          .frame(maxWidth: .infinity, minHeight: 46)
          .background(BC.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
      }
      .accessibilityIdentifier("shade-share-diagnostic-snapshot")

      if telemetry.isUploading || !telemetry.queuedEvents.isEmpty {
        Text(telemetry.isUploading ? "Sending diagnostics…" : "\(telemetry.queuedEvents.count) diagnostic event\(telemetry.queuedEvents.count == 1 ? "" : "s") waiting to sync")
          .font(.archivo(10.5, .medium))
          .foregroundStyle(BC.muted)
      }
    }
  }

  private var applySection: some View {
    VStack(spacing: 10) {
      Button(action: applyChanges) {
        Text(draft == tuning.selectedProfile ? "Applied" : "Apply \(draft.preset.title) feel")
          .font(.archivo(15, .bold))
          .foregroundStyle(BC.accentInk)
          .frame(maxWidth: .infinity, minHeight: 50)
          .background(BC.accent, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
      }
      .buttonStyle(.plain)
      .disabled(draft == tuning.selectedProfile)
      .opacity(draft == tuning.selectedProfile ? 0.55 : 1)
      .accessibilityIdentifier("shade-tuning-apply")

      Button("Restore Balanced defaults") { draft = .balanced }
        .font(.archivo(12.5, .semibold))
        .foregroundStyle(BC.muted)
        .frame(minHeight: 42)
        .accessibilityIdentifier("shade-tuning-restore-defaults")
    }
  }

  private func tuningSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title).font(.mono(10, bold: true)).tracking(1.2).foregroundStyle(BC.muted)
      content()
    }
  }

  private func tuningSlider(
    title: String,
    value: Binding<Double>,
    range: ClosedRange<Double>,
    format: @escaping (Double) -> String
  ) -> some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack {
        Text(title).font(.archivo(13, .bold)).foregroundStyle(BC.white)
        Spacer()
        Text(format(value.wrappedValue)).font(.mono(9.5, bold: true)).foregroundStyle(BC.accent)
      }
      Slider(value: value, in: range, step: 0.01)
        .tint(BC.accent)
    }
  }

  private var primaryBinding: Binding<Double> { customBinding(\.primaryCommitFraction) }
  private var strongBinding: Binding<Double> { customBinding(\.strongCommitFraction) }
  private var galleryBinding: Binding<Double> { customBinding(\.galleryDismissFraction) }
  private var hapticsBinding: Binding<InteractionHapticStyle> { customBinding(\.haptics) }
  private var coachingBinding: Binding<InteractionCoachingMode> { customBinding(\.coaching) }

  private func customBinding<Value>(_ keyPath: WritableKeyPath<InteractionTuningProfile, Value>) -> Binding<Value> {
    Binding(
      get: { draft[keyPath: keyPath] },
      set: { value in
        draft[keyPath: keyPath] = value
        draft.preset = .custom
      }
    )
  }

  private var diagnosticsBinding: Binding<Bool> {
    Binding(
      get: { telemetry.consent == .enabled },
      set: { enabled in
        telemetry.setConsent(enabled ? .enabled : .disabled)
        onNeedsFlush()
      }
    )
  }

  private func applyChanges() {
    let previous = tuning.selectedProfile
    let next = draft.normalized()
    let changed = next.changedControls(comparedWith: previous)
    tuning.apply(next)
    draft = tuning.selectedProfile
    telemetry.record(
      .tuningChanged,
      properties: [
        "fromPreset": previous.preset.rawValue,
        "toPreset": next.preset.rawValue,
        "changedControls": changed.joined(separator: ","),
      ],
      tuning: next
    )
    onNeedsFlush()
  }

  private func saveFeedback() {
    telemetry.submitFeedback(reasons: selectedReasons, comment: comment, tuning: draft.normalized())
    selectedReasons.removeAll()
    comment = ""
    feedbackSaved = true
    onNeedsFlush()
  }

  private func presetSymbol(_ preset: InteractionTuningPreset) -> String {
    switch preset {
    case .quick: "hare.fill"
    case .balanced: "circle.lefthalf.filled"
    case .deliberate: "tortoise.fill"
    case .custom: "slider.horizontal.3"
    }
  }
}

struct BetaDiagnosticsDisclosure: View {
  let onShare: () -> Void
  let onKeepPrivate: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      ZStack {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .fill(BC.accent.opacity(0.12))
          .frame(width: 58, height: 58)
        Image(systemName: "waveform.path.ecg.rectangle")
          .font(.system(size: 25, weight: .bold))
          .foregroundStyle(BC.accent)
      }

      VStack(alignment: .leading, spacing: 8) {
        Text("Help tune the beta")
          .font(.archivo(29, .extrabold))
          .foregroundStyle(BC.white)
          .accessibilityIdentifier("shade-beta-diagnostics-disclosure")
        Text("Share sparse interaction outcomes so we can learn whether gestures feel effortless or frustrating on real devices.")
          .font(.archivo(14, .medium))
          .foregroundStyle(BC.sub)
          .lineSpacing(3)
      }

      VStack(alignment: .leading, spacing: 12) {
        disclosureRow("checkmark.circle.fill", "Completed or cancelled gestures")
        disclosureRow("clock.fill", "Coarse timing and retry buckets")
        disclosureRow("hand.raised.fill", "No titles, URLs, photos, auction notes, coordinates, or touch paths")
        disclosureRow("calendar.badge.clock", "Raw beta events expire after 90 days")
      }
      .padding(15)
      .background(BC.card, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(BC.border, lineWidth: 1))

      VStack(spacing: 10) {
        Button(action: onShare) {
          Text("Share beta diagnostics")
            .font(.archivo(15, .bold))
            .foregroundStyle(BC.accentInk)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(BC.accent, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("shade-beta-diagnostics-share")

        Button("Keep diagnostics private", action: onKeepPrivate)
          .font(.archivo(13, .semibold))
          .foregroundStyle(BC.sub)
          .frame(maxWidth: .infinity, minHeight: 44)
          .accessibilityIdentifier("shade-beta-diagnostics-private")
      }
    }
    .padding(22)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(BC.panel)
    .preferredColorScheme(.dark)
    .interactiveDismissDisabled()
    .presentationDetents([.large])
  }

  private func disclosureRow(_ symbol: String, _ text: String) -> some View {
    HStack(alignment: .top, spacing: 11) {
      Image(systemName: symbol)
        .foregroundStyle(BC.accent)
        .frame(width: 20)
      Text(text)
        .font(.archivo(12.5, .semibold))
        .foregroundStyle(BC.white)
      Spacer(minLength: 0)
    }
  }
}

private enum TuningPracticeMode: String, CaseIterable, Identifiable {
  case review = "Review"
  case gallery = "Photos"
  var id: String { rawValue }
}

private struct TuningPracticeCard: View {
  let profile: InteractionTuningProfile
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var mode: TuningPracticeMode = .review
  @State private var offset: CGSize = .zero
  @State private var crossedGate = false
  @State private var result = "Swipe the card"

  var body: some View {
    VStack(spacing: 12) {
      Picker("Practice", selection: $mode) {
        ForEach(TuningPracticeMode.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)

      GeometryReader { proxy in
        ZStack {
          RoundedRectangle(cornerRadius: 19, style: .continuous)
            .fill(mode == .review ? BC.accent.opacity(0.09) : Color.black)
          VStack(spacing: 8) {
            Image(systemName: practiceSymbol(width: proxy.size.width, height: proxy.size.height))
              .font(.system(size: 29, weight: .bold))
              .foregroundStyle(practiceColor(width: proxy.size.width, height: proxy.size.height))
            Text(result)
              .font(.archivo(13.5, .bold))
              .foregroundStyle(BC.white)
            Text(mode == .review ? "Left to pass · right to like · keep going for strong" : "Swipe decisively up or down")
              .font(.archivo(10.5, .medium))
              .foregroundStyle(BC.muted)
              .multilineTextAlignment(.center)
          }
          .padding(.horizontal, 18)
        }
        .offset(offset)
        .rotationEffect(.degrees(mode == .review ? Double(offset.width / max(proxy.size.width, 1)) * 2 : 0))
        .gesture(practiceGesture(size: proxy.size))
      }
      .frame(height: 154)
      .accessibilityIdentifier("shade-tuning-practice-card")
    }
    .onChange(of: mode) { _, _ in reset() }
  }

  private func practiceGesture(size: CGSize) -> some Gesture {
    DragGesture(minimumDistance: 8)
      .onChanged { value in
        if mode == .review {
          let primary = ReviewSwipeDecision.primaryDistance(for: size.width, profile: profile)
          offset.width = ReviewSwipeDecision.displayOffset(for: value.translation.width, primary: primary, profile: profile)
          let gate = abs(value.translation.width) >= primary
          if gate && !crossedGate { InteractionHaptics.fire(.primaryGate, style: profile.haptics) }
          crossedGate = gate
          result = reviewLabel(rawOffset: value.translation.width, width: size.width)
        } else {
          offset.height = GalleryDismissDecision.displayOffset(for: value.translation, height: size.height, profile: profile)
          let gate = GalleryDismissDecision.shouldDismiss(
            translation: value.translation,
            predictedEndTranslation: value.predictedEndTranslation,
            height: 844,
            profile: profile
          )
          if gate && !crossedGate { InteractionHaptics.fire(.galleryGate, style: profile.haptics) }
          crossedGate = gate
          result = gate ? "Would close" : "Keep going"
        }
      }
      .onEnded { value in
        if mode == .review {
          let action = ReviewSwipeDecision.action(
            translation: value.translation.width,
            predicted: value.predictedEndTranslation.width,
            velocity: value.velocity.width,
            width: size.width,
            profile: profile
          )
          result = action.map(actionLabel) ?? "No decision"
        } else {
          result = GalleryDismissDecision.shouldDismiss(
            translation: value.translation,
            predictedEndTranslation: value.predictedEndTranslation,
            height: 844,
            profile: profile
          ) ? "Would close" : "Would stay open"
        }
        crossedGate = false
        withAnimation(reduceMotion ? nil : .spring(response: 0.28, dampingFraction: 0.8)) { offset = .zero }
      }
  }

  private func reviewLabel(rawOffset: CGFloat, width: CGFloat) -> String {
    let distance = abs(rawOffset)
    if distance >= ReviewSwipeDecision.strongDistance(for: width, profile: profile) {
      return rawOffset < 0 ? "Never again" : "Love it"
    }
    if distance >= ReviewSwipeDecision.primaryDistance(for: width, profile: profile) {
      return rawOffset < 0 ? "Pass" : "Like"
    }
    return "Keep going"
  }

  private func actionLabel(_ action: FeedbackAction) -> String {
    switch action {
    case .hide: "Would pass"
    case .avoid: "Would choose Never again"
    case .like: "Would like"
    case .star: "Would love it"
    }
  }

  private func practiceSymbol(width: CGFloat, height: CGFloat) -> String {
    if mode == .gallery { return crossedGate ? "arrow.up.and.down.circle.fill" : "photo.fill" }
    if offset.width < 0 { return abs(offset.width) >= width * 0.5 ? Icon.avoid : Icon.hide }
    if offset.width > 0 { return abs(offset.width) >= width * 0.5 ? Icon.star : Icon.like }
    return "hand.draw.fill"
  }

  private func practiceColor(width: CGFloat, height: CGFloat) -> Color {
    if mode == .gallery { return crossedGate ? BC.accent : BC.sub }
    if offset.width < 0 { return Icon.color(for: abs(offset.width) >= width * 0.5 ? .avoid : .hide) }
    if offset.width > 0 { return Icon.color(for: abs(offset.width) >= width * 0.5 ? .star : .like) }
    return BC.accent
  }

  private func reset() {
    offset = .zero
    crossedGate = false
    result = mode == .review ? "Swipe the card" : "Swipe the photo"
  }
}
