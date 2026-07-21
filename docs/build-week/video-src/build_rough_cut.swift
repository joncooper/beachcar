import AppKit
import AVFoundation
import CoreMedia
import CoreVideo
import Foundation

private let width = 1920
private let height = 1080
private let fps: Int32 = 30

private let ink = NSColor(calibratedRed: 8 / 255, green: 10 / 255, blue: 11 / 255, alpha: 1)
private let paper = NSColor(calibratedRed: 247 / 255, green: 242 / 255, blue: 232 / 255, alpha: 1)
private let pink = NSColor(calibratedRed: 239 / 255, green: 75 / 255, blue: 137 / 255, alpha: 1)
private let mint = NSColor(calibratedRed: 184 / 255, green: 220 / 255, blue: 204 / 255, alpha: 1)
private let coral = NSColor(calibratedRed: 238 / 255, green: 103 / 255, blue: 83 / 255, alpha: 1)

private struct Cue {
    let start: Double
    let end: Double
    let text: String
}

private enum Visual {
    case slide(Int)
    case continuity
    case shortlist
    case buildWeek
}

private struct Shot {
    let start: Double
    let end: Double
    let visual: Visual
    let label: String
    let zoom: CGFloat
}

private func seconds(_ time: CMTime) -> Double {
    let value = CMTimeGetSeconds(time)
    return value.isFinite ? value : 0
}

private func drawText(
    _ text: String,
    rect: NSRect,
    font: NSFont,
    color: NSColor,
    alignment: NSTextAlignment = .left,
    lineSpacing: CGFloat = 4
) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    paragraph.lineSpacing = lineSpacing
    paragraph.lineBreakMode = .byWordWrapping
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: paragraph,
    ]
    (text as NSString).draw(
        with: rect,
        options: [.usesLineFragmentOrigin, .usesFontLeading],
        attributes: attributes
    )
}

private func roundedRect(_ rect: NSRect, radius: CGFloat, color: NSColor) {
    color.setFill()
    NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

private func drawSlide(_ image: NSImage, progress: CGFloat, zoomAmount: CGFloat) {
    ink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

    let zoom = 1 + zoomAmount * progress
    let drawWidth = CGFloat(width) * zoom
    let drawHeight = CGFloat(height) * zoom
    let panX = (progress - 0.5) * 10
    let panY = (0.5 - progress) * 6
    let destination = NSRect(
        x: (CGFloat(width) - drawWidth) / 2 + panX,
        y: (CGFloat(height) - drawHeight) / 2 + panY,
        width: drawWidth,
        height: drawHeight
    )
    image.draw(
        in: destination,
        from: NSRect(origin: .zero, size: image.size),
        operation: .sourceOver,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )
}

private func drawContinuity() {
    paper.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: height - 10, width: width, height: 10)).fill()

    drawText(
        "DETERMINISTIC REPLAY · TESTED CONTRACT",
        rect: NSRect(x: 100, y: 916, width: 980, height: 44),
        font: .systemFont(ofSize: 28, weight: .bold),
        color: pink
    )
    drawText(
        "One contract. Two honest proofs.",
        rect: NSRect(x: 96, y: 790, width: 1500, height: 110),
        font: .systemFont(ofSize: 72, weight: .black),
        color: ink
    )

    let labels = ["FIXTURE REPLAY", "REVIEW STATE", "GOLDEN SMOKE TEST"]
    let identities = ["demo_replay_\nsurrey_path", "demo_replay_\nsurrey_path", "separate synthetic\nrun"]
    let details = ["5 FIXTURE CANDIDATES", "SAME FIXTURE ID", "PUBLISH + READ BACK"]
    let statuses = ["FIXED", "INSPECTABLE", "TESTED"]
    for index in 0..<3 {
        let x = 96 + CGFloat(index) * 606
        let cardColor = index == 1
            ? mint
            : (index == 2 ? NSColor(calibratedRed: 1, green: 232 / 255, blue: 239 / 255, alpha: 1) : NSColor.white)
        roundedRect(NSRect(x: x, y: 306, width: 512, height: 382), radius: 34, color: cardColor)
        drawText(
            String(format: "%02d", index + 1),
            rect: NSRect(x: x + 34, y: 620, width: 80, height: 36),
            font: .monospacedSystemFont(ofSize: 22, weight: .bold),
            color: NSColor(calibratedRed: 34 / 255, green: 107 / 255, blue: 86 / 255, alpha: 1)
        )
        drawText(
            labels[index],
            rect: NSRect(x: x + 34, y: 552, width: 440, height: 48),
            font: .monospacedSystemFont(ofSize: 24, weight: .bold),
            color: ink
        )
        drawText(
            identities[index],
            rect: NSRect(x: x + 34, y: 424, width: 440, height: 94),
            font: .monospacedSystemFont(ofSize: 27, weight: .semibold),
            color: ink,
            lineSpacing: 7
        )
        drawText(
            details[index],
            rect: NSRect(x: x + 34, y: 364, width: 322, height: 44),
            font: .systemFont(ofSize: 21, weight: .bold),
            color: ink
        )
        drawText(
            "✓ \(statuses[index])",
            rect: NSRect(x: x + 326, y: 364, width: 148, height: 44),
            font: .systemFont(ofSize: 18, weight: .bold),
            color: NSColor(calibratedRed: 34 / 255, green: 107 / 255, blue: 86 / 255, alpha: 1),
            alignment: .right
        )

        if index == 0 {
            drawText(
                "→",
                rect: NSRect(x: x + 520, y: 452, width: 80, height: 80),
                font: .systemFont(ofSize: 54, weight: .bold),
                color: pink,
                alignment: .center
            )
        } else if index == 1 {
            drawText(
                "SEPARATE",
                rect: NSRect(x: x + 510, y: 474, width: 98, height: 32),
                font: .monospacedSystemFont(ofSize: 16, weight: .bold),
                color: pink,
                alignment: .center
            )
        }
    }

    roundedRect(NSRect(x: 96, y: 224, width: 352, height: 56), radius: 28, color: mint)
    drawText(
        "$0 BEACHCAR AI",
        rect: NSRect(x: 116, y: 236, width: 312, height: 32),
        font: .systemFont(ofSize: 22, weight: .bold),
        color: ink,
        alignment: .center
    )
    drawText(
        "FIXTURE REPLAY ≠ CAPTURED PRODUCTION RUN",
        rect: NSRect(x: 510, y: 234, width: 820, height: 36),
        font: .monospacedSystemFont(ofSize: 21, weight: .bold),
        color: ink,
        alignment: .center
    )
}

