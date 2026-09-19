package com.tempshantaram.toss

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.util.Locale
import kotlin.random.Random

/** A subtitle file sitting alongside a video in the queue. */
data class Subtitle(val uri: Uri, val name: String) {
    val ext: String
        get() {
            val e = name.substringAfterLast('.', "").lowercase(Locale.US)
            return if (e.isEmpty() || e.length > 4) "srt" else e
        }
}

/** One thing to send to the TV. */
data class Item(
    val id: String,
    val uri: Uri,
    val title: String,
    val mime: String,
    val size: Long,
    val subtitle: Subtitle? = null,
) {
    val ext: String
        get() {
            val e = title.substringAfterLast('.', "").lowercase(Locale.US)
            return if (e.isEmpty() || e.length > 4) "mp4" else e
        }

    val displayTitle: String
        get() = title.substringBeforeLast('.').replace('_', ' ').replace('.', ' ').trim()
}

object Media {

    /** Display name and byte size, both of which the TV wants to know up front. */
    fun describe(context: Context, uri: Uri): Pair<String, Long> {
        var name: String? = null
        var size = -1L
        try {
            context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni)
                    val si = c.getColumnIndex(OpenableColumns.SIZE)
                    if (si >= 0 && !c.isNull(si)) size = c.getLong(si)
                }
            }
        } catch (_: Exception) {
        }
        if (size < 0) {
            try {
                context.contentResolver.openFileDescriptor(uri, "r")?.use { size = it.statSize }
            } catch (_: Exception) {
            }
        }
        val fallback = uri.lastPathSegment?.substringAfterLast('/') ?: "video"
        return Pair(name ?: fallback, if (size < 0) 0L else size)
    }

    fun item(context: Context, uri: Uri): Item {
        val (name, size) = describe(context, uri)
        val declared = try {
            context.contentResolver.getType(uri)
        } catch (_: Exception) {
            null
        }
        return Item(id = newId(), uri = uri, title = name, mime = videoMime(name, declared), size = size)
    }

    fun subtitle(context: Context, uri: Uri): Subtitle {
        val (name, _) = describe(context, uri)
        return Subtitle(uri, name)
    }

    /**
     * Renderers refuse anything they don't recognise, and many report a generic type for
     * content:// URIs, so trust the file extension first.
     */
    fun videoMime(name: String, declared: String?): String {
        val byExt = when (name.substringAfterLast('.', "").lowercase(Locale.US)) {
            "mp4", "m4v" -> "video/mp4"
            "mkv" -> "video/x-matroska"
            "avi" -> "video/x-msvideo"
            "mov" -> "video/quicktime"
            "webm" -> "video/webm"
            "ts", "m2ts", "mts" -> "video/mp2t"
            "3gp", "3gpp" -> "video/3gpp"
            "wmv", "asf" -> "video/x-ms-wmv"
            "mpg", "mpeg", "mpe" -> "video/mpeg"
            "flv" -> "video/x-flv"
            "ogv" -> "video/ogg"
            else -> null
        }
        if (byExt != null) return byExt
        if (declared != null && declared.startsWith("video/")) return declared
        return "video/mp4"
    }

    fun subtitleMime(ext: String): String = when (ext) {
        "vtt" -> "text/vtt"
        "smi", "sami" -> "application/smil"
        "ass", "ssa" -> "text/x-ssa"
        "sub" -> "text/plain"
        else -> "text/srt"
    }

    /** Short, URL-safe, and fresh every time so the TV never serves us its own cache. */
    fun newId(): String {
        val n = Random.nextInt(0x10000, 0x7fffffff).toString(36)
        return "m$n"
    }

    fun formatSize(bytes: Long): String {
        if (bytes <= 0) return "unknown size"
        val gb = bytes / 1_000_000_000.0
        if (gb >= 1) return String.format(Locale.US, "%.1f GB", gb)
        val mb = bytes / 1_000_000.0
        return String.format(Locale.US, "%.0f MB", mb)
    }

    fun formatTime(seconds: Int): String {
        if (seconds < 0) return "0:00"
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
        else String.format(Locale.US, "%d:%02d", m, s)
    }
}
