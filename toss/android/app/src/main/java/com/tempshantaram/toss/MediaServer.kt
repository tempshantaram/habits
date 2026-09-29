package com.tempshantaram.toss

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets

/**
 * A small HTTP server so the TV has somewhere to pull the video from. The phone's files live
 * behind content:// URIs the TV can't touch, so everything is re-served here over the LAN,
 * with byte ranges (the TV seeks by asking for a range) and the header Samsung sets look for
 * when deciding whether a video has subtitles.
 */
class MediaServer(private val context: Context) {

    companion object {
        private const val TAG = "TossServer"
        private const val BUFFER = 128 * 1024
        const val DLNA_FLAGS = "01700000000000000000000000000000"
    }

    @Volatile
    private var server: ServerSocket? = null

    @Volatile
    private var items: Map<String, Item> = emptyMap()

    @Volatile
    var port: Int = 0
        private set

    @Volatile
    var host: String? = null
        private set

    private var cachedKey: String? = null
    private var cachedSubtitle: ByteArray? = null

    val running: Boolean get() = server != null

    @Synchronized
    fun start(): Boolean {
        if (server != null) {
            host = wifiAddress() ?: host
            return true
        }
        return try {
            val socket = ServerSocket()
            socket.reuseAddress = true
            socket.bind(InetSocketAddress(0), 64)
            server = socket
            port = socket.localPort
            host = wifiAddress()
            Thread({ acceptLoop(socket) }, "toss-http").apply { isDaemon = true }.start()
            Log.i(TAG, "serving on ${host ?: "?"}:$port")
            true
        } catch (e: Exception) {
            Log.e(TAG, "could not start: ${e.message}")
            server = null
            false
        }
    }

    @Synchronized
    fun stop() {
        try {
            server?.close()
        } catch (_: Exception) {
        }
        server = null
        port = 0
    }

    fun publish(list: List<Item>) {
        items = list.associateBy { it.id }
    }

    fun videoUrl(item: Item): String? {
        val address = host ?: wifiAddress()?.also { host = it } ?: return null
        if (port == 0) return null
        return "http://$address:$port/v/${item.id}.${item.ext}"
    }

    fun subtitleUrl(item: Item): String? {
        val subtitle = item.subtitle ?: return null
        val address = host ?: wifiAddress()?.also { host = it } ?: return null
        if (port == 0) return null
        return "http://$address:$port/s/${item.id}.${subtitle.ext}"
    }