private func drawShortlist(icon: NSImage?) {
    ink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: height - 10, width: width, height: 10)).fill()

    drawText(
        "DETERMINISTIC REPLAY · 5 FIXTURE CANDIDATES",
        rect: NSRect(x: 96, y: 920, width: 940, height: 42),
        font: .systemFont(ofSize: 27, weight: .bold),
        color: pink
    )
    drawText(
        "A fixture shortlist worth inspecting.",
        rect: NSRect(x: 92, y: 808, width: 1180, height: 92),
        font: .systemFont(ofSize: 64, weight: .black),
        color: paper
    )

    if let icon {
        roundedRect(NSRect(x: 96, y: 270, width: 540, height: 490), radius: 46, color: NSColor.black)
        icon.draw(
            in: NSRect(x: 126, y: 294, width: 480, height: 480),
            from: NSRect(origin: .zero, size: icon.size),
            operation: .sourceOver,
            fraction: 1,
            respectFlipped: false,
            hints: [.interpolation: NSImageInterpolation.high]
        )
    }

    let cards = [
        ("01", "1960 WILLYS DJ-3A SURREY", "97%", "Open-air charm · simple · memorable"),
        ("02", "1991 NISSAN FIGARO", "89%", "Tiny convertible · joyful color"),
        ("03", "1974 VOLKSWAGEN THING", "86%", "Friendly · open · slow adventure"),
    ]
    for (index, card) in cards.enumerated() {
        let y = 588 - CGFloat(index) * 162
        roundedRect(NSRect(x: 704, y: y, width: 1114, height: 132), radius: 25, color: index == 0 ? NSColor(calibratedRed: 45 / 255, green: 35 / 255, blue: 40 / 255, alpha: 1) : NSColor(calibratedWhite: 0.12, alpha: 1))
        drawText(card.0, rect: NSRect(x: 742, y: y + 78, width: 72, height: 34), font: .monospacedSystemFont(ofSize: 21, weight: .bold), color: pink)
        drawText(card.1, rect: NSRect(x: 824, y: y + 70, width: 690, height: 42), font: .systemFont(ofSize: 26, weight: .bold), color: paper)
        drawText(card.3, rect: NSRect(x: 824, y: y + 28, width: 720, height: 32), font: .systemFont(ofSize: 20, weight: .medium), color: mint)
        drawText(card.2, rect: NSRect(x: 1576, y: y + 50, width: 180, height: 54), font: .systemFont(ofSize: 37, weight: .black), color: paper, alignment: .right)
    }

    drawText(
        "WHY IT FITS  ·  WATCH-OUT  ·  SOURCE",
        rect: NSRect(x: 704, y: 246, width: 1114, height: 40),
        font: .monospacedSystemFont(ofSize: 22, weight: .bold),
        color: mint,
        alignment: .center
    )
}

