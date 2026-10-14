package sh.paseo.car

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PaseoCarMessagingModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PaseoCarMessaging")

    Events(EVENT_REPLY_QUEUED)

    OnCreate { instance = this@PaseoCarMessagingModule }

    OnDestroy {
      if (instance === this@PaseoCarMessagingModule) instance = null
    }

    // Returns false when Android refuses to start a foreground service from the background.
    Function("startSession") { title: String, text: String ->
      val intent = Intent(context, CarMessagingService::class.java)
        .putExtra(CarMessagingService.EXTRA_TITLE, title)
        .putExtra(CarMessagingService.EXTRA_TEXT, text)
      try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (_: Exception) {
        false
      }
    }

    Function("stopSession") {
      context.stopService(Intent(context, CarMessagingService::class.java))
    }

    Function("postIncoming") { conversationId: String,
      title: String,
      assistantName: String,
      text: String,
      timestampMs: Double,
      deepLink: String? ->
      CarConversations.addIncoming(
        context,
        conversationId,
        title,
        assistantName,
        text,
        timestampMs.toLong(),
        deepLink,
      )
    }

    Function("markRead") { conversationId: String ->
      CarConversations.markRead(context, conversationId)
    }

    Function("clearConversation") { conversationId: String ->
      CarConversations.clear(context, conversationId)
    }

    Function("takePendingReplies") { prefix: String ->
      PendingReplies.take(context, prefix).map { reply ->
        mapOf(
          "conversationId" to reply.conversationId,
          "text" to reply.text,
          "timestampMs" to reply.timestampMs.toDouble(),
        )
      }
    }
  }

  companion object {
    private const val EVENT_REPLY_QUEUED = "onReplyQueued"

    @Volatile
    private var instance: PaseoCarMessagingModule? = null

    fun emitReplyQueued(conversationId: String) {
      instance?.sendEvent(EVENT_REPLY_QUEUED, mapOf("conversationId" to conversationId))
    }
  }
}
