import AppKit
import AVFoundation
import CoreMedia
import CoreVideo
import Foundation

private let width = 1920
private let height = 1080
private let fps: Int32 = 30
private let openingLead = 2.0
private let sectionGap = 0.15
private let closingTail = 4.0
private let minimumDuration = 90.0
private let maximumDuration = 120.0
private let narrationVolume: Float = 0.95

private let ink = NSColor(calibratedRed: 8 / 255, green: 10 / 255, blue: 11 / 255, alpha: 1)
private let paper = NSColor(calibratedRed: 247 / 255, green: 242 / 255, blue: 232 / 255, alpha: 1)
private let pink = NSColor(calibratedRed: 239 / 255, green: 75 / 255, blue: 137 / 255, alpha: 1)

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
    case brand
    case endBrand
    case ownerPhoto(String)
    case capture(String, ImageFit)
    case opinionBoard
    case workingReplay(String, Int)
}

private struct ShotSpec {
    let startFraction: Double
    let endFraction: Double
    let visual: Visual
    let label: String?
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
    let label: String?
    let zoom: CGFloat
}

private let sectionSpecs: [SectionSpec] = [
    SectionSpec(
        audioFileName: "01-found.mp3",
        captions: [
            CaptionPhrase("Beachcar. Your Codex. Your taste. Your car."),
            CaptionPhrase("I live in a tiny beach town."),
            CaptionPhrase("All summer, I'm running my kids one or two miles at a time—to the beach, camp, friends, ice cream."),
            CaptionPhrase("I wanted a beach car: open, simple, weird, and unlike anything else in town."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.16, visual: .brand, label: nil, zoom: 0),
            ShotSpec(startFraction: 0.16, endFraction: 0.40, visual: .ownerPhoto("owner/03"), label: "SMALL BEACH TOWN · ONE- OR TWO-MILE SUMMERS", zoom: 0.016),
            ShotSpec(startFraction: 0.40, endFraction: 0.62, visual: .ownerPhoto("owner/07"), label: nil, zoom: 0.014),
            ShotSpec(startFraction: 0.62, endFraction: 0.82, visual: .ownerPhoto("owner/06"), label: nil, zoom: 0.014),
            ShotSpec(startFraction: 0.82, endFraction: 1, visual: .ownerPhoto("owner/04"), label: nil, zoom: 0.016),
        ]
    ),
    SectionSpec(
        audioFileName: "02-taste.mp3",
        captions: [
            CaptionPhrase("But I didn't know what it was called."),
            CaptionPhrase("I didn't even know it existed."),
            CaptionPhrase("Most car sites make you name the answer before they'll help you search."),
            CaptionPhrase("So I built Beachcar to start with the feeling."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.34, visual: .ownerPhoto("owner/07"), label: "START WITH THE FEELING", zoom: 0.016),
            ShotSpec(startFraction: 0.34, endFraction: 0.67, visual: .ownerPhoto("owner/03"), label: nil, zoom: 0.016),
            ShotSpec(startFraction: 0.67, endFraction: 1, visual: .ownerPhoto("owner/04"), label: nil, zoom: 0.016),
        ]
    ),
    SectionSpec(
        audioFileName: "03-agent.mp3",
        captions: [
            CaptionPhrase("I tell it what I like, and my Codex goes hunting from my Mac."),
            CaptionPhrase("It opens the browser I'm already signed into, digs through listings, throws away the noise,"),
            CaptionPhrase("and comes back with a few actual opinions:"),
            CaptionPhrase("this one fits, this one's overpriced, this one could ruin my summer."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.24, visual: .capture("ios/taste-onboarding-step1.png", .contain), label: "TELL IT WHAT YOU LOVE", zoom: 0.005),
            ShotSpec(startFraction: 0.24, endFraction: 0.48, visual: .capture("ios/taste-onboarding-calibrate.png", .contain), label: "YOUR CODEX GOES HUNTING", zoom: 0.005),
            ShotSpec(startFraction: 0.48, endFraction: 1, visual: .opinionBoard, label: nil, zoom: 0),
        ]
    ),
    SectionSpec(
        audioFileName: "04-gpt.mp3",
        captions: [
            CaptionPhrase("For a couple of weeks, I kept using it and teaching it:"),
            CaptionPhrase("more charm, less precious; more beach day, less car show."),
            CaptionPhrase("Then this appeared—a 1960 Willys Surrey that looks like a Jeep, a golf cart,"),
            CaptionPhrase("and a beach umbrella somehow became one car."),
            CaptionPhrase("I bought it."),
            CaptionPhrase("This is actually my car now."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.38, visual: .ownerPhoto("owner/03"), label: "MORE BEACH DAY · LESS CAR SHOW", zoom: 0.016),
            ShotSpec(startFraction: 0.38, endFraction: 0.64, visual: .ownerPhoto("owner/01"), label: "THEN THIS APPEARED", zoom: 0.020),
            ShotSpec(startFraction: 0.64, endFraction: 0.76, visual: .ownerPhoto("owner/02"), label: nil, zoom: 0.016),
            ShotSpec(startFraction: 0.76, endFraction: 0.87, visual: .ownerPhoto("owner/05"), label: "I BOUGHT IT", zoom: 0.014),
            ShotSpec(startFraction: 0.87, endFraction: 1, visual: .ownerPhoto("owner/08"), label: nil, zoom: 0.014),
        ]
    ),
    SectionSpec(
        audioFileName: "05-garage.mp3",
        captions: [
            CaptionPhrase("GPT-5.6 gives Codex the judgment to do that hunt,"),
            CaptionPhrase("and Codex helped me build Beachcar too—the iPhone experience, the way it searches, even this film."),
            CaptionPhrase("If you opt in, your Codex can also take a weekly Garage Session to improve Beachcar itself."),
            CaptionPhrase("You see every change first."),
            CaptionPhrase("Nothing ships without you."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.22, visual: .ownerPhoto("owner/06"), label: nil, zoom: 0.014),
            ShotSpec(startFraction: 0.22, endFraction: 0.41, visual: .workingReplay("demo/teach.jpg", 0), label: nil, zoom: 0),
            ShotSpec(startFraction: 0.41, endFraction: 0.58, visual: .workingReplay("demo/research.jpg", 1), label: nil, zoom: 0),
            ShotSpec(startFraction: 0.58, endFraction: 0.72, visual: .ownerPhoto("owner/07"), label: "YOUR CODEX CAN IMPROVE BEACHCAR", zoom: 0.016),
            ShotSpec(startFraction: 0.72, endFraction: 1, visual: .ownerPhoto("owner/04"), label: "YOU SEE IT FIRST · NOTHING SHIPS WITHOUT YOU", zoom: 0.018),
        ]
    ),
    SectionSpec(
        audioFileName: "06-close.mp3",
        captions: [
            CaptionPhrase("I built Beachcar to find one weird little car for my family."),
            CaptionPhrase("Now your Codex can go looking for yours."),
            CaptionPhrase("Beachcar. Your Codex. Your taste. Your car."),
        ],
        shots: [
            ShotSpec(startFraction: 0, endFraction: 0.34, visual: .ownerPhoto("owner/02"), label: nil, zoom: 0.014),
            ShotSpec(startFraction: 0.34, endFraction: 0.66, visual: .ownerPhoto("owner/08"), label: "YOUR CODEX CAN GO LOOKING FOR YOURS", zoom: 0.016),
            ShotSpec(startFraction: 0.66, endFraction: 1, visual: .endBrand, label: nil, zoom: 0),
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

private func strokeRoundedRect(
    _ rect: NSRect,
    radius: CGFloat,
    color: NSColor,
    lineWidth: CGFloat
) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    path.lineWidth = lineWidth
    color.setStroke()
    path.stroke()
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
    let source = NSRect(origin: .zero, size: image.size)
    let destination = aspectRect(
        imageSize: source.size,
        canvas: canvas,
        fit: fit,
        progress: progress,
        zoomAmount: zoomAmount
    )
    image.draw(
        in: destination,
        from: source,
        operation: .sourceOver,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )
}

private func drawCroppedImage(
    _ image: NSImage,
    in canvas: NSRect,
    radius: CGFloat,
    progress: CGFloat = 0.5,
    zoomAmount: CGFloat = 0.01
) {
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }

    NSBezierPath(roundedRect: canvas, xRadius: radius, yRadius: radius).addClip()
    let source = NSRect(origin: .zero, size: image.size)
    let destination = aspectRect(
        imageSize: source.size,
        canvas: canvas,
        fit: .fill,
        progress: progress,
        zoomAmount: zoomAmount
    )
    image.draw(
        in: destination,
        from: source,
        operation: .sourceOver,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )
}

private func drawOpinionBoard(
    ownerPhotos: [String: NSImage],
    progress: CGFloat
) {
    ink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()

    drawText(
        "A FEW ACTUAL OPINIONS",
        rect: NSRect(x: 192, y: 888, width: 1120, height: 64),
        font: .systemFont(ofSize: 46, weight: .black),
        color: paper
    )
    drawText(
        "NOT ANOTHER WALL OF LISTINGS",
        rect: NSRect(x: 1230, y: 905, width: 498, height: 34),
        font: .monospacedSystemFont(ofSize: 20, weight: .bold),
        color: pink,
        alignment: .right
    )

    let cardWidth: CGFloat = 560
    let cardHeight: CGFloat = 540
    let cardY: CGFloat = 294
    let cardX: [CGFloat] = [84, 680, 1276]
    let imageNames = ["owner/03", "owner/04", "owner/06"]
    let chips = ["FIT", "PRICE", "SUMMER"]
    let headlines = ["THIS ONE FITS.", "OVERPRICED?", "SUMMER RISK?"]
    let details = [
        "open · simple · weird",
        "beautiful isn't the same as worth it",
        "parts · weather · impractical surprises",
    ]

    let activeIndex: Int? = {
        if progress < 0.48 { return nil }
        if progress < 0.65 { return 0 }
        if progress < 0.81 { return 1 }
        return 2
    }()

    for index in 0..<3 {
        let rect = NSRect(x: cardX[index], y: cardY, width: cardWidth, height: cardHeight)
        roundedRect(rect, radius: 28, color: paper)

        if let image = ownerPhotos[imageNames[index]] {
            drawCroppedImage(
                image,
                in: NSRect(x: rect.minX + 12, y: rect.minY + 270, width: cardWidth - 24, height: 258),
                radius: 20,
                progress: 0.5,
                zoomAmount: 0.012
            )
        }

        let isActive = activeIndex == index
        roundedRect(
            NSRect(x: rect.minX + 26, y: rect.minY + 214, width: 120, height: 36),
            radius: 18,
            color: isActive ? pink : ink
        )
        drawText(
            chips[index],
            rect: NSRect(x: rect.minX + 26, y: rect.minY + 221, width: 120, height: 23),
            font: .monospacedSystemFont(ofSize: 17, weight: .bold),
            color: isActive ? ink : paper,
            alignment: .center
        )
        drawText(
            headlines[index],
            rect: NSRect(x: rect.minX + 26, y: rect.minY + 126, width: cardWidth - 52, height: 72),
            font: .systemFont(ofSize: 43, weight: .black),
            color: ink
        )
        drawText(
            details[index],
            rect: NSRect(x: rect.minX + 26, y: rect.minY + 53, width: cardWidth - 52, height: 66),
            font: .systemFont(ofSize: 23, weight: .semibold),
            color: NSColor(calibratedWhite: 0.25, alpha: 1),
            lineSpacing: 3
        )
        strokeRoundedRect(
            rect.insetBy(dx: 2, dy: 2),
            radius: 27,
            color: isActive ? pink : NSColor(calibratedWhite: 0.35, alpha: 1),
            lineWidth: isActive ? 7 : 2
        )
    }
}

private func drawWorkingReplay(
    _ capture: NSImage,
    stage: Int,
    progress: CGFloat
) {
    drawImage(capture, fit: .fill, progress: 0.5, zoomAmount: 0)

    if stage == 1, progress < 0.16 {
        let fade = max(0, 0.16 - progress) / 0.16
        paper.withAlphaComponent(0.22 * fade).setFill()
        NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    }

    // The captures already identify themselves as a deterministic replay.
    // Keep their upper copy unobstructed instead of adding a second label layer.
    let clickPoint = stage == 0
        ? NSPoint(x: 422, y: 62)
        : NSPoint(x: 615, y: 62)
    let clickPhase = min(1, progress * 4)
    let clickRadius = 18 + 38 * clickPhase
    let clickAlpha = max(0.15, 0.9 * (1 - clickPhase))
    let clickPath = NSBezierPath(
        ovalIn: NSRect(
            x: clickPoint.x - clickRadius,
            y: clickPoint.y - clickRadius,
            width: clickRadius * 2,
            height: clickRadius * 2
        )
    )
    clickPath.lineWidth = 6
    pink.withAlphaComponent(clickAlpha).setStroke()
    clickPath.stroke()

    let pointer = NSBezierPath()
    pointer.move(to: NSPoint(x: clickPoint.x - 7, y: clickPoint.y + 14))
    pointer.line(to: NSPoint(x: clickPoint.x + 13, y: clickPoint.y - 12))
    pointer.line(to: NSPoint(x: clickPoint.x + 4, y: clickPoint.y - 9))
    pointer.line(to: NSPoint(x: clickPoint.x + 1, y: clickPoint.y - 19))
    pointer.close()
    paper.setFill()
    pointer.fill()
    pointer.lineWidth = 2
    ink.setStroke()
    pointer.stroke()
}

private func drawBrand(endCard: Bool = false) {
    paper.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: height - 12, width: width, height: 12)).fill()

    drawText(
        "BEACHCAR",
        rect: NSRect(x: 160, y: 536, width: 1600, height: 190),
        font: .systemFont(ofSize: 154, weight: .black),
        color: ink,
        alignment: .center
    )
    drawText(
        "your codex - your taste - your car",
        rect: NSRect(x: 240, y: 444, width: 1440, height: 68),
        font: .systemFont(ofSize: 42, weight: .semibold),
        color: pink,
        alignment: .center
    )

    if endCard {
        roundedRect(
            NSRect(x: 650, y: 338, width: 620, height: 68),
            radius: 34,
            color: ink
        )
        drawText(
            "APPS FOR YOUR LIFE",
            rect: NSRect(x: 674, y: 354, width: 572, height: 36),
            font: .monospacedSystemFont(ofSize: 28, weight: .bold),
            color: pink,
            alignment: .center
        )
    }
}

