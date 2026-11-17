package com.bloxwap.sfx

import android.content.res.AssetManager
import android.media.AudioAttributes
import android.media.SoundPool
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlin.math.ceil

/** One pool owns decoded sounds, bounded voices, volume changes and completion notifications. */
class SfxEngine(
  private val assets: () -> AssetManager?,
  private val onVoiceEnded: (Int) -> Unit = {},
) {
  private class Voice(val gain: Double, val pan: Double) {
    var stream = 0
    var endsAt = Long.MAX_VALUE
    var job: Runnable? = null
  }
  private class Sound(val id: Int, val durationMs: Double) {
    var loaded = false
    val waiters = mutableListOf<() -> Unit>()
  }
  private val lock = Any()
  private val handler = Handler(Looper.getMainLooper())
  private var pool: SoundPool? = null
  private var maxStreams = 16
  private var volume = 1f
  private var foreground = true
  private var nextId = 1
  private val sounds = HashMap<String, Sound>()
  private val voices = LinkedHashMap<Int, Voice>()

  fun configure(maxVoices: Int) = synchronized(lock) {
    // SoundPool fixes its stream count at creation; a change applies after dispose().
    if (pool == null) maxStreams = maxVoices.coerceIn(1, 64)
  }

  fun setVolume(value: Double) = synchronized(lock) {
    volume = value.toFloat().coerceIn(0f, 1f)
    for (voice in voices.values) if (voice.stream != 0) {
      val (left, right) = levels(voice)
      pool?.setVolume(voice.stream, left, right)
    }
  }

  private fun levels(voice: Voice): Pair<Float, Float> {
    // Assets are baked at 2x nominal gain; this preserves the API's 0–2 range within SoundPool's 0–1.
    val level = (voice.gain.toFloat().coerceIn(0f, 2f) * volume / 2f)
    val balance = voice.pan.toFloat().coerceIn(-1f, 1f)
    return Pair(level * minOf(1f, 1f - balance), level * minOf(1f, 1f + balance))
  }

  private fun poolLocked(): SoundPool {
    pool?.let { return it }
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_GAME)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    val created = SoundPool.Builder().setMaxStreams(maxStreams).setAudioAttributes(attributes).build()
    created.setOnLoadCompleteListener { source, soundId, status ->
      val ready = synchronized(lock) {
        if (pool !== source) return@synchronized emptyList<() -> Unit>()
        val sound = sounds.values.firstOrNull { it.id == soundId } ?: return@synchronized emptyList<() -> Unit>()
        if (status != 0) sounds.values.remove(sound) else sound.loaded = true
        sound.waiters.toList().also { sound.waiters.clear() }
      }
      ready.forEach { it() }
    }
    pool = created
    return created
  }

  private fun soundLocked(name: String): Sound? {
    sounds[name]?.let { return it }
    if (name.isEmpty() || !name.all { it.isLetterOrDigit() || it == '-' }) return null
    val manager = assets() ?: return null
    return try {
      manager.openFd("$ASSET_DIR/$name.wav").use { descriptor ->
        val header = ByteArray(44)
        manager.open("$ASSET_DIR/$name.wav").use { input ->
          var read = 0
          while (read < header.size) {
            val count = input.read(header, read, header.size - read)
            if (count < 1) return null
            read += count
          }
        }
        val channels = header[22].toInt() and 0xff
        if (channels !in 1..2 || descriptor.length <= 44) return null
        val durationMs = (descriptor.length - 44) * 1000.0 / (48000 * channels * 2)
        val id = poolLocked().load(descriptor, 1)
        if (id == 0) null else Sound(id, durationMs).also { sounds[name] = it }
      }
    } catch (_: Exception) { null }
  }

  fun preload(names: List<String>, done: (Boolean) -> Unit) {
    val finishLock = Any()
    var success: Boolean
    var remaining: Int
    val immediate = synchronized(lock) {
      val requested = names.distinct().map { soundLocked(it) }
      success = requested.all { it != null }
      val pending = requested.filterNotNull().filter { !it.loaded }
      remaining = pending.size
      for (sound in pending) sound.waiters.add {
        val loaded = synchronized(lock) { sound.loaded && sounds.values.any { it === sound } }
        val result = synchronized(finishLock) {
          success = success && loaded
          remaining -= 1
          if (remaining == 0) success else null
        }
        if (result != null) done(result)
      }
      // Capture this before releasing the lock; a callback must not turn a pending batch into immediate completion.
      if (pending.isEmpty()) success else null
    }
    if (immediate != null) done(immediate)
  }

  fun play(name: String, gain: Double, pan: Double, rate: Double, delay: Double): Int = synchronized(lock) {
    if (!foreground) return 0
    val sound = soundLocked(name) ?: return 0
    pruneLocked()
    while (voices.size >= maxStreams) finishLocked(voices.keys.first())
    val id = nextId++
    val voice = Voice(gain, pan)
    voices[id] = voice
    val start = Runnable { start(id, sound, rate, SystemClock.uptimeMillis()) }
    val delayMs = (delay.coerceIn(0.0, 10.0) * 1000).toLong()
    if (delayMs > 0) {
      voice.job = start
      handler.postDelayed(start, delayMs)
    } else start.run()
    if (voices.containsKey(id)) id else 0
  }

  private fun start(id: Int, sound: Sound, rate: Double, requestedAt: Long): Unit = synchronized(lock) {
    val voice = voices[id] ?: return@synchronized
    voice.job = null
    if (!sound.loaded) {
      sound.waiters.add {
        synchronized(lock) {
          if (sound.loaded && SystemClock.uptimeMillis() - requestedAt <= STALE_MS) start(id, sound, rate, requestedAt)
          else finishLocked(id)
        }
      }
      return@synchronized
    }
    val (left, right) = levels(voice)
    val speed = rate.toFloat().coerceIn(0.5f, 2f)
    val stream = pool?.play(sound.id, left, right, 1, 0, speed) ?: 0
    if (stream == 0) { finishLocked(id); return@synchronized }
    voice.stream = stream
    // SoundPool has no end callback. Its native-clock deadline starts after decode and uses the actual rate.
    val duration = ceil(sound.durationMs / speed).toLong()
    voice.endsAt = SystemClock.uptimeMillis() + duration
    val end = Runnable { synchronized(lock) { finishLocked(id) } }
    voice.job = end
    handler.postDelayed(end, duration)
  }

  private fun finishLocked(id: Int) {
    val voice = voices.remove(id) ?: return
    voice.job?.let(handler::removeCallbacks)
    if (voice.stream != 0) pool?.stop(voice.stream)
    onVoiceEnded(id)
  }
  private fun pruneLocked() {
    val now = SystemClock.uptimeMillis()
    voices.filterValues { it.endsAt <= now }.keys.toList().forEach(::finishLocked)
  }
  fun stop(id: Int) = synchronized(lock) { finishLocked(id) }
  fun stopAll() = synchronized(lock) { voices.keys.toList().forEach(::finishLocked) }
  fun activeVoices(): Int = synchronized(lock) { pruneLocked(); voices.count { it.value.stream != 0 } }
  fun unlock(): Boolean = synchronized(lock) { if (!foreground) false else { poolLocked(); true } }
  fun enterBackground() = synchronized(lock) { foreground = false; stopAll() }
  fun enterForeground() = synchronized(lock) { foreground = true }

  fun dispose() {
    val waiters = synchronized(lock) {
      stopAll()
      val waiting = sounds.values.flatMap { it.waiters.toList().also { _ -> it.waiters.clear() } }
      sounds.clear()
      val old = pool
      pool = null
      old?.setOnLoadCompleteListener(null)
      old?.release()
      waiting
    }
    waiters.forEach { it() }
  }
  private companion object {
    const val ASSET_DIR = "bloxwap-sfx"
    const val STALE_MS = 250L
  }
}
