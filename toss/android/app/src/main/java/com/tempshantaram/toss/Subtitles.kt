package com.tempshantaram.toss

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Locale

/**
 * How to treat the lines after the first in each subtitle cue. For a merged bilingual file
 * that means the second language: usually worth knocking back so the eye finds the first
 * line without effort.
 */
data class SubtitleStyle(
    val enabled: Boolean = false,
    val color: String = DIM,
    val italic: Boolean = false,
) {
    companion object {
        const val DIM = "#9AA8A0"
        const val GREY = "#C0C7C2"
        const val AMBER = "#E8C26A"
        const val CYAN = "#8CD3E8"
        const val WHITE = "#FFFFFF"

        val choices = listOf(
            DIM to "Dim",
            GREY to "Grey",
            AMBER to "Amber",
            CYAN to "Cyan",
            WHITE to "White",
        )
    }
}

object Settings {

    private const val FILE = "toss"
    private const val KEY_ON = "subtitle_second_line"
    private const val KEY_COLOR = "subtitle_second_color"
    private const val KEY_ITALIC = "subtitle_second_italic"

    private var prefs: SharedPreferences? = null

    private val _subtitleStyle = MutableStateFlow(SubtitleStyle())
    val subtitleStyle: StateFlow<SubtitleStyle> = _subtitleStyle.asStateFlow()

    fun load(context: Context) {
        if (prefs != null) return
        val store = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        prefs = store
        _subtitleStyle.value = SubtitleStyle(
            enabled = store.getBoolean(KEY_ON, false),
            color = store.getString(KEY_COLOR, SubtitleStyle.DIM) ?: SubtitleStyle.DIM,
            italic = store.getBoolean(KEY_ITALIC, false),
        )
    }

    fun setSubtitleStyle(style: SubtitleStyle) {
        _subtitleStyle.value = style
        prefs?.edit()
            ?.putBoolean(KEY_ON, style.enabled)
            ?.putString(KEY_COLOR, style.color)
            ?.putBoolean(KEY_ITALIC, style.italic)
            ?.apply()
    }
}

/**
 * Subtitles are rewritten on their way to the TV rather than served raw: the text is
 * normalised to UTF-8 (files in the wild are often Windows-1252, which arrives as mojibake),
 * and the lines after the first in each cue can be given a colour of their own.
 */
object Subtitles {

    fun render(
        context: Context,
        subtitle: Subtitle,
        style: SubtitleStyle,
        offsetMs: Int = 0,
    ): ByteArray? {
        val raw = try {
            context.contentResolver.openInputStream(subtitle.uri)?.use { it.readBytes() }
        } catch (e: Exception) {
            Diagnostics.note("Subtitle unreadable: ${e.message}")
            null
        } ?: return null

        val decoded = decode(raw)
        var text = decoded.text
        val timed = offsetMs != 0 && (subtitle.ext == "srt" || subtitle.ext == "vtt")
        if (timed) text = shift(text, offsetMs)
        if (style.enabled && subtitle.ext == "srt") text = styleSrt(text, style)
        // UTF-8 with a byte order mark whenever there is anything beyond plain ASCII. It's
        // what Subtitle Edit writes by default, and without the mark some Samsung sets fall
        // back to a legacy code page and turn accents and non-Latin script into nonsense.
        val body = text.toByteArray(StandardCharsets.UTF_8)
        val marked = text.any { it.code > 127 }
        Diagnostics.note(
            "Subtitle ${subtitle.name}: read as ${decoded.charset}, sent as UTF-8" +
                (if (marked) " with BOM" else "") +
                (if (timed) ", shifted ${offsetMs}ms" else "") +
                if (style.enabled && subtitle.ext == "srt") ", second line ${style.color}" else ""
        )
        return if (marked) BOM + body else body
    }

