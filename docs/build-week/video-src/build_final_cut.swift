import AppKit
import AVFoundation
import CoreMedia
import CoreVideo
import Foundation

private let width = 1920
private let height = 1080
private let fps: Int32 = 30
private let openingLead = 1.0
private let sectionGap = 0.2
private let closingTail = 5.0
private let maximumDuration = 175.0
private let narrationVolume: Float = 0.95

private let ink = NSColor(calibratedRed: 8 / 255, green: 10 / 255, blue: 11 / 255, alpha: 1)
private let paper = NSColor(calibratedRed: 247 / 255, green: 242 / 255, blue: 232 / 255, alpha: 1)
private let pink = NSColor(calibratedRed: 239 / 255, green: 75 / 255, blue: 137 / 255, alpha: 1)
private let mint = NSColor(calibratedRed: 184 / 255, green: 220 / 255, blue: 204 / 255, alpha: 1)

private struct Cue {
    let start: Double
    let end: Double
    let text: String
}

private struct CaptionPhrase {
    let spoken: String
    let display: String

    init(_ display: String) {
        self.display = display
        self.spoken = ttsExpandedText(display)
    }
}

private enum ImageFit {
    case fill
    case contain
}

private enum Visual {
    case slide(Int)
    case capture(String, ImageFit)
    case continuity
    case buildWeek
}

private struct ShotSpec {
    let startFraction: Double
    let endFraction: Double
    let visual: Visual
    let label: String
    let zoom: CGFloat
}

private struct SectionSpec {
    let audioFileName: String
    let captions: [CaptionPhrase]
    let shots: [ShotSpec]
}

private struct AudioSection {
    let spec: SectionSpec
    let asset: AVURLAsset
    let track: AVAssetTrack
    let duration: Double
    let audioStart: Double

    var audioEnd: Double {
        audioStart + duration
    }
}

private struct Shot {
    let start: Double
    let end: Double
    let visual: Visual
    let label: String
    let zoom: CGFloat
}

