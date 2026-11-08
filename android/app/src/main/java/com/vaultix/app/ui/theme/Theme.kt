package com.vaultix.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val VaultixColorScheme = darkColorScheme(
    primary = Color(0xFF4F9DFF),
    onPrimary = Color(0xFF04101F),
    secondary = Color(0xFF3DDC97),
    onSecondary = Color(0xFF04101F),
    background = Color(0xFF090D12),
    onBackground = Color(0xFFE7EEF6),
    surface = Color(0xFF0F151D),
    onSurface = Color(0xFFE7EEF6),
    surfaceVariant = Color(0xFF131B25),
    onSurfaceVariant = Color(0xFF8A9AAB),
    outline = Color(0xFF1E2A36),
    error = Color(0xFFFF6B6B),
    onError = Color(0xFF1A0505),
)

@Composable
fun VaultixTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = VaultixColorScheme,
        typography = Typography(),
        content = content,
    )
}
