package com.tempshantaram.toss

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.IntentCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Toss.init(this)
        takeShared(intent)
        setContent {
            TossTheme {
                Surface(color = Paper, modifier = Modifier.fillMaxSize()) {
                    TossScreen()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        takeShared(intent)
    }

    /** Videos shared in from Photos or Files land straight in the queue. */
    private fun takeShared(intent: Intent?) {
        if (intent == null) return
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(
                    IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
                )

            Intent.ACTION_SEND_MULTIPLE ->
                IntentCompat.getParcelableArrayListExtra(
                    intent, Intent.EXTRA_STREAM, Uri::class.java
                ) ?: emptyList()

            else -> emptyList()
        }
        if (uris.isNotEmpty()) Toss.addVideos(uris)
    }
}

@Composable
fun TossScreen() {
    val context = LocalContext.current
    val queue by Toss.queue.collectAsStateWithLifecycle()
    val device by Toss.device.collectAsStateWithLifecycle()
    val playback by Toss.playback.collectAsStateWithLifecycle()
    val notice by Toss.notice.collectAsStateWithLifecycle()
    val address by Toss.address.collectAsStateWithLifecycle()

    var showDevices by remember { mutableStateOf(false) }
    var subtitleTarget by remember { mutableStateOf<String?>(null) }

    val askNotifications = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    val pickVideos = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        for (uri in uris) {
            try {
                context.contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Exception) {
            }
        }
        Toss.addVideos(uris)
    }

    val pickSubtitle = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        val target = subtitleTarget
        if (uri != null && target != null) {
            try {
                context.contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Exception) {
            }
            Toss.attachSubtitle(target, uri)
        }
        subtitleTarget = null
    }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            askNotifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
        Toss.scan()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(horizontal = 16.dp)
    ) {
        Header(address)

        DeviceRow(
            device = device,
            onOpen = { showDevices = true },
        )

        Spacer(Modifier.height(16.dp))
        SectionLabel(
            text = if (queue.isEmpty()) "QUEUE" else "QUEUE · ${queue.size}",
            action = if (queue.isEmpty()) null else "Clear",
            onAction = { Toss.clearQueue() },
        )

        Box(modifier = Modifier.weight(1f)) {
            if (queue.isEmpty()) {
                EmptyQueue { pickVideos.launch(arrayOf("video/*")) }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(queue, key = { it.id }) { item ->
                        QueueRow(
                            item = item,
                            playing = playback.itemId == item.id,
                            onPlay = { Toss.play(item) },
                            onSubtitle = {
                                subtitleTarget = item.id
                                pickSubtitle.launch(arrayOf("*/*"))
                            },
                            onSubtitleClear = { Toss.removeSubtitle(item.id) },
                            onUp = { Toss.move(item.id, -1) },
                            onDown = { Toss.move(item.id, 1) },
                            onRemove = { Toss.remove(item.id) },
                        )
                    }
                    item {
                        Spacer(Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { pickVideos.launch(arrayOf("video/*")) },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Add videos")
                        }
                        Spacer(Modifier.height(12.dp))
                    }
                }
            }
        }

        if (notice != null) {
            Notice(notice!!) { Toss.dismissNotice() }
        }

        if (queue.isNotEmpty()) {
            Player(playback = playback, item = Toss.current())
        }
    }

    if (showDevices) {
        DeviceDialog(onDismiss = { showDevices = false })
    }
}

@Composable
private fun Header(address: String?) {
    Column(modifier = Modifier.padding(top = 20.dp, bottom = 14.dp)) {
        Text("Toss", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Text(
            text = address?.let { "SERVING FROM $it" } ?: "PHONE TO TV, OVER WI-FI",
            style = LabelStyle,
            modifier = Modifier.padding(top = 3.dp),
        )
    }
}

@Composable
private fun SectionLabel(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp, end = 4.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = LabelStyle)
        if (action != null) {
            Text(
                text = action,
                style = LabelStyle.copy(color = Clay),
                modifier = Modifier.clickable { onAction() },
            )
        }
    }
}

@Composable
private fun DeviceRow(device: Renderer?, onOpen: () -> Unit) {
    val scanning by Toss.scanning.collectAsStateWithLifecycle()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Panel, RoundedCornerShape(10.dp))
            .border(1.dp, Line, RoundedCornerShape(10.dp))
            .clickable { onOpen() }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Filled.Tv,
            contentDescription = null,
            tint = if (device == null) Faint else Moss,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = device?.label ?: "No TV chosen",
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = if (device == null) Muted else Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = when {
                    scanning -> "Looking…"
                    device != null -> device.detail
                    else -> "Tap to find one"
                },
                style = MetaStyle,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (scanning) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp,
                color = Moss,
            )
        } else {
            Text("CHANGE", style = LabelStyle.copy(color = Moss))
        }
    }
}