private let sectionSpecs: [SectionSpec] = [
    SectionSpec(
        audioFileName: "01-outcome.mp3",
        captions: [
            CaptionPhrase("This is a 1960 Willys DJ-3A Surrey: tiny, open-air, and unapologetically pink."),
            CaptionPhrase("Earlier, before this Build Week extension, Beachcar surfaced it."),
            CaptionPhrase("I didn't know to search for it."),
            CaptionPhrase("I bought it. That's the clearest proof."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.38, visual: .slide(1), label: "OUTCOME · IT FOUND THE ONE", zoom: 0.025),
            ShotSpec(startFraction: 0.38, endFraction: 1, visual: .capture("web/proof.png", .fill), label: "REAL-WORLD PROOF · BOUGHT BY ITS USER", zoom: 0.010),
        ]
    ),
    SectionSpec(
        audioFileName: "02-alerts.mp3",
        captions: [
            CaptionPhrase("Alerts can match make, year, and price."),
            CaptionPhrase("My taste is harder: joyful, mechanically simple, useful for slow beach days,"),
            CaptionPhrase("charming instead of precious."),
            CaptionPhrase("Beachcar turns that preference into an agent that can act on it."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.48, visual: .slide(2), label: "THE PROBLEM · TASTE > FILTERS", zoom: 0.012),
            ShotSpec(startFraction: 0.48, endFraction: 1, visual: .capture("web/teach.png", .fill), label: "TEACH IT ONCE · DURABLE MEMORY", zoom: 0.008),
        ]
    ),
    SectionSpec(
        audioFileName: "03-changed.mp3",
        captions: [
            CaptionPhrase("Beachcar already had an iPhone review experience."),
            CaptionPhrase("For Build Week, I extended it with taste coaching and a desktop handoff."),
            CaptionPhrase("Local Codex connects to Beachcar's hosted MCP,"),
            CaptionPhrase("where taste, feedback, sources, and published runs become durable memory."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.30, visual: .capture("ios/taste-onboarding-step1.png", .contain), label: "NATIVE iPHONE · TEACH TASTE", zoom: 0.006),
            ShotSpec(startFraction: 0.30, endFraction: 0.60, visual: .capture("ios/taste-onboarding-calibrate.png", .contain), label: "TASTE · NOT JUST FILTERS", zoom: 0.006),
            ShotSpec(startFraction: 0.60, endFraction: 1, visual: .capture("ios/desktop-codex-handoff.png", .contain), label: "DESKTOP HANDOFF · LOCAL CODEX", zoom: 0.004),
        ]
    ),
    SectionSpec(
        audioFileName: "04-gpt.mp3",
        captions: [
            CaptionPhrase("Inside the product, GPT-5.6 is the judgment engine."),
            CaptionPhrase("Running in your own Codex, it reads the brief, plans the search,"),
            CaptionPhrase("uses your signed-in browser, compares auction evidence,"),
            CaptionPhrase("and explains fit, value, uncertainty, and risk."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 1, visual: .capture("web/research.png", .fill), label: "LOCAL CODEX · GPT-5.6 · SIGNED-IN BROWSER", zoom: 0.010),
        ]
    ),
    SectionSpec(
        audioFileName: "05-continuity.mp3",
        captions: [
            CaptionPhrase("This deterministic replay makes the contract inspectable."),
            CaptionPhrase("One fixture carries the same run identifier through setup, research,"),
            CaptionPhrase("publication, verification, and the review state."),
            CaptionPhrase("Separately, a golden-path smoke test publishes and reads back"),
            CaptionPhrase("a synthetic run through the hosted MCP."),
            CaptionPhrase("In actual use, local Codex, the signed-in browser, and MCP"),
            CaptionPhrase("are designed to add zero Beachcar AI usage."),
            CaptionPhrase("Credentials stay local."),
            CaptionPhrase("OpenAI costs stay with the user's Codex."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.30, visual: .capture("web/research.png", .fill), label: "EXACT MCP CONTRACT · FIXED REPLAY", zoom: 0.018),
            ShotSpec(startFraction: 0.30, endFraction: 1, visual: .continuity, label: "DETERMINISTIC REPLAY · TESTED CONTRACT", zoom: 0),
        ]
    ),
    SectionSpec(
        audioFileName: "06-five.mp3",
        captions: [
            CaptionPhrase("The goal isn't another feed."),
            CaptionPhrase("The replay carries five fixture cars;"),
            CaptionPhrase("each candidate has a reason, caveat, and source in the contract."),
            CaptionPhrase("The real Surrey proves the taste problem."),
            CaptionPhrase("This local path reasons from character and context, not just keywords."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 1, visual: .capture("web/review.png", .fill), label: "FIXTURE SHORTLIST · FIVE, NOT FIVE HUNDRED", zoom: 0.010),
        ]
    ),
    SectionSpec(
        audioFileName: "07-learning.mp3",
        captions: [
            CaptionPhrase("Then the loop gets personal."),
            CaptionPhrase("Love the Surrey, and tomorrow's plan prioritizes"),
            CaptionPhrase("open-air oddballs, playful color, and slow-car charm."),
            CaptionPhrase("Mark an anonymous performance SUV as “Never again,”"),
            CaptionPhrase("and Codex stops spending attention there."),
            CaptionPhrase("Feedback becomes inspectable memory, not a hidden profile."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 1, visual: .capture("web/learn.png", .fill), label: "EXPLICIT FEEDBACK → DURABLE MEMORY", zoom: 0.010),
        ]
    ),
    SectionSpec(
        audioFileName: "08-codex.mp3",
        captions: [
            CaptionPhrase("I used Codex with GPT-5.6 to build this Build Week extension."),
            CaptionPhrase("It audited the repository, helped choose an honest local-agent architecture,"),
            CaptionPhrase("implemented iPhone-to-desktop onboarding and the scoped MCP workflow,"),
            CaptionPhrase("drove the browser and iOS Simulator,"),
            CaptionPhrase("and strengthened the golden-path tests."),
            CaptionPhrase("I made the product decisions."),
            CaptionPhrase("Codex turned them into tested software."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 1, visual: .buildWeek, label: "BUILD WEEK EXTENSION · CODEX + GPT-5.6", zoom: 0),
        ]
    ),
    SectionSpec(
        audioFileName: "09-close.mp3",
        captions: [
            CaptionPhrase("Beachcar is for Apps for Your Life because it measures success differently."),
            CaptionPhrase("Not more listings, clicks, or engagement."),
            CaptionPhrase("One unusually good decision."),
            CaptionPhrase("Your Codex. Your taste. The one."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.46, visual: .slide(1), label: "APPS FOR YOUR LIFE · ONE GOOD DECISION", zoom: 0.025),
            ShotSpec(startFraction: 0.46, endFraction: 1, visual: .slide(7), label: "BEACHCAR · APPS FOR YOUR LIFE", zoom: 0.008),
        ]
    ),
]

