package sh.paseo.car

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps the app process, and with it the daemon connection, alive while the phone is
 * away from the app, so Verwalter messages reach Android Auto and replies reach the daemon.
 */
class CarMessagingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    CarConversations.ensureChannels(this)
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Verwalter verbunden"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Nachrichten erscheinen auch in Android Auto."
    val notification = NotificationCompat.Builder(this, CarConversations.CHANNEL_SERVICE)
      .setSmallIcon(CarConversations.smallIcon(this))
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .apply { CarConversations.launchIntent(this@CarMessagingService, null)?.let { setContentIntent(it) } }
      .build()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
    } else {
      0
    }
    ServiceCompat.startForeground(this, SERVICE_NOTIFICATION_ID, notification, type)
    // The service only matters while the JS bridge runs in this process.
    return START_NOT_STICKY
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    private const val SERVICE_NOTIFICATION_ID = 0x5A0001
  }
}
