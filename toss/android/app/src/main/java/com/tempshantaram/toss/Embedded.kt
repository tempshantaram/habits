package com.tempshantaram.toss

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.util.Locale

/** What came out of a track: SRT text, and how many lines it held. */
class Extracted(val srt: String, val lines: Int)

/**
 * Subtitle tracks carried inside a video file. Matroska (MKV, WebM) is read directly, which
 * handles ASS tracks and exact line timings; anything else goes through Android's own reader,
 * which covers the text tracks MP4 files carry.
 */
object Embedded {

    private const val DIRECTORY = "subtitles"

    /** The subtitle tracks inside a video. Quick: only the file's header is read. */
    fun probe(context: Context, uri: Uri): List<EmbeddedTrack> = try {
        if (isMatroska(context, uri)) {
            withChannel(context, uri) { Mkv(ChannelReader(it)).subtitleTracks() }
        } else {
            probeOther(context, uri)
        }
    } catch (_: Exception) {
        emptyList()
    }

    /**
     * Read one track out of the video as SRT. This goes through the whole file once, so
     * [progress] hears how far it has got, from 0 to 100.
     */
    fun extract(
        context: Context,
        uri: Uri,
        track: EmbeddedTrack,
        progress: (Int) -> Unit,
    ): Extracted {
        val cues = if (isMatroska(context, uri)) {
            withChannel(context, uri) { Mkv(ChannelReader(it)).cues(track.number, progress) }
        } else {
            extractOther(context, uri, track, progress)
        }
        return Extracted(Subtext.toSrt(cues), cues.size)
    }

    /**
     * Keep an extracted track in the app's own storage, where the server can serve it and
     * the next launch can still find it.
     */
    fun store(context: Context, video: Uri, track: EmbeddedTrack, srt: String): File {
        val directory = File(context.filesDir, DIRECTORY).apply { mkdirs() }
        val key = Integer.toHexString(video.toString().hashCode())
        val file = File(directory, "$key-${track.number}.srt")
        file.writeText(srt, Charsets.UTF_8)
        return file
    }

    /** Whether a subtitle is one of ours, extracted from a video, rather than a picked file. */
    fun isOurs(context: Context, uri: Uri): Boolean {
        if (uri.scheme != "file") return false
        val path = uri.path ?: return false
        return path.startsWith(File(context.filesDir, DIRECTORY).path)
    }

    // ---- Matroska ---------------------------------------------------------------------------

    private fun isMatroska(context: Context, uri: Uri): Boolean = try {
        context.contentResolver.openInputStream(uri)?.use { stream ->
            val head = ByteArray(4)
            var read = 0
            while (read < 4) {
                val n = stream.read(head, read, 4 - read)
                if (n < 0) break
                read += n
            }
            read == 4 &&
                head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() &&
                head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte()
        } ?: false
    } catch (_: Exception) {
        false
    }

    private fun <T> withChannel(context: Context, uri: Uri, block: (FileChannel) -> T): T {
        val descriptor = context.contentResolver.openFileDescriptor(uri, "r")
            ?: throw MkvException("the file couldn't be opened")
        return ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { block(it.channel) }
    }

    // ---- everything else, through Android's reader -----------------------------------------

    private fun textCodec(mime: String): String? = when (mime.lowercase(Locale.US)) {
        "text/3gpp-tt" -> "tx3g"
        "application/x-subrip" -> "srt"
        "text/vtt" -> "vtt"
        else -> null
    }

    private fun probeOther(context: Context, uri: Uri): List<EmbeddedTrack> {
        val extractor = MediaExtractor()
        return try {
            extractor.setDataSource(context, uri, null)
            (0 until extractor.trackCount).mapNotNull { index ->
                val format = extractor.getTrackFormat(index)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: return@mapNotNull null
                val codec = textCodec(mime) ?: return@mapNotNull null
                EmbeddedTrack(
                    number = index.toLong(),
                    codec = codec,
                    language = format.getString(MediaFormat.KEY_LANGUAGE) ?: "",
                    name = "",
                    isDefault = flag(format, MediaFormat.KEY_IS_DEFAULT),
                    isForced = flag(format, MediaFormat.KEY_IS_FORCED_SUBTITLE),
                )
            }
        } catch (_: Exception) {
            emptyList()
        } finally {
            extractor.release()
        }
    }

    private fun flag(format: MediaFormat, key: String): Boolean = try {
        format.containsKey(key) && format.getInteger(key) != 0
    } catch (_: Exception) {
        false
    }

    private fun extractOther(
        context: Context,
        uri: Uri,
        track: EmbeddedTrack,
        progress: (Int) -> Unit,
    ): List<Cue> {
        val extractor = MediaExtractor()
        try {
            extractor.setDataSource(context, uri, null)
            val index = track.number.toInt()
            extractor.selectTrack(index)
            val format = extractor.getTrackFormat(index)
            val durationUs =
                if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L

            val buffer = ByteBuffer.allocate(256 * 1024)
            val samples = ArrayList<Pair<Long, String?>>()
            var reported = -1
            while (true) {
                buffer.clear()
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                val timeUs = extractor.sampleTime
                val bytes = ByteArray(size)
                for (i in 0 until size) bytes[i] = buffer.get(i)
                samples.add(timeUs / 1000L to sampleText(track.codec, bytes))
                if (durationUs > 0) {
                    val percent = (timeUs * 100 / durationUs).toInt().coerceIn(0, 100)
                    if (percent != reported) {
                        reported = percent
                        progress(percent)
                    }
                }
                if (!extractor.advance()) break
            }

            // A tx3g track clears the screen with an empty sample, so each line lasts until
            // the next sample. Other formats don't, and are left for settle() to time.
            val cues = ArrayList<Cue>()
            for ((i, sample) in samples.withIndex()) {
                val text = sample.second ?: continue
                val start = sample.first
                val next = samples.getOrNull(i + 1)?.first ?: -1L
                val end = if (track.codec == "tx3g" && next > start) minOf(next, start + 10_000L) else -1L
                cues.add(Cue(start, end, text))
            }
            return Subtext.settle(cues)
        } finally {
            extractor.release()
        }
    }

    /** tx3g: a 16-bit length, then the text in UTF-8 (or UTF-16 with a byte order mark). */
    private fun sampleText(codec: String, bytes: ByteArray): String? = when (codec) {
        "tx3g" -> {
            if (bytes.size < 2) {
                null
            } else {
                val length = ((bytes[0].toInt() and 0xFF) shl 8) or (bytes[1].toInt() and 0xFF)
                val count = minOf(length, bytes.size - 2)
                when {
                    count <= 0 -> null
                    count >= 2 && bytes[2] == 0xFE.toByte() && bytes[3] == 0xFF.toByte() ->
                        String(bytes, 4, count - 2, Charsets.UTF_16BE).trim().ifEmpty { null }
                    else -> String(bytes, 2, count, Charsets.UTF_8).trim().ifEmpty { null }
                }
            }
        }
        "vtt" -> Subtext.fromVtt(String(bytes, Charsets.UTF_8))
        else -> String(bytes, Charsets.UTF_8).trim().ifEmpty { null }
    }
}