private func seconds(_ time: CMTime) -> Double {
    let value = CMTimeGetSeconds(time)
    return value.isFinite ? value : 0
}

private func makeError(_ code: Int, _ message: String) -> NSError {
    NSError(
        domain: "BeachcarFinalCut",
        code: code,
        userInfo: [NSLocalizedDescriptionKey: message]
    )
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

private func aspectRect(
    imageSize: NSSize,
    canvas: NSRect,
    fit: ImageFit,
    progress: CGFloat,
    zoomAmount: CGFloat
) -> NSRect {
    guard imageSize.width > 0, imageSize.height > 0 else { return canvas }
    let widthScale = canvas.width / imageSize.width
    let heightScale = canvas.height / imageSize.height
    let baseScale = fit == .fill ? max(widthScale, heightScale) : min(widthScale, heightScale)
    let scale = baseScale * (1 + zoomAmount * progress)
    let drawWidth = imageSize.width * scale
    let drawHeight = imageSize.height * scale
    let panX = fit == .fill ? (progress - 0.5) * 10 : 0
    let panY = fit == .fill ? (0.5 - progress) * 6 : 0
    return NSRect(
        x: canvas.midX - drawWidth / 2 + panX,
        y: canvas.midY - drawHeight / 2 + panY,
        width: drawWidth,
        height: drawHeight
    )
}

private func drawImage(
    _ image: NSImage,
    fit: ImageFit,
    progress: CGFloat,
    zoomAmount: CGFloat
) {
    ink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    let canvas = NSRect(x: 0, y: 0, width: width, height: height)
    let destination = aspectRect(
        imageSize: image.size,
        canvas: canvas,
        fit: fit,
        progress: progress,
        zoomAmount: zoomAmount
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
        rect: NSRect(x: 192, y: 884, width: 1100, height: 42),
        font: .systemFont(ofSize: 27, weight: .bold),
        color: pink
    )
    drawText(
        "One contract. Two honest proofs.",
        rect: NSRect(x: 192, y: 758, width: 1500, height: 100),
        font: .systemFont(ofSize: 68, weight: .black),
        color: ink
    )

    let labels = ["FIXTURE REPLAY", "REVIEW STATE", "GOLDEN SMOKE TEST"]
    let identities = ["demo_replay_\nsurrey_path", "demo_replay_\nsurrey_path", "separate synthetic\nrun"]
    let details = ["5 FIXTURE CANDIDATES", "SAME FIXTURE ID", "PUBLISH + READ BACK"]
    let statuses = ["FIXED", "INSPECTABLE", "TESTED"]
    let safeX: CGFloat = 192
    let gap: CGFloat = 36
    let cardWidth = (1536 - gap * 2) / 3

    for index in 0..<3 {
        let x = safeX + CGFloat(index) * (cardWidth + gap)
        let cardColor = index == 1
            ? mint
            : (index == 2 ? NSColor(calibratedRed: 1, green: 232 / 255, blue: 239 / 255, alpha: 1) : NSColor.white)
        roundedRect(NSRect(x: x, y: 330, width: cardWidth, height: 350), radius: 32, color: cardColor)
        drawText(
            String(format: "%02d", index + 1),
            rect: NSRect(x: x + 30, y: 614, width: 80, height: 34),
            font: .monospacedSystemFont(ofSize: 21, weight: .bold),
            color: NSColor(calibratedRed: 34 / 255, green: 107 / 255, blue: 86 / 255, alpha: 1)
        )
        drawText(
            labels[index],
            rect: NSRect(x: x + 30, y: 550, width: cardWidth - 60, height: 42),
            font: .monospacedSystemFont(ofSize: 22, weight: .bold),
            color: ink
        )
        drawText(
            identities[index],
            rect: NSRect(x: x + 30, y: 430, width: cardWidth - 60, height: 92),
            font: .monospacedSystemFont(ofSize: 26, weight: .semibold),
            color: ink,
            lineSpacing: 7
        )
        drawText(
            details[index],
            rect: NSRect(x: x + 30, y: 374, width: cardWidth - 60, height: 36),
            font: .systemFont(ofSize: 19, weight: .bold),
            color: ink
        )
        drawText(
            "✓ \(statuses[index])",
            rect: NSRect(x: x + 30, y: 344, width: cardWidth - 60, height: 28),
            font: .systemFont(ofSize: 17, weight: .bold),
            color: NSColor(calibratedRed: 34 / 255, green: 107 / 255, blue: 86 / 255, alpha: 1),
            alignment: .right
        )
    }

    drawText(
        "FIXTURE REPLAY ≠ CAPTURED PRODUCTION RUN",
        rect: NSRect(x: 192, y: 278, width: 1536, height: 36),
        font: .monospacedSystemFont(ofSize: 20, weight: .bold),
        color: ink,
        alignment: .center
    )
}

private func drawBuildWeek(icon: NSImage) {
    paper.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: height - 10, width: width, height: 10)).fill()

    drawText(
        "HOW CODEX HELPED BUILD IT",
        rect: NSRect(x: 192, y: 884, width: 900, height: 42),
        font: .systemFont(ofSize: 27, weight: .bold),
        color: pink
    )
    drawText(
        "Build Week extension",
        rect: NSRect(x: 192, y: 770, width: 1250, height: 96),
        font: .systemFont(ofSize: 68, weight: .black),
        color: ink
    )

    roundedRect(NSRect(x: 192, y: 316, width: 430, height: 400), radius: 42, color: ink)
    icon.draw(
        in: NSRect(x: 222, y: 332, width: 370, height: 370),
        from: NSRect(origin: .zero, size: icon.size),
        operation: .sourceOver,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )

    let items = [
        ("AUDITED", "the existing repository and its honest starting point"),
        ("ARCHITECTED", "local Codex + signed-in browser + scoped Beachcar MCP"),
        ("IMPLEMENTED", "coached iPhone-to-desktop onboarding"),
        ("DROVE", "the browser and iOS Simulator"),
        ("TESTED", "the golden path and replay contract"),
    ]
    for (index, item) in items.enumerated() {
        let y = 650 - CGFloat(index) * 82
        roundedRect(
            NSRect(x: 680, y: y, width: 1048, height: 62),
            radius: 16,
            color: index % 2 == 0
                ? NSColor.white
                : NSColor(calibratedRed: 1, green: 232 / 255, blue: 239 / 255, alpha: 1)
        )
        drawText(
            "✓",
            rect: NSRect(x: 708, y: y + 14, width: 42, height: 34),
            font: .systemFont(ofSize: 25, weight: .black),
            color: NSColor(calibratedRed: 34 / 255, green: 107 / 255, blue: 86 / 255, alpha: 1)
        )
        drawText(
            item.0,
            rect: NSRect(x: 762, y: y + 14, width: 230, height: 34),
            font: .monospacedSystemFont(ofSize: 20, weight: .bold),
            color: ink
        )
        drawText(
            item.1,
            rect: NSRect(x: 1000, y: y + 14, width: 700, height: 34),
            font: .systemFont(ofSize: 19, weight: .medium),
            color: ink
        )
    }

    drawText(
        "CODEX + GPT-5.6",
        rect: NSRect(x: 680, y: 270, width: 1048, height: 50),
        font: .systemFont(ofSize: 34, weight: .black),
        color: pink,
        alignment: .right
    )
}