@Composable
private fun EmptyQueue(onAdd: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Nothing queued yet.",
            fontSize = 15.sp,
            color = Muted,
        )
        Text(
            "Add a video, or share one to Toss from Photos.",
            style = MetaStyle,
            modifier = Modifier.padding(top = 6.dp, bottom = 18.dp),
        )
        Button(
            onClick = onAdd,
            colors = ButtonDefaults.buttonColors(containerColor = Moss, contentColor = Color.White),
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Add videos")
        }
    }
}

@Composable
private fun QueueRow(
    item: Item,
    playing: Boolean,
    onPlay: () -> Unit,
    onSubtitle: () -> Unit,
    onSubtitleClear: () -> Unit,
    onUp: () -> Unit,
    onDown: () -> Unit,
    onRemove: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Panel, RoundedCornerShape(10.dp))
            .border(
                width = if (playing) 1.5.dp else 1.dp,
                color = if (playing) Moss else Line,
                shape = RoundedCornerShape(10.dp),
            )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onPlay() }
                .padding(start = 14.dp, end = 10.dp, top = 12.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.displayTitle,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = Ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = buildString {
                        append(item.ext.uppercase())
                        append(" · ")
                        append(Media.formatSize(item.size))
                        item.subtitle?.let {
                            append(" · SUBS ")
                            append(it.ext.uppercase())
                        }
                    },
                    style = MetaStyle.copy(color = if (playing) Moss else Faint),
                    modifier = Modifier.padding(top = 3.dp),
                )
            }
            Icon(
                Icons.Filled.PlayArrow,
                contentDescription = "Play on the TV",
                tint = if (playing) Moss else Faint,
                modifier = Modifier.size(22.dp),
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 6.dp, end = 6.dp, bottom = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SmallAction(
                icon = { tint ->
                    Icon(Icons.Filled.Subtitles, contentDescription = null, tint = tint, modifier = Modifier.size(17.dp))
                },
                label = if (item.subtitle == null) "Subtitles" else "Remove subs",
                tint = if (item.subtitle == null) Muted else Moss,
                onClick = { if (item.subtitle == null) onSubtitle() else onSubtitleClear() },
            )
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onUp, modifier = Modifier.size(34.dp)) {
                Icon(Icons.Filled.ArrowUpward, "Move up", tint = Faint, modifier = Modifier.size(17.dp))
            }
            IconButton(onClick = onDown, modifier = Modifier.size(34.dp)) {
                Icon(Icons.Filled.ArrowDownward, "Move down", tint = Faint, modifier = Modifier.size(17.dp))
            }
            IconButton(onClick = onRemove, modifier = Modifier.size(34.dp)) {
                Icon(Icons.Filled.Close, "Remove", tint = Clay, modifier = Modifier.size(17.dp))
            }
        }
    }
}

@Composable
private fun SmallAction(
    icon: @Composable (Color) -> Unit,
    label: String,
    tint: Color,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon(tint)
        Spacer(Modifier.width(6.dp))
        Text(label, style = MetaStyle.copy(color = tint))
    }
}

