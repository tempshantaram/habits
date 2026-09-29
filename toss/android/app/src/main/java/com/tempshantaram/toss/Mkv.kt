package com.tempshantaram.toss

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel
import java.util.Locale
import java.util.zip.Inflater

/** A subtitle track found inside a video file. */
data class EmbeddedTrack(
    /** The Matroska track number, or the track index for other containers. */
    val number: Long,
    /** srt, ass, ssa, vtt, tx3g — or pgs, vobsub, dvb and the like, which are pictures. */
    val codec: String,
    val language: String,
    val name: String,
    val isDefault: Boolean = false,
    val isForced: Boolean = false,
) {
    val readable: Boolean get() = codec in TEXT

    val pictures: Boolean get() = codec in PICTURES

    val label: String
        get() {
            val language = Languages.name(language)
            val title = name.trim()
            val main = when {
                title.isNotEmpty() && language.isNotEmpty() &&
                    !title.contains(language, ignoreCase = true) -> "$language — $title"
                title.isNotEmpty() -> title
                language.isNotEmpty() -> language
                else -> "Track $number"
            }
            val extras = buildList {
                add(codec.uppercase(Locale.US))
                if (isForced) add("forced")
                if (isDefault) add("default")
            }
            return "$main (${extras.joinToString(", ")})"
        }

    /** A short tag for the saved file name: the language code, or the track number. */
    val fileTag: String
        get() = language.substringBefore('-').lowercase(Locale.US)
            .takeIf { it.isNotEmpty() && it != "und" } ?: "track$number"

    companion object {
        val TEXT = setOf("srt", "ass", "ssa", "vtt", "tx3g")
        val PICTURES = setOf("pgs", "vobsub", "dvb")
    }
}

/** One subtitle line, in milliseconds. An end of -1 means the file didn't say. */
data class Cue(val start: Long, val end: Long, val text: String)

class MkvException(message: String) : Exception(message)

/**
 * Buffered reads over a seekable file, with skips that cost nothing until the next read.
 * Subtitle extraction walks every block header in the file but skips the video and audio
 * inside them, so most of the file is stepped over rather than read.
 */
class ChannelReader(private val channel: SeekableByteChannel) {

    private val buffer = ByteBuffer.allocate(16 * 1024)
    private var bufferStart = 0L
    private var bufferEnd = 0L

    var position = 0L
    val size: Long = channel.size()

    fun eof(): Boolean = position >= size

    private fun fill() {
        channel.position(position)
        buffer.clear()
        while (buffer.hasRemaining()) {
            if (channel.read(buffer) <= 0) break
        }
        buffer.flip()
        bufferStart = position
        bufferEnd = position + buffer.limit()
    }

    fun readByte(): Int {
        if (position < bufferStart || position >= bufferEnd) {
            fill()
            if (position >= bufferEnd) throw EOFException()
        }
        val b = buffer.get((position - bufferStart).toInt()).toInt() and 0xFF
        position++
        return b
    }

    fun readBytes(count: Int): ByteArray {
        val out = ByteArray(count)
        for (i in 0 until count) out[i] = readByte().toByte()
        return out
    }

    fun skip(count: Long) {
        position += count
    }

    fun seek(to: Long) {
        position = to
    }
}

/**
 * Just enough Matroska (MKV, WebM) to find subtitle tracks and read them out. Android's own
 * reader skips ASS tracks entirely and never says when a subtitle line ends; reading the
 * container directly gets both.
 */
class Mkv(private val reader: ChannelReader) {

