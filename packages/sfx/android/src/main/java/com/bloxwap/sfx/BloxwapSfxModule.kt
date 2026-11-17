package com.bloxwap.sfx

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JavaScript surface of [SfxEngine] (see src/native.ts). play() is a synchronous Function so it runs on
 * the JS thread inside the gesture, with no promise or main-thread hop.
 */
class BloxwapSfxModule : Module() {
  private val engine by lazy { SfxEngine({ appContext.reactContext?.assets }) { voice -> sendEvent("onVoiceEnded", mapOf("voice" to voice)) } }

  override fun definition() = ModuleDefinition {
    Name("BloxwapSfxEngine")
    Events("onVoiceEnded")

    // audioSession is iOS-only: SoundPool never takes audio focus.
    Function("configure") { maxVoices: Int, _: String ->
      engine.configure(maxVoices)
    }

    AsyncFunction("preload") { names: List<String>, promise: Promise ->
      engine.preload(names) { loaded -> promise.resolve(loaded) }
    }

    Function("play") { name: String, gain: Double, pan: Double, rate: Double, delay: Double ->
      engine.play(name, gain, pan, rate, delay)
    }

    Function("stop") { voice: Int ->
      engine.stop(voice)
    }

    Function("stopAll") {
      engine.stopAll()
    }

    Function("activeVoices") {
      engine.activeVoices()
    }

    Function("setVolume") { volume: Double ->
      engine.setVolume(volume)
    }

    AsyncFunction("unlock") {
      engine.unlock()
    }

    Function("dispose") {
      engine.dispose()
    }

    OnActivityEntersBackground {
      engine.enterBackground()
    }

    OnActivityEntersForeground {
      engine.enterForeground()
    }

    OnDestroy {
      engine.dispose()
    }
  }
}
