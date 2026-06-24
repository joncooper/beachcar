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
  private var tapInstalled = false

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
    stop()

    let authorization = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status)
      }
    }
    guard authorization == .authorized else {
      throw SpeechError.notAuthorized
    }
    let microphoneAuthorized = await requestMicrophonePermission()
    guard microphoneAuthorized else {
      throw SpeechError.microphoneNotAuthorized
    }
    guard recognizer?.isAvailable == true else {
      throw SpeechError.unavailable
    }

    transcript = ""
    errorMessage = nil

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    self.request = request

    let input = audioEngine.inputNode
    let format = input.inputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw SpeechError.audioInputUnavailable
    }

    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
      request?.append(buffer)
    }
    tapInstalled = true

    audioEngine.prepare()

    task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
      Task { @MainActor in
        guard let self else { return }
        if let result {
          self.transcript = result.bestTranscription.formattedString
        }
        if let error {
          self.errorMessage = error.localizedDescription
          self.stop()
        } else if result?.isFinal == true {
          self.stop()
        }
      }
    }

    try audioEngine.start()
    isRecording = true
  }

  func stop() {
    if audioEngine.isRunning {
      audioEngine.stop()
    }
    if tapInstalled {
      audioEngine.inputNode.removeTap(onBus: 0)
      tapInstalled = false
    }
    request?.endAudio()
    request = nil
    task?.cancel()
    task = nil
    isRecording = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func requestMicrophonePermission() async -> Bool {
    await withCheckedContinuation { continuation in
      AVAudioSession.sharedInstance().requestRecordPermission { allowed in
        continuation.resume(returning: allowed)
      }
    }
  }
}

enum SpeechError: LocalizedError {
  case notAuthorized
  case microphoneNotAuthorized
  case unavailable
  case audioInputUnavailable

  var errorDescription: String? {
    switch self {
    case .notAuthorized: "Speech recognition is not authorized."
    case .microphoneNotAuthorized: "Microphone access is not authorized."
    case .unavailable: "Speech recognition is not available right now."
    case .audioInputUnavailable: "Microphone input is not available right now."
    }
  }
}
