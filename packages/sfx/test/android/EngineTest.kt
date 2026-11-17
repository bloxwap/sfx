import android.content.res.AssetManager
import android.media.SoundPool
import android.os.Handler
import android.os.SystemClock
import com.bloxwap.sfx.SfxEngine
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

fun main() {
  val assets = AssetManager()
  val wav = ByteArray(44 + 48000 * 2); wav[22] = 1
  assets.files["bloxwap-sfx/tick.wav"] = wav
  val ended = mutableListOf<Int>()
  val engine = SfxEngine({ assets }) { ended.add(it) }
  engine.configure(1)
  var completed = 0
  engine.preload(listOf("tick", "tick")) { check(it); completed++ }
  val first = SoundPool.instances.last()
  first.complete(); check(completed == 1)
  val a = engine.play("tick", 2.0, 0.0, 1.0, 0.0)
  check(first.streams.values.single().left == 1f)
  engine.setVolume(0.25)
  check(first.streams.values.single().left == 0.25f)
  val b = engine.play("tick", 1.0, 0.0, 4.0, 0.0)
  check(a in ended && b !in ended && engine.activeVoices() == 1)
  check(first.streams.values.single().rate == 2f)
  check(first.streams.values.single().left == 0.125f)
  Handler.advance(499); check(b !in ended)
  Handler.advance(1); check(b in ended && engine.activeVoices() == 0)

  engine.dispose()
  val awaiting = engine.play("tick", 1.0, 0.0, 1.0, 0.0)
  val second = SoundPool.instances.last()
  Handler.advance(240); check(awaiting !in ended)
  second.complete(); Handler.advance(999); check(awaiting !in ended)
  engine.stop(awaiting); check(awaiting in ended)

  engine.dispose()
  var disposedPreload = 0
  engine.preload(listOf("tick")) { check(!it); disposedPreload++ }
  val retired = SoundPool.instances.last()
  val queuedCallback = retired.listener!!
  engine.dispose(); check(disposedPreload == 1)
  var freshPreload = 0
  engine.preload(listOf("tick")) { check(it); freshPreload++ }
  val fresh = SoundPool.instances.last()
  queuedCallback(retired, 1, 0)
  check(freshPreload == 0)
  fresh.complete(); check(freshPreload == 1)
  val delayed = engine.play("tick", 1.0, 0.0, 1.0, 1.0)
  engine.enterBackground(); Handler.advance(2000)
  check(delayed in ended && engine.activeVoices() == 0 && fresh.streams.isEmpty())
  check(!engine.unlock()); engine.enterForeground(); check(engine.unlock())
  check(engine.play("missing", 1.0, 0.0, 1.0, 0.0) == 0)
  var missing = 0
  engine.preload(listOf("missing")) { check(!it); missing++ }; check(missing == 1)
  engine.dispose()
  check(Handler.jobs.isEmpty())
  check(ended.size == ended.toSet().size)

  assets.files["bloxwap-sfx/press.wav"] = wav
  repeat(100) {
    val callbacks = CountDownLatch(2)
    val completedBatch = AtomicInteger()
    SoundPool.onLoad = { pool, id ->
      Thread { pool.complete(id); callbacks.countDown() }.start()
    }
    engine.preload(listOf("tick", "press")) { check(it); completedBatch.incrementAndGet() }
    check(callbacks.await(5, TimeUnit.SECONDS))
    check(completedBatch.get() == 1) { "Concurrent preload completion must resolve exactly once" }
    engine.dispose()
  }
  SoundPool.onLoad = null
  var failed = 0
  engine.preload(listOf("tick")) { check(!it); failed++ }
  SoundPool.instances.last().complete(status = 1)
  check(failed == 1)
  engine.dispose()
  println("Android engine: lifecycle, gain, live volume, rate, decode delay, stealing, preload and pool-generation checks passed at ${SystemClock.now} ms")
}
