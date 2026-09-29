package com.tempshantaram.toss

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.MediaMetadata
import android.media.VolumeProvider
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
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
 *
 * Being a foreground service keeps the process alive but does not keep the CPU awake, so a
 * partial wake lock is held as well; without it, the phone dozes between the TV's reads and
 * playback stalls a few minutes after the screen goes dark.
 *
 * It also owns the media session: the lock-screen and notification controls, and the claim on
 * the phone's volume keys, which drive the TV's volume while a video is being sent.
 */
class StreamService : Service() {

    companion object {
        const val ACTION_STOP = "com.tempshantaram.toss.STOP"
        private const val ACTION_TOGGLE = "com.tempshantaram.toss.TOGGLE"
        private const val ACTION_BACK = "com.tempshantaram.toss.BACK"
        private const val ACTION_FORWARD = "com.tempshantaram.toss.FORWARD"
        private const val ACTION_NEXT = "com.tempshantaram.toss.NEXT"

        private const val CUSTOM_BACK = "toss.back"
        private const val CUSTOM_FORWARD = "toss.forward"
        private const val CUSTOM_NEXT = "toss.next"

        const val BACK_SECONDS = 10
        const val FORWARD_SECONDS = 30
        private const val VOLUME_STEP = 2

        private const val CHANNEL = "toss-streaming"
        private const val NOTIFICATION_ID = 7
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var watcher: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var session: MediaSession? = null
    private var volume: VolumeProvider? = null

    /** What the notification shows; it only needs redrawing when one of these changes. */
    private data class Shown(val title: String?, val state: String, val device: String?)

    private var shown: Shown? = null
    private var described: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Toss.init(this)
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL,
            "Streaming to the TV",
            NotificationManager.IMPORTANCE_LOW,
        )
        channel.setShowBadge(false)
        channel.description = "Shown while your phone is serving a video to the TV."
        manager.createNotificationChannel(channel)
        session = openSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                Toss.stop()
                Toss.shutdown()
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_TOGGLE -> Toss.toggle()
            ACTION_BACK -> Toss.skip(-BACK_SECONDS)
            ACTION_FORWARD -> Toss.skip(FORWARD_SECONDS)
            ACTION_NEXT -> Toss.next()
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
                combine(Toss.playback, Toss.queue, Toss.device) { playback, _, device ->
                    Triple(playback, Toss.current(), device)
                }.collect { (playback, item, device) ->
                    describe(playback, item, device)
                    val now = Shown(item?.displayTitle, playback.state, device?.label)
                    // The position ticks every second; the notification doesn't show it.
                    if (now != shown) {
                        shown = now
                        val manager = getSystemService(NotificationManager::class.java)
                        manager.notify(NOTIFICATION_ID, notification())
                    }
                }
            }
        }
        // If the process dies, the queue dies with it; there is nothing to come back to.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        watcher?.cancel()
        watcher = null
        session?.let {
            it.isActive = false
            it.release()
        }
        session = null
        volume = null
        letSleep()
        super.onDestroy()
    }

    // ---- the media session --------------------------------------------------------------

    private fun openSession(): MediaSession {
        val media = MediaSession(this, "Toss")
        media.setCallback(object : MediaSession.Callback() {
            override fun onPlay() {
                if (!Toss.playback.value.isPlaying) Toss.toggle()
            }

            override fun onPause() {
                if (Toss.playback.value.isPlaying) Toss.toggle()
            }

            override fun onStop() = Toss.stop()
            override fun onSeekTo(pos: Long) = Toss.seek((pos / 1000L).toInt())
            override fun onRewind() = Toss.skip(-BACK_SECONDS)
            override fun onFastForward() = Toss.skip(FORWARD_SECONDS)
            override fun onSkipToNext() = Toss.next()
            override fun onSkipToPrevious() = Toss.previous()

            override fun onCustomAction(action: String, extras: Bundle?) {
                when (action) {
                    CUSTOM_BACK -> Toss.skip(-BACK_SECONDS)
                    CUSTOM_FORWARD -> Toss.skip(FORWARD_SECONDS)
                    CUSTOM_NEXT -> Toss.next()
                }
            }
        })
        media.setSessionActivity(openApp())
        media.isActive = true
        return media
    }

    /**
     * Keep the session in step with playback. On Android 13 and later the lock-screen
     * controls are drawn from this, not from the notification's buttons: the two slots beside
     * play are given to back-10 and forward-30 by leaving out skip-previous and skip-next,
     * and the next video takes the spare slot after them.
     */
    private fun describe(playback: Playback, item: Item?, device: Renderer?) {
        val media = session ?: return

        val about = "${item?.id}|${playback.duration}|${device?.label}"
        if (about != described) {
            described = about
            media.setMetadata(
                MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, item?.displayTitle ?: "Toss")
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, device?.label ?: "TV")
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, playback.duration * 1000L)
                    .build()
            )
        }

        val state = when {
            playback.working -> PlaybackState.STATE_BUFFERING
            playback.isPlaying -> PlaybackState.STATE_PLAYING
            playback.isPaused -> PlaybackState.STATE_PAUSED
            else -> PlaybackState.STATE_STOPPED
        }
        val actions = PlaybackState.ACTION_PLAY or
            PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_STOP or
            PlaybackState.ACTION_SEEK_TO or
            PlaybackState.ACTION_REWIND or
            PlaybackState.ACTION_FAST_FORWARD
        media.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(
                    state,
                    playback.position * 1000L,
                    if (playback.isPlaying) 1f else 0f,
                    SystemClock.elapsedRealtime(),
                )
                .addCustomAction(
                    PlaybackState.CustomAction.Builder(
                        CUSTOM_BACK, "Back $BACK_SECONDS seconds", R.drawable.ic_back,
                    ).build()
                )
                .addCustomAction(
                    PlaybackState.CustomAction.Builder(
                        CUSTOM_FORWARD, "Forward $FORWARD_SECONDS seconds", R.drawable.ic_forward,
                    ).build()
                )
                .addCustomAction(
                    PlaybackState.CustomAction.Builder(
                        CUSTOM_NEXT, "Next video", R.drawable.ic_next,
                    ).build()
                )
                .build()
        )

        steerVolume(media, playback)
    }

    /**
     * While a video is being sent, the phone's volume keys belong to the TV — the same thing
     * a Cast app does. If this TV doesn't expose volume, the keys stay with the phone.
     */
    private fun steerVolume(media: MediaSession, playback: Playback) {
        if (!Toss.hasVolume || playback.volume < 0) {
            if (volume != null) {
                media.setPlaybackToLocal(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                        .build()
                )
                volume = null
            }
            return
        }
        val existing = volume
        if (existing != null) {
            if (existing.currentVolume != playback.volume) existing.currentVolume = playback.volume
            return
        }
        val provider = object : VolumeProvider(
            VolumeProvider.VOLUME_CONTROL_ABSOLUTE,
            100,
            playback.volume.coerceIn(0, 100),
        ) {
            override fun onSetVolumeTo(volume: Int) {
                val level = volume.coerceIn(0, 100)
                currentVolume = level
                Toss.setVolume(level)
            }

            override fun onAdjustVolume(direction: Int) {
                if (direction == 0) return
                val level = (currentVolume + direction * VOLUME_STEP).coerceIn(0, 100)
                currentVolume = level
                Toss.setVolume(level)
            }
        }
        volume = provider
        media.setPlaybackToRemote(provider)
    }

    // ---- staying awake ------------------------------------------------------------------

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

    // ---- the notification ---------------------------------------------------------------

    private fun openApp(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun command(action: String, code: Int): PendingIntent = PendingIntent.getService(
        this,
        code,
        Intent(this, StreamService::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun button(icon: Int, label: String, action: String, code: Int): Notification.Action =
        Notification.Action.Builder(
            Icon.createWithResource(this, icon),
            label,
            command(action, code),
        ).build()

    private fun notification(): Notification {
        val item = Toss.current()
        val state = Toss.playback.value
        val device = Toss.device.value

        val line = when {
            item == null -> "Ready to send"
            state.isPlaying -> "Playing on ${device?.label ?: "the TV"}"
            state.isPaused -> "Paused on ${device?.label ?: "the TV"}"
            else -> "On ${device?.label ?: "the TV"}"
        }

        // On Android 12 and earlier these buttons are the controls; from 13 the session's
        // actions are, and these remain for the expanded notification.
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_toss)
            .setContentTitle(item?.displayTitle ?: "Toss")
            .setContentText(line)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(button(R.drawable.ic_back, "Back $BACK_SECONDS s", ACTION_BACK, 2))
            .addAction(
                if (state.isPlaying) {
                    button(R.drawable.ic_pause, "Pause", ACTION_TOGGLE, 3)
                } else {
                    button(R.drawable.ic_play, "Play", ACTION_TOGGLE, 3)
                }
            )
            .addAction(
                button(R.drawable.ic_forward, "Forward $FORWARD_SECONDS s", ACTION_FORWARD, 4)
            )
            .addAction(button(R.drawable.ic_next, "Next video", ACTION_NEXT, 5))
            .addAction(button(R.drawable.ic_stop, "Stop", ACTION_STOP, 1))

        val media = session
        if (media != null) {
            builder.setStyle(
                Notification.MediaStyle()
                    .setMediaSession(media.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
        }
        return builder.build()
    }
}
