package android.content.res
import java.io.ByteArrayInputStream
open class AssetManager {
  val files = mutableMapOf<String, ByteArray>()
  fun open(name: String) = ByteArrayInputStream(files[name] ?: error("missing"))
  fun openFd(name: String) = AssetFileDescriptor((files[name] ?: error("missing")).size.toLong())
}
class AssetFileDescriptor(val length: Long): AutoCloseable { override fun close() {} }
