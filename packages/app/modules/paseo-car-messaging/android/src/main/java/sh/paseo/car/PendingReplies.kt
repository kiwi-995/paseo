package sh.paseo.car

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Durable queue of replies that JS has not delivered to the daemon yet. */
object PendingReplies {
  private const val PREFS = "paseo_car_messaging"
  private const val KEY = "pending_replies"

  data class Reply(val conversationId: String, val text: String, val timestampMs: Long)

  @Synchronized
  fun add(context: Context, conversationId: String, text: String, timestampMs: Long) {
    val all = read(context)
    all.add(Reply(conversationId, text, timestampMs))
    write(context, all)
  }

  /** Removes and returns the replies whose conversation id starts with [prefix]. */
  @Synchronized
  fun take(context: Context, prefix: String): List<Reply> {
    val all = read(context)
    val (taken, kept) = all.partition { it.conversationId.startsWith(prefix) }
    if (taken.isNotEmpty()) write(context, kept.toMutableList())
    return taken
  }

  private fun read(context: Context): MutableList<Reply> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
      ?: return mutableListOf()
    return try {
      val array = JSONArray(raw)
      MutableList(array.length()) { index ->
        val item = array.getJSONObject(index)
        Reply(item.getString("conversationId"), item.getString("text"), item.getLong("timestampMs"))
      }
    } catch (_: Exception) {
      mutableListOf()
    }
  }

  private fun write(context: Context, replies: List<Reply>) {
    val array = JSONArray()
    for (reply in replies) {
      array.put(
        JSONObject()
          .put("conversationId", reply.conversationId)
          .put("text", reply.text)
          .put("timestampMs", reply.timestampMs),
      )
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply()
  }
}
