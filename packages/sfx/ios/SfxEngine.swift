import AVFoundation
#if canImport(UIKit)
import UIKit
#endif

/// Plays the baked interface sounds through one AVAudioEngine.
///
/// - Memory: each sound is decoded once, on first use or preload(), into a float32 PCM buffer (mono unless
///   its recipe pans). Nothing else is allocated per sound. Buffers are dropped on a memory warning and
///   reload on their next play.
/// - Latency: play() is one synchronous hop onto a serial queue that schedules a buffer on an idle player
///   node. There is no seek, no file I/O after the first play, and no per-voice media player.
/// - Power: the engine pauses after `idleSeconds` of silence and restarts on the next sound.
///
/// All state lives on `queue`. AVAudioPlayerNode completion handlers hop back onto it asynchronously, so a
/// stop() that delivers them on the calling thread cannot deadlock.
final class SfxEngine {
  private final class Voice {
    let player = AVAudioPlayerNode()
    /// Varispeed voices exist only once a play asks for a rate other than 1; they route
    /// player → varispeed → mixer so that AVAudioMixing (volume, pan) still applies at a mixer input.
    let varispeed: AVAudioUnitVarispeed?
    let mixer: AVAudioMixerNode?
    let channels: AVAudioChannelCount
    /// 0 while idle; otherwise the id of the sound it is playing.
    var id = 0
    var startedAt: UInt64 = 0

    init(channels: AVAudioChannelCount, varispeed: Bool) {
      self.channels = channels
      self.varispeed = varispeed ? AVAudioUnitVarispeed() : nil
      self.mixer = varispeed ? AVAudioMixerNode() : nil
    }

    var mixing: AVAudioMixing { mixer ?? player }
    var nodes: [AVAudioNode] { [player, varispeed, mixer].compactMap { $0 } }
  }

  static let sampleRate = 48_000.0
  private static let idleSeconds = 3.0

  private let onVoiceEnded: (Int) -> Void
  private let queue = DispatchQueue(label: "com.bloxwap.sfx", qos: .userInteractive)
  private var engine: AVAudioEngine?
  private var buffers: [String: AVAudioPCMBuffer] = [:]
  private var voices: [Voice] = []
  private var maxVoices = 16
  private var manageSession = true
  private var sessionReady = false
  private var volume: Float = 1
  private var nextId = 1
  private var foreground = true
  private var idleCheck: DispatchWorkItem?
  private var observers: [NSObjectProtocol] = []
  private var engineObserver: NSObjectProtocol?
  private lazy var soundBundle: Bundle? = {
    for candidate in [Bundle(for: SfxEngine.self), Bundle.main] {
      if let url = candidate.url(forResource: "BloxwapSfx", withExtension: "bundle"), let bundle = Bundle(url: url) {
        return bundle
      }
    }
    return nil
  }()

