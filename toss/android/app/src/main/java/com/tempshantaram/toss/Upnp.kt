package com.tempshantaram.toss

import android.util.Log
import org.w3c.dom.Document
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object Http {

    private const val TAG = "TossHttp"

    fun get(url: String, timeoutMs: Int = 5000): String? = try {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        connection.requestMethod = "GET"
        connection.setRequestProperty("User-Agent", "Android/12 UPnP/1.0 Toss/1.0")
        connection.setRequestProperty("Connection", "close")
        try {
            connection.inputStream.use { it.bufferedReader().readText() }
        } finally {
            connection.disconnect()
        }
    } catch (e: Exception) {
        Log.w(TAG, "GET $url failed: ${e.message}")
        null
    }
}

/** The outcome of a SOAP call: either a parsed response, or something worth showing the user. */
sealed class SoapResult {
    data class Ok(val body: Document?) : SoapResult()
    data class Failed(val message: String) : SoapResult()
}

class SoapService(private val controlUrl: String, private val serviceType: String) {

    private val tag = "TossSoap"

    fun invoke(action: String, args: List<Pair<String, String>> = emptyList()): SoapResult {
        val body = buildString {
            append("<?xml version=\"1.0\" encoding=\"utf-8\"?>")
            append("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" ")
            append("s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">")
            append("<s:Body>")
            append("<u:$action xmlns:u=\"$serviceType\">")
            for ((name, value) in args) append("<$name>${Xml.escape(value)}</$name>")
            append("</u:$action>")
            append("</s:Body></s:Envelope>")
        }.toByteArray(Charsets.UTF_8)

        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(controlUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = 6000
                readTimeout = 10000
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"")
                setRequestProperty("SOAPAction", "\"$serviceType#$action\"")
                setRequestProperty("User-Agent", "Android/12 UPnP/1.0 Toss/1.0")
                setRequestProperty("Connection", "close")
                setFixedLengthStreamingMode(body.size)
            }
            connection.outputStream.use { it.write(body) }

            val code = connection.responseCode
            if (code in 200..299) {
                val text = connection.inputStream.use { stream ->
                    BufferedReader(InputStreamReader(stream)).readText()
                }
                SoapResult.Ok(Xml.parse(text))
            } else {
                val text = connection.errorStream?.use { stream ->
                    BufferedReader(InputStreamReader(stream)).readText()
                } ?: ""
                val errorCode = Xml.text(Xml.parse(text), "errorCode")
                Log.w(tag, "$action -> HTTP $code, upnp ${errorCode ?: "?"}")
                SoapResult.Failed(Upnp.explain(errorCode, code))
            }
        } catch (e: Exception) {
            Log.w(tag, "$action failed: ${e.message}")
            SoapResult.Failed("The TV didn't answer (${e.javaClass.simpleName.removeSuffix("Exception")}).")
        } finally {
            connection?.disconnect()
        }
    }
}

object Upnp {

    const val AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1"
    const val RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1"

    /** UPnP error codes are numbers on a wire; these are the ones that actually turn up. */
    fun explain(errorCode: String?, httpCode: Int): String = when (errorCode) {
        "401" -> "The TV doesn't support that action."
        "402" -> "The TV rejected the request as malformed."
        "501" -> "The TV couldn't carry that out."
        "701" -> "The TV isn't ready for that right now — try stopping first."
        "710" -> "The TV couldn't open the video."
        "713" -> "The TV wouldn't seek there."
        "714" -> "The TV won't play this file type."
        "715" -> "The TV can't reach your phone — check you're both on the same Wi-Fi."
        "716" -> "The TV couldn't fetch the file from your phone."
        "718" -> "The TV is busy with something else."
        null -> "The TV returned an error (HTTP $httpCode)."
        else -> "The TV returned error $errorCode."
    }

