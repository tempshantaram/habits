package com.tempshantaram.toss

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class Playback(
    val itemId: String? = null,
    val state: String = STOPPED,
    val position: Int = 0,
    val duration: Int = 0,
    val volume: Int = -1,
    val working: Boolean = false,
) {
    val isPlaying: Boolean get() = state == PLAYING
    val isPaused: Boolean get() = state == PAUSED

    companion object {
        const val PLAYING = "PLAYING"
        const val PAUSED = "PAUSED_PLAYBACK"
        const val STOPPED = "STOPPED"
        const val TRANSITIONING = "TRANSITIONING"
    }
}

/**
 * Everything that isn't screen: the queue, the chosen TV, the local server, and the loop that
 * asks the TV where it has got to.
 */
object Toss {

    private const val TAG = "Toss"

    private lateinit var appContext: Context
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var server: MediaServer? = null
    private var transport: Transport? = null
    private var pollJob: Job? = null
    private var startedAt = 0L

    /** Until this moment, believe our own idea of the position rather than the TV's. */
    @Volatile
    private var seekGuardUntil = 0L

    /** A scrub made before the TV was ready to take one; applied as soon as it is. */
    @Volatile
    private var pendingSeek: Int? = null

    private val _devices = MutableStateFlow<List<Renderer>>(emptyList())
    val devices: StateFlow<List<Renderer>> = _devices.asStateFlow()

    private val _others = MutableStateFlow<List<Sighting>>(emptyList())
    val others: StateFlow<List<Sighting>> = _others.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val _searched = MutableStateFlow(false)
    val searched: StateFlow<Boolean> = _searched.asStateFlow()

    private val _device = MutableStateFlow<Renderer?>(null)
    val device: StateFlow<Renderer?> = _device.asStateFlow()

    private val _queue = MutableStateFlow<List<Item>>(emptyList())
    val queue: StateFlow<List<Item>> = _queue.asStateFlow()

    private val _playback = MutableStateFlow(Playback())
    val playback: StateFlow<Playback> = _playback.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private val _address = MutableStateFlow<String?>(null)
    val address: StateFlow<String?> = _address.asStateFlow()

    val hasVolume: Boolean get() = transport?.hasVolume == true

    fun init(context: Context) {
        if (!::appContext.isInitialized) appContext = context.applicationContext
        Settings.load(appContext)
    }

    fun current(): Item? = _queue.value.firstOrNull { it.id == _playback.value.itemId }

    // ---- devices -------------------------------------------------------------------------

    fun scan() {
        if (_scanning.value) return
        _scanning.value = true
        scope.launch {
            val found = try {
                Ssdp.discover(appContext, 5000)
            } catch (e: Exception) {
                Log.w(TAG, "scan failed: ${e.message}")
                Discovery()
            }
            _devices.value = found.renderers
            _others.value = found.others
            _searched.value = true
            _scanning.value = false

            val chosen = _device.value
            if (chosen != null) {
                // Keep the selection pointed at the live description URL.
                val same = found.renderers.firstOrNull { it.udn == chosen.udn }
                if (same != null && same.avTransportUrl != chosen.avTransportUrl) choose(same)
            } else if (found.renderers.size == 1) {
                choose(found.renderers.first())
            }
        }
    }

    fun choose(renderer: Renderer) {
        _device.value = renderer
        val connection = Transport(renderer)
        transport = connection
        Diagnostics.note("Chose ${renderer.label} (${renderer.detail})")
        scope.launch {
            connection.loadCapabilities()
            val level = connection.volume()
            if (level != null) _playback.update { it.copy(volume = level) }
        }
    }

    fun forget() {
        stop()
        _device.value = null
        transport = null
    }

    // ---- queue ---------------------------------------------------------------------------

    fun addVideos(uris: List<Uri>) {
        if (uris.isEmpty()) return
        scope.launch {
            val added = uris.map { Media.item(appContext, it) }
            _queue.update { it + added }
            publish()
        }
    }

    fun attachSubtitle(itemId: String, uri: Uri) {
        scope.launch {
            val subtitle = Media.subtitle(appContext, uri)
            _queue.update { list ->
                list.map { if (it.id == itemId) it.copy(subtitle = subtitle) else it }
            }
            publish()
            if (_playback.value.itemId == itemId && _playback.value.state != Playback.STOPPED) {
                _notice.value = "Subtitles added — play it again to load them on the TV."
            }
        }
    }

