import Foundation

// Display-facing derivations for the Shade UI, computed from the existing
// AuctionListing fields. Where the design relied on data we don't yet receive
// (a numeric value position, a parsed fair-low), we derive a reasonable stand-in
// from the bid/fair strings so the feed and meters render sensibly today. When
// the backend starts sending richer fields (see ShadeDossierData), these can use
// the real values directly.

extension AuctionListing {
  /// Accent "kind" pill text: Strong fit / Worth a look / Wildcard.
  var kindLabel: String {
    if isWildcard { return "Wildcard" }
    switch discoveryKind?.lowercased() {
    case "core": return "Strong fit"
    case "adjacent", "edge": return "Worth a look"
    default: break
    }
    let s = section.lowercased()
    if s.contains("strong") { return "Strong fit" }
    if s.contains("worth") { return "Worth a look" }
    if s.contains("curio") || s.contains("stretch") { return "Wildcard" }
    return "Worth a look"
  }

  /// Second pill: "Wildcard" (gold) when wildcard, else the lane name.
  var secondPillLabel: String {
    isWildcard ? "Wildcard" : lane.label
  }

  /// Compact time string ("1d 6h") used by chrome + chips.
  var shadeTime: String {
    compactTime(timeLeft ?? ends)
  }

  /// Whether the auction is ending soon (drives the red pulsing pill).
  var endsSoon: Bool {
    if let endsAt, let date = Self.shadeISODate(endsAt) {
      let interval = date.timeIntervalSince(Date())
      return interval > 0 && interval <= 48 * 60 * 60
    }
    let value = (timeLeft ?? ends ?? "").lowercased()
    if value.contains("day") {
      // "1 day, 6h" counts as soon; multi-day does not.
      return value.hasPrefix("1 day") || value.hasPrefix("1day")
    }
    return value.contains("hour") || value.contains("min")
      || value.range(of: #"\b\d+h\b"#, options: .regularExpression) != nil
  }

  /// Current bid parsed to an integer dollar amount, if possible.
  var bidNumber: Int? {
    Self.parseDollars(bid)
  }

  /// Parsed (low, high) fair-value hammer range from the `fair` string.
  var fairRange: (low: Int, high: Int)? {
    Self.parseRange(fair)
  }

  /// "+$4.2k under fair" upside chip, when the bid is below the fair-low.
  var upsideLabel: String? {
    guard let bid = bidNumber, let range = fairRange, range.low > bid else { return nil }
    let k = Double(range.low - bid) / 1000
    var text = String(format: "%.1f", k)
    if text.hasSuffix(".0") { text = String(text.dropLast(2)) }
    return "+$\(text)k under fair"
  }

  /// 0…1 position of the current bid on the CHEAP·FAIR·RICH meter.
  var valuePosition: Double {
    if let score = dossier?.valueScore { return min(0.95, max(0.05, score)) }
    if let bid = bidNumber, let range = fairRange, range.high > range.low {
      let p = Double(bid - range.low) / Double(range.high - range.low)
      return min(0.95, max(0.05, p))
    }
    return 0.3
  }

  var confidenceLabel: String {
    let c = (confidence ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return c.isEmpty ? "Medium" : c.capitalizedFirst
  }

  /// Watch-out bullets split from the comma-joined `concerns` string.
  var concernList: [String] {
    concerns
      .split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespaces).capitalizedFirst }
      .filter { !$0.isEmpty }
  }

  /// Short title for list rows ("1988 Suzuki Samurai Convertible" → "Suzuki Samurai").
  var shortTitle: String {
    var words = title.split(separator: " ").map(String.init)
    // Drop a leading 4-digit year.
    if let first = words.first, first.count == 4, Int(first) != nil { words.removeFirst() }
    return words.prefix(2).joined(separator: " ")
  }

  // MARK: parsing helpers

  static func parseDollars(_ value: String?) -> Int? {
    guard let value else { return nil }
    let digits = value.filter(\.isNumber)
    return digits.isEmpty ? nil : Int(digits)
  }

  /// Parses ranges like "$8k–$13k", "$10k-$18k fair hammer", "$3,000–$4,000".
  static func parseRange(_ value: String?) -> (low: Int, high: Int)? {
    guard let value else { return nil }
    let pattern = #"\$?\s*([\d,]+(?:\.\d+)?)\s*(k|K)?"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let ns = value as NSString
    let matches = regex.matches(in: value, range: NSRange(location: 0, length: ns.length))
    var nums: [Int] = []
    for m in matches where m.numberOfRanges >= 2 {
      let numStr = ns.substring(with: m.range(at: 1)).replacingOccurrences(of: ",", with: "")
      guard let base = Double(numStr) else { continue }
      let hasK = m.range(at: 2).location != NSNotFound
      nums.append(Int((hasK ? base * 1000 : base).rounded()))
      if nums.count == 2 { break }
    }
    guard nums.count == 2 else { return nil }
    return (low: min(nums[0], nums[1]), high: max(nums[0], nums[1]))
  }

  static func shadeISODate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
}

extension String {
  var capitalizedFirst: String {
    guard let first else { return self }
    return first.uppercased() + dropFirst()
  }
}
