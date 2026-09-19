package com.tempshantaram.toss

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URL

/** A UPnP media renderer we can push video at — in practice, the TV. */
data class Renderer(
    val udn: String,
    val name: String,
    val manufacturer: String,
    val model: String,
    val location: String,
    val avTransportUrl: String,
    val renderingControlUrl: String?,
) {
    val label: String get() = if (name.isBlank()) model.ifBlank { "Unnamed renderer" } else name
    val detail: String
        get() = listOf(manufacturer, model).filter { it.isNotBlank() }.joinToString(" · ")
            .ifBlank { URL(location).host }
}

/** Something that answered on the network but can't play video for us. */
data class Sighting(val name: String, val detail: String)

data class Discovery(
    val renderers: List<Renderer> = emptyList(),
    val others: List<Sighting> = emptyList(),
    val replies: Int = 0,
)

object Ssdp {

    private const val TAG = "TossSsdp"
    private const val GROUP = "239.255.255.250"
    private const val PORT = 1900

    private val SEARCH_TARGETS = listOf(
        "urn:schemas-upnp-org:device:MediaRenderer:1",
        "urn:schemas-upnp-org:service:AVTransport:1",
        "ssdp:all",
    )

    /**
     * Blocking. Shouts M-SEARCH at the local network, then fetches a description document
     * for everything that answers. Anything with an AVTransport service is a renderer;
     * the rest is reported back so a failed search can say what it *did* find.
     */
    fun discover(context: Context, millis: Long = 5000L): Discovery {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val lock = wifi?.createMulticastLock("toss-ssdp")?.apply {
            setReferenceCounted(true)
            acquire()
        }

        val locations = LinkedHashMap<String, String>() // location -> SERVER header
        var replies = 0

        try {
            val group = InetAddress.getByName(GROUP)
            DatagramSocket().use { socket ->
                socket.soTimeout = 400
                socket.broadcast = true

                for (round in 0 until 2) {
                    for (target in SEARCH_TARGETS) {
                        val msg = buildString {
                            append("M-SEARCH * HTTP/1.1\r\n")
                            append("HOST: $GROUP:$PORT\r\n")
                            append("MAN: \"ssdp:discover\"\r\n")
                            append("MX: 2\r\n")
                            append("ST: $target\r\n")
                            append("USER-AGENT: Android/12 UPnP/1.0 Toss/1.0\r\n")
                            append("\r\n")
                        }.toByteArray()
                        try {
                            socket.send(DatagramPacket(msg, msg.size, group, PORT))
                        } catch (e: Exception) {
                            Log.w(TAG, "send failed: ${e.message}")
                        }
                    }

                    val roundEnd = System.currentTimeMillis() + millis / 2
                    val buffer = ByteArray(4096)
                    while (System.currentTimeMillis() < roundEnd) {
                        val packet = DatagramPacket(buffer, buffer.size)
                        try {
                            socket.receive(packet)
                        } catch (_: SocketTimeoutException) {
                            continue
                        } catch (e: Exception) {
                            Log.w(TAG, "receive failed: ${e.message}")
                            break
                        }
                        replies++
                        val headers = parseHeaders(String(packet.data, 0, packet.length))
                        val location = headers["location"] ?: continue
                        if (!locations.containsKey(location)) {
                            locations[location] = headers["server"] ?: ""
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "discovery failed: ${e.message}")
        } finally {
            try {
                if (lock != null && lock.isHeld) lock.release()
            } catch (_: Exception) {
            }
        }

        val renderers = LinkedHashMap<String, Renderer>()
        val others = ArrayList<Sighting>()
        for ((location, server) in locations) {
            val host = try {
                URL(location).host
            } catch (_: Exception) {
                location
            }
            val xml = Http.get(location, 4000)
            if (xml == null) {
                others.add(Sighting(host, server.ifBlank { "did not answer for details" }))
                continue
            }
            val renderer = readRenderer(location, xml)
            if (renderer != null) {
                renderers[renderer.udn.ifBlank { renderer.avTransportUrl }] = renderer
            } else {
                val device = Xml.first(Xml.parse(xml), "device")
                others.add(
                    Sighting(
                        Xml.childText(device, "friendlyName") ?: host,
                        Xml.childText(device, "modelName")
                            ?: server.ifBlank { "no video playback" },
                    )
                )
            }
        }
        return Discovery(renderers.values.toList(), others, replies)
    }

    private fun parseHeaders(raw: String): Map<String, String> {
        val map = HashMap<String, String>()
        for (line in raw.split("\r\n", "\n")) {
            val i = line.indexOf(':')
            if (i > 0) {
                map[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
            }
        }
        return map
    }

    private fun readRenderer(location: String, xml: String): Renderer? {
        val doc = Xml.parse(xml) ?: return null
        val services = Xml.all(doc, "service")
        val av = services.firstOrNull {
            Xml.childText(it, "serviceType")?.contains("AVTransport", ignoreCase = true) == true
        } ?: return null
        val control = Xml.childText(av, "controlURL")?.takeIf { it.isNotBlank() } ?: return null

        val base = Xml.text(doc, "URLBase")?.takeIf { it.isNotBlank() } ?: location
        val device = ownerDevice(av) ?: Xml.first(doc, "device")
        val rc = services.firstOrNull {
            Xml.childText(it, "serviceType")?.contains("RenderingControl", ignoreCase = true) == true
        }

        return Renderer(
            udn = Xml.childText(device, "UDN") ?: "",
            name = Xml.childText(device, "friendlyName") ?: "",
            manufacturer = Xml.childText(device, "manufacturer") ?: "",
            model = Xml.childText(device, "modelName") ?: "",
            location = location,
            avTransportUrl = resolve(base, control) ?: return null,
            renderingControlUrl = Xml.childText(rc, "controlURL")?.let { resolve(base, it) },
        )
    }

    private fun ownerDevice(service: Element): Element? {
        var node: Node? = service.parentNode
        while (node != null) {
            if (node.nodeType == Node.ELEMENT_NODE &&
                node.nodeName.substringAfterLast(':').equals("device", ignoreCase = true)
            ) {
                return node as Element
            }
            node = node.parentNode
        }
        return null
    }

    private fun resolve(base: String, path: String): String? = try {
        URL(URL(base), path).toString()
    } catch (_: Exception) {
        null
    }
}
