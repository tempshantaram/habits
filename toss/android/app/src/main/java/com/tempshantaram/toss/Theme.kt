package com.tempshantaram.toss

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.sp

val Paper = Color(0xFFF4F6F3)
val Panel = Color(0xFFFFFFFF)
val Ink = Color(0xFF16211C)
val Muted = Color(0xFF6B7A72)
val Faint = Color(0xFF9AA8A0)
val Line = Color(0xFFE3E7E3)
val Moss = Color(0xFF3F6B54)
val MossSoft = Color(0xFFCBDCD1)
val Amber = Color(0xFFB8842E)
val Clay = Color(0xFFA8483A)

/** The label style the other apps in this repo use: small, spaced, monospace. */
val LabelStyle = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 10.sp,
    letterSpacing = 1.4.sp,
    color = Faint,
)

val MetaStyle = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 11.sp,
    color = Faint,
)

@Composable
fun TossTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Moss,
            onPrimary = Color.White,
            primaryContainer = MossSoft,
            onPrimaryContainer = Ink,
            secondary = Amber,
            background = Paper,
            onBackground = Ink,
            surface = Panel,
            onSurface = Ink,
            surfaceVariant = Paper,
            onSurfaceVariant = Muted,
            outline = Line,
            error = Clay,
        ),
        typography = Typography(),
        content = content,
    )
}
