package com.tempshantaram.toss

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Holds the process up while the TV is pulling video from it. Without this, Android is free
 * to stop serving the moment the screen goes off — which is exactly when a film is playing.
 */
class StreamService : Service() {

    companion object {
        const val ACTION_STOP = "com.tempshantaram.toss.STOP"
        private const val CHANNEL = "toss-streaming"
        private const val NOTIFICATION_ID = 7
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var watcher: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Toss.init(this)
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL,
                "Streaming to the TV",
                NotificationManager.IMPORTANCE_LOW,
            )
            channel.setShowBadge(false)
            channel.description = "Shown while your phone is serving a video to the TV."
            manager.createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Toss.stop()
            Toss.shutdown()
            stopSelf()
            return START_NOT_STICKY
        }

        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification(),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            },
        )

        if (watcher == null) {
            watcher = scope.launch {
                combine(Toss.playback, Toss.queue) { playback, _ -> playback }.collect {
                    val manager = getSystemService(NotificationManager::class.java)
                    manager.notify(NOTIFICATION_ID, notification())
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        watcher?.cancel()
        watcher = null
        super.onDestroy()
    }

    private fun notification(): Notification {
        val item = Toss.current()
        val state = Toss.playback.value
        val device = Toss.device.value

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, StreamService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val line = when {
            item == null -> "Ready to send"
            state.isPlaying -> "Playing on ${device?.label ?: "the TV"}"
            state.isPaused -> "Paused on ${device?.label ?: "the TV"}"
            else -> "On ${device?.label ?: "the TV"}"
        }

        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_toss)
            .setContentTitle(item?.displayTitle ?: "Toss")
            .setContentText(line)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Stop", stop)
            .build()
    }
}