private func drawBuildWeek(icon: NSImage?) {
    paper.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: height - 10, width: width, height: 10)).fill()

    drawText(
        "HOW CODEX HELPED BUILD IT",
        rect: NSRect(x: 96, y: 916, width: 900, height: 46),
        font: .systemFont(ofSize: 28, weight: .bold),
        color: pink
    )
    drawText(
        "Build Week extension",
        rect: NSRect(x: 92, y: 790, width: 1300, height: 110),
        font: .systemFont(ofSize: 74, weight: .black),
        color: ink
    )

    if let icon {
        roundedRect(NSRect(x: 96, y: 286, width: 520, height: 452), radius: 48, color: ink)
        icon.draw(
            in: NSRect(x: 132, y: 310, width: 448, height: 448),
            from: NSRect(origin: .zero, size: icon.size),
            operation: .sourceOver,
            fraction: 1,
            respectFlipped: false,
            hints: [.interpolation: NSImageInterpolation.high]
        )
    }

    let items = [
        ("AUDITED", "the existing repository and its honest starting point"),
        ("ARCHITECTED", "local Codex + signed-in browser + scoped Beachcar MCP"),
        ("IMPLEMENTED", "coached iPhone-to-desktop onboarding"),
        ("DROVE", "the browser and iOS Simulator"),
        ("TESTED", "the golden path and replay contract"),
    ]
    for (index, item) in items.enumerated() {
        let y = 672 - CGFloat(index) * 96
        roundedRect(NSRect(x: 686, y: y, width: 1138, height: 72), radius: 18, color: index % 2 == 0 ? NSColor.white : NSColor(calibratedRed: 1, green: 232 / 255, blue: 239 / 255, alpha: 1))
        drawText("✓", rect: NSRect(x: 716, y: y + 17, width: 48, height: 40), font: .systemFont(ofSize: 27, weight: .black), color: NSColor(calibratedRed: 34 / 255, green: 107 / 255, blue: 86 / 255, alpha: 1))
        drawText(item.0, rect: NSRect(x: 778, y: y + 18, width: 244, height: 38), font: .monospacedSystemFont(ofSize: 22, weight: .bold), color: ink)
        drawText(item.1, rect: NSRect(x: 1026, y: y + 18, width: 760, height: 38), font: .systemFont(ofSize: 21, weight: .medium), color: ink)
    }

    drawText(
        "CODEX + GPT-5.6",
        rect: NSRect(x: 686, y: 206, width: 1138, height: 56),
        font: .systemFont(ofSize: 37, weight: .black),
        color: pink,
        alignment: .right
    )
}

private func addOverlay(label: String, caption: String?, progress: CGFloat) {
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: CGFloat(height) - 8, width: CGFloat(width) * progress, height: 8)).fill()

    roundedRect(NSRect(x: 64, y: 978, width: 610, height: 48), radius: 24, color: NSColor(calibratedWhite: 0.03, alpha: 0.86))
    drawText(
        label,
        rect: NSRect(x: 86, y: 989, width: 566, height: 30),
        font: .monospacedSystemFont(ofSize: 19, weight: .bold),
        color: pink
    )

    roundedRect(NSRect(x: 1310, y: 978, width: 548, height: 48), radius: 24, color: NSColor(calibratedWhite: 0.03, alpha: 0.86))
    drawText(
        "ROUGH CUT · SYNTHESIZED NARRATION",
        rect: NSRect(x: 1330, y: 989, width: 508, height: 30),
        font: .monospacedSystemFont(ofSize: 17, weight: .bold),
        color: mint,
        alignment: .center
    )

    guard let caption, !caption.isEmpty else { return }
    roundedRect(NSRect(x: 84, y: 46, width: 1752, height: 134), radius: 28, color: NSColor(calibratedWhite: 0.02, alpha: 0.90))
    drawText(
        caption,
        rect: NSRect(x: 126, y: 73, width: 1668, height: 84),
        font: .systemFont(ofSize: 31, weight: .semibold),
        color: paper,
        alignment: .center,
        lineSpacing: 6
    )
}

