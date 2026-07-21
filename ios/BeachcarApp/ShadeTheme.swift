import SwiftUI

enum AppEnv {
  /// True when launched by the UI test harness. Used to suppress perpetual
  /// (`repeatForever`) animations that would otherwise keep XCUITest from ever
  /// detecting an idle state and hang every query.
  static let isUITesting = ProcessInfo.processInfo.arguments.contains("--ui-testing")
}

// MARK: - Color from hex

extension Color {
  init(hex: UInt32, alpha: Double = 1) {
    let r = Double((hex >> 16) & 0xff) / 255
    let g = Double((hex >> 8) & 0xff) / 255
    let b = Double(hex & 0xff) / 255
    self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
  }
}

// MARK: - Accent system (Seafoam / Azure / Lavender)

struct ShadeAccent: Equatable {
  let id: String
  let accent: Color
  let accentInk: Color

  static let seafoam = ShadeAccent(id: "Seafoam", accent: Color(hex: 0x9bcbb2), accentInk: Color(hex: 0x0b2018))
  static let azure = ShadeAccent(id: "Azure", accent: Color(hex: 0x5aa9f0), accentInk: Color(hex: 0x04121f))
  static let lavender = ShadeAccent(id: "Lavender", accent: Color(hex: 0xb18cf0), accentInk: Color(hex: 0x160a26))
  static let all: [ShadeAccent] = [.seafoam, .azure, .lavender]
}

// MARK: - Dark token palette
//
// Mirrors the "Beachcar Shade" design tokens. `accent`/`accentInk` are the only
// switchable values (default Seafoam); everything else is fixed. Kept as a small
// namespace so call sites stay terse (`BC.ink`, `BC.card`, ...). An accent picker
// can later flip `BC.activeAccent`.

enum BC {
  // Active accent (Seafoam for v1). A future accent picker can move this into the
  // environment; kept a constant here to stay clear of mutable global state.
  static let activeAccent: ShadeAccent = .seafoam

  static var accent: Color { activeAccent.accent }
  static var accentInk: Color { activeAccent.accentInk }

  // Surfaces
  static let bg = Color(hex: 0x07080a)        // base background
  static let card = Color(hex: 0x16181d)      // section card surface
  static let panel = Color(hex: 0x0c0d10)     // deeper panel (dossier/list backing)
  static let imageBg = Color(hex: 0x0a0b0d)   // behind images
  static let listRow = Color(hex: 0x15171c)   // list row surface

  // Ink
  static let ink = Color(hex: 0xf3f1ec)       // primary text
  static let white = Color(hex: 0xffffff)
  static let sub = Color(hex: 0xa7a39b)       // secondary text
  static let muted = Color(hex: 0x6e6b64)     // tertiary text

  // Fills / lines
  static let faint = Color.white.opacity(0.06)
  static let border = Color.white.opacity(0.10)

  // Semantic accents
  static let brandPink = Color(hex: 0xef5b91) // the real Surrey Beachcar found
  static let star = Color(hex: 0xe7b653)      // gold
  static let danger = Color(hex: 0xec6f5c)    // red

  // CHEAP · FAIR · RICH value meter (accent → gold 52% → red)
  static var meterGradient: LinearGradient {
    LinearGradient(
      stops: [
        .init(color: accent, location: 0),
        .init(color: star, location: 0.52),
        .init(color: danger, location: 1),
      ],
      startPoint: .leading,
      endPoint: .trailing
    )
  }
}

// MARK: - Typography (Archivo + Space Mono, bundled)

enum ArchivoWeight {
  case regular, medium, semibold, bold, extrabold, black

  /// PostScript names of the static instances bundled under Resources/Fonts.
  var psName: String {
    switch self {
    case .regular: "ArchivoRoman-Regular"
    case .medium: "ArchivoRoman-Medium"
    case .semibold: "ArchivoRoman-SemiBold"
    case .bold: "ArchivoRoman-Bold"
    case .extrabold: "ArchivoRoman-ExtraBold"
    case .black: "ArchivoRoman-Black"
    }
  }
}

extension Font {
  /// Display / UI typeface. The reference style preserves the authored hierarchy
  /// while allowing Dynamic Type to scale it with the user's reading preference.
  static func archivo(_ size: CGFloat, _ weight: ArchivoWeight = .regular) -> Font {
    let readableSize = max(size, 11)
    return .custom(weight.psName, size: readableSize, relativeTo: beachcarTextStyle(for: readableSize))
  }

  /// Mono / tracked-label typeface (counters, locations, timestamps, labels).
  static func mono(_ size: CGFloat, bold: Bool = false) -> Font {
    let readableSize = max(size, 10.5)
    return .custom(
      bold ? "SpaceMono-Bold" : "SpaceMono-Regular",
      size: readableSize,
      relativeTo: beachcarTextStyle(for: readableSize)
    )
  }
}

private func beachcarTextStyle(for size: CGFloat) -> Font.TextStyle {
  if size >= 30 { return .largeTitle }
  if size >= 24 { return .title }
  if size >= 19 { return .title2 }
  if size >= 16 { return .body }
  if size >= 13 { return .callout }
  return .caption
}

// MARK: - Icon map (design Unicode glyphs → SF Symbols)
//
// The prototype uses Unicode glyphs as placeholders; the handoff asks for the
// codebase's real icon set. These are the chosen SF Symbol equivalents.

enum Icon {
  // Feedback actions
  static let like = "heart.fill"       // ♥
  static let star = "star.fill"        // ★
  static let hide = "xmark"            // ✕
  static let avoid = "nosign"          // ⊘

  // Chrome / nav
  static let list = "line.3.horizontal" // ☰ (list button)
  static let closeList = "chevron.up"    // ⌃
  static let location = "scope"          // ⌖
  static let send = "arrow.up"           // ↑
  static let clock = "clock"             // ◔ (not-soon countdown)

  // Dossier sections
  static let vehicle = "car.fill"                       // ▤
  static let listingBody = "doc.plaintext"              // ☰ (FROM THE LISTING)
  static let equipment = "checklist"                    // ◆
  static let service = "wrench.and.screwdriver.fill"    // ↻
  static let why = "sparkles"                           // ✦
  static let market = "chart.bar.fill"                  // ▮
  static let beachFit = "sun.max.fill"                  // ☼
  static let watchouts = "exclamationmark.triangle.fill" // ⚠
  static let bidding = "flag.fill"                      // ⚑
  static let comments = "bubble.left.and.bubble.right.fill" // "
  static let teach = "square.and.pencil"               // ✎
  static let bullet = "chevron.right"                  // › (equipment marker)

  static func feedback(_ action: FeedbackAction) -> String {
    switch action {
    case .like: like
    case .star: star
    case .hide: hide
    case .avoid: avoid
    }
  }

  static func color(for action: FeedbackAction) -> Color {
    switch action {
    case .like: BC.accent
    case .star: BC.star
    case .hide: Color(hex: 0xd9d7d1)
    case .avoid: BC.danger
    }
  }
}