private func addOverlay(label: String?, caption: String?, progress: CGFloat) {
    pink.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: CGFloat(height) - 8, width: CGFloat(width) * progress, height: 8)).fill()

    if let label, !label.isEmpty {
        roundedRect(
            NSRect(x: 192, y: 894, width: 760, height: 60),
            radius: 30,
            color: NSColor(calibratedWhite: 0.03, alpha: 0.88)
        )
        drawText(
            label,
            rect: NSRect(x: 224, y: 910, width: 696, height: 34),
            font: .monospacedSystemFont(ofSize: 22, weight: .bold),
            color: pink
        )
    }

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
    ownerPhotos: [String: NSImage],
    captures: [String: NSImage],
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
    case .brand:
        drawBrand()
    case .endBrand:
        drawBrand(endCard: true)
    case let .ownerPhoto(name):
        if let photo = ownerPhotos[name] {
            drawImage(photo, fit: .fill, progress: shotProgress, zoomAmount: shot.zoom)
        }
    case let .capture(name, fit):
        if let capture = captures[name] {
            drawImage(capture, fit: fit, progress: shotProgress, zoomAmount: shot.zoom)
        }
    case .opinionBoard:
        drawOpinionBoard(ownerPhotos: ownerPhotos, progress: shotProgress)
    case let .workingReplay(name, stage):
        if let capture = captures[name] {
            drawWorkingReplay(capture, stage: stage, progress: shotProgress)
        }
    }

    let caption = cues.first(where: { time >= $0.start && time < $0.end })?.text
    addOverlay(label: shot.label, caption: caption, progress: CGFloat(time / duration))
}