private func renderFrame(
    into pixelBuffer: CVPixelBuffer,
    time: Double,
    duration: Double,
    audioStart: Double,
    narrationDuration: Double,
    slides: [Int: NSImage],
    icon: NSImage,
    shots: [Shot],
    cues: [Cue]
) {
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    guard let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
    ) else { return }

    let graphics = NSGraphicsContext(cgContext: context, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    defer { NSGraphicsContext.restoreGraphicsState() }

    let narrationTime = max(0, time - audioStart)
    let shot = shots.first(where: { narrationTime >= $0.start && narrationTime < $0.end }) ?? shots.last!
    let shotProgress = CGFloat(max(0, min(1, (narrationTime - shot.start) / max(0.01, shot.end - shot.start))))

    switch shot.visual {
    case let .slide(number):
        if let slide = slides[number] {
            drawSlide(slide, progress: shotProgress, zoomAmount: shot.zoom)
        }
    case .continuity:
        drawContinuity()
    case .shortlist:
        drawShortlist(icon: icon)
    case .buildWeek:
        drawBuildWeek(icon: icon)
    }

    let caption = time >= audioStart
        ? cues.first(where: { narrationTime >= $0.start && narrationTime < $0.end })?.text
        : nil
    addOverlay(label: shot.label, caption: caption, progress: CGFloat(time / duration))
}

