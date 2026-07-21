import SwiftUI

struct CompetitionCodexHandoffView: View {
  let email: String
  let onContinue: () -> Void

  var body: some View {
    ScrollView {
      VStack(spacing: 18) {
        VStack(alignment: .leading, spacing: 16) {
          Image("BeachcarSurrey")
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .padding(.horizontal, 8)
            .background(BC.brandPink.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .accessibilityHidden(true)

          Label("SEARCH SAVED", systemImage: "checkmark.seal.fill")
            .font(.mono(11, bold: true))
            .foregroundStyle(BC.accent)

          Text("Finish your Codex setup on a desktop.")
            .font(.archivo(32, .black))
            .foregroundStyle(BC.white)

          Text("On your Mac, open Beachcar and sign in as \(email). Beachcar will help you install its skill, add a reduced-scope token, and start the first local run.")
            .font(.archivo(15, .medium))
            .foregroundStyle(BC.sub)
            .lineSpacing(3)

          VStack(alignment: .leading, spacing: 10) {
            handoffStep("1", "Send yourself the desktop link")
            handoffStep("2", "Sign in with this same email")
            handoffStep("3", "Open Preferences → Local Codex and follow the coach")
          }

          Text("Marketplace passwords stay in your browser. AI runs in your Codex, not on Beachcar's bill.")
            .font(.archivo(13, .semibold))
            .foregroundStyle(BC.white.opacity(0.86))
        }
        .padding(22)
        .background(BC.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(BC.border, lineWidth: 1))

        ShareLink(item: AppConfig.auctionBaseURL) {
          Label("Send myself the desktop link", systemImage: "square.and.arrow.up")
            .font(.archivo(16, .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(BC.accent, in: Capsule())
            .foregroundStyle(BC.accentInk)
        }
        .accessibilityIdentifier("desktop-codex-handoff-share")

        Button("I'll finish on desktop later", action: onContinue)
          .accessibilityIdentifier("desktop-codex-handoff-continue")
          .font(.archivo(15, .bold))
          .foregroundStyle(BC.sub)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
          .background(BC.faint, in: Capsule())
      }
      .padding(20)
    }
    .scrollIndicators(.hidden)
    .accessibilityIdentifier("desktop-codex-handoff")
  }

  private func handoffStep(_ number: String, _ label: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text(number)
        .font(.mono(10, bold: true))
        .foregroundStyle(BC.brandPink)
      Text(label)
        .font(.archivo(13.5, .bold))
        .foregroundStyle(BC.white.opacity(0.9))
    }
  }
}
