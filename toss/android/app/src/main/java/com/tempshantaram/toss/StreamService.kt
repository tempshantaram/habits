package com.tempshantaram.toss

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

/**
 * Holds the process up while the TV is pulling video from it. Without this, Android is free
 * to stop serving the moment the screen goes off — which is exactly when a film is playing.
 *
 * Being a foreground service keeps the process alive but does not keep the CPU awake, so a
 * partial wake lock is held as well; without it, the phone dozes between the TV's reads and
 * playback stalls a few minutes after the screen goes dark.
 */
class StreamService : Service() {

    companion object {
        const val ACTION_STOP = "com.tempshantaram.toss.STOP"
        private const val CHANNEL = "toss-streaming"
        private const val NOTIFICATION_ID = 7
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var watcher: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    /** What the notification shows; it only needs redrawing when one of these changes. */
    private data class Shown(val title: String?, val state: String, val device: String?)

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

        holdAwake()

        if (watcher == null) {
            watcher = scope.launch {
                // The position ticks every second; the notification doesn't show it, so
                // redraw only when the title, the play state or the TV actually changes.
                combine(Toss.playback, Toss.queue, Toss.device) { playback, _, device ->
                    Shown(Toss.current()?.displayTitle, playback.state, device?.label)
                }.distinctUntilChanged().collect {
                    val manager = getSystemService(NotificationManager::class.java)
                    manager.notify(NOTIFICATION_ID, notification())
                }
            }
        }
        // If the process dies, the queue dies with it; there is nothing to come back to.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        watcher?.cancel()
        watcher = null
        letSleep()
        super.onDestroy()
    }

    private fun holdAwake() {
        if (wakeLock == null) {
            val power = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Toss:streaming").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        // High-performance Wi-Fi keeps the radio out of power save between reads. Android 14
        // made the lock a no-op, so it only helps on older versions — but costs nothing there.
        if (wifiLock == null && Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            @Suppress("DEPRECATION")
            wifiLock = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Toss:streaming")
                ?.apply {
                    setReferenceCounted(false)
                    acquire()
                }
        }
    }

    private fun letSleep() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {
        }
        try {
            if (wifiLock?.isHeld == true) wifiLock?.release()
        } catch (_: Exception) {
        }
        wakeLock = null
        wifiLock = null
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
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Stop", stop)
            .build()
    }
}