    private companion object {
        const val EBML = 0x1A45DFA3L
        const val SEGMENT = 0x18538067L
        const val INFO = 0x1549A966L
        const val TIMECODE_SCALE = 0x2AD7B1L
        const val TRACKS = 0x1654AE6BL
        const val TRACK_ENTRY = 0xAEL
        const val TRACK_NUMBER = 0xD7L
        const val TRACK_TYPE = 0x83L
        const val CODEC_ID = 0x86L
        const val LANGUAGE = 0x22B59CL
        const val LANGUAGE_BCP47 = 0x22B59DL
        const val NAME = 0x536EL
        const val FLAG_DEFAULT = 0x88L
        const val FLAG_FORCED = 0x55AAL
        const val DEFAULT_DURATION = 0x23E383L
        const val CONTENT_ENCODINGS = 0x6D80L
        const val CONTENT_ENCODING = 0x6240L
        const val CONTENT_ENCODING_SCOPE = 0x5032L
        const val CONTENT_COMPRESSION = 0x5034L
        const val CONTENT_COMP_ALGO = 0x4254L
        const val CONTENT_COMP_SETTINGS = 0x4255L
        const val CONTENT_ENCRYPTION = 0x5035L
        const val CLUSTER = 0x1F43B675L
        const val CLUSTER_TIMECODE = 0xE7L
        const val SIMPLE_BLOCK = 0xA3L
        const val BLOCK_GROUP = 0xA0L
        const val BLOCK = 0xA1L
        const val BLOCK_DURATION = 0x9BL
        const val CUES = 0x1C53BB6BL
        const val CHAPTERS = 0x1043A770L
        const val TAGS = 0x1254C367L
        const val ATTACHMENTS = 0x1941A469L
        const val SEEK_HEAD = 0x114D9B74L

        const val SUBTITLE_TYPE = 0x11L

        /** Elements that can only appear directly inside the segment. */
        val LEVEL_ONE = setOf(CLUSTER, CUES, CHAPTERS, TAGS, ATTACHMENTS, SEEK_HEAD, INFO, TRACKS)

        /** A subtitle block larger than this is not text. */
        const val MAX_PAYLOAD = 1 shl 20
    }

    /** What's needed from a track to read its blocks. */
    private class TrackInfo(
        val track: EmbeddedTrack,
        val defaultDurationNs: Long,
        val compression: Int?,
        val strippedHeader: ByteArray,
        val encrypted: Boolean,
    )

    private var timecodeScale = 1_000_000L
    private var segmentStart = 0L
    private var segmentEnd = 0L

    // ---- EBML primitives ------------------------------------------------------------------

    private fun readId(): Long {
        val first = reader.readByte()
        val length = when {
            (first and 0x80) != 0 -> 1
            (first and 0x40) != 0 -> 2
            (first and 0x20) != 0 -> 3
            (first and 0x10) != 0 -> 4
            else -> throw MkvException("not a valid element id")
        }
        var id = first.toLong()
        repeat(length - 1) { id = (id shl 8) or reader.readByte().toLong() }
        return id
    }

    /** An element size; -1 for "unknown", which a streamed file may use. */
    private fun readSize(): Long {
        val first = reader.readByte()
        var mask = 0x80
        var length = 1
        while (length <= 8 && (first and mask) == 0) {
            mask = mask shr 1
            length++
        }
        if (length > 8) throw MkvException("not a valid element size")
        var value = (first and (mask - 1)).toLong()
        var allOnes = value == (mask - 1).toLong()
        repeat(length - 1) {
            val b = reader.readByte()
            if (b != 0xFF) allOnes = false
            value = (value shl 8) or b.toLong()
        }
        return if (allOnes) -1 else value
    }

    private fun readUnsigned(size: Long): Long {
        if (size > 8) throw MkvException("integer too wide")
        var value = 0L
        repeat(size.toInt()) { value = (value shl 8) or reader.readByte().toLong() }
        return value
    }

    private fun readString(size: Long): String {
        if (size > 4096) {
            reader.skip(size)
            return ""
        }
        return String(reader.readBytes(size.toInt()), Charsets.UTF_8).trimEnd('\u0000').trim()
    }

    // ---- the segment ----------------------------------------------------------------------

    private fun openSegment() {
        reader.seek(0)
        if (readId() != EBML) throw MkvException("not a Matroska file")
        val headerSize = readSize()
        if (headerSize < 0) throw MkvException("malformed header")
        reader.skip(headerSize)
        while (!reader.eof()) {
            val id = readId()
            val size = readSize()
            if (id == SEGMENT) {
                segmentStart = reader.position
                segmentEnd = if (size < 0) reader.size else minOf(reader.size, reader.position + size)
                return
            }
            if (size < 0) break
            reader.skip(size)
        }
        throw MkvException("no segment")
    }

