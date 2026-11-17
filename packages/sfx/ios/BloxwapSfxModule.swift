import ExpoModulesCore

/// The JavaScript surface of SfxEngine (see src/native.ts). play() is a synchronous Function so it runs on
/// the JS thread inside the gesture, with no promise or main-thread hop.
public final class BloxwapSfxModule: Module {
  private lazy var engine = SfxEngine { [weak self] voice in
    self?.sendEvent("onVoiceEnded", ["voice": voice])
  }

  public func definition() -> ModuleDefinition {
    Name("BloxwapSfxEngine")
    Events("onVoiceEnded")

    Function("configure") { (maxVoices: Int, audioSession: String) in
      self.engine.configure(maxVoices: maxVoices, manageSession: audioSession != "manual")
    }

    // Decoding reads files, so it runs on the module's background queue.
    AsyncFunction("preload") { (names: [String]) in
      self.engine.preload(names)
    }

    Function("play") { (name: String, gain: Double, pan: Double, rate: Double, delay: Double) -> Int in
      self.engine.play(name, gain: gain, pan: pan, rate: rate, delay: delay)
    }

    Function("stop") { (voice: Int) in
      self.engine.stop(voice)
    }

    Function("stopAll") {
      self.engine.stopAll()
    }

    Function("activeVoices") { () -> Int in
      self.engine.activeVoices()
    }

    Function("setVolume") { (volume: Double) in
      self.engine.setVolume(volume)
    }

    AsyncFunction("unlock") { () -> Bool in
      self.engine.unlock()
    }

    Function("dispose") {
      self.engine.dispose()
    }

    OnAppEntersBackground {
      self.engine.enterBackground()
    }

    OnAppEntersForeground {
      self.engine.enterForeground()
    }

    OnDestroy {
      self.engine.dispose()
    }
  }
}