private func makeSilentVideo(
    outputURL: URL,
    duration: Double,
    audioStart: Double,
    narrationDuration: Double,
    slides: [Int: NSImage],
    icon: NSImage
) throws {
    try? FileManager.default.removeItem(at: outputURL)
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 8_000_000,
            AVVideoExpectedSourceFrameRateKey: fps,
            AVVideoMaxKeyFrameIntervalKey: fps * 2,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let attributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: attributes
    )
    guard writer.canAdd(input) else {
        throw NSError(domain: "BeachcarRoughCut", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not add video input"])
    }
    writer.add(input)

    let scale = narrationDuration / 164.442
    let at: (Double) -> Double = { $0 * scale }
    let shots: [Shot] = [
        Shot(start: at(0), end: at(14), visual: .slide(1), label: "OUTCOME · IT FOUND THE ONE", zoom: 0.012),
        Shot(start: at(14), end: at(28), visual: .slide(2), label: "THE PROBLEM · TASTE > FILTERS", zoom: 0.010),
        Shot(start: at(28), end: at(46), visual: .slide(3), label: "WHAT I BUILT · NATIVE iPHONE + MEMORY", zoom: 0.008),
        Shot(start: at(46), end: at(64), visual: .slide(4), label: "LOCAL CODEX · GPT-5.6 · SIGNED-IN BROWSER", zoom: 0.010),
        Shot(start: at(64), end: at(92), visual: .continuity, label: "DETERMINISTIC REPLAY · FIXTURE + SEPARATE SMOKE TEST", zoom: 0),
        Shot(start: at(92), end: at(110), visual: .shortlist, label: "FIXTURE SHORTLIST · FIVE, NOT FIVE HUNDRED", zoom: 0),
        Shot(start: at(110), end: at(128), visual: .slide(6), label: "EXPLICIT FEEDBACK → DURABLE MEMORY", zoom: 0.010),
        Shot(start: at(128), end: at(153), visual: .buildWeek, label: "BUILD WEEK EXTENSION · CODEX + GPT-5.6", zoom: 0),
        Shot(start: at(153), end: at(158), visual: .slide(1), label: "APPS FOR YOUR LIFE · ONE GOOD DECISION", zoom: 0.014),
        Shot(start: at(158), end: narrationDuration + 6, visual: .slide(7), label: "BEACHCAR · APPS FOR YOUR LIFE", zoom: 0.006),
    ]

    let cues: [Cue] = [
        Cue(start: at(0), end: at(7), text: "This is a 1960 Willys DJ-3A Surrey—tiny, open-air, and unapologetically pink."),
        Cue(start: at(7), end: at(14), text: "I didn't know to search for it. Beachcar surfaced it after a couple of weeks. I bought it."),
        Cue(start: at(14), end: at(21), text: "Ordinary alerts can match make, year, and price. My taste is harder."),
        Cue(start: at(21), end: at(28), text: "Beachcar turns a fuzzy preference into an agent that can act on it."),
        Cue(start: at(28), end: at(37), text: "I built a native iPhone experience for teaching taste and reviewing a tiny shortlist."),
        Cue(start: at(37), end: at(46), text: "A desktop handoff connects local Codex to Beachcar's hosted MCP and durable memory."),
        Cue(start: at(46), end: at(55), text: "Inside the product, GPT-5.6 is the judgment engine, running in the user's own Codex."),
        Cue(start: at(55), end: at(64), text: "It controls the signed-in browser and explains fit, value, uncertainty, and risk."),
        Cue(start: at(64), end: at(67.5), text: "This deterministic replay makes the Build Week contract inspectable."),
        Cue(start: at(67.5), end: at(72.5), text: "It steps through setup, local research, candidate submission, publication, and read-back verification."),
        Cue(start: at(72.5), end: at(77.5), text: "The fixed fixture keeps one run identifier across the replay and review state."),
        Cue(start: at(77.5), end: at(83.5), text: "Separately, the golden-path smoke test publishes and reads back a synthetic run through the same MCP."),
        Cue(start: at(83.5), end: at(87.5), text: "Credentials stay in the user's browser."),
        Cue(start: at(87.5), end: at(92), text: "OpenAI costs stay with their Codex, and Beachcar's AI bill for the run is zero."),
        Cue(start: at(92), end: at(95), text: "The product isn't another infinite feed."),
        Cue(start: at(95), end: at(101), text: "The deterministic fixture shows five cars worth opening, each with a reason, caveat, and source."),
        Cue(start: at(101), end: at(104), text: "The real Surrey proves the taste problem."),
        Cue(start: at(104), end: at(110), text: "The Build Week local GPT-5.6 path is designed to reason from character and context, not just a keyword."),
        Cue(start: at(110), end: at(119), text: "Love the Surrey, and tomorrow prioritizes open-air oddballs and slow-car charm."),
        Cue(start: at(119), end: at(128), text: "Never again suppresses anonymous SUVs. Feedback becomes inspectable memory."),
        Cue(start: at(128), end: at(136), text: "I also used Codex with GPT-5.6 to build this Build Week extension."),
        Cue(start: at(136), end: at(144), text: "It audited the repository and helped choose an honest local-agent architecture."),
        Cue(start: at(144), end: at(153), text: "It implemented, drove the browser and Simulator, and strengthened the golden-path tests."),
        Cue(start: at(153), end: at(158), text: "Beachcar is for Apps for Your Life because it measures success differently."),
        Cue(start: at(158), end: at(164.442), text: "Not more listings. One unusually good decision. Your Codex. Your taste. The one."),
    ]

    guard writer.startWriting() else {
        throw writer.error ?? NSError(domain: "BeachcarRoughCut", code: 2, userInfo: nil)
    }
    writer.startSession(atSourceTime: .zero)
    guard let pool = adaptor.pixelBufferPool else {
        throw NSError(domain: "BeachcarRoughCut", code: 3, userInfo: [NSLocalizedDescriptionKey: "Missing pixel buffer pool"])
    }

    let frameCount = Int(ceil(duration * Double(fps)))
    for frame in 0..<frameCount {
        while !input.isReadyForMoreMediaData {
            Thread.sleep(forTimeInterval: 0.001)
        }
        var maybeBuffer: CVPixelBuffer?
        let result = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer)
        guard result == kCVReturnSuccess, let buffer = maybeBuffer else {
            throw NSError(domain: "BeachcarRoughCut", code: 4, userInfo: [NSLocalizedDescriptionKey: "Could not allocate frame buffer"])
        }
        let frameTime = CMTime(value: CMTimeValue(frame), timescale: fps)
        renderFrame(
            into: buffer,
            time: Double(frame) / Double(fps),
            duration: duration,
            audioStart: audioStart,
            narrationDuration: narrationDuration,
            slides: slides,
            icon: icon,
            shots: shots,
            cues: cues
        )
        guard adaptor.append(buffer, withPresentationTime: frameTime) else {
            throw writer.error ?? NSError(domain: "BeachcarRoughCut", code: 5, userInfo: nil)
        }
        if frame % (Int(fps) * 15) == 0 {
            let rendered = Double(frame) / Double(fps)
            print(String(format: "rendered %.0fs / %.0fs", rendered, duration))
        }
    }

    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    semaphore.wait()
    guard writer.status == .completed else {
        throw writer.error ?? NSError(domain: "BeachcarRoughCut", code: 6, userInfo: nil)
    }
}