private func addOverlay(label: String, caption: String?, progress: CGFloat) {
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: CGFloat(height) - 8, width: CGFloat(width) * progress, height: 8)).fill()

    roundedRect(
        NSRect(x: 192, y: 900, width: 800, height: 48),
        radius: 24,
        color: NSColor(calibratedWhite: 0.03, alpha: 0.88)
    )
    drawText(
        label,
        rect: NSRect(x: 216, y: 911, width: 752, height: 30),
        font: .monospacedSystemFont(ofSize: 18, weight: .bold),
        color: pink
    )

    guard let caption, !caption.isEmpty else { return }
    roundedRect(
        NSRect(x: 192, y: 108, width: 1536, height: 148),
        radius: 28,
        color: NSColor(calibratedWhite: 0.02, alpha: 0.92)
    )
    drawText(
        caption,
        rect: NSRect(x: 234, y: 134, width: 1452, height: 98),
        font: .systemFont(ofSize: 36, weight: .semibold),
        color: paper,
        alignment: .center,
        lineSpacing: 6
    )
}

private func renderFrame(
    into pixelBuffer: CVPixelBuffer,
    time: Double,
    duration: Double,
    slides: [Int: NSImage],
    captures: [String: NSImage],
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

    let shot = shots.first(where: { time >= $0.start && time < $0.end }) ?? shots.last!
    let shotProgress = CGFloat(max(0, min(1, (time - shot.start) / max(0.01, shot.end - shot.start))))

    switch shot.visual {
    case let .slide(number):
        if let slide = slides[number] {
            drawImage(slide, fit: .fill, progress: shotProgress, zoomAmount: shot.zoom)
        }
    case let .capture(name, fit):
        if let capture = captures[name] {
            drawImage(capture, fit: fit, progress: shotProgress, zoomAmount: shot.zoom)
        }
    case .continuity:
        drawContinuity()
    case .buildWeek:
        drawBuildWeek(icon: icon)
    }

    let caption = cues.first(where: { time >= $0.start && time < $0.end })?.text
    addOverlay(label: shot.label, caption: caption, progress: CGFloat(time / duration))
}