@Composable
private fun Notice(message: String, onDismiss: () -> Unit) {
    LaunchedEffect(message) {
        kotlinx.coroutines.delay(7000)
        onDismiss()
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 10.dp)
            .background(Color(0xFFEED6D1), RoundedCornerShape(10.dp))
            .padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(message, fontSize = 13.sp, color = Color(0xFF6E2A20), modifier = Modifier.weight(1f))
        IconButton(onClick = onDismiss, modifier = Modifier.size(30.dp)) {
            Icon(Icons.Filled.Close, "Dismiss", tint = Clay, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun Player(playback: Playback, item: Item?) {
    var dragging by remember { mutableStateOf(false) }
    var dragValue by remember { mutableStateOf(0f) }

    val duration = if (playback.duration > 0) playback.duration else 0
    val shown = if (dragging) dragValue.toInt() else playback.position

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 14.dp)
            .background(Panel, RoundedCornerShape(12.dp))
            .border(1.dp, Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp)
    ) {
        Text(
            text = item?.displayTitle ?: "Nothing playing",
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            color = if (item == null) Muted else Ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )

        if (duration > 0) {
            Slider(
                value = shown.toFloat().coerceIn(0f, duration.toFloat()),
                valueRange = 0f..duration.toFloat(),
                onValueChange = {
                    dragging = true
                    dragValue = it
                },
                onValueChangeFinished = {
                    dragging = false
                    Toss.seek(dragValue.toInt())
                },
                modifier = Modifier.padding(top = 2.dp),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(Media.formatTime(shown), style = MetaStyle)
                Text(Media.formatTime(duration), style = MetaStyle)
            }
        } else {
            Spacer(Modifier.height(8.dp))
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 6.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { Toss.previous() }) {
                Icon(Icons.Filled.SkipPrevious, "Previous", tint = Muted, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.width(6.dp))
            Box(
                modifier = Modifier
                    .size(54.dp)
                    .background(Moss, RoundedCornerShape(27.dp))
                    .clickable { Toss.toggle() },
                contentAlignment = Alignment.Center,
            ) {
                if (playback.working) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                        color = Color.White,
                    )
                } else {
                    Icon(
                        if (playback.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (playback.isPlaying) "Pause" else "Play",
                        tint = Color.White,
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
            Spacer(Modifier.width(6.dp))
            IconButton(onClick = { Toss.next() }) {
                Icon(Icons.Filled.SkipNext, "Next", tint = Muted, modifier = Modifier.size(26.dp))
            }
            Spacer(Modifier.width(10.dp))
            IconButton(onClick = { Toss.stop() }) {
                Icon(Icons.Filled.Stop, "Stop", tint = Muted, modifier = Modifier.size(24.dp))
            }
        }

        if (playback.volume >= 0) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.VolumeUp, null, tint = Faint, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(10.dp))
                Slider(
                    value = playback.volume.toFloat(),
                    valueRange = 0f..100f,
                    onValueChange = { Toss.setVolume(it.toInt()) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun DeviceDialog(onDismiss: () -> Unit) {
    val devices by Toss.devices.collectAsStateWithLifecycle()
    val others by Toss.others.collectAsStateWithLifecycle()
    val scanning by Toss.scanning.collectAsStateWithLifecycle()
    val searched by Toss.searched.collectAsStateWithLifecycle()
    val chosen by Toss.device.collectAsStateWithLifecycle()

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Panel,
        title = { Text("Play on", fontSize = 18.sp, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(
                modifier = Modifier
                    .heightIn(max = 380.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                if (devices.isEmpty() && scanning) {
                    Text("Searching the network…", fontSize = 14.sp, color = Muted)
                }
                if (devices.isEmpty() && !scanning && searched) {
                    Text(
                        "No TV answered.",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = Ink,
                    )
                    Text(
                        text = "On the TV, check that it is on the same Wi-Fi as the phone, " +
                            "and that the setting is on — it is usually under " +
                            "General › External Device Manager › Device Connect Manager, " +
                            "or in the SmartThings app. Some newer Samsung sets only accept " +
                            "video this way once the TV has been woken from the remote.",
                        fontSize = 13.sp,
                        color = Muted,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
                for (renderer in devices) {
                    val isChosen = renderer.udn == chosen?.udn
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .background(
                                if (isChosen) MossSoft else Paper,
                                RoundedCornerShape(8.dp),
                            )
                            .clickable {
                                Toss.choose(renderer)
                                onDismiss()
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp)
                    ) {
                        Text(renderer.label, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Ink)
                        Text(renderer.detail, style = MetaStyle)
                    }
                }
                if (others.isNotEmpty()) {
                    Text(
                        "ALSO ON THE NETWORK",
                        style = LabelStyle,
                        modifier = Modifier.padding(top = 14.dp, bottom = 4.dp),
                    )
                    for (sighting in others) {
                        Text(
                            "${sighting.name} — ${sighting.detail}",
                            style = MetaStyle,
                            modifier = Modifier.padding(vertical = 2.dp),
                        )
                    }
                    Text(
                        "These answered, but none of them can play video.",
                        fontSize = 12.sp,
                        color = Faint,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { Toss.scan() }, enabled = !scanning) {
                Icon(Icons.Filled.Refresh, null, modifier = Modifier.size(17.dp), tint = Moss)
                Spacer(Modifier.width(6.dp))
                Text(if (scanning) "Searching…" else "Search again", color = Moss)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Close", color = Muted) }
        },
    )
}