    fun removeSubtitle(itemId: String) {
        _queue.update { list -> list.map { if (it.id == itemId) it.copy(subtitle = null) else it } }
        publish()
    }

    fun remove(itemId: String) {
        if (_playback.value.itemId == itemId) stop()
        _queue.update { list -> list.filterNot { it.id == itemId } }
        publish()
        if (_queue.value.isEmpty()) shutdown()
    }

    fun move(itemId: String, delta: Int) {
        _queue.update { list ->
            val from = list.indexOfFirst { it.id == itemId }
            val to = from + delta
            if (from < 0 || to < 0 || to >= list.size) {
                list
            } else {
                val copy = ArrayList(list)
                val moved = copy.removeAt(from)
                copy.add(to, moved)
                copy
            }
        }
        publish()
    }

    fun clearQueue() {
        stop()
        _queue.value = emptyList()
        publish()
        shutdown()
    }

    private fun publish() {
        server?.publish(_queue.value)
    }

    // ---- playback ------------------------------------------------------------------------

    fun play(item: Item) {
        val renderer = transport
        if (renderer == null) {
            _notice.value = "Pick a TV first."
            return
        }
        pendingSeek = null
        scope.launch {
            _playback.update {
                it.copy(working = true, itemId = item.id, position = 0, duration = item.duration)
            }
            val media = ensureServer()
            if (media == null) {
                _playback.update { it.copy(working = false) }
                return@launch
            }
            media.publish(_queue.value)
            val videoUrl = media.videoUrl(item)
            if (videoUrl == null) {
                _notice.value = "No Wi-Fi address — the TV needs the phone on the same network."
                _playback.update { it.copy(working = false) }
                return@launch
            }
            val subtitleUrl = media.subtitleUrl(item)
            val metadata = Upnp.didl(item, videoUrl, subtitleUrl)

            renderer.stop()
            when (val result = renderer.setUri(videoUrl, metadata)) {
                is SoapResult.Failed -> {
                    _notice.value = result.message
                    _playback.update { it.copy(working = false, state = Playback.STOPPED) }
                    return@launch
                }

                is SoapResult.Ok -> Unit
            }
            when (val result = renderer.play()) {
                is SoapResult.Failed -> {
                    _notice.value = result.message
                    _playback.update { it.copy(working = false, state = Playback.STOPPED) }
                    return@launch
                }

                is SoapResult.Ok -> Unit
            }
            startedAt = System.currentTimeMillis()
            seekGuardUntil = 0L
            _playback.update {
                it.copy(
                    working = false,
                    state = Playback.PLAYING,
                    itemId = item.id,
                    position = 0,
                    duration = item.duration,
                )
            }
            startPolling()
        }
    }

    fun playAt(index: Int) {
        _queue.value.getOrNull(index)?.let { play(it) }
    }

    fun toggle() {
        val renderer = transport ?: return
        val state = _playback.value
        scope.launch {
            if (state.isPlaying) {
                val result = renderer.pause()
                if (result is SoapResult.Failed) _notice.value = result.message
                else _playback.update { it.copy(state = Playback.PAUSED) }
            } else if (state.isPaused) {
                val result = renderer.play()
                if (result is SoapResult.Failed) _notice.value = result.message
                else _playback.update { it.copy(state = Playback.PLAYING) }
            } else {
                val item = current() ?: _queue.value.firstOrNull()
                if (item != null) play(item)
            }
        }
    }

    fun stop() {
        pollJob?.cancel()
        pollJob = null
        pendingSeek = null
        seekGuardUntil = 0L
        val renderer = transport
        scope.launch {
            renderer?.stop()
            _playback.update { it.copy(state = Playback.STOPPED, position = 0, working = false) }
        }
    }

    fun next() {
        val index = _queue.value.indexOfFirst { it.id == _playback.value.itemId }
        val following = _queue.value.getOrNull(index + 1)
        if (following != null) play(following) else stop()
    }

    fun previous() {
        val index = _queue.value.indexOfFirst { it.id == _playback.value.itemId }
        val earlier = _queue.value.getOrNull(index - 1)
        if (earlier != null) play(earlier) else seek(0)
    }