private func makeSilentVideo(
    outputURL: URL,
    duration: Double,
    slides: [Int: NSImage],
    captures: [String: NSImage],
    icon: NSImage,
    shots: [Shot],
    cues: [Cue]
) throws {
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoColorPropertiesKey: [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
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
        throw makeError(1, "Could not add the video writer input")
    }
    writer.add(input)

    guard writer.startWriting() else {
        throw writer.error ?? makeError(2, "Could not start the video writer")
    }
    writer.startSession(atSourceTime: .zero)
    guard let pool = adaptor.pixelBufferPool else {
        throw makeError(3, "The video writer did not create a pixel buffer pool")
    }

    let frameCount = Int(ceil(duration * Double(fps)))
    for frame in 0..<frameCount {
        while !input.isReadyForMoreMediaData {
            Thread.sleep(forTimeInterval: 0.001)
        }
        var maybeBuffer: CVPixelBuffer?
        let result = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer)
        guard result == kCVReturnSuccess, let buffer = maybeBuffer else {
            throw makeError(4, "Could not allocate video frame \(frame)")
        }
        CVBufferSetAttachment(
            buffer,
            kCVImageBufferColorPrimariesKey,
            kCVImageBufferColorPrimaries_ITU_R_709_2,
            .shouldPropagate
        )
        CVBufferSetAttachment(
            buffer,
            kCVImageBufferTransferFunctionKey,
            kCVImageBufferTransferFunction_ITU_R_709_2,
            .shouldPropagate
        )
        CVBufferSetAttachment(
            buffer,
            kCVImageBufferYCbCrMatrixKey,
            kCVImageBufferYCbCrMatrix_ITU_R_709_2,
            .shouldPropagate
        )
        let frameSeconds = Double(frame) / Double(fps)
        renderFrame(
            into: buffer,
            time: frameSeconds,
            duration: duration,
            slides: slides,
            captures: captures,
            icon: icon,
            shots: shots,
            cues: cues
        )
        let frameTime = CMTime(value: CMTimeValue(frame), timescale: fps)
        guard adaptor.append(buffer, withPresentationTime: frameTime) else {
            throw writer.error ?? makeError(5, "Could not append video frame \(frame)")
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
        throw writer.error ?? makeError(6, "The silent video export did not complete")
    }
}