    /** The address the TV has to be able to reach — the phone's Wi-Fi one, not mobile data. */
    fun wifiAddress(): String? {
        var fallback: String? = null
        try {
            for (nif in NetworkInterface.getNetworkInterfaces()) {
                if (!nif.isUp || nif.isLoopback) continue
                for (address in nif.inetAddresses) {
                    val ip = address.hostAddress ?: continue
                    if (address.isLoopbackAddress || ip.contains(':')) continue
                    val name = nif.name.lowercase()
                    if (name.startsWith("wlan") || name.startsWith("ap")) return ip
                    if (fallback == null) fallback = ip
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "no address: ${e.message}")
        }
        return fallback
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (!socket.isClosed) {
            val client = try {
                socket.accept()
            } catch (e: IOException) {
                if (socket.isClosed) break
                Log.w(TAG, "accept failed: ${e.message}")
                continue
            }
            Thread({ handle(client) }, "toss-client").apply { isDaemon = true }.start()
        }
        Log.i(TAG, "stopped serving")
    }

    private fun handle(client: Socket) {
        try {
            client.soTimeout = 30_000
            client.tcpNoDelay = true
            val input = client.getInputStream().buffered()
            val output = client.getOutputStream().buffered(BUFFER)

            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(' ')
            if (parts.size < 2) return
            val method = parts[0].uppercase()
            val path = parts[1]

            val headers = HashMap<String, String>()
            while (true) {
                val line = readLine(input) ?: break
                if (line.isEmpty()) break
                val i = line.indexOf(':')
                if (i > 0) headers[line.substring(0, i).trim().lowercase()] =
                    line.substring(i + 1).trim()
            }

            if (method != "GET" && method != "HEAD") {
                writeStatus(output, 405, "Method Not Allowed")
                return
            }
            route(
                output = output,
                method = method,
                path = path,
                range = headers["range"],
                timeSeek = headers["timeseekrange.dlna.org"],
            )
            output.flush()
        } catch (e: Exception) {
            // The TV closes connections whenever it seeks; that is not worth a fuss.
            Log.v(TAG, "client gone: ${e.message}")
        } finally {
            try {
                client.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun route(
        output: OutputStream,
        method: String,
        path: String,
        range: String?,
        timeSeek: String?,
    ) {
        val clean = path.substringBefore('?')
        Diagnostics.note(
            buildString {
                append("$method $clean")
                if (range != null) append("  Range: $range")
                if (timeSeek != null) append("  TimeSeek: $timeSeek")
            }
        )
        when {
            clean.startsWith("/v/") -> {
                val item = items[idOf(clean, "/v/")]
                if (item == null) {
                    writeStatus(output, 404, "Not Found")
                } else {
                    serveVideo(output, method, item, range, timeSeek)
                }
            }

            clean.startsWith("/s/") -> {
                val item = items[idOf(clean, "/s/")]
                val subtitle = item?.subtitle
                if (item == null || subtitle == null) {
                    writeStatus(output, 404, "Not Found")
                } else {
                    serveSubtitle(output, method, item, subtitle, range)
                }
            }

            clean == "/" -> {
                val body = "Toss is serving ${items.size} item(s).\n".toByteArray()
                writeHeaders(output, 200, "OK", "text/plain", body.size.toLong(), null, emptyMap())
                if (method == "GET") output.write(body)
            }

            else -> writeStatus(output, 404, "Not Found")
        }
    }

    private fun idOf(path: String, prefix: String): String =
        path.removePrefix(prefix).substringBeforeLast('.')

    private fun serveVideo(
        output: OutputStream,
        method: String,
        item: Item,
        range: String?,
        timeSeek: String?,
    ) {
        val extra = HashMap<String, String>()
        extra["transferMode.dlna.org"] = "Streaming"
        extra["contentFeatures.dlna.org"] = features(item)
        subtitleUrl(item)?.let {
            // Samsung reads these two; other renderers ignore them.
            extra["CaptionInfo.sec"] = it
            extra["CaptionInfoEx.sec"] = it
        }

        // Time seeking isn't advertised, but some sets ask anyway. A TV that does has already
        // shown it won't seek this file by bytes, so an approximate answer beats a restart.
        var effective = range
        if (timeSeek != null) {
            val start = parseNpt(timeSeek)
            if (start == null || item.duration <= 0 || item.size <= 0) {
                // The spec's way of saying "seek by bytes instead"; answering 200 here is what
                // makes a TV silently restart from the beginning.
                Diagnostics.note("  no duration for a time seek -> 406, TV should use bytes")
                writeStatus(output, 406, "Not Acceptable")
                return
            }
            val clamped = start.coerceIn(0, item.duration)
            val byteStart = (item.size.toDouble() * clamped / item.duration)
                .toLong()
                .coerceIn(0, item.size - 1)
            effective = "bytes=$byteStart-"
            extra["TimeSeekRange.dlna.org"] =
                "npt=$clamped.000-${item.duration}.000/${item.duration}.000 " +
                    "bytes=$byteStart-${item.size - 1}/${item.size}"
            Diagnostics.note("  time seek ${clamped}s -> byte $byteStart of ${item.size}")
        }

        serveUri(output, method, item.uri, item.mime, item.size, effective, extra)
    }

    /** Byte seeking only; see [Upnp.didl] for why time seeking isn't claimed. */
    @Suppress("UNUSED_PARAMETER")
    private fun features(item: Item): String =
        "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=$DLNA_FLAGS"

    /** "npt=123.5-" or "npt=00:02:03.5-00:04:00" -> the start, in whole seconds. */
    private fun parseNpt(header: String): Int? {
        val value = header.substringAfter("npt=", "").trim()
        if (value.isEmpty()) return null
        val start = value.substringBefore('-').trim()
        if (start.isEmpty()) return null
        return if (start.contains(':')) {
            Upnp.parseTime(start)
        } else {
            start.toDoubleOrNull()?.toInt()
        }
    }

    /**
     * Subtitles are rendered rather than passed through: normalised to UTF-8, and restyled if
     * the second line is set to a colour of its own. The result is small, so it is held in
     * memory — the TV usually asks for it more than once.
     */
    private fun serveSubtitle(
        output: OutputStream,
        method: String,
        item: Item,
        subtitle: Subtitle,
        range: String?,
    ) {
        val bytes = rendered(subtitle, item.subtitleOffsetMs)
        if (bytes == null) {
            writeStatus(output, 404, "Not Found")
            return
        }
        serveBytes(
            output = output,
            method = method,
            bytes = bytes,
            mime = "${Media.subtitleMime(subtitle.ext)}; charset=utf-8",
            range = range,
            extra = mapOf("transferMode.dlna.org" to "Interactive"),
        )
    }

    @Synchronized
    private fun rendered(subtitle: Subtitle, offsetMs: Int): ByteArray? {
        val style = Settings.subtitleStyle.value
        val key = "${subtitle.uri}|${style.enabled}|${style.color}|${style.italic}|$offsetMs"
        val held = cachedSubtitle
        if (key == cachedKey && held != null) return held
        val fresh = Subtitles.render(context, subtitle, style, offsetMs) ?: return null
        cachedKey = key
        cachedSubtitle = fresh
        return fresh
    }

    private fun serveBytes(
        output: OutputStream,
        method: String,
        bytes: ByteArray,
        mime: String,
        range: String?,
        extra: Map<String, String>,
    ) {
        val total = bytes.size.toLong()
        val requested = parseRange(range, total)
        if (requested != null && (requested.first >= total || requested.first > requested.second)) {
            writeHeaders(output, 416, "Requested Range Not Satisfiable", mime, 0, "bytes */$total", extra)
            return
        }
        val start = requested?.first ?: 0L
        val end = requested?.second ?: (total - 1)
        val length = end - start + 1
        val contentRange = if (requested != null) "bytes $start-$end/$total" else null
        writeHeaders(
            output,
            if (requested != null) 206 else 200,
            if (requested != null) "Partial Content" else "OK",
            mime,
            length,
            contentRange,
            extra,
        )
        if (method == "GET") {
            output.write(bytes, start.toInt(), length.toInt())
            output.flush()
        }
    }

    private fun serveUri(
        output: OutputStream,
        method: String,
        uri: Uri,
        mime: String,
        knownSize: Long,
        range: String?,
        extra: Map<String, String>,
    ) {
        val descriptor = try {
            context.contentResolver.openFileDescriptor(uri, "r")
        } catch (e: SecurityException) {
            Log.w(TAG, "lost access to $uri: ${e.message}")
            writeStatus(output, 403, "Forbidden")
            return
        } catch (e: Exception) {
            Log.w(TAG, "cannot open $uri: ${e.message}")
            writeStatus(output, 404, "Not Found")
            return
        }
        if (descriptor == null) {
            writeStatus(output, 404, "Not Found")
            return
        }

        var streaming = false
        try {
            val total = if (knownSize > 0) knownSize else descriptor.statSize
            if (total <= 0) {
                // Unknown length: no ranges, just push bytes until the file ends.
                writeHeaders(output, 200, "OK", mime, -1, null, extra)
                if (method == "GET") {
                    streaming = true
                    ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { stream ->
                        copy(stream, output, Long.MAX_VALUE)
                    }
                }
                return
            }

            val requested = parseRange(range, total)
            if (requested != null && (requested.first >= total || requested.first > requested.second)) {
                writeHeaders(
                    output, 416, "Requested Range Not Satisfiable", mime, 0,
                    "bytes */$total", extra,
                )
                return
            }

            val start = requested?.first ?: 0L
            val end = requested?.second ?: (total - 1)
            val length = end - start + 1
            val contentRange = if (requested != null) "bytes $start-$end/$total" else null
            val status = if (requested != null) 206 else 200
            val reason = if (requested != null) "Partial Content" else "OK"
            Diagnostics.note("  -> $status, $length bytes from $start of $total")
            writeHeaders(output, status, reason, mime, length, contentRange, extra)

            if (method == "GET") {
                streaming = true
                ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { stream ->
                    if (start > 0 && !seekTo(stream, start)) {
                        Diagnostics.note("  this file cannot be seeked within; sending nothing")
                        return
                    }
                    copy(stream, output, length)
                }
            }
        } catch (e: Exception) {
            Log.v(TAG, "serve ended: ${e.message}")
        } finally {
            if (!streaming) {
                try {
                    descriptor.close()
                } catch (_: Exception) {
                }
            }
        }
    }

    /**
     * Most picked files are real files and this is one lseek. Some providers hand over a pipe
     * instead, where positioning throws and the only way forward is to read and discard —
     * worth doing, because the alternative is the TV being served the wrong bytes and quietly
     * playing from the start.
     */
    private fun seekTo(stream: FileInputStream, start: Long): Boolean = try {
        stream.channel.position(start)
        stream.channel.position() == start
    } catch (_: Exception) {
        var remaining = start
        var ok = true
        while (remaining > 0 && ok) {
            val skipped = stream.skip(remaining)
            if (skipped <= 0) ok = false else remaining -= skipped
        }
        ok
    }

    private fun copy(input: InputStream, output: OutputStream, limit: Long) {
        val buffer = ByteArray(BUFFER)
        var remaining = limit
        while (remaining > 0) {
            val want = if (remaining < BUFFER) remaining.toInt() else BUFFER
            val read = input.read(buffer, 0, want)
            if (read <= 0) break
            output.write(buffer, 0, read)
            remaining -= read
        }
        output.flush()
    }

    /** "bytes=100-" or "bytes=100-200". Only the first range; nobody sends more than one. */
    private fun parseRange(header: String?, total: Long): Pair<Long, Long>? {
        if (header == null || !header.startsWith("bytes=")) return null
        val spec = header.removePrefix("bytes=").split(',')[0].trim()
        val dash = spec.indexOf('-')
        if (dash < 0) return null
        val startText = spec.substring(0, dash)
        val endText = spec.substring(dash + 1)
        return try {
            if (startText.isEmpty()) {
                val tail = endText.toLong()
                if (tail <= 0) null else Pair((total - tail).coerceAtLeast(0), total - 1)
            } else {
                val start = startText.toLong()
                val end = if (endText.isEmpty()) total - 1 else endText.toLong().coerceAtMost(total - 1)
                Pair(start, end)
            }
        } catch (_: NumberFormatException) {
            null
        }
    }

    private fun writeStatus(output: OutputStream, code: Int, reason: String) {
        writeHeaders(output, code, reason, "text/plain", 0, null, emptyMap())
    }

    private fun writeHeaders(
        output: OutputStream,
        code: Int,
        reason: String,
        mime: String,
        length: Long,
        contentRange: String?,
        extra: Map<String, String>,
    ) {
        val head = buildString {
            append("HTTP/1.1 $code $reason\r\n")
            append("Server: Toss/1.0 UPnP/1.0 DLNADOC/1.50\r\n")
            append("Content-Type: $mime\r\n")
            append("Accept-Ranges: bytes\r\n")
            if (length >= 0) append("Content-Length: $length\r\n")
            if (contentRange != null) append("Content-Range: $contentRange\r\n")
            for ((key, value) in extra) append("$key: $value\r\n")
            append("Connection: close\r\n\r\n")
        }
        output.write(head.toByteArray(StandardCharsets.US_ASCII))
    }

    private fun readLine(input: InputStream): String? {
        val builder = StringBuilder()
        while (true) {
            val b = input.read()
            if (b < 0) return if (builder.isEmpty()) null else builder.toString()
            if (b == '\n'.code) return builder.toString().removeSuffix("\r")
            builder.append(b.toChar())
            if (builder.length > 8192) return builder.toString()
        }
    }
}