    /**
     * Visit each element directly inside the segment. [visit] returns where to carry on
     * from, which for an element of known size is simply its end.
     */
    private fun walkSegment(visit: (id: Long, dataStart: Long, end: Long) -> Long?) {
        openSegment()
        var position = segmentStart
        while (position < segmentEnd) {
            reader.seek(position)
            val id = try {
                readId()
            } catch (_: EOFException) {
                return
            } catch (_: MkvException) {
                return
            }
            val size = readSize()
            val dataStart = reader.position
            val end = if (size < 0) -1 else dataStart + size
            val next = visit(id, dataStart, end) ?: return
            if (next <= position) return
            position = next
        }
    }

    // ---- tracks ---------------------------------------------------------------------------

    /** Every subtitle track, read from the header alone — this is quick. */
    fun subtitleTracks(): List<EmbeddedTrack> {
        val found = ArrayList<EmbeddedTrack>()
        walkSegment { id, dataStart, end ->
            when (id) {
                TRACKS -> {
                    readTracks(dataStart, end).forEach { found.add(it.track) }
                    null
                }
                CLUSTER -> null
                else -> if (end < 0) null else end
            }
        }
        return found
    }

    private fun readTracks(start: Long, end: Long): List<TrackInfo> {
        val out = ArrayList<TrackInfo>()
        val stop = if (end < 0) segmentEnd else end
        reader.seek(start)
        while (reader.position < stop) {
            val id = readId()
            val size = readSize()
            val childEnd = reader.position + size
            if (id == TRACK_ENTRY && size >= 0) readTrackEntry(childEnd)?.let { out.add(it) }
            reader.seek(childEnd)
        }
        return out
    }

    private fun readTrackEntry(end: Long): TrackInfo? {
        var number = 0L
        var type = 0L
        var codecId = ""
        var language = "eng"
        var bcp47 = ""
        var name = ""
        var isDefault = true
        var isForced = false
        var defaultDuration = 0L
        var compression: Int? = null
        var stripped = ByteArray(0)
        var encrypted = false

        while (reader.position < end) {
            val id = readId()
            val size = readSize()
            val childEnd = reader.position + size
            when (id) {
                TRACK_NUMBER -> number = readUnsigned(size)
                TRACK_TYPE -> type = readUnsigned(size)
                CODEC_ID -> codecId = readString(size)
                LANGUAGE -> language = readString(size)
                LANGUAGE_BCP47 -> bcp47 = readString(size)
                NAME -> name = readString(size)
                FLAG_DEFAULT -> isDefault = readUnsigned(size) != 0L
                FLAG_FORCED -> isForced = readUnsigned(size) != 0L
                DEFAULT_DURATION -> defaultDuration = readUnsigned(size)
                CONTENT_ENCODINGS -> {
                    val encoding = readEncodings(childEnd)
                    compression = encoding.first
                    stripped = encoding.second
                    encrypted = encoding.third
                }
            }
            reader.seek(childEnd)
        }
        if (type != SUBTITLE_TYPE) return null
        val track = EmbeddedTrack(
            number = number,
            codec = codecName(codecId),
            language = bcp47.ifEmpty { language },
            name = name,
            isDefault = isDefault,
            isForced = isForced,
        )
        return TrackInfo(track, defaultDuration, compression, stripped, encrypted)
    }