private func combine(
    videoURL: URL,
    sections: [AudioSection],
    outputURL: URL
) throws {
    let videoAsset = AVURLAsset(url: videoURL)
    guard let videoTrack = videoAsset.tracks(withMediaType: .video).first else {
        throw makeError(7, "The silent export does not contain a video track")
    }

    let composition = AVMutableComposition()
    guard let compositionVideo = composition.addMutableTrack(
        withMediaType: .video,
        preferredTrackID: kCMPersistentTrackID_Invalid
    ), let compositionAudio = composition.addMutableTrack(
        withMediaType: .audio,
        preferredTrackID: kCMPersistentTrackID_Invalid
    ) else {
        throw makeError(8, "Could not create final composition tracks")
    }

    try compositionVideo.insertTimeRange(
        CMTimeRange(start: .zero, duration: videoAsset.duration),
        of: videoTrack,
        at: .zero
    )

    for section in sections {
        try compositionAudio.insertTimeRange(
            section.track.timeRange,
            of: section.track,
            at: CMTime(seconds: section.audioStart, preferredTimescale: 600)
        )
    }

    let audioParameters = AVMutableAudioMixInputParameters(track: compositionAudio)
    for section in sections {
        let fade = min(0.08, section.duration / 4)
        let start = CMTime(seconds: section.audioStart, preferredTimescale: 600)
        let fadeDuration = CMTime(seconds: fade, preferredTimescale: 600)
        let fadeOutStart = CMTime(seconds: max(section.audioStart, section.audioEnd - fade), preferredTimescale: 600)
        audioParameters.setVolumeRamp(
            fromStartVolume: 0,
            toEndVolume: narrationVolume,
            timeRange: CMTimeRange(start: start, duration: fadeDuration)
        )
        audioParameters.setVolume(narrationVolume, at: CMTimeAdd(start, fadeDuration))
        audioParameters.setVolumeRamp(
            fromStartVolume: narrationVolume,
            toEndVolume: 0,
            timeRange: CMTimeRange(start: fadeOutStart, duration: fadeDuration)
        )
    }
    let audioMix = AVMutableAudioMix()
    audioMix.inputParameters = [audioParameters]

    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
        throw makeError(9, "Could not create the final export session")
    }
    exporter.outputURL = outputURL
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    exporter.audioMix = audioMix
    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously { semaphore.signal() }
    semaphore.wait()
    guard exporter.status == .completed else {
        throw exporter.error ?? makeError(10, "The final export did not complete")
    }
}

private func ttsExpandedText(_ text: String) -> String {
    [
        ("1960", "nineteen sixty"),
        ("Willys", "Willis"),
        ("DJ-3A", "D J three A"),
        ("GPT-5.6", "G P T five point six"),
        ("OpenAI", "Open A I"),
        ("MCP", "M C P"),
        ("SUV", "S U V"),
        ("iOS", "eye oh ess"),
        ("AI", "A I"),
    ].reduce(text) { result, replacement in
        result.replacingOccurrences(of: replacement.0, with: replacement.1)
    }
}