  init(onVoiceEnded: @escaping (Int) -> Void = { _ in }) {
    self.onVoiceEnded = onVoiceEnded
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in
      // The media server restarted: every node is dead. Rebuild lazily on the next sound.
      self?.queue.async { self?.teardownEngine() }
    })
    #if canImport(UIKit)
    observers.append(center.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
      self?.queue.async { self?.buffers.removeAll() }
    })
    #endif
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
    engineObserver.map(NotificationCenter.default.removeObserver)
  }

  // MARK: - Settings

  func configure(maxVoices: Int, manageSession: Bool) {
    queue.sync {
      self.maxVoices = min(64, max(1, maxVoices))
      self.manageSession = manageSession
      while voices.count > self.maxVoices, let index = voices.firstIndex(where: { $0.id == 0 }) ?? voices.indices.first {
        detach(voices.remove(at: index))
      }
    }
  }

  func setVolume(_ value: Double) {
    queue.sync {
      volume = Float(min(1, max(0, value)))
      engine?.mainMixerNode.outputVolume = volume
    }
  }

  // MARK: - Loading

  /// Decodes `names` off the caller's queue, then stores them. Unknown names are skipped.
  func preload(_ names: [String]) -> Bool {
    queue.sync {
      var loaded = true
      for name in names { if buffer(name) == nil { loaded = false } }
      return loaded
    }
  }

  private func decode(_ name: String) -> AVAudioPCMBuffer? {
    // Names come from the JS catalog; refuse anything that could leave the bundle.
    guard !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }),
          let url = soundBundle?.url(forResource: name, withExtension: "wav"),
          let file = try? AVAudioFile(forReading: url, commonFormat: .pcmFormatFloat32, interleaved: false),
          let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
          (try? file.read(into: buffer)) != nil
    else { return nil }
    return buffer
  }

  private func buffer(_ name: String) -> AVAudioPCMBuffer? {
    if let cached = buffers[name] { return cached }
    // First play without preload: a few kilobytes from the app bundle, read once.
    let decoded = decode(name)
    buffers[name] = decoded
    return decoded
  }

  // MARK: - Engine

  private func running() -> AVAudioEngine? {
    if manageSession && !sessionReady {
      let session = AVAudioSession.sharedInstance()
      // Ambient: respects the silent switch and mixes with other apps' audio, like system UI sounds.
      do {
        try session.setCategory(.ambient, mode: .default, options: [])
        try session.setActive(true)
        sessionReady = true
      } catch { return nil }
    }
    let engine = self.engine ?? makeEngine()
    if !engine.isRunning {
      do {
        try engine.start()
      } catch {
        return nil
      }
    }
    return engine
  }

  private func makeEngine() -> AVAudioEngine {
    let engine = AVAudioEngine()
    engine.mainMixerNode.outputVolume = volume
    // Configuration changes (route change, sample rate change) stop the engine; running() restarts it.
    engineObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
      self?.queue.async { self?.stopAllLocked() }
    }
    self.engine = engine
    return engine
  }

  private func teardownEngine() {
    idleCheck?.cancel()
    idleCheck = nil
    if let engine {
      engine.stop()
      voices.forEach(detach)
    }
    voices.removeAll()
    engineObserver.map(NotificationCenter.default.removeObserver)
    engineObserver = nil
    engine = nil
    sessionReady = false
  }

  private func detach(_ voice: Voice) {
    guard let engine else { return }
    finish(voice)
    voice.player.stop()
    voice.nodes.forEach(engine.detach)
  }

  private func voice(channels: AVAudioChannelCount, varispeed: Bool, engine: AVAudioEngine) -> Voice {
    let matches = { (voice: Voice) in voice.channels == channels && (voice.varispeed != nil) == varispeed }
    if let idle = voices.first(where: { $0.id == 0 && matches($0) }) { return idle }
    if voices.count >= maxVoices {
      // Steal the oldest voice of the same shape, or recycle the oldest voice of any shape.
      if let oldest = voices.filter(matches).min(by: { $0.startedAt < $1.startedAt }) { return oldest }
      if let index = voices.indices.min(by: { voices[$0].startedAt < voices[$1].startedAt }) { detach(voices.remove(at: index)) }
    }
    let voice = Voice(channels: channels, varispeed: varispeed)
    let format = AVAudioFormat(standardFormatWithSampleRate: Self.sampleRate, channels: channels)!
    voice.nodes.forEach(engine.attach)
    if let varispeed = voice.varispeed, let mixer = voice.mixer {
      engine.connect(voice.player, to: varispeed, format: format)
      engine.connect(varispeed, to: mixer, format: format)
      engine.connect(mixer, to: engine.mainMixerNode, format: format)
    } else {
      engine.connect(voice.player, to: engine.mainMixerNode, format: format)
    }
    voices.append(voice)
    return voice
  }

  // MARK: - Playback

  /// Starts `name` and returns its voice id, or 0 when it was dropped.
  func play(_ name: String, gain: Double, pan: Double, rate: Double, delay: Double) -> Int {
    queue.sync {
      guard foreground, let buffer = buffer(name), let engine = running() else { return 0 }
      let rate = min(4, max(0.25, rate))
      let voice = voice(channels: buffer.format.channelCount, varispeed: rate != 1, engine: engine)
      let id = nextId
      nextId += 1
      finish(voice)
      voice.player.stop()
      voice.id = id
      voice.startedAt = mach_absolute_time()
      voice.mixing.volume = Float(min(2, max(0, gain)) / 2)
      voice.mixing.pan = Float(min(1, max(-1, pan)))
      voice.varispeed?.rate = Float(rate)
      voice.player.scheduleBuffer(buffer, at: nil, options: [], completionCallbackType: .dataPlayedBack) { [weak self, weak voice] _ in
        self?.queue.async {
          if let voice, voice.id == id { self?.finish(voice, stop: false) }
          self?.scheduleIdleCheck()
        }
      }
      let delay = min(10, max(0, delay))
      voice.player.play(at: delay > 0 ? AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: delay)) : nil)
      idleCheck?.cancel()
      idleCheck = nil
      return id
    }
  }

  func stop(_ id: Int) {
    queue.sync {
      guard let voice = voices.first(where: { $0.id == id }) else { return }
      finish(voice)
      scheduleIdleCheck()
    }
  }

  func stopAll() {
    queue.sync { stopAllLocked() }
  }

  private func finish(_ voice: Voice, stop: Bool = true) {
    let id = voice.id
    guard id != 0 else { return }
    voice.id = 0
    if stop { voice.player.stop() }
    onVoiceEnded(id)
  }

  private func stopAllLocked() {
    for voice in voices where voice.id != 0 {
      finish(voice)
    }
    scheduleIdleCheck()
  }

  func activeVoices() -> Int {
    queue.sync { voices.reduce(0) { $0 + ($1.id != 0 ? 1 : 0) } }
  }

  func unlock() -> Bool {
    queue.sync {
      guard foreground, running() != nil else { return false }
      scheduleIdleCheck()
      return true
    }
  }

  /// Pauses the engine once every voice has been idle for `idleSeconds`; pause keeps its resources, so the
  /// next sound restarts it in a few milliseconds.
  private func scheduleIdleCheck() {
    guard idleCheck == nil, voices.allSatisfy({ $0.id == 0 }) else { return }
    let check = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.idleCheck = nil
      if self.voices.allSatisfy({ $0.id == 0 }) { self.engine?.pause() }
    }
    idleCheck = check
    queue.asyncAfter(deadline: .now() + Self.idleSeconds, execute: check)
  }

  // MARK: - Lifecycle

  /// Nothing sounds or starts in the background.
  func enterBackground() {
    queue.sync {
      foreground = false
      stopAllLocked()
      idleCheck?.cancel()
      idleCheck = nil
      engine?.pause()
    }
  }

  func enterForeground() {
    queue.sync { foreground = true }
  }

  /// Frees the engine, its nodes and every decoded buffer.
  func dispose() {
    queue.sync {
      teardownEngine()
      buffers.removeAll()
    }
  }
}
