package com.tempshantaram.toss

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import java.io.File
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicLong

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
    /**
     * Background work. Anything that throws unexpectedly is noted in the log rather than
     * allowed to bring the whole app down, which is what an uncaught error in a coroutine
     * does on Android.
     */
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO + CoroutineExceptionHandler { _, error ->
            Log.e(TAG, "background task failed", error)
            Diagnostics.note("Something went wrong: ${error.javaClass.simpleName}: ${error.message}")
        }
    )

    @Volatile
    private var server: MediaServer? = null

    @Volatile
    private var transport: Transport? = null

    @Volatile
    private var pollJob: Job? = null

    @Volatile
    private var playJob: Job? = null

    @Volatile
    private var startedAt = 0L

    /**
     * Stop and start go to the TV one at a time, and only the most recent one counts. Without
     * this, a Stop's network call could still be in flight when a quickly tapped Play began,
     * and land after it — stopping the video that had just started.
     */
    private val commands = Mutex()
    private val generation = AtomicLong()

    /** How close to the end a stop has to be to count as the film finishing. */
    private fun endMargin(duration: Int): Int = maxOf(30, duration * 3 / 100)

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

    /** Videos whose subtitles are being read out of the file, and how far through, 0–100. */
    private val _extracting = MutableStateFlow<Map<String, Int>>(emptyMap())
    val extracting: StateFlow<Map<String, Int>> = _extracting.asStateFlow()

    /** Where each video was left, by URI, for the "resumes at" line on the queue. */
    private val _places = MutableStateFlow<Map<String, Int>>(emptyMap())
    val places: StateFlow<Map<String, Int>> = _places.asStateFlow()

    /**
     * Until the saved queue has been read back, nothing may be written over it — a video
     * shared in at launch would otherwise replace the whole saved queue with itself.
     */
    @Volatile
    private var restored = false

    val hasVolume: Boolean get() = transport?.hasVolume == true

    fun init(context: Context) {
        if (::appContext.isInitialized) return
        appContext = context.applicationContext
        Lan.init(appContext)
        Settings.load(appContext)
        Store.init(appContext)
        _places.value = Store.allPlaces()
        scope.launch {
            val saved = Store.loadQueue(appContext)
            // Anything shared in while this was loading goes after the saved queue.
            _queue.update { saved + it }
            restored = true
            publish()
        }
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
        // Moving to a different TV: stop the old one rather than leave it playing, and
        // rather than have the watcher start reading the new TV's state as this one's.
        val previous = _device.value
        val moving = previous != null && previous.udn != renderer.udn
        val busy = _playback.value.state != Playback.STOPPED || _playback.value.working
        if (moving && busy) stop()
        // The old TV's volume means nothing on this one; hide the slider until it answers.
        if (moving) _playback.update { it.copy(volume = -1) }
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
            val added = uris.map { uri ->
                val item = Media.item(appContext, uri)
                item.copy(subtitleOffsetMs = Store.offset(item.uri.toString()))
            }
            _queue.update { it + added }
            publish()
        }
    }

    fun attachSubtitle(itemId: String, uri: Uri) {
        scope.launch { setSubtitle(itemId, Media.subtitle(appContext, uri)) }
    }

    /**
     * Take a subtitle track out of the video itself and use it as though it were a file
     * picked alongside. The whole video is read through once, so this reports progress.
     */
    fun useEmbedded(itemId: String, track: EmbeddedTrack) {
        val item = _queue.value.firstOrNull { it.id == itemId } ?: return
        if (_extracting.value.containsKey(itemId)) return
        _extracting.update { it + (itemId to 0) }
        scope.launch {
            val result = try {
                Embedded.extract(appContext, item.uri, track) { percent ->
                    _extracting.update { if (it.containsKey(itemId)) it + (itemId to percent) else it }
                }
            } catch (e: Exception) {
                Diagnostics.note("Couldn't read ${track.label}: ${e.message}")
                null
            } finally {
                _extracting.update { it - itemId }
            }
            if (result == null || result.lines == 0) {
                _notice.value = "Couldn't read any lines from that subtitle track."
                return@launch
            }
            val file = try {
                Embedded.store(appContext, item.uri, track, result.srt)
            } catch (_: Exception) {
                _notice.value = "Couldn't keep the subtitles on the phone — is it full?"
                return@launch
            }
            Diagnostics.note("Read ${result.lines} lines from ${track.label}")
            setSubtitle(itemId, Subtitle(Uri.fromFile(file), "${item.displayTitle}.${track.fileTag}.srt"))
        }
    }

    /** Put a subtitle on a video, bringing its remembered timing, and let the old one go. */
    private fun setSubtitle(itemId: String, subtitle: Subtitle) {
        val old = _queue.value.firstOrNull { it.id == itemId }?.subtitle?.uri
        _queue.update { list ->
            list.map {
                if (it.id == itemId) {
                    it.copy(
                        subtitle = subtitle,
                        subtitleOffsetMs = Store.offset(it.uri.toString()),
                    )
                } else {
                    it
                }
            }
        }
        publish()
        if (old != null && old != subtitle.uri) release(listOf(old))
        if (_playback.value.itemId == itemId && _playback.value.state != Playback.STOPPED) {
            _notice.value = "Subtitles added — tap the video to reload it with them, where you are."
        }
    }

    /**
     * Save a video's subtitles somewhere the person chose, as SRT: with any timing nudge
     * applied, without the TV-only colouring.
     */
    fun saveSubtitle(itemId: String, target: Uri) {
        val item = _queue.value.firstOrNull { it.id == itemId } ?: return
        val subtitle = item.subtitle ?: return
        scope.launch {
            val bytes = Subtitles.export(appContext, subtitle, item.subtitleOffsetMs)
            if (bytes == null) {
                _notice.value = "Couldn't read the subtitles to save them."
                return@launch
            }
            val resolver = appContext.contentResolver
            // "wt" truncates what was there; not every provider accepts it, so fall back.
            val stream = try {
                resolver.openOutputStream(target, "wt")
            } catch (_: Exception) {
                null
            } ?: try {
                resolver.openOutputStream(target, "w")
            } catch (_: Exception) {
                null
            }
            val saved = try {
                stream?.use { it.write(bytes) } != null
            } catch (_: Exception) {
                false
            }
            _notice.value = if (saved) "Subtitles saved." else "Couldn't save the subtitles there."
        }
    }

    fun removeSubtitle(itemId: String) {
        val gone = _queue.value.firstOrNull { it.id == itemId }?.subtitle?.uri
        _queue.update { list -> list.map { if (it.id == itemId) it.copy(subtitle = null) else it } }
        publish()
        release(listOfNotNull(gone))
    }

    fun remove(itemId: String) {
        if (_playback.value.itemId == itemId) stop()
        val gone = _queue.value.firstOrNull { it.id == itemId }
        _queue.update { list -> list.filterNot { it.id == itemId } }
        publish()
        if (gone != null) release(listOfNotNull(gone.uri, gone.subtitle?.uri))
        if (_queue.value.isEmpty()) shutdown()
    }

    /**
     * Hand back read access to files no longer queued. Android caps how many of these one
     * app may hold, and each picked file takes one. A file queued twice keeps its grant
     * until the last copy goes.
     */
    private fun release(uris: List<Uri>) {
        val stillUsed = _queue.value.flatMap { listOfNotNull(it.uri, it.subtitle?.uri) }.toSet()
        for (uri in uris) {
            if (uri in stillUsed) continue
            // Subtitles extracted from a video are our own files; delete rather than release.
            if (Embedded.isOurs(appContext, uri)) {
                uri.path?.let { File(it).delete() }
                continue
            }
            try {
                appContext.contentResolver.releasePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Exception) {
                // Shared-in files never had a persistable grant to give back.
            }
        }
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
        val gone = _queue.value.flatMap { listOfNotNull(it.uri, it.subtitle?.uri) }
        _queue.value = emptyList()
        publish()
        release(gone)
        shutdown()
    }

    /** Every change to the queue ends here: the server learns of it, and it's saved. */
    private fun publish() {
        server?.publish(_queue.value)
        if (restored) Store.saveQueue(_queue.value)
    }

    /**
     * Nudge one video's subtitles earlier (negative) or later (positive). The TV only reads
     * the file when a video starts, so a change made mid-film lands when it is next played —
     * and tapping the video reloads it where it is, so that is one tap.
     */
    fun nudgeSubtitle(itemId: String, deltaMs: Int) {
        var changed: Item? = null
        _queue.update { list ->
            list.map {
                if (it.id == itemId) {
                    val offset = (it.subtitleOffsetMs + deltaMs).coerceIn(-600_000, 600_000)
                    it.copy(subtitleOffsetMs = offset).also { updated -> changed = updated }
                } else {
                    it
                }
            }
        }
        val item = changed ?: return
        Store.setOffset(item.uri, item.subtitleOffsetMs)
        publish()
        if (_playback.value.itemId == itemId && _playback.value.state != Playback.STOPPED) {
            _notice.value = "New timing loads when this video next starts — tap it to reload " +
                "where you are."
        }
    }

    // ---- where each video was left ------------------------------------------------------

    /**
     * Note how far a video got. Within the first fifteen seconds, or within a few percent
     * of the end, there is nothing worth resuming, so the note is cleared instead.
     */
    private fun remember(item: Item, seconds: Int) {
        val duration = item.duration
        val worth = seconds > 15 && (duration <= 0 || seconds < duration - endMargin(duration))
        val value = if (worth) seconds else 0
        Store.setPlace(item.uri, value)
        val key = item.uri.toString()
        _places.update { if (value > 0) it + (key to value) else it - key }
    }

    // ---- playback ------------------------------------------------------------------------

    fun play(item: Item) {
        val renderer = transport
        if (renderer == null) {
            _notice.value = "Pick a TV first."
            return
        }
        // Note where the outgoing video got to — including this same video, when it's
        // tapped again to reload with new subtitle timing: it then resumes where it was.
        // A video already stopped has had its place noted by whatever stopped it; noting it
        // again now would read the zeroed position and wipe that out.
        val outgoing = current()
        if (outgoing != null && _playback.value.state != Playback.STOPPED) {
            remember(outgoing, _playback.value.position)
        }

        // Whatever was playing or starting before is finished with. The old watcher in
        // particular has to go now: it would otherwise see the TV stop while this item loads,
        // take that for the end of the film, and skip ahead a video.
        pollJob?.cancel()
        pollJob = null
        playJob?.cancel()
        pendingSeek = null
        seekGuardUntil = 0L
        val mine = generation.incrementAndGet()

        playJob = scope.launch {
            _playback.update {
                it.copy(
                    working = true,
                    itemId = item.id,
                    state = Playback.STOPPED,
                    position = 0,
                    duration = item.duration,
                )
            }
            commands.withLock {
                if (generation.get() != mine) return@launch
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
                ensureActive()
                val loaded = renderer.setUri(videoUrl, metadata)
                ensureActive()
                if (loaded is SoapResult.Failed) {
                    _notice.value = loaded.message
                    _playback.update { it.copy(working = false, state = Playback.STOPPED) }
                    return@launch
                }
                val started = renderer.play()
                ensureActive()
                if (started is SoapResult.Failed) {
                    _notice.value = started.message
                    _playback.update { it.copy(working = false, state = Playback.STOPPED) }
                    return@launch
                }

                startedAt = System.currentTimeMillis()
                // Pick up where this video was left. The TV won't take a seek until it has
                // settled into playing, so it goes out through the held-seek path.
                val resumeAt = Store.place(item.uri)
                if (resumeAt > 0) {
                    pendingSeek = resumeAt
                    seekGuardUntil = startedAt + 15_000
                    Diagnostics.note("Resuming ${item.displayTitle} at ${Media.formatTime(resumeAt)}")
                }
                _playback.update {
                    it.copy(
                        working = false,
                        state = Playback.PLAYING,
                        itemId = item.id,
                        position = resumeAt,
                        duration = item.duration,
                    )
                }
                startPolling()
            }
        }
    }

    fun playAt(index: Int) {
        _queue.value.getOrNull(index)?.let { play(it) }
    }

    fun toggle() {
        val renderer = transport ?: return
        val state = _playback.value
        if (state.working) return
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
        current()?.let { if (_playback.value.state != Playback.STOPPED) remember(it, _playback.value.position) }
        playJob?.cancel()
        playJob = null
        pollJob?.cancel()
        pollJob = null
        pendingSeek = null
        seekGuardUntil = 0L
        val mine = generation.incrementAndGet()
        val renderer = transport
        scope.launch {
            commands.withLock {
                // Something newer was asked for while this waited; it sends its own stop.
                if (generation.get() != mine) return@launch
                renderer?.stop()
                _playback.update { it.copy(state = Playback.STOPPED, position = 0, working = false) }
            }
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

        val current = _playback.value.state
        val settled = (current == Playback.PLAYING || current == Playback.PAUSED) &&
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

    /** Jump relative to where playback is: back ten seconds, forward thirty. */
    fun skip(seconds: Int) {
        val p = _playback.value
        if (p.itemId == null || p.working) return
        val last = if (p.duration > 0) p.duration - 1 else Int.MAX_VALUE
        seek((p.position + seconds).coerceIn(0, last))
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

    /** Sent once, when the slider is let go — not once per pixel of drag. */
    fun setVolume(level: Int) {
        val renderer = transport ?: return
        _playback.update { it.copy(volume = level) }
        scope.launch {
            val result = renderer.setVolume(level)
            if (result is SoapResult.Failed) _notice.value = result.message
        }
    }

    fun dismissNotice() {
        _notice.value = null
    }

    // ---- the loop that watches the TV ------------------------------------------------------

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            var stoppedTicks = 0
            var silentTicks = 0
            var lastTick = System.currentTimeMillis()
            // Some sets answer 0:00:00 for the whole film rather than NOT_IMPLEMENTED. Until
            // this TV has reported a position other than zero, a zero means "won't say".
            var tvKnowsPosition = false
            // Where the film had got to while it was actually playing. Once stopped, many
            // sets report position zero, which says nothing about how far it got.
            var reachedWhilePlaying = 0
            var lastSaved = System.currentTimeMillis()

            while (isActive) {
                delay(1000)
                val renderer = transport ?: break
                val progress = renderer.progress()
                val state = renderer.transportState()
                val now = System.currentTimeMillis()
                val elapsed = ((now - lastTick) / 1000L).toInt().coerceIn(0, 10)
                lastTick = now

                if (state == null && progress == null) {
                    silentTicks++
                    if (silentTicks >= 15) {
                        Diagnostics.note("No answer from the TV for 15 seconds; stopped watching")
                        current()?.let { remember(it, _playback.value.position) }
                        _notice.value = "Lost contact with the TV. Is it still on?"
                        _playback.update { it.copy(state = Playback.STOPPED) }
                        break
                    }
                    continue
                }
                silentTicks = 0

                val raw = progress?.position
                if (raw != null && raw > 0) tvKnowsPosition = true
                val reported = raw?.takeIf { it > 0 || tvKnowsPosition }

                _playback.update { p ->
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
                        state = if (settled) state!! else p.state,
                    )
                }
                if (state == Playback.PLAYING) reachedWhilePlaying = _playback.value.position

                // Save progress now and then, so a phone that dies mid-film still resumes.
                if (state == Playback.PLAYING && now > seekGuardUntil && now - lastSaved > 10_000) {
                    lastSaved = now
                    current()?.let { remember(it, _playback.value.position) }
                }

                // A scrub asked for before the TV was ready goes out now.
                val held = pendingSeek
                if (held != null && now - startedAt > 3000 &&
                    (state == Playback.PLAYING || state == Playback.PAUSED)
                ) {
                    pendingSeek = null
                    seekGuardUntil = now + 5000
                    sendSeek(renderer, held)
                }

                val old = now - startedAt > 6000 && now > seekGuardUntil
                if (old && (state == Playback.STOPPED || state == "NO_MEDIA_PRESENT")) {
                    stoppedTicks++
                    if (stoppedTicks >= 3) {
                        val duration = _playback.value.duration
                        val finished = duration <= 0 ||
                            reachedWhilePlaying >= duration - endMargin(duration)
                        if (finished) {
                            onFinished()
                        } else {
                            // Stopped from the TV's own remote, partway through. Leave it
                            // there rather than start the next video on someone who just
                            // pressed stop.
                            Diagnostics.note(
                                "TV stopped at ${Media.formatTime(reachedWhilePlaying)} of " +
                                    "${Media.formatTime(duration)}; not advancing the queue"
                            )
                            current()?.let { remember(it, reachedWhilePlaying) }
                            _playback.update { it.copy(state = Playback.STOPPED) }
                        }
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
        // Watched to the end: nothing to resume. Zero the position too, so starting the next
        // video doesn't note this one as left near its end.
        current()?.let { remember(it, 0) }
        _playback.update { it.copy(position = 0) }
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