private func captionWeight(_ phrase: CaptionPhrase) -> Double {
    let text = phrase.spoken
    let words = text.split(whereSeparator: { $0.isWhitespace }).count
    var weight = Double(max(1, words))
    weight += 1.5 * Double(text.filter { ".?!".contains($0) }.count)
    weight += 0.4 * Double(text.filter { ",;:".contains($0) }.count)
    return weight
}

private func buildCues(sections: [AudioSection]) -> [Cue] {
    sections.flatMap { section in
        let weights = section.spec.captions.map(captionWeight)
        let totalWeight = max(1, weights.reduce(0, +))
        var cursor = section.audioStart
        return section.spec.captions.enumerated().map { index, phrase in
            let end = index == section.spec.captions.count - 1
                ? section.audioEnd
                : cursor + section.duration * weights[index] / totalWeight
            defer { cursor = end }
            return Cue(start: cursor, end: end, text: phrase.display)
        }
    }
}

private func buildShots(sections: [AudioSection], finalDuration: Double) -> [Shot] {
    sections.enumerated().flatMap { index, section in
        let visualStart = index == 0 ? 0 : section.audioStart
        let visualEnd = index + 1 < sections.count
            ? sections[index + 1].audioStart
            : finalDuration
        let visualDuration = visualEnd - visualStart
        return section.spec.shots.map { spec in
            Shot(
                start: visualStart + visualDuration * spec.startFraction,
                end: visualStart + visualDuration * spec.endFraction,
                visual: spec.visual,
                label: spec.label,
                zoom: spec.zoom
            )
        }
    }
}

private func formatSRTTime(_ time: Double) -> String {
    let totalMilliseconds = max(0, Int((time * 1000).rounded()))
    let milliseconds = totalMilliseconds % 1000
    let totalSeconds = totalMilliseconds / 1000
    let seconds = totalSeconds % 60
    let totalMinutes = totalSeconds / 60
    let minutes = totalMinutes % 60
    let hours = totalMinutes / 60
    return String(format: "%02d:%02d:%02d,%03d", hours, minutes, seconds, milliseconds)
}

private func writeSRT(_ cues: [Cue], to url: URL) throws {
    let text = cues.enumerated().map { index, cue in
        "\(index + 1)\n\(formatSRTTime(cue.start)) --> \(formatSRTTime(cue.end))\n\(cue.text)"
    }.joined(separator: "\n\n") + "\n"
    try text.write(to: url, atomically: true, encoding: .utf8)
}

private func discoverAudioURLs(directory: URL) throws -> [URL] {
    return try sectionSpecs.map { spec in
        let url = directory.appendingPathComponent(spec.audioFileName)
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw makeError(
                11,
                "Missing required Chris narration section: \(url.path)"
            )
        }
        return url
    }
}

private func loadAudioSections(directory: URL) throws -> [AudioSection] {
    let urls = try discoverAudioURLs(directory: directory)
    var cursor = openingLead
    var sections: [AudioSection] = []
    for (index, url) in urls.enumerated() {
        let asset = AVURLAsset(url: url)
        guard let track = asset.tracks(withMediaType: .audio).first else {
            throw makeError(12, "Missing audio track in \(url.lastPathComponent)")
        }
        let duration = seconds(track.timeRange.duration)
        guard duration > 1 else {
            throw makeError(13, "Audio section \(url.lastPathComponent) is only \(duration)s")
        }
        sections.append(
            AudioSection(
                spec: sectionSpecs[index],
                asset: asset,
                track: track,
                duration: duration,
                audioStart: cursor
            )
        )
        cursor += duration
        if index < urls.count - 1 {
            cursor += sectionGap
        }
    }
    return sections
}

