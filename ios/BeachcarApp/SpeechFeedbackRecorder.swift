import AVFoundation
import Foundation
import Speech

@MainActor
final class SpeechFeedbackRecorder: ObservableObject {
  @Published var transcript = ""
  @Published var isRecording = false
  @Published var errorMessage: String?

  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  func toggle() async {
    if isRecording {
      stop()
      return
    }

    do {
      try await start()
    } catch {
      errorMessage = error.localizedDescription
      stop()
    }
  }

  private func start() async throws {
    let authorization = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status)
      }
    }
    guard authorization == .authorized else {
      throw SpeechError.notAuthorized
    }
    guard recognizer?.isAvailable == true else {
      throw SpeechError.unavailable
    }

    transcript = ""
    errorMessage = nil
    task?.cancel()
    task = nil

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    self.request = request

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
      request?.append(buffer)
    }

    audioEngine.prepare()
    try audioEngine.start()
    isRecording = true

    task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
      Task { @MainActor in
        guard let self else { return }
        if let result {
          self.transcript = result.bestTranscription.formattedString
        }
        if error != nil || result?.isFinal == true {
          self.stop()
        }
      }
    }
  }

  func stop() {
    if audioEngine.isRunning {
      audioEngine.stop()
      audioEngine.inputNode.removeTap(onBus: 0)
    }
    request?.endAudio()
    request = nil
    task?.cancel()
    task = nil
    isRecording = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }
}

enum SpeechError: LocalizedError {
  case notAuthorized
  case unavailable

  var errorDescription: String? {
    switch self {
    case .notAuthorized: "Speech recognition is not authorized."
    case .unavailable: "Speech recognition is not available right now."
    }
  }
}