    /** (compression algorithm or null, stripped header bytes, encrypted?) for frames. */
    private fun readEncodings(end: Long): Triple<Int?, ByteArray, Boolean> {
        var compression: Int? = null
        var stripped = ByteArray(0)
        var encrypted = false
        while (reader.position < end) {
            val id = readId()
            val size = readSize()
            val encodingEnd = reader.position + size
            if (id == CONTENT_ENCODING) {
                var scope = 1L
                var algorithm: Int? = null
                var settings = ByteArray(0)
                while (reader.position < encodingEnd) {
                    val cid = readId()
                    val csize = readSize()
                    val cend = reader.position + csize
                    when (cid) {
                        CONTENT_ENCODING_SCOPE -> scope = readUnsigned(csize)
                        CONTENT_ENCRYPTION -> encrypted = true
                        CONTENT_COMPRESSION -> {
                            algorithm = 0
                            while (reader.position < cend) {
                                val kid = readId()
                                val ksize = readSize()
                                val kend = reader.position + ksize
                                when (kid) {
                                    CONTENT_COMP_ALGO -> algorithm = readUnsigned(ksize).toInt()
                                    CONTENT_COMP_SETTINGS ->
                                        settings = reader.readBytes(minOf(ksize, 4096L).toInt())
                                }
                                reader.seek(kend)
                            }
                        }
                    }
                    reader.seek(cend)
                }
                // Scope bit 1 means the encoding applies to the frames themselves.
                if ((scope and 1L) != 0L && algorithm != null) {
                    compression = algorithm
                    stripped = settings
                }
            }
            reader.seek(encodingEnd)
        }
        return Triple(compression, stripped, encrypted)
    }

    private fun codecName(id: String): String = when (id.uppercase(Locale.US)) {
        "S_TEXT/UTF8", "S_TEXT/ASCII" -> "srt"
        "S_TEXT/ASS", "S_ASS" -> "ass"
        "S_TEXT/SSA", "S_SSA" -> "ssa"
        // Matroska and WebM name WebVTT differently.
        "S_TEXT/WEBVTT", "D_WEBVTT/SUBTITLES", "D_WEBVTT/CAPTIONS" -> "vtt"
        "S_HDMV/PGS" -> "pgs"
        "S_VOBSUB" -> "vobsub"
        "S_DVBSUB" -> "dvb"
        else -> id.substringAfterLast('/').lowercase(Locale.US).ifEmpty { "unknown" }
    }

    // ---- reading one track out ------------------------------------------------------------

    /**
     * Every line of one subtitle track, in order. [progress] is told how far through the file
     * the read has got, from 0 to 100.
     */
    fun cues(trackNumber: Long, progress: (Int) -> Unit = {}): List<Cue> {
        var info: TrackInfo? = null
        val cues = ArrayList<Cue>()
        var lastReported = -1

        walkSegment { id, dataStart, end ->
            when (id) {
                INFO -> {
                    readInfo(dataStart, end)
                    end.takeIf { it >= 0 }
                }
                TRACKS -> {
                    info = readTracks(dataStart, end).firstOrNull { it.track.number == trackNumber }
                    end.takeIf { it >= 0 }
                }
                CLUSTER -> {
                    val wanted = info ?: throw MkvException("track $trackNumber not found")
                    if (wanted.encrypted) throw MkvException("the track is encrypted")
                    val next = readCluster(dataStart, end, wanted, cues)
                    val percent = ((next.toDouble() / reader.size) * 100).toInt().coerceIn(0, 100)
                    if (percent != lastReported) {
                        lastReported = percent
                        progress(percent)
                    }
                    next
                }
                else -> end.takeIf { it >= 0 }
            }
        }
        if (info == null) throw MkvException("track $trackNumber not found")
        return finish(cues)
    }

    private fun readInfo(start: Long, end: Long) {
        val stop = if (end < 0) segmentEnd else end
        reader.seek(start)
        while (reader.position < stop) {
            val id = readId()
            val size = readSize()
            val childEnd = reader.position + size
            if (id == TIMECODE_SCALE) timecodeScale = readUnsigned(size).takeIf { it > 0 } ?: 1_000_000L
            reader.seek(childEnd)
        }
    }

    /**
     * Read one cluster's subtitle blocks and step over everything else. Returns where the
     * cluster ends; for a cluster of unknown size, that's wherever the next top-level
     * element begins.
     */
    private fun readCluster(start: Long, end: Long, track: TrackInfo, out: MutableList<Cue>): Long {
        val stop = if (end < 0) segmentEnd else end
        var clusterTime = 0L
        reader.seek(start)
        while (reader.position < stop) {
            val elementStart = reader.position
            val id = try {
                readId()
            } catch (_: EOFException) {
                return stop
            }
            if (end < 0 && id in LEVEL_ONE) return elementStart
            val size = readSize()
            if (size < 0) return stop
            val childEnd = reader.position + size
            when (id) {
                CLUSTER_TIMECODE -> clusterTime = readUnsigned(size)
                SIMPLE_BLOCK -> readBlock(childEnd, clusterTime, -1, track)?.let { out.add(it) }
                BLOCK_GROUP -> readGroup(childEnd, clusterTime, track)?.let { out.add(it) }
            }
            reader.seek(childEnd)
        }
        return stop
    }

