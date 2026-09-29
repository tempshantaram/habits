package com.tempshantaram.toss

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A running note of what was asked of the TV and what the TV asked for back. Seeking is the
 * part of DLNA where sets differ most, and this is the only way to see which of the three
 * possible conversations is actually happening.
 */
object Diagnostics {

    private const val LIMIT = 120
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.US)
    private val lines = ArrayDeque<String>()

    private val _log = MutableStateFlow<List<String>>(emptyList())
    val log: StateFlow<List<String>> = _log.asStateFlow()

    @Synchronized
    fun note(line: String) {
        lines.addLast("${clock.format(Date())}  $line")
        while (lines.size > LIMIT) lines.removeFirst()
        _log.value = lines.toList()
    }

    @Synchronized
    fun clear() {
        lines.clear()
        _log.value = emptyList()
    }

    fun asText(): String = _log.value.joinToString("\n").ifBlank { "Nothing recorded yet." }
}
