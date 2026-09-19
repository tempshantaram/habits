package com.tempshantaram.toss

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
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
        const val DLNA_FEATURES =
            "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"
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
            route(output, method, path, headers["range"])
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

    private fun route(output: OutputStream, method: String, path: String, range: String?) {
        val clean = path.substringBefore('?')
        when {
            clean.startsWith("/v/") -> {
                val item = items[idOf(clean, "/v/")]
                if (item == null) {
                    writeStatus(output, 404, "Not Found")
                } else {
                    serveVideo(output, method, item, range)
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

    private fun serveVideo(output: OutputStream, method: String, item: Item, range: String?) {
        val extra = HashMap<String, String>()
        extra["transferMode.dlna.org"] = "Streaming"
        extra["contentFeatures.dlna.org"] = DLNA_FEATURES
        subtitleUrl(item)?.let {
            // Samsung reads these two; other renderers ignore them.
            extra["CaptionInfo.sec"] = it
            extra["CaptionInfoEx.sec"] = it
        }
        serveUri(output, method, item.uri, item.mime, item.size, range, extra)
    }

    private fun serveSubtitle(
        output: OutputStream,
        method: String,
        item: Item,
        subtitle: Subtitle,
        range: String?,
    ) {
        val extra = mapOf("transferMode.dlna.org" to "Interactive")
        serveUri(output, method, subtitle.uri, Media.subtitleMime(subtitle.ext), 0, range, extra)
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
            writeHeaders(output, status, reason, mime, length, contentRange, extra)

            if (method == "GET") {
                streaming = true
                ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { stream ->
                    if (start > 0) stream.channel.position(start)
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
