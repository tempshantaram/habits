package com.tempshantaram.toss

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * What survives the app being closed: the queue, where each video was left, and how far each
 * video's subtitles have been nudged. Resume points and nudges are keyed by the video's URI,
 * so they hold even when a video leaves the queue and is added again later.
 */
object Store {

    private const val MAX_PLACES = 300

    private var queue: SharedPreferences? = null
    private var places: SharedPreferences? = null
    private var offsets: SharedPreferences? = null

    fun init(context: Context) {
        if (queue != null) return
        val app = context.applicationContext
        queue = app.getSharedPreferences("toss_queue", Context.MODE_PRIVATE)
        places = app.getSharedPreferences("toss_places", Context.MODE_PRIVATE)
        offsets = app.getSharedPreferences("toss_offsets", Context.MODE_PRIVATE)
    }

    // ---- the queue -----------------------------------------------------------------------

    fun saveQueue(items: List<Item>) {
        val array = JSONArray()
        for (item in items) {
            val o = JSONObject()
            o.put("uri", item.uri.toString())
            o.put("title", item.title)
            o.put("mime", item.mime)
            o.put("size", item.size)
            o.put("duration", item.duration)
            item.subtitle?.let {
                o.put("subUri", it.uri.toString())
                o.put("subName", it.name)
            }
            o.put("warnings", JSONArray(item.warnings))
            val tracks = JSONArray()
            for (t in item.embedded) {
                tracks.put(
                    JSONObject()
                        .put("n", t.number)
                        .put("codec", t.codec)
                        .put("lang", t.language)
                        .put("name", t.name)
                        .put("default", t.isDefault)
                        .put("forced", t.isForced)
                )
            }
            o.put("embedded", tracks)
            array.put(o)
        }
        queue?.edit()?.putString("items", array.toString())?.apply()
    }

    /**
     * Only files the app still holds lasting access to come back. Videos shared in from
     * another app had temporary access, which ended with the session, so they drop out.
     */
    fun loadQueue(context: Context): List<Item> {
        val text = queue?.getString("items", null) ?: return emptyList()
        val readable = try {
            context.contentResolver.persistedUriPermissions
                .filter { it.isReadPermission }
                .map { it.uri.toString() }
                .toSet()
        } catch (_: Exception) {
            emptySet()
        }
        val array = try {
            JSONArray(text)
        } catch (_: Exception) {
            return emptyList()
        }

        val out = ArrayList<Item>()
        for (i in 0 until array.length()) {
            val o = array.optJSONObject(i) ?: continue
            val uri = o.optString("uri", "")
            if (uri.isEmpty() || uri !in readable) continue

            // A subtitle comes back if it's a picked file still readable, or one extracted
            // from a video into the app's own storage that is still there.
            val subUri = o.optString("subUri", "")
            val extracted = subUri.isNotEmpty() && Uri.parse(subUri).let { u ->
                Embedded.isOurs(context, u) && u.path?.let { File(it).exists() } == true
            }
            val subtitle = if (subUri.isNotEmpty() && (subUri in readable || extracted)) {
                Subtitle(Uri.parse(subUri), o.optString("subName", "subtitles.srt"))
            } else {
                null
            }
            val warningList = o.optJSONArray("warnings")
            val warnings = ArrayList<String>()
            if (warningList != null) {
                for (w in 0 until warningList.length()) {
                    val line = warningList.optString(w, "")
                    if (line.isNotEmpty()) warnings.add(line)
                }
            }

            val trackList = o.optJSONArray("embedded")
            val embedded = ArrayList<EmbeddedTrack>()
            if (trackList != null) {
                for (t in 0 until trackList.length()) {
                    val track = trackList.optJSONObject(t) ?: continue
                    embedded.add(
                        EmbeddedTrack(
                            number = track.optLong("n", 0L),
                            codec = track.optString("codec", ""),
                            language = track.optString("lang", ""),
                            name = track.optString("name", ""),
                            isDefault = track.optBoolean("default", false),
                            isForced = track.optBoolean("forced", false),
                        )
                    )
                }
            }

            out.add(
                Item(
                    id = Media.newId(),
                    uri = Uri.parse(uri),
                    title = o.optString("title", "video"),
                    mime = o.optString("mime", "video/mp4"),
                    size = o.optLong("size", 0L),
                    duration = o.optInt("duration", 0),
                    subtitle = subtitle,
                    subtitleOffsetMs = offset(uri),
                    warnings = warnings,
                    embedded = embedded,
                )
            )
        }
        return out
    }

    // ---- where each video was left ----------------------------------------------------------

    fun place(uri: Uri): Int = places?.getInt(uri.toString(), 0) ?: 0

    fun allPlaces(): Map<String, Int> {
        val out = HashMap<String, Int>()
        places?.all?.forEach { (key, value) -> if (value is Int && value > 0) out[key] = value }
        return out
    }

    fun setPlace(uri: Uri, seconds: Int) {
        val store = places ?: return
        val editor = store.edit()
        if (seconds > 0) editor.putInt(uri.toString(), seconds) else editor.remove(uri.toString())
        // A long-lived app would otherwise remember every film ever watched.
        val all = store.all
        if (seconds > 0 && all.size >= MAX_PLACES && !all.containsKey(uri.toString())) {
            all.keys.firstOrNull()?.let { editor.remove(it) }
        }
        editor.apply()
    }

    // ---- subtitle timing -------------------------------------------------------------------

    fun offset(uri: String): Int = offsets?.getInt(uri, 0) ?: 0

    fun setOffset(uri: Uri, ms: Int) {
        val editor = offsets?.edit() ?: return
        if (ms == 0) editor.remove(uri.toString()) else editor.putInt(uri.toString(), ms)
        editor.apply()
    }
}