private func combine(videoURL: URL, audioURL: URL, outputURL: URL, audioStart: Double) throws {
    try? FileManager.default.removeItem(at: outputURL)
    let videoAsset = AVURLAsset(url: videoURL)
    let audioAsset = AVURLAsset(url: audioURL)
    guard let videoTrack = videoAsset.tracks(withMediaType: .video).first,
          let audioTrack = audioAsset.tracks(withMediaType: .audio).first else {
        throw NSError(domain: "BeachcarRoughCut", code: 7, userInfo: [NSLocalizedDescriptionKey: "Missing video or audio track"])
    }

    let composition = AVMutableComposition()
    guard let compositionVideo = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
          let compositionAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw NSError(domain: "BeachcarRoughCut", code: 8, userInfo: [NSLocalizedDescriptionKey: "Could not create composition tracks"])
    }
    try compositionVideo.insertTimeRange(CMTimeRange(start: .zero, duration: videoAsset.duration), of: videoTrack, at: .zero)
    try compositionAudio.insertTimeRange(CMTimeRange(start: .zero, duration: audioAsset.duration), of: audioTrack, at: CMTime(seconds: audioStart, preferredTimescale: 600))

    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
        throw NSError(domain: "BeachcarRoughCut", code: 9, userInfo: [NSLocalizedDescriptionKey: "Could not create exporter"])
    }
    exporter.outputURL = outputURL
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously { semaphore.signal() }
    semaphore.wait()
    guard exporter.status == .completed else {
        throw exporter.error ?? NSError(domain: "BeachcarRoughCut", code: 10, userInfo: nil)
    }
}

private func main() throws {
    let arguments = CommandLine.arguments
    guard arguments.count == 4 else {
        fputs("usage: build_rough_cut <repo-root> <narration-aiff> <output-mp4>\n", stderr)
        exit(2)
    }

    let root = URL(fileURLWithPath: arguments[1], isDirectory: true)
    let audioURL = URL(fileURLWithPath: arguments[2])
    let outputURL = URL(fileURLWithPath: arguments[3])
    let intermediateURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("beachcar-rough-cut-silent.mp4")
    let audioAsset = AVURLAsset(url: audioURL)
    let narrationDuration = seconds(audioAsset.duration)
    guard narrationDuration > 1 else {
        throw NSError(domain: "BeachcarRoughCut", code: 11, userInfo: [NSLocalizedDescriptionKey: "Narration has no audible content"])
    }

    var slides: [Int: NSImage] = [:]
    for number in 1...7 {
        let name = String(format: "slide-%02d.png", number)
        let url = root.appendingPathComponent("docs/build-week/deck-preview/\(name)")
        guard let image = NSImage(contentsOf: url) else {
            throw NSError(domain: "BeachcarRoughCut", code: 12, userInfo: [NSLocalizedDescriptionKey: "Missing \(name)"])
        }
        slides[number] = image
    }
    let iconURL = root.appendingPathComponent("assets/brand/beachcar-icon.png")
    guard let icon = NSImage(contentsOf: iconURL) else {
        throw NSError(domain: "BeachcarRoughCut", code: 13, userInfo: [NSLocalizedDescriptionKey: "Missing generated Beachcar icon"])
    }

    let audioStart = 1.0
    let finalDuration = audioStart + narrationDuration + 5.0
    print(String(format: "narration %.3fs; final target %.3fs", narrationDuration, finalDuration))
    try makeSilentVideo(
        outputURL: intermediateURL,
        duration: finalDuration,
        audioStart: audioStart,
        narrationDuration: narrationDuration,
        slides: slides,
        icon: icon
    )
    try combine(videoURL: intermediateURL, audioURL: audioURL, outputURL: outputURL, audioStart: audioStart)
    try? FileManager.default.removeItem(at: intermediateURL)
    print("wrote \(outputURL.path)")
}

do {
    try main()
} catch {
    fputs("error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
