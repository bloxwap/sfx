package android.os
object SystemClock { var now = 0L; fun uptimeMillis() = now }
class Looper { companion object { fun getMainLooper() = Looper() } }
class Handler(@Suppress("UNUSED_PARAMETER") looper: Looper) {
  fun postDelayed(job: Runnable, delay: Long) { jobs.add(Pair(SystemClock.now + delay, job)) }
  fun removeCallbacks(job: Runnable) { jobs.removeAll { it.second === job } }
  companion object {
    val jobs = mutableListOf<Pair<Long, Runnable>>()
    fun advance(ms: Long) {
      val end = SystemClock.now + ms
      while (true) {
        val next = jobs.minByOrNull { it.first } ?: break
        if (next.first > end) break
        jobs.remove(next); SystemClock.now = next.first; next.second.run()
      }
      SystemClock.now = end
    }
  }
}
