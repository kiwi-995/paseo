package sh.paseo.car

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

/** Handles Reply and Mark-as-read from the phone shade and from Android Auto. */
class CarMessageActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val conversationId = intent.getStringExtra(CarConversations.EXTRA_CONVERSATION_ID) ?: return
    when (intent.action) {
      CarConversations.ACTION_REPLY -> {
        val text = RemoteInput.getResultsFromIntent(intent)
          ?.getCharSequence(CarConversations.KEY_REPLY_TEXT)
          ?.toString()
          ?.trim()
        if (text.isNullOrEmpty()) return
        val now = System.currentTimeMillis()
        CarConversations.addOwn(context, conversationId, text, now)
        // Queue first so a reply survives when JS is not listening; JS drains on the event.
        PendingReplies.add(context, conversationId, text, now)
        PaseoCarMessagingModule.emitReplyQueued(conversationId)
      }
      CarConversations.ACTION_MARK_READ -> {
        CarConversations.markRead(context, conversationId)
      }
    }
  }
}
