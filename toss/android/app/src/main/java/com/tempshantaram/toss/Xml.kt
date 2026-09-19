package com.tempshantaram.toss

import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.xml.sax.InputSource
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Just enough DOM to read UPnP, which is namespaced inconsistently in the wild:
 * everything here matches on local name and ignores prefixes.
 */
object Xml {

    fun parse(text: String): Document? = try {
        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = false
        factory.newDocumentBuilder().parse(InputSource(StringReader(text.trim())))
    } catch (_: Exception) {
        null
    }

    private fun localName(node: Node): String = node.nodeName.substringAfterLast(':')

    /** Every descendant element with this local name, depth first. */
    fun all(node: Node?, name: String): List<Element> {
        val found = ArrayList<Element>()
        fun walk(n: Node) {
            var child = n.firstChild
            while (child != null) {
                if (child.nodeType == Node.ELEMENT_NODE) {
                    val el = child as Element
                    if (localName(el).equals(name, ignoreCase = true)) found.add(el)
                    walk(el)
                }
                child = child.nextSibling
            }
        }
        if (node != null) walk(node)
        return found
    }

    fun first(node: Node?, name: String): Element? = all(node, name).firstOrNull()

    /** Direct child element with this local name. */
    fun child(node: Node?, name: String): Element? {
        var c = node?.firstChild
        while (c != null) {
            if (c.nodeType == Node.ELEMENT_NODE && localName(c).equals(name, ignoreCase = true)) {
                return c as Element
            }
            c = c.nextSibling
        }
        return null
    }

    fun childText(node: Node?, name: String): String? = child(node, name)?.textContent?.trim()

    fun text(node: Node?, name: String): String? = first(node, name)?.textContent?.trim()

    fun escape(s: String): String = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&apos;")
}
