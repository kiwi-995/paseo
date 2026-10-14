package sh.paseo.car

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Conversation notifications in the shape Android Auto requires for messaging apps:
 * MessagingStyle, a reply action with RemoteInput and SEMANTIC_ACTION_REPLY, and an
 * invisible mark-as-read action, both without UI. History lives in memory; the
 * foreground service keeps the process alive while a session runs.
 */
object CarConversations {
  const val CHANNEL_MESSAGES = "paseo_car_messages"
  const val CHANNEL_SERVICE = "paseo_car_service"
  const val ACTION_REPLY = "sh.paseo.car.REPLY"
  const val ACTION_MARK_READ = "sh.paseo.car.MARK_READ"
  const val EXTRA_CONVERSATION_ID = "conversationId"
  const val KEY_REPLY_TEXT = "paseo_car_reply_text"

  private const val MAX_MESSAGES = 12
  private const val SELF_NAME = "Du"

  private data class Message(val text: String, val timestampMs: Long, val fromSelf: Boolean)

  private class Conversation(
    val id: String,
    var title: String,
    var assistantName: String,
    var deepLink: String?,
  ) {
    val messages = ArrayDeque<Message>()

    fun add(message: Message) {
      messages.addLast(message)
      while (messages.size > MAX_MESSAGES) messages.removeFirst()
    }
  }

  private val conversations = LinkedHashMap<String, Conversation>()

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_MESSAGES, "Verwalter-Nachrichten", NotificationManager.IMPORTANCE_HIGH),
    )
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_SERVICE, "Verbindung für Android Auto", NotificationManager.IMPORTANCE_MIN),
    )
  }

  @Synchronized
  fun addIncoming(
    context: Context,
    conversationId: String,
    title: String,
    assistantName: String,
    text: String,
    timestampMs: Long,
    deepLink: String?,
  ) {
    val conversation = conversations.getOrPut(conversationId) {
      Conversation(conversationId, title, assistantName, deepLink)
    }
    conversation.title = title
    conversation.assistantName = assistantName
    if (deepLink != null) conversation.deepLink = deepLink
    conversation.add(Message(text, timestampMs, fromSelf = false))
    render(context, conversation, alert = true)
  }

  @Synchronized
  fun addOwn(context: Context, conversationId: String, text: String, timestampMs: Long) {
    val conversation = conversations[conversationId] ?: return
    conversation.add(Message(text, timestampMs, fromSelf = true))
    // Re-render silently: Android Auto keeps a reply spinner until the notification updates.
    render(context, conversation, alert = false)
  }

  @Synchronized
  fun markRead(context: Context, conversationId: String) {
    NotificationManagerCompat.from(context).cancel(notificationId(conversationId))
  }

  @Synchronized
  fun clear(context: Context, conversationId: String) {
    conversations.remove(conversationId)
    NotificationManagerCompat.from(context).cancel(notificationId(conversationId))
  }

  fun smallIcon(context: Context): Int {
    val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (icon != 0) icon else context.applicationInfo.icon
  }

  fun launchIntent(context: Context, deepLink: String?): PendingIntent? {
    val intent = if (deepLink != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)).setPackage(context.packageName)
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName)
    } ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode(deepLink ?: "launch", 0),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun notificationId(conversationId: String): Int = 0x5A0000 or (conversationId.hashCode() and 0xFFFF)

  private fun requestCode(key: String, action: Int): Int = (key.hashCode() * 31) + action

  @SuppressLint("MissingPermission")
  private fun render(context: Context, conversation: Conversation, alert: Boolean) {
    val notifications = NotificationManagerCompat.from(context)
    if (!notifications.areNotificationsEnabled()) return
    ensureChannels(context)

    val icon = smallIcon(context)
    val self = Person.Builder().setName(SELF_NAME).setKey("self").build()
    val assistant = Person.Builder()
      .setName(conversation.assistantName)
      .setKey("assistant:${conversation.id}")
      .setBot(true)
      .setImportant(true)
      .build()

    publishShortcut(context, conversation, assistant)

    val style = NotificationCompat.MessagingStyle(self)
      .setConversationTitle(conversation.title)
      .setGroupConversation(false)
    for (message in conversation.messages) {
      style.addMessage(
        NotificationCompat.MessagingStyle.Message(
          message.text,
          message.timestampMs,
          if (message.fromSelf) self else assistant,
        ),
      )
    }

    val replyInput = RemoteInput.Builder(KEY_REPLY_TEXT).setLabel("Antworten").build()
    val replyIntent = actionIntent(context, ACTION_REPLY, conversation.id)
    val replyPending = PendingIntent.getBroadcast(
      context,
      requestCode(conversation.id, 1),
      replyIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
    )
    val replyAction = NotificationCompat.Action.Builder(icon, "Antworten", replyPending)
      .addRemoteInput(replyInput)
      .setAllowGeneratedReplies(true)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
      .setShowsUserInterface(false)
      .build()

    val markReadPending = PendingIntent.getBroadcast(
      context,
      requestCode(conversation.id, 2),
      actionIntent(context, ACTION_MARK_READ, conversation.id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val markReadAction = NotificationCompat.Action.Builder(icon, "Als gelesen markieren", markReadPending)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
      .setShowsUserInterface(false)
      .build()

    val builder = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
      .setSmallIcon(icon)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setShortcutId(conversation.id)
      .setLocusId(LocusIdCompat(conversation.id))
      .addAction(replyAction)
      .addInvisibleAction(markReadAction)
      .setOnlyAlertOnce(!alert)
      .setAutoCancel(false)
    launchIntent(context, conversation.deepLink)?.let { builder.setContentIntent(it) }

    notifications.notify(notificationId(conversation.id), builder.build())
  }

  private fun actionIntent(context: Context, action: String, conversationId: String): Intent =
    Intent(context, CarMessageActionReceiver::class.java)
      .setAction(action)
      .setPackage(context.packageName)
      .putExtra(EXTRA_CONVERSATION_ID, conversationId)

  private fun publishShortcut(context: Context, conversation: Conversation, assistant: Person) {
    val intent = if (conversation.deepLink != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(conversation.deepLink)).setPackage(context.packageName)
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.setAction(Intent.ACTION_VIEW)
    } ?: return
    try {
      val shortcut = ShortcutInfoCompat.Builder(context, conversation.id)
        .setShortLabel(conversation.assistantName)
        .setLongLabel(conversation.title)
        .setLongLived(true)
        .setPerson(assistant)
        .setLocusId(LocusIdCompat(conversation.id))
        .setIcon(IconCompat.createWithResource(context, context.applicationInfo.icon))
        .setIntent(intent)
        .build()
      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
    } catch (_: Exception) {
      // Shortcuts improve conversation ranking but are not required to show the notification.
    }
  }
}
