package android.media
import android.content.res.AssetFileDescriptor
class AudioAttributes {
  class Builder {
    fun setUsage(@Suppress("UNUSED_PARAMETER") usage: Int) = this
    fun setContentType(@Suppress("UNUSED_PARAMETER") contentType: Int) = this
    fun build() = AudioAttributes()
  }
  companion object { const val USAGE_GAME = 1; const val CONTENT_TYPE_SONIFICATION = 4 }
}
class SoundPool(private val maxStreams: Int) {
  data class Stream(var left: Float, var right: Float, val rate: Float)
  val streams = linkedMapOf<Int, Stream>()
  var listener: ((SoundPool, Int, Int) -> Unit)? = null
  var lastSound = 0
  private var lastStream = 0
  var released = false
  fun setOnLoadCompleteListener(callback: ((SoundPool, Int, Int) -> Unit)?) { listener = callback }
  fun load(@Suppress("UNUSED_PARAMETER") descriptor: AssetFileDescriptor, @Suppress("UNUSED_PARAMETER") priority: Int): Int {
    val id = ++lastSound
    onLoad?.invoke(this, id)
    return id
  }
  fun complete(id: Int = lastSound, status: Int = 0) { listener?.invoke(this, id, status) }
  fun play(@Suppress("UNUSED_PARAMETER") id: Int, left: Float, right: Float, @Suppress("UNUSED_PARAMETER") priority: Int, @Suppress("UNUSED_PARAMETER") loops: Int, rate: Float): Int {
    check(!released)
    if (streams.size >= maxStreams) streams.remove(streams.keys.first())
    val stream = ++lastStream; streams[stream] = Stream(left, right, rate); return stream
  }
  fun setVolume(stream: Int, left: Float, right: Float) { streams[stream]?.also { it.left = left; it.right = right } }
  fun stop(stream: Int) { streams.remove(stream) }
  fun release() { released = true; streams.clear() }
  class Builder {
    private var max = 16
    fun setMaxStreams(value: Int): Builder { max = value; return this }
    fun setAudioAttributes(@Suppress("UNUSED_PARAMETER") attributes: AudioAttributes) = this
    fun build() = SoundPool(max).also { instances.add(it) }
  }
  companion object {
    val instances = mutableListOf<SoundPool>()
    var onLoad: ((SoundPool, Int) -> Unit)? = null
  }
}