private func loadImage(_ url: URL, description: String) throws -> NSImage {
    guard FileManager.default.fileExists(atPath: url.path), let image = NSImage(contentsOf: url) else {
        throw makeError(14, "Missing or unreadable \(description): \(url.path)")
    }
    return image
}

private func main() throws {
    let arguments = CommandLine.arguments
    guard arguments.count == 5 else {
        fputs(
            "usage: build_final_cut <repo-root> <chris-sections-dir> <captures-dir> <output-mp4>\n",
            stderr
        )
        exit(2)
    }

    let root = URL(fileURLWithPath: arguments[1], isDirectory: true)
    let audioDirectory = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let capturesDirectory = URL(fileURLWithPath: arguments[3], isDirectory: true)
    let outputURL = URL(fileURLWithPath: arguments[4])
    let outputDirectory = outputURL.deletingLastPathComponent()

    guard FileManager.default.fileExists(atPath: outputDirectory.path) else {
        throw makeError(15, "Output directory does not exist: \(outputDirectory.path)")
    }

    let sections = try loadAudioSections(directory: audioDirectory)
    guard let lastSection = sections.last else {
        throw makeError(16, "No narration sections were loaded")
    }
    let finalDuration = lastSection.audioEnd + closingTail
    guard finalDuration < maximumDuration else {
        throw makeError(
            17,
            String(
                format: "Final duration %.3fs exceeds the %.1fs safety ceiling; shorten or regenerate narration",
                finalDuration,
                maximumDuration
            )
        )
    }

    let slideNumbers = [1, 2, 7]
    var slides: [Int: NSImage] = [:]
    for number in slideNumbers {
        let name = String(format: "slide-%02d.png", number)
        let url = root.appendingPathComponent("docs/build-week/deck-preview/\(name)")
        slides[number] = try loadImage(url, description: name)
    }

    let captureNames = [
        "web/proof.png",
        "web/teach.png",
        "web/research.png",
        "web/review.png",
        "web/learn.png",
        "ios/taste-onboarding-step1.png",
        "ios/taste-onboarding-calibrate.png",
        "ios/desktop-codex-handoff.png",
    ]
    var captures: [String: NSImage] = [:]
    for name in captureNames {
        captures[name] = try loadImage(
            capturesDirectory.appendingPathComponent(name),
            description: "capture \(name)"
        )
    }

    let icon = try loadImage(
        root.appendingPathComponent("assets/brand/beachcar-icon.png"),
        description: "generated Beachcar icon"
    )
    let cues = buildCues(sections: sections)
    let shots = buildShots(sections: sections, finalDuration: finalDuration)

    let temporaryDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    let renderID = UUID().uuidString
    let silentURL = temporaryDirectory.appendingPathComponent("beachcar-final-silent-\(renderID).mp4")
    let muxedURL = outputDirectory.appendingPathComponent(".beachcar-final-\(renderID).mp4")
    defer {
        try? FileManager.default.removeItem(at: silentURL)
        try? FileManager.default.removeItem(at: muxedURL)
    }

    print(String(format: "narration sections=%d final target=%.3fs", sections.count, finalDuration))
    try makeSilentVideo(
        outputURL: silentURL,
        duration: finalDuration,
        slides: slides,
        captures: captures,
        icon: icon,
        shots: shots,
        cues: cues
    )
    try combine(videoURL: silentURL, sections: sections, outputURL: muxedURL)

    if FileManager.default.fileExists(atPath: outputURL.path) {
        try FileManager.default.removeItem(at: outputURL)
    }
    try FileManager.default.moveItem(at: muxedURL, to: outputURL)

    let srtURL = outputURL.deletingPathExtension().appendingPathExtension("srt")
    try writeSRT(cues, to: srtURL)
    print("wrote \(outputURL.path)")
    print("wrote \(srtURL.path)")
}

do {
    try main()
} catch {
    let nsError = error as NSError
    fputs(
        "error: \(nsError.domain) \(nsError.code) \(nsError.localizedDescription) \(nsError.userInfo)\n",
        stderr
    )
    exit(1)
}