private func makeSilentVideo(
    outputURL: URL,
    duration: Double,
    ownerPhotos: [String: NSImage],
    captures: [String: NSImage],
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
            ownerPhotos: ownerPhotos,
            captures: captures,
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
        // ElevenLabs inserts expressive pauses in this reveal section. These measured
        // speech onsets keep the burned-in/SRT reveal and purchase beats aligned with
        // Chris rather than distributing them by word count.
        if section.spec.audioFileName == "04-gpt.mp3" {
            let phraseOnsets = [0.0, 4.578, 7.224, 12.811, 14.929, 16.584]
            precondition(phraseOnsets.count == section.spec.captions.count)
            return section.spec.captions.enumerated().map { index, phrase in
                let start = section.audioStart + phraseOnsets[index]
                let end = index + 1 < phraseOnsets.count
                    ? section.audioStart + phraseOnsets[index + 1]
                    : section.audioEnd
                return Cue(start: start, end: end, text: phrase.display)
            }
        }

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

private func loadOwnerPhotos(directory: URL) throws -> [String: NSImage] {
    let allowedExtensions = Set(["jpg", "jpeg", "png", "heic"])
    let urls = try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
    ).filter { url in
        guard allowedExtensions.contains(url.pathExtension.lowercased()) else { return false }
        return (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    }.sorted { left, right in
        left.lastPathComponent.localizedStandardCompare(right.lastPathComponent) == .orderedAscending
    }

    guard (6...8).contains(urls.count) else {
        throw makeError(
            15,
            "Expected 6 to 8 permission-cleared owner-car photos in \(directory.path); found \(urls.count)"
        )
    }

    let images = try urls.map { url in
        try loadImage(url, description: "permission-cleared owner-car photo \(url.lastPathComponent)")
    }
    var photos: [String: NSImage] = [:]
    for (index, image) in images.enumerated() {
        photos[String(format: "owner/%02d", index + 1)] = image
    }
    if images.count == 6 {
        photos["owner/07"] = images[2]
        photos["owner/08"] = images[0]
    } else if images.count == 7 {
        photos["owner/08"] = images[0]
    }
    return photos
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

    var rootIsDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: root.path, isDirectory: &rootIsDirectory), rootIsDirectory.boolValue else {
        throw makeError(16, "Repository root does not exist: \(root.path)")
    }
    guard FileManager.default.fileExists(atPath: outputDirectory.path) else {
        throw makeError(17, "Output directory does not exist: \(outputDirectory.path)")
    }

    let sections = try loadAudioSections(directory: audioDirectory)
    guard let lastSection = sections.last else {
        throw makeError(18, "No narration sections were loaded")
    }
    let finalDuration = lastSection.audioEnd + closingTail
    guard finalDuration >= minimumDuration else {
        throw makeError(
            19,
            String(
                format: "Final duration %.3fs is below the %.1fs story floor; check that the complete narration was supplied",
                finalDuration,
                minimumDuration
            )
        )
    }
    guard finalDuration <= maximumDuration else {
        throw makeError(
            20,
            String(
                format: "Final duration %.3fs exceeds the %.1fs safety ceiling; shorten or regenerate narration",
                finalDuration,
                maximumDuration
            )
        )
    }

    let ownerPhotos = try loadOwnerPhotos(
        directory: capturesDirectory.appendingPathComponent("owner-car", isDirectory: true)
    )
    let captureNames = [
        "ios/taste-onboarding-step1.png",
        "ios/taste-onboarding-calibrate.png",
        "demo/teach.jpg",
        "demo/research.jpg",
    ]
    var captures: [String: NSImage] = [:]
    for name in captureNames {
        captures[name] = try loadImage(
            capturesDirectory.appendingPathComponent(name),
            description: "capture \(name)"
        )
    }

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
        ownerPhotos: ownerPhotos,
        captures: captures,
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