    /**
     * Scrubbing. Two things make this fiddly on a TV: it may refuse a seek until it has
     * settled into playing, and it may keep reporting the old position for a second or two
     * afterwards. So a seek asked for too early is held, and for a few seconds afterwards the
     * slider trusts the target rather than what the TV says — otherwise the thumb springs back
     * and it looks as though nothing happened.
     */
    fun seek(seconds: Int) {
        val renderer = transport ?: return
        val target = seconds.coerceAtLeast(0)
        _playback.update { it.copy(position = target) }

        val settled = _playback.value.state == Playback.PLAYING &&
            System.currentTimeMillis() - startedAt > 3000
        if (!settled) {
            pendingSeek = target
            seekGuardUntil = System.currentTimeMillis() + 12_000
            Diagnostics.note("Seek to ${Media.formatTime(target)} held until the TV is playing")
            return
        }

        seekGuardUntil = System.currentTimeMillis() + 5000
        scope.launch { sendSeek(renderer, target) }
    }

    private fun sendSeek(renderer: Transport, target: Int) {
        when (val result = renderer.seek(target)) {
            is SoapResult.Failed -> {
                seekGuardUntil = 0L
                _notice.value = result.message
            }

            is SoapResult.Ok -> Unit
        }
    }

    fun setVolume(level: Int) {
        val renderer = transport ?: return
        _playback.update { it.copy(volume = level) }
        scope.launch { renderer.setVolume(level) }
    }

    fun dismissNotice() {
        _notice.value = null
    }

    // ---- the loop that watches the TV ------------------------------------------------------

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            var stoppedTicks = 0
            var lastTick = System.currentTimeMillis()
            while (isActive) {
                delay(1000)
                val renderer = transport ?: break
                val progress = renderer.progress()
                val state = renderer.transportState()
                val now = System.currentTimeMillis()
                val elapsed = ((now - lastTick) / 1000L).toInt().coerceIn(0, 10)
                lastTick = now

                _playback.update { p ->
                    val reported = progress?.position
                    val position = when {
                        now < seekGuardUntil -> p.position
                        reported != null -> reported
                        // The TV won't say where it is, so count the seconds ourselves.
                        p.state == Playback.PLAYING -> p.position + elapsed
                        else -> p.position
                    }
                    val duration = progress?.duration?.takeIf { it > 0 } ?: p.duration
                    val settled = state != null && state != Playback.TRANSITIONING
                    p.copy(
                        position = position,
                        duration = duration,
                        state = if (settled) state else p.state,
                    )
                }

                // A scrub asked for before the TV was ready goes out now.
                val held = pendingSeek
                if (held != null && state == Playback.PLAYING &&
                    now - startedAt > 3000
                ) {
                    pendingSeek = null
                    seekGuardUntil = now + 5000
                    sendSeek(renderer, held)
                }

                val old = now - startedAt > 6000 && now > seekGuardUntil
                if (old && (state == Playback.STOPPED || state == "NO_MEDIA_PRESENT")) {
                    stoppedTicks++
                    if (stoppedTicks >= 3) {
                        stoppedTicks = 0
                        onFinished()
                        break
                    }
                } else {
                    stoppedTicks = 0
                }
            }
        }
    }

    /** The TV went quiet: either the next thing in the queue, or we're done. */
    private fun onFinished() {
        val index = _queue.value.indexOfFirst { it.id == _playback.value.itemId }
        val following = _queue.value.getOrNull(index + 1)
        if (following != null) {
            play(following)
        } else {
            _playback.update { it.copy(state = Playback.STOPPED, position = 0) }
            shutdown()
        }
    }

    // ---- the server ------------------------------------------------------------------------

    private fun ensureServer(): MediaServer? {
        val existing = server
        if (existing != null && existing.running) {
            _address.value = existing.host?.let { "$it:${existing.port}" }
            return existing
        }
        val media = existing ?: MediaServer(appContext)
        server = media
        if (!media.start()) {
            _notice.value = "Couldn't open a port on the phone to serve from."
            return null
        }
        media.publish(_queue.value)
        _address.value = media.host?.let { "$it:${media.port}" }
        try {
            appContext.startForegroundService(Intent(appContext, StreamService::class.java))
        } catch (e: Exception) {
            Log.w(TAG, "service refused: ${e.message}")
        }
        return media
    }

    /** Nothing left to serve — take the port and the notification away. */
    fun shutdown() {
        pollJob?.cancel()
        pollJob = null
        server?.stop()
        _address.value = null
        try {
            appContext.stopService(Intent(appContext, StreamService::class.java))
        } catch (_: Exception) {
        }
    }
}
