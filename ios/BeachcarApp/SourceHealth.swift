import SwiftUI

struct SourceHealthState: Equatable {
  enum Tone {
    case ok
    case pending
    case blocked
    case fallback
    case unknown
  }

  let label: String
  let detail: String
  let tone: Tone
}

extension RunSourceSummary {
  func health(for listing: AuctionListing) -> SourceHealthState {
    let key = SourceHealthState.sourceKey(for: listing.site)
    let matchingRunners = runnerTasks.filter { SourceHealthState.sourceKey(for: $0.source) == key }

    // A browser runner is the recovery path for a blocked Worker fetch. Once its
    // result completed (and especially once it merged), that newer evidence wins
    // over the earlier blocked source check.
    if let runner = matchingRunners.first(where: \.isSuccessful) {
      return SourceHealthState(
        label: SourceHealthState.displayName(for: key, fallback: listing.site),
        detail: runner.successDetail,
        tone: .ok
      )
    }

    if let blocked = blockedSources.first(where: { SourceHealthState.matches($0, key: key, site: listing.site) }) {
      return SourceHealthState(label: blocked.site, detail: blocked.message ?? "Blocked", tone: .blocked)
    }

    if let runner = matchingRunners.first {
      let failed = runner.normalizedStatus == "failed" || runner.normalizedStatus == "error"
      return SourceHealthState(
        label: SourceHealthState.displayName(for: key, fallback: listing.site),
        detail: failed ? "Runner failed" : "Runner \(runner.status.lowercased())",
        tone: failed ? .blocked : .pending
      )
    }

    if let check = checkedSources.first(where: { SourceHealthState.matches($0, key: key, site: listing.site) && $0.status == "ok" }) {
      let detail = check.candidateCount > 0 ? "\(check.candidateCount) found" : "Checked"
      return SourceHealthState(label: check.site, detail: detail, tone: .ok)
    }

    if let check = checkedSources.first(where: {
      SourceHealthState.matches($0, key: key, site: listing.site)
        && ($0.status == "fallback" || $0.status == "cached")
    }) {
      let count = check.cache?.usableCount ?? check.candidateCount
      let detail = count > 0 ? "\(count) cached" : "Cache fallback"
      return SourceHealthState(label: check.site, detail: detail, tone: .fallback)
    }

    if fallbackUsed == true {
      return SourceHealthState(label: listing.site, detail: "Fallback", tone: .fallback)
    }

    return SourceHealthState(label: listing.site, detail: "Source", tone: .unknown)
  }
}

private extension RunRunnerTaskSummary {
  var normalizedStatus: String {
    status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  var normalizedMergeStatus: String? {
    mergeStatus?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }

  var isSuccessful: Bool {
    if normalizedMergeStatus == "merged" { return true }
    guard ["completed", "complete", "succeeded", "success"].contains(normalizedStatus) else { return false }
    return normalizedMergeStatus != "pending_run"
  }

  var successDetail: String {
    if normalizedMergeStatus == "merged", let importedCount, importedCount > 0 {
      return "\(importedCount) imported"
    }
    if normalizedMergeStatus == "merged" { return "Runner merged" }
    if normalizedMergeStatus == "empty" || normalizedCandidateCount == 0 { return "Runner checked" }
    return "Runner completed"
  }
}

extension SourceHealthState {
  static func sourceKey(for value: String) -> String {
    let normalized = value.lowercased().replacingOccurrences(of: "&", with: "and")
    if normalized.contains("bring") || normalized.contains("bat") { return "bringatrailer" }
    if normalized.contains("cars") && normalized.contains("bids") { return "carsandbids" }
    if normalized.contains("hemmings") { return "hemmings" }
    if normalized.contains("marketplace") { return "marketplace" }
    return normalized.filter(\.isLetter)
  }

  static func displayName(for key: String, fallback: String) -> String {
    switch key {
    case "bringatrailer": return "Bring a Trailer"
    case "carsandbids": return "Cars & Bids"
    case "hemmings": return "Hemmings"
    case "marketplace": return "Marketplace"
    default: return fallback
    }
  }

  static func matches(_ check: RunSourceCheck, key: String, site: String) -> Bool {
    sourceKey(for: check.source) == key || sourceKey(for: check.site) == key || check.site.localizedCaseInsensitiveContains(site)
  }
}

struct SourceHealthBadge: View {
  let state: SourceHealthState
  var compact = false

  private var color: Color {
    switch state.tone {
    case .ok: BC.accent
    case .pending: BC.star
    case .blocked: BC.danger
    case .fallback: BC.muted
    case .unknown: BC.sub
    }
  }

  private var icon: String {
    switch state.tone {
    case .ok: "checkmark.circle.fill"
    case .pending: "arrow.triangle.2.circlepath"
    case .blocked: "exclamationmark.triangle.fill"
    case .fallback: "arrow.uturn.backward.circle.fill"
    case .unknown: "questionmark.circle.fill"
    }
  }

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: icon)
        .font(.system(size: compact ? 9 : 10, weight: .bold))
      Text(compact ? state.label : "\(state.label) · \(state.detail)")
        .font(.mono(compact ? 9.5 : 10.5, bold: true))
        .lineLimit(1)
    }
    .foregroundStyle(color)
    .padding(.horizontal, compact ? 7 : 9)
    .padding(.vertical, compact ? 3 : 4)
    .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(color.opacity(0.35), lineWidth: 1))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(state.label), \(state.detail)")
    .accessibilityIdentifier("source-health-badge-\(SourceHealthState.sourceKey(for: state.label))")
  }
}