    private val BOM = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte())

    /**
     * The subtitle as a file to keep, for editing elsewhere: timing nudges applied, since
     * they correct the file, but no colour, which is only for the TV. Plain UTF-8 with CRLF
     * line endings is what subtitle editors expect.
     */
    fun export(context: Context, subtitle: Subtitle, offsetMs: Int): ByteArray? {
        val raw = try {
            context.contentResolver.openInputStream(subtitle.uri)?.use { it.readBytes() }
        } catch (_: Exception) {
            null
        } ?: return null
        var text = decode(raw).text
        if (offsetMs != 0 && (subtitle.ext == "srt" || subtitle.ext == "vtt")) text = shift(text, offsetMs)
        text = text.replace("\r\n", "\n").replace('\r', '\n').replace("\n", "\r\n")
        return text.toByteArray(StandardCharsets.UTF_8)
    }

    private data class Decoded(val text: String, val charset: String)

    /** 00:01:02,345 (SRT) or 00:01:02.345 / 01:02.345 (WebVTT). */
    private val TIMESTAMP = Regex("""(?:(\d{1,2}):)?(\d{2}):(\d{2})([,.])(\d{3})""")

    /**
     * Move every cue by the same amount. Only timing lines are touched — a line of dialogue
     * that happens to contain a time is left alone — and nothing is pushed before zero.
     */
    private fun shift(text: String, offsetMs: Int): String =
        text.split("\n").joinToString("\n") { line ->
            if (!line.contains("-->")) {
                line
            } else {
                TIMESTAMP.replace(line) { m ->
                    val hours = m.groupValues[1].ifEmpty { "0" }.toLong()
                    val minutes = m.groupValues[2].toLong()
                    val seconds = m.groupValues[3].toLong()
                    val millis = m.groupValues[5].toLong()
                    val total = ((hours * 3600 + minutes * 60 + seconds) * 1000 + millis + offsetMs)
                        .coerceAtLeast(0L)
                    String.format(
                        Locale.US,
                        "%02d:%02d:%02d%s%03d",
                        total / 3_600_000,
                        (total / 60_000) % 60,
                        (total / 1000) % 60,
                        m.groupValues[4],
                        total % 1000,
                    )
                }
            }
        }

    /**
     * UTF-16 or UTF-8 when marked as such; otherwise UTF-8 if it decodes cleanly, and
     * Windows-1252 if it doesn't. Any byte order mark is consumed here and re-added on output.
     */
    private fun decode(bytes: ByteArray): Decoded {
        if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) {
            return Decoded(String(bytes, 2, bytes.size - 2, StandardCharsets.UTF_16LE), "UTF-16LE")
        }
        if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
            return Decoded(String(bytes, 2, bytes.size - 2, StandardCharsets.UTF_16BE), "UTF-16BE")
        }
        if (bytes.size >= 3 &&
            bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()
        ) {
            return Decoded(String(bytes, 3, bytes.size - 3, StandardCharsets.UTF_8), "UTF-8 (BOM)")
        }
        return try {
            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            Decoded(decoder.decode(ByteBuffer.wrap(bytes)).toString(), "UTF-8")
        } catch (_: Exception) {
            val fallback = try {
                Charset.forName("windows-1252")
            } catch (_: Exception) {
                StandardCharsets.ISO_8859_1
            }
            Decoded(String(bytes, fallback), fallback.name())
        }
    }

    /**
     * Walk the cues, leave the timings alone, and wrap every line after the first. A block
     * that doesn't look like a cue is passed through untouched — a malformed subtitle should
     * still reach the TV as it was. Line endings come out as CRLF, which is what SRT has always
     * used and what the strictest TV parsers insist on.
     */
    private fun styleSrt(text: String, style: SubtitleStyle): String {
        val open = buildString {
            append("<font color=\"${style.color}\">")
            if (style.italic) append("<i>")
        }
        val close = buildString {
            if (style.italic) append("</i>")
            append("</font>")
        }

        val out = StringBuilder(text.length + 64)
        val lines = text.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        var textLineIndex = -1

        for (line in lines) {
            val trimmed = line.trim()
            when {
                trimmed.isEmpty() -> {
                    textLineIndex = -1
                    out.append("\r\n")
                }

                trimmed.contains("-->") -> {
                    textLineIndex = 0
                    out.append(line).append("\r\n")
                }

                textLineIndex < 0 -> out.append(line).append("\r\n")

                else -> {
                    if (textLineIndex > 0) {
                        out.append(open).append(line).append(close).append("\r\n")
                    } else {
                        out.append(line).append("\r\n")
                    }
                    textLineIndex++
                }
            }
        }
        return out.toString()
    }
}
