import AppKit
import AVFoundation
import CoreMedia
import Foundation

private func seconds(_ time: CMTime) -> Double {
    let value = CMTimeGetSeconds(time)
    return value.isFinite ? value : 0
}

private func audioLevel(asset: AVAsset, track: AVAssetTrack) throws -> (peak: Int, rms: Double, samples: Int) {
    let reader = try AVAssetReader(asset: asset)
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
    ]
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    guard reader.canAdd(output) else {
        throw NSError(domain: "BeachcarMediaInspection", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not decode audio"])
    }
    reader.add(output)
    guard reader.startReading() else {
        throw reader.error ?? NSError(domain: "BeachcarMediaInspection", code: 2, userInfo: nil)
    }

    var peak = 0
    var sumSquares = 0.0
    var samples = 0
    while let sampleBuffer = output.copyNextSampleBuffer() {
        guard let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { continue }
        var lengthAtOffset = 0
        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            block,
            atOffset: 0,
            lengthAtOffsetOut: &lengthAtOffset,
            totalLengthOut: &totalLength,
            dataPointerOut: &dataPointer
        )
        guard status == kCMBlockBufferNoErr, let dataPointer else { continue }
        let raw = UnsafeRawPointer(dataPointer)
        let count = totalLength / MemoryLayout<Int16>.size
        for index in 0..<count {
            let value = Int(raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))
            let magnitude = abs(value)
            peak = max(peak, magnitude)
            sumSquares += Double(value * value)
        }
        samples += count
    }
    let rms = samples > 0 ? sqrt(sumSquares / Double(samples)) : 0
    return (peak, rms, samples)
}

private func saveFrame(generator: AVAssetImageGenerator, time: Double, url: URL) throws {
    let image = try generator.copyCGImage(
        at: CMTime(seconds: time, preferredTimescale: 600),
        actualTime: nil
    )
    let representation = NSBitmapImageRep(cgImage: image)
    guard let data = representation.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "BeachcarMediaInspection", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not encode frame"])
    }
    try data.write(to: url)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fputs("usage: inspect_media <input-mp4> <frames-directory>\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: arguments[1])
let framesURL = URL(fileURLWithPath: arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: framesURL, withIntermediateDirectories: true)

let asset = AVURLAsset(url: inputURL)
let duration = seconds(asset.duration)
guard let videoTrack = asset.tracks(withMediaType: .video).first,
      let audioTrack = asset.tracks(withMediaType: .audio).first else {
    fputs("error: expected one video and one audio track\n", stderr)
    exit(1)
}

let levels = try audioLevel(asset: asset, track: audioTrack)
let dimensions = videoTrack.naturalSize.applying(videoTrack.preferredTransform)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let requestedTimes: [Double] = [3, 20, 36, 54, 72, 91, 108, 126, 145, max(0, duration - 2)]
for (index, time) in requestedTimes.enumerated() where time < duration {
    let name = String(format: "frame-%02d-%06.2fs.png", index + 1, time)
    try saveFrame(generator: generator, time: time, url: framesURL.appendingPathComponent(name))
}

print(String(format: "duration=%.3f", duration))
print("video=H.264 \(Int(abs(dimensions.width)))x\(Int(abs(dimensions.height))) fps=\(String(format: "%.3f", videoTrack.nominalFrameRate))")
print("audio=AAC peak=\(levels.peak) rms=\(String(format: "%.2f", levels.rms)) samples=\(levels.samples)")
print("frames=\(requestedTimes.filter { $0 < duration }.count) directory=\(framesURL.path)")