    private fun readGroup(end: Long, clusterTime: Long, track: TrackInfo): Cue? {
        var blockStart = -1L
        var blockEnd = -1L
        var duration = -1L
        while (reader.position < end) {
            val id = readId()
            val size = readSize()
            val childEnd = reader.position + size
            when (id) {
                BLOCK -> {
                    blockStart = reader.position
                    blockEnd = childEnd
                }
                BLOCK_DURATION -> duration = readUnsigned(size)
            }
            reader.seek(childEnd)
        }
        if (blockStart < 0) return null
        reader.seek(blockStart)
        return readBlock(blockEnd, clusterTime, duration, track)
    }

    /** One block: its track, a time relative to the cluster, flags, then the frame. */
    private fun readBlock(end: Long, clusterTime: Long, duration: Long, track: TrackInfo): Cue? {
        if (readSize() != track.track.number) return null
        val relative = ((reader.readByte() shl 8) or reader.readByte()).toShort().toLong()
        val flags = reader.readByte()
        if ((flags and 0x06) != 0) return null // laced; subtitle tracks don't do this
        val length = end - reader.position
        if (length <= 0 || length > MAX_PAYLOAD) return null
        val payload = decode(reader.readBytes(length.toInt()), track) ?: return null

        val startMs = (clusterTime + relative) * timecodeScale / 1_000_000L
        val endMs = when {
            duration >= 0 -> startMs + duration * timecodeScale / 1_000_000L
            track.defaultDurationNs > 0 -> startMs + track.defaultDurationNs / 1_000_000L
            else -> -1L
        }
        val raw = String(payload, Charsets.UTF_8)
        val text = when (track.track.codec) {
            "ass", "ssa" -> Subtext.fromAss(raw)
            "vtt" -> Subtext.fromVtt(raw)
            else -> raw.trim().ifEmpty { null }
        } ?: return null
        return Cue(startMs, endMs, text)
    }

    private fun decode(payload: ByteArray, track: TrackInfo): ByteArray? = when (track.compression) {
        null -> payload
        3 -> track.strippedHeader + payload
        0 -> try {
            val inflater = Inflater()
            inflater.setInput(payload)
            val out = ByteArrayOutputStream(payload.size * 4)
            val chunk = ByteArray(8192)
            while (!inflater.finished()) {
                val n = inflater.inflate(chunk)
                if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
                out.write(chunk, 0, n)
            }
            inflater.end()
            out.toByteArray()
        } catch (_: Exception) {
            null
        }
        else -> null
    }

    private fun finish(cues: List<Cue>): List<Cue> = Subtext.settle(cues)
}

/** Turning other subtitle flavours into plain SRT text, and SRT itself. */
object Subtext {

    private val OVERRIDE = Regex("""\{[^}]*\}""")
    private val DRAWING = Regex("""\{[^}]*\\p[1-9]""")
    private val ITALIC_ON = Regex("""\\i1(?![0-9])""")
    private val ITALIC_OFF = Regex("""\\i0(?![0-9])""")

    /**
     * An ASS event as Matroska stores it: ReadOrder, Layer, Style, Name, MarginL, MarginR,
     * MarginV, Effect, then the text. Styling overrides are dropped, bar italics; line
     * breaks become real ones; vector drawings, which aren't words, are left out.
     */
    fun fromAss(event: String): String? {
        val parts = event.split(',', limit = 9)
        val text = if (parts.size == 9) parts[8] else event
        if (DRAWING.containsMatchIn(text)) return null
        var converted = OVERRIDE.replace(text) { m ->
            buildString {
                if (ITALIC_ON.containsMatchIn(m.value)) append("<i>")
                if (ITALIC_OFF.containsMatchIn(m.value)) append("</i>")
            }
        }
        converted = converted.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
        converted = balanceItalics(converted.trim())
        return converted.ifBlank { null }
    }