    /**
     * DIDL-Lite describing one video. Samsung sets read subtitles out of the sec: elements,
     * not the second <res>, so send both and let the TV pick.
     */
    fun didl(item: Item, videoUrl: String, subtitleUrl: String?): String = buildString {
        append("<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" ")
        append("xmlns:dc=\"http://purl.org/dc/elements/1.1/\" ")
        append("xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\" ")
        append("xmlns:sec=\"http://www.sec.co.kr/\">")
        append("<item id=\"${item.id}\" parentID=\"0\" restricted=\"1\">")
        append("<dc:title>${Xml.escape(item.displayTitle)}</dc:title>")
        append("<upnp:class>object.item.videoItem</upnp:class>")
        if (subtitleUrl != null) {
            val type = item.subtitle?.ext ?: "srt"
            append("<sec:CaptionInfoEx sec:type=\"$type\">${Xml.escape(subtitleUrl)}</sec:CaptionInfoEx>")
            append("<sec:CaptionInfo sec:type=\"$type\">${Xml.escape(subtitleUrl)}</sec:CaptionInfo>")
        }
        val size = if (item.size > 0) " size=\"${item.size}\"" else ""
        append("<res protocolInfo=\"http-get:*:${item.mime}:")
        append("DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000\"")
        append(size)
        append(">${Xml.escape(videoUrl)}</res>")
        if (subtitleUrl != null) {
            val mime = Media.subtitleMime(item.subtitle?.ext ?: "srt")
            append("<res protocolInfo=\"http-get:*:$mime:*\">${Xml.escape(subtitleUrl)}</res>")
        }
        append("</item></DIDL-Lite>")
    }

    /** "0:01:23" or "0:01:23.000" -> seconds. */
    fun parseTime(value: String?): Int {
        if (value.isNullOrBlank() || value == "NOT_IMPLEMENTED") return 0
        val parts = value.trim().substringBefore('.').split(':')
        return try {
            when (parts.size) {
                3 -> parts[0].toInt() * 3600 + parts[1].toInt() * 60 + parts[2].toInt()
                2 -> parts[0].toInt() * 60 + parts[1].toInt()
                1 -> parts[0].toInt()
                else -> 0
            }
        } catch (_: NumberFormatException) {
            0
        }
    }

    fun formatTime(seconds: Int): String {
        val s = if (seconds < 0) 0 else seconds
        return String.format("%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }
}

/** The transport half of a renderer: load a URL, play it, move around inside it. */
class Transport(renderer: Renderer) {

    private val av = SoapService(renderer.avTransportUrl, Upnp.AV_TRANSPORT)
    private val rendering = renderer.renderingControlUrl?.let {
        SoapService(it, Upnp.RENDERING_CONTROL)
    }

    val hasVolume: Boolean = rendering != null

    fun setUri(url: String, metadata: String): SoapResult = av.invoke(
        "SetAVTransportURI",
        listOf("InstanceID" to "0", "CurrentURI" to url, "CurrentURIMetaData" to metadata),
    )

    fun play(): SoapResult = av.invoke("Play", listOf("InstanceID" to "0", "Speed" to "1"))

    fun pause(): SoapResult = av.invoke("Pause", listOf("InstanceID" to "0"))

    fun stop(): SoapResult = av.invoke("Stop", listOf("InstanceID" to "0"))

    fun seek(seconds: Int): SoapResult = av.invoke(
        "Seek",
        listOf("InstanceID" to "0", "Unit" to "REL_TIME", "Target" to Upnp.formatTime(seconds)),
    )

    /** position and duration in seconds, or null if the TV wouldn't say. */
    fun position(): Pair<Int, Int>? {
        val result = av.invoke("GetPositionInfo", listOf("InstanceID" to "0"))
        if (result !is SoapResult.Ok) return null
        val doc = result.body ?: return null
        val position = Upnp.parseTime(Xml.text(doc, "RelTime"))
        val duration = Upnp.parseTime(Xml.text(doc, "TrackDuration"))
        return Pair(position, duration)
    }

    /** PLAYING, PAUSED_PLAYBACK, STOPPED, TRANSITIONING, NO_MEDIA_PRESENT. */
    fun transportState(): String? {
        val result = av.invoke("GetTransportInfo", listOf("InstanceID" to "0"))
        if (result !is SoapResult.Ok) return null
        return Xml.text(result.body, "CurrentTransportState")
    }

    fun volume(): Int? {
        val service = rendering ?: return null
        val result = service.invoke(
            "GetVolume",
            listOf("InstanceID" to "0", "Channel" to "Master"),
        )
        if (result !is SoapResult.Ok) return null
        return Xml.text(result.body, "CurrentVolume")?.toIntOrNull()
    }

    fun setVolume(value: Int): SoapResult {
        val service = rendering ?: return SoapResult.Failed("This TV doesn't expose volume.")
        val clamped = value.coerceIn(0, 100)
        return service.invoke(
            "SetVolume",
            listOf("InstanceID" to "0", "Channel" to "Master", "DesiredVolume" to "$clamped"),
        )
    }
}