    /** WebVTT cue text: keep the words and italics, drop voice and class spans. */
    fun fromVtt(text: String): String? {
        val cleaned = text
            .replace(Regex("""</?(c|v|b|u|ruby|rt|lang)(\.[^ >]*)?( [^>]*)?>"""), "")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&nbsp;", " ")
            .trim()
        return cleaned.ifBlank { null }
    }

    private fun balanceItalics(text: String): String {
        val opens = Regex("<i>").findAll(text).count()
        val closes = Regex("</i>").findAll(text).count()
        return if (opens > closes) text + "</i>".repeat(opens - closes) else text
    }

    /**
     * Put cues in order, drop exact repeats, and give an end to any cue whose file didn't
     * give one: the next cue's start, within reason, or a reading-speed guess.
     */
    fun settle(cues: List<Cue>): List<Cue> {
        val sorted = cues.sortedWith(compareBy({ it.start }, { it.end }))
        val out = ArrayList<Cue>(sorted.size)
        for ((i, cue) in sorted.withIndex()) {
            if (out.isNotEmpty() && out.last() == cue) continue
            var end = cue.end
            if (end <= cue.start) {
                val reading = (1000L + 60L * cue.text.length).coerceIn(2000L, 7000L)
                val next = sorted.drop(i + 1).firstOrNull { it.start > cue.start }?.start
                end = if (next != null) minOf(next, cue.start + reading) else cue.start + reading
            }
            out.add(cue.copy(end = end))
        }
        return out
    }

    fun toSrt(cues: List<Cue>): String {
        val out = StringBuilder()
        var number = 1
        for (cue in cues) {
            val text = cue.text.replace("\r\n", "\n").replace('\r', '\n').trim()
            if (text.isEmpty()) continue
            out.append(number++).append("\r\n")
            out.append(stamp(cue.start)).append(" --> ").append(stamp(maxOf(cue.end, cue.start + 1)))
                .append("\r\n")
            out.append(text.replace("\n", "\r\n")).append("\r\n\r\n")
        }
        return out.toString()
    }

    private fun stamp(ms: Long): String {
        val t = ms.coerceAtLeast(0L)
        return String.format(
            Locale.US, "%02d:%02d:%02d,%03d",
            t / 3_600_000, (t / 60_000) % 60, (t / 1000) % 60, t % 1000,
        )
    }
}

/** Language codes as people read them: "fre" and "fr" both become "French". */
object Languages {

    /** ISO 639-2 bibliographic codes, which Matroska uses, mapped to terminology codes. */
    private val BIBLIOGRAPHIC = mapOf(
        "alb" to "sqi", "arm" to "hye", "baq" to "eus", "bur" to "mya", "chi" to "zho",
        "cze" to "ces", "dut" to "nld", "fre" to "fra", "geo" to "kat", "ger" to "deu",
        "gre" to "ell", "ice" to "isl", "mac" to "mkd", "mao" to "mri", "may" to "msa",
        "per" to "fas", "rum" to "ron", "slo" to "slk", "tib" to "bod", "wel" to "cym",
    )

    private val threeLetter: Map<String, String> by lazy {
        val map = HashMap<String, String>()
        for (code in Locale.getISOLanguages()) {
            try {
                map[Locale(code).isO3Language] = code
            } catch (_: Exception) {
            }
        }
        map
    }

    fun name(code: String): String {
        val base = code.substringBefore('-').lowercase(Locale.US).trim()
        if (base.isEmpty() || base == "und" || base == "zxx" || base == "mis") return ""
        val two = when (base.length) {
            2 -> base
            3 -> threeLetter[BIBLIOGRAPHIC[base] ?: base]
            else -> null
        } ?: return code
        val shown = Locale(two).getDisplayLanguage(Locale.getDefault())
        return if (shown.isBlank() || shown.equals(two, ignoreCase = true)) code else shown
    }
}
